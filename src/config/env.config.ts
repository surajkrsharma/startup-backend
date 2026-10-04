import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const optionalString = z.string().optional().default('');
const optionalUrl = z.string().url().optional().or(z.literal('')).default('');
const boolFlag = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const csvList = z
  .string()
  .optional()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_NAME: z.string().default('projectname'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    REDIS_URL: optionalUrl,
    REDIS_PREFIX: z.string().default('projectname'),

    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('7d'),

    SUPER_ADMIN_EMAIL: z.string().default('superadmin@projectname.com'),
    SUPER_ADMIN_PASSWORD: z.string().default('SuperSecret@123'),

    CORS_ORIGINS: csvList,
    SOCKET_CORS_ORIGINS: csvList,

    ENCRYPTION_ENABLED: boolFlag(false),
    ENCRYPTION_KEY: optionalString,

    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,
    CLOUDINARY_FOLDER: z.string().default('projectname'),

    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_SECURE: boolFlag(false),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAIL_FROM_NAME: z.string().default('ProjectName'),
    MAIL_FROM_EMAIL: z.string().default('no-reply@projectname.com'),

    BREVO_API_KEY: optionalString,
    BREVO_FROM_EMAIL: optionalString,
    BREVO_FROM_NAME: z.string().default('ProjectName'),
    BREVO_SENDER_NAME: optionalString,

    MSG91_AUTHKEY: optionalString,
    MSG91_SENDER_ID: optionalString,
    MSG91_TEMPLATE_ID: optionalString,
    MSG91_COUNTRY_CODE: z.string().default('91'),

    OTP_REQUIRED: boolFlag(true),
    OTP_SMS_ENABLED: boolFlag(false),

    FCM_SERVER_KEY: optionalString,
    FCM_ENABLED: boolFlag(false),

    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    STRIPE_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,

    SHIPPING_PARTNER_WEBHOOK_SECRET: optionalString,

    QUEUE_ENABLED: boolFlag(true),
    QUEUE_PREFIX: z.string().default('projectname'),
    WORKER_ENABLED: boolFlag(true),

    TRACKING_ENABLED: boolFlag(true),
    GEO_LOOKUP_ENABLED: boolFlag(true),

    RATE_LIMIT_ENABLED: boolFlag(true),

    OTP_STATIC_CODE: optionalString,

    PUBLIC_API_URL: optionalUrl,
  })
  .superRefine((env, ctx) => {
    if (env.OTP_STATIC_CODE) {
      if (!/^\d+$/.test(env.OTP_STATIC_CODE)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_STATIC_CODE'],
          message: 'OTP_STATIC_CODE must be digits only',
        });
      }
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_STATIC_CODE'],
          message: 'OTP_STATIC_CODE bypasses OTP delivery and must never be set in production',
        });
      }
    }

    if (env.ENCRYPTION_ENABLED) {
      if (!env.ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENCRYPTION_KEY'],
          message: 'ENCRYPTION_KEY is required when ENCRYPTION_ENABLED=true',
        });
      } else if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENCRYPTION_KEY'],
          message: 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
        });
      }
    }

    if (env.NODE_ENV === 'production' && env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Wildcard CORS origin is not allowed in production',
      });
    }

    if (env.QUEUE_ENABLED && !env.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when QUEUE_ENABLED=true',
      });
    }

    if (env.NODE_ENV === 'production' && env.OTP_REQUIRED) {
      const hasProvider = Boolean(
        env.BREVO_API_KEY ||
        (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) ||
        (env.MSG91_AUTHKEY && env.OTP_SMS_ENABLED),
      );
      if (!hasProvider) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_REQUIRED'],
          message:
            'OTP_REQUIRED=true in production needs a delivery provider. Set BREVO_API_KEY, ' +
            'SMTP_HOST/SMTP_USER/SMTP_PASS, or MSG91_AUTHKEY with OTP_SMS_ENABLED=true. ' +
            'Set OTP_REQUIRED=false only if you are still building.',
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.errors.map((e) => `  • ${e.path.join('.') || '(root)'}: ${e.message}`);

  throw new Error(`[env] Invalid environment variables:\n${lines.join('\n')}`);
}

export const ENV = parsed.data;
export type Env = typeof ENV;

export const isProduction = ENV.NODE_ENV === 'production';
export const isDevelopment = ENV.NODE_ENV === 'development';
export const isTest = ENV.NODE_ENV === 'test';

export const isRedisConfigured = Boolean(ENV.REDIS_URL);
export const isCloudinaryConfigured = Boolean(
  ENV.CLOUDINARY_CLOUD_NAME && ENV.CLOUDINARY_API_KEY && ENV.CLOUDINARY_API_SECRET,
);
export const isSmtpConfigured = Boolean(ENV.SMTP_HOST && ENV.SMTP_USER && ENV.SMTP_PASS);
export const isBrevoConfigured = Boolean(ENV.BREVO_API_KEY);
export const isMsg91Configured = Boolean(ENV.MSG91_AUTHKEY);

export const isEmailConfigured = isBrevoConfigured || isSmtpConfigured;
export const isSmsConfigured = isMsg91Configured;

export const isOtpDeliverable =
  isEmailConfigured || isSmsConfigured || Boolean(ENV.OTP_STATIC_CODE);
export const isRazorpayConfigured = Boolean(ENV.RAZORPAY_KEY_ID && ENV.RAZORPAY_KEY_SECRET);
export const isStripeConfigured = Boolean(ENV.STRIPE_KEY);
