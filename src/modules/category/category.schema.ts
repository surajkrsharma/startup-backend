import { z } from 'zod';
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

/** POST /categories/createCategory */
export const createCategorySchema = z
  .object({
    name,
    slug,
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    image,
    icon: image,
    parentId: id.optional().or(z.literal('')),
    isActive: z.boolean().optional().default(true),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .strict();

/** PATCH /categories/updateCategory/:id */
export const updateCategorySchema = createCategorySchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const categoryIdParamSchema = z.object({ id });

export const categorySlugParamSchema = z.object({ slug: common.cuidOrSlug });

/** GET /categories/getAll */
export const listCategoriesSchema = paginationSchema.extend({
  parentId: id.optional(),
  /** Only return top-level rows when true. */
  rootsOnly: common.flagQuery,
  isActive: common.flagQuery,
  /** Return the full parent/child tree instead of one level. */
  tree: common.flagQuery,
  withCounts: common.flagQueryDefaultTrue,
  search: z.string().trim().max(120).optional(),
});

/** POST /categories/reorder — receives the ids in their intended order. */
export const reorderSchema = z
  .object({
    categoryIds: z.array(id).min(1).max(500),
    parentId: id.optional().or(z.literal('')),
  })
  .strict();

/**
 * Loose row shape for bulk create. The minimum-length rule on `name` is enforced
 * per row inside the service, so one short name is skipped and reported instead
 * of failing every row in the batch.
 */
export const bulkCreateSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            name: z.string().trim().min(1, VALIDATION.REQUIRED('name')),
            slug,
            description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
            parentId: id.optional(),
            isActive: z.boolean().optional(),
            sortOrder: z.coerce.number().int().min(0).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    continueOnError: z.boolean().optional().default(true),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
