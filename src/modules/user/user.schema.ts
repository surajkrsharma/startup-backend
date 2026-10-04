import { z } from 'zod';
import { ROLES, ROLE_VALUES } from '../../constants/roles';
import { ADDRESS_TYPE } from '../../constants/roles';
import {
  PHONE_REGEX,
  EMAIL_REGEX,
  COUNTRY_CODE,
  DEFAULT_DIAL_CODE,
} from '../../constants/countries';
import { NAME, PHONE } from '../../config/password.config';
import { VALIDATION } from '../../messages/validation';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const name = z
  .string()
  .trim()
  .min(NAME.MIN_LENGTH, VALIDATION.MIN_LENGTH('name', NAME.MIN_LENGTH))
  .max(NAME.MAX_LENGTH, VALIDATION.MAX_LENGTH('name', NAME.MAX_LENGTH));

const email = z
  .string()
  .trim()
  .max(150)
  .regex(EMAIL_REGEX, VALIDATION.INVALID_EMAIL)
  .transform((v) => v.toLowerCase())
  .optional();

const phone = z
  .string()
  .trim()
  .max(PHONE.MAX_LENGTH)
  .regex(PHONE_REGEX, VALIDATION.INVALID_PHONE)
  .optional()
  .or(z.literal(''));

const pincode = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/, VALIDATION.INVALID_PINCODE);

const countryCode = z
  .string()
  .trim()
  .length(2)
  .refine((v) => Object.values(COUNTRY_CODE).includes(v as any), VALIDATION.INVALID_COUNTRY);

const addressBody = z
  .object({
    type: z.nativeEnum(ADDRESS_TYPE).default(ADDRESS_TYPE.HOME),
    fullName: name,
    phone,
    line1: z.string().trim().min(1, VALIDATION.REQUIRED('line1')).max(NAME.ADDRESS_MAX_LENGTH),
    line2: z.string().trim().max(NAME.ADDRESS_MAX_LENGTH).optional(),
    landmark: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1, VALIDATION.REQUIRED('city')).max(80),
    state: z.string().trim().min(1, VALIDATION.REQUIRED('state')).max(80),
    stateCode: z.string().trim().max(10).optional(),
    country: z.string().trim().max(80).optional(),
    countryCode: countryCode.default(COUNTRY_CODE.IN),
    pincode,
    isDefault: z.boolean().optional().default(false),
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: name.optional(),
    email,
    phone,
    avatarUrl: z.string().trim().max(500).optional(),
    loyaltyTier: z.string().trim().max(30).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: VALIDATION.INVALID_JSON,
  });

export const addAddressSchema = addressBody;

export const updateAddressSchema = addressBody.partial().refine((v) => Object.keys(v).length > 0, {
  message: VALIDATION.INVALID_JSON,
});

export const addressIdParamSchema = z.object({ id: common.cuid });

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1, VALIDATION.REQUIRED('password')).optional(),
    reason: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const listUsersSchema = paginationSchema.extend({
  role: z.enum(ROLE_VALUES as [string, ...string[]]).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'all']).optional(),
  vendorStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE']).optional(),
  isVerified: common.flagQuery,
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});

export const getUserByIdSchema = z.object({ id: common.cuid });

export const updateUserSchema = z
  .object({
    name: name.optional(),
    email,
    phone,
    role: z.enum(ROLE_VALUES as [string, ...string[]]).optional(),
    isActive: z.boolean().optional(),
    isEmailVerified: z.boolean().optional(),
    isPhoneVerified: z.boolean().optional(),
    avatarUrl: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const toggleStatusSchema = z
  .object({
    isActive: z.boolean().optional(),
    reason: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict()
  .refine((v) => typeof v.isActive === 'boolean', {
    message: VALIDATION.REQUIRED('isActive'),
  });

export const impersonateSchema = z
  .object({
    reason: z.string().trim().min(1, VALIDATION.REQUIRED('reason')).max(NAME.COMMENT_MAX_LENGTH),
    durationMin: z.number().int().min(1).max(480).optional().default(30),
  })
  .strict();

export const userOrdersSchema = paginationSchema.extend({
  status: z.string().trim().max(30).optional(),
});

export const userActivitySchema = paginationSchema.extend({
  action: z.string().trim().max(60).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const avatarSchema = z.object({
  avatarUrl: z.string().trim().url(VALIDATION.INVALID_URL).max(500),
});

export const setDefaultAddressSchema = z.object({ id: common.cuid });

export const UPLOAD_FIELD = 'avatar';
export const DEFAULT_DIAL = DEFAULT_DIAL_CODE;
export const CUSTOMER_ROLE = ROLES.CUSTOMER;

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AddressInput = z.infer<typeof addressBody>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
