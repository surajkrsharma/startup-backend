import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import {
  registerRateLimit,
  authRateLimit,
  forgotPasswordRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
  passwordResetRateLimit,
  twoFactorRateLimit,
  socialLoginRateLimit,
} from '../../middlewares/rateLimit.middleware';
import * as controller from './auth.controller';
import * as schema from './auth.schema';

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a customer or a vendor
 *     description: >
 *       Single endpoint with a discriminated union on `type`.
 *       CUSTOMER requires identity fields only; VENDOR additionally requires `shopName`.
 *       The `VENDOR` role is assigned here — there is no separate vendor-apply route.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/RegisterCustomerRequest'
 *               - $ref: '#/components/schemas/RegisterVendorRequest'
 *     responses:
 *       201:
 *         description: "Registered. The `Set-Cookie: refreshToken` header is HttpOnly."
 *       400: { description: Validation failed }
 *       409: { description: Email or phone already registered }
 */
router.post(
  '/register',
  registerRateLimit,
  validate({ body: schema.registerSchema }),
  controller.register,
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with password or OTP
 *     description: >
 *       Provide `password` for password login, or `otp` + `type` for OTP login.
 *       When 2FA is enabled the response contains `twoFactorRequired: true` and no tokens.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/LoginRequest' }
 *     responses:
 *       200: { description: Logged in, or 2FA challenge issued }
 *       401: { description: Invalid credentials }
 *       403: { description: Account suspended or locked }
 */
router.post('/login', authRateLimit, validate({ body: schema.loginSchema }), controller.login);

/**
 * @openapi
 * /auth/loginWithOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Login using an OTP sent to the registered phone/email
 */
router.post(
  '/loginWithOtp',
  otpVerifyRateLimit,
  validate({ body: schema.verifyOtpSchema }),
  controller.loginWithOtp,
);

/**
 * @openapi
 * /auth/refreshToken:
 *   post:
 *     tags: [Auth]
 *     summary: Exchange a refresh token for a new access token
 *     description: Token rotation — the presented refresh token is revoked and reissued.
 */
router.post(
  '/refreshToken',
  authRateLimit,
  validate({ body: schema.refreshTokenSchema }),
  controller.refreshToken,
);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and revoke the current refresh token
 *     security: [{ bearerAuth: [] }]
 */
router.post('/logout', authenticate, asyncHandler(controller.logout));

/**
 * @openapi
 * /auth/logoutAllDevices:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke all sessions and refresh tokens for the current user
 *     security: [{ bearerAuth: [] }]
 */
router.post('/logoutAllDevices', authenticate, controller.logoutAllDevices);

/**
 * @openapi
 * /auth/getMe:
 *   get:
 *     tags: [Auth]
 *     summary: Current user profile with roles and vendor data
 *     security: [{ bearerAuth: [] }]
 */
router.get('/getMe', authenticate, controller.getMe);

/**
 * @openapi
 * /auth/sendOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Send an OTP for the given purpose
 *     description: >
 *       `type` is one of REGISTER | FORGOT_PASSWORD | LOGIN | PHONE_VERIFY |
 *       EMAIL_VERIFY | TWO_FA. Resend cooldown is enforced per identifier + type.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/SendOtpRequest' }
 *     responses:
 *       200: { description: OTP dispatched }
 *       429: { description: Resend cooldown or daily cap reached }
 */
router.post(
  '/sendOtp',
  otpSendRateLimit,
  validate({ body: schema.sendOtpSchema }),
  controller.sendOtp,
);

/**
 * @openapi
 * /auth/verifyOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Verify an OTP
 *     description: "Set `isLoginFlow: true` to complete login and receive tokens."
 */
router.post(
  '/verifyOtp',
  otpVerifyRateLimit,
  validate({ body: schema.verifyOtpSchema }),
  controller.verifyOtp,
);

/** POST /auth/forgotPassword */
router.post(
  '/forgotPassword',
  forgotPasswordRateLimit,
  validate({ body: schema.forgotPasswordSchema }),
  controller.forgotPassword,
);

/** POST /auth/resetPassword */
router.post(
  '/resetPassword',
  passwordResetRateLimit,
  validate({ body: schema.resetPasswordSchema }),
  controller.resetPassword,
);

/** POST /auth/changePassword */
router.post(
  '/changePassword',
  authenticate,
  validate({ body: schema.changePasswordSchema }),
  controller.changePassword,
);

/** POST /auth/verifyEmail */
router.post(
  '/verifyEmail',
  authenticate,
  validate({ body: schema.verifyContactSchema }),
  controller.verifyEmail,
);

/** POST /auth/verifyPhone */
router.post(
  '/verifyPhone',
  authenticate,
  validate({ body: schema.verifyContactSchema }),
  controller.verifyPhone,
);

/** POST /auth/enable2FA */
router.post('/enable2FA', authenticate, twoFactorRateLimit, controller.enable2FA);

/** POST /auth/disable2FA */
router.post(
  '/disable2FA',
  authenticate,
  validate({ body: schema.twoFactorSchema }),
  controller.disable2FA,
);

/** POST /auth/verify2FA */
router.post(
  '/verify2FA',
  otpVerifyRateLimit,
  validate({ body: schema.twoFactorSchema.extend({ identifier: z.string().optional() }) }),
  controller.verify2FA,
);

/** POST /auth/socialLogin */
router.post(
  '/socialLogin',
  socialLoginRateLimit,
  validate({ body: schema.socialLoginSchema }),
  controller.socialLogin,
);

/** POST /auth/linkSocial */
router.post(
  '/linkSocial',
  authenticate,
  validate({ body: schema.linkSocialSchema }),
  controller.linkSocial,
);

/** POST /auth/unlinkSocial */
router.post(
  '/unlinkSocial',
  authenticate,
  validate({ body: schema.unlinkSocialSchema }),
  controller.unlinkSocial,
);

/** POST /auth/checkAvailability */
router.post(
  '/checkAvailability',
  validate({ body: schema.checkAvailabilitySchema }),
  controller.checkAvailability,
);

/** GET /auth/sessions */
router.get('/sessions', authenticate, controller.listSessions);

/** DELETE /auth/sessions/:id */
router.delete(
  '/sessions/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.revokeSession,
);

export default router;
