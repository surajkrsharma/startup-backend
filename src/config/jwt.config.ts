import { ENV, isProduction } from './env.config';

export const JWT = {
  ACCESS_EXPIRY: ENV.JWT_ACCESS_EXPIRY,
  REFRESH_EXPIRY: ENV.JWT_REFRESH_EXPIRY,
  ACCESS_SECRET: ENV.JWT_ACCESS_SECRET,
  REFRESH_SECRET: ENV.JWT_REFRESH_SECRET,
  ISSUER: `${ENV.APP_NAME}-api`,
  AUDIENCE: `${ENV.APP_NAME}-clients`,
  REFRESH_COOKIE_NAME: 'refreshToken',
  REFRESH_COOKIE_OPTIONS: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth',
  },
} as const;

/** Access token lifetime in seconds — surfaced as `expiresIn` in responses. */
export const ACCESS_TOKEN_TTL_SEC = (() => {
  const raw = ENV.JWT_ACCESS_EXPIRY;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return value * multiplier;
})();

export const REFRESH_TOKEN_TTL_SEC = (() => {
  const raw = ENV.JWT_REFRESH_EXPIRY;
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 604800;
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return value * multiplier;
})();

export const TWO_FA = {
  ISSUER: ENV.APP_NAME,
  STEP: 30,
  WINDOW: 1,
  BACKUP_CODE_COUNT: 10,
  TOTP_DIGITS: 6,
};

export const API_KEY = {
  HEADER: 'x-api-key',
  PREFIX_LENGTH: 8,
};
