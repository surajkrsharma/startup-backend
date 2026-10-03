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

/** POST /brands/createBrand */
export const createBrandSchema = z
  .object({
    name,
    slug,
    description: z.string().trim().max(NAME.COMMENT_MAX_LENGTH).optional(),
    logo: image,
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const updateBrandSchema = createBrandSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: VALIDATION.INVALID_JSON });

export const brandIdParamSchema = z.object({ id });

/** GET /brands/getAll */
export const listBrandsSchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  isActive: common.flagQuery,
  withCounts: common.flagQueryDefaultTrue,
});

export const brandSlugParamSchema = z.object({ slug: common.cuidOrSlug });

// ─── Tag ─────────────────────────────────────────────────────────────────────

export const createTagSchema = z
  .object({
    name,
    slug,
  })
  .strict()
  .transform((v) => ({ name: v.name, slug: v.slug }));

export const updateTagSchema = createTagSchema.refine((v) => Object.keys(v).length > 0, {
  message: VALIDATION.INVALID_JSON,
});

export const tagIdParamSchema = z.object({ id });

export const listTagsSchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  withCounts: common.flagQueryDefaultTrue,
});

export const bulkCreateTagsSchema = z
  .object({
    tags: z
      .array(z.object({ name, slug: slug.optional() }).strict())
      .min(1)
      .max(100),
    continueOnError: z.boolean().optional().default(true),
  })
  .strict();

export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
