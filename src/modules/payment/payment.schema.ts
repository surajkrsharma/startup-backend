import { z } from 'zod';
import { PaymentMethod, PaymentStatus, PayoutStatus, ReturnStatus } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { NAME } from '../../config/password.config';
import { PHONE_REGEX } from '../../constants/countries';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;

export const listPaymentsSchema = z
  .object({
    status: z.nativeEnum(PaymentStatus).optional(),
    method: z.nativeEnum(PaymentMethod).optional(),
    orderId: id.optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const verifyTokenPaymentSchema = z
  .object({
    orderId: id,
    paymentId: id.optional(),
    method: z.nativeEnum(PaymentMethod).optional(),
    reference: z.string().trim().max(120).optional(),
    providerRef: z.string().trim().max(120).optional(),
    signature: z.string().trim().max(400).optional(),
  })
  .strict();

export const payBalanceSchema = z
  .object({
    orderId: id,
    method: z.nativeEnum(PaymentMethod).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export const initiateRefundSchema = z
  .object({
    orderId: id,
    paymentId: id.optional(),
    amount: z.coerce.number().min(0).optional(),
    reason: z.string().trim().min(3, VALIDATION.REQUIRED('reason')).max(500),

    mode: z.enum(['ORIGINAL', 'WALLET', 'BANK']).optional().default('ORIGINAL'),
  })
  .strict();

export const processRefundSchema = z
  .object({
    status: z.enum(['PAID', 'FAILED']),
    providerRef: z.string().trim().max(120).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const paymentOrderParamSchema = z.object({ orderId: id });

export const refundParamSchema = z.object({ id });

export const codCollectSchema = z
  .object({
    orderId: id,
    subOrderId: id.optional(),
    amount: z.coerce.number().min(0).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export const walletAmountSchema = z
  .object({
    userId: id,
    amount: z.coerce.number().refine((n) => n !== 0, VALIDATION.INVALID_NUMBER),
    description: z.string().trim().max(300).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export const walletListSchema = z
  .object({
    type: z.enum(['CREDIT', 'DEBIT', 'REFUND', 'REWARD', 'REDEEM', 'ADJUSTMENT']).optional(),
    status: z.string().trim().max(20).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const walletTopUpSchema = z
  .object({
    amount: z.coerce.number().positive(VALIDATION.INVALID_PRICE),
    method: z.enum(['UPI', 'BANK', 'CARD', 'NETBANKING', 'RAZORPAY', 'STRIPE']).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict();

export const walletRedeemSchema = z
  .object({
    orderId: id,
    amount: z.coerce.number().min(0).optional(),
  })
  .strict();

export const walletCreditSchema = walletAmountSchema.extend({
  amount: z.coerce.number().positive(VALIDATION.INVALID_PRICE),
});

export const walletDebitSchema = walletAmountSchema.extend({
  amount: z.coerce.number().positive(VALIDATION.INVALID_PRICE),
});

export const listPayoutsSchema = z
  .object({
    status: z.nativeEnum(PayoutStatus).optional(),
    vendorId: id.optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const requestPayoutSchema = z
  .object({
    amount: z.coerce.number().min(0).optional(),
    method: z.enum(['BANK', 'UPI']).optional(),
    notes: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const payoutStatusSchema = z
  .object({
    status: z.nativeEnum(PayoutStatus),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    rejectReason: z.string().trim().max(500).optional(),
  })
  .strict();

export const earningsSchema = z
  .object({
    vendorId: id.optional(),
    status: z.nativeEnum(PayoutStatus).optional(),
    period: z.string().trim().max(20).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const payoutIdParamSchema = z.object({ id });

export const payoutSummarySchema = z.object({ vendorId: id.optional() }).strict();

export const bulkApproveSchema = z
  .object({
    payoutIds: z.array(id).min(1, VALIDATION.REQUIRED('payoutIds')).max(200),
    notes: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
  })
  .strict();

export const vendorIdParamSchema = z.object({ vendorId: id });

export const statementQuerySchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .strict();

export const manualPaymentSchema = z
  .object({
    reference: z.string().trim().min(3, VALIDATION.REQUIRED('reference')).max(120),
    amount: z.coerce.number().min(0).optional(),
    paymentId: id.optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const gatewayOrderSchema = z
  .object({
    orderId: id,
    amount: z.coerce.number().min(0).optional(),
  })
  .strict();

export const gatewayVerifySchema = z
  .object({
    orderId: id,
    razorpayOrderId: z.string().trim().min(1).max(120),
    razorpayPaymentId: z.string().trim().min(1).max(120),
    razorpaySignature: z.string().trim().min(1).max(400),
  })
  .strict();

export const listReturnsSchema = z
  .object({
    status: z.nativeEnum(ReturnStatus).optional(),
    orderId: id.optional(),
    vendorId: id.optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const requestReturnSchema = z
  .object({
    orderId: id,
    subOrderId: id.optional(),
    reasonId: id.optional(),
    reasonText: z.string().trim().max(500).optional(),
    comment: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    images: z.array(z.string().trim().max(300)).max(6).optional(),
    items: z
      .array(
        z
          .object({
            orderItemId: id,
            qty: z.coerce.number().int().min(1).max(999),
          })
          .strict(),
      )
      .min(1, VALIDATION.REQUIRED('items'))
      .max(50),
  })
  .strict()
  .refine((v) => Boolean(v.reasonId || v.reasonText), {
    message: 'Provide reasonId or reasonText.',
  });

export const returnStatusSchema = z
  .object({
    status: z.nativeEnum(ReturnStatus),
    remark: z.string().trim().max(500).optional(),
    rejectReason: z.string().trim().max(500).optional(),

    itemApproval: z
      .array(z.object({ returnItemId: id, isApproved: z.boolean() }).strict())
      .max(50)
      .optional(),
  })
  .strict();

export const returnTransitionSchema = returnStatusSchema.omit({ status: true });

export const rejectReturnSchema = returnTransitionSchema.refine(
  (v) => Boolean(v.rejectReason && String(v.rejectReason).trim().length > 0),
  { message: VALIDATION.REQUIRED('rejectReason') },
);

export const rejectPayoutSchema = payoutStatusSchema
  .omit({ status: true })
  .extend({ rejectReason: z.string().trim().min(3, VALIDATION.REQUIRED('rejectReason')).max(500) });

export const pickupConfirmSchema = z
  .object({
    otp: z.string().trim().length(4, 'Enter the 4 digit pickup OTP.').optional(),
  })
  .strict();

export const processReturnRefundSchema = z
  .object({
    amount: z.coerce.number().min(0).optional(),
    mode: z.enum(['ORIGINAL', 'WALLET', 'BANK']).optional(),
    providerRef: z.string().trim().max(120).optional(),
  })
  .strict();

export const returnReasonSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, VALIDATION.MIN_LENGTH('title', 2))
      .max(120)
      .default('Wrong item delivered'),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional().default(0),
  })
  .strict();

export const returnReasonUpdateSchema = returnReasonSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const returnIdParamSchema = z.object({ id });
export const returnOrderParamSchema = z.object({ orderId: id });

export type RequestReturnInput = z.infer<typeof requestReturnSchema>;
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const phoneSchema = z.string().trim().max(15).regex(PHONE_REGEX, VALIDATION.INVALID_PHONE);
