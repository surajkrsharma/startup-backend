import { z } from 'zod';
import { PRODUCT_STATUS, ATTRIBUTE_TYPE } from '../../constants/roles';
import { NAME } from '../../config/password.config';
import { VALIDATION } from '../../messages/validation';
import { common, paginationSchema } from '../../middlewares/validate.middleware';

const id = common.cuid;
const idList = z.array(id).max(100).optional();

const price = z.coerce
  .number()
  .positive(VALIDATION.INVALID_PRICE)
  .max(10_000_000, VALIDATION.INVALID_NUMBER);

const variantInput = z
  .object({
    id: id.optional(),
    sku: z.string().trim().max(60).optional(),
    title: z.string().trim().max(120).optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    price: price.optional(),
    mrpPrice: price.optional(),
    stock: z.coerce.number().int().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('stock')).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const imageInput = z
  .object({
    url: z.string().trim().url(VALIDATION.INVALID_URL).max(500),
    publicId: z.string().trim().max(200).optional(),
    altText: z.string().trim().max(200).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const createProductSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, VALIDATION.MIN_LENGTH('name', 2))
      .max(NAME.TITLE_MAX_LENGTH, VALIDATION.MAX_LENGTH('name', NAME.TITLE_MAX_LENGTH)),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VALIDATION.INVALID_SLUG)
      .optional(),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    categoryId: id.optional(),
    brandId: id.optional(),
    tagIds: idList,
    sku: z.string().trim().max(60).optional(),
    price,
    mrpPrice: price.optional(),
    costPrice: z.coerce.number().min(0).optional(),
    taxPercent: z.coerce.number().min(0).max(100, VALIDATION.INVALID_PERCENT).optional(),
    stock: z.coerce.number().int().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('stock')).optional(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    weight: z.coerce.number().min(0).optional(),
    allowBackorder: z.boolean().optional(),
    status: z.nativeEnum(PRODUCT_STATUS).optional(),
    isFeatured: z.boolean().optional(),
    images: z.array(imageInput).max(20).optional(),
    variants: z.array(variantInput).max(100).optional(),
    attributes: z
      .array(z.object({ attributeId: id, value: z.string().trim().max(120) }).strict())
      .max(50)
      .optional(),
  })
  .strict();

export const updateProductSchema = createProductSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const productIdParamSchema = z.object({ id });

export const productSlugParamSchema = z.object({ slug: common.cuidOrSlug });

export const updateStockSchema = z
  .object({
    stock: z.coerce.number().int().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('stock')),
    variantId: id.optional(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const toggleStatusSchema = z.object({ status: z.nativeEnum(PRODUCT_STATUS) }).strict();

const bulkItemSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, VALIDATION.MIN_LENGTH('name', 2))
      .max(NAME.TITLE_MAX_LENGTH, VALIDATION.MAX_LENGTH('name', NAME.TITLE_MAX_LENGTH)),
    slug: z.string().trim().max(120).optional(),
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    categoryId: id.optional(),
    brandId: id.optional(),
    tagIds: idList,
    sku: z.string().trim().max(60).optional(),
    price: z.coerce.number(),
    mrpPrice: z.coerce.number().optional(),
    costPrice: z.coerce.number().optional(),
    taxPercent: z.coerce.number().min(0).max(100, VALIDATION.INVALID_PERCENT).optional(),
    stock: z.coerce.number().optional(),
    lowStockThreshold: z.coerce.number().int().optional(),
    weight: z.coerce.number().optional(),
    allowBackorder: z.boolean().optional(),
    status: z.nativeEnum(PRODUCT_STATUS).optional(),
    isFeatured: z.boolean().optional(),
    images: z.array(imageInput).max(20).optional(),
    variants: z.array(variantInput).max(100).optional(),
    attributes: z
      .array(z.object({ attributeId: id, value: z.string().trim().max(120) }).strict())
      .max(50)
      .optional(),
  })
  .strict();

export const bulkCreateSchema = z
  .object({
    products: z.array(bulkItemSchema).min(1).max(100),
    continueOnError: z.boolean().optional().default(true),
  })
  .strict();

export const bulkUpdateSchema = z
  .object({
    productIds: z.array(id).min(1).max(200),
    updates: z
      .object({
        status: z.nativeEnum(PRODUCT_STATUS).optional(),
        isFeatured: z.boolean().optional(),
        categoryId: id.nullable().optional(),
        brandId: id.nullable().optional(),
        taxPercent: z.coerce.number().min(0).max(100).optional(),
        lowStockThreshold: z.coerce.number().int().min(0).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON }),
  })
  .strict();

export const bulkDeleteSchema = z.object({ productIds: z.array(id).min(1).max(200) }).strict();

export const bulkPriceUpdateSchema = z
  .object({
    productIds: z.array(id).min(1).max(200),
    type: z.enum(['FIXED', 'PERCENT_UP', 'PERCENT_DOWN']),
    value: z.coerce.number().min(0, VALIDATION.NEGATIVE_NOT_ALLOWED('value')),
    roundTo: z.number().int().min(0).max(2).optional().default(2),
  })
  .strict();

export const listProductsSchema = paginationSchema.extend({
  categoryId: id.optional(),
  categorySlug: z.string().trim().max(140).optional(),
  brandId: id.optional(),
  vendorId: id.optional(),
  tagIds: common.csvArray,
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: common.flagQuery,
  isFeatured: common.flagQuery,
  status: z.nativeEnum(PRODUCT_STATUS).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  excludeProductId: id.optional(),
});

export const getFiltersSchema = z.object({
  categoryId: id.optional(),
  vendorId: id.optional(),
  brandId: id.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});

export const relatedParamsSchema = z.object({ id });

export const deleteImageParamsSchema = z.object({
  id,
  imageId: id,
});

export const uploadImagesParamsSchema = z.object({ id });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;

export { ATTRIBUTE_TYPE };
