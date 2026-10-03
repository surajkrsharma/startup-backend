import { Request, Response } from 'express';
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

const userId = (req: Request): string => req.auth!.userId;
const adminOnly = requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN);

// ── Self ─────────────────────────────────────────────────────────────────────

/** GET /users/getProfile */
export const getProfile = asyncHandler(async (req, res) => {
  const user = await service.getProfile(userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeProfile(user),
  });
});

/** PATCH /users/updateProfile */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await service.updateProfile(userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.PROFILE_UPDATED,
    result: serializeProfile(user),
  });
});

/** PATCH /users/updateAvatar */
export const updateAvatar = asyncHandler(async (req, res) => {
  const user = await service.updateAvatar(userId(req), req.body.avatarUrl, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.AVATAR_UPDATED,
    result: { userId: user.id, avatarUrl: D.str(user.avatarUrl) },
  });
});

/** DELETE /users/deleteAccount — soft delete, order history preserved. */
export const deleteAccount = asyncHandler(async (req, res) => {
  await service.deleteAccount(userId(req), req.body ?? {}, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.ACCOUNT_DELETED,
    result: { isDeleted: true, isSoftDelete: true },
  });
});

// ── Addresses ────────────────────────────────────────────────────────────────

/** GET /users/getAddresses */
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

/** POST /users/addAddress */
export const addAddress = asyncHandler(async (req, res) => {
  const address = await service.addAddress(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.ADDRESS.ADDED, serializeAddress(address));
});

/** PATCH /users/updateAddress/:id */
export const updateAddress = asyncHandler(async (req, res) => {
  const address = await service.updateAddress(userId(req), req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.UPDATED,
    result: serializeAddress(address),
  });
});

/** DELETE /users/deleteAddress/:id — soft-scoped, so another user's id simply 404s. */
export const deleteAddress = asyncHandler(async (req, res) => {
  await service.deleteAddress(userId(req), req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.DELETED,
    result: { addressId: req.params.id, isDeleted: true },
  });
});

/** PATCH /users/setDefaultAddress/:id */
export const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await service.setDefaultAddress(userId(req), req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ADDRESS.DEFAULT_SET,
    result: serializeAddress(address),
  });
});

// ── Admin ────────────────────────────────────────────────────────────────────

/** GET /users/getAll */
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

/** GET /users/getById/:id */
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

/** PATCH /users/updateUser/:id */
export const updateUser = asyncHandler(async (req, res) => {
  const user = await service.updateUser(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.UPDATED,
    result: serializeProfile(user),
  });
});

/** PATCH /users/toggleStatus/:id */
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

/** DELETE /users/deleteUser/:id — SUPER_ADMIN only. */
export const deleteUser = asyncHandler(async (req, res) => {
  await service.hardDeleteUser(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.USER.DELETED,
    result: { userId: req.params.id, isDeleted: true, isHardDelete: true },
  });
});

/** GET /users/getActivity/:id */
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

/** GET /users/getOrders/:id */
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

/** POST /users/impersonate/:id — SUPER_ADMIN only, always audited. */
export const impersonate = asyncHandler(async (req, res) => {
  const result = await service.impersonateUser(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.IMPERSONATED,
    result: serializeImpersonation(result),
  });
});

// ── Route middleware chains, exported for the router ─────────────────────────

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
