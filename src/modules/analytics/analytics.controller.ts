import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import { UPLOAD_KIND } from '../../config/upload.config';
import { getUploadedFiles } from '../../middlewares/upload.middleware';
import * as service from './analytics.service';

const userId = (req: Request): string => req.auth!.userId;
const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
};

/**
 * @openapi
 * /track/event:
 *   post:
 *     tags: [Tracking]
 *     summary: Report a behaviour event
 *     description: Unknown event names are refused so analytics stay clean.
 *     responses:
 *       201: { description: Event recorded }
 *       400: { description: Unknown event name }
 */
export const trackEvent = asyncHandler(async (req, res) => {
  const result = await service.trackEvent(
    {
      name: D.str(req.body.name),
      sessionKey: D.str(req.body.sessionKey ?? req.sessionKey),
      meta: req.body.meta,
      userId: req.auth?.userId,
      deviceId: D.str(req.deviceId),
    },
    req,
  );

  return ApiResponse.created(res, SUCCESS.TRACK.EVENT_TRACKED, result);
});

/**
 * @openapi
 * /track/pageView:
 *   post:
 *     tags: [Tracking]
 *     summary: Record a page view
 *     responses:
 *       201: { description: View recorded }
 */
export const trackPageView = asyncHandler(async (req, res) => {
  const result = await service.trackPageView(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.PAGE_VIEW_TRACKED, result);
});

export const startSession = asyncHandler(async (req, res) => {
  const result = await service.startSession(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.SESSION_STARTED, result);
});

export const endSession = asyncHandler(async (req, res) => {
  const result = await service.endSession(req.body, req);
  return ApiResponse.success(res, { message: SUCCESS.TRACK.SESSION_ENDED, result });
});

/**
 * @openapi
 * /track/crash:
 *   post:
 *     tags: [Tracking]
 *     summary: Report a client crash
 *     responses:
 *       201: { description: Crash recorded }
 */
export const trackCrash = asyncHandler(async (req, res) => {
  const result = await service.trackCrash(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.CRASH_TRACKED, result);
});

export const trackPerformance = asyncHandler(async (req, res) => {
  const result = await service.trackPerformance(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.PERFORMANCE_TRACKED, result);
});

export const trackError = asyncHandler(async (req, res) => {
  const result = await service.trackClientError(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.ERROR_TRACKED, result);
});

export const trackFunnel = asyncHandler(async (req, res) => {
  const result = await service.trackFunnelStep(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.FUNNEL_TRACKED, result);
});

export const trackConversion = asyncHandler(async (req, res) => {
  const result = await service.trackConversion(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.CONVERSION_TRACKED, result);
});

export const trackClick = asyncHandler(async (req, res) => {
  const result = await service.trackClick(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.CLICK_TRACKED, result);
});

export const trackScroll = asyncHandler(async (req, res) => {
  const result = await service.trackScroll(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.SCROLL_TRACKED, result);
});

export const trackSearch = asyncHandler(async (req, res) => {
  const result = await service.trackSearch(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.SEARCH_TRACKED, result);
});

export const trackUtm = asyncHandler(async (req, res) => {
  const result = await service.trackUtm(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.UTM_TRACKED, result);
});

export const trackReferrer = asyncHandler(async (req, res) => {
  const result = await service.trackReferrer(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.REFERRER_TRACKED, result);
});

export const trackHeartbeat = asyncHandler(async (req, res) => {
  const result = await service.trackHeartbeat(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.HEARTBEAT, result);
});

export const trackAppInstall = asyncHandler(async (req, res) => {
  const result = await service.trackAppInstall(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.APP_INSTALL_TRACKED, result);
});

export const trackAppOpen = asyncHandler(async (req, res) => {
  const result = await service.trackAppOpen(req.body, req);
  return ApiResponse.created(res, SUCCESS.TRACK.APP_OPEN_TRACKED, result);
});

export const registerDevice = asyncHandler(async (req, res) => {
  const row = await service.registerDevice(req.body, req.auth?.userId, req);

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.DEVICE_REGISTERED,
    result: serializeDevice(row),
  });
});

export const listAllDevices = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listAllDevices({ ...(req.query as any), skip, take });

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.paginated(res, {
    message: SUCCESS.DEVICE.FETCHED,
    result: { deviceList: rows.map(serializeDevice) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getDevice = asyncHandler(async (req, res) => {
  const row = await service.getDeviceById(D.str(req.params.id));

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.RETRIEVED,
    result: serializeDevice(row),
  });
});

export const listUserDevices = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listDevicesByUser(D.str(req.params.userId), {
    ...(req.query as any),
    skip,
    take,
  });

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.paginated(res, {
    message: SUCCESS.DEVICE.USER_DEVICES_FETCHED,
    result: { deviceList: rows.map(serializeDevice) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const blockDevice = asyncHandler(async (req, res) => {
  const row = await service.toggleDeviceBlock(D.str(req.params.id), true, req);

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.BLOCKED,
    result: serializeDevice(row),
  });
});

export const unblockDevice = asyncHandler(async (req, res) => {
  const row = await service.toggleDeviceBlock(D.str(req.params.id), false, req);

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.UNBLOCKED,
    result: serializeDevice(row),
  });
});

export const deleteDevice = asyncHandler(async (req, res) => {
  const result = await service.removeDevice(D.str(req.params.id));
  return ApiResponse.success(res, { message: SUCCESS.DEVICE.DELETED, result });
});

export const listTrustedDevices = asyncHandler(async (req, res) => {
  const rows = await service.listTrustedDevices(userId(req));

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.TRUSTED_FETCHED,
    result: { deviceCount: rows.length, deviceList: rows.map(serializeDevice) },
  });
});

export const trustDevice = asyncHandler(async (req, res) => {
  const row = await service.setDeviceTrusted(D.str(req.params.id), true);

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.TRUST_UPDATED,
    result: serializeDevice(row),
  });
});

export const untrustDevice = asyncHandler(async (req, res) => {
  const row = await service.setDeviceTrusted(D.str(req.params.id), false);

  const { serializeDevice } = await import('../../utils/serialize');
  return ApiResponse.success(res, {
    message: SUCCESS.DEVICE.TRUST_UPDATED,
    result: serializeDevice(row),
  });
});

export const getOverview = asyncHandler(async (req, res) => {
  const result = await service.getOverview(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.OVERVIEW_FETCHED, result });
});

export const getVisitors = asyncHandler(async (req, res) => {
  const result = await service.getVisitors(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.VISITORS_FETCHED, result });
});

export const getUniqueVisitors = asyncHandler(async (req, res) => {
  const result = await service.getUniqueVisitors(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.VISITORS_FETCHED, result });
});

export const getPageViews = asyncHandler(async (req, res) => {
  const result = await service.getPageViews(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.PAGE_VIEWS_FETCHED, result });
});

export const getTopPages = asyncHandler(async (req, res) => {
  const rows = await service.getTopPages(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.ANALYTICS.TOP_PAGES_FETCHED,
    result: { pageCount: rows.length, pageList: rows },
  });
});

export const getTrafficSources = asyncHandler(async (req, res) => {
  const rows = await service.getTrafficSources(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.ANALYTICS.TRAFFIC_SOURCES_FETCHED,
    result: { sourceCount: rows.length, sourceList: rows },
  });
});

export const getDeviceBreakdown = asyncHandler(async (req, res) => {
  const result = await service.getDeviceBreakdown(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.DEVICE_BREAKDOWN_FETCHED, result });
});

export const getGeoBreakdown = asyncHandler(async (req, res) => {
  const rows = await service.getGeoBreakdown(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.ANALYTICS.GEO_BREAKDOWN_FETCHED,
    result: { countryCount: rows.length, countryList: rows },
  });
});

export const getSessions = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listSessionRows({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.SESSIONS_FETCHED,
    result: {
      sessionList: rows.map((s: any) => ({
        sessionId: D.str(s.id),
        sessionKey: D.str(s.sessionKey),
        deviceId: D.str(s.deviceId),
        platform: D.str(s.platform),
        isActive: D.bool(s.isActive),
        startedAt: D.date(s.startedAt),
        lastSeenAt: D.date(s.lastSeenAt),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getSessionDetail = asyncHandler(async (req, res) => {
  const result = await service.getSessionDetail(D.str(req.params.id));
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.SESSION_DETAIL_FETCHED, result });
});

export const getFunnel = asyncHandler(async (req, res) => {
  const result = await service.getFunnel(
    D.str(req.query.slug as string) || D.str(req.query.funnel as string),
    req.query,
  );
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.FUNNEL_FETCHED, result });
});

export const getConversions = asyncHandler(async (req, res) => {
  const result = await service.getConversions(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.CONVERSIONS_FETCHED, result });
});

export const getRevenueReport = asyncHandler(async (req, res) => {
  const result = await service.getRevenue(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.REVENUE_FETCHED, result });
});

export const getProductPerformance = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const isVendor = req.auth!.role === 'VENDOR';

  const { rows, total } = await service.getProductPerformance(
    { ...(req.query as any), skip, take },
    isVendor ? vendorId(req) : undefined,
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.PRODUCT_PERFORMANCE_FETCHED,
    result: { productList: rows },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getVendorPerformance = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.getVendorPerformance({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.VENDOR_PERFORMANCE_FETCHED,
    result: { vendorList: rows },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getCustomerCohorts = asyncHandler(async (req, res) => {
  const result = await service.getCohorts(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.COHORTS_FETCHED, result });
});

export const getAbandonedCarts = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total, value } = await service.getAbandonedCarts({
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.ABANDONED_CARTS_FETCHED,
    result: { totalValue: D.float(value), cartList: rows },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getSearchTerms = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.getSearchTerms({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.SEARCH_TERMS_FETCHED,
    result: {
      termList: rows.map((r: any) => ({
        searchLogId: D.str(r.id),
        term: D.str(r.term),
        resultCount: D.num(r.resultCount),
        hasResults: D.bool(r.hasResults),
        createdAt: D.date(r.createdAt),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getZeroResultSearches = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.getSearchTerms({
    ...(req.query as any),
    hasResults: 'false',
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.ZERO_RESULT_SEARCHES_FETCHED,
    result: {
      termList: rows.map((r: any) => ({
        searchLogId: D.str(r.id),
        term: D.str(r.term),
        resultCount: D.num(r.resultCount),
        hasResults: D.bool(r.hasResults),
        createdAt: D.date(r.createdAt),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getRealtime = asyncHandler(async (_req, res) => {
  const result = await service.getRealtime();
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.REALTIME_FETCHED, result });
});

export const getCrashes = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listCrashes({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ANALYTICS.CRASHES_FETCHED,
    result: {
      crashList: rows.map((c: any) => ({
        crashId: D.str(c.id),
        deviceId: D.str(c.deviceId),
        platform: D.str(c.platform),
        appVersion: D.str(c.appVersion),
        errorMessage: D.str(c.errorMessage),
        errorType: D.str(c.errorType),
        createdAt: D.date(c.createdAt),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getAppVersions = asyncHandler(async (req, res) => {
  const result = await service.getAppVersions(req.query);
  return ApiResponse.success(res, { message: SUCCESS.ANALYTICS.APP_VERSIONS_FETCHED, result });
});

export const exportAnalytics = asyncHandler(async (req, res) => {
  const { columns, rows, truncated } = await service.exportAnalytics(req.query);

  const csv = [columns.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="analytics.csv"');

  res.setHeader('X-Truncated', String(truncated));

  return res.status(200).send(csv);
});

export const listFunnels = asyncHandler(async (_req, res) => {
  const rows = await service.listFunnels();

  return ApiResponse.success(res, {
    message: SUCCESS.ANALYTICS.FUNNEL_FETCHED,
    result: {
      funnelCount: rows.length,
      funnelList: rows.map((f: any) => ({
        funnelId: D.str(f.id),
        name: D.str(f.name),
        slug: D.str(f.slug),
        description: D.str(f.description),
        isActive: D.bool(f.isActive),
        stepCount: D.arr(f.steps).length,
        stepList: D.arr(f.steps).map((s: any) => ({
          stepId: D.str(s.id),
          name: D.str(s.name),
          eventName: D.str(s.eventName),
          sortOrder: D.num(s.sortOrder),
        })),
      })),
    },
  });
});

export const createFunnel = asyncHandler(async (req, res) => {
  const row = await service.createFunnel(req.body, req);

  return ApiResponse.created(res, SUCCESS.COMMON.CREATED, {
    funnelId: D.str(row.id),
    name: D.str(row.name),
    slug: D.str(row.slug),
  });
});

export const updateFunnel = asyncHandler(async (req, res) => {
  const row = await service.updateFunnel(D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.UPDATED,
    result: { funnelId: D.str(row.id), isActive: D.bool(row.isActive) },
  });
});

/**
 * @openapi
 * /search/global:
 *   get:
 *     tags: [Search]
 *     summary: Global search across products, vendors and categories
 *     responses:
 *       200: { description: Grouped results }
 */
export const globalSearch = asyncHandler(async (req, res) => {
  const result = await service.globalSearch(req.query, req);
  return ApiResponse.success(res, { message: SUCCESS.SEARCH.GLOBAL_FETCHED, result });
});

export const searchProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.searchProducts({ ...(req.query as any), skip, take }, req);

  const { serializeProductSummary } = await import('../product/product.serializer');

  return ApiResponse.paginated(res, {
    message: SUCCESS.SEARCH.PRODUCTS_FETCHED,
    result: { productList: rows.map(serializeProductSummary) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const searchVendors = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.searchVendors({ ...(req.query as any), skip, take });

  const { serializeVendor } = await import('../../utils/serialize');

  return ApiResponse.paginated(res, {
    message: SUCCESS.SEARCH.VENDORS_FETCHED,
    result: { vendorList: rows.map(serializeVendor) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const autocomplete = asyncHandler(async (req, res) => {
  const rows = await service.getSuggestions(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.SEARCH.SUGGESTIONS_FETCHED,
    result: { itemCount: rows.length, suggestionList: rows },
  });
});

export const getTrending = asyncHandler(async (req, res) => {
  const rows = await service.getTrendingSearches(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.SEARCH.TRENDING_FETCHED,
    result: { itemCount: rows.length, termList: rows },
  });
});

export const getRecent = asyncHandler(async (req, res) => {
  const rows = await service.getRecentSearches(userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.SEARCH.RECENT_FETCHED,
    result: { itemCount: rows.length, termList: rows },
  });
});

export const clearRecent = asyncHandler(async (req, res) => {
  const count = await service.clearRecentSearches(userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.SEARCH.RECENT_CLEARED,
    result: { clearedCount: D.num(count) },
  });
});

/**
 * @openapi
 * /uploads/uploadImage:
 *   post:
 *     tags: [Upload]
 *     summary: Upload one or more images
 *     responses:
 *       201: { description: Uploaded asset descriptors }
 *       413: { description: File too large }
 *       415: { description: Unsupported type }
 */
export const uploadImage = asyncHandler(async (req, res) => {
  const result = await service.uploadFiles(
    getUploadedFiles(req),
    UPLOAD_KIND.IMAGE,
    req.auth?.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.UPLOAD.IMAGE_UPLOADED, result);
});

export const uploadVideo = asyncHandler(async (req, res) => {
  const result = await service.uploadFiles(
    getUploadedFiles(req),
    UPLOAD_KIND.VIDEO,
    req.auth?.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.UPLOAD.VIDEO_UPLOADED, result);
});

export const uploadDocument = asyncHandler(async (req, res) => {
  const result = await service.uploadFiles(
    getUploadedFiles(req),
    UPLOAD_KIND.DOCUMENT,
    req.auth?.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.UPLOAD.DOCUMENT_UPLOADED, result);
});

export const uploadMultiple = asyncHandler(async (req, res) => {
  const result = await service.uploadFiles(
    getUploadedFiles(req),
    UPLOAD_KIND.IMAGE,
    req.auth?.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.UPLOAD.MULTIPLE_UPLOADED, result);
});

export const removeFile = asyncHandler(async (req, res) => {
  const result = await service.deleteFile(D.str(req.body.publicId), req.auth?.userId, req);
  return ApiResponse.success(res, { message: SUCCESS.UPLOAD.DELETED, result });
});

/**
 * @openapi
 * /uploads/getSignedUrl:
 *   get:
 *     tags: [Upload]
 *     summary: Direct-to-CDN upload signature
 *     description: Lets a large file bypass the API entirely.
 *     responses:
 *       200: { description: Signature and upload parameters }
 *       503: { description: Storage not configured }
 */
export const getSignedUrl = asyncHandler(async (req, res) => {
  const result = await service.getSignedParams(
    userId(req),
    D.str(req.query?.kind as string) || 'common',
  );
  return ApiResponse.success(res, { message: SUCCESS.UPLOAD.SIGNED_URL_FETCHED, result });
});
