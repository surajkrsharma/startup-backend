import type { RequestHandler } from 'express';
import { getMaintenanceStatus } from '../services/settings.service';
import { APP, MAINTENANCE_ADMIN_PATHS, MAINTENANCE_ALLOW_PATHS } from '../config/app.config';
import { ApiResponse } from '../utils/ApiResponse';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ROLES } from '../constants/roles';
import { extractToken } from './auth.middleware';
import { verifyAccessToken } from '../utils/crypto';
import { prisma } from '../services/prisma.service';

const routePath = (path: string): string => {
  const normalised = path.startsWith(APP.API_PREFIX) ? path.slice(APP.API_PREFIX.length) : path;
  return normalised || '/';
};

const PUBLIC_PATHS = MAINTENANCE_ALLOW_PATHS.map(routePath);
const ADMIN_PATHS = MAINTENANCE_ADMIN_PATHS.map(routePath);

const matches = (path: string, allowed: string[]): boolean => {
  const target = routePath(path);
  return allowed.some((entry) => target === entry || target.startsWith(`${entry}/`));
};

const isPublicPath = (path: string): boolean => matches(path, PUBLIC_PATHS);

const isAdminPath = (path: string): boolean => matches(path, ADMIN_PATHS);

const isSuperAdminRequest = async (req: any): Promise<boolean> => {
  const token = extractToken(req);
  if (!token) return false;

  let userId = '';
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    return false;
  }
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, deletedAt: true },
  });

  return Boolean(user && !user.deletedAt && user.isActive && user.role === ROLES.SUPER_ADMIN);
};

export const maintenanceMiddleware: RequestHandler = async (req, res, next) => {
  if (isPublicPath(req.path)) return next();

  const status = await getMaintenanceStatus();
  if (!status.enabled) return next();

  const ip = (req.ip || '').replace('::ffff:', '');
  if (status.allowedIps.includes(ip)) return next();

  if (isAdminPath(req.path) && (await isSuperAdminRequest(req))) return next();

  return ApiResponse.error(res, {
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    message: status.message || ERROR.SYSTEM.MAINTENANCE,
    code: ERROR_CODE.MAINTENANCE,
  });
};

export const maintenanceStatusHandler = async (): Promise<{
  isMaintenance: boolean;
  message: string;
}> => {
  const status = await getMaintenanceStatus();
  return { isMaintenance: status.enabled, message: status.message };
};
