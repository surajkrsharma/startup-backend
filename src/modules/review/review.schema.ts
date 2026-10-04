import { z } from 'zod';
import { CouponStatus, CouponType, ReviewStatus } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { ERROR } from '../../messages/error';
import { NAME } from '../../config/password.config';
import { COUPON_CODE_REGEX } from '../../constants/countries';
import { common, paginationSchema } from '../../middlewares/validate.middleware';
import { D } from '../../utils/defaults';

const id = common.cuid;

export const listReviewsSchema = z
  .object({
    productId: id.optional(),
    vendorId: id.optional(),
    userId: id.optional(),
    status: z.nativeEnum(ReviewStatus).optional(),
    minRating: z.coerce.number().int().min(1).max(5).optional(),
    maxRating: z.coerce.number().int().min(1).max(5).optional(),
    withImages: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const addReviewSchema = z
  .object({
    productId: id,
    rating: z.coerce
      .number()
      .int()
      .min(1, ERROR.REVIEW.RATING_INVALID)
      .max(5, ERROR.REVIEW.RATING_INVALID),
    title: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional(),
    comment: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    images: z.array(z.string().trim().max(300)).max(5).optional(),
  })
  .strict();

export const updateReviewSchema = z
  .object({
    rating: z.coerce
      .number()
      .int()
      .min(1, ERROR.REVIEW.RATING_INVALID)
      .max(5, ERROR.REVIEW.RATING_INVALID)
      .optional(),
    title: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional(),
    comment: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    images: z.array(z.string().trim().max(300)).max(5).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const moderateReviewSchema = z
  .object({
    status: z.nativeEnum(ReviewStatus),
  })
  .strict();

export const replyReviewSchema = z
  .object({
    reply: z.string().trim().min(2, VALIDATION.MIN_LENGTH('reply', 2)).max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const reviewSummaryParamSchema = z.object({ productId: id });

export const reviewDistributionParamSchema = z.object({ productId: id });

export const listQuestionsSchema = z
  .object({
    productId: id.optional(),
    userId: id.optional(),
    vendorId: id.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const askQuestionSchema = z
  .object({
    productId: id,
    question: z
      .string()
      .trim()
      .min(5, VALIDATION.MIN_LENGTH('question', 5))
      .max(NAME.COMMENT_MAX_LENGTH),
    isAnonymous: z.boolean().optional().default(false),
  })
  .strict();

export const answerQuestionSchema = z
  .object({
    answer: z
      .string()
      .trim()
      .min(2, VALIDATION.MIN_LENGTH('answer', 2))
      .max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const moderateQuestionSchema = z
  .object({
    isApproved: z.boolean(),
  })
  .strict();

export const questionIdParamSchema = z.object({ id });

export const listCouponsSchema = z
  .object({
    type: z.nativeEnum(CouponType).optional(),
    status: z.nativeEnum(CouponStatus).optional(),
    vendorId: id.optional(),
    isActive: z.enum(['true', 'false']).optional(),
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
  })
  .merge(paginationSchema)
  .strict();

const couponBody = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(COUPON_CODE_REGEX, 'Code may contain A-Z, 0-9, _ and - only.'),
    title: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional(),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    type: z.nativeEnum(CouponType).default('FLAT'),
    value: z.coerce.number().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('value')),
    maxDiscount: z.coerce.number().min(0).optional().default(0),
    minOrderAmount: z.coerce.number().min(0).optional().default(0),
    maxUsage: z.coerce.number().int().min(0).optional().default(0),
    maxUsagePerUser: z.coerce.number().int().min(0).optional().default(0),
    vendorId: id.optional(),
    productIds: z.array(id).max(100).optional().default([]),
    categoryIds: z.array(id).max(100).optional().default([]),
    startsAt: common.dateString.optional(),
    expiresAt: common.dateString.optional(),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

const couponRules = [
  {
    message: 'A percent coupon cannot exceed 100%.',
    check: (v: { type?: string; value?: number }) =>
      D.str(v.type) !== 'PERCENT' || v.value === undefined || v.value <= 100,
  },
  {
    message: 'Expiry must be after the start.',
    check: (v: { expiresAt?: Date | string; startsAt?: Date | string }) =>
      !v.expiresAt || !v.startsAt || new Date(v.expiresAt as any) > new Date(v.startsAt as any),
  },
];

export const createCouponSchema = couponBody.superRefine((v, ctx) => {
  for (const rule of couponRules) {
    if (!rule.check(v as any)) ctx.addIssue({ code: 'custom', message: rule.message });
  }
});

export const updateCouponSchema = couponBody.partial().superRefine((v, ctx) => {
  if (Object.keys(v).length === 0) {
    ctx.addIssue({ code: 'custom', message: VALIDATION.INVALID_JSON });
  }
  for (const rule of couponRules) {
    if (!rule.check(v as any)) ctx.addIssue({ code: 'custom', message: rule.message });
  }
});

export const toggleCouponSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const validateCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(COUPON_CODE_REGEX, 'Code may contain A-Z, 0-9, _ and - only.'),
    orderValue: z.coerce.number().min(0).optional(),
  })
  .strict();

export const couponIdParamSchema = z.object({ id });

export const listFlashSalesSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),

    scope: z.enum(['all', 'live', 'upcoming', 'ended']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createFlashSaleSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.TITLE_MAX_LENGTH),
    banner: z.string().trim().max(300).optional(),
    startsAt: common.dateString,
    endsAt: common.dateString,
    discountType: z.enum(['PERCENT', 'FLAT']).default('PERCENT'),
    discountValue: z.coerce.number().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('discountValue')),
    items: z
      .array(
        z
          .object({
            productId: id,
            saleStock: z.coerce.number().int().min(0).optional().default(0),

            salePrice: z.coerce.number().min(0).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'End time must be after start time.',
  });

export const updateFlashSaleSchema = z
  .object({
    name: z.string().trim().min(2).max(NAME.TITLE_MAX_LENGTH).optional(),
    banner: z.string().trim().max(300).optional(),
    startsAt: common.dateString.optional(),
    endsAt: common.dateString.optional(),
    discountType: z.enum(['PERCENT', 'FLAT']).optional(),
    discountValue: z.coerce.number().min(0).optional(),
    isActive: z.boolean().optional(),
    items: z
      .array(
        z
          .object({
            productId: id,
            saleStock: z.coerce.number().int().min(0).optional(),
            salePrice: z.coerce.number().min(0).optional(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const flashSaleIdParamSchema = z.object({ id });

export const flashSlugParamSchema = z.object({ slug: common.cuidOrSlug });

export const questionProductParamSchema = z.object({ productId: id });

export type AddReviewInput = z.infer<typeof addReviewSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
