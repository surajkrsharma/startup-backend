import { D } from './defaults';

export const paginationFields = (
  totalRecord: number,
  page: number,
  limit: number,
): Record<string, any> => {
  const safeTotal = D.num(totalRecord);
  const safePage = Math.max(1, D.num(page));
  const safeLimit = Math.max(1, D.num(limit));
  const totalPage = safeLimit > 0 ? Math.ceil(safeTotal / safeLimit) : 0;
  const hasNext = safePage * safeLimit < safeTotal;

  return {
    totalRecord: safeTotal,
    totalPage,
    currentPage: safePage,
    limit: safeLimit,
    hasNext,
    hasPrevious: safePage > 1,
    nextPage: hasNext ? safePage + 1 : 0,
    previousPage: safePage > 1 ? safePage - 1 : 0,
  };
};

export const serializeAddress = (a: any) => ({
  addressId: D.str(a?.id),
  type: D.str(a?.type),
  fullName: D.str(a?.fullName),
  phone: D.str(a?.phone),
  line1: D.str(a?.line1),
  line2: D.str(a?.line2),
  landmark: D.str(a?.landmark),
  deliveryInstructions: D.str(a?.deliveryInstructions),
  city: D.str(a?.city),
  state: D.str(a?.state),
  stateCode: D.str(a?.stateCode),
  country: D.str(a?.country),
  countryCode: D.str(a?.countryCode),
  pincode: D.str(a?.pincode),
  isDefault: D.bool(a?.isDefault),
  createdAt: D.date(a?.createdAt),
  updatedAt: D.date(a?.updatedAt),
});

export const serializeKycDocument = (d: any) => ({
  documentId: D.str(d?.id),
  vendorId: D.str(d?.vendorId),
  docType: D.str(d?.docType),
  fileUrl: D.str(d?.fileUrl),
  number: D.str(d?.number),
  isVerified: D.bool(d?.isVerified),
  remark: D.str(d?.remark),
  verifiedAt: D.date(d?.verifiedAt),
  createdAt: D.date(d?.createdAt),

  vendorData: d?.vendor
    ? {
        vendorId: D.str(d.vendor.id),
        shopName: D.str(d.vendor.shopName),
        slug: D.str(d.vendor.slug),
        status: D.str(d.vendor.status),
      }
    : {},
});

export const serializeUser = (u: any) => ({
  userId: D.str(u?.id),
  name: D.str(u?.name),
  email: D.str(u?.email),
  phone: D.str(u?.phone),
  avatarUrl: D.str(u?.avatarUrl),
  role: D.str(u?.role),
  isActive: D.bool(u?.isActive),
  isEmailVerified: D.bool(u?.isEmailVerified),
  isPhoneVerified: D.bool(u?.isPhoneVerified),
  isTwoFactorEnabled: D.bool(u?.twoFactorEnabled),
  loyaltyTier: D.str(u?.loyaltyTier),
  lastLoginAt: D.date(u?.lastLoginAt),
  createdAt: D.date(u?.createdAt),
  updatedAt: D.date(u?.updatedAt),

  vendorData: u?.vendorProfile
    ? {
        vendorId: D.str(u.vendorProfile.id),
        shopName: D.str(u.vendorProfile.shopName),
        slug: D.str(u.vendorProfile.slug),
        status: D.str(u.vendorProfile.status),
      }
    : {},

  addressList: D.arr(u?.addresses).map(serializeAddress),

  statsData: u?._count
    ? {
        orderCount: D.num(u._count.orders),
        reviewCount: D.num(u._count.reviews),
      }
    : {},

  rolesList: u?.role ? [D.str(u.role)] : [],
});

/**
 * Deliberately narrower than `serializeUser`, for places that only need to show
 * who somebody is — a review author, an activity-log actor, a nested `userData`.
 * Naming the projection keeps the choice explicit instead of leaving a reader
 * guessing which of the two user shapes a given endpoint returns.
 */
export const serializeUserSummary = (u: any) => ({
  userId: D.str(u?.id),
  name: D.str(u?.name),
  email: D.str(u?.email),
  phone: D.str(u?.phone),
  avatarUrl: D.str(u?.avatarUrl),
  isActive: D.bool(u?.isActive),
});

export const serializeVendor = (v: any) => ({
  vendorId: D.str(v?.id),
  userId: D.str(v?.userId),
  shopName: D.str(v?.shopName),
  slug: D.str(v?.slug),
  description: D.str(v?.description),
  logo: D.str(v?.logo),
  banner: D.str(v?.banner),
  gstNumber: D.str(v?.gstNumber),
  panNumber: D.str(v?.panNumber),
  status: D.str(v?.status),
  isApproved: D.str(v?.status) === 'APPROVED',
  commissionRate: D.float(v?.commissionRate),
  payoutCycleDays: D.num(v?.payoutCycleDays),
  rating: D.float(v?.rating),
  ratingCount: D.num(v?.ratingCount),
  totalSales: D.float(v?.totalSales),
  pendingAmount: D.float(v?.pendingAmount),
  isDocumentsSubmitted: D.bool(v?.isDocumentsSubmitted),
  documentsVerifiedAt: D.date(v?.documentsVerifiedAt),
  approvedAt: D.date(v?.approvedAt),
  rejectedReason: D.str(v?.rejectedReason),
  createdAt: D.date(v?.createdAt),
  updatedAt: D.date(v?.updatedAt),

  userData: v?.user ? serializeUserSummary(v.user) : {},

  bankData: {
    bankHolderName: D.str(v?.bankHolderName),
    bankAccountNo: D.str(v?.bankAccountNo),
    bankIfsc: D.str(v?.bankIfsc),
    upiId: D.str(v?.upiId),
    hasBankDetails: Boolean(D.str(v?.bankAccountNo) && D.str(v?.bankIfsc)),
    hasUpi: Boolean(D.str(v?.upiId)),
  },

  documentList: D.arr(v?.kycDocuments).map(serializeKycDocument),

  statsData: v?._count
    ? {
        productCount: D.num(v._count.products),
        subOrderCount: D.num(v._count.subOrders),
        reviewCount: D.num(v._count.reviews),
      }
    : {},
});

export const serializeCategory = (c: any) => ({
  categoryId: D.str(c?.id),
  parentId: D.str(c?.parentId),
  name: D.str(c?.name),
  slug: D.str(c?.slug),
  description: D.str(c?.description),
  image: D.str(c?.image),
  icon: D.str(c?.icon),
  isActive: D.bool(c?.isActive),
  sortOrder: D.num(c?.sortOrder),
  productCount: D.num(c?._count?.products),
  createdAt: D.date(c?.createdAt),
  updatedAt: D.date(c?.updatedAt),

  parentData: c?.parent
    ? {
        categoryId: D.str(c.parent.id),
        name: D.str(c.parent.name),
        slug: D.str(c.parent.slug),
      }
    : {},

  childList: D.arr(c?.children).map((child: any) => ({
    categoryId: D.str(child?.id),
    parentId: D.str(child?.parentId),
    name: D.str(child?.name),
    slug: D.str(child?.slug),
    image: D.str(child?.image),
    isActive: D.bool(child?.isActive),
    sortOrder: D.num(child?.sortOrder),
    productCount: D.num(child?._count?.products),
  })),
});

export const serializeBrand = (b: any) => ({
  brandId: D.str(b?.id),
  name: D.str(b?.name),
  slug: D.str(b?.slug),
  logo: D.str(b?.logo),
  description: D.str(b?.description),
  isActive: D.bool(b?.isActive),
  productCount: D.num(b?._count?.products),
  createdAt: D.date(b?.createdAt),
  updatedAt: D.date(b?.updatedAt),
});

export const serializeTag = (t: any) => ({
  tagId: D.str(t?.id),
  name: D.str(t?.name),
  slug: D.str(t?.slug),
  isActive: D.bool(t?.isActive),
  productCount: D.num(t?._count?.products),
  createdAt: D.date(t?.createdAt),
});

export const serializeAttribute = (a: any) => ({
  attributeId: D.str(a?.id),
  name: D.str(a?.name),
  slug: D.str(a?.slug),
  type: D.str(a?.type),
  options: D.strArr(a?.options),
  isVariant: D.bool(a?.isVariant),
  isFilterable: D.bool(a?.isFilterable),
  isActive: D.bool(a?.isActive),
  sortOrder: D.num(a?.sortOrder),
  usageCount: D.num(a?._count?.values),
  createdAt: D.date(a?.createdAt),
  updatedAt: D.date(a?.updatedAt),
});

export const serializeCollection = (c: any) => ({
  collectionId: D.str(c?.id),
  name: D.str(c?.name),
  slug: D.str(c?.slug),
  description: D.str(c?.description),
  image: D.str(c?.image),
  type: D.str(c?.type),
  rules: D.obj(c?.rules),
  isActive: D.bool(c?.isActive),
  sortOrder: D.num(c?.sortOrder),
  productCount: D.num(c?._count?.products ?? c?.products?.length),
  createdAt: D.date(c?.createdAt),
  updatedAt: D.date(c?.updatedAt),

  productList: D.arr(c?.products).map((p: any) => ({
    productId: D.str(p?.id),
    name: D.str(p?.name),
    slug: D.str(p?.slug),
    price: D.float(p?.price),
    mrpPrice: D.float(p?.mrpPrice),
    stock: D.num(p?.stock),
    isActive: D.str(p?.status) === 'ACTIVE',
    sortOrder: D.num(p?.sortOrder),
    imageList: D.arr(p?.images)
      .slice()
      .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
      .map((i: any) => D.str(i?.url)),
  })),
});

export const serializeProduct = (p: any) => {
  const isActive = D.str(p?.status) === 'ACTIVE';
  const price = p?.variant?.price ?? p?.price;

  return {
    productId: D.str(p?.id),
    vendorId: D.str(p?.vendorId),
    name: D.str(p?.name),
    slug: D.str(p?.slug),
    description: D.str(p?.description),
    sku: D.str(p?.sku),
    price: D.float(price),
    mrpPrice: D.float(p?.mrpPrice),
    taxPercent: D.float(p?.taxPercent),
    stock: D.num(p?.variant?.stock ?? p?.stock),
    lowStockThreshold: D.num(p?.lowStockThreshold),
    condition: D.str(p?.condition),
    warrantyMonths: D.num(p?.warrantyMonths),
    warrantySummary: D.str(p?.warrantySummary),
    isNonReturnable: D.bool(p?.isNonReturnable),
    weight: D.float(p?.weight),
    status: D.str(p?.status),
    isActive,
    isFeatured: D.bool(p?.isFeatured),
    isOutOfStock: D.num(p?.variant?.stock ?? p?.stock) <= 0,
    soldCount: D.num(p?.soldCount),
    viewCount: D.num(p?.viewCount),
    rating: D.float(p?.rating),
    ratingCount: D.num(p?.ratingCount),
    createdAt: D.date(p?.createdAt),

    categoryData: p?.category
      ? {
          categoryId: D.str(p.category.id),
          name: D.str(p.category.name),
          slug: D.str(p.category.slug),
        }
      : {},

    brandData: p?.brand
      ? { brandId: D.str(p.brand.id), name: D.str(p.brand.name), slug: D.str(p.brand.slug) }
      : {},

    vendorData: p?.vendor
      ? {
          vendorId: D.str(p.vendor.id),
          shopName: D.str(p.vendor.shopName),
          slug: D.str(p.vendor.slug),
          rating: D.float(p.vendor.rating),
        }
      : {},

    attributeList: D.arr(p?.attributes).map((a: any) => ({
      attributeId: D.str(a?.attributeId),
      name: D.str(a?.attribute?.name),
      value: D.str(a?.value),
    })),

    imageList: D.arr(p?.images)
      .slice()
      .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
      .map((img: any) => D.str(img?.url)),

    variantList: D.arr(p?.variants).map((v: any) => ({
      variantId: D.str(v?.id),
      title: D.str(v?.title),
      sku: D.str(v?.sku),
      attributes: D.obj(v?.attributes),
      price: D.float(v?.price),
      mrpPrice: D.float(v?.mrpPrice),
      stock: D.num(v?.stock),
      isActive: D.bool(v?.isActive),
    })),

    tagList: D.arr(p?.tags)
      .map((t: any) => ({
        tagId: D.str(t?.tagId),
        name: D.str(t?.tag?.name),
        slug: D.str(t?.tag?.slug),
      }))
      .filter((t: any) => D.str(t.name) !== ''),

    reviewList: D.arr(p?.reviews)
      .filter((r: any) => D.str(r?.status) === 'APPROVED')
      .map((r: any) => ({
        reviewId: D.str(r?.id),
        rating: D.num(r?.rating),
        title: D.str(r?.title),
        comment: D.str(r?.comment),
        images: D.strArr(r?.images),
        isVerified: D.bool(r?.isVerified),
        vendorReply: D.str(r?.vendorReply),
        createdAt: D.date(r?.createdAt),
        userData: r?.user ? { userId: D.str(r.user.id), name: D.str(r.user.name) } : {},
      })),
  };
};

export const serializeProductSummary = (p: any) => ({
  productId: D.str(p?.id),
  vendorId: D.str(p?.vendorId),
  name: D.str(p?.name),
  slug: D.str(p?.slug),
  sku: D.str(p?.sku),
  price: D.float(p?.price),
  mrpPrice: D.float(p?.mrpPrice),
  stock: D.num(p?.stock),
  condition: D.str(p?.condition),
  warrantyMonths: D.num(p?.warrantyMonths),
  isNonReturnable: D.bool(p?.isNonReturnable),
  isActive: D.str(p?.status) === 'ACTIVE',
  isFeatured: D.bool(p?.isFeatured),
  rating: D.float(p?.rating),
  soldCount: D.num(p?.soldCount),
  createdAt: D.date(p?.createdAt),

  categoryData: p?.category
    ? { categoryId: D.str(p.category.id), name: D.str(p.category.name) }
    : {},
  vendorData: p?.vendor
    ? {
        vendorId: D.str(p.vendor.id),
        shopName: D.str(p.vendor.shopName),
        slug: D.str(p.vendor.slug),
      }
    : {},
  imageList: D.arr(p?.images)
    .slice()
    .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
    .map((img: any) => D.str(img?.url)),
  reviewList: [],
});

export const serializeProductList = (rows: any[]) => ({
  productList: D.arr(rows).map(serializeProductSummary),
});

export const serializeCartItem = (item: any) => ({
  cartItemId: D.str(item?.id),
  productId: D.str(item?.productId),

  variantId: D.str(item?.variantId),
  qty: D.num(item?.qty),
  price: D.float(item?.price),
  lineTotal: D.float(D.num(item?.qty) * D.float(item?.price)),
  createdAt: D.date(item?.createdAt),

  productData: item?.product
    ? {
        productId: D.str(item.product.id),
        name: D.str(item.product.name),
        slug: D.str(item.product.slug),
        stock: D.num(item.product.stock),
        isActive: D.str(item.product.status) === 'ACTIVE',
        vendorId: D.str(item.product.vendorId),
        imageList: D.arr(item.product.images)
          .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
          .map((img: any) => D.str(img?.url)),
      }
    : {},

  variantData: item?.variant
    ? {
        variantId: D.str(item.variant.id),
        title: D.str(item.variant.title),
        sku: D.str(item.variant.sku),
        attributes: D.obj(item.variant.attributes),
        stock: D.num(item.variant.stock),
      }
    : {},
});

export const serializeCart = (cart: any, totals?: any) => ({
  cartId: D.str(cart?.id),
  itemCount: D.num(totals?.itemCount ?? D.arr(cart?.items).length),
  totalQty: D.num(totals?.totalQty ?? 0),
  subtotal: D.float(totals?.subtotal ?? 0),
  discount: D.float(totals?.discount ?? 0),
  couponDiscount: D.float(totals?.couponDiscount ?? 0),
  taxAmount: D.float(totals?.taxAmount ?? 0),
  shippingAmount: D.float(totals?.shippingAmount ?? 0),
  walletAmount: D.float(totals?.walletAmount ?? 0),
  total: D.float(totals?.total ?? 0),
  couponCode: D.str(cart?.couponCode),
  updatedAt: D.date(cart?.updatedAt),

  itemList: D.arr(cart?.items).map(serializeCartItem),
});

export const serializeWishlistItem = (item: any) => ({
  wishlistItemId: D.str(item?.id),
  productId: D.str(item?.productId),
  createdAt: D.date(item?.createdAt),

  productData: item?.product
    ? {
        ...serializeProductSummary(item.product),
        isAvailable: D.num(item.product.stock) > 0,
      }
    : {},
});

export const serializeOrderItem = (item: any) => ({
  orderItemId: D.str(item?.id),
  productId: D.str(item?.productId),
  variantId: D.str(item?.variantId),
  name: D.str(item?.name),
  sku: D.str(item?.sku),
  image: D.str(item?.image),
  attributes: D.obj(item?.attributes),
  price: D.float(item?.price),
  qty: D.num(item?.qty),
  taxPercent: D.float(item?.taxPercent),
  taxAmount: D.float(item?.taxAmount),
  total: D.float(item?.total),
  commission: D.float(item?.commission),
  vendorEarning: D.float(item?.vendorEarning),
  isGiftWrap: D.bool(item?.isGiftWrap),
  giftWrapNote: D.str(item?.giftWrapNote),
  deliveryNote: D.str(item?.deliveryNote),
});

export const serializeSubOrder = (s: any) => ({
  subOrderId: D.str(s?.id),
  orderId: D.str(s?.orderId),
  vendorId: D.str(s?.vendorId),
  status: D.str(s?.status),
  subtotal: D.float(s?.subtotal),
  taxAmount: D.float(s?.taxAmount),
  shippingAmount: D.float(s?.shippingAmount),
  total: D.float(s?.total),
  commissionRate: D.float(s?.commissionRate),
  commission: D.float(s?.commission),
  platformFee: D.float(s?.platformFee),
  vendorEarning: D.float(s?.vendorEarning),
  trackingNumber: D.str(s?.trackingNumber),
  deliveryBoyId: D.str(s?.deliveryBoyId),
  cancelReason: D.str(s?.cancelReason),
  createdAt: D.date(s?.createdAt),

  vendorData: s?.vendor
    ? {
        vendorId: D.str(s.vendor.id),
        shopName: D.str(s.vendor.shopName),
        slug: D.str(s.vendor.slug),
      }
    : {},

  shipmentData:
    Array.isArray(s?.shipments) && s?.shipments?.[0]
      ? {
          shipmentId: D.str(s.shipments[0].id),
          awb: D.str(s.shipments[0].awb),
          status: D.str(s.shipments[0].status),
          trackingUrl: D.str(s.shipments[0].trackingUrl),
          estimatedDays: D.num(s.shipments[0].estimatedDays),
          shippedAt: D.date(s.shipments[0].shippedAt),
          deliveredAt: D.date(s.shipments[0].deliveredAt),
        }
      : {},

  itemList: D.arr(s?.items).map(serializeOrderItem),
});

export const serializeOrder = (o: any) => ({
  orderId: D.str(o?.id),
  orderNumber: D.str(o?.orderNumber),
  userId: D.str(o?.userId),
  status: D.str(o?.status),
  paymentMethod: D.str(o?.paymentMethod),
  paymentStatus: D.str(o?.paymentStatus),
  currency: D.str(o?.currency),
  subtotal: D.float(o?.subtotal),
  discount: D.float(o?.discount),
  couponDiscount: D.float(o?.couponDiscount),
  taxAmount: D.float(o?.taxAmount),
  shippingAmount: D.float(o?.shippingAmount),
  walletAmount: D.float(o?.walletAmount),
  total: D.float(o?.total),
  tokenRequired: D.bool(o?.tokenRequired),
  tokenAmount: D.float(o?.tokenAmount),
  tokenPaid: D.bool(o?.tokenPaid),
  balanceAmount: D.float(o?.balanceAmount),
  balanceDueDays: D.num(o?.balanceDueDays),
  balancePaid: D.bool(o?.balancePaid),
  notes: D.str(o?.notes),
  cancelReason: D.str(o?.cancelReason),
  isCancelled: D.bool(o?.isCancelled),
  deliveredAt: D.date(o?.deliveredAt),
  createdAt: D.date(o?.createdAt),
  updatedAt: D.date(o?.updatedAt),

  userData: o?.user
    ? {
        userId: D.str(o.user.id),
        name: D.str(o.user.name),
        email: D.str(o.user.email),
        phone: D.str(o.user.phone),
      }
    : {},

  addressData: o?.address
    ? {
        addressId: D.str(o.address.id),
        fullName: D.str(o.address.fullName),
        phone: D.str(o.address.phone),
        line1: D.str(o.address.line1),
        line2: D.str(o.address.line2),
        landmark: D.str(o.address.landmark),
        deliveryInstructions: D.str(o.address.deliveryInstructions),
        city: D.str(o.address.city),
        state: D.str(o.address.state),
        country: D.str(o.address.country),
        pincode: D.str(o.address.pincode),
      }
    : {},

  paymentData:
    Array.isArray(o?.payments) && o?.payments?.[0]
      ? {
          paymentId: D.str(o.payments[0].id),
          method: D.str(o.payments[0].method),
          status: D.str(o.payments[0].status),
          amount: D.float(o.payments[0].amount),
          paidAmount: D.float(o.payments[0].paidAmount),
          reference: D.str(o.payments[0].reference),
          paidAt: D.date(o.payments[0].paidAt),
        }
      : {},

  itemList: D.arr(o?.items).map(serializeOrderItem),
  subOrderList: D.arr(o?.subOrders).map(serializeSubOrder),
  tagList: D.arr(o?.tags).map((t: any) => serializeOrderTag(t)),
});

export const serializeOrderTimeline = (t: any) => ({
  timelineId: D.str(t?.id),
  orderId: D.str(t?.orderId),
  subOrderId: D.str(t?.subOrderId),
  status: D.str(t?.status),
  fromStatus: D.str(t?.fromStatus),
  remark: D.str(t?.remark),
  location: D.str(t?.location),
  createdAt: D.date(t?.createdAt),
});

export const serializeOrderTag = (t: any) => ({
  tagId: D.str(t?.id),
  label: D.str(t?.label),
  color: D.str(t?.color),
  createdAt: D.date(t?.createdAt),
});

export const serializeOrderTagList = (rows: any[]) => ({
  tagList: D.arr(rows).map(serializeOrderTag),
});

export const serializeOrderNote = (n: any) => ({
  noteId: D.str(n?.id),
  orderId: D.str(n?.orderId),
  userId: D.str(n?.userId),
  note: D.str(n?.note),
  createdAt: D.date(n?.createdAt),
});

export const serializeOrderNoteList = (rows: any[]) => ({
  noteList: D.arr(rows).map(serializeOrderNote),
});

export const serializeTicketNote = (n: any) => ({
  noteId: D.str(n?.id),
  ticketId: D.str(n?.ticketId),
  userId: D.str(n?.userId),
  note: D.str(n?.note),
  createdAt: D.date(n?.createdAt),
});

export const serializeTicketNoteList = (rows: any[]) => ({
  noteList: D.arr(rows).map(serializeTicketNote),
});

export const serializeCustomerNote = (n: any) => ({
  noteId: D.str(n?.id),
  userId: D.str(n?.userId),
  note: D.str(n?.note),
  createdBy: D.str(n?.createdById),
  createdAt: D.date(n?.createdAt),
});

export const serializeCustomerNoteList = (rows: any[]) => ({
  noteList: D.arr(rows).map(serializeCustomerNote),
});

export const serializeTimelineEvent = (e: any) => ({
  timelineId: D.str(e?.id),
  type: D.str(e?.type),
  title: D.str(e?.title),
  referenceNo: D.str(e?.referenceNo),
  status: D.str(e?.status),
  amount: D.float(e?.amount),
  isActive: D.bool(e?.isActive),
  occurredAt: D.date(e?.occurredAt),

  metaData: D.obj(e?.meta),
});

export const serializeTimelineList = (rows: any[]) => ({
  timelineList: D.arr(rows).map(serializeTimelineEvent),
});

export const serializeCannedResponse = (c: any) => ({
  responseId: D.str(c?.id),
  title: D.str(c?.title),
  body: D.str(c?.body),
  isActive: D.bool(c?.isActive),
  createdBy: D.str(c?.createdBy),
  createdAt: D.date(c?.createdAt),
  updatedAt: D.date(c?.updatedAt),
});

export const serializeCannedResponseList = (rows: any[]) => ({
  responseList: D.arr(rows).map(serializeCannedResponse),
});

export const serializePayment = (p: any) => ({
  paymentId: D.str(p?.id),
  orderId: D.str(p?.orderId),
  userId: D.str(p?.userId),
  amount: D.float(p?.amount),
  paidAmount: D.float(p?.paidAmount),
  method: D.str(p?.method),
  status: D.str(p?.status),
  reference: D.str(p?.reference),
  providerRef: D.str(p?.providerRef),
  isTokenPayment: D.bool(p?.isTokenPayment),
  isBalancePayment: D.bool(p?.isBalancePayment),
  collectedBy: D.str(p?.collectedBy),
  failureReason: D.str(p?.failureReason),
  paidAt: D.date(p?.paidAt),
  createdAt: D.date(p?.createdAt),

  orderData: p?.order
    ? {
        orderId: D.str(p.order.id),
        orderNumber: D.str(p.order.orderNumber),
        status: D.str(p.order.status),
        total: D.float(p.order.total),
      }
    : {},

  userData: p?.user
    ? { userId: D.str(p.user.id), name: D.str(p.user.name), email: D.str(p.user.email) }
    : {},

  refundList: D.arr(p?.refunds).map((r: any) => ({
    refundId: D.str(r?.id),
    amount: D.float(r?.amount),
    status: D.str(r?.status),
    reason: D.str(r?.reason),
    providerRef: D.str(r?.providerRef),
    processedAt: D.date(r?.processedAt),
    createdAt: D.date(r?.createdAt),
  })),
});

export const serializeRefund = (r: any) => ({
  refundId: D.str(r?.id),
  paymentId: D.str(r?.paymentId),
  orderId: D.str(r?.orderId),
  amount: D.float(r?.amount),
  reason: D.str(r?.reason),
  status: D.str(r?.status),
  providerRef: D.str(r?.providerRef),
  isInitiatedBy: D.str(r?.isInitiatedBy),
  processedBy: D.str(r?.processedBy),
  processedAt: D.date(r?.processedAt),
  createdAt: D.date(r?.createdAt),
});

export const serializePayout = (p: any) => ({
  payoutId: D.str(p?.id),
  vendorId: D.str(p?.vendorId),
  amount: D.float(p?.amount),
  method: D.str(p?.method),
  accountRef: D.str(p?.accountRef),
  status: D.str(p?.status),
  period: D.str(p?.period),
  reference: D.str(p?.reference),
  notes: D.str(p?.notes),
  rejectReason: D.str(p?.rejectReason),
  approvedAt: D.date(p?.approvedAt),
  processedAt: D.date(p?.processedAt),
  createdAt: D.date(p?.createdAt),

  vendorData: p?.vendor
    ? {
        vendorId: D.str(p.vendor.id),
        shopName: D.str(p.vendor.shopName),
        slug: D.str(p.vendor.slug),
        bankHolderName: D.str(p.vendor.bankHolderName),
        bankIfsc: D.str(p.vendor.bankIfsc),
        upiId: D.str(p.vendor.upiId),
      }
    : {},
});

export const serializeVendorEarning = (e: any) => ({
  earningId: D.str(e?.id),
  vendorId: D.str(e?.vendorId),
  subOrderId: D.str(e?.subOrderId),
  orderId: D.str(e?.orderId),
  amount: D.float(e?.amount),
  commission: D.float(e?.commission),
  platformFee: D.float(e?.platformFee),
  netAmount: D.float(e?.netAmount),
  status: D.str(e?.status),
  period: D.str(e?.period),
  isAvailable: D.bool(e?.isAvailable),
  availableAt: D.date(e?.availableAt),
  createdAt: D.date(e?.createdAt),
});

export const serializeReturnReason = (r: any) => ({
  reasonId: D.str(r?.id),
  title: D.str(r?.title),
  slug: D.str(r?.slug),
  isActive: D.bool(r?.isActive),
  sortOrder: D.num(r?.sortOrder),
});

export const serializeReturnRequest = (r: any) => ({
  returnId: D.str(r?.id),
  returnNumber: D.str(r?.returnNumber),
  orderId: D.str(r?.orderId),
  subOrderId: D.str(r?.subOrderId),
  vendorId: D.str(r?.vendorId),
  userId: D.str(r?.userId),
  status: D.str(r?.status),
  reasonText: D.str(r?.reasonText),
  comment: D.str(r?.comment),
  images: D.strArr(r?.images),
  refundAmount: D.float(r?.refundAmount),
  refundMode: D.str(r?.refundMode),
  rejectReason: D.str(r?.rejectReason),
  requestedAt: D.date(r?.requestedAt),
  pickedUpAt: D.date(r?.pickedUpAt),
  receivedAt: D.date(r?.receivedAt),
  refundedAt: D.date(r?.refundedAt),
  createdAt: D.date(r?.createdAt),

  reasonData: r?.reason
    ? { reasonId: D.str(r.reason.id), title: D.str(r.reason.title), slug: D.str(r.reason.slug) }
    : {},

  vendorData: r?.vendor ? { vendorId: D.str(r.vendor.id), shopName: D.str(r.vendor.shopName) } : {},

  orderData: r?.order
    ? {
        orderId: D.str(r.order.id),
        orderNumber: D.str(r.order.orderNumber),
        total: D.float(r.order.total),
      }
    : {},

  itemList: D.arr(r?.items).map((i: any) => ({
    returnItemId: D.str(i?.id),
    orderItemId: D.str(i?.orderItemId),
    qty: D.num(i?.qty),
    refundAmount: D.float(i?.refundAmount),
    isApproved: D.bool(i?.isApproved),

    productData: i?.orderItem
      ? {
          productId: D.str(i.orderItem.productId),
          name: D.str(i.orderItem.name),
          sku: D.str(i.orderItem.sku),
          image: D.str(i.orderItem.image),
          price: D.float(i.orderItem.price),
        }
      : {},
  })),
});

export const serializeReview = (r: any) => ({
  reviewId: D.str(r?.id),
  productId: D.str(r?.productId),
  userId: D.str(r?.userId),
  vendorId: D.str(r?.vendorId),
  orderItemId: D.str(r?.orderItemId),
  rating: D.num(r?.rating),
  title: D.str(r?.title),
  comment: D.str(r?.comment),
  images: D.strArr(r?.images),
  isVerified: D.bool(r?.isVerified),
  isHelpful: D.num(r?.isHelpful),
  status: D.str(r?.status),
  vendorReply: D.str(r?.vendorReply),
  repliedAt: D.date(r?.repliedAt),
  createdAt: D.date(r?.createdAt),

  userData: r?.user ? { userId: D.str(r.user.id), name: D.str(r.user.name) } : {},
  productData: r?.product
    ? {
        productId: D.str(r.product.id),
        name: D.str(r.product.name),
        slug: D.str(r.product.slug),
        imageList: D.arr(r.product.images)
          .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
          .map((i: any) => D.str(i?.url)),
      }
    : {},
});

export const serializeQuestion = (q: any) => ({
  questionId: D.str(q?.id),
  productId: D.str(q?.productId),
  userId: D.str(q?.userId),
  vendorId: D.str(q?.vendorId),
  question: D.str(q?.question),
  isApproved: D.bool(q?.isApproved),
  isAnonymous: D.bool(q?.isAnonymous),
  createdAt: D.date(q?.createdAt),

  userData:
    q?.user && !q?.isAnonymous ? { userId: D.str(q.user.id), name: D.str(q.user.name) } : {},

  answerList: D.arr(q?.answers)
    .filter((a: any) => D.bool(a?.isApproved))
    .map((a: any) => ({
      answerId: D.str(a?.id),
      answer: D.str(a?.answer),
      createdAt: D.date(a?.createdAt),
      userData: a?.user ? { userId: D.str(a.user.id), name: D.str(a.user.name) } : {},
    })),
});

export const serializeCoupon = (c: any) => ({
  couponId: D.str(c?.id),
  code: D.str(c?.code),
  title: D.str(c?.title),
  description: D.str(c?.description),
  type: D.str(c?.type),
  value: D.float(c?.value),
  maxDiscount: D.float(c?.maxDiscount),
  minOrderAmount: D.float(c?.minOrderAmount),
  maxUsage: D.num(c?.maxUsage),
  maxUsagePerUser: D.num(c?.maxUsagePerUser),
  usedCount: D.num(c?.usedCount),
  vendorId: D.str(c?.vendorId),
  productIds: D.strArr(c?.productIds),
  categoryIds: D.strArr(c?.categoryIds),
  startsAt: D.date(c?.startsAt),
  expiresAt: D.date(c?.expiresAt),
  isActive: D.bool(c?.isActive),
  status: D.str(c?.status),
  createdAt: D.date(c?.createdAt),
});

export const serializeFlashSale = (f: any) => ({
  flashSaleId: D.str(f?.id),
  name: D.str(f?.name),
  slug: D.str(f?.slug),
  banner: D.str(f?.banner),
  startsAt: D.date(f?.startsAt),
  endsAt: D.date(f?.endsAt),
  discountType: D.str(f?.discountType),
  discountValue: D.float(f?.discountValue),
  isActive: D.bool(f?.isActive),
  isLive:
    D.bool(f?.isActive) && new Date(f?.startsAt) <= new Date() && new Date(f?.endsAt) >= new Date(),

  itemList: D.arr(f?.items).map((i: any) => ({
    flashSaleItemId: D.str(i?.id),
    productId: D.str(i?.productId),
    salePrice: D.float(i?.salePrice),
    saleStock: D.num(i?.saleStock),
    soldCount: D.num(i?.soldCount),
    isSoldOut: D.bool(i?.isSoldOut),

    productData: i?.product
      ? {
          productId: D.str(i.product.id),
          name: D.str(i.product.name),
          slug: D.str(i.product.slug),
          price: D.float(i.product.price),
          mrpPrice: D.float(i.product.mrpPrice),
          imageList: D.arr(i.product.images)
            .sort((a: any, b: any) => D.num(a?.sortOrder) - D.num(b?.sortOrder))
            .map((img: any) => D.str(img?.url)),
        }
      : {},
  })),
});

export const serializeBanner = (b: any) => ({
  bannerId: D.str(b?.id),
  title: D.str(b?.title),
  slug: D.str(b?.slug),
  image: D.str(b?.image),
  mobileImage: D.str(b?.mobileImage),
  type: D.str(b?.type),
  linkUrl: D.str(b?.linkUrl),
  isActive: D.bool(b?.isActive),
  sortOrder: D.num(b?.sortOrder),
  startsAt: D.date(b?.startsAt),
  endsAt: D.date(b?.endsAt),
  createdAt: D.date(b?.createdAt),
});

export const serializeWalletTransaction = (t: any) => ({
  transactionId: D.str(t?.id),
  type: D.str(t?.type),
  amount: D.float(t?.amount),
  balanceAfter: D.float(t?.balanceAfter),
  orderId: D.str(t?.orderId),
  description: D.str(t?.description),
  status: D.str(t?.status),
  reference: D.str(t?.reference),
  createdAt: D.date(t?.createdAt),
});

export const serializeLoyaltyTransaction = (t: any) => ({
  transactionId: D.str(t?.id),
  type: D.str(t?.type),
  points: D.num(t?.points),
  balanceAfter: D.num(t?.balanceAfter),
  orderId: D.str(t?.orderId),
  description: D.str(t?.description),
  createdAt: D.date(t?.createdAt),
});

export const serializeReferral = (r: any) => ({
  referralId: D.str(r?.id),
  referralCode: D.str(r?.referralCode),
  status: D.str(r?.status),
  referrerReward: D.float(r?.referrerReward),
  refereeReward: D.float(r?.refereeReward),
  completedAt: D.date(r?.completedAt),
  expiresAt: D.date(r?.expiresAt),
  createdAt: D.date(r?.createdAt),

  userData: r?.referee
    ? { userId: D.str(r.referee.id), name: D.str(r.referee.name), email: D.str(r.referee.email) }
    : {},
});

export const serializeGiftCard = (g: any) => ({
  giftCardId: D.str(g?.id),
  code: D.str(g?.code),
  title: D.str(g?.title),
  description: D.str(g?.description),
  value: D.float(g?.value),
  status: D.str(g?.status),
  userId: D.str(g?.userId),
  usedOrderId: D.str(g?.usedOrderId),
  expiresAt: D.date(g?.expiresAt),
  redeemedAt: D.date(g?.redeemedAt),
  createdAt: D.date(g?.createdAt),
});

export const serializeNotification = (n: any) => ({
  notificationId: D.str(n?.id),
  userId: D.str(n?.userId),
  type: D.str(n?.type),
  channel: D.str(n?.channel),
  title: D.str(n?.title),
  body: D.str(n?.body),
  image: D.str(n?.image),
  data: D.obj(n?.data),
  isRead: D.bool(n?.isRead),
  readAt: D.date(n?.readAt),
  createdAt: D.date(n?.createdAt),
});

export const serializeConversation = (c: any) => ({
  conversationId: D.str(c?.id),
  lastMessageAt: D.date(c?.lastMessageAt),
  isActive: D.bool(c?.isActive),
  createdAt: D.date(c?.createdAt),

  lastMessageData:
    Array.isArray(c?.messages) && c?.messages?.[0]
      ? {
          messageId: D.str(c.messages[0].id),
          body: D.str(c.messages[0].body),
          senderId: D.str(c.messages[0].senderId),
          isRead: D.bool(c.messages[0].isRead),
          createdAt: D.date(c.messages[0].createdAt),
        }
      : {},

  participantList: D.arr(c?.participants).map((p: any) => ({
    userId: D.str(p?.userId),
    lastReadAt: D.date(p?.lastReadAt),
    isArchived: D.bool(p?.isArchived),
    userData: p?.user
      ? { userId: D.str(p.user.id), name: D.str(p.user.name), avatarUrl: D.str(p.user.avatarUrl) }
      : {},
    vendorData: p?.vendor
      ? {
          vendorId: D.str(p.vendor.id),
          shopName: D.str(p.vendor.shopName),
          slug: D.str(p.vendor.slug),
        }
      : {},
  })),
});

export const serializeMessage = (m: any) => ({
  messageId: D.str(m?.id),
  conversationId: D.str(m?.conversationId),
  senderId: D.str(m?.senderId),
  body: D.str(m?.body),
  attachments: D.strArr(m?.attachments),
  isRead: D.bool(m?.isRead),
  readAt: D.date(m?.readAt),
  isDeleted: D.bool(m?.isDeleted),
  createdAt: D.date(m?.createdAt),

  senderData: m?.sender
    ? {
        userId: D.str(m.sender.id),
        name: D.str(m.sender.name),
        avatarUrl: D.str(m.sender.avatarUrl),
      }
    : {},
});

export const serializeTicket = (t: any) => ({
  ticketId: D.str(t?.id),
  ticketNumber: D.str(t?.ticketNumber),
  userId: D.str(t?.userId),
  subject: D.str(t?.subject),
  description: D.str(t?.description),
  priority: D.str(t?.priority),
  status: D.str(t?.status),
  assignedToId: D.str(t?.assignedToId),
  attachments: D.strArr(t?.attachments),
  resolvedAt: D.date(t?.resolvedAt),
  closedAt: D.date(t?.closedAt),
  createdAt: D.date(t?.createdAt),
  updatedAt: D.date(t?.updatedAt),

  userData: t?.user
    ? { userId: D.str(t.user.id), name: D.str(t.user.name), email: D.str(t.user.email) }
    : {},
  categoryData: t?.category
    ? { categoryId: D.str(t.category.id), name: D.str(t.category.name) }
    : {},

  messageList: D.arr(t?.messages).map((m: any) => ({
    messageId: D.str(m?.id),
    message: D.str(m?.message),
    isInternal: D.bool(m?.isInternal),
    createdAt: D.date(m?.createdAt),
    userData: m?.user ? { userId: D.str(m.user.id), name: D.str(m.user.name) } : {},
  })),
});

export const serializeTicketCategory = (c: any) => ({
  categoryId: D.str(c?.id),
  name: D.str(c?.name),
  slug: D.str(c?.slug),
  isActive: D.bool(c?.isActive),
  sortOrder: D.num(c?.sortOrder),
});

export const serializePage = (p: any) => ({
  pageId: D.str(p?.id),
  title: D.str(p?.title),
  slug: D.str(p?.slug),
  content: D.str(p?.content),
  image: D.str(p?.image),
  isPublished: D.bool(p?.isPublished),
  metaTitle: D.str(p?.metaTitle),
  metaDescription: D.str(p?.metaDescription),
  createdAt: D.date(p?.createdAt),
  updatedAt: D.date(p?.updatedAt),
});

export const serializeBlog = (b: any) => ({
  blogId: D.str(b?.id),
  title: D.str(b?.title),
  slug: D.str(b?.slug),
  excerpt: D.str(b?.excerpt),
  content: D.str(b?.content),
  coverImage: D.str(b?.coverImage),
  authorId: D.str(b?.authorId),
  tags: D.strArr(b?.tags),
  isPublished: D.bool(b?.isPublished),
  publishedAt: D.date(b?.publishedAt),
  createdAt: D.date(b?.createdAt),
});

export const serializeFaq = (f: any) => ({
  faqId: D.str(f?.id),
  question: D.str(f?.question),
  answer: D.str(f?.answer),
  category: D.str(f?.category),
  sortOrder: D.num(f?.sortOrder),
  isActive: D.bool(f?.isActive),
  createdAt: D.date(f?.createdAt),
});

export const serializeContactSubmission = (c: any) => ({
  contactId: D.str(c?.id),
  name: D.str(c?.name),
  email: D.str(c?.email),
  phone: D.str(c?.phone),
  subject: D.str(c?.subject),
  message: D.str(c?.message),
  isRead: D.bool(c?.isRead),
  createdAt: D.date(c?.createdAt),
});

export const serializeNewsletterSubscriber = (s: any) => ({
  subscriberId: D.str(s?.id),
  email: D.str(s?.email),
  isActive: D.bool(s?.isActive),
  isSubscribed: D.bool(s?.isSubscribed),
  unsubscribedAt: D.date(s?.unsubscribedAt),
  createdAt: D.date(s?.createdAt),
});

export const serializeSystemSetting = (s: any) => ({
  settingId: D.str(s?.id),
  key: D.str(s?.key),
  value: D.json(s?.value),
  category: D.str(s?.category),
  isPublic: D.bool(s?.isPublic),
  updatedBy: D.str(s?.updatedBy),
  updatedAt: D.date(s?.updatedAt),
});

export const serializeAuditLog = (a: any) => ({
  auditLogId: D.str(a?.id),
  actorId: D.str(a?.actorId),
  actorRole: D.str(a?.actorRole),
  action: D.str(a?.action),
  entity: D.str(a?.entity),
  entityId: D.str(a?.entityId),
  description: D.str(a?.description),
  changes: D.obj(a?.changes),
  meta: D.obj(a?.meta),
  ip: D.str(a?.ip),
  userAgent: D.str(a?.userAgent),
  createdAt: D.date(a?.createdAt),

  actorData: a?.actor
    ? { userId: D.str(a.actor.id), name: D.str(a.actor.name), email: D.str(a.actor.email) }
    : {},
});

export const serializeActivityLog = (a: any) => ({
  activityLogId: D.str(a?.id),
  userId: D.str(a?.userId),
  action: D.str(a?.action),
  entity: D.str(a?.entity),
  entityId: D.str(a?.entityId),
  meta: D.obj(a?.meta),
  ip: D.str(a?.ip),
  deviceId: D.str(a?.deviceId),
  createdAt: D.date(a?.createdAt),

  userData: a?.user
    ? { userId: D.str(a.user.id), name: D.str(a.user.name), email: D.str(a.user.email) }
    : {},
});

export const serializeDevice = (d: any) => ({
  deviceId: D.str(d?.deviceId),
  recordId: D.str(d?.id),
  userId: D.str(d?.userId),
  platform: D.str(d?.platform),
  os: D.str(d?.os),
  osVersion: D.str(d?.osVersion),
  browser: D.str(d?.browser),
  browserVersion: D.str(d?.browserVersion),
  model: D.str(d?.model),
  manufacturer: D.str(d?.manufacturer),
  appVersion: D.str(d?.appVersion),
  locale: D.str(d?.locale),
  timezone: D.str(d?.timezone),
  ip: D.str(d?.ip),
  isBlocked: D.bool(d?.isBlocked),
  isTrusted: D.bool(d?.isTrusted),
  lastSeenAt: D.date(d?.lastSeenAt),
  createdAt: D.date(d?.createdAt),
});

export const serializeApiKey = (k: any) => ({
  apiKeyId: D.str(k?.id),
  name: D.str(k?.name),
  key: D.str(k?.key),
  prefix: D.str(k?.prefix),
  scopes: D.strArr(k?.scopes),
  isActive: D.bool(k?.isActive),
  usageCount: D.num(k?.usageCount),
  lastUsedAt: D.date(k?.lastUsedAt),
  expiresAt: D.date(k?.expiresAt),
  createdAt: D.date(k?.createdAt),
});

export const serializeWebhookEndpoint = (w: any) => ({
  webhookId: D.str(w?.id),
  url: D.str(w?.url),
  events: D.strArr(w?.events),
  provider: D.str(w?.provider),
  isActive: D.bool(w?.isActive),
  failureCount: D.num(w?.failureCount),
  lastFiredAt: D.date(w?.lastFiredAt),
  createdAt: D.date(w?.createdAt),
});

export const serializeWebhookLog = (l: any) => ({
  webhookLogId: D.str(l?.id),
  endpointId: D.str(l?.endpointId),
  direction: D.str(l?.direction),
  provider: D.str(l?.provider),
  event: D.str(l?.event),
  eventId: D.str(l?.eventId),
  payload: D.json(l?.payload),
  statusCode: D.num(l?.statusCode),
  isProcessed: D.bool(l?.isProcessed),
  error: D.str(l?.error),
  durationMs: D.num(l?.durationMs),
  createdAt: D.date(l?.createdAt),
});

export const serializeTranslation = (t: any) => ({
  translationId: D.str(t?.id),
  locale: D.str(t?.locale),
  key: D.str(t?.key),
  value: D.str(t?.value),
  namespace: D.str(t?.namespace),
  updatedAt: D.date(t?.updatedAt),
});

export const serializeCurrency = (c: any) => ({
  currencyId: D.str(c?.id),
  code: D.str(c?.code),
  name: D.str(c?.name),
  symbol: D.str(c?.symbol),
  decimals: D.num(c?.decimals),
  rate: D.float(c?.rate),
  isDefault: D.bool(c?.isDefault),
  isActive: D.bool(c?.isActive),
  createdAt: D.date(c?.createdAt),
});

export const serializeTaxConfig = (t: any) => ({
  taxConfigId: D.str(t?.id),
  name: D.str(t?.name),
  slug: D.str(t?.slug),
  percent: D.float(t?.percent),
  cgstPercent: D.float(t?.cgstPercent),
  sgstPercent: D.float(t?.sgstPercent),
  igstPercent: D.float(t?.igstPercent),
  isInclusive: D.bool(t?.isInclusive),
  vendorId: D.str(t?.vendorId),
  stateCode: D.str(t?.stateCode),
  isActive: D.bool(t?.isActive),
  createdAt: D.date(t?.createdAt),
});

export const serializeCountry = (c: any) => ({
  countryId: D.str(c?.code),
  code: D.str(c?.code),
  name: D.str(c?.name),
  dialCode: D.str(c?.dialCode),
  currency: D.str(c?.currency),
  isActive: D.bool(c?.isActive),

  stateList: D.arr(c?.states).map((s: any) => ({
    stateId: D.str(s?.code),
    code: D.str(s?.code),
    name: D.str(s?.name),
    isActive: D.bool(s?.isActive),
  })),
});

export const serializeState = (s: any) => ({
  stateId: D.str(s?.code),
  code: D.str(s?.code),
  name: D.str(s?.name),
  countryCode: D.str(s?.countryCode),
  isActive: D.bool(s?.isActive),

  cityCount: D.num(s?._count?.cities),

  ...(Array.isArray(s?.cities)
    ? {
        cityList: s.cities.map((c: any) => ({
          cityId: D.str(c?.id),
          name: D.str(c?.name),
          pincode: D.str(c?.pincode),
          isServiceable: D.bool(c?.isServiceable),
          isActive: D.bool(c?.isActive),
        })),
      }
    : {}),
});

export const serializeShippingZone = (z: any) => ({
  zoneId: D.str(z?.id),
  name: D.str(z?.name),
  countries: D.strArr(z?.countries),
  states: D.strArr(z?.states),
  pincodes: D.strArr(z?.pincodes),
  isActive: D.bool(z?.isActive),
  createdAt: D.date(z?.createdAt),

  methodList: D.arr(z?.methods).map((m: any) => ({
    methodId: D.str(m?.id),
    name: D.str(m?.name),
    code: D.str(m?.code),
    isActive: D.bool(m?.isActive),
  })),
});

export const serializeShippingMethod = (m: any) => ({
  methodId: D.str(m?.id),
  zoneId: D.str(m?.zoneId),
  zoneData: m?.zone ? { zoneId: D.str(m.zone.id), name: D.str(m.zone.name) } : {},
  name: D.str(m?.name),
  code: D.str(m?.code),
  description: D.str(m?.description),
  baseCharge: D.float(m?.baseCharge),
  perKgCharge: D.float(m?.perKgCharge),
  freeAbove: D.float(m?.freeAbove),
  minDays: D.num(m?.minDays),
  maxDays: D.num(m?.maxDays),
  isCodAllowed: D.bool(m?.isCodAllowed),
  isActive: D.bool(m?.isActive),
  createdAt: D.date(m?.createdAt),
});

export const serializeShippingPartner = (p: any) => ({
  partnerId: D.str(p?.id),
  name: D.str(p?.name),
  code: D.str(p?.code),
  apiUrl: D.str(p?.apiUrl),
  isActive: D.bool(p?.isActive),
  createdAt: D.date(p?.createdAt),
});

export const serializeShipment = (s: any) => ({
  shipmentId: D.str(s?.id),
  subOrderId: D.str(s?.subOrderId),
  orderId: D.str(s?.orderId),
  awb: D.str(s?.awb),
  trackingUrl: D.str(s?.trackingUrl),
  status: D.str(s?.status),
  weight: D.float(s?.weight),
  charge: D.float(s?.charge),
  estimatedDays: D.num(s?.estimatedDays),
  shippedAt: D.date(s?.shippedAt),
  deliveredAt: D.date(s?.deliveredAt),
  remarks: D.str(s?.remarks),
  createdAt: D.date(s?.createdAt),

  methodData: s?.method
    ? { methodId: D.str(s.method.id), name: D.str(s.method.name), code: D.str(s.method.code) }
    : {},
  partnerData: s?.partner ? { partnerId: D.str(s.partner.id), name: D.str(s.partner.name) } : {},

  pickupAddress: D.obj(s?.pickupAddress),
  deliveryAddress: D.obj(s?.deliveryAddress),

  deliveryList: D.arr(s?.deliveries).map((d: any) => ({
    deliveryId: D.str(d?.id),
    status: D.str(d?.status),
    remarks: D.str(d?.remarks),
    deliveredAt: D.date(d?.deliveredAt),
    deliveryBoyData: d?.deliveryBoy
      ? {
          deliveryBoyId: D.str(d.deliveryBoy.id),
          name: D.str(d.deliveryBoy.name),
          phone: D.str(d.deliveryBoy.phone),
        }
      : {},
  })),
});

export const serializeDeliveryBoy = (d: any) => ({
  deliveryBoyId: D.str(d?.id),
  userId: D.str(d?.userId),
  name: D.str(d?.name),
  phone: D.str(d?.phone),
  email: D.str(d?.email),
  vehicleType: D.str(d?.vehicleType),
  vehicleNo: D.str(d?.vehicleNo),
  isActive: D.bool(d?.isActive),
  currentLoad: D.num(d?.currentLoad),
  totalDelivered: D.num(d?.totalDelivered),
  rating: D.float(d?.rating),
  createdAt: D.date(d?.createdAt),
});

export const serializeDelivery = (d: any) => ({
  deliveryId: D.str(d?.id),
  shipmentId: D.str(d?.shipmentId),
  subOrderId: D.str(d?.subOrderId),
  deliveryBoyId: D.str(d?.deliveryBoyId),
  status: D.str(d?.status),
  remarks: D.str(d?.remarks),
  deliveredAt: D.date(d?.deliveredAt),
  createdAt: D.date(d?.createdAt),

  subOrderData: d?.subOrder
    ? {
        subOrderId: D.str(d.subOrder.id),
        orderId: D.str(d.subOrder.orderId),
        status: D.str(d.subOrder.status),
        trackingNumber: D.str(d.subOrder.trackingNumber),
        orderData: d.subOrder.order
          ? {
              orderNumber: D.str(d.subOrder.order.orderNumber),
              total: D.float(d.subOrder.order.total),
            }
          : {},
      }
    : {},
});

export const serializeBulkJob = (j: any) => ({
  jobId: D.str(j?.jobId),
  bulkJobId: D.str(j?.id),
  type: D.str(j?.type),
  fileName: D.str(j?.fileName),
  fileUrl: D.str(j?.fileUrl),
  totalRows: D.num(j?.totalRows),
  successCount: D.num(j?.successCount),
  failCount: D.num(j?.failCount),
  errors: D.arr(j?.errors),
  status: D.str(j?.status),
  vendorId: D.str(j?.vendorId),
  startedAt: D.date(j?.startedAt),
  completedAt: D.date(j?.completedAt),
  createdAt: D.date(j?.createdAt),
});

export const serializeFailedJob = (f: any) => ({
  failedJobId: D.str(f?.id),
  queue: D.str(f?.queue),
  jobName: D.str(f?.jobName),
  sourceJobId: D.str(f?.jobId),
  status: D.str(f?.status),
  error: D.str(f?.error),
  attemptsMade: D.num(f?.attemptsMade),
  replayCount: D.num(f?.replayCount),
  resolvedBy: D.str(f?.resolvedBy),
  lastErrorAt: D.date(f?.lastErrorAt),
  replayedAt: D.date(f?.replayedAt),
  resolvedAt: D.date(f?.resolvedAt),
  createdAt: D.date(f?.createdAt),

  payloadData: D.obj(f?.payload),
});

export const serializeFailedJobList = (rows: any[]) => ({
  failedJobList: D.arr(rows).map(serializeFailedJob),
});

export const serializeReportSchedule = (r: any) => ({
  scheduleId: D.str(r?.id),
  name: D.str(r?.name),
  reportType: D.str(r?.reportType),
  cron: D.str(r?.cron),
  recipients: D.strArr(r?.recipients),
  format: D.str(r?.format),
  isActive: D.bool(r?.isActive),
  lastRunAt: D.date(r?.lastRunAt),
  nextRunAt: D.date(r?.nextRunAt),
  createdAt: D.date(r?.createdAt),
});

export const serializeSearchLog = (s: any) => ({
  searchLogId: D.str(s?.id),
  term: D.str(s?.term),
  resultCount: D.num(s?.resultCount),
  hasResults: D.bool(s?.hasResults),
  filters: D.obj(s?.filters),
  createdAt: D.date(s?.createdAt),
});

export const listOf = <T>(items: T[], key: string): Record<string, T[]> => ({
  [key]: D.arr(items),
});
