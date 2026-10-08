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

/**
 * @openapi
 * /vendors/updateVacation/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Turn own shop vacation mode on or off
 *     description: >
 *       `:id` must equal the caller's own vendorId. `until` must be in the future and
 *       is capped at `vendor.vacationMaxDays` days; turning vacation off clears the end
 *       date but keeps the message.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: clx0000000000000000000000 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isOnVacation]
 *             properties:
 *               isOnVacation: { type: boolean, example: true }
 *               message: { type: string, maxLength: 200, example: Back from vacation on Monday }
 *               until: { type: string, format: date-time, example: '2026-04-01T00:00:00.000Z' }
 *     responses:
 *       200: { description: Vacation mode updated }
 *       400: { description: The vacation end date is not in the future }
 *       401: { description: Not signed in }
 *       403: { description: Not the owning vendor }
 *       404: { description: No such vendor }
 */
router.patch(
  '/updateVacation/:id',
  authenticate,
  ...controller.guards.own,
  validate({ params: schema.vendorIdParamSchema, body: schema.updateVacationSchema }),
  controller.updateVacation,
);

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
 * /vendors/getAnnouncements:
 *   get:
 *     tags: [Vendors]
 *     summary: Own shop announcements, archived ones included
 *     description: Supports `?status=ACTIVE|ARCHIVED` and `?search=`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, required: false, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { name: status, in: query, required: false, schema: { type: string, enum: [ACTIVE, ARCHIVED] } }
 *       - { name: search, in: query, required: false, schema: { type: string, maxLength: 120 }, example: sale }
 *     responses:
 *       200: { description: 'Announcements, with the pagination numbers first' }
 *       401: { description: Not signed in }
 *       403: { description: Caller is not a vendor }
 *       404: { description: No such vendor }
 */
router.get(
  '/getAnnouncements',
  authenticate,
  ...controller.guards.own,
  validate({ query: schema.listAnnouncementsSchema }),
  controller.getAnnouncements,
);

/**
 * @openapi
 * /vendors/createAnnouncement:
 *   post:
 *     tags: [Vendors]
 *     summary: Publish an announcement on own shop
 *     description: Starts ACTIVE and immediately visible on the storefront. `endsAt` must be after `startsAt` when both are given.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string, minLength: 1, maxLength: 200, example: Diwali sale is live }
 *               message: { type: string, maxLength: 2000, example: Flat 20% off this week }
 *               linkUrl: { type: string, maxLength: 500, example: 'https://example.com/sale' }
 *               isPinned: { type: boolean, example: true }
 *               startsAt: { type: string, format: date-time, example: '2026-03-01T00:00:00.000Z' }
 *               endsAt: { type: string, format: date-time, example: '2026-03-08T00:00:00.000Z' }
 *     responses:
 *       201: { description: Announcement created }
 *       400: { description: The body is invalid }
 *       401: { description: Not signed in }
 *       403: { description: Caller is not a vendor }
 *       404: { description: No such vendor }
 */
router.post(
  '/createAnnouncement',
  authenticate,
  ...controller.guards.own,
  validate({ body: schema.createAnnouncementSchema }),
  controller.createAnnouncement,
);

/**
 * @openapi
 * /vendors/updateAnnouncement/{id}:
 *   patch:
 *     tags: [Vendors]
 *     summary: Update one of own shop announcements
 *     description: At least one field is required, and `endsAt` must be after `startsAt` when both are given.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: ann0000000000000000000000 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, minLength: 1, maxLength: 200, example: Diwali sale ends early }
 *               message: { type: string, maxLength: 2000, example: Flat 20% off until Sunday }
 *               linkUrl: { type: string, maxLength: 500, example: 'https://example.com/sale' }
 *               isPinned: { type: boolean, example: false }
 *               status: { type: string, enum: [ACTIVE, ARCHIVED], example: ARCHIVED }
 *               startsAt: { type: string, format: date-time, example: '2026-03-01T00:00:00.000Z' }
 *               endsAt: { type: string, format: date-time, example: '2026-03-08T00:00:00.000Z' }
 *     responses:
 *       200: { description: Announcement updated }
 *       400: { description: The body is empty or invalid }
 *       401: { description: Not signed in }
 *       403: { description: Caller is not a vendor }
 *       404: { description: No such announcement for this shop }
 */
router.patch(
  '/updateAnnouncement/:id',
  authenticate,
  ...controller.guards.own,
  validate({
    params: schema.announcementIdParamSchema,
    body: schema.updateAnnouncementSchema,
  }),
  controller.updateAnnouncement,
);

/**
 * @openapi
 * /vendors/deleteAnnouncement/{id}:
 *   delete:
 *     tags: [Vendors]
 *     summary: Delete one of own shop announcements
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: ann0000000000000000000000 }
 *     responses:
 *       200: { description: Announcement deleted }
 *       401: { description: Not signed in }
 *       403: { description: Caller is not a vendor }
 *       404: { description: No such announcement for this shop }
 */
router.delete(
  '/deleteAnnouncement/:id',
  authenticate,
  ...controller.guards.own,
  validate({ params: schema.announcementIdParamSchema }),
  controller.deleteAnnouncement,
);

/**
 * @openapi
 * /vendors/blockCustomer/{userId}:
 *   post:
 *     tags: [Vendors]
 *     summary: Block a customer from messaging this shop
 *     description: Repeating an existing block updates the reason instead of failing.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: userId, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: usr0000000000000000000000 }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 500, example: Repeated abusive messages }
 *     responses:
 *       200: { description: Customer blocked }
 *       401: { description: Not signed in }
 *       403: { description: 'Caller is not a vendor, or lacks the permission' }
 *       404: { description: No such customer }
 *       422: { description: A vendor cannot block itself }
 */
router.post(
  '/blockCustomer/:userId',
  authenticate,
  ...controller.guards.ownBlock,
  validate({ params: schema.blockedUserIdParamSchema, body: schema.blockCustomerSchema }),
  controller.blockCustomer,
);

/**
 * @openapi
 * /vendors/unblockCustomer/{userId}:
 *   delete:
 *     tags: [Vendors]
 *     summary: Lift this shop's block on a customer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: userId, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 40 }, example: usr0000000000000000000000 }
 *     responses:
 *       200: { description: Customer unblocked }
 *       401: { description: Not signed in }
 *       403: { description: 'Caller is not a vendor, or lacks the permission' }
 *       404: { description: The customer was not blocked by this shop }
 */
router.delete(
  '/unblockCustomer/:userId',
  authenticate,
  ...controller.guards.ownBlock,
  validate({ params: schema.blockedUserIdParamSchema }),
  controller.unblockCustomer,
);

/**
 * @openapi
 * /vendors/getBlockedCustomers:
 *   get:
 *     tags: [Vendors]
 *     summary: Customers this shop has blocked
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, required: false, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *     responses:
 *       200: { description: 'Blocked customers, with the pagination numbers first' }
 *       401: { description: Not signed in }
 *       403: { description: 'Caller is not a vendor, or lacks the permission' }
 *       404: { description: No such vendor }
 */
router.get(
  '/getBlockedCustomers',
  authenticate,
  ...controller.guards.ownBlock,
  validate({ query: paginationSchema }),
  controller.getBlockedCustomers,
);

/**
 * @openapi
 * /vendors/getStore/{slug}:
 *   get:
 *     tags: [Vendors]
 *     summary: Public store page for a shop
 *     description: >
 *       Carries the live announcements and the newest active products, capped at
 *       `vendor.storeProductLimit`. `?limit=` may narrow that further. A shop that is
 *       not approved returns 403.
 *     parameters:
 *       - { name: slug, in: path, required: true, schema: { type: string, minLength: 1, maxLength: 140 }, example: ravi-electronics }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1 }, example: 8 }
 *     responses:
 *       200: { description: 'Store, announcements and products' }
 *       403: { description: The shop is not approved }
 *       404: { description: No shop has this slug }
 */
router.get(
  '/getStore/:slug',
  validate({ params: schema.storeSlugParamSchema }),
  controller.getStore,
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
 *       200: { description: 'Average, star breakdown and approved reviews' }
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

router.patch(
  '/updateCommission/:id',
  authenticate,
  ...controller.guards.adminCommission,
  validate({ params: schema.vendorIdParamSchema, body: schema.updateCommissionSchema }),
  controller.updateCommission,
);

router.get(
  '/getDocuments',
  authenticate,
  ...controller.guards.adminKyc,
  validate({ query: paginationSchema }),
  controller.getDocuments,
);

router.patch(
  '/verifyDocuments/:id',
  authenticate,
  ...controller.guards.adminKyc,
  validate({ params: schema.vendorIdParamSchema, body: schema.verifyDocumentsSchema }),
  controller.verifyDocuments,
);

export default router;
