import type { RequestHandler } from 'express';
import { prisma } from '../services/prisma.service';
import { cacheGet, cacheSet } from '../services/redis.service';
import { REDIS_KEYS, CACHE_TTL } from '../config/tracking.config';
import { DEFAULT_ROLE_PERMISSIONS, Permission, PERMISSION } from '../constants/permissions';
import { ROLES } from '../constants/roles';
import { ApiResponse } from '../utils/ApiResponse';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { asyncHandler } from '../utils/asyncHandler';

/** Resolves the permission set for a role: DB overrides win over code defaults. */
export const getRolePermissions = async (role: string): Promise<Permission[]> => {
  const cacheKey = REDIS_KEYS.USER_PERMISSIONS(role);
  const cached = await cacheGet<Permission[]>(cacheKey);
  if (cached) return cached;

  const defaults = (DEFAULT_ROLE_PERMISSIONS[role] ?? []) as Permission[];

  try {
    const rows = await prisma.rolePermission.findMany({ where: { role: role as any } });
    const merged = rows.length
      ? [
          ...new Set([
            ...defaults,
            ...rows.filter((r) => r.isAllowed).map((r) => r.permission as Permission),
          ]),
        ]
      : defaults;

    await cacheSet(cacheKey, merged, CACHE_TTL.PERMISSIONS_SEC);
    return merged;
  } catch {
    return defaults;
  }
};

export const setRolePermissions = async (
  role: string,
  permissions: { permission: string; isAllowed: boolean }[],
): Promise<number> => {
  await prisma.$transaction(
    permissions.map((p) =>
      prisma.rolePermission.upsert({
        where: { role_permission: { role: role as any, permission: p.permission } },
        create: { role: role as any, permission: p.permission, isAllowed: p.isAllowed },
        update: { isAllowed: p.isAllowed },
      }),
    ),
  );
  await cacheSet(
    REDIS_KEYS.USER_PERMISSIONS(role),
    await getRolePermissions(role),
    CACHE_TTL.PERMISSIONS_SEC,
  );
  return permissions.length;
};

/**
 * Permission-based guard. SUPER_ADMIN always passes.
 * Attaches resolved permissions to `req.auth.permissions`.
 */
export const requirePermission = (...permissions: Permission[]): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    if (!req.auth) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        message: ERROR.AUTH.UNAUTHORIZED,
        code: ERROR_CODE.UNAUTHORIZED,
      });
    }

    if (req.auth.role === ROLES.SUPER_ADMIN) {
      req.auth.permissions = await getRolePermissions(ROLES.SUPER_ADMIN);
      return next();
    }

    const granted = req.auth.permissions?.length
      ? req.auth.permissions
      : await getRolePermissions(req.auth.role);

    req.auth.permissions = granted;

    const allowed = permissions.every((p) => granted.includes(p));
    if (!allowed) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: ERROR.PERMISSION.NOT_GRANTED,
        code: ERROR_CODE.FORBIDDEN,
      });
    }

    return next();
  });

/**
 * Vendor scoping guard — ADMIN roles see everything, VENDOR only its own rows.
 * Also rejects a vendor whose profile is not approved when `requireApproved` is set.
 */
export const vendorScope = (options: { requireApproved?: boolean } = {}): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    if (!req.auth) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        message: ERROR.AUTH.UNAUTHORIZED,
        code: ERROR_CODE.UNAUTHORIZED,
      });
    }

    if (req.auth.role === ROLES.SUPER_ADMIN || req.auth.role === ROLES.SUB_ADMIN) {
      (req as any).vendorFilter = undefined;
      return next();
    }

    if (req.auth.role !== ROLES.VENDOR) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: ERROR.COMMON.FORBIDDEN,
        code: ERROR_CODE.FORBIDDEN,
      });
    }

    if (!req.auth.vendorId) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: ERROR.VENDOR.NOT_FOUND,
        code: ERROR_CODE.FORBIDDEN,
      });
    }

    if (options.requireApproved) {
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: req.auth.vendorId },
        select: { status: true },
      });

      if (vendor?.status !== 'APPROVED') {
        return ApiResponse.error(res, {
          statusCode: HTTP_STATUS.FORBIDDEN,
          message: ERROR.VENDOR.NOT_APPROVED,
          code: ERROR_CODE.VENDOR_NOT_APPROVED,
        });
      }
    }

    (req as any).vendorFilter = { vendorId: req.auth.vendorId };
    return next();
  });

/**
 * Guards `/:id` ownership: admin may act on anyone, a VENDOR only on rows it owns.
 * `resolver` returns the owning vendorId for the entity (or '' when not found).
 */
export const ensureOwnership = (
  resolver: (id: string) => Promise<{ vendorId: string; userId?: string } | null>,
): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    if (!req.auth) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        message: ERROR.AUTH.UNAUTHORIZED,
        code: ERROR_CODE.UNAUTHORIZED,
      });
    }

    if (req.auth.role === ROLES.SUPER_ADMIN || req.auth.role === ROLES.SUB_ADMIN) return next();

    const entityId = (req.params as any)?.id ?? '';
    const owner = await resolver(entityId);

    if (!owner) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.NOT_FOUND,
        message: ERROR.COMMON.NOT_FOUND,
        code: ERROR_CODE.NOT_FOUND,
      });
    }

    const isOwnerOfVendor = owner.vendorId && owner.vendorId === req.auth.vendorId;
    const isOwnerOfUser = owner.userId && owner.userId === req.auth.userId;

    if (!isOwnerOfVendor && !isOwnerOfUser) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.FORBIDDEN,
        message: ERROR.COMMON.FORBIDDEN,
        code: ERROR_CODE.FORBIDDEN,
      });
    }

    (req as any).owner = owner;
    return next();
  });

/** Convenience: current user id from a validated route. */
export const currentUserId = (req: any): string => req?.auth?.userId ?? '';
export const currentVendorId = (req: any): string => req?.auth?.vendorId ?? '';
export const currentRole = (req: any): string => req?.auth?.role ?? '';

export { PERMISSION };
