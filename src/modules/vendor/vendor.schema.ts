import { z } from 'zod';
import { VENDOR_STATUS } from '../../constants/roles';
import { NAME } from '../../config/password.config';
import { VALIDATION } from '../../messages/validation';
import { GSTIN_REGEX, PAN_REGEX, IFSC_REGEX, UPI_REGEX } from '../../constants/countries';
import { common, paginationSchema } from '../../middlewares/validate.middleware';
import { UPLOAD_KIND } from '../../config/upload.config';

const shopName = z
  .string()
  .trim()
  .min(NAME.SHOP_MIN_LENGTH, VALIDATION.MIN_LENGTH('shopName', NAME.SHOP_MIN_LENGTH))
  .max(NAME.SHOP_MAX_LENGTH, VALIDATION.MAX_LENGTH('shopName', NAME.SHOP_MAX_LENGTH));

const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
  .optional();

const bankDetails = z
  .object({
    bankHolderName: z.string().trim().max(100).optional(),
    bankAccountNo: z.string().trim().max(30).optional(),
    bankIfsc: z
      .string()
      .trim()
      .max(15)
      .regex(IFSC_REGEX, VALIDATION.INVALID_IFSC)
      .optional()
      .or(z.literal('')),
    upiId: z
      .string()
      .trim()
      .max(100)
      .regex(UPI_REGEX, VALIDATION.INVALID_UPI)
      .optional()
      .or(z.literal('')),
  })
  .strict()
  .refine((v) => (v.bankIfsc && v.bankAccountNo) || v.upiId, {
    message: 'Provide bank account with IFSC, or a UPI ID.',
  });

export const updateProfileSchema = z
  .object({
    shopName: shopName.optional(),
    slug,
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    logo: z.string().trim().max(500).optional(),
    banner: z.string().trim().max(500).optional(),
    gstNumber: z
      .string()
      .trim()
      .max(20)
      .regex(GSTIN_REGEX, VALIDATION.INVALID_GSTIN)
      .optional()
      .or(z.literal('')),
    panNumber: z
      .string()
      .trim()
      .max(15)
      .regex(PAN_REGEX, VALIDATION.INVALID_PAN)
      .optional()
      .or(z.literal('')),
    payoutCycleDays: z.coerce.number().int().min(1).max(90).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const updateBankDetailsSchema = bankDetails;

export const approveSchema = z
  .object({
    commissionRate: z.coerce.number().min(0).max(100).optional(),
    remark: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const rejectSchema = z
  .object({
    reason: z.string().trim().min(1, VALIDATION.REQUIRED('reason')).max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const suspendSchema = z
  .object({
    reason: z.string().trim().min(1, VALIDATION.REQUIRED('reason')).max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const updateCommissionSchema = z
  .object({
    commissionRate: z.coerce
      .number()
      .min(0, VALIDATION.INVALID_PERCENT)
      .max(100, VALIDATION.INVALID_PERCENT),
  })
  .strict();

export const verifyDocumentsSchema = z
  .object({
    isVerified: z.boolean(),
    remark: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const requestPayoutSchema = z
  .object({
    amount: z.coerce.number().positive(VALIDATION.INVALID_NUMBER),
    method: z.enum(['BANK', 'UPI']).default('BANK'),
    notes: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const listVendorsSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE', 'all']).optional(),
  search: z.string().trim().max(120).optional(),
  hasDocuments: common.flagQuery,
  sort: z.string().max(40).optional(),
});

export const getVendorsSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE', 'all']).optional(),
});

export const vendorIdParamSchema = z.object({ id: common.cuid });

export const uploadDocumentsMetaSchema = z
  .object({
    docType: z
      .enum(['GST', 'PAN', 'AADHAAR', 'BANK_PROOF', 'ADDRESS_PROOF', 'OTHER'])
      .default('OTHER'),
    number: z.string().trim().max(40).optional(),
  })
  .strict();

export const uploadKind = UPLOAD_KIND.KYC;

export type UpdateVendorProfileInput = z.infer<typeof updateProfileSchema>;
export type BankDetailsInput = z.infer<typeof bankDetails>;
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;
export type ListVendorsQuery = z.infer<typeof listVendorsSchema>;
export { VENDOR_STATUS };
