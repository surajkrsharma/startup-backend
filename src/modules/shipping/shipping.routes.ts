import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './shipping.controller';
import * as schema from './shipping.schema';

// ── Zones ─────────────────────────────────────────────────────────────────────

const router = Router();

/** GET /shipping/getZones */
router.get(
  '/getZones',
  authenticate,
  validate({ query: schema.listZonesSchema }),
  controller.zoneList,
);

/** POST /shipping/createZone — admin */
router.post(
  '/createZone',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createZoneSchema }),
  controller.zoneCreate,
);

/** PATCH /shipping/updateZone/:id — admin */
router.patch(
  '/updateZone/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema, body: schema.updateZoneSchema }),
  controller.zoneUpdate,
);

/** DELETE /shipping/deleteZone/:id — admin */
router.delete(
  '/deleteZone/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema }),
  controller.zoneDelete,
);

// ── Methods ───────────────────────────────────────────────────────────────────

/** GET /shipping/getMethods */
router.get(
  '/getMethods',
  authenticate,
  validate({ query: schema.listMethodsSchema }),
  controller.methodList,
);

/** POST /shipping/createMethod — admin */
router.post(
  '/createMethod',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createMethodSchema }),
  controller.methodCreate,
);

/** PATCH /shipping/updateMethod/:id — admin */
router.patch(
  '/updateMethod/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema, body: schema.updateMethodSchema }),
  controller.methodUpdate,
);

/** DELETE /shipping/deleteMethod/:id — admin */
router.delete(
  '/deleteMethod/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.zoneIdParamSchema }),
  controller.methodDelete,
);

// ── Partners ──────────────────────────────────────────────────────────────────

/** GET /shipping/getPartners */
router.get(
  '/getPartners',
  authenticate,
  validate({ query: schema.listMethodsSchema }),
  controller.partnerList,
);

/** POST /shipping/createPartner — admin */
router.post(
  '/createPartner',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createPartnerSchema }),
  controller.partnerCreate,
);

/** PATCH /shipping/updatePartner/:id — admin */
router.patch(
  '/updatePartner/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.partnerIdParamSchema, body: schema.updatePartnerSchema }),
  controller.partnerUpdate,
);

// ── Serviceability ────────────────────────────────────────────────────────────

/** POST /shipping/checkServiceability */
router.post(
  '/checkServiceability',
  authenticate,
  validate({ body: schema.checkServiceableSchema }),
  controller.checkServiceable,
);

/** POST /shipping/calculateRate */
router.post(
  '/calculateRate',
  authenticate,
  validate({ body: schema.calculateRateSchema }),
  controller.calculateRate,
);

// ── Shipments ─────────────────────────────────────────────────────────────────

/** POST /shipping/createShipment/:subOrderId — vendor */
router.post(
  '/createShipment/:subOrderId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, body: schema.createShipmentSchema }),
  controller.shipmentCreate,
);

/** GET /shipping/track/:awb — public */
router.get('/track/:awb', controller.shipmentTrack);

/** PATCH /shipping/updateStatus/:id */
router.patch(
  '/updateStatus/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.toggleDeliveryBoySchema }),
  controller.shipmentStatus,
);

export const shippingRoutes = router;

// ── Delivery boys ─────────────────────────────────────────────────────────────

const deliveryBoy = Router();

/** GET /deliveryBoys/getAll */
deliveryBoy.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listDeliveryBoysSchema }),
  controller.deliveryBoyList,
);

/** POST /deliveryBoys/create — admin */
deliveryBoy.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createDeliveryBoySchema }),
  controller.deliveryBoyCreate,
);

/** PATCH /deliveryBoys/update/:id — admin */
deliveryBoy.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema, body: schema.updateDeliveryBoySchema }),
  controller.deliveryBoyUpdate,
);

/** DELETE /deliveryBoys/delete/:id — admin */
deliveryBoy.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema }),
  controller.deliveryBoyDelete,
);

/** PATCH /deliveryBoys/toggleStatus/:id — admin */
deliveryBoy.patch(
  '/toggleStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.deliveryBoyIdParamSchema, body: schema.toggleDeliveryBoySchema }),
  controller.deliveryBoyToggle,
);

/** GET /deliveryBoys/getMyDeliveries */
deliveryBoy.get(
  '/getMyDeliveries',
  authenticate,
  validate({ query: schema.listDeliveryBoysSchema }),
  controller.deliveryList,
);

/** PATCH /deliveryBoys/updateDeliveryStatus/:id */
deliveryBoy.patch(
  '/updateDeliveryStatus/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.shipmentStatusSchema }),
  controller.deliveryStatusUpdate,
);

export const deliveryBoyRoutes = deliveryBoy;

// ── Settings ──────────────────────────────────────────────────────────────────

const settings = Router();

/** GET /settings/getPublicSettings */
settings.get('/getPublicSettings', controller.settingsPublic);

/** GET /settings/getAll — admin */
settings.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSettingsSchema }),
  controller.settingsList,
);

/** PATCH /settings/updateSetting — admin */
settings.patch(
  '/updateSetting',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.updateSettingSchema }),
  controller.settingsUpdate,
);

/** POST /settings/bulkUpdateSettings — admin */
settings.post(
  '/bulkUpdateSettings',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkUpdateSettingsSchema }),
  controller.settingsBulkUpdate,
);

/** GET /settings/getByCategory/:category — admin */
settings.get(
  '/getByCategory/:category',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.settingCategoryParamSchema }),
  controller.settingsByCategory,
);

/** POST /settings/resetToDefault — super admin */
settings.post(
  '/resetToDefault',
  authenticate,
  ...controller.guards.superAdmin,
  controller.settingsReset,
);

/** GET /settings/getFeatureFlags */
settings.get('/getFeatureFlags', controller.featureFlags);

/** PATCH /settings/toggleFeature — admin */
settings.patch(
  '/toggleFeature',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.toggleFeatureSchema }),
  controller.featureToggle,
);

/** GET /settings/getMaintenance */
settings.get('/getMaintenance', controller.maintenanceStatus);

/** PATCH /settings/updateMaintenance — super admin */
settings.patch(
  '/updateMaintenance',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.updateMaintenanceSchema }),
  controller.maintenanceUpdate,
);

export const settingsRoutes = settings;

// ── Admin ─────────────────────────────────────────────────────────────────────

const admin = Router();

/** GET /admin/getDashboardStats */
admin.get('/getDashboardStats', authenticate, ...controller.guards.admin, controller.dashboard);

/** GET /admin/getSystemHealth */
admin.get('/getSystemHealth', authenticate, ...controller.guards.admin, controller.health);

/** POST /admin/createSubAdmin — super admin only */
admin.post(
  '/createSubAdmin',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.createSubAdminSchema }),
  controller.subAdminCreate,
);

/** GET /admin/getAllSubAdmins */
admin.get(
  '/getAllSubAdmins',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listSettingsSchema }),
  controller.subAdminList,
);

/** PATCH /admin/updateSubAdmin/:id — super admin */
admin.patch(
  '/updateSubAdmin/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema, body: schema.updateSubAdminSchema }),
  controller.subAdminUpdate,
);

/** DELETE /admin/deleteSubAdmin/:id — super admin */
admin.delete(
  '/deleteSubAdmin/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema }),
  controller.subAdminDelete,
);

/** PATCH /admin/toggleSubAdminStatus/:id — super admin */
admin.patch(
  '/toggleSubAdminStatus/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema, body: schema.toggleFeatureSchema }),
  controller.subAdminToggle,
);

/** GET /admin/getPermissions — every role's permission matrix */
admin.get('/getPermissions', authenticate, ...controller.guards.admin, controller.allPermissions);

/** PATCH /admin/updatePermissions/:id — super admin */
admin.patch(
  '/updatePermissions/:id',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ params: idParamSchema, body: schema.setPermissionsSchema }),
  controller.permissionsSetByRole,
);

/** GET /admin/getAuditLogs */
admin.get(
  '/getAuditLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.auditLogs,
);

/** GET /admin/getActivityLogs */
admin.get(
  '/getActivityLogs',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listActivityLogsSchema }),
  controller.activityLogs,
);

/** POST /admin/clearCache — super admin */
admin.post('/clearCache', authenticate, ...controller.guards.superAdmin, controller.clearCache);

/** GET /admin/getCronJobs — super admin */
admin.get('/getCronJobs', authenticate, ...controller.guards.superAdmin, controller.cronJobs);

/** POST /admin/triggerJob — super admin */
admin.post(
  '/triggerJob',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.triggerJobSchema }),
  controller.triggerJob,
);

export const adminRoutes = admin;

// ── Audit logs ────────────────────────────────────────────────────────────────

const audit = Router();

/** GET /auditLogs/getAll */
audit.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.auditLogs,
);

/** GET /auditLogs/getById/:id */
audit.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.auditLogById,
);

/** GET /auditLogs/getByActor/:userId */
audit.get(
  '/getByActor/:userId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.actorParamSchema, query: schema.listAuditLogsSchema }),
  controller.auditLogsByActor,
);

/** GET /auditLogs/export — streams CSV */
audit.get(
  '/export',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAuditLogsSchema }),
  controller.exportAuditLogs,
);

/** DELETE /auditLogs/purge — super admin */
audit.delete(
  '/purge',
  authenticate,
  ...controller.guards.superAdmin,
  validate({ body: schema.purgeAuditLogsSchema }),
  controller.purgeAuditLogs,
);

export const auditRoutes = audit;

// ── Activity logs ─────────────────────────────────────────────────────────────

/** GET /activityLogs/getAll */
export const activityLogRoutes = Router().get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listActivityLogsSchema }),
  controller.activityLogs,
);

export default router;
