import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './shipping.controller';
import * as schema from './shipping.schema';

const router = Router();

router.get(
  '/getZones',
  authenticate,
  validate({ query: schema.listZonesSchema }),
  controller.zoneList,
);

router.post(
  '/createZone',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createZoneSchema }),
  controller.zoneCreate,
);

router.patch(
  '/updateZone/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema, body: schema.updateZoneSchema }),
  controller.zoneUpdate,
);

router.delete(
  '/deleteZone/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema }),
  controller.zoneDelete,
);

router.get(
  '/getMethods',
  authenticate,
  validate({ query: schema.listMethodsSchema }),
  controller.methodList,
);

router.post(
  '/createMethod',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createMethodSchema }),
  controller.methodCreate,
);

router.patch(
  '/updateMethod/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema, body: schema.updateMethodSchema }),
  controller.methodUpdate,
);

router.delete(
  '/deleteMethod/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema }),
  controller.methodDelete,
);

router.get(
  '/getPartners',
  authenticate,
  validate({ query: schema.listMethodsSchema }),
  controller.partnerList,
);

router.post(
  '/createPartner',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createPartnerSchema }),
  controller.partnerCreate,
);

router.patch(
  '/updatePartner/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.partnerIdParamSchema, body: schema.updatePartnerSchema }),
  controller.partnerUpdate,
);

router.post(
  '/checkServiceability',
  authenticate,
  validate({ body: schema.checkServiceableSchema }),
  controller.checkServiceable,
);

router.post(
  '/calculateRate',
  authenticate,
  validate({ body: schema.calculateRateSchema }),
  controller.calculateRate,
);

router.post(
  '/createShipment/:subOrderId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: schema.subOrderIdParamSchema, body: schema.createShipmentSchema }),
  controller.shipmentCreate,
);

router.get('/track/:awb', validate({ params: schema.awbParamSchema }), controller.shipmentTrack);

router.patch(
  '/updateStatus/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.toggleDeliveryBoySchema }),
  controller.shipmentStatus,
);

export const shippingRoutes = router;

const deliveryBoy = Router();

deliveryBoy.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listDeliveryBoysSchema }),
  controller.deliveryBoyList,
);

deliveryBoy.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createDeliveryBoySchema }),
  controller.deliveryBoyCreate,
);

deliveryBoy.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema, body: schema.updateDeliveryBoySchema }),
  controller.deliveryBoyUpdate,
);

deliveryBoy.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema }),
  controller.deliveryBoyDelete,
);

deliveryBoy.patch(
  '/toggleStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema, body: schema.toggleDeliveryBoySchema }),
  controller.deliveryBoyToggle,
);

deliveryBoy.get(
  '/getMyDeliveries',
  authenticate,
  validate({ query: schema.listDeliveryBoysSchema }),
  controller.deliveryList,
);

deliveryBoy.patch(
  '/updateDeliveryStatus/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.shipmentStatusSchema }),
  controller.deliveryStatusUpdate,
);

export const deliveryBoyRoutes = deliveryBoy;

const settings = Router();

settings.get('/getPublicSettings', controller.settingsPublic);

settings.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSettingsSchema }),
  controller.settingsList,
);

settings.patch(
  '/updateSetting',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.updateSettingSchema }),
  controller.settingsUpdate,
);

settings.post(
  '/bulkUpdateSettings',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkUpdateSettingsSchema }),
  controller.settingsBulkUpdate,
);

settings.get(
  '/getByCategory/:category',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.settingCategoryParamSchema }),
  controller.settingsByCategory,
);

settings.post(
  '/resetToDefault',
  authenticate,
  ...controller.guards.superAdmin,
  controller.settingsReset,
);

settings.get('/getFeatureFlags', controller.featureFlags);

settings.patch(
  '/toggleFeature',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.toggleFeatureSchema }),
  controller.featureToggle,
);

settings.get('/getMaintenance', controller.maintenanceStatus);

settings.patch(
  '/updateMaintenance',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.updateMaintenanceSchema }),
  controller.maintenanceUpdate,
);

export const settingsRoutes = settings;

const admin = Router();

admin.get('/getDashboardStats', authenticate, ...controller.guards.admin, controller.dashboard);

admin.get('/getSystemHealth', authenticate, ...controller.guards.admin, controller.health);

admin.post(
  '/createSubAdmin',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.createSubAdminSchema }),
  controller.subAdminCreate,
);

admin.get(
  '/getAllSubAdmins',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSettingsSchema }),
  controller.subAdminList,
);

admin.patch(
  '/updateSubAdmin/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema, body: schema.updateSubAdminSchema }),
  controller.subAdminUpdate,
);

admin.delete(
  '/deleteSubAdmin/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema }),
  controller.subAdminDelete,
);

admin.patch(
  '/toggleSubAdminStatus/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema, body: schema.toggleFeatureSchema }),
  controller.subAdminToggle,
);

admin.get('/getPermissions', authenticate, ...controller.guards.admin, controller.allPermissions);

admin.patch(
  '/updatePermissions/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.roleIdParamSchema, body: schema.setPermissionsSchema }),
  controller.permissionsSetByRole,
);

admin.get(
  '/getAuditLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.auditLogs,
);

admin.get(
  '/getActivityLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listActivityLogsSchema }),
  controller.activityLogs,
);

admin.post('/clearCache', authenticate, ...controller.guards.superAdmin, controller.clearCache);

admin.get('/getCronJobs', authenticate, ...controller.guards.superAdmin, controller.cronJobs);

admin.post(
  '/triggerJob',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.triggerJobSchema }),
  controller.triggerJob,
);

admin.get(
  '/getFailedJobs',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ query: schema.listFailedJobsSchema }),
  controller.failedJobs,
);

admin.post(
  '/retryFailedJob/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.failedJobIdParamSchema }),
  controller.retryFailedJob,
);

admin.patch(
  '/resolveFailedJob/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.failedJobIdParamSchema }),
  controller.resolveFailedJob,
);

admin.delete(
  '/deleteFailedJob/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: schema.failedJobIdParamSchema }),
  controller.deleteFailedJob,
);

export const adminRoutes = admin;

const audit = Router();

audit.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.auditLogs,
);

audit.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.auditLogById,
);

audit.get(
  '/getByActor/:userId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.actorParamSchema, query: schema.listAuditLogsSchema }),
  controller.auditLogsByActor,
);

audit.get(
  '/export',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.exportAuditLogs,
);

audit.delete(
  '/purge',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.purgeAuditLogsSchema }),
  controller.purgeAuditLogs,
);

export const auditRoutes = audit;

export const activityLogRoutes = Router().get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listActivityLogsSchema }),
  controller.activityLogs,
);

export default router;
