import { ENV, isProduction, isTest } from './env.config';

export const LOGGER = {
  LEVEL: isTest ? 'silent' : ENV.LOG_LEVEL,
  NAME: `${ENV.APP_NAME}-api`,
  PRETTY: isProduction ? false : true,
  LOG_LEVELS: {
    FATAL: 60,
    ERROR: 50,
    WARN: 40,
    INFO: 30,
    DEBUG: 20,
    TRACE: 10,
    SILENT: Number.POSITIVE_INFINITY,
  } as const,
  REDACT_PATHS: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]',
    'req.body.password',
    'req.body.oldPassword',
    'req.body.newPassword',
    'req.body.otp',
    'req.body.secret',
    'password',
    'passwordHash',
    'accessToken',
    'refreshToken',
    'token',
  ],
  SERIALIZERS: {
    req: (req: any) => ({
      id: req?.id,
      method: req?.method,
      url: req?.url,
      remoteAddress: req?.remoteAddress,
      userAgent: req?.headers?.['user-agent'],
      userId: req?.auth?.userId,
      role: req?.auth?.role,
      vendorId: req?.auth?.vendorId,
      deviceId: req?.deviceId,
      sessionKey: req?.sessionKey,
    }),
    res: (res: any) => ({ statusCode: res?.statusCode }),
  },
} as const;

export const APP_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const LOG_FILE = {
  ERROR: isProduction ? 'logs/error.log' : '',
  COMBINED: isProduction ? 'logs/combined.log' : '',
} as const;
