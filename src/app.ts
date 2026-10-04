import express, { Application } from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { pinoHttp } from 'pino-http';
import compression from 'compression';

import { APP, HEADER } from './config/app.config';
import { ENV, isProduction } from './config/env.config';
import { logger } from './services/logger.service';
import { requestId } from './middlewares/requestId.middleware';
import { encryptionMiddleware } from './middlewares/encryption.middleware';
import { tracking } from './middlewares/tracking.middleware';
import { maintenanceMiddleware } from './middlewares/maintenance.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { globalRateLimit } from './middlewares/rateLimit.middleware';
import { apiRoutes } from './routes';
import { isEncryptionReady } from './config/encryption.config';
import { AppError } from './utils/AppError';
import { ERROR } from './messages/error';
import { ERROR_CODE, HTTP_STATUS } from './constants/http';

const buildCorsOptions = (): CorsOptions => {
  const whitelist = ENV.CORS_ORIGINS;
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProduction) return callback(null, true);
      if (whitelist.includes(origin)) return callback(null, true);
      return callback(
        new AppError(ERROR.COMMON.CORS_ORIGIN_DENIED, HTTP_STATUS.FORBIDDEN, ERROR_CODE.FORBIDDEN),
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'X-Device-Id',
      'X-Platform',
      'X-App-Version',
      'X-Session-Id',
      'X-Api-Key',
      'X-Signature',
      HEADER.ENCRYPTED,
    ],
    exposedHeaders: [
      HEADER.RESPONSE_REQUEST_ID,
      'Retry-After',
      'RateLimit-Limit',
      'RateLimit-Remaining',
    ],
    maxAge: 86400,
  };
};

export const createApp = (): Application => {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
  app.use(cors(buildCorsOptions()));
  app.use(compression());

  app.use(
    pinoHttp({
      logger,
      genReqId: (req: any) => req.id ?? undefined,
      autoLogging: { ignore: (req: any) => req.url === `${APP.API_PREFIX}/health` },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      serializers: {
        req: (req: any) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          userAgent: req.headers?.['user-agent'],
          userId: req.auth?.userId,
          role: req.auth?.role,
          vendorId: req.auth?.vendorId,
          deviceId: req.deviceId,
          sessionKey: req.sessionKey,
        }),
        res: (res: any) => ({ statusCode: res.statusCode }),
      },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.otp',
      ],
    }),
  );

  app.use(requestId);
  app.use(express.json({ limit: APP.JSON_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: APP.URLENCODED_LIMIT }));
  app.use(cookieParser());
  app.use(hpp());

  if (isEncryptionReady()) app.use(encryptionMiddleware);

  app.use(maintenanceMiddleware);
  app.use(globalRateLimit);
  app.use(tracking);

  app.use(APP.API_PREFIX, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
