import { Router } from 'express';
import { validate, paginationSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import { uploadRateLimit } from '../../middlewares/rateLimit.middleware';
import { uploadFiles, uploadSingle } from '../../middlewares/upload.middleware';
import { UPLOAD_KIND } from '../../config/upload.config';
import * as controller from './product.controller';
import * as schema from './product.schema';

const router = Router();

// ── Public / mixed ───────────────────────────────────────────────────────────

/**
 * @openapi
 * /products/getAll:
 *   get:
 *     tags: [Products]
 *     summary: List products
 *     description: >
 *       Public callers only see ACTIVE products from APPROVED shops.
 *       A logged-in VENDOR automatically sees their own drafts instead.
 *       Filters: `?search=`, `?categoryId=`, `?categorySlug=`, `?brandId=`,
 *       `?vendorId=`, `?tagIds=a,b`, `?minPrice=`, `?maxPrice=`, `?inStock=1`,
 *       `?isFeatured=1`, `?status=ACTIVE`, `?sort=-price`.
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20, maximum: 100 } }
 *       - { name: sort, in: query, schema: { type: string, example: -createdAt } }
 *     responses:
 *       200: { description: Paginated product list, pagination fields first }
 */
router.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listProductsSchema }),
  controller.getAll,
);

/**
 * @openapi
 * /products/getById/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Single product by id, with variants, images and recent reviews
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 */
router.get(
  '/getById/:id',
  optionalAuth,
  validate({ params: schema.productIdParamSchema }),
  controller.getById,
);

/**
 * @openapi
 * /products/getBySlug/{slug}:
 *   get:
 *     tags: [Products]
 *     summary: Single product by slug (SEO URL); increments the view counter
 *     parameters:
 *       - { name: slug, in: path, required: true, schema: { type: string } }
 */
router.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.productSlugParamSchema }),
  controller.getBySlug,
);

/** GET /products/getFilters — category/brand/vendor facets + price range + attribute values. */
router.get(
  '/getFilters',
  optionalAuth,
  validate({ query: schema.getFiltersSchema }),
  controller.getFilters,
);

/** GET /products/getRelated/:id */
router.get(
  '/getRelated/:id',
  optionalAuth,
  validate({ params: schema.relatedParamsSchema, query: paginationSchema }),
  controller.getRelated,
);

/** GET /products/getRecommended — personalised from the caller's view history. */
router.get(
  '/getRecommended',
  authenticate,
  validate({ query: paginationSchema }),
  controller.getRecommended,
);

/** GET /products/getFrequentlyBought/:id — co-purchase analysis over order history. */
router.get(
  '/getFrequentlyBought/:id',
  optionalAuth,
  validate({ params: schema.relatedParamsSchema, query: paginationSchema }),
  controller.getFrequentlyBought,
);

/** GET /products/getRecentlyViewed — the caller's own history. */
router.get(
  '/getRecentlyViewed',
  authenticate,
  validate({ query: paginationSchema }),
  controller.getRecentlyViewed,
);

/** POST /products/trackView/:id */
router.post(
  '/trackView/:id',
  optionalAuth,
  validate({ params: schema.relatedParamsSchema }),
  controller.trackView,
);

// ── Vendor: own catalog ──────────────────────────────────────────────────────

/**
 * @openapi
 * /products/createProduct:
 *   post:
 *     tags: [Products]
 *     summary: Create a product (vendor)
 *     description: >
 *       Requires an APPROVED vendor profile, else 403 VENDOR_NOT_APPROVED.
 *       `slug` is generated from `name` and auto-suffixed (`-2`, `-3`) on collision.
 *       Status defaults to ACTIVE when stock > 0, otherwise DRAFT.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/createProduct',
  authenticate,
  ...controller.guards.vendor,
  validate({ body: schema.createProductSchema }),
  controller.createProduct,
);

/** PATCH /products/updateProduct/:id — vendors may only edit their own products. */
router.patch(
  '/updateProduct/:id',
  authenticate,
  validate({ params: schema.productIdParamSchema, body: schema.updateProductSchema }),
  controller.updateProduct,
);

/**
 * @openapi
 * /products/deleteProduct/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Soft-delete a product
 *     description: >
 *       Sets `deletedAt` and status ARCHIVED so existing order lines keep resolving.
 *       Row is recoverable; nothing is physically removed.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/deleteProduct/:id',
  authenticate,
  validate({ params: schema.productIdParamSchema }),
  controller.deleteProduct,
);

/** PATCH /products/updateStock/:id — pass `variantId` to target a variant instead. */
router.patch(
  '/updateStock/:id',
  authenticate,
  validate({ params: schema.productIdParamSchema, body: schema.updateStockSchema }),
  controller.updateStock,
);

/** PATCH /products/toggleStatus/:id */
router.patch(
  '/toggleStatus/:id',
  authenticate,
  validate({ params: schema.productIdParamSchema, body: schema.toggleStatusSchema }),
  controller.toggleStatus,
);

/**
 * @openapi
 * /products/uploadImages/{id}:
 *   post:
 *     tags: [Products]
 *     summary: Upload product images (multipart/form-data)
 *     description: >
 *       Field `files`, up to `catalog.maxImagesPerProduct` in total, JPEG/PNG/WebP
 *       up to 5MB each. Exceeding the limit returns 400 IMAGE_LIMIT_EXCEEDED.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/uploadImages/:id',
  authenticate,
  uploadRateLimit,
  validate({ params: schema.uploadImagesParamsSchema }),
  uploadFiles(UPLOAD_KIND.IMAGE, 'files'),
  controller.uploadImages,
);

/** DELETE /products/deleteImage/:id/:imageId */
router.delete(
  '/deleteImage/:id/:imageId',
  authenticate,
  validate({ params: schema.deleteImageParamsSchema }),
  controller.deleteImage,
);

/** POST /products/bulkCreate — per-row errors are reported, not thrown (unless continueOnError=false). */
router.post(
  '/bulkCreate',
  authenticate,
  ...controller.guards.vendor,
  validate({ body: schema.bulkCreateSchema }),
  controller.bulkCreate,
);

/** PATCH /products/bulkUpdate */
router.patch(
  '/bulkUpdate',
  authenticate,
  validate({ body: schema.bulkUpdateSchema }),
  controller.bulkUpdate,
);

/** PATCH /products/bulkDelete — soft delete. */
router.patch(
  '/bulkDelete',
  authenticate,
  validate({ body: schema.bulkDeleteSchema }),
  controller.bulkDelete,
);

/**
 * @openapi
 * /products/bulkPriceUpdate:
 *   post:
 *     tags: [Products]
 *     summary: Adjust prices across many products
 *     description: >
 *       `type` is FIXED | PERCENT_UP | PERCENT_DOWN. The result is never
 *       rounded below 0.01. Returns per-product previous and new price.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/bulkPriceUpdate',
  authenticate,
  validate({ body: schema.bulkPriceUpdateSchema }),
  controller.bulkPriceUpdate,
);

/** POST /products/bulkImportCsv — multipart upload; per-row errors are reported, not thrown. */
router.post(
  '/bulkImportCsv',
  authenticate,
  uploadRateLimit,
  ...controller.guards.vendor,
  uploadSingle(UPLOAD_KIND.CSV, 'file'),
  controller.bulkImportCsv,
);

/** GET /products/exportCsv */
router.get(
  '/exportCsv',
  authenticate,
  validate({ query: schema.listProductsSchema }),
  controller.exportCsv,
);

export default router;
