process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.PORT = '5999';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/projectname_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? '';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-16-chars-long';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.SUPER_ADMIN_EMAIL = 'superadmin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'SuperSecret@123';
process.env.CORS_ORIGINS = 'http://localhost:3000,http://localhost:5173';
process.env.ENCRYPTION_ENABLED = 'false';
process.env.ENCRYPTION_KEY = '';
process.env.QUEUE_ENABLED = 'false';
process.env.WORKER_ENABLED = 'false';
process.env.TRACKING_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.SEED_DEMO_DATA = 'false';

process.env.OTP_REQUIRED = 'true';
process.env.OTP_SMS_ENABLED = 'false';
process.env.OTP_STATIC_CODE = '111111';
process.env.BREVO_API_KEY = '';
process.env.MSG91_AUTHKEY = '';
