import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../utils/ApiResponse';
import { verifyAccessToken } from '../utils/crypto';
import { prisma } from '../services/prisma.service';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ROLES, Role } from '../constants/roles';
import { asyncHandler } from '../utils/asyncHandler';

export const extractToken = (req: any): string => {
  const header = req.headers?.authorization;
  if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (Array.isArray(header) && header[0]?.startsWith('Bearer ')) {
    return header[0].slice(7).trim();
  }
  return '';
};

export const authenticate: RequestHandler = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    throw new AppError(ERROR.AUTH.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, ERROR_CODE.UNAUTHORIZED);
  }

  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      role: true,
      email: true,
      isActive: true,
      deletedAt: true,
      twoFactorEnabled: true,
      vendorProfile: { select: { id: true, status: true } },
    },
  });

  if (!user || user.deletedAt) {
    throw new AppError(ERROR.AUTH.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, ERROR_CODE.UNAUTHORIZED);
  }

  if (!user.isActive) {
    throw new AppError(
      ERROR.AUTH.ACCOUNT_SUSPENDED,
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODE.ACCOUNT_SUSPENDED,
    );
  }

  req.auth = {
    userId: user.id,
    role: user.role,
    vendorId: user.vendorProfile?.id ?? '',
    email: user.email,
    sessionKey: payload.sessionKey ?? '',
    deviceId: payload.deviceId ?? req.deviceId ?? '',
  };

  next();
});

export const optionalAuth: RequestHandler = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        email: true,
        isActive: true,
        deletedAt: true,
        vendorProfile: { select: { id: true } },
      },
    });

    if (!user || user.deletedAt || !user.isActive) return next();

    req.auth = {
      userId: user.id,
      role: user.role,
      vendorId: user.vendorProfile?.id ?? '',
      email: user.email,
      sessionKey: payload.sessionKey ?? '',
      deviceId: payload.deviceId ?? req.deviceId ?? '',
    };
  } catch {
    return next();
  }

  next();
});

export const require2FAVerified: RequestHandler = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  const twoFactorConfirmed = req.headers['x-2fa-verified'];
  if (String(twoFactorConfirmed) === 'true') return next();

  try {
    const payload = verifyAccessToken(token) as any;
    if (payload.tfa === true) return next();
  } catch {
    return next();
  }

  const user = req.auth?.userId
    ? await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { twoFactorEnabled: true },
      })
    : null;

  if (user?.twoFactorEnabled) {
    throw new AppError(
      ERROR.AUTH.TWO_FA_REQUIRED,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.TWO_FA_REQUIRED,
    );
  }

  next();
});

export const authorize = (...roles: Role[]): RequestHandler => {
  const handler: RequestHandler = (req, res, next) => {
    if (!req.auth) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNAUTHORIZED,
        message: ERROR.AUTH.UNAUTHORIZED,
        code: ERROR_CODE.UNAUTHORIZED,
      });
    }

    if (roles.includes(req.auth.role as Role)) return next();

    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: ERROR.COMMON.FORBIDDEN,
      code: ERROR_CODE.FORBIDDEN,
    });
  };

  (handler as any).requiredRoles = roles;

  return handler;
};

export const ADMIN_ROLES_GUARD = [ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN];

(authenticate as any).requiresAuth = true;
(optionalAuth as any).optionalAuth = true;

export const requireRole = (...roles: Role[]) => [authenticate, authorize(...roles)];
export const requireAdmin = () => [authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)];
export const requireSuperAdmin = () => [authenticate, authorize(ROLES.SUPER_ADMIN)];
export const requireVendor = () => [authenticate, authorize(ROLES.VENDOR)];
export const requireCustomer = () => [authenticate, authorize(ROLES.CUSTOMER)];
