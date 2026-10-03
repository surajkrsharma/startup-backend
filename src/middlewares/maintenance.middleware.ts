import type { RequestHandler } from 'express';
import { getMaintenanceStatus } from '../services/settings.service';
import { APP, MAINTENANCE_ALLOW_PATHS } from '../config/app.config';
import { ApiResponse } from '../utils/ApiResponse';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ROLES } from '../constants/roles';

/** Strips the API prefix so allow-list matching works on `/health`, not `/api/v1/health`. */
const routePath = (path: string): string => {
  const normalised = path.startsWith(APP.API_PREFIX) ? path.slice(APP.API_PREFIX.length) : path;
  return normalised || '/';
};

const ALLOWED_PATHS = MAINTENANCE_ALLOW_PATHS.map((p) => routePath(p));

const isAllowedPath = (path: string): boolean => {
  const target = routePath(path);
  return ALLOWED_PATHS.some((allowed) => target === allowed || target.startsWith(`${allowed}/`));
};

/**
 * Maintenance mode — when `maintenance.enabled = true` every route returns 503
 * except `/health`, `/docs`, `/docs.json`, `/version` and `/admin/*` for SUPER_ADMIN.
 */
export const maintenanceMiddleware: RequestHandler = async (req, res, next) => {
  if (isAllowedPath(req.path)) return next();
  const status = await getMaintenanceStatus();
  if (!status.enabled) return next();

  const ip = (req.ip || '').replace('::ffff:', '');
  if (status.allowedIps.includes(ip)) return next();

  const isSuperAdmin = req.auth?.role === ROLES.SUPER_ADMIN;
  if (isSuperAdmin) return next();

  return ApiResponse.error(res, {
    statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
    message: status.message || ERROR.SYSTEM.MAINTENANCE,
    code: ERROR_CODE.MAINTENANCE,
  });
};

/** Public status endpoint helper — never blocks. */
export const maintenanceStatusHandler = async (): Promise<{
  isMaintenance: boolean;
  message: string;
}> => {
  const status = await getMaintenanceStatus();
  return { isMaintenance: status.enabled, message: status.message };
};
