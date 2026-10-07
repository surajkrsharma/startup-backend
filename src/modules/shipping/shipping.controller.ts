import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './shipping.service';
import {
  serializeShippingZone,
  serializeShippingMethod,
  serializeShippingPartner,
  serializeDeliveryBoy,
  serializeDelivery,
  serializeShipment,
  serializeSystemSetting,
  serializeAuditLog,
  serializeActivityLog,
  serializeFailedJobList,
  serializeUser,
} from '../../utils/serialize';

const actorId = (req: Request): string => req.auth!.userId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  superAdmin: [requireRole(ROLES.SUPER_ADMIN)],
  vendor: [requireRole(ROLES.VENDOR)],
};

/**
 * @openapi
 * /shipping/zones/getAll:
 *   get:
 *     tags: [Shipping]
 *     summary: List shipping zones with their methods
 *     responses:
 *       200: { description: Paginated zones }
 */
export const zoneList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listZones({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.SHIPPING.ZONES_FETCHED,
    result: { itemList: rows.map(serializeShippingZone) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /shipping/zones/createZone:
 *   post:
 *     tags: [Shipping]
 *     summary: Create a shipping zone (admin)
 *     responses:
 *       201: { description: Zone created }
 */
export const zoneCreate = asyncHandler(async (req, res) => {
  const row = await service.createZone(req.body, req);
  return ApiResponse.created(res, SUCCESS.SHIPPING.ZONE_CREATED, serializeShippingZone(row));
});

/**
 * @openapi
 * /shipping/zones/updateZone/:id:
 *   patch:
 *     tags: [Shipping]
 *     summary: Update a shipping zone (admin)
 *     responses:
 *       200: { description: Zone updated }
 */
export const zoneUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateZone(D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.ZONE_UPDATED,
    result: serializeShippingZone(row),
  });
});

/**
 * @openapi
 * /shipping/zones/deleteZone/:id:
 *   delete:
 *     tags: [Shipping]
 *     summary: Delete a zone; its methods are detached, not removed
 *     responses:
 *       200: { description: Zone deleted }
 */
export const zoneDelete = asyncHandler(async (req, res) => {
  await service.deleteZone(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.ZONE_DELETED,
    result: { id: D.str(req.params.id) },
  });
});

export const methodList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listMethods({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.SHIPPING.METHODS_FETCHED,
    result: { itemList: rows.map(serializeShippingMethod) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const methodCreate = asyncHandler(async (req, res) => {
  const row = await service.createMethod(req.body, req);
  return ApiResponse.created(res, SUCCESS.SHIPPING.METHOD_CREATED, serializeShippingMethod(row));
});

export const methodUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateMethod(D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.METHOD_UPDATED,
    result: serializeShippingMethod(row),
  });
});

export const methodDelete = asyncHandler(async (req, res) => {
  await service.deleteMethod(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.METHOD_DELETED,
    result: { id: D.str(req.params.id) },
  });
});

export const partnerList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listPartners({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.SHIPPING.PARTNERS_FETCHED,
    result: { itemList: rows.map(serializeShippingPartner) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const partnerCreate = asyncHandler(async (req, res) => {
  const row = await service.createPartner(req.body, req);
  return ApiResponse.created(res, SUCCESS.SHIPPING.PARTNER_CREATED, serializeShippingPartner(row));
});

export const partnerUpdate = asyncHandler(async (req, res) => {
  const row = await service.updatePartner(D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.PARTNER_CREATED,
    result: serializeShippingPartner(row),
  });
});

/**
 * @openapi
 * /shipping/checkServiceable:
 *   post:
 *     tags: [Shipping]
 *     summary: Is a pincode deliverable, and through which zone
 *     description: >
 *       Zones are matched pincode-first, then state, then country. With no zone
 *       match the global shipping settings decide.
 *     responses:
 *       200: { description: Serviceability plus the reason it resolved that way }
 */
export const checkServiceable = asyncHandler(async (req, res) => {
  const result = await service.checkServiceable(req.body);
  return ApiResponse.success(res, { message: SUCCESS.SHIPPING.SERVICEABILITY_CHECKED, result });
});

/**
 * @openapi
 * /shipping/calculateRate:
 *   post:
 *     tags: [Shipping]
 *     summary: Quote a shipping rate for a destination
 *     responses:
 *       200: { description: Rate and estimated delivery window }
 */
export const calculateRate = asyncHandler(async (req, res) => {
  const result = await service.calculateRate(req.body);
  return ApiResponse.success(res, { message: SUCCESS.SHIPPING.RATE_CALCULATED, result });
});

/**
 * @openapi
 * /shipping/shipments/updateStatus/:id:
 *   patch:
 *     tags: [Shipping]
 *     summary: Advance a shipment through its own state machine (admin)
 *     responses:
 *       200: { description: Shipment updated }
 *       422: { description: Transition not allowed }
 */
export const shipmentStatus = asyncHandler(async (req, res) => {
  const row = await service.updateShipmentStatus(
    D.str(req.params.id),
    D.str(req.body.status),
    D.str(req.body.remarks),
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.STATUS_UPDATED,
    result: serializeShipment(row),
  });
});

/**
 * @openapi
 * /shipping/delivery-boys/getAll:
 *   get:
 *     tags: [Delivery]
 *     summary: List riders
 *     description: "Sending `?availableOnly=true` filters to riders with spare capacity."
 *     responses:
 *       200: { description: Paginated riders }
 */
export const deliveryBoyList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listDeliveryBoys({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.DELIVERY_BOY.FETCHED,
    result: { itemList: rows.map(serializeDeliveryBoy) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const deliveryBoyCreate = asyncHandler(async (req, res) => {
  const row = await service.createDeliveryBoy(req.body, req);
  return ApiResponse.created(res, SUCCESS.DELIVERY_BOY.CREATED, serializeDeliveryBoy(row));
});

export const deliveryBoyUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateDeliveryBoy(D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.DELIVERY_BOY.UPDATED,
    result: serializeDeliveryBoy(row),
  });
});

export const deliveryBoyToggle = asyncHandler(async (req, res) => {
  const row = await service.toggleDeliveryBoy(
    D.str(req.params.id),
    Boolean(req.body.isActive),
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.DELIVERY_BOY.STATUS_UPDATED,
    result: serializeDeliveryBoy(row),
  });
});

export const deliveryBoyDelete = asyncHandler(async (req, res) => {
  await service.deleteDeliveryBoy(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.DELIVERY_BOY.DELETED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /shipping/delivery-boys/getDeliveries:
 *   get:
 *     tags: [Delivery]
 *     summary: Delivery queue (a rider sees only their own)
 *     responses:
 *       200: { description: Paginated deliveries }
 */
export const deliveryList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const isRider = req.auth!.role === 'DELIVERY_BOY';

  const { rows, total } = await service.listDeliveries(
    { ...(req.query as any), skip, take },
    isRider ? req.auth!.userId : undefined,
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.DELIVERY_BOY.DELIVERIES_FETCHED,
    result: { itemList: rows.map(serializeDelivery) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const settingsList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listSettings({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.SETTING.FETCHED,
    result: { itemList: rows.map(serializeSystemSetting) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const settingsPublic = asyncHandler(async (_req, res) => {
  const result = await service.getPublicSettings();
  return ApiResponse.success(res, { message: SUCCESS.SETTING.PUBLIC_FETCHED, result });
});

export const settingsUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateSetting(req.body, actorId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.SETTING.UPDATED,
    result: serializeSystemSetting(row),
  });
});

export const settingsBulkUpdate = asyncHandler(async (req, res) => {
  const count = await service.bulkUpdateSettings(req.body.settings, actorId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.SETTING.BULK_UPDATED,
    result: { updatedCount: D.num(count) },
  });
});

/**
 * @openapi
 * /admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Headline counts across the platform (admin)
 *     responses:
 *       200: { description: Dashboard summary }
 */
export const dashboard = asyncHandler(async (_req, res) => {
  const result = await service.getDashboard();
  return ApiResponse.success(res, { message: SUCCESS.ADMIN.DASHBOARD_FETCHED, result });
});

export const subAdminCreate = asyncHandler(async (req, res) => {
  const row = await service.createSubAdmin(req.body, actorId(req), req);
  return ApiResponse.created(res, SUCCESS.ADMIN.SUB_ADMIN_CREATED, row);
});

export const subAdminList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listSubAdmins({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ADMIN.SUB_ADMINS_FETCHED,
    result: { itemList: rows.map((u: any) => serializeUser(u)) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const permissionsGet = asyncHandler(async (req, res) => {
  const list = await service.listRolePermissions(D.str(req.params.role));

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.PERMISSIONS_FETCHED,
    result: { role: D.str(req.params.role), itemCount: list.length, permissionList: list },
  });
});

export const permissionsSet = asyncHandler(async (req, res) => {
  const count = await service.setRolePermissions(
    D.str(req.params.role),
    req.body.permissions,
    actorId(req),
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.PERMISSIONS_UPDATED,
    result: { role: D.str(req.params.role), permissionCount: D.num(count) },
  });
});

export const auditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listAuditLogs({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ADMIN.AUDIT_LOGS_FETCHED,
    result: { itemList: rows.map(serializeAuditLog) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const activityLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listActivityLogs({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ADMIN.ACTIVITY_LOGS_FETCHED,
    result: { itemList: rows.map(serializeActivityLog) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /admin/health:
 *   get:
 *     tags: [Admin]
 *     summary: Database reachability and process stats (admin)
 *     responses:
 *       200: { description: Health report }
 */
export const health = asyncHandler(async (_req, res) => {
  const result = await service.getSystemHealth();
  return ApiResponse.success(res, { message: SUCCESS.ADMIN.HEALTH_FETCHED, result });
});

export const auditLogById = asyncHandler(async (req, res) => {
  const row = await service.getAuditLogById(D.str(req.params.id));

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.AUDIT_LOGS_FETCHED,
    result: serializeAuditLog(row),
  });
});

export const auditLogsByActor = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const actorId = D.str(req.params.userId);

  const { rows, total } = await service.listAuditLogs({
    ...(req.query as any),
    actorId,
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ADMIN.AUDIT_LOGS_FETCHED,
    result: { actorId, itemList: rows.map(serializeAuditLog) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const exportAuditLogs = asyncHandler(async (req, res) => {
  const { rows } = await service.listAuditLogs({ ...(req.query as any), take: 10_000 });

  const header = ['createdAt', 'actorId', 'action', 'entity', 'entityId', 'description', 'ip'].join(
    ',',
  );

  const body = rows
    .map((r: any) =>
      [
        D.date(r.createdAt),
        D.str(r.actorId),
        D.str(r.action),
        D.str(r.entity),
        D.str(r.entityId),
        `"${D.str(r.description).replace(/"/g, '""')}"`,
        D.str(r.ip),
      ].join(','),
    )
    .join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');

  return res.status(200).send(`${header}\n${body}`);
});

export const purgeAuditLogs = asyncHandler(async (req, res) => {
  const result = await service.purgeAuditLogs(D.num(req.body.beforeDays), actorId(req), req);

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.AUDIT_LOGS_PURGED,
    result,
  });
});

export const shipmentCreate = asyncHandler(async (req, res) => {
  const row = await service.createShipment(
    D.str(req.params.subOrderId),
    req.auth!.vendorId,
    req.body,
    actorId(req),
    req,
  );

  return ApiResponse.created(res, SUCCESS.SHIPPING.SHIPMENT_CREATED, serializeShipment(row));
});

export const shipmentTrack = asyncHandler(async (req, res) => {
  const result = await service.trackShipment(D.str(req.params.awb));
  return ApiResponse.success(res, { message: SUCCESS.SHIPPING.TRACKED, result });
});

export const deliveryStatusUpdate = asyncHandler(async (req, res) => {
  const isAdmin = req.auth!.role === ROLES.SUPER_ADMIN || req.auth!.role === ROLES.SUB_ADMIN;

  const row = await service.updateDeliveryStatus(
    D.str(req.params.id),
    req.body,
    isAdmin ? undefined : req.auth!.userId,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.SHIPPING.DELIVERY_STATUS_UPDATED,
    result: serializeDelivery(row),
  });
});

export const settingsByCategory = asyncHandler(async (req, res) => {
  const category = D.str(req.params.category);
  const result = await service.getSettingsByCategory(category);

  return ApiResponse.success(res, {
    message: SUCCESS.SETTING.CATEGORY_FETCHED,
    result: { category, settingList: result },
  });
});

export const settingsReset = asyncHandler(async (req, res) => {
  const result = await service.resetSettings(actorId(req), req);
  return ApiResponse.success(res, { message: SUCCESS.SETTING.RESET, result });
});

export const featureFlags = asyncHandler(async (_req, res) => {
  const result = await service.getFeatureFlagMap();
  return ApiResponse.success(res, { message: SUCCESS.SETTING.FEATURE_FLAGS_FETCHED, result });
});

export const featureToggle = asyncHandler(async (req, res) => {
  const enabled = await service.toggleFeatureFlag(
    D.str(req.body.key),
    Boolean(req.body.enabled),
    actorId(req),
  );

  return ApiResponse.success(res, {
    message: SUCCESS.SETTING.FEATURE_TOGGLED,
    result: { key: D.str(req.body.key), isEnabled: D.bool(enabled) },
  });
});

export const maintenanceStatus = asyncHandler(async (_req, res) => {
  const result = await service.getMaintenanceMode();
  return ApiResponse.success(res, { message: SUCCESS.SETTING.MAINTENANCE_FETCHED, result });
});

export const maintenanceUpdate = asyncHandler(async (req, res) => {
  const result = await service.setMaintenanceMode(req.body, actorId(req), req);
  return ApiResponse.success(res, { message: SUCCESS.SETTING.MAINTENANCE_UPDATED, result });
});

export const subAdminUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateSubAdmin(D.str(req.params.id), req.body, actorId(req), req);

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.SUB_ADMIN_UPDATED,
    result: serializeUser(row),
  });
});

export const subAdminDelete = asyncHandler(async (req, res) => {
  await service.deleteSubAdmin(D.str(req.params.id), actorId(req), req);

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.SUB_ADMIN_DELETED,
    result: { userId: D.str(req.params.id), isDeleted: true },
  });
});

export const subAdminToggle = asyncHandler(async (req, res) => {
  const row = await service.toggleSubAdmin(
    D.str(req.params.id),
    Boolean(req.body.enabled),
    actorId(req),
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.SUB_ADMIN_STATUS_UPDATED,
    result: { userId: D.str(row.id), isActive: D.bool(row.isActive) },
  });
});

export const allPermissions = asyncHandler(async (_req, res) => {
  const result = await service.listAllRolePermissions();

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.PERMISSIONS_FETCHED,
    result: { roleList: result },
  });
});

export const permissionsSetByRole = asyncHandler(async (req, res) => {
  const count = await service.setRolePermissions(
    D.str(req.params.id),
    req.body.permissions,
    actorId(req),
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.PERMISSIONS_UPDATED,
    result: { role: D.str(req.params.id), permissionCount: D.num(count) },
  });
});

export const clearCache = asyncHandler(async (req, res) => {
  const flushed = await service.clearAllCaches(actorId(req), req);

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.CACHE_CLEARED,
    result: { isFlushed: D.bool(flushed) },
  });
});

export const cronJobs = asyncHandler(async (_req, res) => {
  const result = await service.listCronJobDefinitions();

  return ApiResponse.success(res, {
    message: SUCCESS.ADMIN.CRON_JOBS_FETCHED,
    result: { jobCount: result.length, jobList: result },
  });
});

export const triggerJob = asyncHandler(async (req, res) => {
  const result = await service.triggerCronJobNow(D.str(req.body.name), actorId(req), req);

  return ApiResponse.success(res, { message: SUCCESS.ADMIN.JOB_TRIGGERED, result });
});

export const failedJobs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { rows, total, pending, counts } = await service.listFailedJobRecords({
    ...req.query,
    skip,
    take: limit,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.ADMIN.FAILED_JOBS_FETCHED,
    result: {
      pendingCount: D.num(pending),
      filterData: {
        status: D.str(req.query.status as string),
        queue: D.str(req.query.queue as string),
        jobName: D.str(req.query.jobName as string),
        search: D.str(req.query.search as string),
      },
      countsData: {
        pendingCount: D.num(counts.pending),
        resolvedCount: D.num(counts.resolved),
        abandonedCount: D.num(counts.abandoned),
      },
      ...serializeFailedJobList(rows),
    },
    totalRecord: total,
    totalPage: Math.ceil(total / limit),
    currentPage: page,
    limit,
    hasNext: page * limit < total,
    hasPrevious: page > 1,
    nextPage: page * limit < total ? page + 1 : 0,
    previousPage: page > 1 ? page - 1 : 0,
  });
});

export const retryFailedJob = asyncHandler(async (req, res) => {
  const result = await service.retryFailedJobRecord(D.str(req.params.id), actorId(req), req);

  return ApiResponse.success(res, { message: SUCCESS.ADMIN.FAILED_JOB_RETRIED, result });
});

export const resolveFailedJob = asyncHandler(async (req, res) => {
  const result = await service.resolveFailedJobRecord(D.str(req.params.id), actorId(req), req);

  return ApiResponse.success(res, { message: SUCCESS.ADMIN.FAILED_JOB_RESOLVED, result });
});

export const deleteFailedJob = asyncHandler(async (req, res) => {
  const result = await service.removeFailedJobRecord(D.str(req.params.id), actorId(req), req);

  return ApiResponse.success(res, { message: SUCCESS.ADMIN.FAILED_JOB_DELETED, result });
});
