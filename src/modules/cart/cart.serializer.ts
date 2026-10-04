import { D } from '../../utils/defaults';
import { serializeCartItem, serializeWishlistItem } from '../../utils/serialize';

export { serializeWishlistItem };

export const serializeCartLine = (item: any): Record<string, any> => {
  const base: any = serializeCartItem(item);
  const qty = D.num(item?.qty);
  const product = item?.product;
  const variant = item?.variant;

  const unitPrice = variant?.price ?? product?.price ?? base.price;
  const stock = D.num(variant?.stock ?? product?.stock);

  return {
    ...base,
    unitPrice: D.float(unitPrice),
    lineTotal: D.float(qty * D.float(unitPrice)),
    availableStock: stock,
    isLowStock: stock > 0 && stock <= 5,
    isAvailable:
      D.str(product?.status) === 'ACTIVE' &&
      D.str(product?.vendor?.status) === 'APPROVED' &&
      (stock >= qty || D.bool(product?.allowBackorder)),

    productData: base.productData
      ? {
          ...base.productData,
          price: D.float(product?.price),
          mrpPrice: D.float(product?.mrpPrice),
          vendorData: product?.vendor
            ? {
                vendorId: D.str(product.vendor.id),
                shopName: D.str(product.vendor.shopName),
                slug: D.str(product.vendor.slug),
              }
            : {},
        }
      : {},

    variantData: base.variantData
      ? {
          ...base.variantData,
          price: D.float(variant?.price),
          mrpPrice: D.float(variant?.mrpPrice),
        }
      : {},
  };
};

export const serializeCartDetail = (cart: any, totals: any, extras: Record<string, any> = {}) => {
  const items: any[] = D.arr(cart?.items);
  const lines: any[] = items.map(serializeCartLine);

  const grouped = new Map<
    string,
    { vendorId: string; shopName: string; itemCount: number; subtotal: number }
  >();

  for (const raw of items) {
    const vendorId = D.str(raw?.product?.vendorId);
    if (!grouped.has(vendorId)) {
      grouped.set(vendorId, {
        vendorId,
        shopName: D.str(raw?.product?.vendor?.shopName),
        itemCount: 0,
        subtotal: 0,
      });
    }
    const bucket = grouped.get(vendorId)!;
    bucket.itemCount += D.num(raw?.qty);
    bucket.subtotal = D.float(
      bucket.subtotal + D.float(raw?.qty) * D.float(raw?.variant?.price ?? raw?.product?.price),
    );
  }

  const code = D.str(extras.couponCode ?? cart?.couponCode);

  return {
    cartId: D.str(cart?.id),
    itemCount: D.num(totals?.itemCount),
    totalQty: D.num(totals?.totalQty),
    subtotal: D.float(totals?.subtotal),
    discount: D.float(totals?.discount),
    couponDiscount: D.float(totals?.couponDiscount),
    taxAmount: D.float(totals?.taxAmount),
    shippingAmount: D.float(totals?.shippingAmount),
    walletAmount: D.float(totals?.walletAmount),
    total: D.float(totals?.total),
    hasStockIssue: D.bool(lines.some((l: any) => !l.isAvailable)),
    couponInvalid: D.bool(extras.couponInvalid),
    updatedAt: D.date(cart?.updatedAt),

    couponCode: code,

    couponData: code
      ? {
          code,
          title: D.str(extras.couponTitle),
          type: D.str(extras.couponType),
          discount: D.float(extras.couponDiscount),
          freeShipping: D.bool(extras.freeShipping),
        }
      : {},

    vendorGroupList: Array.from(grouped.values()).map((g) => ({
      vendorId: g.vendorId,
      shopName: g.shopName,
      itemCount: g.itemCount,
      subtotal: g.subtotal,
    })),

    itemList: lines,
  };
};

export const serializeAddItemResult = (item: any, totals: any) => ({
  cartItemId: D.str(item?.id),
  productId: D.str(item?.productId),
  variantId: D.str(item?.variantId),
  qty: D.num(item?.qty),
  unitPrice: D.float(item?.variant?.price ?? item?.price),
  lineTotal: D.float(D.num(item?.qty) * D.float(item?.variant?.price ?? item?.price)),
  itemCount: D.num(totals?.itemCount),
  subtotal: D.float(totals?.subtotal),
  total: D.float(totals?.total),
});

export const serializeEstimate = (input: {
  itemCount: number;
  totalQty: number;
  subtotal: number;
  discount: number;
  couponDiscount: number;
  taxAmount: number;
  shippingAmount: number;
  shippingFree: boolean;
  walletAmount: number;
  total: number;
  couponCode: string;
  couponData: Record<string, any>;
  addressData: Record<string, any>;
  paymentData: Record<string, any>;
  vendorGroupList: any[];
  hasStockIssue: boolean;
  stockIssueList: any[];
}) => ({
  itemCount: D.num(input.itemCount),
  totalQty: D.num(input.totalQty),
  subtotal: D.float(input.subtotal),
  discount: D.float(input.discount),
  couponDiscount: D.float(input.couponDiscount),
  taxAmount: D.float(input.taxAmount),
  shippingAmount: D.float(input.shippingAmount),
  shippingFree: D.bool(input.shippingFree),
  walletAmount: D.float(input.walletAmount),
  total: D.float(input.total),
  hasStockIssue: D.bool(input.hasStockIssue),

  couponCode: D.str(input.couponCode),

  couponData: D.obj(input.couponData),
  addressData: D.obj(input.addressData),
  paymentData: D.obj(input.paymentData),

  vendorGroupList: D.arr(input.vendorGroupList).map((g: any) => ({
    vendorId: D.str(g?.vendorId),
    shopName: D.str(g?.shopName),
    itemCount: D.num(g?.itemCount),
    subtotal: D.float(g?.subtotal),
  })),

  stockIssueList: D.arr(input.stockIssueList).map((s: any) => ({
    productId: D.str(s?.productId),
    name: D.str(s?.name),
    requestedQty: D.num(s?.requestedQty),
    availableStock: D.num(s?.availableStock),
  })),
});

export const serializeWishlist = (items: any[]) => ({
  itemCount: D.arr(items).length,
  inStockCount: D.arr(items).filter((i: any) => D.num(i?.product?.stock) > 0).length,
  outOfStockCount: D.arr(items).filter((i: any) => D.num(i?.product?.stock) <= 0).length,

  itemList: D.arr(items).map(serializeWishlistItem),
});
