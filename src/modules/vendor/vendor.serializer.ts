import { D } from '../../utils/defaults';
import { serializeUser } from '../../utils/serialize';

/**
 * Vendor serializers.
 * Key order: singles -> objects -> arrays. No nulls anywhere.
 */
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

  userData: v?.user
    ? {
        userId: D.str(v.user.id),
        name: D.str(v.user.name),
        email: D.str(v.user.email),
        phone: D.str(v.user.phone),
        isActive: D.bool(v.user.isActive),
      }
    : {},

  bankData: {
    bankHolderName: D.str(v?.bankHolderName),
    bankAccountNo: D.str(v?.bankAccountNo),
    bankIfsc: D.str(v?.bankIfsc),
    upiId: D.str(v?.upiId),
    hasBankDetails: Boolean(D.str(v?.bankAccountNo) && D.str(v?.bankIfsc)),
    hasUpi: Boolean(D.str(v?.upiId)),
  },

  documentList: D.arr(v?.kycDocuments).map((d: any) => ({
    documentId: D.str(d?.id),
    docType: D.str(d?.docType),
    fileUrl: D.str(d?.fileUrl),
    number: D.str(d?.number),
    isVerified: D.bool(d?.isVerified),
    remark: D.str(d?.remark),
    verifiedAt: D.date(d?.verifiedAt),
    createdAt: D.date(d?.createdAt),
  })),

  statsData: v?._count
    ? {
        productCount: D.num(v._count.products),
        subOrderCount: D.num(v._count.subOrders),
        reviewCount: D.num(v._count.reviews),
      }
    : {},
});

export const serializeVendorList = (rows: any[]) => ({
  vendorList: D.arr(rows).map(serializeVendor),
});

/** Public view — no bank details, no GST number, safe for any visitor. */
export const serializeVendorPublic = (v: any) => ({
  vendorId: D.str(v?.id),
  shopName: D.str(v?.shopName),
  slug: D.str(v?.slug),
  description: D.str(v?.description),
  logo: D.str(v?.logo),
  banner: D.str(v?.banner),
  isApproved: D.str(v?.status) === 'APPROVED',
  rating: D.float(v?.rating),
  ratingCount: D.num(v?.ratingCount),
  totalSales: D.float(v?.totalSales),
  createdAt: D.date(v?.createdAt),

  productCount: D.num(v?._count?.products),
  ratingBreakdownList: D.arr(v?.ratingBreakdown).map((r: any) => ({
    star: D.num(r?.star),
    count: D.num(r?.count),
  })),
});

export const serializeVendorStats = (s: any) => ({
  productCount: D.num(s?.productCount),
  activeProductCount: D.num(s?.activeProductCount),
  outOfStockCount: D.num(s?.outOfStockCount),
  subOrderCount: D.num(s?.subOrderCount),
  deliveredCount: D.num(s?.deliveredCount),
  totalRevenue: D.float(s?.totalRevenue),
  totalEarnings: D.float(s?.totalEarnings),
  commissionPaid: D.float(s?.commissionPaid),
  pendingAmount: D.float(s?.pendingAmount),
  paidOutAmount: D.float(s?.paidOutAmount),
  reviewCount: D.num(s?.reviewCount),
  rating: D.float(s?.rating),
  returnCount: D.num(s?.returnCount),
});

export const serializeVendorEarnings = (e: any) => ({
  grossEarnings: D.float(e?.grossEarnings),
  commission: D.float(e?.commission),
  platformFee: D.float(e?.platformFee),
  netEarnings: D.float(e?.netEarnings),
  pendingAmount: D.float(e?.pendingAmount),
  paidOutAmount: D.float(e?.paidOutAmount),
  lastPayoutAt: D.date(e?.lastPayoutAt),

  breakdownList: D.arr(e?.breakdown).map((row: any) => ({
    earningId: D.str(row?.id),
    orderId: D.str(row?.orderId),
    subOrderId: D.str(row?.subOrderId),
    period: D.str(row?.period),
    amount: D.float(row?.amount),
    commission: D.float(row?.commission),
    platformFee: D.float(row?.platformFee),
    netAmount: D.float(row?.netAmount),
    status: D.str(row?.status),
    isAvailable: D.bool(row?.isAvailable),
    availableAt: D.date(row?.availableAt),
    createdAt: D.date(row?.createdAt),
  })),
});

export const serializePayoutHistory = (p: any) => ({
  payoutId: D.str(p?.id),
  vendorId: D.str(p?.vendorId),
  amount: D.float(p?.amount),
  method: D.str(p?.method),
  status: D.str(p?.status),
  period: D.str(p?.period),
  reference: D.str(p?.reference),
  notes: D.str(p?.notes),
  rejectReason: D.str(p?.rejectReason),
  approvedAt: D.date(p?.approvedAt),
  processedAt: D.date(p?.processedAt),
  createdAt: D.date(p?.createdAt),
});

export const serializePayoutHistoryList = (rows: any[]) => ({
  payoutList: D.arr(rows).map(serializePayoutHistory),
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

export const serializeKycDocumentList = (rows: any[]) => ({
  documentList: D.arr(rows).map(serializeKycDocument),
});

export const serializeRatingSummary = (input: {
  average: number;
  total: number;
  breakdown: { star: number; count: number }[];
  reviews: any[];
}) => ({
  average: D.float(input.average),
  total: D.num(input.total),

  breakdownList: D.arr(input.breakdown).map((r) => ({
    star: D.num(r.star),
    count: D.num(r.count),
    percent: D.float(input.total > 0 ? (r.count / input.total) * 100 : 0),
  })),

  reviewList: D.arr(input.reviews).map(serializeUserReview),
});

const serializeUserReview = (r: any) => ({
  reviewId: D.str(r?.id),
  rating: D.num(r?.rating),
  title: D.str(r?.title),
  comment: D.str(r?.comment),
  images: D.strArr(r?.images),
  isVerified: D.bool(r?.isVerified),
  vendorReply: D.str(r?.vendorReply),
  createdAt: D.date(r?.createdAt),

  userData: r?.user ? { userId: D.str(r.user.id), name: D.str(r.user.name) } : {},
  productData: r?.product
    ? { productId: D.str(r.product.id), name: D.str(r.product.name), slug: D.str(r.product.slug) }
    : {},
});

export { serializeUser };
