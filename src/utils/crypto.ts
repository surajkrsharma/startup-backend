import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { PASSWORD } from '../config/password.config';
import { JWT, TWO_FA } from '../config/jwt.config';
import { AppError } from './AppError';
import { ERROR } from '../messages/error';
import { ERROR_CODE } from '../constants/http';

export const hashPassword = async (plain: string): Promise<string> =>
  bcrypt.hash(plain, PASSWORD.BCRYPT_ROUNDS);

export const comparePassword = async (plain: string, hash: string): Promise<boolean> => {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
};

export const randomString = (length = 32): string =>
  crypto
    .randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);

export const randomNumericCode = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(0, 10).toString();
  return out;
};

export const sha256 = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (value: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(value).digest('hex');

export const safeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export type AccessTokenPurpose = 'session' | 'two_factor';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  vendorId: string;
  email: string;
  sessionKey: string;
  deviceId: string;
  type: 'access';
  purpose: AccessTokenPurpose;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export const signAccessToken = (
  payload: Omit<AccessTokenPayload, 'type' | 'purpose'> & { purpose?: AccessTokenPurpose },
): string =>
  jwt.sign(
    { ...payload, type: 'access', purpose: payload.purpose ?? 'session' },
    JWT.ACCESS_SECRET,
    {
      expiresIn: JWT.ACCESS_EXPIRY,
      issuer: JWT.ISSUER,
      audience: JWT.AUDIENCE,
    } as SignOptions,
  );

export const signTwoFactorChallengeToken = (
  payload: Omit<AccessTokenPayload, 'type' | 'purpose'>,
): string => signAccessToken({ ...payload, purpose: 'two_factor' });

export const isSessionToken = (payload: { purpose?: string }): boolean =>
  !payload.purpose || payload.purpose === 'session';

export const signRefreshToken = (payload: Omit<RefreshTokenPayload, 'type'>): string =>
  jwt.sign({ ...payload, type: 'refresh' }, JWT.REFRESH_SECRET, {
    expiresIn: JWT.REFRESH_EXPIRY,
    issuer: JWT.ISSUER,
    audience: JWT.AUDIENCE,
  } as SignOptions);

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, JWT.ACCESS_SECRET, {
      issuer: JWT.ISSUER,
      audience: JWT.AUDIENCE,
    }) as AccessTokenPayload;
    if (decoded.type !== 'access') throw new Error(ERROR.SYSTEM.TOKEN_TYPE_MISMATCH);
    return decoded;
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      throw new AppError(ERROR.AUTH.TOKEN_EXPIRED, 401, ERROR_CODE.TOKEN_EXPIRED);
    }
    throw new AppError(ERROR.AUTH.UNAUTHORIZED, 401, ERROR_CODE.UNAUTHORIZED);
  }
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, JWT.REFRESH_SECRET, {
      issuer: JWT.ISSUER,
      audience: JWT.AUDIENCE,
    }) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') throw new Error(ERROR.SYSTEM.TOKEN_TYPE_MISMATCH);
    return decoded;
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      throw new AppError(ERROR.AUTH.SESSION_EXPIRED, 401, ERROR_CODE.SESSION_EXPIRED);
    }
    throw new AppError(ERROR.AUTH.MISSING_REFRESH_TOKEN, 401, ERROR_CODE.SESSION_EXPIRED);
  }
};

export const generateTotpSecret = (): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(TWO_FA.BACKUP_CODE_COUNT * 2);
  let out = '';
  for (let i = 0; i < TWO_FA.BACKUP_CODE_COUNT * 2; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const base32Decode = (input: string): Buffer => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
};

export const generateTotp = (secret: string, atMs: number = Date.now()): string => {
  const counter = Math.floor(atMs / 1000 / TWO_FA.STEP);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** TWO_FA.TOTP_DIGITS).toString().padStart(TWO_FA.TOTP_DIGITS, '0');
};

export const verifyTotp = (secret: string, token: string): boolean => {
  if (!secret || !token) return false;
  for (let drift = -TWO_FA.WINDOW; drift <= TWO_FA.WINDOW; drift += 1) {
    if (safeCompare(generateTotp(secret, Date.now() + drift * TWO_FA.STEP * 1000), token))
      return true;
  }
  return false;
};

export const buildOtpAuthUri = (secret: string, account: string): string => {
  const label = encodeURIComponent(`${TWO_FA.ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(TWO_FA.ISSUER)}&algorithm=SHA1&digits=${TWO_FA.TOTP_DIGITS}&period=${TWO_FA.STEP}`;
};

export const generateBackupCodes = (count = TWO_FA.BACKUP_CODE_COUNT): string[] =>
  Array.from({ length: count }, () => randomNumericCode(8));

export const verifyGatewaySignature = (
  body: string,
  signature: string,
  secret: string,
): boolean => {
  if (!body || !signature || !secret) return false;
  return safeCompare(hmacSha256(body, secret), signature);
};

export const maskValue = (value: string, visible = 4): string => {
  if (!value) return '';
  if (value.length <= visible) return '****';
  return `${'*'.repeat(value.length - visible)}${value.slice(-visible)}`;
};
