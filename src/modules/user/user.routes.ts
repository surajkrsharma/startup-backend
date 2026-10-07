import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import { exportRateLimit } from '../../middlewares/rateLimit.middleware';
import * as controller from './user.controller';
import * as schema from './user.schema';

const router = Router();

router.use(authenticate);

/**
 * @openapi
 * /users/getProfile:
 *   get:
 *     tags: [Users]
 *     summary: Current user's own profile with vendor data and addresses
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Profile returned }
 *       401: { description: Not logged in }
 */
router.get('/getProfile', controller.getProfile);

/**
 * @openapi
 * /users/updateProfile:
 *   patch:
 *     tags: [Users]
 *     summary: Update own profile
 *     description: >
 *       All fields optional. Changing email or phone resets that verification flag,
 *       and a duplicate value returns 409.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/updateProfile',
  validate({ body: schema.updateProfileSchema }),
  controller.updateProfile,
);

router.patch('/updateAvatar', validate({ body: schema.avatarSchema }), controller.updateAvatar);

/**
 * @openapi
 * /users/deleteAccount:
 *   delete:
 *     tags: [Users]
 *     summary: Soft-delete own account
 *     description: >
 *       Email/phone are released, tokens revoked and deletedAt set, so order history
 *       stays intact and recoverable. Vendors must hand over their shop first.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/deleteAccount',
  validate({ body: schema.deleteAccountSchema }),
  controller.deleteAccount,
);

/**
 * @openapi
 * /users/getAddresses:
 *   get:
 *     tags: [Users]
 *     summary: List own saved addresses
 *     security: [{ bearerAuth: [] }]
 */
router.get('/getAddresses', ...controller.guards.customer, controller.getAddresses);

/**
 * @openapi
 * /users/addAddress:
 *   post:
 *     tags: [Users]
 *     summary: Add a saved address
 *     description: The first address is always stored as the default.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/addAddress',
  ...controller.guards.customer,
  validate({ body: schema.addAddressSchema }),
  controller.addAddress,
);

router.patch(
  '/updateAddress/:id',
  ...controller.guards.customer,
  validate({ params: schema.addressIdParamSchema, body: schema.updateAddressSchema }),
  controller.updateAddress,
);

/**
 * @openapi
 * /users/deleteAddress/:id:
 *   delete:
 *     tags: [Users]
 *     summary: Delete a saved address
 *     description: Refused with 409 when an order already references it.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/deleteAddress/:id',
  ...controller.guards.customer,
  validate({ params: schema.addressIdParamSchema }),
  controller.deleteAddress,
);

router.patch(
  '/setDefaultAddress/:id',
  ...controller.guards.customer,
  validate({ params: schema.addressIdParamSchema }),
  controller.setDefaultAddress,
);

/**
 * @openapi
 * /users/getAll:
 *   get:
 *     tags: [Users]
 *     summary: List users (admin)
 *     description: Supports `?search=`, `?role=`, `?status=active|inactive`, `?vendorStatus=`.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  '/getAll',
  ...controller.guards.adminList,
  validate({ query: schema.listUsersSchema }),
  controller.getAll,
);

router.get(
  '/getById/:id',
  ...controller.guards.adminView,
  validate({ params: schema.getUserByIdSchema }),
  controller.getById,
);

router.patch(
  '/updateUser/:id',
  ...controller.guards.adminUpdate,
  validate({ params: schema.getUserByIdSchema, body: schema.updateUserSchema }),
  controller.updateUser,
);

/**
 * @openapi
 * /users/toggleStatus/:id:
 *   patch:
 *     tags: [Users]
 *     summary: Suspend or reactivate a user
 *     description: Suspending revokes every refresh token and ends active sessions.
 *     security: [{ bearerAuth: [] }]
 */
router.patch(
  '/toggleStatus/:id',
  ...controller.guards.adminSuspend,
  validate({ params: schema.getUserByIdSchema, body: schema.toggleStatusSchema }),
  controller.toggleStatus,
);

/**
 * @openapi
 * /users/deleteUser/:id:
 *   delete:
 *     tags: [Users]
 *     summary: Hard-delete a user (SUPER_ADMIN only)
 *     description: >
 *       Refused with 409 when the user has orders or a vendor profile.
 *       Prefer `toggleStatus` for everyone else.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/deleteUser/:id',
  exportRateLimit,
  ...controller.guards.adminDelete,
  validate({ params: schema.getUserByIdSchema }),
  controller.deleteUser,
);

router.get(
  '/getActivity/:id',
  ...controller.guards.adminView,
  validate({ params: schema.getUserByIdSchema, query: schema.userActivitySchema }),
  controller.getActivity,
);

router.get(
  '/getOrders/:id',
  ...controller.guards.adminView,
  validate({ params: schema.getUserByIdSchema, query: schema.userOrdersSchema }),
  controller.getOrders,
);

/**
 * @openapi
 * /users/impersonate/:id:
 *   post:
 *     tags: [Users]
 *     summary: Issue a short-lived token for another user (SUPER_ADMIN only)
 *     description: >
 *       Returns a token scoped to the target user. A reason is mandatory and every
 *       impersonation — including by SUPER_ADMIN — is written to AuditLog.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/impersonate/:id',
  ...controller.guards.adminImpersonate,
  validate({ params: schema.getUserByIdSchema, body: schema.impersonateSchema }),
  controller.impersonate,
);

/**
 * @openapi
 * /users/addNote/:id:
 *   post:
 *     tags: [Users]
 *     summary: Add an internal note about a customer
 *     description: Admin only. Never exposed to the customer.
 *     security: [{ bearerAuth: [] }]
 */
router.post(
  '/addNote/:id',
  ...controller.guards.adminView,
  validate({ params: schema.getUserByIdSchema, body: schema.addCustomerNoteSchema }),
  controller.addCustomerNote,
);

/**
 * @openapi
 * /users/getNotes/:id:
 *   get:
 *     tags: [Users]
 *     summary: List internal notes for a customer
 *     description: Admin only.
 *     security: [{ bearerAuth: [] }]
 */
router.get(
  '/getNotes/:id',
  ...controller.guards.adminView,
  validate({ params: schema.getUserByIdSchema }),
  controller.getCustomerNotes,
);

/**
 * @openapi
 * /users/removeNote/:id/:noteId:
 *   delete:
 *     tags: [Users]
 *     summary: Remove an internal note from a customer
 *     description: Admin only.
 *     security: [{ bearerAuth: [] }]
 */
router.delete(
  '/removeNote/:id/:noteId',
  ...controller.guards.adminView,
  validate({ params: schema.customerNoteParamSchema }),
  controller.removeCustomerNote,
);

export default router;
