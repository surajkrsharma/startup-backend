import type { Request, RequestHandler, Response } from 'express';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis, cacheDel, incr } from '../services/redis.service';
import { ENV } from '../config/env.config';
import {
  RATE_LIMIT,
  REDIS_RATE_LIMIT_PREFIX,
  LOGIN_ATTEMPT,
  RateLimitPreset,
} from '../config/rateLimit.config';
import { REDIS_KEYS } from '../config/tracking.config';
import { ApiResponse } from '../utils/ApiResponse';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';

/**
 * IPv6-safe key normalisation. A raw `::ffff:1.2.3.4` and a plain IPv6 address must
 * not share a bucket, and IPv6 /64 subnets are grouped by prefix.
 */
const normaliseIp = (ip: string): string => {
  if (!ip) return 'unknown';
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (clean.includes(':')) return clean.split(':').slice(0, 4).join(':');
  return clean;
};

const handlerFor = (req: Request, res: Response): void => {
  ApiResponse.error(res, {
    statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
    message: ERROR.COMMON.RATE_LIMITED,
    code: ERROR_CODE.RATE_LIMITED,
  });
};

const buildKey = (scope: string) => (req: Request) => {
  const identifier = req.auth?.userId || req.deviceId || normaliseIp(req.ip ?? '');
  return `${REDIS_RATE_LIMIT_PREFIX}${scope}:${identifier}`;
};

/** Redis-backed store so counters survive a restart / scale-out. */
const buildStore = (scope: string) => {
  const client = getRedis();
  if (!client) return undefined; // fall back to the in-memory store
  return new RedisStore({
    sendCommand: (...args: string[]) =>
      (client as any).call(...(args as [string, ...string[]])) as Promise<any>,
    prefix: `${ENV.REDIS_PREFIX}:${REDIS_RATE_LIMIT_PREFIX}${scope}:`,
  });
};

const limiterCache = new Map<string, RateLimitRequestHandler>();

/**
 * Named rate limiter. Counts live in Redis when available and in process memory
 * otherwise, so a Redis outage degrades instead of failing requests.
 */
export const rateLimitBy = (preset: RateLimitPreset | string): RequestHandler => {
  const cached = limiterCache.get(preset);
  if (cached) return cached;

  const config =
    (RATE_LIMIT as Record<string, { WINDOW_MS: number; MAX: number }>)[preset] ?? RATE_LIMIT.GLOBAL;

  const handler = rateLimit({
    windowMs: config.WINDOW_MS,
    limit: config.MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: buildKey(preset),
    store: ENV.RATE_LIMIT_ENABLED ? buildStore(preset) : undefined,
    handler: handlerFor,
    skip: () => !ENV.RATE_LIMIT_ENABLED,
  });

  limiterCache.set(preset, handler);
  return handler;
};

export const globalRateLimit = rateLimitBy('GLOBAL');
export const authRateLimit = rateLimitBy('AUTH_LOGIN');
export const registerRateLimit = rateLimitBy('AUTH_REGISTER');
export const forgotPasswordRateLimit = rateLimitBy('FORGOT_PASSWORD');
export const otpSendRateLimit = rateLimitBy('OTP_SEND');
export const otpVerifyRateLimit = rateLimitBy('OTP_VERIFY');
export const uploadRateLimit = rateLimitBy('UPLOAD');
export const searchRateLimit = rateLimitBy('SEARCH');
export const trackingRateLimit = rateLimitBy('TRACKING');
export const analyticsRateLimit = rateLimitBy('ANALYTICS');
export const paymentRateLimit = rateLimitBy('PAYMENT');
export const exportRateLimit = rateLimitBy('EXPORT');
export const passwordResetRateLimit = rateLimitBy('PASSWORD_RESET');
export const twoFactorRateLimit = rateLimitBy('ENABLE_2FA');
export const socialLoginRateLimit = rateLimitBy('SOCIAL_LOGIN');

/** Per-user failed-login counter, Redis backed, layered on top of the IP limiter. */
export const loginGuard = async (
  identifier: string,
): Promise<{ locked: boolean; remaining: number }> => {
  const key = REDIS_KEYS.LOGIN_ATTEMPTS(identifier.toLowerCase());
  const attempts = await incr(key, LOGIN_ATTEMPT.WINDOW_MINUTES * 60);
  return {
    locked: attempts >= LOGIN_ATTEMPT.MAX_ATTEMPTS,
    remaining: Math.max(0, LOGIN_ATTEMPT.MAX_ATTEMPTS - attempts),
  };
};

export const clearLoginAttempts = async (identifier: string): Promise<void> => {
  await cacheDel(REDIS_KEYS.LOGIN_ATTEMPTS(identifier.toLowerCase()));
};

export { normaliseIp as normaliseRateLimitIp };
