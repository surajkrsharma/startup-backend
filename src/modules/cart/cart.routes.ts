import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/auth.middleware';
import { ROLES } from '../../constants/roles';
import * as controller from './cart.controller';
import * as schema from './cart.schema';

const customerOnly = requireRole(ROLES.CUSTOMER);

const cart = Router();

cart.get('/getCart', authenticate, customerOnly, controller.getCart);

cart.post(
  '/addItem',
  authenticate,
  customerOnly,
  validate({ body: schema.addItemSchema }),
  controller.addItem,
);

cart.patch(
  '/updateItem',
  authenticate,
  customerOnly,
  validate({ body: schema.updateItemSchema }),
  controller.updateItem,
);

cart.delete(
  '/removeItem/:cartItemId',
  authenticate,
  customerOnly,
  validate({ params: schema.cartItemIdParamSchema }),
  controller.removeItem,
);

cart.delete('/clearCart', authenticate, customerOnly, controller.clearCart);

cart.post(
  '/applyCoupon',
  authenticate,
  customerOnly,
  validate({ body: schema.applyCouponSchema }),
  controller.applyCoupon,
);

cart.delete('/removeCoupon', authenticate, customerOnly, controller.removeCoupon);

cart.post(
  '/estimate',
  authenticate,
  customerOnly,
  validate({ body: schema.estimateSchema }),
  controller.estimate,
);

cart.post(
  '/mergeGuestCart',
  authenticate,
  customerOnly,
  validate({ body: schema.mergeGuestCartSchema }),
  controller.mergeGuestCart,
);

cart.patch(
  '/updateItemOptions/:cartItemId',
  authenticate,
  customerOnly,
  validate({ params: schema.cartItemIdParamSchema, body: schema.updateItemOptionsSchema }),
  controller.updateItemOptions,
);

cart.get('/getSavedForLater', authenticate, customerOnly, controller.getSavedForLater);

cart.post(
  '/saveForLater',
  authenticate,
  customerOnly,
  validate({ body: schema.saveForLaterSchema }),
  controller.saveForLater,
);

cart.post(
  '/savedForLater/:id/moveToCart',
  authenticate,
  customerOnly,
  validate({ params: schema.savedItemParamSchema, body: schema.savedToCartSchema }),
  controller.moveSavedItemToCart,
);

cart.delete(
  '/savedForLater/:id',
  authenticate,
  customerOnly,
  validate({ params: schema.savedItemParamSchema }),
  controller.removeSavedItem,
);

cart.delete('/savedForLater', authenticate, customerOnly, controller.clearSavedForLater);

const priceWatch = Router();

priceWatch.get('/getAll', authenticate, customerOnly, controller.getPriceWatches);

priceWatch.post(
  '/watch',
  authenticate,
  customerOnly,
  validate({ body: schema.watchPriceSchema }),
  controller.watchPrice,
);

priceWatch.delete(
  '/remove/:id',
  authenticate,
  customerOnly,
  validate({ params: schema.savedItemParamSchema }),
  controller.removePriceWatch,
);

export const priceWatchRoutes = priceWatch;

export const cartRoutes = cart;

const wishlist = Router();

wishlist.get('/getAll', authenticate, customerOnly, controller.getWishlist);

wishlist.get(
  '/checkProduct/:productId',
  authenticate,
  customerOnly,
  validate({ params: schema.productIdParamSchema }),
  controller.checkProduct,
);

wishlist.post(
  '/addItem',
  authenticate,
  customerOnly,
  validate({ body: schema.addWishlistItemSchema }),
  controller.addWishlistItem,
);

wishlist.delete(
  '/removeItem/:id',
  authenticate,
  customerOnly,
  validate({ params: idParamSchema }),
  controller.removeWishlistItem,
);

wishlist.delete('/clear', authenticate, customerOnly, controller.clearWishlist);

wishlist.post(
  '/moveToCart/:id',
  authenticate,
  customerOnly,
  validate({ params: idParamSchema, body: schema.moveToCartSchema }),
  controller.moveToCart,
);

export const wishlistRoutes = wishlist;

export default cartRoutes;
