import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './catalog.controller';
import * as schema from './catalog.schema';
import * as attributeSchema from './attribute.schema';

const router = Router();

router.get('/brands/getAll', validate({ query: schema.listBrandsSchema }), controller.listBrands);

router.get(
  '/brands/getById/:id',
  validate({ params: schema.brandIdParamSchema }),
  controller.getBrandById,
);

router.get(
  '/brands/getBySlug/:slug',
  validate({ params: schema.brandSlugParamSchema }),
  controller.getBrandBySlug,
);

/**
 * @openapi
 * /brands/createBrand:
 *   post:
 *     tags: [Brands]
 *     summary: Create a brand (admin)
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/brands/createBrand',
  authenticate,
  ...controller.guards.brand,
  validate({ body: schema.createBrandSchema }),
  controller.createBrand,
);

router.patch(
  '/brands/updateBrand/:id',
  authenticate,
  ...controller.guards.brand,
  validate({ params: schema.brandIdParamSchema, body: schema.updateBrandSchema }),
  controller.updateBrand,
);

/**
 * @openapi
 * /brands/deleteBrand/{id}:
 *   delete:
 *     tags: [Brands]
 *     summary: Delete a brand (admin)
 *     description: Returns 409 BRAND_IN_USE while any product still references it.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/brands/deleteBrand/:id',
  authenticate,
  ...controller.guards.brand,
  validate({ params: schema.brandIdParamSchema }),
  controller.deleteBrand,
);

router.get('/tags/getAll', validate({ query: schema.listTagsSchema }), controller.listTags);

router.post(
  '/tags/createTag',
  authenticate,
  ...controller.guards.tag,
  validate({ body: schema.createTagSchema }),
  controller.createTag,
);

router.post(
  '/tags/bulkCreate',
  authenticate,
  ...controller.guards.tag,
  validate({ body: schema.bulkCreateTagsSchema }),
  controller.bulkCreateTags,
);

router.delete(
  '/tags/deleteTag/:id',
  authenticate,
  ...controller.guards.tag,
  validate({ params: schema.tagIdParamSchema }),
  controller.deleteTag,
);

router.get(
  '/attributes/getAll',
  validate({ query: attributeSchema.listAttributesSchema }),
  controller.listAttributes,
);

router.get(
  '/attributes/getById/:id',
  validate({ params: attributeSchema.attributeIdParamSchema }),
  controller.getAttributeById,
);

/**
 * @openapi
 * /attributes/createAttribute:
 *   post:
 *     tags: [Attributes]
 *     summary: Create an attribute (admin)
 *     description: >
 *       `type` is one of TEXT | NUMBER | BOOLEAN | SELECT | MULTI_SELECT | COLOR | SIZE.
 *       `isVariant: true` requires type SIZE, COLOR or SELECT, else 400.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/attributes/createAttribute',
  authenticate,
  ...controller.guards.attribute,
  validate({ body: attributeSchema.createAttributeBodySchema }),
  controller.createAttribute,
);

router.patch(
  '/attributes/updateAttribute/:id',
  authenticate,
  ...controller.guards.attribute,
  validate({
    params: attributeSchema.attributeIdParamSchema,
    body: attributeSchema.updateAttributeSchema,
  }),
  controller.updateAttribute,
);

router.delete(
  '/attributes/deleteAttribute/:id',
  authenticate,
  ...controller.guards.attribute,
  validate({ params: attributeSchema.attributeIdParamSchema }),
  controller.deleteAttribute,
);

/**
 * @openapi
 * /collections/getAll:
 *   get:
 *     tags: [Collections]
 *     summary: List collections
 *     description: Supports `?withProducts=1` to embed the product list per collection.
 */
router.get(
  '/collections/getAll',
  validate({ query: attributeSchema.listCollectionsSchema }),
  controller.listCollections,
);

router.get(
  '/collections/getById/:id',
  validate({ params: attributeSchema.collectionIdParamSchema }),
  controller.getCollectionById,
);

router.get(
  '/collections/getBySlug/:slug',
  validate({ params: attributeSchema.collectionSlugParamSchema }),
  controller.getCollectionBySlug,
);

router.get(
  '/collections/getProducts/:id',
  validate({
    params: attributeSchema.collectionIdParamSchema,
    query: attributeSchema.collectionProductsSchema,
  }),
  controller.getProducts,
);

/**
 * @openapi
 * /collections/createCollection:
 *   post:
 *     tags: [Collections]
 *     summary: Create a collection (admin)
 *     description: >
 *       MANUAL needs at least one `productIds` entry; DYNAMIC needs at least one
 *       rule. Rules support vendorIds, categoryIds, brandIds, tagIds, price range,
 *       minRating, inStockOnly, isFeatured, sortBy, sortDirection and limit.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/collections/createCollection',
  authenticate,
  ...controller.guards.collection,
  validate({ body: attributeSchema.createCollectionSchema }),
  controller.createCollection,
);

router.patch(
  '/collections/updateCollection/:id',
  authenticate,
  ...controller.guards.collection,
  validate({
    params: attributeSchema.collectionIdParamSchema,
    body: attributeSchema.updateCollectionSchema,
  }),
  controller.updateCollection,
);

router.delete(
  '/collections/deleteCollection/:id',
  authenticate,
  ...controller.guards.collection,
  validate({ params: attributeSchema.collectionIdParamSchema }),
  controller.deleteCollection,
);

router.post(
  '/collections/setProducts/:id',
  authenticate,
  ...controller.guards.collection,
  validate({
    params: attributeSchema.collectionIdParamSchema,
    body: attributeSchema.setProductsSchema,
  }),
  controller.setProducts,
);

export default router;
