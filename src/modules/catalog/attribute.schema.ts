import { z } from 'zod';
import { ATTRIBUTE_TYPE, COLLECTION_TYPE } from '../../constants/roles';
import { NAME } from '../../config/password.config';
import { VALIDATION } from '../../messages/validation';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;

const name = z
  .string()
  .trim()
  .min(2, VALIDATION.MIN_LENGTH('name', 2))
  .max(NAME.TITLE_MAX_LENGTH, VALIDATION.MAX_LENGTH('name', NAME.TITLE_MAX_LENGTH));

const slug = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
  .optional();

const image = z.string().trim().url(VALIDATION.INVALID_URL).max(500).optional().or(z.literal(''));

export const createAttributeSchema = z
  .object({
    name,
    slug,
    type: z.nativeEnum(ATTRIBUTE_TYPE).default(ATTRIBUTE_TYPE.TEXT),
    options: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    isVariant: z.boolean().optional().default(false),
    isFilterable: z.boolean().optional().default(true),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const VARIANT_TYPES: string[] = [ATTRIBUTE_TYPE.SIZE, ATTRIBUTE_TYPE.COLOR, ATTRIBUTE_TYPE.SELECT];

export const createAttributeBodySchema = createAttributeSchema.superRefine((v, ctx) => {
  if (v.isVariant === true && !VARIANT_TYPES.includes(String(v.type))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'A variant attribute must be of type SIZE, COLOR or SELECT.',
    });
  }
});

export type CreateAttributeInput = z.infer<typeof createAttributeBodySchema>;

export const updateAttributeSchema = createAttributeSchema
  .partial()
  .refine((v: Record<string, unknown>) => Object.keys(v).length > 0, {
    message: VALIDATION.INVALID_JSON,
  })
  .superRefine((v, ctx) => {
    if (v.isVariant === true && v.type !== undefined && !VARIANT_TYPES.includes(String(v.type))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'A variant attribute must be of type SIZE, COLOR or SELECT.',
      });
    }
  });

export const attributeIdParamSchema = z.object({ id });

export const listAttributesSchema = paginationSchema.extend({
  isVariant: common.flagQuery,
  isActive: common.flagQuery,
  search: z.string().trim().max(120).optional(),
});

const rulesSchema = z
  .object({
    vendorIds: z.array(id).optional(),
    categoryIds: z.array(id).optional(),
    brandIds: z.array(id).optional(),
    tagIds: z.array(id).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    inStockOnly: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    sortBy: z.enum(['createdAt', 'price', 'rating', 'soldCount', 'name']).optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const createCollectionSchema = z
  .object({
    name,
    slug,
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    image,
    type: z.nativeEnum(COLLECTION_TYPE).default(COLLECTION_TYPE.MANUAL),
    rules: rulesSchema.optional(),
    productIds: z.array(id).max(500).optional(),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const updateCollectionSchema = createCollectionSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const collectionIdParamSchema = z.object({ id });

export const collectionSlugParamSchema = z.object({ slug: common.cuidOrSlug });

export const listCollectionsSchema = paginationSchema.extend({
  isActive: common.flagQuery,
  type: z.nativeEnum(COLLECTION_TYPE).optional(),
  search: z.string().trim().max(120).optional(),
  withProducts: common.flagQuery,
});

export const collectionProductsSchema = paginationSchema.extend({
  sort: z.string().max(40).optional(),
});

export const setProductsSchema = z
  .object({
    productIds: z.array(id).min(1).max(500),
    replace: z.boolean().optional().default(true),
  })
  .strict();

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export { ATTRIBUTE_TYPE, COLLECTION_TYPE };
