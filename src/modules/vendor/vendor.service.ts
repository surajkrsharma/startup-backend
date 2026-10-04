import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import {
  ADMIN_ACTION,
  PAYOUT_STATUS,
  PRODUCT_STATUS,
  VENDOR_STATUS,
  VendorStatus,
} from '../../constants/roles';
import { ORDER_STATUS } from '../../constants/statuses';
import { getPagination } from '../../utils/pagination';
import { uniqueVendorSlug } from '../../utils/slug';
import { diffChanges, writeActivityLog, writeAuditLog } from '../../services/audit.service';
import { uploadToCloudinary } from '../../services/cloudinary.service';
import {
  getCommissionBounds,
  getCommissionDefault,
  getVendorAutoApprove,
  getVendorMaxProducts,
  getMinPayoutAmount,
  getVendorPayoutHoldDays,
} from '../../services/settings.service';
import { deleteTempFiles } from '../../middlewares/upload.middleware';
import { addDays, toDayKey } from '../../utils/dates';
import { ListVendorFilters, KycUpload, PayoutRequestResult } from './vendor.types';

const VENDOR_SELECT = {
  id: true,
  userId: true,
  shopName: true,
  slug: true,
  description: true,
  logo: true,
  banner: true,
  gstNumber: true,
  panNumber: true,
  status: true,
  commissionRate: true,
  payoutCycleDays: true,
  bankHolderName: true,
  bankAccountNo: true,
  bankIfsc: true,
  upiId: true,
  rating: true,
  ratingCount: true,
  totalSales: true,
  pendingAmount: true,
  isDocumentsSubmitted: true,
  documentsVerifiedAt: true,
  approvedAt: true,
  rejectedReason: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

const VENDOR_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
  kycDocuments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.VendorProfileInclude;

export const requireOwnVendor = async (vendorId: string): Promise<any> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: VENDOR_SELECT,
  });

  if (!vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  return vendor;
};

const requireVendorRecord = async (vendorId: string): Promise<any> => {
  const vendor = await requireOwnVendor(vendorId);
  if (vendor.deletedAt) {
    throw AppError.notFound(ERROR.VENDOR.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
  return vendor;
};

export const requireApprovedVendor = async (vendorId: string): Promise<any> => {
  const vendor = await requireVendorRecord(vendorId);
  if (vendor.status !== VENDOR_STATUS.APPROVED) {
    throw new AppError(ERROR.VENDOR.NOT_APPROVED, 403, ERROR_CODE.VENDOR_NOT_APPROVED);
  }
  return vendor;
};

export const getOwnProfile = async (vendorId: string): Promise<any> =>
  prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      ...VENDOR_SELECT,
      ...VENDOR_INCLUDE,
      _count: { select: { products: true, subOrders: true, reviews: true, kycDocuments: true } },
    },
  });

export const getVendorById = async (vendorId: string): Promise<any> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      ...VENDOR_SELECT,
      ...VENDOR_INCLUDE,
      _count: { select: { products: true, subOrders: true, reviews: true, kycDocuments: true } },
    },
  });

  if (!vendor || vendor.deletedAt) {
    throw AppError.notFound(ERROR.VENDOR.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }
  return vendor;
};

export const updateProfile = async (
  vendorId: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const before = await requireVendorRecord(vendorId);

  const data: Prisma.VendorProfileUpdateInput = {};

  if (input.shopName !== undefined) data.shopName = D.str(input.shopName);
  if (input.description !== undefined) data.description = D.str(input.description);
  if (input.logo !== undefined) data.logo = D.str(input.logo);
  if (input.banner !== undefined) data.banner = D.str(input.banner);
  if (input.gstNumber !== undefined) data.gstNumber = D.str(input.gstNumber).toUpperCase();
  if (input.panNumber !== undefined) data.panNumber = D.str(input.panNumber).toUpperCase();
  if (input.payoutCycleDays !== undefined) data.payoutCycleDays = Number(input.payoutCycleDays);

  if (input.slug !== undefined && D.str(input.slug) !== '') {
    const taken = await prisma.vendorProfile.findFirst({
      where: { slug: D.str(input.slug), NOT: { id: vendorId } },
      select: { id: true },
    });
    if (taken) {
      throw AppError.conflict(ERROR.COMMON.DUPLICATE, ERROR_CODE.DUPLICATE);
    }
    data.slug = D.str(input.slug);
  }

  if (!Object.keys(data).length) {
    throw AppError.badRequest(ERROR.COMMON.VALIDATION_FAILED, ERROR_CODE.VALIDATION_ERROR);
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data,
    select: { ...VENDOR_SELECT, ...VENDOR_INCLUDE },
  });

  void writeActivityLog({
    req,
    userId: before.userId,
    action: 'VENDOR_PROFILE_UPDATED',
    entity: 'VendorProfile',
    entityId: vendorId,
    meta: { fields: Object.keys(data) },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: `Vendor updated profile: ${updated.shopName}`,
    changes: diffChanges(before, updated),
  });

  return updated;
};

export const updateBankDetails = async (
  vendorId: string,
  input: { bankHolderName?: string; bankAccountNo?: string; bankIfsc?: string; upiId?: string },
  req?: any,
): Promise<any> => {
  await requireVendorRecord(vendorId);

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      bankHolderName: D.str(input.bankHolderName),
      bankAccountNo: D.str(input.bankAccountNo),
      bankIfsc: D.str(input.bankIfsc).toUpperCase(),
      upiId: D.str(input.upiId),
    },
    select: VENDOR_SELECT,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: 'Vendor updated bank/UPI details',
    meta: {
      hasBank: Boolean(updated.bankAccountNo && updated.bankIfsc),
      hasUpi: Boolean(updated.upiId),
      accountNoLast4: updated.bankAccountNo.slice(-4),
    },
  });

  return updated;
};

export const listVendors = async (
  query: any,
  onlyApproved = false,
): Promise<{ rows: any[]; total: number; filters: ListVendorFilters }> => {
  const { page, limit, skip } = getPagination(query);

  const filters: ListVendorFilters = {
    page,
    limit,
    skip,
    search: D.str(query?.search),
    status:
      (onlyApproved
        ? VENDOR_STATUS.APPROVED
        : (D.str(query?.status) as VendorStatus | 'all' | '')) || '',
    hasDocuments: query?.hasDocuments === true,
  };

  const where: Prisma.VendorProfileWhereInput = {
    deletedAt: null,
    ...(filters.status && filters.status !== 'all'
      ? { status: filters.status as VendorStatus }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { shopName: { contains: filters.search, mode: 'insensitive' } },
            { slug: { contains: filters.search, mode: 'insensitive' } },
            { gstNumber: { contains: filters.search, mode: 'insensitive' } },
            { user: { is: { email: { contains: filters.search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(filters.hasDocuments ? { isDocumentsSubmitted: true } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.vendorProfile.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ createdAt: 'desc' }],
      select: {
        ...VENDOR_SELECT,
        user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
        _count: { select: { products: true, subOrders: true, reviews: true, kycDocuments: true } },
      },
    }),
    prisma.vendorProfile.count({ where }),
  ]);

  return { rows, total, filters };
};

export const approveVendor = async (
  vendorId: string,
  input: { commissionRate?: number; remark?: string },
  req?: any,
): Promise<any> => {
  const before = await getVendorById(vendorId);

  if (before.status === VENDOR_STATUS.APPROVED) {
    throw AppError.conflict(ERROR.VENDOR.ALREADY_APPROVED, ERROR_CODE.DUPLICATE);
  }

  let commissionRate = before.commissionRate;

  if (input?.commissionRate !== undefined) {
    const { min, max } = await getCommissionBounds();
    if (input.commissionRate < min || input.commissionRate > max) {
      throw AppError.unprocessable(
        `Commission must be between ${min}% and ${max}%.`,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }
    commissionRate = input.commissionRate;
  } else {
    commissionRate = await getCommissionDefault();
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      status: VENDOR_STATUS.APPROVED,
      approvedAt: new Date(),
      rejectedReason: '',
      commissionRate,
    },
    select: { ...VENDOR_SELECT, ...VENDOR_INCLUDE },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.APPROVE,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: `Approved vendor ${updated.shopName} at ${commissionRate}% commission`,
    changes: {
      status: { from: before.status, to: updated.status },
      commissionRate: { from: before.commissionRate, to: commissionRate },
    },
  });

  return updated;
};

export const rejectVendor = async (
  vendorId: string,
  input: { reason: string },
  req?: any,
): Promise<any> => {
  const before = await getVendorById(vendorId);

  if (before.status === VENDOR_STATUS.REJECTED) {
    throw AppError.conflict(ERROR.VENDOR.ALREADY_REJECTED, ERROR_CODE.DUPLICATE);
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      status: VENDOR_STATUS.REJECTED,
      rejectedReason: D.str(input.reason),
    },
    select: { ...VENDOR_SELECT, ...VENDOR_INCLUDE },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.REJECT,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: `Rejected vendor ${updated.shopName}: ${D.str(input.reason)}`,
    changes: { status: { from: before.status, to: updated.status } },
  });

  return updated;
};

export const suspendVendor = async (
  vendorId: string,
  input: { reason: string },
  req?: any,
): Promise<any> => {
  const before = await getVendorById(vendorId);

  if (before.status === VENDOR_STATUS.SUSPENDED) {
    throw AppError.conflict('Vendor is already suspended.', ERROR_CODE.DUPLICATE);
  }

  const openSubOrders = await prisma.subOrder.count({
    where: {
      vendorId,
      status: {
        in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.OUT_FOR_DELIVERY],
      },
    },
  });

  if (openSubOrders > 0) {
    throw AppError.unprocessable(
      `Cannot suspend: ${openSubOrders} order(s) are still in progress.`,
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      status: VENDOR_STATUS.SUSPENDED,
      rejectedReason: D.str(input.reason),
    },
    select: { ...VENDOR_SELECT, ...VENDOR_INCLUDE },
  });

  await prisma.product.updateMany({
    where: { vendorId, deletedAt: null },
    data: { status: PRODUCT_STATUS.INACTIVE },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.SUSPEND,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: `Suspended vendor ${updated.shopName}: ${D.str(input.reason)}`,
    changes: { status: { from: before.status, to: updated.status } },
  });

  return updated;
};

export const updateCommission = async (
  vendorId: string,
  input: { commissionRate: number },
  req?: any,
): Promise<any> => {
  const before = await getVendorById(vendorId);

  const { min, max } = await getCommissionBounds();

  if (input.commissionRate < min || input.commissionRate > max) {
    throw AppError.unprocessable(
      `Commission must be between ${min}% and ${max}%.`,
      ERROR_CODE.VALIDATION_ERROR,
    );
  }

  const updated = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { commissionRate: input.commissionRate },
    select: VENDOR_SELECT,
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.UPDATE,
    entity: 'VendorProfile',
    entityId: vendorId,
    description: `Commission changed ${before.commissionRate}% -> ${input.commissionRate}%`,
    changes: { commissionRate: { from: before.commissionRate, to: input.commissionRate } },
  });

  return updated;
};

export const uploadDocuments = async (
  vendorId: string,
  files: Express.Multer.File[],
  meta: { docType: string; number?: string },
  req?: any,
): Promise<any[]> => {
  await requireVendorRecord(vendorId);

  if (!files.length) {
    throw AppError.badRequest(ERROR.UPLOAD.FILE_REQUIRED, ERROR_CODE.FILE_REQUIRED);
  }

  const uploaded: KycUpload[] = [];

  try {
    for (const file of files) {
      const asset = await uploadToCloudinary(file.path, `kyc/${meta.docType.toLowerCase()}`);
      uploaded.push({
        docType: D.str(meta.docType),
        number: D.str(meta.number),
        fileUrl: asset.url,
        publicId: asset.publicId,
      });
    }
  } finally {
    await deleteTempFiles(files);
  }

  const rows = await prisma.$transaction(
    uploaded.map((doc) =>
      prisma.kycDocument.create({
        data: {
          vendorId,
          docType: doc.docType,
          fileUrl: doc.fileUrl,
          number: doc.number,
        },
      }),
    ),
  );

  await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { isDocumentsSubmitted: true },
  });

  void writeAuditLog({
    req,
    action: ADMIN_ACTION.CREATE,
    entity: 'KycDocument',
    entityId: vendorId,
    description: `Vendor uploaded ${rows.length} KYC document(s)`,
    meta: { docTypes: uploaded.map((u) => u.docType) },
  });

  return rows;
};

export const getDocuments = async (
  query: any,
  vendorId?: string,
): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);

  const where: Prisma.KycDocumentWhereInput = {
    ...(vendorId ? { vendorId } : {}),
    ...(query?.isVerified === true || query?.isVerified === 'true' ? { isVerified: true } : {}),
    ...(query?.isVerified === false || query?.isVerified === 'false' ? { isVerified: false } : {}),
    ...(D.str(query?.docType) ? { docType: D.str(query.docType) } : {}),
    ...(D.str(query?.search)
      ? {
          OR: [
            { number: { contains: D.str(query.search), mode: 'insensitive' } },
            {
              vendor: { is: { shopName: { contains: D.str(query.search), mode: 'insensitive' } } },
            },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.kycDocument.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        vendorId: true,
        docType: true,
        fileUrl: true,
        number: true,
        isVerified: true,
        verifiedBy: true,
        verifiedAt: true,
        remark: true,
        createdAt: true,
        vendor: { select: { id: true, shopName: true, slug: true, status: true } },
      },
    }),
    prisma.kycDocument.count({ where }),
  ]);

  return { rows, total };
};

export const verifyDocument = async (
  documentId: string,
  input: { isVerified: boolean; remark?: string },
  req?: any,
): Promise<any> => {
  const doc = await prisma.kycDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw AppError.notFound(ERROR.COMMON.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const updated = await prisma.kycDocument.update({
    where: { id: documentId },
    data: {
      isVerified: input.isVerified,
      remark: D.str(input.remark),
      verifiedBy: D.str(req?.auth?.userId),
      verifiedAt: input.isVerified ? new Date() : null,
    },
    select: {
      id: true,
      vendorId: true,
      docType: true,
      fileUrl: true,
      number: true,
      isVerified: true,
      remark: true,
      verifiedAt: true,
      createdAt: true,
      vendor: { select: { id: true, shopName: true, slug: true, status: true } },
    },
  });

  void writeAuditLog({
    req,
    action: input.isVerified ? ADMIN_ACTION.APPROVE : ADMIN_ACTION.REJECT,
    entity: 'KycDocument',
    entityId: documentId,
    description: `${input.isVerified ? 'Verified' : 'Rejected'} ${updated.docType} for ${updated.vendor?.shopName ?? ''}`,
    meta: { remark: D.str(input.remark) },
  });

  return updated;
};

export const getStats = async (vendorId: string): Promise<any> => {
  await requireVendorRecord(vendorId);

  const [
    productCount,
    activeProductCount,
    outOfStockCount,
    subOrderCount,
    deliveredCount,
    revenue,
    earnings,
    payouts,
    pending,
    reviewCount,
    vendor,
    returnCount,
  ] = await Promise.all([
    prisma.product.count({ where: { vendorId, deletedAt: null } }),
    prisma.product.count({
      where: { vendorId, deletedAt: null, status: PRODUCT_STATUS.ACTIVE },
    }),
    prisma.product.count({
      where: { vendorId, deletedAt: null, stock: { lte: 0 } },
    }),
    prisma.subOrder.count({ where: { vendorId } }),
    prisma.subOrder.count({ where: { vendorId, status: ORDER_STATUS.DELIVERED } }),
    prisma.subOrder.aggregate({
      where: { vendorId, status: { in: [ORDER_STATUS.DELIVERED, ORDER_STATUS.SHIPPED] } },
      _sum: { total: true },
    }),
    prisma.vendorEarning.aggregate({
      where: { vendorId },
      _sum: { amount: true, commission: true, platformFee: true, netAmount: true },
    }),
    prisma.payout.aggregate({
      where: { vendorId, status: PAYOUT_STATUS.PAID },
      _sum: { amount: true },
    }),
    prisma.vendorEarning.aggregate({
      where: { vendorId, status: PAYOUT_STATUS.PENDING },
      _sum: { netAmount: true },
    }),
    prisma.review.count({ where: { vendorId } }),
    prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { rating: true, ratingCount: true },
    }),
    prisma.returnRequest.count({
      where: { vendorId, status: { notIn: ['REJECTED', 'REFUNDED'] } },
    }),
  ]);

  return {
    productCount,
    activeProductCount,
    outOfStockCount,
    subOrderCount,
    deliveredCount,
    totalRevenue: money(revenue._sum.total ?? 0),
    totalEarnings: money(earnings._sum.amount ?? 0),
    commissionPaid: money((earnings._sum.commission ?? 0) + (earnings._sum.platformFee ?? 0)),
    pendingAmount: money(pending._sum.netAmount ?? 0),
    paidOutAmount: money(payouts._sum.amount ?? 0),
    reviewCount,
    rating: vendor?.rating ?? 0,
    returnCount,
  };
};

export const getRatings = async (
  vendorId: string,
  limit = 20,
): Promise<{ average: number; total: number; breakdown: any[]; reviews: any[] }> => {
  const vendor = await getVendorById(vendorId);

  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { vendorId, status: 'APPROVED' },
    _count: { _all: true },
  });

  const breakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: grouped.find((g) => g.rating === star)?._count._all ?? 0,
  }));

  const reviews = await prisma.review.findMany({
    where: { vendorId, status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      rating: true,
      title: true,
      comment: true,
      images: true,
      isVerified: true,
      vendorReply: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, slug: true } },
    },
  });

  return {
    average: vendor.rating,
    total: vendor.ratingCount,
    breakdown,
    reviews,
  };
};

export const getVendorProducts = async (
  vendorId: string,
  query: any,
): Promise<{ rows: any[]; total: number }> => {
  const { limit, skip } = getPagination(query);

  const where: Prisma.ProductWhereInput = {
    vendorId,
    deletedAt: null,
    ...(D.str(query?.status) ? { status: D.str(query.status) as any } : {}),
    ...(D.str(query?.search)
      ? {
          OR: [
            { name: { contains: D.str(query.search), mode: 'insensitive' } },
            { sku: { contains: D.str(query.search), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        price: true,
        mrpPrice: true,
        stock: true,
        status: true,
        isFeatured: true,
        soldCount: true,
        viewCount: true,
        rating: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
        images: { select: { url: true, sortOrder: true } },
        _count: { select: { reviews: true, variants: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return { rows, total };
};

export const getEarnings = async (vendorId: string, query: any): Promise<any> => {
  await requireVendorRecord(vendorId);
  const { limit } = getPagination(query);

  const [breakdown, totals, pending, paidOut, lastPayout] = await Promise.all([
    prisma.vendorEarning.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        subOrderId: true,
        orderId: true,
        amount: true,
        commission: true,
        platformFee: true,
        netAmount: true,
        status: true,
        period: true,
        isAvailable: true,
        availableAt: true,
        createdAt: true,
      },
    }),
    prisma.vendorEarning.aggregate({
      where: { vendorId },
      _sum: { amount: true, commission: true, platformFee: true, netAmount: true },
    }),
    prisma.vendorEarning.aggregate({
      where: { vendorId, status: PAYOUT_STATUS.PENDING },
      _sum: { netAmount: true },
    }),
    prisma.payout.aggregate({
      where: { vendorId, status: PAYOUT_STATUS.PAID },
      _sum: { amount: true },
    }),
    prisma.payout.findFirst({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      select: { processedAt: true, approvedAt: true, createdAt: true },
    }),
  ]);

  return {
    breakdown,
    grossEarnings: money(totals._sum.amount ?? 0),
    commission: money(totals._sum.commission ?? 0),
    platformFee: money(totals._sum.platformFee ?? 0),
    netEarnings: money(totals._sum.netAmount ?? 0),
    pendingAmount: money(pending._sum.netAmount ?? 0),
    paidOutAmount: money(paidOut._sum.amount ?? 0),
    lastPayoutAt:
      lastPayout?.processedAt ?? lastPayout?.approvedAt ?? lastPayout?.createdAt ?? null,
  };
};

export const getPendingAmount = async (vendorId: string): Promise<number> => {
  await requireVendorRecord(vendorId);

  const pending = await prisma.vendorEarning.aggregate({
    where: { vendorId, status: PAYOUT_STATUS.PENDING },
    _sum: { netAmount: true },
  });

  return money(pending._sum.netAmount ?? 0);
};

export const getPayoutHistory = async (
  vendorId: string,
  query: any,
): Promise<{ rows: any[]; total: number }> => {
  await requireVendorRecord(vendorId);
  const { limit, skip } = getPagination(query);

  const where: Prisma.PayoutWhereInput = {
    vendorId,
    ...(D.str(query?.status) ? { status: D.str(query.status) as PayoutStatusName } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        vendorId: true,
        amount: true,
        method: true,
        status: true,
        period: true,
        reference: true,
        notes: true,
        rejectReason: true,
        approvedAt: true,
        processedAt: true,
        createdAt: true,
      },
    }),
    prisma.payout.count({ where }),
  ]);

  return { rows, total };
};

type PayoutStatusName = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'PAID' | 'FAILED';

export const requestPayout = async (
  vendorId: string,
  input: { amount: number; method: string; notes?: string },
  req?: any,
): Promise<PayoutRequestResult> => {
  const vendor = await requireVendorRecord(vendorId);

  if (vendor.status !== VENDOR_STATUS.APPROVED) {
    throw new AppError(ERROR.VENDOR.NOT_APPROVED, 403, ERROR_CODE.VENDOR_NOT_APPROVED);
  }

  const hasBank = Boolean(D.str(vendor.bankAccountNo) && D.str(vendor.bankIfsc));
  const hasUpi = Boolean(D.str(vendor.upiId));

  if (!hasBank && !hasUpi) {
    throw AppError.badRequest(ERROR.PAYOUT.BANK_DETAILS_REQUIRED, ERROR_CODE.VALIDATION_ERROR);
  }

  if (input.method === 'BANK' && !hasBank) {
    throw AppError.badRequest(ERROR.PAYOUT.BANK_DETAILS_REQUIRED, ERROR_CODE.VALIDATION_ERROR);
  }
  if (input.method === 'UPI' && !hasUpi) {
    throw AppError.badRequest(ERROR.PAYOUT.BANK_DETAILS_REQUIRED, ERROR_CODE.VALIDATION_ERROR);
  }

  const minAmount = await getMinPayoutAmount();
  if (input.amount < minAmount) {
    throw AppError.unprocessable(
      `Payout must be at least ₹${minAmount}.`,
      ERROR_CODE.PAYOUT_MIN_AMOUNT,
    );
  }

  const holdDays = await getVendorPayoutHoldDays();
  const cutoff = toDayKey(addDays(-holdDays));

  const claimable = await prisma.vendorEarning.findMany({
    where: {
      vendorId,
      status: PAYOUT_STATUS.PENDING,
      isAvailable: true,
      availableAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, netAmount: true, period: true },
  });

  const available = money(claimable.reduce((sum, row) => sum + row.netAmount, 0));

  if (available <= 0) {
    throw AppError.unprocessable(
      'No earnings have cleared the payout hold period yet.',
      ERROR_CODE.PENDING_ORDERS,
    );
  }

  if (input.amount > available) {
    throw AppError.unprocessable(
      `Only ₹${available} is available to withdraw.`,
      ERROR_CODE.PAYOUT_MIN_AMOUNT,
    );
  }

  let remaining = money(input.amount);
  const consumeIds: string[] = [];
  const periods = new Set<string>();

  for (const row of claimable) {
    if (remaining <= 0) break;
    consumeIds.push(row.id);
    if (row.period) periods.add(row.period);
    remaining = money(remaining - row.netAmount);
  }

  if (consumeIds.length === 0) {
    throw AppError.unprocessable(
      'No earnings have cleared the payout hold period yet.',
      ERROR_CODE.PENDING_ORDERS,
    );
  }

  const period =
    D.str([...periods].sort().at(-1)) || toDayKey(new Date()).toISOString().slice(0, 10);

  const payout = await prisma.$transaction(async (tx) => {
    const created = await tx.payout.create({
      data: {
        vendorId,
        amount: input.amount,
        method: input.method,
        status: PAYOUT_STATUS.PENDING,
        period,
        notes: D.str(input.notes),
        requestedBy: D.str(req?.auth?.userId),
        accountRef:
          input.method === 'UPI'
            ? D.str(vendor.upiId)
            : `****${D.str(vendor.bankAccountNo).slice(-4)}`,
      },
      select: { id: true, amount: true, status: true, method: true, period: true },
    });

    await tx.vendorEarning.updateMany({
      where: { id: { in: consumeIds } },
      data: { status: PAYOUT_STATUS.APPROVED, period },
    });

    return created;
  });

  void writeActivityLog({
    req,
    userId: vendor.userId,
    action: 'PAYOUT_REQUESTED',
    entity: 'Payout',
    entityId: payout.id,
    meta: { amount: payout.amount, method: payout.method },
  });

  return {
    payoutId: payout.id,
    amount: payout.amount,
    status: payout.status,
    method: payout.method,
    period: payout.period,
  };
};

export const getMaxProducts = async (): Promise<number> => getVendorMaxProducts();

export const isAutoApproveOn = async (): Promise<boolean> => getVendorAutoApprove();

export const regenerateSlug = async (shopName: string): Promise<string> =>
  uniqueVendorSlug(shopName);
