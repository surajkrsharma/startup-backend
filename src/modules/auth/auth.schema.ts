import { z } from 'zod';
import {
  REGISTER_TYPE,
  OTP_TYPE,
  OTP_CHANNEL,
  SOCIAL_PROVIDER,
  PLATFORM,
} from '../../constants/roles';
import { PASSWORD, NAME, PHONE } from '../../config/password.config';
import { OTP } from '../../config/otp.config';
import { EMAIL_REGEX, PHONE_REGEX } from '../../constants/countries';
import { VALIDATION } from '../../messages/validation';

const email = z
  .string()
  .trim()
  .min(1, VALIDATION.REQUIRED('email'))
  .max(150)
  .regex(EMAIL_REGEX, VALIDATION.INVALID_EMAIL)
  .transform((v) => v.toLowerCase());

const phone = z
  .string()
  .trim()
  .max(PHONE.MAX_LENGTH)
  .regex(PHONE_REGEX, VALIDATION.INVALID_PHONE)
  .optional()
  .or(z.literal(''));

const password = z
  .string()
  .min(PASSWORD.MIN_LENGTH, VALIDATION.MIN_LENGTH('password', PASSWORD.MIN_LENGTH))
  .max(PASSWORD.MAX_LENGTH, VALIDATION.MAX_LENGTH('password', PASSWORD.MAX_LENGTH))
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must contain at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character.');

const deviceData = z
  .object({
    deviceId: z.string().trim().max(64).optional(),
    platform: z.nativeEnum(PLATFORM).optional(),
    appVersion: z.string().trim().max(30).optional(),
    model: z.string().trim().max(80).optional(),
    locale: z.string().trim().max(20).optional(),
    timezone: z.string().trim().max(60).optional(),
  })
  .strict()
  .optional();

/**
 * Proof that the caller controls the contact being registered. Required: without
 * it anyone can register an account for an address they do not own.
 */
/**
 * Proof that the caller controls the contact being registered.
 *
 * Optional at the schema level and enforced in the service, because whether it
 * is required depends on OTP_REQUIRED. Making it conditionally required here
 * would change the request contract the moment that flag is toggled.
 */
const registerOtp = z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT).optional();

/**
 * `/auth/register` discriminated union on `type`.
 * CUSTOMER requires only identity fields; VENDOR additionally requires shop details.
 *
 * An unknown `type` is reported as "Invalid register type." rather than Zod's
 * generic enum error, so the caller can map it to INVALID_REGISTER_TYPE. The
 * fallback branch accepts any object solely so the custom issue is reachable —
 * a valid `type` always matches one of the two real branches first.
 */
const registerUnion = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal(REGISTER_TYPE.CUSTOMER),
      name: z
        .string()
        .trim()
        .min(NAME.MIN_LENGTH, VALIDATION.MIN_LENGTH('name', NAME.MIN_LENGTH))
        .max(NAME.MAX_LENGTH),
      email,
      phone,
      password,
      otp: registerOtp,
      deviceData,
    })
    .strict(),
  z
    .object({
      type: z.literal(REGISTER_TYPE.VENDOR),
      name: z
        .string()
        .trim()
        .min(NAME.MIN_LENGTH, VALIDATION.MIN_LENGTH('name', NAME.MIN_LENGTH))
        .max(NAME.MAX_LENGTH),
      email,
      phone,
      password,
      otp: registerOtp,
      shopName: z.string().trim().min(NAME.SHOP_MIN_LENGTH).max(NAME.SHOP_MAX_LENGTH),
      slug: z
        .string()
        .trim()
        .min(2)
        .max(120)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
        .optional(),
      description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
      gstNumber: z.string().trim().max(20).optional(),
      panNumber: z.string().trim().max(15).optional(),
      bankHolderName: z.string().trim().max(100).optional(),
      bankAccountNo: z.string().trim().max(30).optional(),
      bankIfsc: z.string().trim().max(15).optional(),
      upiId: z.string().trim().max(100).optional(),
      deviceData,
    })
    .strict(),
]);

const REGISTER_TYPES = [REGISTER_TYPE.CUSTOMER, REGISTER_TYPE.VENDOR] as const;

/**
 * Surfaces the discriminated union's real issues instead of a catch-all.
 *
 * A bad `type` still gets the friendly message, because that is the one error a
 * caller is most likely to hit and the least likely to understand. Everything
 * else is passed through verbatim — a catch-all branch here would report a
 * missing `otp` as "Invalid register type." and send the caller to the wrong
 * field.
 */
export const registerSchema = z.any().superRefine((value, ctx) => {
  const result = registerUnion.safeParse(value);

  if (result.success) return;

  const type = (value as { type?: unknown })?.type;
  const typeIsUnknown = typeof type !== 'string' || !REGISTER_TYPES.includes(type as any);

  if (typeIsUnknown) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'Invalid register type.',
    });
    return;
  }

  /**
   * The union's own issues, verbatim — a missing `otp` or an unknown key has to name itself, not
   * arrive as a generic type error.
   */
  for (const issue of result.error.errors) {
    ctx.addIssue(issue as z.ZodIssue);
  }
});

export const loginSchema = z
  .object({
    email: email.optional(),
    phone,
    password: z.string().min(1, VALIDATION.REQUIRED('password')).optional(),
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT).optional(),
    type: z.nativeEnum(OTP_TYPE).optional(),
    deviceData,
  })
  .strict()
  .refine((v) => v.password || v.otp, {
    message: VALIDATION.REQUIRED('password or otp'),
  })
  .refine((v) => v.email || v.phone, {
    message: VALIDATION.REQUIRED('email or phone'),
  });

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().trim().min(10).optional(),
  })
  .strict();

export const sendOtpSchema = z
  .object({
    type: z.nativeEnum(OTP_TYPE, {
      errorMap: () => ({ message: 'Invalid OTP type.' }),
    }),
    channel: z.nativeEnum(OTP_CHANNEL).default(OTP_CHANNEL.BOTH),
    identifier: z.string().trim().min(3, VALIDATION.IDENTIFIER_REQUIRED),
  })
  .strict();

export const verifyOtpSchema = z
  .object({
    type: z.nativeEnum(OTP_TYPE),
    identifier: z.string().trim().min(3, VALIDATION.IDENTIFIER_REQUIRED),
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT),
    channel: z.nativeEnum(OTP_CHANNEL).optional(),
    /** Two-factor login completes the session when true. */
    isLoginFlow: z.boolean().optional().default(false),
    deviceData,
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: email.optional(),
    phone,
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: VALIDATION.REQUIRED('email or phone') });

export const resetPasswordSchema = z
  .object({
    email: email.optional(),
    phone,
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT),
    type: z.nativeEnum(OTP_TYPE).default(OTP_TYPE.FORGOT_PASSWORD),
    newPassword: password,
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: VALIDATION.REQUIRED('email or phone') });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, VALIDATION.REQUIRED('currentPassword')),
    newPassword: password,
    /**
     * Second factor for the change, required only while OTP_REQUIRED is on and
     * the account has a verified contact. Optional in the schema so toggling
     * the flag never changes the request contract; enforced in the service.
     */
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT).optional(),
    logoutOtherDevices: z.boolean().optional().default(true),
  })
  .strict();

export const verifyContactSchema = z
  .object({
    email: email.optional(),
    phone,
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT),
    channel: z.nativeEnum(OTP_CHANNEL).optional(),
  })
  .strict();

export const twoFactorSchema = z
  .object({
    otp: z.string().trim().length(OTP.LENGTH, VALIDATION.INVALID_OTP_FORMAT),
    backupCode: z.string().trim().max(20).optional(),
  })
  .strict();

export const socialLoginSchema = z
  .object({
    provider: z.nativeEnum(SOCIAL_PROVIDER, {
      errorMap: () => ({ message: 'Social provider not supported.' }),
    }),
    idToken: z.string().trim().min(10, VALIDATION.REQUIRED('idToken')),
    accessToken: z.string().trim().max(4000).optional(),
    deviceData,
  })
  .strict();

export const linkSocialSchema = z
  .object({
    provider: z.nativeEnum(SOCIAL_PROVIDER),
    idToken: z.string().trim().min(10),
    accessToken: z.string().trim().max(4000).optional(),
  })
  .strict();

export const unlinkSocialSchema = z
  .object({
    provider: z.nativeEnum(SOCIAL_PROVIDER),
  })
  .strict();

export const checkAvailabilitySchema = z
  .object({
    email: email.optional(),
    phone,
    role: z.enum([REGISTER_TYPE.CUSTOMER, REGISTER_TYPE.VENDOR]).optional(),
  })
  .strict()
  .refine((v) => v.email || v.phone, {
    message: 'Provide email or phone to check.',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SendOtpInput = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type SocialLoginInput = z.infer<typeof socialLoginSchema>;
