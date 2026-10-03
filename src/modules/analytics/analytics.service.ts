import { Prisma } from '@prisma/client';
import { PAYMENT_STATUS, VENDOR_STATUS, PRODUCT_STATUS } from '../../constants/roles';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';

import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { Platform } from '@prisma/client';
import { assertAllowedEvent } from '../../services/notification.service';
import { uniqueFunnelSlug } from '../../utils/slug';
import { startOfDay, endOfDay, subtractDays, toDayKey } from '../../utils/dates';
import {
  uploadToCloudinary,
  deleteFromCloudinary,
  createSignedUploadParams,
  isStorageConfigured,
} from '../../services/cloudinary.service';
import { writeActivityLog } from '../../services/audit.service';
import { METRIC, ANALYTICS } from '../../config/analytics.config';

/**
 * Behaviour tracking, analytics, funnels, search and uploads.
 *
 * Aggregates are computed from the raw event tables on demand rather than from
 * pre-rolled buckets, so a new filter never reports stale numbers. That is the
 * right trade here because the read volume is far below the write volume.
 */

// ═══ Tracking ════════════════════════════════════════════════════════════════

/**
 * Every write below lands in the raw tables rather than a pre-aggregated bucket, because
 * the rollup job reads from here and a lossy write here is unrecoverable.
 */
const sessionKeyOf = (input: Record<string, any>, req?: any): string =>
  D.str(req?.sessionKey ?? input.sessionKey);

/**
 * Starts or resumes a session.
 *
 * The tracking middleware already creates a session row per request, so this endpoint only
 * fills in the first-touch context a client knows better than the server: referrer and UTM.
 */
export const startSession = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const sessionKey = sessionKeyOf(input, req);
  if (!sessionKey) throw AppError.badRequest(ERROR.ANALYTICS.INVALID_RANGE);

  const row = await prisma.session.upsert({
    where: { sessionKey },
    create: {
      sessionKey,
      userId: D.str(req?.auth?.userId) || null,
      deviceId: D.str(req?.deviceId),
      ip: D.str(req?.ip),
      userAgent: D.str(req?.headers?.['user-agent']),
      platform: (D.str(req?.platform) || 'WEB') as Platform,
      geo: (req?.geo ?? {}) as Prisma.InputJsonValue,
    },
    update: { lastSeenAt: new Date(), isActive: true },
  });

  if (D.str(input.referrer) || D.arr(input.utm).length || Object.keys(D.obj(input.utm)).length) {
    await prisma.visitorLog.create({
      data: {
        sessionKey,
        sessionId: row.id,
        deviceId: D.str(req?.deviceId),
        userId: D.str(req?.auth?.userId) || null,
        eventType: 'session_start',
        eventName: 'session_start',
        pageUrl: D.str(input.pageUrl),
        referrer: D.str(input.referrer ?? req?.referrer),
        utm: (input.utm ?? {}) as Prisma.InputJsonValue,
        geo: (req?.geo ?? {}) as Prisma.InputJsonValue,
        platform: (D.str(req?.platform) || 'WEB') as Platform,
        isBot: D.bool(req?.isBot),
        ip: D.str(req?.ip),
      },
    });
  }

  return {
    sessionKey,
    sessionId: D.str(row.id),
    isActive: D.bool(row.isActive),
    startedAt: D.date(row.startedAt),
  };
};

export const endSession = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const sessionKey = sessionKeyOf(input, req);
  if (!sessionKey) return { sessionKey: '', endedAt: D.date(new Date()) };

  const existing = await prisma.session.findUnique({
    where: { sessionKey },
    select: { id: true, startedAt: true },
  });

  const endedAt = new Date();
  const durationSec =
    D.num(input.durationSec) ||
    (existing
      ? Math.round((endedAt.getTime() - new Date(existing.startedAt).getTime()) / 1000)
      : 0);

  await prisma.session.updateMany({
    where: { sessionKey },
    data: { endedAt, lastSeenAt: endedAt, isActive: false },
  });

  return {
    sessionKey,
    sessionId: D.str(existing?.id),
    durationSec,
    endedAt: D.date(endedAt),
  };
};

/** Writes a raw event that is not part of the curated `TRACKING.ALLOWED_EVENTS` vocabulary. */
const recordMetricEvent = async (
  metric: string,
  meta: Record<string, any>,
  req?: any,
): Promise<{ eventId: string; sessionKey: string }> => {
  const sessionKey = sessionKeyOf(meta, req);

  const row = await prisma.event.create({
    data: {
      name: metric,
      sessionKey,
      deviceId: D.str(req?.deviceId),
      userId: D.str(req?.auth?.userId),
      meta: meta as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { eventId: D.str(row.id), sessionKey };
};

export const trackPerformance = async (input: Record<string, any>, req?: any) =>
  recordMetricEvent(
    METRIC.EVENT,
    {
      kind: 'performance',
      metric: D.str(input.metric),
      value: D.float(input.value),
      unit: D.str(input.unit),
      pageUrl: D.str(input.pageUrl),
      appVersion: D.str(input.appVersion),
      sessionKey: sessionKeyOf(input, req),
    },
    req,
  );

export const trackClientError = async (input: Record<string, any>, req?: any) => {
  const event = await recordMetricEvent(
    METRIC.EVENT,
    {
      kind: 'error',
      message: D.str(input.message),
      errorType: D.str(input.type),
      pageUrl: D.str(input.pageUrl),
      meta: D.obj(input.meta),
      sessionKey: sessionKeyOf(input, req),
    },
    req,
  );

  await prisma.crashLog.create({
    data: {
      deviceId: D.str(req?.deviceId),
      platform: (D.str(req?.platform) || 'WEB') as Platform,
      appVersion: D.str(req?.appVersion),
      errorMessage: D.str(input.message),
      errorType: D.str(input.type),
      stack: D.str(input.stack),
      meta: (D.obj(input.meta) ?? {}) as Prisma.InputJsonValue,
      sessionKey: sessionKeyOf(input, req),
      userId: D.str(req?.auth?.userId),
    },
  });

  return event;
};

export const trackClick = async (input: Record<string, any>, req?: any) =>
  recordMetricEvent(
    METRIC.CLICK,
    {
      x: D.num(input.x),
      y: D.num(input.y),
      element: D.str(input.element),
      target: D.str(input.target),
      pageUrl: D.str(input.pageUrl),
      sessionKey: sessionKeyOf(input, req),
    },
    req,
  );

export const trackScroll = async (input: Record<string, any>, req?: any) =>
  recordMetricEvent(
    METRIC.SCROLL,
    {
      depth: D.num(input.depth),
      pageUrl: D.str(input.pageUrl),
      sessionKey: sessionKeyOf(input, req),
    },
    req,
  );

/**
 * Records a search performed inside the app rather than through `/search`, so mobile
 * clients are represented in the same SearchLog the search box writes to.
 */
export const trackSearch = async (input: Record<string, any>, req?: any) => {
  const term = D.str(input.term);
  const resultCount = D.num(input.resultCount);

  await prisma.searchLog.create({
    data: {
      userId: D.str(req?.auth?.userId) || null,
      sessionKey: sessionKeyOf(input, req),
      term,
      resultCount,
      hasResults: resultCount > 0,
      filters: (D.obj(input.filters) ?? {}) as Prisma.InputJsonValue,
    },
  });

  return { term, resultCount, hasResults: resultCount > 0 };
};

export const trackUtm = async (input: Record<string, any>, req?: any) => {
  const sessionKey = sessionKeyOf(input, req);
  const session = await prisma.session.findUnique({ where: { sessionKey }, select: { id: true } });

  await prisma.visitorLog.create({
    data: {
      sessionKey,
      sessionId: session?.id ?? null,
      deviceId: D.str(req?.deviceId),
      userId: D.str(req?.auth?.userId) || null,
      eventType: 'utm',
      eventName: 'utm',
      pageUrl: D.str(input.pageUrl),
      utm: {
        source: D.str(input.source),
        medium: D.str(input.medium),
        campaign: D.str(input.campaign),
        term: D.str(input.term),
        content: D.str(input.content),
      } as Prisma.InputJsonValue,
      geo: (req?.geo ?? {}) as Prisma.InputJsonValue,
      platform: (D.str(req?.platform) || 'WEB') as Platform,
      isBot: D.bool(req?.isBot),
      ip: D.str(req?.ip),
    },
  });

  return { sessionKey };
};

export const trackReferrer = async (input: Record<string, any>, req?: any) => {
  const sessionKey = sessionKeyOf(input, req);
  const session = await prisma.session.findUnique({ where: { sessionKey }, select: { id: true } });

  await prisma.visitorLog.create({
    data: {
      sessionKey,
      sessionId: session?.id ?? null,
      deviceId: D.str(req?.deviceId),
      userId: D.str(req?.auth?.userId) || null,
      eventType: 'referrer',
      eventName: 'referrer',
      pageUrl: D.str(input.pageUrl),
      referrer: D.str(input.referrer),
      geo: (req?.geo ?? {}) as Prisma.InputJsonValue,
      platform: (D.str(req?.platform) || 'WEB') as Platform,
      isBot: D.bool(req?.isBot),
      ip: D.str(req?.ip),
    },
  });

  return { sessionKey, referrer: D.str(input.referrer) };
};

/** Keeps a session marked alive without writing a row per beat. */
export const trackHeartbeat = async (input: Record<string, any>, req?: any) => {
  const sessionKey = sessionKeyOf(input, req);
  const at = new Date();

  await prisma.session.updateMany({ where: { sessionKey }, data: { lastSeenAt: at } });

  return { sessionKey, isForeground: D.bool(input.isForeground), at: D.date(at) };
};

export const trackAppInstall = async (input: Record<string, any>, req?: any) => {
  const sessionKey = sessionKeyOf(input, req);

  await prisma.device.updateMany({
    where: { deviceId: D.str(input.deviceId ?? req?.deviceId) },
    data: { appVersion: D.str(input.appVersion) },
  });

  const event = await recordMetricEvent(
    METRIC.EVENT,
    {
      kind: 'app_install',
      appVersion: D.str(input.appVersion),
      referrer: D.str(input.referrer),
      campaign: D.str(input.campaign),
      platform: D.str(input.platform ?? req?.platform),
      sessionKey,
    },
    req,
  );

  return { ...event, appVersion: D.str(input.appVersion) };
};

export const trackAppOpen = async (input: Record<string, any>, req?: any) =>
  recordMetricEvent(
    METRIC.EVENT,
    {
      kind: 'app_open',
      appVersion: D.str(input.appVersion),
      isFromBackground: D.bool(input.isFromBackground),
      durationSec: D.num(input.durationSec),
      sessionKey: sessionKeyOf(input, req),
    },
    req,
  );

/** Attributes a session to a funnel step, deduplicated per session and step. */
const attributeFunnelStep = async (
  funnelId: string,
  stepId: string,
  input: Record<string, any>,
  req?: any,
): Promise<{ funnelId: string; stepId: string; sessionKey: string }> => {
  const sessionKey = sessionKeyOf(input, req);

  const step = await prisma.funnelStep.findFirst({
    where: { id: stepId, funnelId },
    select: { id: true },
  });

  if (!step) throw AppError.notFound(ERROR.ANALYTICS.INVALID_RANGE, ERROR_CODE.NOT_FOUND);

  const existing = await prisma.funnelConversion.findFirst({
    where: { funnelId, stepId: step.id, sessionKey },
    select: { id: true },
  });

  if (existing) return { funnelId, stepId: step.id, sessionKey };

  await prisma.$transaction([
    prisma.funnelConversion.create({ data: { funnelId, stepId: step.id, sessionKey } }),
    prisma.funnelStep.update({ where: { id: step.id }, data: { count: { increment: 1 } } }),
  ]);

  return { funnelId, stepId: step.id, sessionKey };
};

/** Resolves a funnel by id or slug so the client can post either. */
const resolveFunnel = async (
  ref: string,
  stepRef?: string,
): Promise<{ funnelId: string; stepId: string }> => {
  const funnel = await prisma.funnel.findFirst({
    where: { OR: [{ id: D.str(ref) }, { slug: D.str(ref) }] },
    select: { id: true },
  });

  if (!funnel) throw AppError.notFound(ERROR.ANALYTICS.INVALID_RANGE, ERROR_CODE.NOT_FOUND);

  const step = await prisma.funnelStep.findFirst({
    where: {
      funnelId: funnel.id,
      ...(stepRef ? { OR: [{ id: D.str(stepRef) }, { name: D.str(stepRef) }] } : { sortOrder: 0 }),
    },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
  });

  if (!step) throw AppError.notFound(ERROR.ANALYTICS.INVALID_RANGE, ERROR_CODE.NOT_FOUND);

  return { funnelId: funnel.id, stepId: step.id };
};

export const trackFunnelStep = async (input: Record<string, any>, req?: any) => {
  const ref = D.str(input.funnelId ?? input.slug);
  const { funnelId, stepId } = await resolveFunnel(ref, D.str(input.stepId));
  return attributeFunnelStep(funnelId, stepId, input, req);
};

export const trackConversion = async (input: Record<string, any>, req?: any) => {
  const ref = D.str(input.funnelId ?? input.slug);
  const { funnelId, stepId } = await resolveFunnel(ref, D.str(input.stepId));
  const result = await attributeFunnelStep(funnelId, stepId, input, req);

  await recordMetricEvent(
    METRIC.CONVERSION,
    {
      value: D.float(input.value),
      currency: D.str(input.currency),
      orderId: D.str(input.orderId),
      sessionKey: result.sessionKey,
    },
    req,
  );

  return { ...result, value: D.float(input.value) };
};

export const trackEvent = async (
  input: {
    name: string;
    sessionKey?: string;
    meta?: Record<string, any>;
    userId?: string;
    deviceId?: string;
  },
  req?: any,
): Promise<{ name: string; sessionKey: string }> => {
  // Unknown event names are refused so the analytics table cannot be polluted.
  const name = assertAllowedEvent(input.name);
  const sessionKey = D.str(req?.sessionKey ?? input.sessionKey);

  await prisma.event.create({
    data: {
      name,
      sessionKey,
      userId: D.str(input.userId),
      deviceId: D.str(input.deviceId),
      meta: (input.meta ?? {}) as Prisma.InputJsonValue,
    },
  });

  return { name, sessionKey };
};

export const trackPageView = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const sessionKey = D.str(input.sessionKey ?? req?.sessionKey);

  const row = await prisma.pageView.create({
    data: {
      sessionKey,
      sessionId: D.str(req?.sessionId) || null,
      pageUrl: D.str(input.pageUrl),
      pageTitle: D.str(input.pageTitle),
      timeOnPage: D.num(input.timeOnPage),
      scrollDepth: D.num(input.scrollDepth),
      referrer: D.str(input.referrer ?? req?.referrer),
      deviceType: D.str(input.deviceType),
      platform: (D.str(input.platform) || 'WEB') as Platform,
      geo: (req?.geo ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true, sessionKey: true, pageUrl: true, createdAt: true },
  });

  void cacheDelAnalytics();

  return {
    viewId: D.str(row.id),
    sessionKey: D.str(row.sessionKey),
    pageUrl: D.str(row.pageUrl),
    trackedAt: D.date(row.createdAt),
  };
};

export const trackCrash = async (
  input: Record<string, any>,
  req?: any,
): Promise<{ crashId: string }> => {
  const row = await prisma.crashLog.create({
    data: {
      deviceId: D.str(input.deviceId ?? req?.deviceId),
      platform: (D.str(input.platform) || 'WEB') as Platform,
      appVersion: D.str(input.appVersion),
      errorMessage: D.str(input.errorMessage),
      errorType: D.str(input.errorType),
      stack: D.str(input.stack),
      breadcrumbs: D.arr(input.breadcrumbs).map(String) as unknown as Prisma.InputJsonValue,
      meta: (input.meta ?? {}) as Prisma.InputJsonValue,
      sessionKey: D.str(input.sessionKey ?? req?.sessionKey),
      userId: D.str(req?.auth?.userId),
    },
    select: { id: true },
  });

  return { crashId: D.str(row.id) };
};

/**
 * Registers or refreshes a device.
 * The token and identity are merged so a reinstall does not lose its history.
 */
export const registerDevice = async (
  input: Record<string, any>,
  userId?: string,
  req?: any,
): Promise<any> => {
  const deviceId = D.str(input.deviceId);

  const existing = await prisma.device.findUnique({
    where: { deviceId },
    select: { id: true, userId: true },
  });

  // A device belonging to someone else is not silently reassigned.
  if (existing && existing.userId && userId && existing.userId !== userId) {
    throw AppError.forbidden('This device is registered to another account.');
  }

  const data = {
    userId: D.str(userId) || existing?.userId || null,
    platform: (D.str(input.platform) || 'WEB') as Platform,
    os: D.str(input.os),
    osVersion: D.str(input.osVersion),
    browser: D.str(input.browser),
    browserVersion: D.str(input.browserVersion),
    model: D.str(input.model),
    manufacturer: D.str(input.manufacturer),
    fcmToken: D.str(input.fcmToken),
    appVersion: D.str(input.appVersion),
    locale: D.str(input.locale),
    timezone: D.str(input.timezone),
    screenWidth: D.num(input.screenWidth),
    screenHeight: D.num(input.screenHeight),
    ip: D.str(req?.ip),
    lastSeenAt: new Date(),
  };

  const row = await prisma.device.upsert({
    where: { deviceId },
    create: { deviceId, ...data },
    update: data,
  });

  return row;
};

export const listDevices = async (userId: string): Promise<any[]> =>
  prisma.device.findMany({ where: { userId }, orderBy: { lastSeenAt: 'desc' } });

export const getDeviceById = async (id: string): Promise<any> => {
  const row = await prisma.device.findUnique({ where: { id } });
  if (!row) throw AppError.notFound(ERROR.DEVICE.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return row;
};

export const listDevicesByUser = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.DeviceWhereInput = {
    userId,
    ...(D.str(query.platform) ? { platform: D.str(query.platform) as Platform } : {}),
    ...(D.str(query.isBlocked) === 'true' ? { isBlocked: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.device.count({ where }),
  ]);

  return { rows, total };
};

/** Every device on record, for the admin trust-and-safety view. */
export const listAllDevices = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.DeviceWhereInput = {
    ...(D.str(query.platform) ? { platform: D.str(query.platform) as Platform } : {}),
    ...(D.str(query.isBlocked) === 'true'
      ? { isBlocked: true }
      : D.str(query.isBlocked) === 'false'
        ? { isBlocked: false }
        : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.device.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.device.count({ where }),
  ]);

  return { rows, total };
};

export const listTrustedDevices = async (userId: string): Promise<any[]> =>
  prisma.device.findMany({
    where: { userId, isTrusted: true },
    orderBy: { lastSeenAt: 'desc' },
  });

export const setDeviceTrusted = async (deviceId: string, isTrusted: boolean): Promise<any> => {
  const existing = await prisma.device.findUnique({ where: { deviceId }, select: { id: true } });
  if (!existing) throw AppError.notFound(ERROR.DEVICE.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return prisma.device.update({ where: { deviceId }, data: { isTrusted } });
};

export const removeDevice = async (
  deviceId: string,
): Promise<{ deviceId: string; deleted: boolean }> => {
  const existing = await prisma.device.findUnique({ where: { deviceId }, select: { id: true } });
  if (!existing) throw AppError.notFound(ERROR.DEVICE.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  await prisma.device.delete({ where: { deviceId } });
  return { deviceId: D.str(deviceId), deleted: true };
};

export const toggleDeviceBlock = async (
  deviceId: string,
  isBlocked: boolean,
  req?: any,
): Promise<any> => {
  const existing = await prisma.device.findUnique({ where: { deviceId }, select: { id: true } });

  if (!existing) throw AppError.notFound(ERROR.DEVICE.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const row = await prisma.device.update({ where: { deviceId }, data: { isBlocked } });

  void writeActivityLog({
    req,
    action: isBlocked ? 'SUSPEND' : 'ACTIVATE',
    entity: 'Device',
    entityId: deviceId,
  });

  return row;
};

// ═══ Analytics ═══════════════════════════════════════════════════════════════

/** Resolves `?days=` / `?from=&to=` into a concrete window. */
const resolveRange = (query: Record<string, any>): { from: Date; to: Date } => {
  if (D.str(query.from) || D.str(query.to)) {
    return {
      from: D.str(query.from) ? startOfDay(D.str(query.from)) : subtractDays(30),
      to: D.str(query.to) ? endOfDay(D.str(query.to)) : endOfDay(new Date()),
    };
  }

  const days = D.num(query.days) || 30;
  return { from: startOfDay(subtractDays(days - 1)), to: endOfDay(new Date()) };
};

const cacheDelAnalytics = async (): Promise<void> => {
  const { cacheDel } = await import('../../services/redis.service');
  await cacheDel('analytics:overview');
};

export const getOverview = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const where: Prisma.PageViewWhereInput = { createdAt: { gte: from, lte: to } };

  const [views, sessions, events, orders, users] = await Promise.all([
    prisma.pageView.count({ where }),
    prisma.pageView.groupBy({ by: ['sessionKey'], where }),
    prisma.event.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to } } }),
    prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
  ]);

  const revenue = await prisma.order.aggregate({
    where: {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
      paymentStatus: PAYMENT_STATUS.PAID,
    },
    _sum: { total: true },
  });

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    pageViews: views,
    uniqueVisitors: sessions.length,
    sessions: sessions.length,
    events,
    orders,
    newUsers: users,
    revenue: D.float(revenue._sum.total),
    conversionRate: views > 0 ? D.float(Math.round((orders / views) * 10000) / 100) : 0,
  };
};

export const getVisitors = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.pageView.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { sessionKey: true, deviceType: true, platform: true, createdAt: true },
  });

  const unique = new Set(rows.map((r) => r.sessionKey));

  const byDevice: Record<string, number> = {};
  for (const r of rows) {
    const key = D.str(r.deviceType) || 'unknown';
    byDevice[key] = (byDevice[key] ?? 0) + 1;
  }

  const byPlatform: Record<string, number> = {};
  for (const r of rows) {
    const key = D.str(r.platform);
    byPlatform[key] = (byPlatform[key] ?? 0) + 1;
  }

  // The busiest day, so a client can highlight it without a second request.
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const key = new Date(r.createdAt).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] ?? 0) + 1;
  }

  const peak = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];

  return {
    totalPageViews: rows.length,
    uniqueVisitors: unique.size,
    byDevice: Object.entries(byDevice).map(([device, count]) => ({ device, count })),
    byPlatform: Object.entries(byPlatform).map(([platform, count]) => ({ platform, count })),
    byDay: Object.entries(byDay)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, count })),
    peakDay: peak ? { date: peak[0], count: peak[1] } : { date: '', count: 0 },
  };
};

export const getTopPages = async (query: Record<string, any>): Promise<any[]> => {
  const { from, to } = resolveRange(query);
  const limit = D.num(query.limit) || 20;

  const grouped = await prisma.pageView.groupBy({
    by: ['pageUrl'],
    where: { createdAt: { gte: from, lte: to } },
    _count: { _all: true },
    orderBy: { _count: { pageUrl: 'desc' } },
    take: limit,
  });

  const totals = await prisma.pageView.groupBy({
    by: ['pageUrl'],
    where: { createdAt: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const totalViews = totals.reduce((s, t) => s + D.num(t._count._all), 0);

  return grouped.map((g) => ({
    pageUrl: D.str(g.pageUrl),
    views: D.num(g._count._all),
    percentage:
      totalViews > 0 ? D.float(Math.round((D.num(g._count._all) / totalViews) * 1000) / 10) : 0,
  }));
};

/** Referrer sources, classified so the client does not have to parse URLs. */
export const getTrafficSources = async (query: Record<string, any>): Promise<any[]> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.pageView.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { referrer: true, sessionKey: true },
  });

  const classify = (referrer: string): string => {
    const value = D.str(referrer).toLowerCase();
    if (!value) return 'direct';
    if (/google\./.test(value)) return 'google';
    if (/bing\./.test(value)) return 'bing';
    if (/facebook|fb\./.test(value)) return 'facebook';
    if (/instagram/.test(value)) return 'instagram';
    if (/whatsapp/.test(value)) return 'whatsapp';
    if (/youtube/.test(value)) return 'youtube';
    if (/twitter|x\.com/.test(value)) return 'twitter';
    return 'referral';
  };

  const counts: Record<string, { views: number; sessions: Set<string> }> = {};

  for (const row of rows) {
    const key = classify(row.referrer);
    if (!counts[key]) counts[key] = { views: 0, sessions: new Set<string>() };
    counts[key].views += 1;
    counts[key].sessions.add(row.sessionKey);
  }

  const totalViews = rows.length;

  return Object.entries(counts)
    .map(([source, data]) => ({
      source,
      views: data.views,
      visitors: data.sessions.size,
      percentage: totalViews > 0 ? D.float(Math.round((data.views / totalViews) * 1000) / 10) : 0,
    }))
    .sort((a, b) => b.views - a.views);
};

export const getGeoBreakdown = async (query: Record<string, any>): Promise<any[]> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.geoVisit.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { visitors: 'desc' },
    take: 100,
  });

  return rows.map((r) => ({
    country: D.str(r.country),
    state: D.str(r.state),
    city: D.str(r.city),
    visitors: D.num(r.visitors),
    pageViews: D.num(r.pageViews),
  }));
};

/** Revenue grouped by day, week or month. */
export const getRevenue = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
      paymentStatus: PAYMENT_STATUS.PAID,
      ...(D.str(query.vendorId)
        ? { subOrders: { some: { vendorId: D.str(query.vendorId) } } }
        : {}),
    },
    select: { id: true, total: true, createdAt: true, paymentStatus: true },
  });

  const group = D.str(query.groupBy) || 'day';

  const bucketOf = (date: Date): string => {
    if (group === 'month') return new Date(date).toISOString().slice(0, 7);
    if (group === 'week') {
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    return new Date(date).toISOString().slice(0, 10);
  };

  const buckets = new Map<string, { revenue: number; orders: number }>();

  for (const o of orders) {
    const key = bucketOf(o.createdAt);
    const bucket = buckets.get(key) ?? { revenue: 0, orders: 0 };
    bucket.revenue = money(bucket.revenue + D.float(o.total));
    bucket.orders += 1;
    buckets.set(key, bucket);
  }

  const series = Array.from(buckets.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, data]) => ({ bucket, revenue: data.revenue, orders: data.orders }));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    groupBy: group,
    totalRevenue: money(orders.reduce((s, o) => s + D.float(o.total), 0)),
    totalOrders: orders.length,
    averageOrderValue: orders.length
      ? money(orders.reduce((s, o) => s + D.float(o.total), 0) / orders.length)
      : 0,
    series,
  };
};

/** Best sellers, ranked by whichever metric the caller picks. */
export const getProductPerformance = async (
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ rows: any[]; total: number }> => {
  const { from, to } = resolveRange(query);
  const limit = D.num(query.limit) || 20;

  const items = await prisma.orderItem.findMany({
    where: {
      ...(vendorId ? { subOrder: { vendorId } } : {}),
      order: { deletedAt: null, createdAt: { gte: from, lte: to } },
    },
    select: {
      productId: true,
      name: true,
      qty: true,
      total: true,
      product: { select: { viewCount: true, rating: true, price: true } },
    },
  });

  const grouped = new Map<
    string,
    { name: string; qty: number; revenue: number; views: number; rating: number }
  >();

  for (const i of items) {
    const entry = grouped.get(i.productId) ?? {
      name: D.str(i.name),
      qty: 0,
      revenue: 0,
      views: D.num(i.product?.viewCount),
      rating: D.float(i.product?.rating),
    };
    entry.qty += D.num(i.qty);
    entry.revenue = money(entry.revenue + D.float(i.total));
    grouped.set(i.productId, entry);
  }

  const sort = D.str(query.sort) || 'revenue';

  const rows = Array.from(grouped.entries())
    .map(([productId, data]) => ({ productId, ...data }))
    .sort((a, b) => {
      if (sort === 'qty') return b.qty - a.qty;
      if (sort === 'views') return b.views - a.views;
      if (sort === 'rating') return b.rating - a.rating;
      return b.revenue - a.revenue;
    });

  return { rows: rows.slice(0, limit), total: rows.length };
};

/** Carts left behind, with what they were worth. */
export const getAbandonedCarts = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number; value: number }> => {
  const minAgeHours = D.num(query.minAgeHours) || 24;
  const cutoff = new Date(Date.now() - minAgeHours * 3_600_000);

  const carts = await prisma.cart.findMany({
    where: { updatedAt: { lte: cutoff } },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              images: { select: { url: true, sortOrder: true } },
            },
          },
        },
      },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { updatedAt: 'desc' },
    skip: D.num(query.skip),
    take: D.num(query.take),
  });

  const all = await prisma.cart.count({
    where: { updatedAt: { lte: cutoff }, items: { some: {} } },
  });

  const rows = D.arr(carts)
    .filter((c: any) => D.arr(c.items).length > 0)
    .map((c: any) => {
      const value = money(
        D.arr(c.items).reduce(
          (s: number, i: any) => s + D.num(i.qty) * D.float(i.variant?.price ?? i.product?.price),
          0,
        ),
      );

      return {
        cartId: D.str(c.id),
        itemCount: D.arr(c.items).length,
        value,
        abandonedForHours: Math.round((Date.now() - new Date(c.updatedAt).getTime()) / 3_600_000),
        userData: {
          userId: D.str(c.user?.id),
          name: D.str(c.user?.name),
          email: D.str(c.user?.email),
        },
        itemList: D.arr(c.items).map((i: any) => ({
          productId: D.str(i.productId),
          name: D.str(i.product?.name),
          qty: D.num(i.qty),
          price: D.float(i.variant?.price ?? i.product?.price),
          image: D.str(D.arr<any>(i.product?.images)[0]?.url),
        })),
      };
    });

  return {
    rows,
    total: all,
    value: money(rows.reduce((s: number, r: any) => s + D.float(r.value), 0)),
  };
};

export const getSearchTerms = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.SearchLogWhereInput = {};

  if (D.str(query.hasResults) === 'false') where.hasResults = false;
  if (D.str(query.term)) where.term = { contains: D.str(query.term), mode: 'insensitive' };

  const [rows, total] = await Promise.all([
    prisma.searchLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.searchLog.count({ where }),
  ]);

  return { rows, total };
};

/** Carts converted within the window, bucketed by creation day. */
export const getCohorts = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const carts = await prisma.cart.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { id: true, createdAt: true, items: { select: { productId: true } } },
  });

  const converted = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte: from, lte: to } },
    select: { id: true, createdAt: true, total: true },
  });

  const byDay = new Map<string, { carts: number; orders: number; revenue: number }>();

  for (const c of carts) {
    const key = toDayKey(c.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? { carts: 0, orders: 0, revenue: 0 };
    bucket.carts += 1;
    byDay.set(key, bucket);
  }

  for (const o of converted) {
    const key = toDayKey(o.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? { carts: 0, orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue = money(bucket.revenue + D.float(o.total));
    byDay.set(key, bucket);
  }

  const series = Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, data]) => ({
      date,
      carts: data.carts,
      orders: data.orders,
      revenue: data.revenue,
      conversionRate:
        data.carts > 0 ? D.float(Math.round((data.orders / data.carts) * 1000) / 10) : 0,
    }));

  return { from: from.toISOString(), to: to.toISOString(), series };
};

/** Live counters for the last 15 minutes. */
export const getRealtime = async (): Promise<Record<string, any>> => {
  const since = new Date(Date.now() - 15 * 60_000);

  const [activeSessions, recentViews, recentOrders] = await Promise.all([
    prisma.pageView.groupBy({ by: ['sessionKey'], where: { createdAt: { gte: since } } }),
    prisma.pageView.count({ where: { createdAt: { gte: since } } }),
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
  ]);

  const events = await prisma.event.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { name: true, sessionKey: true, createdAt: true },
  });

  return {
    windowMinutes: 15,
    activeVisitors: activeSessions.length,
    pageViews: recentViews,
    orders: recentOrders,
    recentEventList: events.map((e: any) => ({
      name: D.str(e.name),
      sessionKey: D.str(e.sessionKey),
      at: D.date(e.createdAt),
    })),
  };
};

/** Distinct session keys, which is the definition of a unique visitor here. */
export const getUniqueVisitors = async (
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.pageView.groupBy({
    by: ['sessionKey'],
    where: { createdAt: { gte: from, lte: to } },
    _min: { createdAt: true },
  });

  /**
   * A visitor counts as returning only once their first view of the whole table predates
   * the window, so the same session cannot make itself look like a repeat visit.
   */
  let returningVisitors = 0;
  for (const row of rows) {
    const firstEver = await prisma.pageView.findFirst({
      where: { sessionKey: row.sessionKey },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (firstEver && new Date(firstEver.createdAt) < from) returningVisitors += 1;
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    uniqueVisitors: rows.length,
    returningVisitors,
  };
};

export const getPageViews = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const [total, byDay, byPlatform, distinctSessions] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.pageView.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    }),
    prisma.pageView.groupBy({
      by: ['platform'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    prisma.pageView.groupBy({ by: ['sessionKey'], where: { createdAt: { gte: from, lte: to } } }),
  ]);

  const byDayMap = new Map<string, number>();
  for (const r of byDay) {
    const key = toDayKey(r.createdAt).toISOString().slice(0, 10);
    byDayMap.set(key, (byDayMap.get(key) ?? 0) + 1);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totalPageViews: total,
    sessions: distinctSessions.length,
    avgViewsPerSession:
      distinctSessions.length > 0
        ? D.float(Math.round((total / distinctSessions.length) * 100) / 100)
        : 0,
    series: Array.from(byDayMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, count]) => ({ date, views: count })),
    platformBreakdown: byPlatform.map((p: any) => ({
      platform: D.str(p.platform),
      views: D.num(p._count._all),
    })),
  };
};

/** OS and browser split, so an app team can see what to optimise for. */
export const getDeviceBreakdown = async (
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.device.findMany({
    where: { lastSeenAt: { gte: from, lte: to } },
    select: { platform: true, os: true, browser: true, appVersion: true },
  });

  const tally = (pick: (r: any) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const key = pick(r) || 'unknown';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };

  const total = rows.length || 1;
  const percent = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        count,
        percentage: D.float(Math.round((count / total) * 1000) / 10),
      }));

  const os = tally((r) => D.str(r.os));
  const browser = tally((r) => D.str(r.browser));

  return {
    totalDevices: rows.length,
    platformList: percent(tally((r) => D.str(r.platform))),
    osList: percent(os),
    browserList: percent(browser),
  };
};

export const listSessionRows = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const { from, to } = resolveRange(query);

  const where: Prisma.SessionWhereInput = {
    startedAt: { gte: from, lte: to },
    ...(D.str(query.platform) ? { platform: D.str(query.platform) as Platform } : {}),
    ...(D.str(query.isActive) === 'true'
      ? { isActive: true }
      : D.str(query.isActive) === 'false'
        ? { isActive: false }
        : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.session.count({ where }),
  ]);

  return { rows, total };
};

/** The whole journey for one session, in the order the client reported it. */
export const getSessionDetail = async (id: string): Promise<Record<string, any>> => {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) throw AppError.notFound(ERROR.SESSION.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const [views, events, orders] = await Promise.all([
    prisma.pageView.findMany({
      where: { sessionKey: session.sessionKey },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.event.findMany({
      where: { sessionKey: session.sessionKey },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        ...(session.userId ? { userId: session.userId } : { id: '__none__' }),
      },
      select: { id: true, orderNumber: true, total: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const endedAt = session.endedAt ?? session.lastSeenAt;
  const durationSec = Math.max(
    0,
    Math.round((new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000),
  );

  return {
    sessionId: D.str(session.id),
    sessionKey: D.str(session.sessionKey),
    deviceId: D.str(session.deviceId),
    platform: D.str(session.platform),
    ip: D.str(session.ip),
    isActive: D.bool(session.isActive),
    startedAt: D.date(session.startedAt),
    endedAt: D.date(session.endedAt),
    durationSec,
    geoData: typeof session.geo === 'object' && session.geo ? session.geo : {},
    pageViewList: views.map((v: any) => ({
      viewId: D.str(v.id),
      pageUrl: D.str(v.pageUrl),
      pageTitle: D.str(v.pageTitle),
      timeOnPage: D.num(v.timeOnPage),
      scrollDepth: D.num(v.scrollDepth),
      at: D.date(v.createdAt),
    })),
    eventList: events.map((e: any) => ({
      eventId: D.str(e.id),
      name: D.str(e.name),
      at: D.date(e.createdAt),
    })),
    orderList: orders.map((o: any) => ({
      orderId: D.str(o.id),
      orderNumber: D.str(o.orderNumber),
      total: D.float(o.total),
      status: D.str(o.status),
      createdAt: D.date(o.createdAt),
    })),
  };
};

/** Orders and revenue inside the window, bucketed by day. */
export const getConversions = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const orders = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte: from, lte: to } },
    select: { id: true, total: true, createdAt: true },
  });

  const visits = await prisma.pageView.groupBy({
    by: ['sessionKey'],
    where: { createdAt: { gte: from, lte: to } },
  });

  const byDay = new Map<string, { orders: number; revenue: number }>();
  for (const o of orders) {
    const key = toDayKey(o.createdAt).toISOString().slice(0, 10);
    const bucket = byDay.get(key) ?? { orders: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue = money(bucket.revenue + D.float(o.total));
    byDay.set(key, bucket);
  }

  const totalRevenue = money(orders.reduce((s, o) => s + D.float(o.total), 0));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totalConversions: orders.length,
    totalRevenue,
    conversionRate:
      visits.length > 0 ? D.float(Math.round((orders.length / visits.length) * 10000) / 100) : 0,
    series: Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, data]) => ({ date, orders: data.orders, revenue: data.revenue })),
  };
};

/** Per-vendor revenue, order count and fulfilment rate. */
export const getVendorPerformance = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const { from, to } = resolveRange(query);
  const skip = D.num(query.skip);
  const take = D.num(query.take) || 20;

  const vendors = await prisma.vendorProfile.findMany({
    where: { deletedAt: null },
    select: { id: true, shopName: true, slug: true, status: true, commissionRate: true },
    orderBy: { createdAt: 'desc' },
    skip,
    take,
  });

  const total = await prisma.vendorProfile.count({ where: { deletedAt: null } });

  const subOrders = D.arr(vendors).length
    ? await prisma.subOrder.findMany({
        where: { vendorId: { in: D.arr(vendors).map((v: any) => v.id) } },
        select: {
          vendorId: true,
          subtotal: true,
          commission: true,
          vendorEarning: true,
          status: true,
          createdAt: true,
        },
      })
    : [];

  const byVendor = new Map<
    string,
    { subOrders: number; revenue: number; commission: number; earnings: number; delivered: number }
  >();

  for (const sub of subOrders) {
    const inWindow = new Date(sub.createdAt) >= from && new Date(sub.createdAt) <= to;
    const bucket = byVendor.get(sub.vendorId) ?? {
      subOrders: 0,
      revenue: 0,
      commission: 0,
      earnings: 0,
      delivered: 0,
    };
    if (inWindow) {
      bucket.subOrders += 1;
      bucket.revenue = money(bucket.revenue + D.float(sub.subtotal));
      bucket.commission = money(bucket.commission + D.float(sub.commission));
      bucket.earnings = money(bucket.earnings + D.float(sub.vendorEarning));
      if (sub.status === 'DELIVERED') bucket.delivered += 1;
    }
    byVendor.set(sub.vendorId, bucket);
  }

  const rows = D.arr(vendors).map((v: any) => {
    const stats = byVendor.get(v.id) ?? {
      subOrders: 0,
      revenue: 0,
      commission: 0,
      earnings: 0,
      delivered: 0,
    };

    return {
      vendorId: D.str(v.id),
      shopName: D.str(v.shopName),
      slug: D.str(v.slug),
      status: D.str(v.status),
      commissionRate: D.float(v.commissionRate),
      subOrderCount: stats.subOrders,
      revenue: stats.revenue,
      commission: stats.commission,
      earnings: stats.earnings,
      fulfilmentRate:
        stats.subOrders > 0
          ? D.float(Math.round((stats.delivered / stats.subOrders) * 1000) / 10)
          : 0,
    };
  });

  return { rows, total };
};

export const listCrashes = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const { from, to } = resolveRange(query);

  const where: Prisma.CrashLogWhereInput = {
    createdAt: { gte: from, lte: to },
    ...(D.str(query.platform) ? { platform: D.str(query.platform) as Platform } : {}),
    ...(D.str(query.appVersion) ? { appVersion: D.str(query.appVersion) } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.crashLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.crashLog.count({ where }),
  ]);

  return { rows, total };
};

/** Installed base per app version, so a bad release can be found fast. */
export const getAppVersions = async (query: Record<string, any>): Promise<Record<string, any>> => {
  const { from, to } = resolveRange(query);

  const rows = await prisma.device.findMany({
    where: { lastSeenAt: { gte: from, lte: to } },
    select: { platform: true, appVersion: true },
  });

  const byKey = new Map<string, number>();
  for (const r of rows) {
    const key = `${D.str(r.platform) || 'WEB'}|${D.str(r.appVersion) || 'unknown'}`;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }

  const total = rows.length || 1;
  const list = Array.from(byKey.entries())
    .map(([key, count]) => {
      const [platform, appVersion] = key.split('|');
      return {
        platform,
        appVersion,
        deviceCount: count,
        percentage: D.float(Math.round((count / total) * 1000) / 10),
      };
    })
    .sort((a, b) => b.deviceCount - a.deviceCount);

  return { totalDevices: rows.length, versionList: list };
};

/** Flat rows for the analytics CSV export, capped so one request cannot stream the table. */
export const exportAnalytics = async (
  query: Record<string, any>,
): Promise<{ columns: string[]; rows: any[][]; truncated: boolean }> => {
  const { from, to } = resolveRange(query);
  const maxRows = ANALYTICS.EXPORT_MAX_ROWS;
  const limit = Math.min(maxRows, D.num(query.limit) || maxRows);

  const rows = await prisma.pageView.findMany({
    where: { createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { pageUrl: true, platform: true, deviceType: true, referrer: true, createdAt: true },
  });

  return {
    columns: ['pageUrl', 'platform', 'deviceType', 'referrer', 'createdAt'],
    rows: rows.map((r: any) => [
      D.str(r.pageUrl),
      D.str(r.platform),
      D.str(r.deviceType),
      D.str(r.referrer),
      D.date(r.createdAt),
    ]),
    truncated: rows.length >= maxRows,
  };
};

// ═══ Funnels ═════════════════════════════════════════════════════════════════

const FUNNEL_INCLUDE = { steps: { orderBy: { sortOrder: 'asc' } } } satisfies Prisma.FunnelInclude;

export const listFunnels = async (): Promise<any[]> =>
  prisma.funnel.findMany({
    where: { isActive: true },
    include: FUNNEL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

export const createFunnel = async (
  input: {
    name: string;
    description?: string;
    isActive?: boolean;
    steps: { name: string; eventName: string }[];
  },
  req?: any,
): Promise<any> => {
  const slug = await uniqueFunnelSlug(D.str(input.name));

  const row = await prisma.funnel.create({
    data: {
      name: D.str(input.name),
      slug,
      description: D.str(input.description),
      isActive: input.isActive !== false,
      steps: {
        create: D.arr(input.steps).map((s: any, index: number) => ({
          name: D.str(s.name),
          eventName: D.str(s.eventName),
          sortOrder: index,
        })),
      },
    },
    include: FUNNEL_INCLUDE,
  });

  void writeActivityLog({
    req,
    action: 'CREATE',
    entity: 'Funnel',
    entityId: row.id,
    meta: { name: row.name },
  });

  return row;
};

export const updateFunnel = async (
  funnelId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.funnel.findUnique({
    where: { id: funnelId },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound('Funnel not found.');

  const row = await prisma.funnel.update({
    where: { id: funnelId },
    data: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.description === undefined ? {} : { description: D.str(input.description) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: FUNNEL_INCLUDE,
  });

  void writeActivityLog({ req, action: 'UPDATE', entity: 'Funnel', entityId: funnelId });

  return row;
};

/**
 * Funnel results.
 *
 * Steps are counted as "sessions that fired this event", and the dropoff is
 * relative to the previous step, so a monotonic decline is visible rather than
 * each step looking like an independent total.
 */
export const getFunnel = async (
  slug: string,
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  const funnel = await prisma.funnel.findFirst({
    where: { slug, isActive: true },
    include: FUNNEL_INCLUDE,
  });

  if (!funnel) throw AppError.notFound('Funnel not found.');

  const { from, to } = resolveRange(query);
  const steps = D.arr(funnel.steps) as any[];

  const result: any[] = [];
  let previousSessions: string[] | null = null;

  for (const step of steps) {
    const events = await prisma.event.findMany({
      where: { name: D.str(step.eventName), createdAt: { gte: from, lte: to } },
      select: { sessionKey: true },
    });

    const sessions = Array.from(
      new Set(events.map((e: any) => D.str(e.sessionKey)).filter(Boolean)),
    ).sort();

    // A session only counts for a step if it also cleared the previous one.
    const reached: string[] =
      previousSessions === null ? sessions : sessions.filter((s) => previousSessions!.includes(s));

    result.push({
      stepId: D.str(step.id),
      name: D.str(step.name),
      eventName: D.str(step.eventName),
      sortOrder: D.num(step.sortOrder),
      count: reached.length,
      dropOff:
        previousSessions === null ? 0 : Math.max(0, previousSessions.length - reached.length),
      conversionRate:
        previousSessions === null
          ? 100
          : previousSessions.length > 0
            ? D.float(Math.round((reached.length / previousSessions.length) * 1000) / 10)
            : 0,
    });

    previousSessions = reached;
  }

  const first = D.num(result[0]?.count);
  const last = D.num(result[result.length - 1]?.count);

  return {
    funnelId: D.str(funnel.id),
    name: D.str(funnel.name),
    from: from.toISOString(),
    to: to.toISOString(),
    overallConversionRate: first > 0 ? D.float(Math.round((last / first) * 1000) / 10) : 0,
    stepList: result,
  };
};

// ═══ Search ══════════════════════════════════════════════════════════════════

export const searchProducts = async (
  query: Record<string, any>,
  req?: any,
): Promise<{ rows: any[]; total: number }> => {
  const term = D.str(query.q);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: PRODUCT_STATUS.ACTIVE,
    vendor: { status: VENDOR_STATUS.APPROVED },
    OR: [
      { name: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { sku: { contains: term, mode: 'insensitive' } },
    ],
  };

  if (D.str(query.categoryId)) where.categoryId = D.str(query.categoryId);
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.brandId)) where.brandId = D.str(query.brandId);

  if (D.num(query.minPrice) || D.num(query.maxPrice)) {
    where.price = {
      ...(D.num(query.minPrice) ? { gte: D.num(query.minPrice) } : {}),
      ...(D.num(query.maxPrice) ? { lte: D.num(query.maxPrice) } : {}),
    };
  }

  if (D.str(query.inStock) === 'true') where.stock = { gt: 0 };

  const sort = D.str(query.sort) || 'relevance';

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    sort === 'price_asc'
      ? { price: 'asc' }
      : sort === 'price_desc'
        ? { price: 'desc' }
        : sort === 'rating'
          ? { rating: 'desc' }
          : sort === 'newest'
            ? { createdAt: 'desc' }
            : { soldCount: 'desc' };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: D.num(query.skip),
      take: D.num(query.take),
      include: {
        vendor: { select: { id: true, shopName: true, slug: true } },
        category: { select: { id: true, name: true } },
        images: { select: { url: true, sortOrder: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  /**
   * Awaited so a client that searches and then immediately opens its own history sees the term.
   * A search nobody acted on is the signal a merchandiser needs.
   */
  await prisma.searchLog.create({
    data: {
      userId: D.str(req?.auth?.userId) || null,
      sessionKey: D.str(req?.sessionKey),
      term,
      resultCount: total,
      hasResults: total > 0,
      filters: (query as any).filters ?? {},
    },
  });

  return { rows, total };
};

export const searchVendors = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const term = D.str(query.q);

  const where: Prisma.VendorProfileWhereInput = {
    OR: [
      { shopName: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ],
  };

  if (D.str(query.isActive) === 'true') where.status = 'APPROVED';
  if (D.str(query.isActive) === 'false') where.status = { not: 'APPROVED' };

  const [rows, total] = await Promise.all([
    prisma.vendorProfile.findMany({
      where,
      orderBy: { rating: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
      select: {
        id: true,
        shopName: true,
        slug: true,
        description: true,
        logo: true,
        rating: true,
        ratingCount: true,
        status: true,
      },
    }),
    prisma.vendorProfile.count({ where }),
  ]);

  return { rows, total };
};

/**
 * Global search.
 * The product branch runs in parallel with the others, and only products that
 * are actually ACTIVE from an APPROVED shop can surface.
 */
export const globalSearch = async (
  query: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const term = D.str(query.q);
  const limit = D.num(query.limit) || 10;
  const types = D.str(query.types) || 'all';

  const wants = (t: string) => types === 'all' || types === t;

  const [products, vendors, categories] = await Promise.all([
    wants('product')
      ? prisma.product.findMany({
          where: {
            deletedAt: null,
            status: PRODUCT_STATUS.ACTIVE,
            vendor: { status: VENDOR_STATUS.APPROVED },
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          },
          take: limit,
          orderBy: { soldCount: 'desc' },
          include: {
            vendor: { select: { id: true, shopName: true, slug: true } },
            images: { select: { url: true, sortOrder: true } },
          },
        })
      : [],

    wants('vendor')
      ? prisma.vendorProfile.findMany({
          where: {
            status: VENDOR_STATUS.APPROVED,
            OR: [{ shopName: { contains: term, mode: 'insensitive' } }],
          },
          take: limit,
          orderBy: { rating: 'desc' },
          select: { id: true, shopName: true, slug: true, logo: true, rating: true },
        })
      : [],

    wants('category')
      ? prisma.category.findMany({
          where: { isActive: true, name: { contains: term, mode: 'insensitive' } },
          take: limit,
          select: { id: true, name: true, slug: true, image: true },
        })
      : [],
  ]);

  const total = products.length + vendors.length + categories.length;

  await prisma.searchLog.create({
    data: {
      userId: D.str(req?.auth?.userId) || null,
      sessionKey: D.str(req?.sessionKey),
      term,
      resultCount: total,
      hasResults: total > 0,
    },
  });

  return {
    term,
    totalCount: total,
    productList: products.map((p: any) => ({
      productId: D.str(p.id),
      name: D.str(p.name),
      slug: D.str(p.slug),
      price: D.float(p.price),
      mrpPrice: D.float(p.mrpPrice),
      stock: D.num(p.stock),
      imageList: D.arr(p.images)
        .slice()
        .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
        .map((i: any) => D.str(i?.url)),
      vendorData: {
        vendorId: D.str(p.vendor?.id),
        shopName: D.str(p.vendor?.shopName),
        slug: D.str(p.vendor?.slug),
      },
    })),
    vendorList: vendors.map((v: any) => ({
      vendorId: D.str(v.id),
      shopName: D.str(v.shopName),
      slug: D.str(v.slug),
      logo: D.str(v.logo),
      rating: D.float(v.rating),
    })),
    categoryList: categories.map((c: any) => ({
      categoryId: D.str(c.id),
      name: D.str(c.name),
      slug: D.str(c.slug),
      image: D.str(c.image),
    })),
  };
};

/** Term suggestions for the search box. */
export const getSuggestions = async (query: Record<string, any>): Promise<any[]> => {
  const term = D.str(query.q);
  const limit = D.num(query.limit) || 10;

  const [products, categories, vendors] = await Promise.all([
    prisma.product.findMany({
      where: {
        deletedAt: null,
        status: PRODUCT_STATUS.ACTIVE,
        vendor: { status: VENDOR_STATUS.APPROVED },
        name: { contains: term, mode: 'insensitive' },
      },
      take: limit,
      orderBy: { soldCount: 'desc' },
      select: { id: true, name: true, slug: true },
    }),
    prisma.category.findMany({
      where: { isActive: true, name: { contains: term, mode: 'insensitive' } },
      take: limit,
      select: { id: true, name: true, slug: true },
    }),
    prisma.vendorProfile.findMany({
      where: { status: VENDOR_STATUS.APPROVED, shopName: { contains: term, mode: 'insensitive' } },
      take: limit,
      select: { id: true, shopName: true, slug: true },
    }),
  ]);

  return [
    ...products.map((p: any) => ({
      type: 'PRODUCT',
      label: D.str(p.name),
      slug: D.str(p.slug),
      targetId: D.str(p.id),
    })),
    ...categories.map((c: any) => ({
      type: 'CATEGORY',
      label: D.str(c.name),
      slug: D.str(c.slug),
      targetId: D.str(c.id),
    })),
    ...vendors.map((v: any) => ({
      type: 'VENDOR',
      label: D.str(v.shopName),
      slug: D.str(v.slug),
      targetId: D.str(v.id),
    })),
  ].slice(0, limit);
};

/** Trending terms: most searched recently, weighted towards recent searches. */
export const getTrendingSearches = async (query: Record<string, any>): Promise<any[]> => {
  const days = D.num(query.days) || 7;
  const limit = D.num(query.limit) || 10;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.searchLog.findMany({
    where: { createdAt: { gte: since } },
    select: { term: true, createdAt: true },
  });

  const weights = new Map<string, number>();

  for (const r of rows) {
    const key = D.str(r.term).toLowerCase();
    if (!key) continue;

    // Older searches count for less, so "trending" reflects now.
    const ageDays = (Date.now() - new Date(r.createdAt).getTime()) / 86_400_000;
    const weight = Math.max(0.1, 1 - ageDays / days);

    weights.set(key, (weights.get(key) ?? 0) + weight);
  }

  return Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, score]) => ({ term, score: D.float(Math.round(score * 100) / 100) }));
};

export const getRecentSearches = async (userId: string, req?: any): Promise<string[]> => {
  const rows = await prisma.searchLog.findMany({
    where: {
      OR: [{ userId }, ...(D.str(req?.sessionKey) ? [{ sessionKey: D.str(req?.sessionKey) }] : [])],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { term: true },
  });

  const seen = new Set<string>();
  const out: string[] = [];

  for (const r of rows) {
    const key = D.str(r.term);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }

  return out.slice(0, 10);
};

export const clearRecentSearches = async (userId: string): Promise<number> => {
  const { count } = await prisma.searchLog.deleteMany({ where: { userId } });
  return count;
};

// ═══ Uploads ══════════════════════════════════════════════════════════════════

/** Storage is optional; without it uploads fail loudly rather than silently. */
const requireStorage = (): void => {
  if (!isStorageConfigured) {
    throw AppError.serviceUnavailable(ERROR.UPLOAD.UPLOAD_FAILED, ERROR_CODE.SERVICE_UNAVAILABLE);
  }
};

export const uploadFiles = async (
  files: Express.Multer.File[],
  kind: string,
  userId?: string,
  req?: any,
): Promise<Record<string, any>> => {
  requireStorage();

  /**
   * multer is happy to run with no file at all, which used to fall straight through
   * and answer 201 "Image uploaded successfully." for a request that uploaded
   * nothing. An empty upload is a client error, not a silent success.
   */
  if (!Array.isArray(files) || files.length === 0) {
    throw AppError.badRequest(ERROR.UPLOAD.FILE_REQUIRED, ERROR_CODE.FILE_REQUIRED);
  }

  const uploaded: any[] = [];

  for (const file of files) {
    /**
     * multer writes to disk (uploads/tmp), so stream from the path — the helper unlinks the temp
     * file in its `finally`, keeping the ephemeral disk clean.
     */
    const asset = await uploadToCloudinary(file.path, kind, {
      publicId: D.str(req?.body?.publicId),
      folder: D.str(req?.body?.folder),
    });

    uploaded.push({
      url: D.str(asset.url),
      publicId: D.str(asset.publicId),
      width: D.num(asset.width),
      height: D.num(asset.height),
      format: D.str(asset.format),
      bytes: D.num(asset.bytes),
      originalName: D.str(file.originalname),
      folder: D.str(asset.folder),
    });
  }

  void writeActivityLog({
    req,
    userId,
    action: 'CREATE',
    entity: 'Upload',
    entityId: uploaded[0]?.publicId,
    meta: { count: uploaded.length, kind },
  });

  return {
    count: uploaded.length,
    itemList: uploaded,
  };
};

export const deleteFile = async (
  publicId: string,
  userId?: string,
  req?: any,
): Promise<{ publicId: string; deleted: boolean }> => {
  requireStorage();

  const deleted = await deleteFromCloudinary(D.str(publicId));

  void writeActivityLog({
    req,
    userId,
    action: 'DELETE',
    entity: 'Upload',
    entityId: publicId,
    meta: { deleted },
  });

  return { publicId: D.str(publicId), deleted: Boolean(deleted) };
};

/** Direct-to-CDN signature, so a large file never passes through the API. */
export const getSignedParams = async (userId: string, kind: string) => {
  requireStorage();

  const params = createSignedUploadParams(D.str(userId), D.str(kind) || 'common');

  return {
    ...params,
    isConfigured: true,
  };
};
