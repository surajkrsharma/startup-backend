import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { AppError } from '../../utils/AppError';
import { ERROR } from '../../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../../constants/http';
import { requireRole, requireVendor } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/rbac.middleware';
import { PERMISSION } from '../../constants/permissions';
import { getUploadedFiles } from '../../middlewares/upload.middleware';
import * as service from './vendor.service';
import * as schema from './vendor.schema';
import {
  serializeVendor,
  serializeVendorList,
  serializeVendorPublic,
  serializeVendorStats,
  serializePayoutHistoryList,
  serializeKycDocumentList,
  serializeRatingSummary,
} from './vendor.serializer';
import { serializeProductSummary, serializeProductList } from '../../utils/serialize';

const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  own: [requireRole('VENDOR')],
  ownApproved: [
    requireRole('VENDOR'),
    asyncHandler(async (req, _res, next) => {
      await service.requireApprovedVendor(req.auth!.vendorId);
      next();
    }),
  ],
  adminList: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_LIST),
  ],
  adminView: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_VIEW),
  ],
  adminApprove: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_APPROVE),
  ],
  adminReject: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_REJECT),
  ],
  adminSuspend: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_SUSPEND),
  ],
  adminCommission: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_COMMISSION_UPDATE),
  ],
  adminKyc: [
    requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN),
    requirePermission(PERMISSION.VENDOR_KYC_VERIFY),
  ],
};

export const getProfile = asyncHandler(async (req, res) => {
  const vendor = await service.getOwnProfile(vendorId(req));
  if (!vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND, ERROR_CODE.NOT_FOUND);

  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeVendor(vendor),
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const vendor = await service.updateProfile(vendorId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.PROFILE_UPDATED,
    result: serializeVendor(vendor),
  });
});

/**
 * @openapi
 * /vendors/updateBankDetails/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Update payout bank details — a vendor may only edit its own shop
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bankHolderName: { type: string, maxLength: 100, example: Ramesh Sharma }
 *               bankAccountNo: { type: string, maxLength: 30, example: '4111111111111111' }
 *               bankIfsc: { type: string, maxLength: 15, example: HDFC0001234 }
 *               upiId: { type: string, maxLength: 100, example: ramesh@upi }
 *     responses:
 *       200: { description: Bank details updated }
 *       400: { description: No usable payout destination }
 *       401: { description: Not signed in }
 *       403: { description: Not the owning vendor }
 */
export const updateBankDetails = asyncHandler(async (req, res) => {
  if (req.params.id !== vendorId(req)) {
    throw AppError.forbidden(ERROR.COMMON.FORBIDDEN, ERROR_CODE.FORBIDDEN);
  }

  const vendor = await service.updateBankDetails(vendorId(req), req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.BANK_UPDATED,
    result: {
      vendorId: D.str(vendor.id),
      bankHolderName: D.str(vendor.bankHolderName),
      bankAccountNo: D.str(vendor.bankAccountNo),
      bankIfsc: D.str(vendor.bankIfsc),
      upiId: D.str(vendor.upiId),
    },
  });
});

export const getStats = asyncHandler(async (req, res) => {
  const stats = await service.getStats(vendorId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.STATS_FETCHED,
    result: serializeVendorStats(stats),
  });
});

export const requestPayout = asyncHandler(async (req, res) => {
  const payout = await service.requestPayout(vendorId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PAYOUT.REQUESTED, {
    payoutId: payout.payoutId,
    amount: payout.amount,
    status: payout.status,
    method: payout.method,
    period: payout.period,
  });
});

export const getPayoutHistory = asyncHandler(async (req, res) => {
  const { rows, total } = await service.getPayoutHistory(vendorId(req), req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.VENDOR.PAYOUT_HISTORY_FETCHED,
    result: {
      filterData: { status: D.str(req.query?.['status'] as string) },
      ...serializePayoutHistoryList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const uploadDocuments = asyncHandler(async (req, res) => {
  const files = getUploadedFiles(req);
  const rows = await service.uploadDocuments(
    vendorId(req),
    files,
    { docType: D.str(req.body?.docType) || 'OTHER', number: D.str(req.body?.number) },
    req,
  );

  return ApiResponse.created(res, SUCCESS.VENDOR.DOCUMENTS_UPLOADED, {
    documentList: rows.map((doc: any) => ({
      documentId: D.str(doc.id),
      docType: D.str(doc.docType),
      fileUrl: D.str(doc.fileUrl),
      number: D.str(doc.number),
      isVerified: D.bool(doc.isVerified),
      createdAt: D.date(doc.createdAt),
    })),
  });
});

/**
 * @openapi
 * /vendors/getRatings/{id}:
 *   get:
 *     tags: [Vendors]
 *     summary: Rating breakdown for a shop
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: Average rating plus the per-star distribution }
 *       401: { description: Not signed in }
 *       404: { description: No such vendor }
 */
export const getRatings = asyncHandler(async (req, res) => {
  const { limit } = getPagination({ limit: req.query?.limit });
  const summary = await service.getRatings(req.params.id, limit);

  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.RATINGS_FETCHED,
    result: serializeRatingSummary(summary),
  });
});

/**
 * @openapi
 * /vendors/getProducts/{id}:
 *   get:
 *     tags: [Vendors]
 *     summary: Paginated products of a shop — only an approved shop is listed
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *       - { name: page, in: query, required: false, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { name: search, in: query, required: false, schema: { type: string, maxLength: 120 }, example: shirt }
 *       - { name: sort, in: query, required: false, schema: { type: string, maxLength: 40 }, example: -createdAt }
 *     responses:
 *       200: { description: Products, with the pagination numbers first }
 *       401: { description: Not signed in }
 *       403: { description: The shop is not approved }
 *       404: { description: No such vendor }
 */
export const getProducts = asyncHandler(async (req, res) => {
  const vendor = await service.getVendorById(req.params.id);
  if (vendor.status !== 'APPROVED') {
    throw new AppError(
      ERROR.VENDOR.NOT_APPROVED,
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODE.VENDOR_NOT_APPROVED,
    );
  }

  const { rows, total } = await service.getVendorProducts(req.params.id, req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.VENDOR.PRODUCTS_FETCHED,
    result: {
      filterData: {
        search: D.str(req.query?.['search'] as string),
        status: D.str(req.query?.['status'] as string),
      },
      vendorData: serializeVendorPublic(vendor),
      ...serializeProductList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const getAll = asyncHandler(async (req, res) => {
  const { rows, total, filters } = await service.listVendors(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: {
      filterData: {
        search: D.str(filters.search),
        status: D.str(filters.status),
        hasDocuments: D.bool(filters.hasDocuments),
      },
      ...serializeVendorList(rows),
    },
    totalRecord: total,
    currentPage: filters.page || page,
    limit,
  });
});

export const getById = asyncHandler(async (req, res) => {
  const vendor = await service.getVendorById(req.params.id);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeVendor(vendor),
  });
});

/**
 * @openapi
 * /vendors/approveVendor/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Approve a pending vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               commissionRate: { type: number, minimum: 0, maximum: 100, example: 10 }
 *               payoutCycleDays: { type: integer, minimum: 1, maximum: 90, example: 7 }
 *     responses:
 *       200: { description: Approved }
 *       401: { description: Not signed in }
 *       403: { description: Admin only }
 *       404: { description: No such vendor }
 */
export const approveVendor = asyncHandler(async (req, res) => {
  const vendor = await service.approveVendor(req.params.id, req.body ?? {}, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.APPROVED,
    result: serializeVendor(vendor),
  });
});

/**
 * @openapi
 * /vendors/suspendVendor/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Suspend an approved vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 500, example: Repeated policy violations }
 *     responses:
 *       200: { description: Suspended }
 *       401: { description: Not signed in }
 *       403: { description: Admin only }
 *       404: { description: No such vendor }
 */
/**
 * @openapi
 * /vendors/rejectVendor/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Reject a pending vendor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 500, example: GST documents unreadable }
 *     responses:
 *       200: { description: Rejected }
 *       401: { description: Not signed in }
 *       403: { description: Admin only }
 *       404: { description: No such vendor }
 */
export const rejectVendor = asyncHandler(async (req, res) => {
  const vendor = await service.rejectVendor(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.REJECTED,
    result: serializeVendor(vendor),
  });
});

export const suspendVendor = asyncHandler(async (req, res) => {
  const vendor = await service.suspendVendor(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.SUSPENDED,
    result: serializeVendor(vendor),
  });
});

export const updateCommission = asyncHandler(async (req, res) => {
  const vendor = await service.updateCommission(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.COMMISSION_UPDATED,
    result: { vendorId: D.str(vendor.id), commissionRate: D.float(vendor.commissionRate) },
  });
});

export const getDocuments = asyncHandler(async (req, res) => {
  const { rows, total } = await service.getDocuments(req.query);
  const { page, limit } = getPagination(req.query);

  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: {
      filterData: {
        isVerified: D.str(req.query?.['isVerified'] as string),
        docType: D.str(req.query?.['docType'] as string),
        search: D.str(req.query?.['search'] as string),
      },
      ...serializeKycDocumentList(rows),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

export const verifyDocuments = asyncHandler(async (req, res) => {
  const doc = await service.verifyDocument(req.params.id, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.VENDOR.DOCUMENTS_VERIFIED,
    result: {
      documentId: D.str(doc.id),
      vendorId: D.str(doc.vendorId),
      docType: D.str(doc.docType),
      isVerified: D.bool(doc.isVerified),
      remark: D.str(doc.remark),
      verifiedAt: D.date(doc.verifiedAt),
      vendorData: doc.vendor
        ? {
            vendorId: D.str(doc.vendor.id),
            shopName: D.str(doc.vendor.shopName),
            slug: D.str(doc.vendor.slug),
          }
        : {},
    },
  });
});

export { serializeProductSummary, requireVendor, schema };
