import { z } from 'zod';

import { ERROR } from '../../messages/error';
import { OPS } from '../../config/app.config';
import { WebhookProvider } from '@prisma/client';
import { VALIDATION } from '../../messages/validation';
import { NAME } from '../../config/password.config';
import { PHONE_REGEX } from '../../constants/countries';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;
const url = z.string().trim().url(VALIDATION.INVALID_URL).max(500);

export const listPagesSchema = z
  .object({
    isPublished: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createPageSchema = z
  .object({
    title: z.string().trim().min(2, VALIDATION.MIN_LENGTH('title', 2)).max(NAME.TITLE_MAX_LENGTH),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
      .optional(),
    content: z.string().max(60_000).optional(),
    image: z.string().trim().max(300).optional(),
    isPublished: z.boolean().optional().default(true),
    metaTitle: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional(),
    metaDescription: z.string().trim().max(300).optional(),
  })
  .strict();

export const updatePageSchema = createPageSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const pageSlugParamSchema = z.object({ slug: common.cuidOrSlug });

export const listBlogsSchema = z
  .object({
    isPublished: z.enum(['true', 'false']).optional(),
    tag: z.string().trim().max(60).optional(),
    authorId: id.optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createBlogSchema = z
  .object({
    title: z.string().trim().min(2, VALIDATION.MIN_LENGTH('title', 2)).max(NAME.TITLE_MAX_LENGTH),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
      .optional(),
    excerpt: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    content: z.string().max(60_000).optional(),
    coverImage: z.string().trim().max(300).optional(),
    authorId: id.optional(),
    tags: z.array(z.string().trim().max(40)).max(20).optional().default([]),
    isPublished: z.boolean().optional().default(true),
  })
  .strict();

export const updateBlogSchema = createBlogSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const blogSlugParamSchema = z.object({ slug: common.cuidOrSlug });

export const listFaqsSchema = z
  .object({
    category: z.string().trim().max(80).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createFaqSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(5, VALIDATION.MIN_LENGTH('question', 5))
      .max(NAME.TITLE_MAX_LENGTH),
    answer: z
      .string()
      .trim()
      .min(2, VALIDATION.MIN_LENGTH('answer', 2))
      .max(NAME.COMMENT_MAX_LENGTH),
    category: z.string().trim().max(80).optional().default(''),
    sortOrder: z.coerce.number().int().min(0).optional().default(0),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const updateFaqSchema = createFaqSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const faqIdParamSchema = z.object({ id });

export const listBannersSchema = z
  .object({
    type: z.string().trim().max(40).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

const bannerBody = z
  .object({
    title: z.string().trim().min(2, VALIDATION.MIN_LENGTH('title', 2)).max(NAME.TITLE_MAX_LENGTH),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
      .optional(),
    image: z.string().trim().max(300).optional().default(''),
    mobileImage: z.string().trim().max(300).optional().default(''),
    type: z.enum(['HOME', 'PRODUCT', 'CATEGORY', 'SIDEBAR', 'PROMO']).optional().default('HOME'),
    linkUrl: z
      .union([url, z.literal('')])
      .optional()
      .default(''),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional().default(0),
    startsAt: common.dateString.optional(),
    endsAt: common.dateString.optional(),
  })
  .strict();

const bannerWindowValid = (v: { startsAt?: Date | string; endsAt?: Date | string }): boolean =>
  !v.startsAt || !v.endsAt || new Date(v.endsAt as any) > new Date(v.startsAt as any);

export const createBannerSchema = bannerBody.superRefine((v, ctx) => {
  if (!bannerWindowValid(v as any)) {
    ctx.addIssue({ code: 'custom', message: ERROR.BANNER.INVALID_WINDOW });
  }
});

export const updateBannerSchema = bannerBody.partial().superRefine((v, ctx) => {
  if (Object.keys(v).length === 0) {
    ctx.addIssue({ code: 'custom', message: VALIDATION.INVALID_JSON });
  }
  if (!bannerWindowValid(v as any)) {
    ctx.addIssue({ code: 'custom', message: ERROR.BANNER.INVALID_WINDOW });
  }
});

export const bannerIdParamSchema = z.object({ id });

export const submitContactSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.MAX_LENGTH),
    email: z.string().trim().email(VALIDATION.INVALID_EMAIL),

    phone: z.string().trim().max(15).regex(PHONE_REGEX, VALIDATION.INVALID_PHONE).optional(),
    subject: z.string().trim().max(NAME.TITLE_MAX_LENGTH).optional().default(''),
    message: z
      .string()
      .trim()
      .min(5, VALIDATION.MIN_LENGTH('message', 5))
      .max(NAME.COMMENT_MAX_LENGTH),
  })
  .strict();

export const listContactsSchema = z
  .object({
    isRead: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const markContactReadSchema = z
  .object({
    isRead: z.boolean().optional().default(true),
  })
  .strict();

export const subscribeSchema = z
  .object({
    email: z.string().trim().email(VALIDATION.INVALID_EMAIL),
  })
  .strict();

export const listSubscribersSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const unsubscribeSchema = z
  .object({
    token: z.string().trim().min(8).max(120),
  })
  .strict();

export const listCountriesSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),
    search: z.string().trim().max(80).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const listStatesSchema = z
  .object({
    countryCode: z.string().trim().length(2).optional(),
    isActive: z.enum(['true', 'false']).optional(),

    includeCities: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const listCitiesSchema = z
  .object({
    stateCode: z.string().trim().max(10).optional(),
    isServiceable: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const checkPincodeSchema = z
  .object({
    pincode: z
      .string()
      .trim()
      .regex(/^\d{4,10}$/, VALIDATION.INVALID_PINCODE),
  })
  .strict();

export const currencySchema = z
  .object({
    code: z.string().trim().length(3).toUpperCase(),
    name: z.string().trim().min(2).max(80),
    symbol: z.string().trim().max(8).optional().default(''),
    decimals: z.coerce.number().int().min(0).max(4).optional().default(2),
    rate: z.coerce.number().min(0).optional().default(1),
    isDefault: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const currencyUpdateSchema = currencySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const taxConfigSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.TITLE_MAX_LENGTH),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
      .optional(),
    percent: z.coerce.number().min(0).max(100, VALIDATION.INVALID_PERCENT),
    cgstPercent: z.coerce.number().min(0).max(100).optional().default(0),
    sgstPercent: z.coerce.number().min(0).max(100).optional().default(0),
    igstPercent: z.coerce.number().min(0).max(100).optional().default(0),
    isInclusive: z.boolean().optional().default(false),
    vendorId: id.optional(),
    stateCode: z.string().trim().max(10).optional().default(''),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const taxConfigUpdateSchema = taxConfigSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const translationSchema = z
  .object({
    locale: z.string().trim().min(2).max(10),
    namespace: z.string().trim().max(40).optional().default('common'),
    entries: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(120),
            value: z.string().max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const translationQuerySchema = z
  .object({
    locale: z.string().trim().min(2).max(10).optional(),
    namespace: z.string().trim().max(40).optional(),
  })
  .strict();

export const dropdownSchema = z
  .object({
    type: z.string().trim().min(2, VALIDATION.MIN_LENGTH('type', 2)).max(40),
    label: z.string().trim().max(120).optional().default(''),
    value: z.string().trim().min(1, VALIDATION.REQUIRED('value')).max(120),
    sortOrder: z.coerce.number().int().min(0).optional().default(0),
    isActive: z.boolean().optional().default(true),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export const dropdownQuerySchema = z
  .object({
    type: z.string().trim().max(40).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const contentIdParamSchema = z.object({ id });

export const listWebhooksSchema = z
  .object({
    provider: z.nativeEnum(WebhookProvider).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const createWebhookSchema = z
  .object({
    url,
    events: z.array(z.string().trim().max(60)).min(1, VALIDATION.REQUIRED('events')).max(50),
    provider: z.nativeEnum(WebhookProvider).optional().default('CUSTOM'),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const updateWebhookSchema = createWebhookSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const webhookLogSchema = z
  .object({
    direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
    event: z.string().trim().max(60).optional(),
    isProcessed: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const webhookIdParamSchema = z.object({ id });

export const webhookProviderParamSchema = z.object({
  provider: z.enum(['razorpay', 'stripe', 'shipping', 'custom']),
});

export const listJobsSchema = z
  .object({
    type: z.string().trim().max(40).optional(),
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const jobIdParamSchema = z.object({ jobId: z.string().trim().min(4).max(64) });

export const reportTypeParamSchema = z
  .object({
    type: z.enum([
      'SALES',
      'ORDERS',
      'PRODUCTS',
      'CUSTOMERS',
      'VENDORS',
      'PAYOUTS',
      'TAX',
      'INVENTORY',
      'RETURNS',
    ]),
  })
  .strict();

export const bulkProductsSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            name: z.string().trim().min(2).max(NAME.TITLE_MAX_LENGTH),
            price: z.coerce.number().min(0),
            mrpPrice: z.coerce.number().min(0).optional(),
            stock: z.coerce.number().int().min(0).optional().default(0),
            sku: z.string().trim().max(60).optional(),
            categoryId: id.optional(),
            brandId: id.optional(),
            taxPercent: z.coerce.number().min(0).max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    continueOnError: z.boolean().optional().default(true),
  })
  .strict();

export const reportSchema = z
  .object({
    from: common.isoDate.optional(),
    to: common.isoDate.optional(),
    vendorId: id.optional(),
    format: z.enum(['json', 'csv']).optional().default('json'),
  })
  .strict();

export const createScheduleSchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.TITLE_MAX_LENGTH),
    reportType: z.enum([
      'SALES',
      'ORDERS',
      'PRODUCTS',
      'CUSTOMERS',
      'VENDORS',
      'PAYOUTS',
      'TAX',
      'INVENTORY',
      'RETURNS',
    ]),

    cron: z
      .string()
      .trim()
      .regex(/^[\d*,\-/]+(\s+[\d*,\-/]+){4}$/, 'Cron must have five space-separated fields.'),
    recipients: z.array(z.string().trim().email(VALIDATION.INVALID_EMAIL)).min(1).max(20),
    format: z.enum(['CSV', 'JSON', 'PDF']).optional().default('CSV'),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const listSchedulesSchema = z
  .object({
    isActive: z.enum(['true', 'false']).optional(),
  })
  .merge(paginationSchema)
  .strict();

export const scheduleIdParamSchema = z.object({ id });

export const sendCampaignSchema = z
  .object({
    subject: z.string().trim().min(2, VALIDATION.REQUIRED('subject')).max(NAME.TITLE_MAX_LENGTH),
    body: z.string().trim().min(2, VALIDATION.REQUIRED('body')).max(20_000),

    templateKey: z.string().trim().max(60).optional(),
  })
  .strict();

export const bulkRowsSchema = z
  .object({
    rows: z.array(z.record(z.unknown())).min(1, VALIDATION.REQUIRED('rows')).max(OPS.BULK_MAX_ROWS),

    continueOnError: z.boolean().optional().default(false),
  })
  .strict();

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(2, VALIDATION.MIN_LENGTH('name', 2)).max(NAME.TITLE_MAX_LENGTH),
    scopes: z.array(z.string().trim().max(60)).max(50).optional().default([]),
    expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
  })
  .strict();

export const apiKeyIdParamSchema = z.object({ id });

export const localeParamSchema = z.object({ locale: z.string().trim().min(2).max(20) });

export const createTranslationSchema = z
  .object({
    locale: z.string().trim().min(2, VALIDATION.REQUIRED('locale')).max(20),
    key: z.string().trim().min(1, VALIDATION.REQUIRED('key')).max(200),
    value: z.string().trim().max(4000),
    namespace: z.string().trim().max(60).optional().default('common'),
  })
  .strict();

export const updateTranslationSchema = z
  .object({
    value: z.string().trim().max(4000),
    key: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const bulkUpsertTranslationsSchema = z
  .object({
    locale: z.string().trim().min(2, VALIDATION.REQUIRED('locale')).max(20),
    namespace: z.string().trim().max(60).optional().default('common'),
    entries: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(200),
            value: z.string().trim().max(4000),
          })
          .strict(),
      )
      .min(1, VALIDATION.REQUIRED('entries'))
      .max(1000),
  })
  .strict();

export const countryCodeParamSchema = z.object({
  countryCode: z.string().trim().min(2).max(4),
});

export const stateCodeParamSchema = z.object({ stateCode: z.string().trim().min(1).max(8) });

type Assert<T> = T;
export type ReportInput = Assert<z.infer<typeof reportSchema>>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type BulkProductsInput = z.infer<typeof bulkProductsSchema>;
export type CreatePageInput = z.infer<typeof createPageSchema>;
export type CreateBlogInput = z.infer<typeof createBlogSchema>;
export type CreateBannerInput = z.infer<typeof createBannerSchema>;
