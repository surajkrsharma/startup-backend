import { D } from '../../utils/defaults';
import { ACCESS_TOKEN_TTL_SEC } from '../../config/jwt.config';
import { OTP } from '../../config/otp.config';
import { AuthUserWithVendor } from './auth.types';

/**
 * Auth serializers.
 * Key order: singles -> objects -> arrays. No nulls anywhere.
 */
export const serializeAuthUser = (u: any): Record<string, any> => ({
  userId: D.str(u?.id),
  name: D.str(u?.name),
  email: D.str(u?.email),
  phone: D.str(u?.phone),
  avatarUrl: D.str(u?.avatarUrl),
  role: D.str(u?.role),
  isActive: D.bool(u?.isActive),
  isEmailVerified: D.bool(u?.isEmailVerified),
  isPhoneVerified: D.bool(u?.isPhoneVerified),
  isTwoFactorEnabled: D.bool(u?.twoFactorEnabled),
  lastLoginAt: D.date(u?.lastLoginAt),
  createdAt: D.date(u?.createdAt),

  rolesList: u?.role ? [D.str(u.role)] : [],
});

export const serializeVendorLite = (v: any): Record<string, any> => ({
  vendorId: D.str(v?.id),
  shopName: D.str(v?.shopName),
  slug: D.str(v?.slug),
  status: D.str(v?.status),
  commissionRate: D.float(v?.commissionRate),
});

/**
 * Login / register / refresh response shape.
 * Note the 2FA case: when `twoFactorRequired` is true no tokens are issued.
 */
export const serializeSession = (
  user: AuthUserWithVendor | any,
  tokens?: { accessToken: string; expiresIn?: number },
  options: { twoFactorRequired?: boolean; twoFactorQr?: string } = {},
): Record<string, any> => {
  const base: Record<string, any> = {
    accessToken: D.str(tokens?.accessToken),
    expiresIn: D.num(tokens?.expiresIn ?? ACCESS_TOKEN_TTL_SEC),
    twoFactorRequired: D.bool(options.twoFactorRequired),
    userData: serializeAuthUser(user),
    rolesList: user?.role ? [D.str(user.role)] : [],
  };

  if (user?.vendorProfile) {
    base.vendorData = {
      ...serializeVendorLite(user.vendorProfile),
      logo: D.str(user.vendorProfile.logo ?? user.vendorProfile.shopLogo),
    };
  }

  if (options.twoFactorQr) {
    base.twoFactorData = {
      qrCodeUrl: D.str(options.twoFactorQr),
      manualEntryKey: D.str(user?.twoFactorSecret),
    };
  }

  return base;
};

export const serializeOtpResponse = (input: {
  expiresIn: number;
  identifier: string;
  channel: string;
  isNewUser?: boolean;
}): Record<string, any> => ({
  identifier: D.str(input.identifier),
  channel: D.str(input.channel),
  expiresIn: D.num(input.expiresIn),
  otpLength: OTP.LENGTH,
  isNewUser: D.bool(input.isNewUser),
});

export const serializeSessionDevice = (s: any): Record<string, any> => ({
  sessionId: D.str(s?.sessionKey || s?.id),
  recordId: D.str(s?.id),
  deviceId: D.str(s?.deviceId),
  platform: D.str(s?.platform),
  ip: D.str(s?.ip),
  userAgent: D.str(s?.userAgent),
  geo: D.obj(s?.geo),
  startedAt: D.date(s?.startedAt),
  lastSeenAt: D.date(s?.lastSeenAt),
  endedAt: D.date(s?.endedAt),
  isActive: D.bool(s?.isActive),
  isCurrent: D.bool(s?.isCurrent),
});

export const serializeTwoFactor = (input: {
  isEnabled: boolean;
  qrCodeUrl?: string;
  backupCodes?: string[];
  otpauthUrl?: string;
}): Record<string, any> => ({
  isEnabled: D.bool(input.isEnabled),
  qrCodeUrl: D.str(input.qrCodeUrl),
  otpauthUrl: D.str(input.otpauthUrl),
  backupCodes: D.strArr(input.backupCodes),
});

export const serializeAvailability = (input: {
  email: string;
  phone: string;
  emailExists: boolean;
  phoneExists: boolean;
  isAvailable: boolean;
}): Record<string, any> => ({
  email: D.str(input.email),
  phone: D.str(input.phone),
  emailExists: D.bool(input.emailExists),
  phoneExists: D.bool(input.phoneExists),
  isAvailable: D.bool(input.isAvailable),
});
