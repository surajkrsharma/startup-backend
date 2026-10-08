import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { requireRole } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSION } from '../../constants/permissions';
import { getPagination } from '../../utils/pagination';
import * as service from './user.service';
import * as schema from './user.schema';
import {
  serializeProfile,
  serializeUser,
  serializeAddress,
  serializeAddressList,
  serializeActivityLog,
  serializeOrderSummaryList,
  serializeImpersonation,
} from './user.serializer';
import {
  serializeCustomerNote,
  serializeCustomerNoteList,
  serializeTimelineList,
  serializeCustomerBan,
  serializeCustomerBanList,
  serializeCustomerSegment,
  serializeCustomerSegmentList,
  serializeCustomerSegmentMemberList,
} from '../../utils/serialize';
import { serializeCustomerExport } from './user.service';
import { writeActivityLog, writeAuditLog } from '../../services/audit.service';
import { ADMIN_ACTION } from '../../constants/roles';

const userId = (req: Request): string => req.auth!.userId;
const adminOnly = requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN);

export const getProfile = asyncHandler(async (req, res) => {
  const user = await service.getProfile(userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeProfile(user),
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.PROFILE_UPDATED,
    result: serializeProfile(user),
  });
});

export const updateAvatar = asyncHandler(async (req, res) => {
  const user = await service.updateAvatar(userId(req), req.body.avatarUrl, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.AVATAR_UPDATED,
    result: { userId: user.id, avatarUrl: D.str(user.avatarUrl) },
  });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await service.deleteAccount(userId(req), req.body ?? {}, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.ACCOUNT_DELETED,
    result: { isDeleted: true, isSoftDelete: true },
  });
});

export const getAddresses = asyncHandler(async (req, res) => {
  const rows = await service.listAddresses(userId(req));
  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeAddressList(rows),
    totalRecord: rows.length,
    currentPage: 1,
    limit: rows.length || 1,
  });
});

export const addAddress = asyncHandler(async (req, res) => {
  const address = await service.addAddress(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.ADDRESS.ADDED, serializeAddress(address));
});

export const updateAddress = asyncHandler(async (req, res) => {
  const address = await service.updateAddress(userId(req), req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.UPDATED,
    result: serializeAddress(address),
  });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  await service.deleteAddress(userId(req), req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.DELETED,
    result: { addressId: req.params.id, isDeleted: true },
  });
});

export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await service.setDefaultAddress(userId(req), req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.DEFAULT_SET,
    result: serializeAddress(address),
  });
});

/**
 * @openapi
 * /users/addNote/:id:
 *   post:
 *     tags: [Users]
 *     summary: Add an internal note about a customer
 *     description: Admin only. Never exposed to the customer.
 *     responses:
 *       200: { description: Note added }
 *       400: { description: Note is required }
 *       404: { description: Customer not found }
 */
export const addCustomerNote = asyncHandler(async (req, res) => {
  const note = await service.addCustomerNote(req.params.id, userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.NOTE_ADDED,
    result: serializeCustomerNote(note),
  });
});

/**
 * @openapi
 * /users/getNotes/:id:
 *   get:
 *     tags: [Users]
 *     summary: List internal notes for a customer
 *     description: Admin only.
 *     responses:
 *       200: { description: Note list, newest first }
 *       404: { description: Customer not found }
 */
export const getCustomerNotes = asyncHandler(async (req, res) => {
  const notes = await service.listCustomerNotes(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.NOTES_FETCHED,
    result: serializeCustomerNoteList(notes),
  });
});

/**
 * @openapi
 * /users/removeNote/:id/:noteId:
 *   delete:
 *     tags: [Users]
 *     summary: Remove an internal note from a customer
 *     description: Admin only.
 *     responses:
 *       200: { description: Note removed }
 *       404: { description: Customer or note not found }
 */
export const removeCustomerNote = asyncHandler(async (req, res) => {
  await service.deleteCustomerNote(req.params.id, req.params.noteId, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.NOTE_REMOVED,
    result: { isRemoved: true },
  });
});

/**
 * @openapi
 * /users/getActivity/:id:
 *   get:
 *     tags: [Users]
 *     summary: Merge one customer's orders, returns, tickets, chats and logins
 *     description: >
 *       One ordered stream so a support agent does not have to open five screens.
 *       Supports `?type=ORDER|RETURN|TICKET|CHAT|LOGIN`, `?from=`, `?to=`.
 *     responses:
 *       200: { description: Paginated timeline, newest first }
 *       404: { description: Customer not found }
 */
export const getTimeline = asyncHandler(async (req, res) => {
  const { rows, total, page, limit } = await service.getUserTimeline(req.params.id, req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.USER.TIMELINE_FETCHED,
    result: {
      filterData: {
        type: D.str(req.query.type as string),
        from: D.str(req.query.from as string),
        to: D.str(req.query.to as string),
      },
      ...serializeTimelineList(rows),
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

export const getAll = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.listUsers(req.query);
  const { limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: {
      filterData: {
        search: D.str(filters.search),
        role: D.str(filters.role),
        status: D.str(filters.status),
        vendorStatus: D.str(filters.vendorStatus),
      },
      userList: rows.map(serializeUser),
    },
    totalRecord: total,
    currentPage: filters.page,
    limit,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const user = await service.getUserById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeProfile(user, {
      statsData: {
        orderCount: D.num(user?._count?.orders),
        reviewCount: D.num(user?._count?.reviews),
        addressCount: D.num(user?._count?.addresses),
      },
    }),
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await service.updateUser(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.UPDATED,
    result: serializeProfile(user),
  });
});

export const toggleStatus = asyncHandler(async (req, res) => {
  const user = await service.toggleUserStatus(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.STATUS_UPDATED,
    result: {
      userId: D.str(user.id),
      isActive: D.bool(user.isActive),
      status: D.bool(user.isActive) ? 'ACTIVE' : 'SUSPENDED',
    },
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  await service.hardDeleteUser(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.DELETED,
    result: { userId: req.params.id, isDeleted: true, isHardDelete: true },
  });
});

export const getActivity = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.getUserActivity(req.params.id, req.query);
  const { limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: {
      filterData: { action: D.str(filters.action) },
      activityLogList: rows.map(serializeActivityLog),
    },
    totalRecord: total,
    currentPage: filters.page,
    limit,
  });
});

export const getOrders = asyncHandler(async (req, res) => {
  const { rows, total } = await service.getUserOrders(req.params.id, req.query);
  const { limit, page } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.ORDER.FETCHED,
    result: {
      filterData: { status: D.str(req.query?.status as string) },
      ...serializeOrderSummaryList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const impersonate = asyncHandler(async (req, res) => {
  const result = await service.impersonateUser(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.IMPERSONATED,
    result: serializeImpersonation(result),
  });
});

export const banCustomer = asyncHandler(async (req, res) => {
  const ban = await service.banCustomer(req.params.id, userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.BANNED,
    result: serializeCustomerBan(ban),
  });
});

export const unbanCustomer = asyncHandler(async (req, res) => {
  const ban = await service.unbanCustomer(req.params.id, userId(req), req.body ?? {}, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.UNBANNED,
    result: serializeCustomerBan(ban),
  });
});

export const getBans = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.listCustomerBans(req.query);
  const { limit, page } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.USER.BANS_FETCHED,
    result: {
      filterData: { search: D.str(filters.search), isActive: D.str(filters.isActive) },
      ...serializeCustomerBanList(rows),
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

export const exportMyData = asyncHandler(async (req, res) => {
  const data = await service.exportCustomerData(userId(req));

  void writeActivityLog({
    req,
    userId: userId(req),
    action: 'CUSTOMER_DATA_EXPORTED',
    entity: 'User',
    entityId: userId(req),
  });

  return ApiResponse.success(res, {
    message: SUCCESS.USER.DATA_EXPORTED,
    result: serializeCustomerExport(data),
  });
});

export const exportData = asyncHandler(async (req, res) => {
  const data = await service.exportCustomerData(req.params.id);

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.EXPORT,
    entity: 'User',
    entityId: req.params.id,
    description: 'Exported a customer data record',
  });

  return ApiResponse.success(res, {
    message: SUCCESS.USER.DATA_EXPORTED,
    result: serializeCustomerExport(data),
  });
});

export const getSegments = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.listSegments(req.query);
  const { limit, page } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.USER.SEGMENTS_FETCHED,
    result: {
      filterData: {
        kind: D.str(filters.kind),
        isActive: D.str(filters.isActive),
        search: D.str(filters.search),
      },
      ...serializeCustomerSegmentList(rows),
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

export const getSegmentById = asyncHandler(async (req, res) => {
  const segment = await service.getSegmentById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENTS_FETCHED,
    result: serializeCustomerSegment(segment),
  });
});

export const createSegment = asyncHandler(async (req, res) => {
  const segment = await service.createSegment(req.body, userId(req), req);
  return ApiResponse.created(res, SUCCESS.USER.SEGMENT_CREATED, serializeCustomerSegment(segment));
});

export const updateSegment = asyncHandler(async (req, res) => {
  const segment = await service.updateSegment(req.params.id, req.body, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENT_UPDATED,
    result: serializeCustomerSegment(segment),
  });
});

export const deleteSegment = asyncHandler(async (req, res) => {
  await service.deleteSegment(req.params.id, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENT_DELETED,
    result: { segmentId: D.str(req.params.id), isDeleted: true },
  });
});

export const getSegmentMembers = asyncHandler(async (req, res) => {
  const { rows, total } = await service.listSegmentMembers(req.params.id, req.query);
  const { limit, page } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.USER.SEGMENTS_FETCHED,
    result: serializeCustomerSegmentMemberList(rows),
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

export const addSegmentMembers = asyncHandler(async (req, res) => {
  const added = await service.addSegmentMembers(req.params.id, req.body, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENT_MEMBERS_ADDED,
    result: { segmentId: D.str(req.params.id), addedCount: D.num(added) },
  });
});

export const removeSegmentMembers = asyncHandler(async (req, res) => {
  const removed = await service.removeSegmentMembers(req.params.id, req.body, userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENT_MEMBERS_REMOVED,
    result: { segmentId: D.str(req.params.id), removedCount: D.num(removed) },
  });
});

export const refreshSegments = asyncHandler(async (req, res) => {
  const stats = await service.refreshCustomerSegments(req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.SEGMENTS_REFRESHED,
    result: {
      processedCount: D.num(stats.processed),
      assignedCount: D.num(stats.assigned),
      removedCount: D.num(stats.removed),
    },
  });
});

export const guards = {
  self: [],
  customer: [requireRole('CUSTOMER')],
  adminList: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_LIST),
  ],
  adminView: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_VIEW),
  ],
  adminUpdate: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_UPDATE),
  ],
  adminSuspend: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_SUSPEND),
  ],
  adminBan: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_BAN),
  ],
  adminSegment: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_SEGMENT_MANAGE),
  ],
  adminExport: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.USER_EXPORT),
  ],
  adminDelete: [requireRole(ROLES.SUPER_ADMIN), requirePermission(PERMISSION.USER_DELETE)],
  adminImpersonate: [
    requireRole(ROLES.SUPER_ADMIN),
    requirePermission(PERMISSION.USER_IMPERSONATE),
  ],
};

export { adminOnly, schema };
