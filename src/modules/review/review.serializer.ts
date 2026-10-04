import { D } from '../../utils/defaults';
import {
  serializeReview,
  serializeQuestion,
  serializeCoupon,
  serializeFlashSale,
} from '../../utils/serialize';

export { serializeReview, serializeQuestion, serializeCoupon, serializeFlashSale };

export const serializeReviewDetail = (r: any) => {
  const base = serializeReview(r);

  return {
    ...base,
    orderItemId: D.str(r?.orderItemId),
    repliedById: D.str(r?.repliedById),
    isPending: D.str(r?.status) === 'PENDING',
    isApproved: D.str(r?.status) === 'APPROVED',
    isRejected: D.str(r?.status) === 'REJECTED',

    userData: r?.user
      ? {
          userId: D.str(r.user.id),
          name: D.str(r.user.name),
          avatarUrl: D.str(r.user.avatarUrl),
        }
      : {},

    vendorData: r?.vendor
      ? {
          vendorId: D.str(r.vendor.id),
          shopName: D.str(r.vendor.shopName),
          slug: D.str(r.vendor.slug),
        }
      : {},
  };
};

export const serializeFlashSaleDetail = (s: any) => {
  const base = serializeFlashSale(s);
  const now = new Date();
  const startsAt = new Date(D.str(s?.startsAt));
  const endsAt = new Date(D.str(s?.endsAt));

  const isLive = D.bool(s?.isActive) && startsAt <= now && endsAt >= now;
  const remaining = Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));

  return {
    ...base,
    slug: D.str(s?.slug),
    discountType: D.str(s?.discountType),
    discountValue: D.float(s?.discountValue),
    isLive,
    isUpcoming: startsAt > now,
    hasEnded: endsAt < now,
    secondsRemaining: remaining,

    itemList: D.arr(s?.items).map((i: any) => {
      const product = i?.product;
      const stock = D.num(i?.saleStock);
      const sold = D.num(i?.soldCount);

      const soldOut = D.bool(i?.isSoldOut) || stock <= 0;

      return {
        flashSaleItemId: D.str(i?.id),
        productId: D.str(i?.productId),
        salePrice: D.float(i?.salePrice),
        originalPrice: D.float(product?.price),
        mrpPrice: D.float(product?.mrpPrice),
        saving: D.float(Math.max(0, D.float(product?.price) - D.float(i?.salePrice))),
        saleStock: stock,
        soldCount: sold,
        stockRemaining: Math.max(0, stock - sold),
        isSoldOut: soldOut,
        discountPercent:
          D.float(product?.price) > 0
            ? D.float(
                Math.round(
                  ((D.float(product.price) - D.float(i?.salePrice)) / D.float(product.price)) *
                    1000,
                ) / 10,
              )
            : 0,

        productData: product
          ? {
              productId: D.str(product.id),
              name: D.str(product.name),
              slug: D.str(product.slug),
              price: D.float(product.price),
              mrpPrice: D.float(product.mrpPrice),
              stock: D.num(product.stock),
              isActive: D.str(product.status) === 'ACTIVE',
              imageList: D.arr(product.images)
                .slice()
                .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
                .map((i: any) => D.str(i?.url)),
            }
          : {},
      };
    }),
  };
};

export const serializeCouponUsage = (u: any) => ({
  usageId: D.str(u?.id),
  couponId: D.str(u?.couponId),
  userId: D.str(u?.userId),
  orderId: D.str(u?.orderId),
  amount: D.float(u?.amount),
  createdAt: D.date(u?.createdAt),

  couponData: u?.coupon
    ? {
        couponId: D.str(u.coupon.id),
        code: D.str(u.coupon.code),
        title: D.str(u.coupon.title),
        type: D.str(u.coupon.type),
      }
    : {},

  userData: u?.user
    ? { userId: D.str(u.user.id), name: D.str(u.user.name), email: D.str(u.user.email) }
    : {},
});
