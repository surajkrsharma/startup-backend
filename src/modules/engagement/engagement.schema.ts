import { z } from 'zod';

import { ERROR } from '../../messages/error';
import { GiftCardStatus, LoyaltyTxnType, NotificationChannel } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { NAME } from '../../config/password.config';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;
const money2 = z.coerce.number().min(0).max(10_000_000);

export const listLoyaltySchema = z
  .object({
    type: z.nativeEnum(LoyaltyTxnType).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const redeemPointsSchema = z
  .object({
    points: z.coerce.number().int().positive(),
  })
  .strict();

export const adjustPointsSchema = z
  .object({
    points: z.coerce
      .number()
      .int()
      .refine((v) => v !== 0, { message: ERROR.LOYALTY.ZERO_POINTS }),
    description: z
      .string()
      .trim()
      .max(NAME.COMMENT_MAX_LENGTH)
      .optional()
      .default('Admin adjustment'),
  })
  .strict();

export const loyaltyUserIdParamSchema = z.object({ userId: id });

export const applyReferralSchema = z
  .object({
    referralCode: z.string().trim().min(4, VALIDATION.MIN_LENGTH('referralCode', 4)).max(40),
  })
  .strict();

export const listReferralsSchema = z
  .object({
    status: z.enum(['PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const listAdminReferralsSchema = z
  .object({
    status: z.enum(['PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const referralIdParamSchema = z.object({ id });

export const referralStatusSchema = z
  .object({
    status: z.enum(['PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED']),
  })
  .strict();

export const listGiftCardsSchema = z
  .object({
    status: z.nativeEnum(GiftCardStatus).optional(),
    userId: id.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createGiftCardSchema = z
  .object({
    title: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional().default(''),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional().default(''),
    value: money2,

    code: z.string().trim().min(6).max(24).optional(),
    userId: id.optional(),
    expiresInDays: z.coerce.number().int().positive().max(3650).optional(),
  })
  .strict();

export const redeemGiftCardSchema = z
  .object({
    code: z.string().trim().min(6).max(24),
    orderId: id.optional(),

    amount: money2.optional(),
  })
  .strict();

export const listAllGiftCardsSchema = z
  .object({
    status: z.nativeEnum(GiftCardStatus).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const giftCardIdParamSchema = z.object({ id });

export const checkGiftCardSchema = z.object({ code: z.string().trim().min(6).max(24) }).strict();

export const giftCardCodeParamSchema = z.object({ code: z.string().trim().min(6).max(24) });

const templateBody = z.object({
  key: z
    .string()
    .trim()
    .min(2, VALIDATION.MIN_LENGTH('key', 2))
    .max(80)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, VALIDATION.INVALID_SLUG),
  name: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional(),
  variables: z.array(z.string().trim().max(60)).max(30).optional(),
  isActive: z.boolean().optional(),
});

export const createEmailTemplateSchema = templateBody
  .extend({
    subject: z.string().trim().min(1, VALIDATION.REQUIRED('subject')).max(300),
    htmlBody: z.string().trim().min(1, VALIDATION.REQUIRED('htmlBody')).max(60_000),
    textBody: z.string().trim().max(60_000).optional(),
  })
  .strict();

export const createSmsTemplateSchema = templateBody
  .extend({
    body: z.string().trim().min(1, VALIDATION.REQUIRED('body')).max(1000),
  })
  .strict();

export const createNotificationTemplateSchema = templateBody
  .extend({
    channel: z.nativeEnum(NotificationChannel).optional(),
    title: z.string().trim().min(1, VALIDATION.REQUIRED('title')).max(200),
    body: z.string().trim().min(1, VALIDATION.REQUIRED('body')).max(2000),
  })
  .strict();

export const listTemplatesSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const templateKeyParamSchema = z.object({ key: z.string().trim().min(2).max(80) });

export const renderTemplateSchema = z
  .object({
    values: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .default({}),
  })
  .strict();

export const renderTemplateValuesSchema = z
  .object({
    values: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .default({}),
  })
  .strict();

export const templateChannelQuerySchema = z
  .object({ channel: z.nativeEnum(NotificationChannel).optional() })
  .strict();

type Assert<T> = T;
export type CreateGiftCardInput = Assert<z.infer<typeof createGiftCardSchema>>;
export type ApplyReferralInput = Assert<z.infer<typeof applyReferralSchema>>;
export type RedeemPointsInput = Assert<z.infer<typeof redeemPointsSchema>>;
