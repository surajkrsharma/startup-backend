import { z } from 'zod';
import { PAYMENT_METHOD } from '../../constants/roles';
import { VALIDATION } from '../../messages/validation';
import { COUPON_CODE_REGEX } from '../../constants/countries';
import { common } from '../../middlewares/validate.middleware';

const id = common.cuid;

/** POST /cart/addItem */
export const addItemSchema = z
  .object({
    productId: id,
    variantId: id.optional().or(z.literal('')),
    qty: z.coerce.number().int().min(1, VALIDATION.INVALID_QUANTITY).max(999).optional().default(1),
  })
  .strict();

/**
 * PATCH /cart/updateItem — identified by productId (plus variantId for a specific
 * variant row) rather than the internal cart-item id, so clients never have to
 * round-trip an id they were never shown. `qty: 0` removes the line.
 */
export const updateItemSchema = z
  .object({
    productId: id,
    variantId: id.optional().or(z.literal('')),
    qty: z.coerce.number().int().min(0).max(999),
  })
  .strict();

export const cartItemParamSchema = z.object({ id });

/** DELETE /cart/removeItem/:cartItemId — the path param is named, not a bare `id`. */
export const cartItemIdParamSchema = z.object({ cartItemId: id });

/** POST /cart/removeItem — accept the item id or the product id. */
export const removeItemSchema = z
  .object({
    id: id.optional(),
    productId: id.optional(),
    variantId: id.optional().or(z.literal('')),
  })
  .strict()
  .refine((v) => Boolean(v.id || v.productId), {
    message: 'Provide id or productId.',
  });

/** POST /cart/applyCoupon */
export const applyCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(COUPON_CODE_REGEX, 'Coupon code may contain A-Z, 0-9, _ and - only.'),
  })
  .strict();

export const removeCouponSchema = z
  .object({
    code: z.string().trim().max(24).optional(),
  })
  .strict();

/** POST /cart/estimate — checkout preview before the order is committed. */
export const estimateSchema = z
  .object({
    addressId: id.optional(),
    paymentMethod: z.nativeEnum(PAYMENT_METHOD).optional(),
    useWalletBalance: z.boolean().optional().default(false),
    walletAmount: z.coerce.number().min(0).optional(),
    couponCode: z.string().trim().max(24).optional(),
  })
  .strict();

/**
 * POST /cart/mergeGuestCart — folds an anonymous session cart into the user's
 * cart after login. `sessionKey` is the value the tracking middleware assigned
 * to the `x-session-id` header, so the client can pass what it kept locally.
 */
export const mergeGuestCartSchema = z
  .object({
    sessionKey: z.string().trim().max(120).optional(),
    items: z
      .array(
        z
          .object({
            productId: id,
            variantId: id.optional(),
            qty: z.coerce.number().int().min(1).max(999),
          })
          .strict(),
      )
      .max(100)
      .optional()
      .default([]),
  })
  .strict();

/** POST /cart/clear */
export const clearCartSchema = z
  .object({
    keepFavourites: z.boolean().optional().default(false),
  })
  .strict();

// ─── Wishlist ────────────────────────────────────────────────────────────────

export const addWishlistItemSchema = z
  .object({
    productId: id,
    qty: z.coerce.number().int().min(1).optional().default(1),
  })
  .strict();

/** Path param accepts either the wishlist-item id or a product id. */
export const wishlistItemParamSchema = z.object({ id });

export const productIdParamSchema = z.object({ productId: z.string().trim().min(1).max(40) });

export const moveToCartSchema = z
  .object({
    productId: id.optional(),
    variantId: id.optional(),
    qty: z.coerce.number().int().min(1).max(999).optional().default(1),
  })
  .strict();

export type AddCartItemInput = z.infer<typeof addItemSchema>;
export type EstimateInput = z.infer<typeof estimateSchema>;
export type MergeGuestCartInput = z.infer<typeof mergeGuestCartSchema>;
