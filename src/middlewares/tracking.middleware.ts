import type { RequestHandler } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  parseUserAgent,
  resolveDeviceId,
  resolvePlatform,
  ParsedDevice,
} from '../utils/deviceParser';
import { lookupGeo, parseUtm, resolveIp } from '../utils/geo';
import { prisma } from '../services/prisma.service';
import { getRedis, cacheGet, cacheSet } from '../services/redis.service';
import { REDIS_KEYS, TRACKING } from '../config/tracking.config';
import { APP } from '../config/app.config';
import { ENV } from '../config/env.config';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ERROR } from '../messages/error';
import { AppError } from '../utils/AppError';

export const tracking: RequestHandler = asyncHandler(async (req, res, next) => {
  const userAgent = String(req.headers['user-agent'] ?? '');
  const parsed: ParsedDevice = parseUserAgent(userAgent);
  const ip = resolveIp(req);

  Object.defineProperty(req, 'ip', { value: ip, writable: true, configurable: true });
  req.deviceId = resolveDeviceId(req);
  req.device = {
    platform: resolvePlatform(req, parsed),
    os: parsed.os,
    osVersion: parsed.osVersion,
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    model: parsed.model,
    manufacturer: parsed.manufacturer,
    isBot: parsed.isBot,
    userAgent,
  };

  req.geo = ENV.GEO_LOOKUP_ENABLED ? lookupGeo(ip) : undefined;
  req.utm = parseUtm(req.query);

  if (!ENV.TRACKING_ENABLED) return next();

  const probePath = String(req.originalUrl ?? '').split('?')[0];
  if (probePath === `${APP.API_PREFIX}/health` || probePath === `${APP.API_PREFIX}/version`) {
    return next();
  }

  try {
    const device = await prisma.device.findUnique({
      where: { deviceId: req.deviceId },
      select: { id: true, isBlocked: true, userId: true },
    });

    if (device?.isBlocked) {
      throw new AppError(ERROR.AUTH.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN, ERROR_CODE.DEVICE_BLOCKED);
    }

    void prisma.device
      .updateMany({ where: { deviceId: req.deviceId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    /* device lookup failure must not break the request */
  }

  try {
    req.sessionKey = await resolveSessionKey(req, parsed, ip);
  } catch {
    /* session resolution is best effort */
  }

  next();
});

const resolveSessionKey = async (req: any, parsed: ParsedDevice, ip: string): Promise<string> => {
  const redis = getRedis();
  const fromHeader = String(req.headers?.['x-session-id'] ?? '');
  const fromDevice = req.deviceId ?? '';

  if (redis && fromHeader) {
    const key = REDIS_KEYS.SESSION(fromHeader);
    const cached = await cacheGet<{ sessionId: string }>(key);
    if (cached?.sessionId) return cached.sessionId;
  }

  const timeoutMin = TRACKING.SESSION_TIMEOUT_MIN;
  const since = new Date(Date.now() - timeoutMin * 60_000);

  const existing = await prisma.session.findFirst({
    where: {
      isActive: true,
      lastSeenAt: { gte: since },
      deviceId: fromDevice,
      ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });

  if (existing) {
    void prisma.session.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), ...(req.auth?.userId ? { userId: req.auth.userId } : {}) },
    });
    if (redis && fromHeader) {
      await cacheSet(
        REDIS_KEYS.SESSION(fromHeader),
        { sessionId: existing.id },
        TRACKING.SESSION_TIMEOUT_MIN * 60,
      );
    }
    return existing.id;
  }

  const created = await prisma.session.create({
    data: {
      sessionKey: fromHeader || fromDevice || `s_${ip}`,
      userId: req.auth?.userId || null,
      deviceId: fromDevice,
      ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
      platform: (req.device?.platform ?? 'WEB') as any,
      geo: (req.geo ?? {}) as any,
      startedAt: new Date(),
      lastSeenAt: new Date(),
      isActive: true,
    },
    select: { id: true },
  });

  if (redis && fromHeader) {
    await cacheSet(
      REDIS_KEYS.SESSION(fromHeader),
      { sessionId: created.id },
      TRACKING.SESSION_TIMEOUT_MIN * 60,
    );
  }

  return created.id;
};

export const endSession = async (sessionId: string): Promise<boolean> => {
  const updated = await prisma.session.updateMany({
    where: { id: sessionId, isActive: true },
    data: { isActive: false, endedAt: new Date() },
  });
  return updated.count > 0;
};

export const getOrCreateSession = async (req: any): Promise<string> =>
  req.sessionKey ??
  (await resolveSessionKey(
    req,
    parseUserAgent(String(req.headers['user-agent'] ?? '')),
    req.ip ?? '',
  ));
