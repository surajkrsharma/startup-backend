import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { D } from '../../utils/defaults';
import * as service from './cart.service';
import {
  serializeCartDetail,
  serializeAddItemResult,
  serializeEstimate,
  serializeWishlist,
  serializeWishlistItem,
  serializeSavedCartItem,
  serializePriceWatch,
} from './cart.serializer';

const userId = (req: Request): string => req.auth!.userId;

const couponExtras = (totals: any): Record<string, any> => ({
  couponCode: D.str(totals?.couponCode),
  couponTitle: D.str(totals?.couponTitle),
  couponType: D.str(totals?.couponType),
  couponDiscount: D.float(totals?.couponDiscount),
  freeShipping: D.bool(totals?.couponFreeShipping),
  couponInvalid: D.bool(totals?.couponInvalid),
});

const vendorGroups = (totals: any): any[] => {
  const grouped = new Map<
    string,
    { vendorId: string; shopName: string; itemCount: number; subtotal: number }
  >();

  for (const line of D.arr(totals?.lines) as any[]) {
    const vendorId = D.str(line?.item?.product?.vendorId);
    if (!grouped.has(vendorId)) {
      grouped.set(vendorId, {
        vendorId,
        shopName: D.str(line?.item?.product?.vendor?.shopName),
        itemCount: 0,
        subtotal: 0,
      });
    }
    const bucket = grouped.get(vendorId)!;
    bucket.itemCount += D.num(line?.item?.qty);
    bucket.subtotal = D.float(bucket.subtotal + D.num(line?.item?.qty) * D.float(line?.unitPrice));
  }

  return Array.from(grouped.values());
};

/**
 * @openapi
 * /cart/getCart:
 *   get:
 *     tags: [Cart]
 *     summary: Get the current user's cart
 *     responses:
 *       200: { description: Cart with live totals and per-vendor subtotals }
 */
export const getCart = asyncHandler(async (req, res) => {
  const cart = await service.getCart(userId(req));
  const totals = await service.calculateTotals(cart);
  return ApiResponse.success(res, {
    message: SUCCESS.CART.FETCHED,
    result: serializeCartDetail(cart, totals, couponExtras(totals)),
  });
});

/**
 * @openapi
 * /cart/addItem:
 *   post:
 *     tags: [Cart]
 *     summary: Add a product (or a specific variant) to the cart
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId: { type: string }
 *               variantId: { type: string }
 *               qty: { type: integer, default: 1, minimum: 1 }
 *     responses:
 *       201: { description: Item added }
 *       422: { description: Out of stock, vendor not approved, or cart full }
 */
export const addItem = asyncHandler(async (req, res) => {
  const { item, totals } = await service.addItem(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.CART.ITEM_ADDED, serializeAddItemResult(item, totals));
});

/**
 * @openapi
 * /cart/updateItem:
 *   patch:
 *     tags: [Cart]
 *     summary: Update a cart line quantity (0 removes it)
 *     responses:
 *       200: { description: Cart updated }
 */
export const updateItem = asyncHandler(async (req, res) => {
  const { removed, totals } = await service.updateItem(userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: removed ? SUCCESS.CART.ITEM_REMOVED : SUCCESS.CART.ITEM_UPDATED,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

export const updateItemOptions = asyncHandler(async (req, res) => {
  const { totals } = await service.updateItemOptions(
    userId(req),
    req.params.cartItemId,
    req.body,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.CART.OPTIONS_UPDATED,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

export const getSavedForLater = asyncHandler(async (req, res) => {
  const items = await service.listSavedForLater(userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.CART.SAVED_FETCHED,
    result: {
      itemCount: D.num(items.length),
      savedItemList: items.map(serializeSavedCartItem),
    },
  });
});

export const saveForLater = asyncHandler(async (req, res) => {
  const { totals } = await service.saveForLater(userId(req), req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.SAVED,
    result: {
      cart: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
    },
  });
});

export const removeSavedItem = asyncHandler(async (req, res) => {
  const { removedCount } = await service.removeSavedItem(userId(req), req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.SAVED_REMOVED,
    result: { savedItemId: D.str(req.params.id), removedCount: D.num(removedCount) },
  });
});

export const moveSavedItemToCart = asyncHandler(async (req, res) => {
  const { totals } = await service.moveSavedItemToCart(userId(req), req.params.id, req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.SAVED_MOVED_TO_CART,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

export const clearSavedForLater = asyncHandler(async (req, res) => {
  const { removedCount } = await service.clearSavedForLater(userId(req), req);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.SAVED_CLEARED,
    result: { removedCount: D.num(removedCount) },
  });
});

export const getPriceWatches = asyncHandler(async (req, res) => {
  const watches = await service.listPriceWatches(userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.CART.WATCH_FETCHED,
    result: {
      watchCount: D.num(watches.length),
      watchList: watches.map(serializePriceWatch),
    },
  });
});

export const watchPrice = asyncHandler(async (req, res) => {
  const watch = await service.watchPrice(userId(req), req.body, req);

  return ApiResponse.created(res, SUCCESS.CART.WATCH_ADDED, serializePriceWatch(watch));
});

export const removePriceWatch = asyncHandler(async (req, res) => {
  await service.removePriceWatch(userId(req), req.params.id);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.WATCH_REMOVED,
    result: { watchId: D.str(req.params.id), isRemoved: true },
  });
});

/**
 * @openapi
 * /cart/removeItem:
 *   post:
 *     tags: [Cart]
 *     summary: Remove a cart line by item id or product id
 *     responses:
 *       200: { description: Item removed }
 *       404: { description: Line not in cart }
 */
export const removeItem = asyncHandler(async (req, res) => {
  const { totals } = await service.removeItem(
    userId(req),
    { id: D.str(req.params.cartItemId) },
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.CART.ITEM_REMOVED,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

/**
 * @openapi
 * /cart/clearCart:
 *   delete:
 *     tags: [Cart]
 *     summary: Empty the cart (also drops any applied coupon)
 *     responses:
 *       200: { description: Cart cleared }
 */
export const clearCart = asyncHandler(async (req, res) => {
  const { removedCount, totals } = await service.clearCart(userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.CART.CART_CLEARED,
    result: {
      removedCount: D.num(removedCount),
      cart: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
    },
  });
});

/**
 * @openapi
 * /cart/applyCoupon:
 *   post:
 *     tags: [Cart]
 *     summary: Validate and apply a coupon to the cart
 *     responses:
 *       200: { description: Coupon applied, totals recalculated }
 *       422: { description: Expired, minimum not met, usage limit, or not applicable }
 */
export const applyCoupon = asyncHandler(async (req, res) => {
  const { totals } = await service.applyCoupon(userId(req), D.str(req.body.code), req);
  return ApiResponse.success(res, {
    message: SUCCESS.CART.COUPON_APPLIED,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

/**
 * @openapi
 * /cart/removeCoupon:
 *   post:
 *     tags: [Cart]
 *     summary: Remove the applied coupon
 *     responses:
 *       200: { description: Coupon removed }
 */
export const removeCoupon = asyncHandler(async (req, res) => {
  const { totals } = await service.removeCoupon(userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.CART.COUPON_REMOVED,
    result: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
  });
});

/**
 * @openapi
 * /cart/estimate:
 *   post:
 *     tags: [Cart]
 *     summary: Checkout preview (totals, per-vendor split, stock issues)
 *     description: >
 *       Validates the payment method, address and coupon up front so the client
 *       sees a problem before committing to an order.
 *     responses:
 *       200: { description: Estimated totals }
 *       422: { description: Empty cart, disabled method, or COD over the limit }
 */
export const estimate = asyncHandler(async (req, res) => {
  const { totals, address, payment, walletBalance } = await service.estimate(userId(req), req.body);

  const stockIssueList = D.arr(totals.lines)
    .filter((l: any) => !l.isAvailable)
    .map((l: any) => ({
      productId: D.str(l.item?.productId),
      name: D.str(l.item?.product?.name),
      requestedQty: D.num(l.item?.qty),
      availableStock: D.num(l.availableStock),
    }));

  return ApiResponse.success(res, {
    message: SUCCESS.CART.ESTIMATED,
    result: serializeEstimate({
      itemCount: totals.itemCount,
      totalQty: totals.totalQty,
      subtotal: totals.subtotal,
      discount: totals.discount,
      couponDiscount: totals.couponDiscount,
      taxAmount: totals.taxAmount,
      shippingAmount: totals.shippingAmount,
      shippingFree: totals.shippingFree,
      walletAmount: totals.walletAmount,
      giftWrapAmount: totals.giftWrapAmount,
      total: totals.total,
      couponCode: D.str(totals.couponCode),
      couponData: D.str(totals.couponCode) ? couponExtras(totals) : {},
      addressData: address ?? {},
      paymentData: { ...payment, walletBalance: D.float(walletBalance) },
      vendorGroupList: vendorGroups(totals),
      hasStockIssue: D.bool(stockIssueList.length),
      stockIssueList,
    }),
  });
});

/**
 * @openapi
 * /cart/mergeGuestCart:
 *   post:
 *     tags: [Cart]
 *     summary: Merge an anonymous cart into the user's cart after login
 *     description: >
 *       Quantities are summed and clamped to available stock, so nothing the
 *       user picked before signing in is lost.
 *     responses:
 *       200: { description: Merge summary with recalculated cart }
 */
export const mergeGuestCart = asyncHandler(async (req, res) => {
  const { mergedCount, skippedCount, totals } = await service.mergeGuestCart(
    userId(req),
    req.body,
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.CART.MERGED,
    result: {
      mergedCount: D.num(mergedCount),
      skippedCount: D.num(skippedCount),
      cart: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
    },
  });
});

/**
 * @openapi
 * /wishlist/getAll:
 *   get:
 *     tags: [Wishlist]
 *     summary: List wishlist items
 *     responses:
 *       200: { description: Wishlist with in/out of stock counts }
 */
export const getWishlist = asyncHandler(async (req, res) => {
  const items = await service.listWishlist(userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.WISHLIST.FETCHED,
    result: serializeWishlist(items),
  });
});

/**
 * @openapi
 * /wishlist/addItem:
 *   post:
 *     tags: [Wishlist]
 *     summary: Add a product to the wishlist
 *     responses:
 *       201: { description: Added }
 *       409: { description: Already in wishlist }
 */
export const addWishlistItem = asyncHandler(async (req, res) => {
  const item = await service.addWishlistItem(userId(req), D.str(req.body.productId), req);
  return ApiResponse.created(res, SUCCESS.WISHLIST.ADDED, serializeWishlistItem(item));
});

/**
 * @openapi
 * /wishlist/removeItem/:id:
 *   delete:
 *     tags: [Wishlist]
 *     summary: Remove a wishlist item by wishlist-item id or product id
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Not in wishlist }
 */
export const removeWishlistItem = asyncHandler(async (req, res) => {
  await service.removeWishlistItem(userId(req), D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.WISHLIST.REMOVED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /wishlist/clear:
 *   post:
 *     tags: [Wishlist]
 *     summary: Remove every wishlist item
 *     responses:
 *       200: { description: Wishlist cleared }
 */
export const clearWishlist = asyncHandler(async (req, res) => {
  const { removedCount } = await service.clearWishlist(userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.WISHLIST.CLEARED,
    result: { removedCount: D.num(removedCount) },
  });
});

/**
 * @openapi
 * /wishlist/moveToCart/:id:
 *   post:
 *     tags: [Wishlist]
 *     summary: Move a wishlist item into the cart and remove it from the wishlist
 *     responses:
 *       200: { description: Moved, cart recalculated }
 *       404: { description: Not in wishlist }
 */
export const moveToCart = asyncHandler(async (req, res) => {
  const { item, totals } = await service.moveWishlistItemToCart(
    userId(req),
    { productId: D.str(req.params.id), ...req.body },
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.WISHLIST.MOVED_TO_CART,
    result: {
      cartItemId: D.str(item?.id),
      productId: D.str(item?.productId),
      qty: D.num(item?.qty),
      cart: serializeCartDetail(await service.getCart(userId(req)), totals, couponExtras(totals)),
    },
  });
});

/**
 * @openapi
 * /wishlist/checkProduct/:productId:
 *   get:
 *     tags: [Wishlist]
 *     summary: Whether a product is in the caller's wishlist
 *     responses:
 *       200: { description: Membership flag }
 */
export const checkProduct = asyncHandler(async (req, res) => {
  const items = await service.listWishlist(userId(req));
  const productId = D.str(req.params.productId);

  return ApiResponse.success(res, {
    message: SUCCESS.WISHLIST.FETCHED,
    result: {
      productId,
      isInWishlist: D.arr(items).some((i: any) => D.str(i?.productId) === productId),
    },
  });
});
