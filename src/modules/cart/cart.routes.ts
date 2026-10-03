import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/auth.middleware';
import { ROLES } from '../../constants/roles';
import * as controller from './cart.controller';
import * as schema from './cart.schema';

const customerOnly = requireRole(ROLES.CUSTOMER);

// ── Cart ─────────────────────────────────────────────────────────────────────

const cart = Router();

/** GET /cart/getCart */
cart.get('/getCart', authenticate, customerOnly, controller.getCart);

/** POST /cart/addItem */
cart.post(
  '/addItem',
  authenticate,
  customerOnly,
  validate({ body: schema.addItemSchema }),
  controller.addItem,
);

/** PATCH /cart/updateItem */
cart.patch(
  '/updateItem',
  authenticate,
  customerOnly,
  validate({ body: schema.updateItemSchema }),
  controller.updateItem,
);

/** DELETE /cart/removeItem/:cartItemId */
cart.delete(
  '/removeItem/:cartItemId',
  authenticate,
  customerOnly,
  validate({ params: idParamSchema }),
  controller.removeItem,
);

/** DELETE /cart/clearCart */
cart.delete('/clearCart', authenticate, customerOnly, controller.clearCart);

/** POST /cart/applyCoupon */
cart.post(
  '/applyCoupon',
  authenticate,
  customerOnly,
  validate({ body: schema.applyCouponSchema }),
  controller.applyCoupon,
);

/** DELETE /cart/removeCoupon */
cart.delete('/removeCoupon', authenticate, customerOnly, controller.removeCoupon);

/** POST /cart/estimate */
cart.post(
  '/estimate',
  authenticate,
  customerOnly,
  validate({ body: schema.estimateSchema }),
  controller.estimate,
);

/** POST /cart/mergeGuestCart */
cart.post(
  '/mergeGuestCart',
  authenticate,
  customerOnly,
  validate({ body: schema.mergeGuestCartSchema }),
  controller.mergeGuestCart,
);

export const cartRoutes = cart;

// ── Wishlist ─────────────────────────────────────────────────────────────────

const wishlist = Router();

/** GET /wishlist/getAll */
wishlist.get('/getAll', authenticate, customerOnly, controller.getWishlist);

/** GET /wishlist/checkProduct/:productId */
wishlist.get(
  '/checkProduct/:productId',
  authenticate,
  customerOnly,
  validate({ params: schema.productIdParamSchema }),
  controller.checkProduct,
);

/** POST /wishlist/addItem */
wishlist.post(
  '/addItem',
  authenticate,
  customerOnly,
  validate({ body: schema.addWishlistItemSchema }),
  controller.addWishlistItem,
);

/** DELETE /wishlist/removeItem/:id */
wishlist.delete(
  '/removeItem/:id',
  authenticate,
  customerOnly,
  validate({ params: idParamSchema }),
  controller.removeWishlistItem,
);

/** DELETE /wishlist/clear */
wishlist.delete('/clear', authenticate, customerOnly, controller.clearWishlist);

/** POST /wishlist/moveToCart/:id */
wishlist.post(
  '/moveToCart/:id',
  authenticate,
  customerOnly,
  validate({ params: idParamSchema, body: schema.moveToCartSchema }),
  controller.moveToCart,
);

export const wishlistRoutes = wishlist;

export default cartRoutes;
