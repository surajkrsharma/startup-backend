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
import { serializeCustomerNote, serializeCustomerNoteList } from '../../utils/serialize';

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
  adminDelete: [requireRole(ROLES.SUPER_ADMIN), requirePermission(PERMISSION.USER_DELETE)],
  adminImpersonate: [
    requireRole(ROLES.SUPER_ADMIN),
    requirePermission(PERMISSION.USER_IMPERSONATE),
  ],
};

export { adminOnly, schema };
