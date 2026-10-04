import { ENV } from './env.config';

export const APP = {
  NAME: ENV.APP_NAME,
  API_PREFIX: '/api/v1',
  SERVER_NAME: `${ENV.APP_NAME}-api`,
  DEFAULT_PORT: 5000,
  DEFAULT_LOCALE: 'en',
  DEFAULT_TIMEZONE: 'Asia/Kolkata',
  DEFAULT_CURRENCY: 'INR',
  DEFAULT_DATE_FORMAT: 'DD-MM-YYYY',
  DEFAULT_TIME_FORMAT: 'hh:mm A',
  REQUEST_TIMEOUT_MS: 30_000,
  BODY_LIMIT: '1mb',
  JSON_LIMIT: '1mb',
  URLENCODED_LIMIT: '1mb',
  SHUTDOWN_TIMEOUT_MS: 15_000,
  VERSION: 'v1',
};

export const SERVER = {
  PORT: ENV.PORT,
  HOST: '0.0.0.0',
  NODE_ENV: ENV.NODE_ENV,
};

export const OPS = {
  JOB_BATCH_SIZE: 5000,
  BULK_MAX_ROWS: 5000,
  NOTIFICATION_BODY_MAX_CHARS: 160,
  TX_MAX_WAIT_MS: 5000,
  TX_TIMEOUT_MS: 15_000,
} as const;

export const HEADER = {
  REQUEST_ID: 'x-request-id',
  RESPONSE_REQUEST_ID: 'X-Request-Id',
  DEVICE_ID: 'x-device-id',
  PLATFORM: 'x-platform',
  APP_VERSION: 'x-app-version',
  ENCRYPTED: 'x-encrypted',
  SESSION_ID: 'x-session-id',
  API_KEY: 'x-api-key',
  SIGNATURE: 'x-signature',
  REFRESH_TOKEN: 'refreshToken',
} as const;

export const SKIP_ENCRYPTION_PATHS = ['/health', '/docs', '/docs.json', '/webhooks', '/track'];
export const MAINTENANCE_ALLOW_PATHS = ['/health', '/docs', '/docs.json', '/version'];
export const MAINTENANCE_ADMIN_PATHS = ['/admin'];
