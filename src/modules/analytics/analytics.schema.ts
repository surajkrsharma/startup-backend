import { z } from 'zod';
import { Platform } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { NAME } from '../../config/password.config';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;

export const trackEventSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.REQUIRED('name')).max(60),
    sessionKey: z.string().trim().max(120).optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export const trackPageViewSchema = z
  .object({
    pageUrl: z.string().trim().min(1, VALIDATION.REQUIRED('pageUrl')).max(500),
    pageTitle: z.string().trim().max(200).optional(),
    timeOnPage: z.coerce.number().int().min(0).optional(),
    scrollDepth: z.coerce.number().int().min(0).max(100).optional(),
    referrer: z.string().trim().max(500).optional(),
    deviceType: z.string().trim().max(40).optional(),
    platform: z.nativeEnum(Platform).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const trackCrashSchema = z
  .object({
    errorMessage: z.string().trim().min(3, VALIDATION.REQUIRED('errorMessage')).max(1000),
    errorType: z.string().trim().max(200).optional(),
    stack: z.string().trim().max(4000).optional(),
    breadcrumbs: z.array(z.string().trim().max(300)).max(50).optional(),
    meta: z.record(z.unknown()).optional(),
    appVersion: z.string().trim().max(30).optional(),
    platform: z.nativeEnum(Platform).optional(),
    deviceId: z.string().trim().max(120).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const registerDeviceSchema = z
  .object({
    deviceId: z.string().trim().min(4, VALIDATION.REQUIRED('deviceId')).max(120),
    platform: z.nativeEnum(Platform).optional(),
    os: z.string().trim().max(60).optional(),
    osVersion: z.string().trim().max(30).optional(),
    browser: z.string().trim().max(60).optional(),
    browserVersion: z.string().trim().max(30).optional(),
    model: z.string().trim().max(80).optional(),
    manufacturer: z.string().trim().max(80).optional(),
    fcmToken: z.string().trim().max(400).optional(),
    appVersion: z.string().trim().max(30).optional(),
    locale: z.string().trim().max(20).optional(),
    timezone: z.string().trim().max(60).optional(),
    screenWidth: z.coerce.number().int().min(0).optional(),
    screenHeight: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const deviceIdParamSchema = z.object({ deviceId: z.string().trim().min(4).max(120) });

export const startSessionSchema = z
  .object({
    sessionKey: z.string().trim().max(120).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    referrer: z.string().trim().max(500).optional(),
    utm: z.record(z.string().max(120)).optional(),
  })
  .strict();

export const endSessionSchema = z
  .object({
    sessionKey: z.string().trim().max(120).optional(),
    durationSec: z.coerce.number().int().min(0).max(86_400).optional(),
  })
  .strict();

export const appInstallSchema = z
  .object({
    deviceId: z.string().trim().max(120).optional(),
    platform: z.nativeEnum(Platform).optional(),
    appVersion: z.string().trim().min(1, VALIDATION.REQUIRED('appVersion')).max(30),
    referrer: z.string().trim().max(500).optional(),
    campaign: z.string().trim().max(120).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const appOpenSchema = z
  .object({
    appVersion: z.string().trim().max(30).optional(),
    isFromBackground: z.boolean().optional(),
    durationSec: z.coerce.number().int().min(0).max(86_400).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const performanceSchema = z
  .object({
    metric: z.enum(['load', 'render', 'network', 'fcp', 'lcp', 'cls', 'inp', 'ttfb', 'memory']),
    value: z.coerce.number().min(0),
    unit: z.string().trim().max(20).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    appVersion: z.string().trim().max(30).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const clientErrorSchema = z
  .object({
    message: z.string().trim().min(1, VALIDATION.REQUIRED('message')).max(1000),
    type: z.string().trim().max(200).optional(),
    stack: z.string().trim().max(4000).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    meta: z.record(z.unknown()).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const funnelStepSchema = z
  .object({
    funnelId: z.string().trim().min(1, VALIDATION.REQUIRED('funnelId')).max(140),
    stepId: z.string().trim().max(140).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const conversionSchema = funnelStepSchema
  .extend({
    value: z.coerce.number().min(0).optional(),
    currency: z.string().trim().max(8).optional(),
    orderId: id.optional(),
  })
  .strict();

export const clickSchema = z
  .object({
    x: z.coerce.number().int().min(0).optional(),
    y: z.coerce.number().int().min(0).optional(),
    element: z.string().trim().max(80).optional(),
    target: z.string().trim().max(200).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const scrollSchema = z
  .object({
    depth: z.coerce.number().int().min(0).max(100),
    pageUrl: z.string().trim().max(500).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const trackSearchSchema = z
  .object({
    term: z.string().trim().min(1, VALIDATION.REQUIRED('term')).max(120),
    resultCount: z.coerce.number().int().min(0).optional(),
    filters: z.record(z.unknown()).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const utmSchema = z
  .object({
    source: z.string().trim().min(1, VALIDATION.REQUIRED('source')).max(120),
    medium: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(120).optional(),
    term: z.string().trim().max(120).optional(),
    content: z.string().trim().max(120).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const referrerSchema = z
  .object({
    referrer: z.string().trim().max(500).optional(),
    pageUrl: z.string().trim().max(500).optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const heartbeatSchema = z
  .object({
    screenName: z.string().trim().max(80).optional(),
    isForeground: z.boolean().optional(),
    sessionKey: z.string().trim().max(120).optional(),
  })
  .strict();

export const listDevicesSchema = z
  .object({
    platform: z.nativeEnum(Platform).optional(),
    isBlocked: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const deviceUserParamSchema = z.object({ userId: id });

export const rangeSchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict();

export const analyticsListSchema = rangeSchema.merge(
  z
    .object({
      platform: z.nativeEnum(Platform).optional(),
    })
    .partial(),
);

export const topPagesSchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const revenueSchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    vendorId: id.optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional(),
  })
  .strict();

export const productPerformanceSchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    vendorId: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sort: z.enum(['revenue', 'qty', 'views', 'rating']).optional(),
  })
  .merge(paginationSchema)
  .partial()
  .strict();

export const abandonedCartsSchema = z
  .object({
    minAgeHours: z.coerce.number().int().min(1).max(720).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const sessionsListSchema = rangeSchema
  .extend({
    platform: z.nativeEnum(Platform).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const sessionIdParamSchema = z.object({ id: common.cuid });

export const crashesListSchema = rangeSchema
  .extend({
    platform: z.nativeEnum(Platform).optional(),
    appVersion: z.string().trim().max(30).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const exportAnalyticsSchema = rangeSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(50_000).optional(),
  })
  .strict();

export const funnelReportSchema = rangeSchema
  .extend({
    slug: z.string().trim().max(140).optional(),
    funnel: z.string().trim().max(140).optional(),
  })
  .strict();

export { paginationSchema };

export const listFunnelsSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createFunnelSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.TITLE_MAX_LENGTH),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    isActive: z.boolean().optional().default(true),
    steps: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(120),
            eventName: z.string().trim().min(2).max(60),
          })
          .strict(),
      )
      .min(2, 'A funnel needs at least two steps.')
      .max(12),
  })
  .strict();

export const funnelSlugParamSchema = z.object({ slug: common.cuidOrSlug });
export const funnelIdParamSchema = z.object({ id: common.cuid });

export const updateFunnelSchema = z
  .object({
    name: z.string().trim().min(2).max(NAME.TITLE_MAX_LENGTH).optional(),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const globalSearchSchema = z
  .object({
    q: z.string().trim().min(1, VALIDATION.REQUIRED('q')).max(120),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    types: z.enum(['all', 'product', 'vendor', 'category']).optional(),
  })
  .strict();

export const searchProductsSchema = z
  .object({
    q: z.string().trim().min(1, VALIDATION.REQUIRED('q')).max(120),
    categoryId: id.optional(),
    vendorId: id.optional(),
    brandId: id.optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    inStock: z.enum(['true', 'false']).optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating', 'newest']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const searchVendorsSchema = z
  .object({
    q: z.string().trim().min(1, VALIDATION.REQUIRED('q')).max(120),
    isActive: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const trendingSearchSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
    days: z.coerce.number().int().min(1).max(90).optional(),
  })
  .strict();

export const searchLogsSchema = z
  .object({
    hasResults: z.enum(['true', 'false']).optional(),
    term: z.string().trim().max(120).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const uploadResultSchema = z
  .object({
    publicId: z.string().trim().max(200).optional(),
    folder: z.string().trim().max(100).optional(),
  })
  .strict();

export const signedUrlSchema = z
  .object({
    kind: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'CSV', 'KYC', 'CHAT']).optional(),
    publicId: z.string().trim().max(200).optional(),
  })
  .strict();

export const deleteFileSchema = z
  .object({
    publicId: z.string().trim().min(1, VALIDATION.REQUIRED('publicId')).max(200),
  })
  .strict();
