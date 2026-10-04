import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './category.controller';
import * as schema from './category.schema';

const router = Router();

/**
 * @openapi
 * /categories/getAll:
 *   get:
 *     tags: [Categories]
 *     summary: List categories
 *     description: >
 *       Supports `?tree=1` for the full parent/child tree (no pagination numbers
 *       are returned in that case), `?rootsOnly=1`, `?parentId=`, `?search=`,
 *       `?withCounts=0`, `?page=`, `?limit=`.
 *     responses:
 *       200: { description: Paginated list, or a nested categoryList when tree=1 }
 */
router.get('/getAll', validate({ query: schema.listCategoriesSchema }), controller.getAll);

/**
 * @openapi
 * /categories/getById/{id}:
 *   get:
 *     tags: [Categories]
 *     summary: Single category with its immediate children and product count
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 */
router.get('/getById/:id', validate({ params: schema.categoryIdParamSchema }), controller.getById);

router.get(
  '/getBySlug/:slug',
  validate({ params: schema.categorySlugParamSchema }),
  controller.getBySlug,
);

/**
 * @openapi
 * /categories/createCategory:
 *   post:
 *     tags: [Categories]
 *     summary: Create a category (admin)
 *     description: >
 *       `slug` is generated from `name` and auto-suffixed on collision.
 *       `sortOrder` defaults to one past the highest sibling.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/createCategory',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createCategorySchema }),
  controller.createCategory,
);

router.patch(
  '/updateCategory/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.categoryIdParamSchema, body: schema.updateCategorySchema }),
  controller.updateCategory,
);

/**
 * @openapi
 * /categories/deleteCategory/{id}:
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category (admin)
 *     description: >
 *       Returns 409 when the category still has child categories or live products.
 *       On success the row is soft deleted (deletedAt set, isActive false).
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/deleteCategory/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.categoryIdParamSchema }),
  controller.deleteCategory,
);

/**
 * @openapi
 * /categories/reorder:
 *   post:
 *     tags: [Categories]
 *     summary: Reorder categories by drag-and-drop (admin)
 *     description: >
 *       Send `categoryIds` in the intended order. Omit `parentId` (or pass null)
 *       to reorder the top level.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/reorder',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.reorderSchema }),
  controller.reorder,
);

router.post(
  '/bulkCreate',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkCreateSchema }),
  controller.bulkCreate,
);

export default router;
