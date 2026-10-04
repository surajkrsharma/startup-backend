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

export const getAll = asyncHandler(async (req, res) => {
  const { rows, total, tree } = await service.listCategories(req.query);
  const { page, limit } = getPagination(req.query);

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

/**
 * @openapi
 * /categories/getById/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Single category with its immediate children and product count
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     responses:
 *       200: { description: Category found }
 *       401: { description: Not signed in }
 *       404: { description: No such category }
 */
export const getById = asyncHandler(async (req, res) => {
  const category = await service.getCategoryById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeCategory(category),
  });
});

export const getBySlug = asyncHandler(async (req, res) => {
  const category = await service.getCategoryBySlug(req.params.slug);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeCategory(category),
  });
});

export const createCategory = asyncHandler(async (req, res) => {
  const category = await service.createCategory(req.body, req);
  return ApiResponse.created(res, SUCCESS.CATEGORY.CREATED, serializeCategory(category));
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await service.updateCategory(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.CATEGORY.UPDATED,
    result: serializeCategory(category),
  });
});

/**
 * @openapi
 * /categories/deleteCategory/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Soft delete a category, refused while products still reference it
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     responses:
 *       200: { description: Deleted, and whether it was a soft delete }
 *       401: { description: Not signed in }
 *       403: { description: Admin only }
 *       404: { description: No such category }
 *       409: { description: Products still reference this category }
 */
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

export const bulkCreate = asyncHandler(async (req, res) => {
  const result = await service.bulkCreate(req.body, req);
  return ApiResponse.created(res, SUCCESS.CATEGORY.CREATED, serializeBulkResult(result));
});
