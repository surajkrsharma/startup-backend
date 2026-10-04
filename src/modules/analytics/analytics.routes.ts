import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import { uploadFiles, uploadSingle } from '../../middlewares/upload.middleware';
import { uploadRateLimit } from '../../middlewares/rateLimit.middleware';
import { UPLOAD_KIND } from '../../config/upload.config';
import * as controller from './analytics.controller';
import * as schema from './analytics.schema';

const track = Router();

track.post(
  '/event',
  optionalAuth,
  validate({ body: schema.trackEventSchema }),
  controller.trackEvent,
);

track.post(
  '/pageView',
  optionalAuth,
  validate({ body: schema.trackPageViewSchema }),
  controller.trackPageView,
);

track.post(
  '/session/start',
  optionalAuth,
  validate({ body: schema.startSessionSchema }),
  controller.startSession,
);

track.post(
  '/session/end',
  optionalAuth,
  validate({ body: schema.endSessionSchema }),
  controller.endSession,
);

track.post(
  '/device',
  optionalAuth,
  validate({ body: schema.registerDeviceSchema }),
  controller.registerDevice,
);

track.post(
  '/appInstall',
  optionalAuth,
  validate({ body: schema.appInstallSchema }),
  controller.trackAppInstall,
);

track.post(
  '/appOpen',
  optionalAuth,
  validate({ body: schema.appOpenSchema }),
  controller.trackAppOpen,
);

track.post(
  '/crash',
  optionalAuth,
  validate({ body: schema.trackCrashSchema }),
  controller.trackCrash,
);

track.post(
  '/performance',
  optionalAuth,
  validate({ body: schema.performanceSchema }),
  controller.trackPerformance,
);

track.post(
  '/error',
  optionalAuth,
  validate({ body: schema.clientErrorSchema }),
  controller.trackError,
);

track.post(
  '/funnel',
  optionalAuth,
  validate({ body: schema.funnelStepSchema }),
  controller.trackFunnel,
);

track.post(
  '/conversion',
  optionalAuth,
  validate({ body: schema.conversionSchema }),
  controller.trackConversion,
);

track.post('/click', optionalAuth, validate({ body: schema.clickSchema }), controller.trackClick);

track.post(
  '/scroll',
  optionalAuth,
  validate({ body: schema.scrollSchema }),
  controller.trackScroll,
);

track.post(
  '/search',
  optionalAuth,
  validate({ body: schema.trackSearchSchema }),
  controller.trackSearch,
);

track.post('/utm', optionalAuth, validate({ body: schema.utmSchema }), controller.trackUtm);

track.post(
  '/referrer',
  optionalAuth,
  validate({ body: schema.referrerSchema }),
  controller.trackReferrer,
);

track.post(
  '/heartbeat',
  optionalAuth,
  validate({ body: schema.heartbeatSchema }),
  controller.trackHeartbeat,
);

export const trackingRoutes = track;

const device = Router();

device.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listDevicesSchema }),
  controller.listAllDevices,
);

device.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.getDevice,
);

device.get(
  '/getByUser/:userId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deviceUserParamSchema, query: schema.listDevicesSchema }),
  controller.listUserDevices,
);

device.patch(
  '/block/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.blockDevice,
);

device.patch(
  '/unblock/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.unblockDevice,
);

device.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.deleteDevice,
);

device.get('/getTrusted', authenticate, controller.listTrustedDevices);

device.patch(
  '/trust/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.trustDevice,
);

device.patch(
  '/untrust/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.untrustDevice,
);

export const deviceRoutes = device;

const analytics = Router();

analytics.get(
  '/getOverview',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getOverview,
);

analytics.get(
  '/getVisitors',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getVisitors,
);

analytics.get(
  '/getUniqueVisitors',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getUniqueVisitors,
);

analytics.get(
  '/getPageViews',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getPageViews,
);

analytics.get(
  '/getTopPages',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.topPagesSchema }),
  controller.getTopPages,
);

analytics.get(
  '/getTrafficSources',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getTrafficSources,
);

analytics.get(
  '/getDeviceBreakdown',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getDeviceBreakdown,
);

analytics.get(
  '/getGeoBreakdown',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getGeoBreakdown,
);

analytics.get(
  '/getSessions',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.sessionsListSchema }),
  controller.getSessions,
);

analytics.get(
  '/getSessionDetail/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.sessionIdParamSchema }),
  controller.getSessionDetail,
);

analytics.get(
  '/getFunnel',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.funnelReportSchema }),
  controller.getFunnel,
);

analytics.get(
  '/getConversions',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getConversions,
);

analytics.get(
  '/getRevenueReport',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.revenueSchema }),
  controller.getRevenueReport,
);

analytics.get(
  '/getProductPerformance',
  authenticate,
  validate({ query: schema.productPerformanceSchema }),
  controller.getProductPerformance,
);

analytics.get(
  '/getVendorPerformance',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema.partial().merge(schema.paginationSchema).strict() }),
  controller.getVendorPerformance,
);

analytics.get(
  '/getCustomerCohorts',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getCustomerCohorts,
);

analytics.get(
  '/getAbandonedCarts',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.abandonedCartsSchema }),
  controller.getAbandonedCarts,
);

analytics.get(
  '/getSearchTerms',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.searchLogsSchema }),
  controller.getSearchTerms,
);

analytics.get(
  '/getZeroResultSearches',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.searchLogsSchema }),
  controller.getZeroResultSearches,
);

analytics.get('/getRealtime', authenticate, ...controller.guards.admin, controller.getRealtime);

analytics.get(
  '/getCrashes',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.crashesListSchema }),
  controller.getCrashes,
);

analytics.get(
  '/getAppVersions',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.rangeSchema }),
  controller.getAppVersions,
);

analytics.get(
  '/export',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.exportAnalyticsSchema }),
  controller.exportAnalytics,
);

analytics.get('/funnels', authenticate, ...controller.guards.admin, controller.listFunnels);

analytics.post(
  '/funnels',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createFunnelSchema }),
  controller.createFunnel,
);

analytics.patch(
  '/funnels/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.funnelIdParamSchema, body: schema.updateFunnelSchema }),
  controller.updateFunnel,
);

export const analyticsRoutes = analytics;

const search = Router();

search.get(
  '/global',
  optionalAuth,
  validate({ query: schema.globalSearchSchema }),
  controller.globalSearch,
);

search.get(
  '/autocomplete',
  optionalAuth,
  validate({ query: schema.globalSearchSchema }),
  controller.autocomplete,
);

search.get(
  '/products',
  optionalAuth,
  validate({ query: schema.searchProductsSchema }),
  controller.searchProducts,
);

search.get(
  '/vendors',
  optionalAuth,
  validate({ query: schema.searchVendorsSchema }),
  controller.searchVendors,
);

search.get(
  '/trending',
  optionalAuth,
  validate({ query: schema.trendingSearchSchema }),
  controller.getTrending,
);

search.get('/recent', authenticate, controller.getRecent);

search.delete('/recent/clear', authenticate, controller.clearRecent);

export const searchRoutes = search;

const upload = Router();

upload.post(
  '/uploadImage',
  authenticate,
  uploadRateLimit,
  uploadFiles(UPLOAD_KIND.IMAGE, 'files'),
  controller.uploadImage,
);

upload.post(
  '/uploadImage/single',
  authenticate,
  uploadRateLimit,
  uploadSingle(UPLOAD_KIND.IMAGE, 'file'),
  controller.uploadImage,
);

upload.post(
  '/uploadVideo',
  authenticate,
  uploadRateLimit,
  uploadFiles(UPLOAD_KIND.VIDEO, 'files'),
  controller.uploadVideo,
);

upload.post(
  '/uploadDocument',
  authenticate,
  uploadRateLimit,
  uploadFiles(UPLOAD_KIND.DOCUMENT, 'files'),
  controller.uploadDocument,
);

upload.post(
  '/uploadMultiple',
  authenticate,
  uploadRateLimit,
  uploadFiles(UPLOAD_KIND.IMAGE, 'files'),
  controller.uploadMultiple,
);

upload.post(
  '/deleteFile',
  authenticate,
  validate({ body: schema.deleteFileSchema }),
  controller.removeFile,
);

upload.get(
  '/getSignedUrl',
  authenticate,
  validate({ query: schema.signedUrlSchema }),
  controller.getSignedUrl,
);

export const uploadRoutes = upload;
