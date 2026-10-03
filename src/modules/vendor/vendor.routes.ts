import { Router } from 'express';
import { validate, paginationSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import { uploadRateLimit } from '../../middlewares/rateLimit.middleware';
import { uploadFiles } from '../../middlewares/upload.middleware';
import { UPLOAD_KIND } from '../../config/upload.config';
import * as controller from './vendor.controller';
import * as schema from './vendor.schema';

const router = Router();

/**
 * @openapi
 * /vendors/getProfile:
 *   get:
 *     tags: [Vendors]
 *     summary: Own vendor profile with KYC documents and counts
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Vendor profile returned }
 *       403: { description: Caller is not a vendor }
 */
router.get('/getProfile', authenticate, ...controller.guards.own, controller.getProfile);

/**
 * @openapi
 * /vendors/updateProfile:
 *   patch:
 *     tags: [Vendors]
 *     summary: Update own shop details
 *     description: Shop name, description, slug, logo, banner and tax identifiers. Status and commission are admin-only.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/updateProfile',
  authenticate,
  ...controller.guards.own,
  validate({ body: schema.updateProfileSchema }),
  controller.updateProfile,
);

/**
 * @openapi
 * /vendors/updateBankDetails/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Update own bank/UPI payout details
 *     description: >
 *       `:id` must equal the caller's own vendorId. Provide bank account + IFSC,
 *       or a UPI ID. Audited — values are never written to the audit log.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/updateBankDetails/:id',
  authenticate,
  ...controller.guards.own,
  validate({ params: schema.vendorIdParamSchema, body: schema.updateBankDetailsSchema }),
  controller.updateBankDetails,
);

/** GET /vendors/getStats — dashboard counters for the vendor's own shop. */
router.get('/getStats', authenticate, ...controller.guards.own, controller.getStats);

/**
 * @openapi
 * /vendors/requestPayout:
 *   post:
 *     tags: [Vendors]
 *     summary: Request a payout
 *     description: >
 *       Amount must be at least `vendor.minPayoutAmount` and no more than the earnings
 *       that have cleared `vendor.payoutHoldDays`. 422 on minimum, availability or
 *       pending-order violations.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/requestPayout',
  authenticate,
  ...controller.guards.own,
  validate({ body: schema.requestPayoutSchema }),
  controller.requestPayout,
);

/** GET /vendors/getPayoutHistory */
router.get(
  '/getPayoutHistory',
  authenticate,
  ...controller.guards.own,
  validate({ query: paginationSchema }),
  controller.getPayoutHistory,
);

/**
 * @openapi
 * /vendors/uploadDocuments:
 *   post:
 *     tags: [Vendors]
 *     summary: Upload KYC documents (multipart/form-data)
 *     description: >
 *       Fields: `files` (1-5, PDF/JPEG/PNG up to 10MB each), `docType`
 *       (GST|PAN|AADHAAR|BANK_PROOF|ADDRESS_PROOF|OTHER), `number` (optional).
 *       First upload flips `isDocumentsSubmitted`.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/uploadDocuments',
  authenticate,
  uploadRateLimit,
  ...controller.guards.own,
  uploadFiles(UPLOAD_KIND.KYC, 'files'),
  controller.uploadDocuments,
);

/**
 * @openapi
 * /vendors/getRatings/{id}:
 *   get:
 *     tags: [Vendors]
 *     summary: Public rating summary for a vendor
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Average, star breakdown and approved reviews }
 */
router.get(
  '/getRatings/:id',
  optionalAuth,
  validate({ params: schema.vendorIdParamSchema }),
  controller.getRatings,
);

/**
 * @openapi
 * /vendors/getProducts/{id}:
 *   get:
 *     tags: [Vendors]
 *     summary: Public product list for a vendor
 *     description: Returns 403 VENDOR_NOT_APPROVED for a shop that is not approved.
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20 } }
 */
router.get(
  '/getProducts/:id',
  optionalAuth,
  validate({ params: schema.vendorIdParamSchema, query: paginationSchema }),
  controller.getProducts,
);

/**
 * @openapi
 * /vendors/getAll:
 *   get:
 *     tags: [Vendors]
 *     summary: List vendors (admin)
 *     description: Supports `?search=`, `?status=PENDING|APPROVED|REJECTED|SUSPENDED`.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  '/getAll',
  authenticate,
  ...controller.guards.adminList,
  validate({ query: schema.listVendorsSchema }),
  controller.getAll,
);

/** GET /vendors/getById/:id */
router.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.adminView,
  validate({ params: schema.vendorIdParamSchema }),
  controller.getById,
);

/**
 * @openapi
 * /vendors/approveVendor/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Approve a vendor (admin)
 *     description: Optional `commissionRate`, clamped to commission.minPercent/maxPercent.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/approveVendor/:id',
  authenticate,
  ...controller.guards.adminApprove,
  validate({ params: schema.vendorIdParamSchema, body: schema.approveSchema }),
  controller.approveVendor,
);

/** PATCH /vendors/rejectVendor/:id — `reason` is mandatory. */
router.patch(
  '/rejectVendor/:id',
  authenticate,
  ...controller.guards.adminReject,
  validate({ params: schema.vendorIdParamSchema, body: schema.rejectSchema }),
  controller.rejectVendor,
);

/**
 * @openapi
 * /vendors/suspendVendor/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Suspend a vendor (admin)
 *     description: >
 *       Blocked with 422 while any sub-order is still CONFIRMED/SHIPPED/OUT_FOR_DELIVERY.
 *       On success all of the vendor's products are set INACTIVE.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/suspendVendor/:id',
  authenticate,
  ...controller.guards.adminSuspend,
  validate({ params: schema.vendorIdParamSchema, body: schema.suspendSchema }),
  controller.suspendVendor,
);

/** PATCH /vendors/updateCommission/:id — override the default commission rate. */
router.patch(
  '/updateCommission/:id',
  authenticate,
  ...controller.guards.adminCommission,
  validate({ params: schema.vendorIdParamSchema, body: schema.updateCommissionSchema }),
  controller.updateCommission,
);

/** GET /vendors/getDocuments — admin KYC review queue. */
router.get(
  '/getDocuments',
  authenticate,
  ...controller.guards.adminKyc,
  validate({ query: paginationSchema }),
  controller.getDocuments,
);

/** PATCH /vendors/verifyDocuments/:id */
router.patch(
  '/verifyDocuments/:id',
  authenticate,
  ...controller.guards.adminKyc,
  validate({ params: schema.vendorIdParamSchema, body: schema.verifyDocumentsSchema }),
  controller.verifyDocuments,
);

export default router;
