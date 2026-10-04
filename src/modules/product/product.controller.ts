import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole, optionalAuth } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSION } from '../../constants/permissions';
import { getUploadedFiles } from '../../middlewares/upload.middleware';
import { AppError } from '../../utils/AppError';
import { ERROR } from '../../messages/error';
import * as service from './product.service';
import {
  serializeProduct,
  serializeProductList,
  serializeProductWriteResult,
  serializeStockResult,
  serializeBulkResult,
  serializeBulkPriceResult,
  serializeProductFacets,
  serializeRecentlyViewed,
  serializeFrequentlyBought,
  serializeImageResult,
} from './product.serializer';

const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  vendor: [requireRole('VENDOR')],
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  adminCatalog: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.PRODUCT_VIEW_ALL),
  ],
  adminUpdate: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.PRODUCT_UPDATE),
  ],
};

// ── Vendor: own catalog ──────────────────────────────────────────────────────

/** POST /products/createProduct */
export const createProduct = asyncHandler(async (req, res) => {
  const product = await service.createProduct(vendorId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PRODUCT.CREATED, serializeProductWriteResult(product));
});

/** PATCH /products/updateProduct/:id */
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await service.updateProduct(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.UPDATED,
    result: serializeProductWriteResult(product),
  });
});

/**
 * @openapi
 * /products/deleteProduct/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Soft delete a product and archive it
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     responses:
 *       200: { description: Deleted }
 *       401: { description: Not signed in }
 *       403: { description: Not the owning vendor, or not admin }
 *       404: { description: No such product }
 */
export const deleteProduct = asyncHandler(async (req, res) => {
  await service.deleteProduct(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.DELETED,
    result: {
      productId: req.params.id,
      isDeleted: true,
      isSoftDelete: true,
      status: 'ARCHIVED',
    },
  });
});

/** PATCH /products/updateStock/:id */
export const updateStock = asyncHandler(async (req, res) => {
  const result = await service.updateStock(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.STOCK_UPDATED,
    result: serializeStockResult(result),
  });
});

/** PATCH /products/toggleStatus/:id */
export const toggleStatus = asyncHandler(async (req, res) => {
  const product = await service.toggleStatus(req.params.id, req.body.status, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.STATUS_UPDATED,
    result: {
      productId: D.str(product.id),
      status: D.str(product.status),
      isActive: D.str(product.status) === 'ACTIVE',
    },
  });
});

/**
 * @openapi
 * /products/uploadImages/{id}:
 *   post:
 *     tags: [Products]
 *     summary: Attach images to a product
 *     description: Send `multipart/form-data` with one or more entries under the field `files`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files: { type: array, items: { type: string, format: binary }, description: One or more image files }
 *     responses:
 *       201: { description: Images attached }
 *       400: { description: No file sent, or the type is not an image }
 *       401: { description: Not signed in }
 *       403: { description: Not the owning vendor }
 *       404: { description: No such product }
 */
export const uploadImages = asyncHandler(async (req, res) => {
  const files = getUploadedFiles(req);
  const result = await service.uploadImages(req.params.id, files, req);
  return ApiResponse.created(res, SUCCESS.PRODUCT.IMAGES_UPLOADED, serializeImageResult(result));
});

/** DELETE /products/deleteImage/:id/:imageId */
export const deleteImage = asyncHandler(async (req, res) => {
  await service.deleteImage(req.params.id, req.params.imageId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.IMAGE_DELETED,
    result: { productId: req.params.id, imageId: req.params.imageId, isDeleted: true },
  });
});

/** POST /products/bulkCreate */
export const bulkCreate = asyncHandler(async (req, res) => {
  const result = await service.bulkCreate(vendorId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PRODUCT.BULK_CREATED, {
    ...serializeBulkResult(result),
    productList: result.products.map((p: any) => ({
      productId: D.str(p?.id),
      name: D.str(p?.name),
      slug: D.str(p?.slug),
      price: D.float(p?.price),
      stock: D.num(p?.stock),
      status: D.str(p?.status),
    })),
  });
});

/** PATCH /products/bulkUpdate */
export const bulkUpdate = asyncHandler(async (req, res) => {
  const result = await service.bulkUpdate(req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.BULK_UPDATED,
    result: {
      ...serializeBulkResult(result),
      productList: result.updated.map((p: any) => ({
        productId: D.str(p?.id),
        name: D.str(p?.name),
        status: D.str(p?.status),
        isFeatured: D.bool(p?.isFeatured),
      })),
    },
  });
});

/** PATCH /products/bulkDelete */
export const bulkDelete = asyncHandler(async (req, res) => {
  const result = await service.bulkDelete(req.body.productIds, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.BULK_DELETED,
    result: serializeBulkResult(result),
  });
});

/** POST /products/bulkPriceUpdate */
export const bulkPriceUpdate = asyncHandler(async (req, res) => {
  const result = await service.bulkPriceUpdate(req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.BULK_PRICE_UPDATED,
    result: serializeBulkPriceResult({ ...result, type: req.body.type, value: req.body.value }),
  });
});

/** POST /products/bulkImportCsv — the uploaded sheet is streamed, not buffered. */
export const bulkImportCsv = asyncHandler(async (req, res) => {
  const file = getUploadedFiles(req)[0];

  if (!file) throw AppError.badRequest(ERROR.UPLOAD.FILE_REQUIRED);

  const result = await service.importCsv(
    vendorId(req),
    file.path,
    { continueOnError: req.body.continueOnError !== 'false' },
    req.auth!.userId,
    req,
  );

  return ApiResponse.created(res, SUCCESS.PRODUCT.IMPORTED, result);
});

/** GET /products/exportCsv — streams CSV rather than a JSON envelope. */
export const exportCsv = asyncHandler(async (req, res) => {
  const isVendor = req.auth!.role === ROLES.VENDOR;

  const { fileName, csv, totalRecord } = await service.exportCsv(
    req.query as any,
    isVendor ? vendorId(req) : undefined,
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('X-Total-Record', String(totalRecord));

  return res.status(200).send(csv);
});

// ── Public listing ───────────────────────────────────────────────────────────

/**
 * GET /products/getAll
 * Vendors automatically see their own drafts; everyone else sees ACTIVE only,
 * and only from approved shops.
 */
export const getAll = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.listProducts(req.query, req);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.PRODUCT.FETCHED,
    result: {
      filterData: {
        search: D.str(filters.search),
        categoryId: D.str(filters.categoryId),
        brandId: D.str(filters.brandId),
        vendorId: D.str(filters.vendorId),
        minPrice: filters.minPrice ?? 0,
        maxPrice: filters.maxPrice ?? 0,
        inStock: D.bool(filters.inStock),
        isFeatured: D.bool(filters.isFeatured),
      },
      ...serializeProductList(rows),
    },
    totalRecord: total,
    currentPage: filters.page || page,
    limit,
  });
});

/**
 * @openapi
 * /products/getById/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Full product detail
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     responses:
 *       200: { description: Product found }
 *       401: { description: Not signed in }
 *       404: { description: No such product }
 */
export const getById = asyncHandler(async (req, res) => {
  const product = await service.getProductById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.RETRIEVED,
    result: serializeProduct(product),
  });
});

/**
 * @openapi
 * /products/getBySlug/{slug}:
 *   get:
 *     tags: [Products]
 *     summary: Full product detail by slug, and it counts a view
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: slug, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 140 }, example: classic-cotton-shirt }
 *     responses:
 *       200: { description: Product found }
 *       401: { description: Not signed in }
 *       404: { description: No such slug }
 */
export const getBySlug = asyncHandler(async (req, res) => {
  const product = await service.getProductBySlug(req.params.slug);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.RETRIEVED,
    result: serializeProduct(product),
  });
});

/** GET /products/getFilters — facets for the catalog sidebar. */
export const getFilters = asyncHandler(async (req, res) => {
  const facets = await service.getFilters(req.query);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.FILTERS_FETCHED,
    result: serializeProductFacets(facets),
  });
});

/** GET /products/getRelated/:id */
export const getRelated = asyncHandler(async (req, res) => {
  const { limit } = getPagination(req.query);
  const rows = await service.getRelated(req.params.id, limit);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.RELATED_FETCHED,
    result: { productList: rows.map(serializeProduct) as any[] },
  });
});

/** GET /products/getRecommended — personalised for a logged-in customer. */
export const getRecommended = asyncHandler(async (req, res) => {
  const rows = await service.getRecommended(req.query, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.RECOMMENDED_FETCHED,
    result: { productList: rows.map(serializeProduct) as any[] },
  });
});

/** GET /products/getFrequentlyBought/:id */
export const getFrequentlyBought = asyncHandler(async (req, res) => {
  const { limit } = getPagination(req.query);
  const rows = await service.getFrequentlyBought(req.params.id, limit);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.FREQUENTLY_BOUGHT_FETCHED,
    result: serializeFrequentlyBought(rows),
  });
});

/** GET /products/getRecentlyViewed */
export const getRecentlyViewed = asyncHandler(async (req, res) => {
  const rows = await service.getRecentlyViewed(req.query, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.RECENTLY_VIEWED_FETCHED,
    result: serializeRecentlyViewed(rows),
  });
});

/** POST /products/trackView/:id */
export const trackView = asyncHandler(async (req, res) => {
  const result = await service.trackView(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PRODUCT.VIEW_TRACKED,
    result,
  });
});

export { optionalAuth };
