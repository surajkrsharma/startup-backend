import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSION } from '../../constants/permissions';
import * as service from './catalog.service';
import * as schema from './attribute.schema';
import * as brandSchema from './catalog.schema';
import {
  serializeBrand,
  serializeBrandList,
  serializeTag,
  serializeTagList,
  serializeAttribute,
  serializeAttributeList,
  serializeCollection,
  serializeCollectionList,
  serializeBulkResult,
} from './catalog.serializer';

export const guards = {
  brand: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.BRAND_MANAGE),
  ],
  tag: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN), requirePermission(PERMISSION.TAG_MANAGE)],
  attribute: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.ATTRIBUTE_MANAGE),
  ],
  collection: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.COLLECTION_MANAGE),
  ],
};

const q = (req: Request, key: string): string => D.str((req.query as any)?.[key] as string);

// ══ Brand ════════════════════════════════════════════════════════════════════

export const listBrands = asyncHandler(async (req, res) => {
  const { rows, total } = await service.listBrands(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.BRAND.FETCHED,
    result: {
      filterData: { search: q(req, 'search'), isActive: D.bool(req.query?.isActive === 'true') },
      ...serializeBrandList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getBrandById = asyncHandler(async (req, res) => {
  const brand = await service.getBrandById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeBrand(brand),
  });
});

export const getBrandBySlug = asyncHandler(async (req, res) => {
  const brand = await service.getBrandBySlug(req.params.slug);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeBrand(brand),
  });
});

export const createBrand = asyncHandler(async (req, res) => {
  const brand = await service.createBrand(req.body, req);
  return ApiResponse.created(res, SUCCESS.BRAND.CREATED, serializeBrand(brand));
});

export const updateBrand = asyncHandler(async (req, res) => {
  const brand = await service.updateBrand(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.BRAND.UPDATED,
    result: serializeBrand(brand),
  });
});

export const deleteBrand = asyncHandler(async (req, res) => {
  const result = await service.deleteBrand(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.BRAND.DELETED,
    result: { brandId: result.id, name: result.name, isDeleted: true, isSoftDelete: true },
  });
});

// ══ Tag ══════════════════════════════════════════════════════════════════════

export const listTags = asyncHandler(async (req, res) => {
  const { rows, total } = await service.listTags(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.TAG.FETCHED,
    result: {
      filterData: { search: q(req, 'search') },
      ...serializeTagList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const createTag = asyncHandler(async (req, res) => {
  const tag = await service.createTag(req.body, req);
  return ApiResponse.created(res, SUCCESS.TAG.CREATED, serializeTag(tag));
});

export const bulkCreateTags = asyncHandler(async (req, res) => {
  const result = await service.bulkCreateTags(req.body);
  return ApiResponse.created(res, SUCCESS.TAG.CREATED, serializeBulkResult(result));
});

export const deleteTag = asyncHandler(async (req, res) => {
  const result = await service.deleteTag(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.TAG.DELETED,
    result: { tagId: result.id, name: result.name, isDeleted: true, isSoftDelete: true },
  });
});

// ══ Attribute ════════════════════════════════════════════════════════════════

export const listAttributes = asyncHandler(async (req, res) => {
  const { rows, total } = await service.listAttributes(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.ATTRIBUTE.FETCHED,
    result: {
      filterData: { isVariant: D.bool(req.query?.isVariant === 'true'), search: q(req, 'search') },
      ...serializeAttributeList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getAttributeById = asyncHandler(async (req, res) => {
  const attribute = await service.getAttributeById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeAttribute(attribute),
  });
});

export const createAttribute = asyncHandler(async (req, res) => {
  const attribute = await service.createAttribute(req.body, req);
  return ApiResponse.created(res, SUCCESS.ATTRIBUTE.CREATED, serializeAttribute(attribute));
});

export const updateAttribute = asyncHandler(async (req, res) => {
  const attribute = await service.updateAttribute(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ATTRIBUTE.UPDATED,
    result: serializeAttribute(attribute),
  });
});

export const deleteAttribute = asyncHandler(async (req, res) => {
  const result = await service.deleteAttribute(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.ATTRIBUTE.DELETED,
    result: {
      attributeId: result.id,
      name: result.name,
      isDeleted: true,
      isSoftDelete: true,
    },
  });
});

// ══ Collection ════════════════════════════════════════════════════════════════

export const listCollections = asyncHandler(async (req, res) => {
  const { rows, total } = await service.listCollections(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.COLLECTION.FETCHED,
    result: {
      filterData: { type: q(req, 'type'), search: q(req, 'search') },
      ...serializeCollectionList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getCollectionById = asyncHandler(async (req, res) => {
  const collection = await service.getCollectionById(
    req.params.id,
    req.query?.withProducts === 'true',
  );
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeCollection(collection),
  });
});

export const getCollectionBySlug = asyncHandler(async (req, res) => {
  const collection = await service.getCollectionBySlug(
    req.params.slug,
    req.query?.withProducts !== 'false',
  );
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeCollection(collection),
  });
});

export const createCollection = asyncHandler(async (req, res) => {
  const collection = await service.createCollection(req.body, req);
  return ApiResponse.created(res, SUCCESS.COLLECTION.CREATED, serializeCollection(collection));
});

export const updateCollection = asyncHandler(async (req, res) => {
  const collection = await service.updateCollection(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.COLLECTION.UPDATED,
    result: serializeCollection(collection),
  });
});

export const deleteCollection = asyncHandler(async (req, res) => {
  const result = await service.deleteCollection(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.COLLECTION.DELETED,
    result: {
      collectionId: result.id,
      name: result.name,
      isDeleted: true,
      isSoftDelete: true,
    },
  });
});

export const setProducts = asyncHandler(async (req, res) => {
  const result = await service.setCollectionProducts(
    req.params.id,
    req.body.productIds,
    req.body.replace !== false,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.COLLECTION.UPDATED,
    result,
  });
});

export const getProducts = asyncHandler(async (req, res) => {
  const { rows, total } = await service.getCollectionProducts(req.params.id, req.query);
  const { page, limit } = getPagination(req.query);

  const collection = await service.getCollectionById(req.params.id, false);

  return ApiResponse.paginated(res, {
    message: SUCCESS.PRODUCT.FETCHED,
    result: {
      collectionData: {
        collectionId: collection.id,
        name: collection.name,
        slug: collection.slug,
        type: collection.type,
        rules: D.obj(collection.rules),
      },
      productList: serializeCollection({
        id: collection.id,
        products: rows,
      }).productList,
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export { brandSchema, schema };
