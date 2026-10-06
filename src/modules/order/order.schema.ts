import { z } from 'zod';

import { ERROR } from '../../messages/error';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { NAME, WARRANTY } from '../../config/password.config';
import { PHONE_REGEX } from '../../constants/countries';
import { common, paginationSchema } from '../../middlewares/validate.middleware';
import { ORDER_STATUS } from '../../constants/statuses';

const id = common.cuid;

const name = z
  .string()
  .trim()
  .min(2, VALIDATION.MIN_LENGTH('fullName', 2))
  .max(NAME.MAX_LENGTH, VALIDATION.MAX_LENGTH('fullName', NAME.MAX_LENGTH));

const phone = z.string().trim().max(15).regex(PHONE_REGEX, VALIDATION.INVALID_PHONE);
const pincode = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/, VALIDATION.INVALID_PINCODE);

export const listOrdersSchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    paymentStatus: z.nativeEnum(PaymentStatus).optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    vendorId: id.optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    search: z.string().trim().max(120).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const orderIdParamSchema = z.object({ id });

export const addOrderTagsSchema = z
  .object({
    labels: z
      .array(z.string().trim().min(1).max(WARRANTY.MAX_TAG_LENGTH))
      .min(1, ERROR.ORDER.TAG_REQUIRED)
      .max(WARRANTY.MAX_TAGS_PER_ORDER),
    color: z.string().trim().max(20).optional(),
  })
  .strict();

export const orderTagParamSchema = z.object({ id, tagId: id });

export const addOrderNoteSchema = z
  .object({
    note: z.string().trim().min(1, VALIDATION.REQUIRED('note')).max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const orderNoteParamSchema = z.object({ id, noteId: id });

export const orderNumberParamSchema = z.object({ orderNumber: z.string().trim().min(4).max(32) });

export const placeOrderSchema = z
  .object({
    addressId: id.optional(),

    address: z
      .object({
        fullName: name,
        phone,
        line1: z.string().trim().min(1).max(NAME.ADDRESS_MAX_LENGTH),
        line2: z.string().trim().max(NAME.ADDRESS_MAX_LENGTH).optional(),
        landmark: z.string().trim().max(200).optional(),
        city: z.string().trim().min(1).max(80),
        state: z.string().trim().min(1).max(80),
        stateCode: z.string().trim().max(10).optional(),
        country: z.string().trim().max(80).optional(),
        pincode,
      })
      .strict()
      .optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.COD),

    couponCode: z.string().trim().max(24).optional(),
    useWalletBalance: z.boolean().optional().default(false),
    walletAmount: z.coerce.number().min(0).optional(),
    notes: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),

    skipStatus: z.boolean().optional().default(false),
  })
  .strict()
  .refine((v) => Boolean(v.addressId || v.address), {
    message: ERROR.ORDER.ADDRESS_INPUT_REQUIRED,
  });

export const updateOrderStatusSchema = z
  .object({
    status: z.nativeEnum(OrderStatus),
    remark: z.string().trim().max(500).optional(),
    location: z.string().trim().max(120).optional(),
  })
  .strict();

export const updateSubOrderStatusSchema = z
  .object({
    status: z.nativeEnum(OrderStatus),
    remark: z.string().trim().max(500).optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    reason: z.string().trim().min(3, VALIDATION.REQUIRED('reason')).max(500),

    subOrderId: id.optional(),
  })
  .strict();

export const cancelSubOrderSchema = z
  .object({
    reason: z.string().trim().min(3, VALIDATION.REQUIRED('reason')).max(500),
  })
  .strict();

export const assignDeliveryBoySchema = z
  .object({
    deliveryBoyId: id,
  })
  .strict();

export const reorderSchema = z
  .object({
    orderId: id,

    skipUnavailable: z.boolean().optional().default(true),
  })
  .strict();

export const confirmDeliverySchema = z
  .object({
    otp: z.string().trim().length(4).optional(),
    remarks: z.string().trim().max(300).optional(),

    collectedAmount: z.coerce.number().min(0).optional(),
  })
  .strict();

export const vendorOrdersSchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const invoiceParamSchema = z.object({ id });

export const invoiceQuerySchema = z
  .object({
    format: z.enum(['html', 'json']).optional().default('html'),
  })
  .strict();

export const trackParamSchema = z.object({ id: z.string().trim().min(4).max(32) });

export const subOrderParamSchema = z.object({ subOrderId: z.string().trim().min(1).max(40) });

export const returnIdParamSchema = z.object({ returnId: z.string().trim().min(1).max(40) });

export const returnRequestSchema = z
  .object({
    subOrderId: z.string().trim().min(1).max(40).optional(),
    reasonId: z.string().trim().min(1).max(40).optional(),
    reasonText: z.string().trim().max(500).optional(),
    comment: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    images: z.array(z.string().trim().max(300)).max(6).optional(),
    items: z
      .array(
        z
          .object({
            orderItemId: z.string().trim().min(1).max(40),
            qty: z.coerce.number().int().min(1).max(999),
          })
          .strict(),
      )
      .min(1, VALIDATION.REQUIRED('items'))
      .max(50),
  })
  .strict()
  .refine((v) => Boolean(v.reasonId || v.reasonText), {
    message: ERROR.RETURN.REASON_INPUT_REQUIRED,
  });

export const returnDecisionSchema = z
  .object({
    remark: z.string().trim().max(500).optional(),
    itemApproval: z
      .array(z.object({ returnItemId: z.string().trim().min(1), isApproved: z.boolean() }).strict())
      .max(50)
      .optional(),
  })
  .strict();

export const rejectReturnDecisionSchema = returnDecisionSchema.refine(
  (v) => Boolean(v.remark && String(v.remark).trim().length > 0),
  { message: VALIDATION.REQUIRED('remark') },
);

export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS);

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
