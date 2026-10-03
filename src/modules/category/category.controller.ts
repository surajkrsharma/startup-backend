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
import * as service from './category.service';
import {
  serializeCategory,
  serializeCategoryList,
  serializeCategoryTree,
  serializeBulkResult,
} from './category.serializer';

export const guards = {
  admin: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.CATEGORY_MANAGE),
  ],
};

// ══ Public ═══════════════════════════════════════════════════════════════════

/** GET /categories/getAll */
export const getAll = asyncHandler(async (req, res) => {
  const { rows, total, tree } = await service.listCategories(req.query);
  const { page, limit } = getPagination(req.query);

  // The tree response carries no pagination numbers: there are no pages.
  if (tree) {
    return ApiResponse.success(res, {
      message: SUCCESS.CATEGORY.FETCHED,
      result: serializeCategoryTree(rows),
    });
  }

  return ApiResponse.paginated(res, {
    message: SUCCESS.CATEGORY.FETCHED,
    result: {
      filterData: {
        search: D.str(req.query?.search as string),
        parentId: D.str(req.query?.parentId as string),
        isActive: D.bool(req.query?.isActive === 'true'),
      },
      ...serializeCategoryList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/** GET /categories/getById/:id */
export const getById = asyncHandler(async (req, res) => {
  const category = await service.getCategoryById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeCategory(category),
  });
});

// ══ Admin ════════════════════════════════════════════════════════════════════

/** POST /categories/createCategory */
export const createCategory = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body, req);
  return ApiResponse.created(res, SUCCESS.CATEGORY.CREATED, serializeCategory(category));
});

/** PATCH /categories/updateCategory/:id */
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.updateCategory(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.CATEGORY.UPDATED,
    result: serializeCategory(category),
  });
});

/** DELETE /categories/deleteCategory/:id — soft delete, refused when in use. */
export const deleteCategory = asyncHandler(async (req, res) => {
  const result = await service.deleteCategory(req.params.id, req);
  return ApiResponse.success(res, {
    message: SUCCESS.CATEGORY.DELETED,
    result: {
      categoryId: result.id,
      name: result.name,
      isDeleted: true,
      isSoftDelete: true,
    },
  });
});

/** POST /categories/reorder — ids in the desired order. */
export const reorder = asyncHandler(async (req, res) => {
  const count = await service.reorderCategories(
    req.body.categoryIds,
    D.str(req.body.parentId),
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.CATEGORY.REORDERED,
    result: { reorderedCount: count, parentId: D.str(req.body.parentId) },
  });
});

/** POST /categories/bulkCreate — per-row errors are reported, not thrown. */
export const bulkCreate = asyncHandler(async (req, res) => {
  const result = await service.bulkCreate(req.body, req);
  return ApiResponse.created(res, SUCCESS.CATEGORY.CREATED, serializeBulkResult(result));
});
