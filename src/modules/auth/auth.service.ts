import bcrypt from 'bcrypt';
import QRCode from 'qrcode';
import { prisma } from '../../services/prisma.service';
import { logger } from '../../services/logger.service';
import {
  hashPassword,
  comparePassword,
  randomNumericCode,
  sha256,
  signAccessToken,
  signTwoFactorChallengeToken,
  signRefreshToken,
  verifyRefreshToken,
  buildOtpAuthUri,
  generateBackupCodes,
  generateTotpSecret,
  verifyTotp,
} from '../../utils/crypto';
import { uniqueVendorSlug } from '../../utils/slug';
import { AppError } from '../../utils/AppError';
import { ERROR } from '../../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../../constants/http';
import { ROLES, OTP_TYPE, OTP_CHANNEL, OtpType, VENDOR_STATUS } from '../../constants/roles';
import { VERIFICATION_PURPOSE } from '../../constants/roles';
import { OTP_TYPES_REQUIRING_ACCOUNT } from '../../constants/roles';
import { OTP } from '../../config/otp.config';
import { isOtpEnforceable } from '../../config/otp-policy';
import { ENV, isProduction } from '../../config/env.config';
import { REFRESH_TOKEN_TTL_SEC, ACCESS_TOKEN_TTL_SEC } from '../../config/jwt.config';
import {
  getCommissionDefault,
  getVendorAutoApprove,
  getSecurityConfig,
} from '../../services/settings.service';
import { REDIS_KEYS } from '../../config/tracking.config';
import { incr, cacheDel, getRedis } from '../../services/redis.service';
import { sendOtpEmail } from '../../services/email.service';
import { sendOtpSms } from '../../services/sms/sms.service';
import { enqueueEmail } from '../../jobs/queues';
import { writeAuditLog, writeActivityLog } from '../../services/audit.service';
import { D } from '../../utils/defaults';
import { addMinutes } from '../../utils/dates';
import { AUTH_USER_SELECT, AuthUserWithVendor, DeviceContext, TokenPair } from './auth.types';
import {
  channelForIdentifier,
  consumeVerificationFor,
  issueVerification,
  normaliseIdentifier,
} from './auth.verification';
import { EMAIL_REGEX, PHONE_REGEX } from '../../constants/countries';
import { SOCIAL_PROVIDER as PROVIDERS } from '../../constants/roles';

const INVALID_IDENTIFIER = (): AppError =>
  new AppError(
    ERROR.AUTH.INVALID_CREDENTIALS,
    HTTP_STATUS.BAD_REQUEST,
    ERROR_CODE.VALIDATION_ERROR,
  );

export const registerCustomer = async (
  input: any,
  device: DeviceContext,
  req?: any,
): Promise<{ user: AuthUserWithVendor; tokens: TokenPair }> => {
  const email = D.str(input.email).toLowerCase();
  const phone = D.str(input.phone);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    select: { id: true, email: true, phone: true },
  });

  const verified = await requireRegistrationProof({ email, phone }, D.str(input.verificationToken));

  if (existing?.email === email) {
    throw new AppError(ERROR.AUTH.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, ERROR_CODE.EMAIL_EXISTS);
  }
  if (phone && existing?.phone === phone) {
    throw new AppError(ERROR.AUTH.PHONE_EXISTS, HTTP_STATUS.CONFLICT, ERROR_CODE.PHONE_EXISTS);
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      name: D.str(input.name),
      email,
      phone,
      passwordHash,
      role: ROLES.CUSTOMER,
      isActive: true,
      isEmailVerified: verified.email,
      isPhoneVerified: verified.phone,
    },
    select: AUTH_USER_SELECT,
  });

  const tokens = await issueTokens(user.id, device);
  await linkDeviceToUser(user.id, device);

  void writeActivityLog({
    req,
    userId: user.id,
    action: 'REGISTER',
    entity: 'User',
    entityId: user.id,
    meta: { type: 'CUSTOMER' },
  });

  return { user, tokens };
};

export const registerVendor = async (
  input: any,
  device: DeviceContext,
  req?: any,
): Promise<{ user: AuthUserWithVendor; tokens: TokenPair }> => {
  const email = D.str(input.email).toLowerCase();
  const phone = D.str(input.phone);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    select: { id: true, email: true, phone: true },
  });

  const [autoApprove, defaultCommission] = await Promise.all([
    getVendorAutoApprove(),
    getCommissionDefault(),
  ]);

  const verified = await requireRegistrationProof({ email, phone }, D.str(input.verificationToken));

  if (existing?.email === email) {
    throw new AppError(ERROR.AUTH.EMAIL_EXISTS, HTTP_STATUS.CONFLICT, ERROR_CODE.EMAIL_EXISTS);
  }
  if (phone && existing?.phone === phone) {
    throw new AppError(ERROR.AUTH.PHONE_EXISTS, HTTP_STATUS.CONFLICT, ERROR_CODE.PHONE_EXISTS);
  }

  const slug = await uniqueVendorSlug(D.str(input.slug) || D.str(input.shopName));
  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: D.str(input.name),
        email,
        phone,
        passwordHash,
        role: ROLES.VENDOR,
        isActive: true,
        isEmailVerified: verified.email,
        isPhoneVerified: verified.phone,
      },
      select: AUTH_USER_SELECT,
    });

    await tx.vendorProfile.create({
      data: {
        userId: created.id,
        shopName: D.str(input.shopName),
        slug,
        description: D.str(input.description),
        gstNumber: D.str(input.gstNumber),
        panNumber: D.str(input.panNumber),
        bankHolderName: D.str(input.bankHolderName),
        bankAccountNo: D.str(input.bankAccountNo),
        bankIfsc: D.str(input.bankIfsc),
        upiId: D.str(input.upiId),
        commissionRate: Number(defaultCommission) || 0,
        status: autoApprove ? VENDOR_STATUS.APPROVED : VENDOR_STATUS.PENDING,
        approvedAt: autoApprove ? new Date() : null,
      },
    });

    return tx.user.findUniqueOrThrow({ where: { id: created.id }, select: AUTH_USER_SELECT });
  });

  const tokens = await issueTokens(user.id, device);
  await linkDeviceToUser(user.id, device);

  void writeAuditLog({
    req,
    actorId: user.id,
    actorRole: ROLES.VENDOR,
    action: 'CREATE' as any,
    entity: 'VendorProfile',
    entityId: user.vendorProfile?.id ?? '',
    description: `Vendor registered: ${D.str(input.shopName)}`,
    changes: { status: { from: null, to: autoApprove ? 'APPROVED' : 'PENDING' } },
  });

  void enqueueEmail({
    to: email,
    templateKey: autoApprove ? 'vendor_approved' : 'vendor_rejected',
    templateData: { shopName: D.str(input.shopName), status: autoApprove ? 'APPROVED' : 'PENDING' },
  });

  return { user, tokens };
};

export const issueTokens = async (userId: string, device: DeviceContext): Promise<TokenPair> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, vendorProfile: { select: { id: true } } },
  });

  if (!user) throw AppError.unauthorized(ERROR.AUTH.UNAUTHORIZED);

  const jti = sha256(`${userId}:${Date.now()}:${Math.random()}`);

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    vendorId: user.vendorProfile?.id ?? '',
    email: user.email,
    sessionKey: device.sessionKey,
    deviceId: device.deviceId,
  });

  const refreshToken = signRefreshToken({ sub: user.id, jti });

  const record = await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      deviceId: D.str(device.deviceId),
      ip: D.str(device.ip),
      userAgent: D.str(device.userAgent).slice(0, 400),
      expiresAt: addMinutes(Math.round(REFRESH_TOKEN_TTL_SEC / 60)),
    },
    select: { id: true },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    refreshTokenId: record.id,
  };
};

export const rotateRefreshToken = async (
  refreshToken: string,
  device: DeviceContext,
): Promise<{ user: AuthUserWithVendor; tokens: TokenPair }> => {
  const payload = verifyRefreshToken(refreshToken);

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw new AppError(
      ERROR.AUTH.SESSION_EXPIRED,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.SESSION_EXPIRED,
    );
  }

  if (record.userId !== payload.sub) {
    await revokeAllTokens(payload.sub);
    throw new AppError(
      ERROR.AUTH.SESSION_EXPIRED,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.SESSION_EXPIRED,
    );
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: AUTH_USER_SELECT,
  });

  if (!user || !user.isActive) {
    throw new AppError(ERROR.AUTH.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, ERROR_CODE.UNAUTHORIZED);
  }

  const tokens = await issueTokens(record.userId, device);
  await linkDeviceToUser(record.userId, device);

  return { user, tokens };
};

export const revokeRefreshToken = async (refreshToken: string): Promise<boolean> => {
  const result = await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
};

export const revokeAllTokens = async (userId: string, exceptId?: string): Promise<number> => {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return result.count;
};

export const linkDeviceToUser = async (userId: string, device: DeviceContext): Promise<void> => {
  if (!device.deviceId) return;
  try {
    await prisma.device.upsert({
      where: { deviceId: device.deviceId },
      create: {
        deviceId: device.deviceId,
        userId,
        platform: (device.platform ?? 'WEB') as any,
        ip: D.str(device.ip),
        appVersion: D.str(device.appVersion),
        lastSeenAt: new Date(),
      },
      update: { userId, lastSeenAt: new Date(), ip: D.str(device.ip) },
    });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[auth] device link failed');
  }
};

export interface LoginOutcome {
  user: AuthUserWithVendor;
  tokens: TokenPair;
  twoFactorRequired: boolean;
  twoFactorToken?: string;
}

export const loginWithPassword = async (
  input: { email?: string; phone?: string; password: string },
  device: DeviceContext,
  req?: any,
): Promise<LoginOutcome> => {
  const identifier = D.str(input.email || input.phone);
  const email = D.str(input.email).toLowerCase();

  const user = await prisma.user.findFirst({
    where: email ? { email } : { phone: identifier },
    select: {
      ...AUTH_USER_SELECT,
      passwordHash: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      twoFactorSecret: true,
      twoFactorBackupCodes: true,
    },
  });

  const invalid = new AppError(
    ERROR.AUTH.INVALID_CREDENTIALS,
    HTTP_STATUS.UNAUTHORIZED,
    ERROR_CODE.INVALID_CREDENTIALS,
  );

  if (!user || !user.passwordHash) throw invalid;

  const security = await getSecurityConfig();

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(ERROR.AUTH.ACCOUNT_LOCKED, HTTP_STATUS.FORBIDDEN, ERROR_CODE.ACCOUNT_LOCKED);
  }

  const matches = await comparePassword(input.password, user.passwordHash);
  if (!matches) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= security.maxAttempts;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock ? addMinutes(security.lockoutMinutes) : null,
      },
    });
    if (shouldLock) {
      void writeActivityLog({ req, userId: user.id, action: 'LOGIN_LOCKED', entity: 'User' });
      throw new AppError(
        ERROR.AUTH.ACCOUNT_LOCKED,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.ACCOUNT_LOCKED,
      );
    }
    throw invalid;
  }

  if (!user.isActive) {
    throw new AppError(
      ERROR.AUTH.ACCOUNT_SUSPENDED,
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODE.ACCOUNT_SUSPENDED,
    );
  }

  assertVerified(user);

  if (user.twoFactorEnabled && security.twoFactorEnabled) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    return {
      user,
      tokens: { accessToken: '', refreshToken: '', expiresIn: 0, refreshTokenId: '' },
      twoFactorRequired: true,
      twoFactorToken: signTwoFactorChallengeToken({
        sub: user.id,
        role: user.role,
        vendorId: user.vendorProfile?.id ?? '',
        email: user.email,
        sessionKey: device.sessionKey,
        deviceId: device.deviceId,
      }),
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const tokens = await issueTokens(user.id, device);
  await linkDeviceToUser(user.id, device);
  await cacheDel(REDIS_KEYS.LOGIN_ATTEMPTS(identifier));

  void writeActivityLog({
    req,
    userId: user.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: user.id,
    meta: { method: 'password' },
  });

  return { user, tokens, twoFactorRequired: false };
};

export const completeTwoFactorLogin = async (
  userId: string,
  otp: string,
  device: DeviceContext,
): Promise<LoginOutcome> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...AUTH_USER_SELECT, twoFactorSecret: true, twoFactorBackupCodes: true },
  });

  if (!user) throw AppError.unauthorized();
  if (!user.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_NOT_ENABLED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  const otpValid = verifyTotp(D.str(user.twoFactorSecret), D.str(otp));
  const backupCodes = user.twoFactorBackupCodes ?? [];
  const backupIndex = backupCodes.findIndex((code) => bcrypt.compareSync(otp, code));

  if (!otpValid && backupIndex < 0) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_INVALID,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  if (backupIndex >= 0) {
    const remaining = [...backupCodes];
    remaining.splice(backupIndex, 1);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorBackupCodes: remaining } });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  const tokens = await issueTokens(user.id, device);
  await linkDeviceToUser(user.id, device);

  return { user, tokens, twoFactorRequired: false };
};

const findUserByIdentifier = async (identifier: string) => {
  const isEmail = EMAIL_REGEX.test(identifier);
  return prisma.user.findFirst({
    where: isEmail ? { email: identifier } : { phone: identifier },
    select: AUTH_USER_SELECT,
  });
};

export interface OtpSendResult {
  expiresIn: number;
  identifier: string;
  channel: string;
  isNewUser: boolean;
}

const throttleError = (): AppError =>
  new AppError(
    ERROR.AUTH.OTP_RESEND_COOLDOWN,
    HTTP_STATUS.TOO_MANY_REQUESTS,
    ERROR_CODE.OTP_RESEND_COOLDOWN,
  );

const enforceSendCooldown = async (identifier: string, type: OtpType): Promise<void> => {
  const cooldownStart = new Date(Date.now() - OTP.RESEND_COOLDOWN_SEC * 1000);

  const recent = await prisma.otp.findFirst({
    where: { identifier, type: type as any, lastSentAt: { gt: cooldownStart } },
    select: { lastSentAt: true },
  });

  if (recent) throw throttleError();
};

export const sendOtp = async (
  input: { type: OtpType; channel: string; identifier: string },
  req?: any,
): Promise<OtpSendResult> => {
  const identifier = normaliseIdentifier(input.identifier);
  const type = input.type;

  const isEmail = EMAIL_REGEX.test(identifier);
  if (!isEmail && !PHONE_REGEX.test(identifier)) throw INVALID_IDENTIFIER();

  const account = await prisma.user.findFirst({
    where: isEmail ? { email: identifier } : { phone: identifier },
    select: { id: true, twoFactorEnabled: true },
  });

  if (OTP_TYPES_REQUIRING_ACCOUNT.includes(type) && !account) {
    throw new AppError(
      ERROR.AUTH.INVALID_CREDENTIALS,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.INVALID_CREDENTIALS,
    );
  }

  if (type === OTP_TYPE.TWO_FA && !account?.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_INVALID,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  const code = OTP.staticCode || randomNumericCode(OTP.LENGTH);
  const otpHash = await bcrypt.hash(code, OTP.BCRYPT_ROUNDS);
  const expiresAt = addMinutes(OTP.EXPIRY_MIN);

  await enforceSendCooldown(identifier, type);

  const effectiveChannel = channelForIdentifier(identifier);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const existingRow = await prisma.otp.findUnique({
    where: {
      identifier_type_channel: {
        identifier,
        type: type as any,
        channel: effectiveChannel as any,
      },
    },
    select: { id: true, sendDay: true, sendCount: true },
  });

  const sendsToday = existingRow?.sendDay === today ? existingRow.sendCount : 0;

  if (sendsToday + 1 > OTP.MAX_RESENDS_PER_DAY) throw throttleError();

  await prisma.otp.upsert({
    where: {
      identifier_type_channel: {
        identifier,
        type: type as any,
        channel: effectiveChannel as any,
      },
    },
    create: {
      identifier,
      type: type as any,
      channel: effectiveChannel as any,
      otpHash,
      expiresAt,
      attempts: 0,
      lastSentAt: now,
      sendDay: today,
      sendCount: 1,
    },
    update: {
      otpHash,
      expiresAt,
      attempts: 0,
      isVerified: false,
      verifiedAt: null,
      lastSentAt: now,
      sendDay: today,
      sendCount: sendsToday + 1,
    },
  });

  if (getRedis()) {
    const cooldownKey = REDIS_KEYS.OTP_RESEND(identifier, type);
    const cooldown = await incr(cooldownKey, OTP.RESEND_COOLDOWN_SEC);
    if (cooldown > 1) throw throttleError();

    const dailyKey = REDIS_KEYS.OTP_DAILY(identifier, today);
    const daily = await incr(dailyKey, 86400);
    if (daily > OTP.MAX_RESENDS_PER_DAY) throw throttleError();
  }

  if (!isProduction && isEmail) {
    logger.info({ identifier, type, code }, '[otp] dev code issued');
  }

  if (isEmail) {
    void sendOtpEmail(identifier, code, type).catch(() => undefined);
  } else if (ENV.OTP_SMS_ENABLED) {
    void sendOtpSms(identifier, code, ENV.APP_NAME).catch(() => undefined);
  } else {
    logger.warn(
      { identifier, type },
      '[otp] phone number but OTP_SMS_ENABLED=false — code was not delivered',
    );
  }

  void writeActivityLog({
    req,
    action: 'OTP_SENT',
    entity: 'Otp',
    meta: { type, channel: effectiveChannel },
  });

  return {
    expiresIn: OTP.EXPIRY_MIN * 60,
    identifier,
    channel: effectiveChannel,
    isNewUser: !account,
  };
};

export const sendRegistrationOtp = async (
  input: { identifier: string; channel?: string },
  req?: any,
): Promise<OtpSendResult> => {
  const identifier = normaliseIdentifier(input.identifier);

  const isEmail = EMAIL_REGEX.test(identifier);
  if (!isEmail && !PHONE_REGEX.test(identifier)) throw INVALID_IDENTIFIER();

  return sendOtp(
    { type: OTP_TYPE.REGISTER, channel: input.channel ?? OTP_CHANNEL.BOTH, identifier },
    req,
  );
};

export interface VerifiedOtp {
  verificationToken: string;
  expiresIn: number;
  identifier: string;
}

export const verifyRegistrationOtp = async (input: {
  identifier: string;
  otp: string;
  channel?: string;
}): Promise<VerifiedOtp> => {
  const identifier = normaliseIdentifier(input.identifier);

  await consumeOtp(identifier, OTP_TYPE.REGISTER, input.otp, input.channel);

  const issued = await issueVerification(
    VERIFICATION_PURPOSE.REGISTER,
    identifier,
    channelForIdentifier(identifier),
  );

  return { ...issued, identifier };
};

export const verifyLoginOtp = async (
  input: { identifier: string; otp: string; channel?: string },
  device: DeviceContext,
  req?: any,
): Promise<LoginOutcome> => {
  const identifier = normaliseIdentifier(input.identifier);

  await consumeOtp(identifier, OTP_TYPE.LOGIN, input.otp, input.channel);

  const user = await findUserByIdentifier(identifier);
  if (!user) {
    throw new AppError(
      ERROR.AUTH.INVALID_CREDENTIALS,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.INVALID_CREDENTIALS,
    );
  }
  if (!user.isActive) {
    throw new AppError(
      ERROR.AUTH.ACCOUNT_SUSPENDED,
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODE.ACCOUNT_SUSPENDED,
    );
  }

  assertVerified(user);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokens(user.id, device);
  await linkDeviceToUser(user.id, device);

  void writeActivityLog({
    req,
    userId: user.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: user.id,
    meta: { method: 'otp' },
  });

  return { user, tokens, twoFactorRequired: false };
};

export const consumeOtp = async (
  identifierRaw: string,
  type: OtpType,
  otp: string,
  channel?: string,
): Promise<boolean> => {
  const identifier = normaliseIdentifier(identifierRaw);
  const effectiveChannel =
    channel && channel !== OTP_CHANNEL.BOTH ? channel : channelForIdentifier(identifier);

  const invalid = new AppError(
    ERROR.AUTH.OTP_INVALID,
    HTTP_STATUS.UNAUTHORIZED,
    ERROR_CODE.OTP_INVALID,
  );

  const maxAttempts = new AppError(
    ERROR.AUTH.OTP_MAX_ATTEMPTS,
    HTTP_STATUS.TOO_MANY_REQUESTS,
    ERROR_CODE.OTP_MAX_ATTEMPTS,
  );

  const record = await prisma.otp.findFirst({
    where: {
      identifier,
      type: type as any,
      channel: effectiveChannel as any,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) throw invalid;
  if (record.isVerified) throw invalid;
  if (record.expiresAt < new Date()) throw invalid;

  if (record.attempts >= OTP.MAX_ATTEMPTS) {
    await prisma.otp.delete({ where: { id: record.id } }).catch(() => undefined);
    throw maxAttempts;
  }

  const matches = await bcrypt.compare(D.str(otp), record.otpHash);

  if (!matches) {
    const bumped = await prisma.otp.updateMany({
      where: { id: record.id, isVerified: false },
      data: { attempts: { increment: 1 } },
    });

    if (bumped.count === 0) throw invalid;
    if (record.attempts + 1 >= OTP.MAX_ATTEMPTS) throw maxAttempts;

    throw invalid;
  }

  const claimed = await prisma.otp.updateMany({
    where: { id: record.id, isVerified: false },
    data: { isVerified: true, verifiedAt: new Date() },
  });

  if (claimed.count === 0) throw invalid;

  return true;
};

const requireRegistrationProof = async (
  contacts: { email: string; phone: string },
  verificationToken: string,
): Promise<{ email: boolean; phone: boolean }> => {
  if (!isOtpEnforceable()) {
    logger.warn({ contacts }, '[auth] registering without OTP verification — OTP_REQUIRED is off');
    return { email: false, phone: false };
  }

  const proof = await consumeVerificationFor(verificationToken, VERIFICATION_PURPOSE.REGISTER, [
    contacts.email,
    contacts.phone,
  ]);

  const isEmail = EMAIL_REGEX.test(proof.identifier);

  return { email: isEmail, phone: !isEmail };
};

const assertVerified = (user: {
  email?: string;
  phone?: string;
  isEmailVerified?: boolean;
  isPhoneVerified?: boolean;
}): void => {
  if (!isOtpEnforceable()) return;
  if (user.isEmailVerified || user.isPhoneVerified) return;
  throw new AppError(
    ERROR.AUTH.ACCOUNT_UNVERIFIED,
    HTTP_STATUS.FORBIDDEN,
    ERROR_CODE.ACCOUNT_UNVERIFIED,
  );
};

export const resetPassword = async (input: {
  email?: string;
  phone?: string;
  otp: string;
  type?: OtpType;
  newPassword: string;
}): Promise<boolean> => {
  const identifier = normaliseIdentifier(D.str(input.email || input.phone));
  const type = input.type ?? OTP_TYPE.FORGOT_PASSWORD;

  await consumeOtp(identifier, type, input.otp);

  const isEmail = EMAIL_REGEX.test(identifier);
  const user = await prisma.user.findFirst({
    where: isEmail ? { email: identifier } : { phone: identifier },
    select: { id: true },
  });

  if (!user) {
    throw new AppError(
      ERROR.AUTH.INVALID_CREDENTIALS,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.INVALID_CREDENTIALS,
    );
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.otp.deleteMany({ where: { identifier, type: type as any } }),
  ]);

  return true;
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  logoutOtherDevices: boolean,
  otp?: string,
): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      email: true,
      phone: true,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });

  if (!user?.passwordHash) {
    throw new AppError(
      ERROR.AUTH.INVALID_CREDENTIALS,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.INVALID_CREDENTIALS,
    );
  }

  if (isOtpEnforceable() && (user.isEmailVerified || user.isPhoneVerified)) {
    const identifier = user.isEmailVerified ? user.email : user.phone;
    if (!otp) {
      throw new AppError(ERROR.AUTH.OTP_REQUIRED, HTTP_STATUS.UNAUTHORIZED, ERROR_CODE.OTP_INVALID);
    }
    await consumeOtp(identifier, OTP_TYPE.CHANGE_PASSWORD, otp);
  }

  const matches = await comparePassword(currentPassword, user.passwordHash);
  if (!matches) {
    throw new AppError(
      ERROR.AUTH.PASSWORD_MISMATCH,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  if (logoutOtherDevices) await revokeAllTokens(userId);

  return true;
};

export const verifyContact = async (
  userId: string,
  input: { email?: string; phone?: string; otp: string; channel?: string },
): Promise<{ emailVerified: boolean; phoneVerified: boolean }> => {
  const identifier = normaliseIdentifier(D.str(input.email || input.phone));
  const isEmail = EMAIL_REGEX.test(identifier);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, phone: true, isEmailVerified: true, isPhoneVerified: true },
  });

  if (!user) throw AppError.unauthorized();

  const owned = normaliseIdentifier(isEmail ? user.email : user.phone);
  if (!owned || owned !== identifier) {
    throw new AppError(
      ERROR.AUTH.CONTACT_MISMATCH,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  const type = isEmail ? OTP_TYPE.EMAIL_VERIFY : OTP_TYPE.PHONE_VERIFY;
  await consumeOtp(identifier, type, input.otp, input.channel);

  await prisma.user.update({
    where: { id: userId },
    data: isEmail ? { isEmailVerified: true } : { isPhoneVerified: true },
  });

  return {
    emailVerified: isEmail || user.isEmailVerified,
    phoneVerified: !isEmail || user.isPhoneVerified,
  };
};

export const enableTwoFactor = async (
  userId: string,
): Promise<{
  qrCodeUrl: string;
  otpauthUrl: string;
  manualEntryKey: string;
  backupCodes: string[];
}> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, twoFactorEnabled: true },
  });

  if (!user) throw AppError.unauthorized();

  if (user.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_ALREADY_ENABLED,
      HTTP_STATUS.CONFLICT,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  const secret = generateTotpSecret();
  const backupCodes = generateBackupCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorSecret: secret,
      twoFactorEnabled: true,
      twoFactorBackupCodes: await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10))),
    },
  });

  const otpauthUrl = buildOtpAuthUri(secret, user.email || user.id);
  const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

  return { qrCodeUrl, otpauthUrl, manualEntryKey: secret, backupCodes };
};

export const disableTwoFactor = async (userId: string, otp: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });

  if (!user?.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_NOT_ENABLED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  if (!verifyTotp(D.str(user.twoFactorSecret), D.str(otp))) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_INVALID,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [] },
  });

  return true;
};

export const verifyTwoFactor = async (
  identifier: string,
  otp: string,
  device: DeviceContext,
): Promise<LoginOutcome> => {
  const normalised = normaliseIdentifier(identifier);
  const isEmail = EMAIL_REGEX.test(normalised);

  const user = await prisma.user.findFirst({
    where: isEmail ? { email: normalised } : { phone: normalised },
    select: { ...AUTH_USER_SELECT, twoFactorSecret: true, twoFactorBackupCodes: true },
  });

  if (!user?.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_INVALID,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.TWO_FA_INVALID,
    );
  }

  return completeTwoFactorLogin(user.id, otp, device);
};

const verifySocialToken = async (
  provider: string,
  idToken: string,
): Promise<{ providerId: string; email: string; name: string }> => {
  const unsupported = new AppError(
    ERROR.AUTH.SOCIAL_PROVIDER_INVALID,
    HTTP_STATUS.UNAUTHORIZED,
    ERROR_CODE.SOCIAL_PROVIDER_INVALID,
  );

  const endpoints: Record<string, string> = {
    [PROVIDERS.GOOGLE]: 'https://oauth2.googleapis.com/tokeninfo?id_token=',
    [PROVIDERS.APPLE]: 'https://appleid.apple.com/auth/keys',
    [PROVIDERS.FACEBOOK]: 'https://graph.facebook.com/me?fields=id,name,email&access_token=',
  };

  if (!endpoints[provider]) throw unsupported;

  try {
    const response = await fetch(`${endpoints[provider]}${encodeURIComponent(idToken)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw unsupported;

    const data: any = await response.json();
    const providerId = D.str(data.sub || data.id);
    const email = D.str(data.email).toLowerCase();
    if (!providerId) throw unsupported;

    return { providerId, email, name: D.str(data.name) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unsupported;
  }
};

export const socialLogin = async (
  input: { provider: string; idToken: string; accessToken?: string },
  device: DeviceContext,
): Promise<{ user: AuthUserWithVendor; tokens: TokenPair; isNewUser: boolean }> => {
  const profile = await verifySocialToken(input.provider, D.str(input.idToken));

  const linked = await prisma.socialAccount.findFirst({
    where: { provider: input.provider as any, providerId: profile.providerId },
    select: { userId: true },
  });

  if (linked) {
    const user = await prisma.user.findUnique({
      where: { id: linked.userId },
      select: AUTH_USER_SELECT,
    });
    if (!user) throw AppError.unauthorized();
    if (!user.isActive) {
      throw new AppError(
        ERROR.AUTH.ACCOUNT_SUSPENDED,
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODE.ACCOUNT_SUSPENDED,
      );
    }
    const tokens = await issueTokens(user.id, device);
    await linkDeviceToUser(user.id, device);
    return { user, tokens, isNewUser: false };
  }

  const byEmail = profile.email
    ? await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })
    : null;

  let userId = byEmail?.id;

  if (!userId) {
    const created = await prisma.user.create({
      data: {
        name: D.str(profile.name) || 'User',
        email: profile.email || `social_${profile.providerId}@placeholder.local`,
        role: ROLES.CUSTOMER,
        isActive: true,
        isEmailVerified: Boolean(profile.email),
      },
      select: AUTH_USER_SELECT,
    });
    userId = created.id;
  }

  await prisma.socialAccount.upsert({
    where: {
      provider_providerId: { provider: input.provider as any, providerId: profile.providerId },
    },
    create: {
      userId,
      provider: input.provider as any,
      providerId: profile.providerId,
      email: profile.email,
    },
    update: { userId },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: AUTH_USER_SELECT,
  });

  if (!user.isActive) {
    throw new AppError(
      ERROR.AUTH.ACCOUNT_SUSPENDED,
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODE.ACCOUNT_SUSPENDED,
    );
  }
  assertVerified(user);

  const tokens = await issueTokens(userId, device);
  await linkDeviceToUser(userId, device);

  return { user, tokens, isNewUser: !byEmail };
};

export const linkSocial = async (userId: string, input: { provider: string; idToken: string }) => {
  const profile = await verifySocialToken(input.provider, D.str(input.idToken));

  const existing = await prisma.socialAccount.findFirst({
    where: { provider: input.provider as any, providerId: profile.providerId },
    select: { userId: true },
  });

  if (existing && existing.userId !== userId) {
    throw new AppError(
      ERROR.AUTH.SOCIAL_ALREADY_LINKED,
      HTTP_STATUS.CONFLICT,
      ERROR_CODE.DUPLICATE,
    );
  }

  return prisma.socialAccount.upsert({
    where: {
      provider_providerId: { provider: input.provider as any, providerId: profile.providerId },
    },
    create: {
      userId,
      provider: input.provider as any,
      providerId: profile.providerId,
      email: profile.email,
    },
    update: {},
  });
};

export const unlinkSocial = async (userId: string, provider: string): Promise<boolean> => {
  const result = await prisma.socialAccount.deleteMany({
    where: { userId, provider: provider as any },
  });
  if (result.count === 0) {
    throw new AppError(ERROR.AUTH.SOCIAL_NOT_LINKED, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
  return true;
};

export const checkAvailability = async (input: {
  email?: string;
  phone?: string;
}): Promise<{ email: string; phone: string; emailExists: boolean; phoneExists: boolean }> => {
  const email = D.str(input.email).toLowerCase();
  const phone = D.str(input.phone);

  const [byEmail, byPhone] = await Promise.all([
    email ? prisma.user.findUnique({ where: { email }, select: { id: true } }) : null,
    phone ? prisma.user.findFirst({ where: { phone }, select: { id: true } }) : null,
  ]);

  return { email, phone, emailExists: Boolean(byEmail), phoneExists: Boolean(byPhone) };
};

export const logout = async (userId: string, refreshToken: string): Promise<boolean> => {
  await revokeRefreshToken(refreshToken);
  void writeActivityLog({ action: 'LOGOUT', entity: 'User', entityId: userId });
  return true;
};

export const logoutAllDevices = async (userId: string): Promise<number> => {
  const revoked = await revokeAllTokens(userId);
  await prisma.session.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false, endedAt: new Date() },
  });
  await prisma.device.updateMany({ where: { userId }, data: { isTrusted: false } });
  void writeActivityLog({
    action: 'LOGOUT',
    entity: 'User',
    entityId: userId,
    meta: { allDevices: true },
  });
  return revoked;
};

export const listSessions = async (userId: string, currentSessionKey: string): Promise<any[]> => {
  return prisma.session
    .findMany({
      where: { userId, isActive: true },
      orderBy: { lastSeenAt: 'desc' },
      take: 50,
      select: {
        id: true,
        sessionKey: true,
        deviceId: true,
        platform: true,
        ip: true,
        userAgent: true,
        geo: true,
        startedAt: true,
        lastSeenAt: true,
        endedAt: true,
        isActive: true,
      },
    })
    .then((rows) => rows.map((r) => ({ ...r, isCurrent: r.sessionKey === currentSessionKey })));
};

export const revokeSession = async (userId: string, sessionKey: string): Promise<boolean> => {
  const result = await prisma.session.updateMany({
    where: { userId, sessionKey, isActive: true },
    data: { isActive: false, endedAt: new Date() },
  });

  if (result.count === 0) {
    throw new AppError(ERROR.COMMON.NOT_FOUND, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  return true;
};

export const getCurrentUser = async (userId: string): Promise<any | null> =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { ...AUTH_USER_SELECT, socialAccounts: { select: { id: true, provider: true } } },
  });
