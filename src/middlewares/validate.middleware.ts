import type { RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';
import { VALIDATION } from '../messages/validation';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
}

export type Source = keyof ValidateSchemas;

/**
 * Zod validation for body / query / params / headers.
 *
 * Validated output replaces the raw value, so handlers always receive coerced,
 * stripped data. Unknown keys are rejected because schemas use `.strict()`.
 */
export const validate = (schemas: ValidateSchemas): RequestHandler => {
  const handler: RequestHandler = (req, res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      if (schemas.query) {
        // req.query has only a getter on Express 5-style objects; assign defensively.
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.headers) {
        const parsed = schemas.headers.parse(req.headers) as Record<string, unknown>;
        Object.defineProperty(req, 'validatedHeaders', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * The schemas hang off the handler so the OpenAPI generator can read them back off
   * the Express router stack. Without this the spec has to restate every field by
   * hand in an `@openapi` comment, which is exactly how it drifts out of date.
   */
  (handler as any).validatedSchemas = schemas;

  return handler;
};

export const validateBody = (schema: ZodTypeAny): RequestHandler => validate({ body: schema });
export const validateQuery = (schema: ZodTypeAny): RequestHandler => validate({ query: schema });
export const validateParams = (schema: ZodTypeAny): RequestHandler => validate({ params: schema });

/** Shared building blocks so schemas stay short and consistent. */
export const common = {
  id: z.string().min(1, VALIDATION.REQUIRED('id')),
  cuid: z.string().min(1).max(40),
  cuidOrSlug: z.string().min(1).max(140),
  /** `1` / `"1"` -> 1 */
  numericString: z.coerce.number().int(),
  positiveInt: z.coerce.number().int().positive(),
  nonNegativeInt: z.coerce.number().int().min(0),
  booleanish: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((v) => v === true || v === 'true' || v === '1'),
  /**
   * Optional boolean flag for filters. Absent means "no filter", so it resolves
   * to `undefined` rather than `true` — defaulting to true would silently apply
   * a filter the caller never asked for.
   */
  flagQuery: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return undefined;
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
    }),
  /** Same as flagQuery but always a boolean (use where the default is meaningful). */
  flagQueryDefaultTrue: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return true;
      if (typeof v === 'boolean') return v;
      return ['true', '1'].includes(v.toLowerCase());
    }),
  csvArray: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return [];
      const arr = Array.isArray(v) ? v : String(v).split(',');
      return arr.map((s) => s.trim()).filter(Boolean);
    }),
  jsonArray: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return [];
      const arr = Array.isArray(v) ? v : String(v).split(',');
      return arr.map((s) => s.trim()).filter(Boolean);
    }),
  dateString: z.coerce.date(),
  isoDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
};

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().max(40).optional(),
  search: z.string().trim().max(120).optional(),
  fields: z.string().max(300).optional(),
});

export const idParamSchema = z.object({ id: common.cuid });

export const slugParamSchema = z.object({ slug: common.cuidOrSlug });
