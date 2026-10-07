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
 *     summary: Complete registration and sign in
 *     description: >
 *       Third and final step. `verificationToken` must come from
 *       POST /auth/register/verifyOtp, and must have been issued for the
 *       `email` or `phone` submitted here. It is single-use.
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
 *       400: { description: Verification token was issued for a different contact }
 *       401: { description: Missing, invalid, expired or already-used verification token }
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
 * /auth/register/sendOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Registration step 1 — request a code
 *     description: >
 *       Returns the same shape whether or not the identifier is already taken,
 *       so the response never reveals whether an account exists.
 *     responses:
 *       200: { description: Code dispatched }
 *       400: { description: Identifier is not a valid email or phone }
 *       429: { description: Resend cooldown or daily cap reached }
 */
router.post(
  '/register/sendOtp',
  otpSendRateLimit,
  validate({ body: schema.registrationSendOtpSchema }),
  controller.registrationSendOtp,
);

/**
 * @openapi
 * /auth/register/verifyOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Registration step 2 — verify the code
 *     description: >
 *       Returns a single-use `verificationToken` bound to the identifier that
 *       was proven. No account is created and no session is issued here.
 *     responses:
 *       200: { description: Verified; verificationToken returned }
 *       401: { description: Invalid or expired OTP }
 *       429: { description: Too many OTP attempts }
 */
router.post(
  '/register/verifyOtp',
  otpVerifyRateLimit,
  validate({ body: schema.registrationVerifyOtpSchema }),
  controller.registrationVerifyOtp,
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with a password
 *     description: >
 *       Password login only. OTP login is the separate two-step path —
 *       POST /auth/sendOtp then POST /auth/login/verifyOtp, which verifies
 *       the code and signs in.
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
 * /auth/login/verifyOtp:
 *   post:
 *     tags: [Auth]
 *     summary: OTP login step 2 — verify the code and sign in
 *     description: >
 *       Final step of OTP login. The session is issued for the identifier the
 *       code was sent to, so it cannot be pointed anywhere else.
 *     responses:
 *       200: { description: Logged in; tokens returned }
 *       401: { description: Invalid or expired OTP, or no account for that identifier }
 *       403: { description: Account suspended or not verified }
 *       429: { description: Too many OTP attempts }
 */
router.post(
  '/login/verifyOtp',
  otpVerifyRateLimit,
  validate({ body: schema.loginVerifyOtpSchema }),
  controller.loginVerifyOtp,
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
 *     summary: Verify an OTP for a non-login purpose
 *     description: >
 *       For FORGOT_PASSWORD, EMAIL_VERIFY, PHONE_VERIFY and TWO_FA. LOGIN and
 *       REGISTER are rejected here — their step 2 mints a verificationToken
 *       instead (see /auth/login/verifyOtp and /auth/register/verifyOtp).
 */
router.post(
  '/verifyOtp',
  otpVerifyRateLimit,
  validate({ body: schema.verifyOtpSchema }),
  controller.verifyOtp,
);

router.post(
  '/forgotPassword',
  forgotPasswordRateLimit,
  validate({ body: schema.forgotPasswordSchema }),
  controller.forgotPassword,
);

router.post(
  '/resetPassword',
  passwordResetRateLimit,
  validate({ body: schema.resetPasswordSchema }),
  controller.resetPassword,
);

router.post(
  '/changePassword',
  authenticate,
  validate({ body: schema.changePasswordSchema }),
  controller.changePassword,
);

router.post(
  '/verifyEmail',
  authenticate,
  validate({ body: schema.verifyContactSchema }),
  controller.verifyEmail,
);

router.post(
  '/verifyPhone',
  authenticate,
  validate({ body: schema.verifyContactSchema }),
  controller.verifyPhone,
);

/**
 * @openapi
 * /auth/changeEmail/sendOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Request the code that proves control of a new email address
 *     description: >
 *       Two-step change. This sends the code to the *new* address; the old one is
 *       notified after the change lands, not before. `type` is EMAIL_CHANGE or
 *       PHONE_CHANGE, `value` is the address or number being claimed.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Code dispatched }
 *       400: { description: Value is not a valid email or phone }
 *       429: { description: Contact-change cooldown reached }
 */
router.post(
  '/changeEmail/sendOtp',
  authenticate,
  otpSendRateLimit,
  validate({ body: schema.requestContactChangeSchema }),
  controller.requestContactChangeOtp,
);

/**
 * @openapi
 * /auth/changeEmail/verifyOtp:
 *   post:
 *     tags: [Auth]
 *     summary: Verify the code and mint the change token
 *     description: >
 *       Returns a single-use `verificationToken` bound to the new contact.
 *       `changeEmail` or `changePhone` then needs it alongside the code.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Verified; verificationToken returned }
 *       401: { description: Invalid or expired OTP }
 */
router.post(
  '/changeEmail/verifyOtp',
  authenticate,
  otpVerifyRateLimit,
  validate({ body: schema.verifyContactChangeSchema }),
  controller.verifyContactChangeOtp,
);

/**
 * @openapi
 * /auth/changeEmail:
 *   post:
 *     tags: [Auth]
 *     summary: Swap the sign-in email
 *     description: >
 *       Needs both the verified code and the verificationToken minted by
 *       /auth/changeEmail/verifyOtp. The address is marked verified on success.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Email changed }
 *       409: { description: Address already in use }
 */
router.post(
  '/changeEmail',
  authenticate,
  validate({ body: schema.changeContactSchema }),
  controller.changeEmail,
);

/**
 * @openapi
 * /auth/changePhone:
 *   post:
 *     tags: [Auth]
 *     summary: Swap the phone number
 *     description: >
 *       Mirror of /auth/changeEmail. The number is marked verified on success, and
 *       every other session is revoked so a takeover cannot ride along.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Phone changed }
 *       409: { description: Number already in use }
 */
router.post(
  '/changePhone',
  authenticate,
  validate({ body: schema.changeContactSchema }),
  controller.changePhone,
);

/**
 * @openapi
 * /auth/restoreAccount:
 *   post:
 *     tags: [Auth]
 *     summary: Restore an account inside its deletion recovery window
 *     description: >
 *       Uses the token emailed when the deletion was scheduled. After the window
 *       closes the row is purged and this returns 410 for good.
 *     responses:
 *       200: { description: Account restored }
 *       410: { description: Recovery window has closed }
 */
router.post(
  '/restoreAccount',
  validate({ body: schema.restoreAccountSchema }),
  controller.restoreAccount,
);

router.post('/enable2FA', authenticate, twoFactorRateLimit, controller.enable2FA);

router.post(
  '/disable2FA',
  authenticate,
  validate({ body: schema.twoFactorSchema }),
  controller.disable2FA,
);

router.post(
  '/verify2FA',
  otpVerifyRateLimit,
  validate({ body: schema.twoFactorSchema.extend({ identifier: z.string().optional() }) }),
  controller.verify2FA,
);

router.post(
  '/socialLogin',
  socialLoginRateLimit,
  validate({ body: schema.socialLoginSchema }),
  controller.socialLogin,
);

router.post(
  '/linkSocial',
  authenticate,
  validate({ body: schema.linkSocialSchema }),
  controller.linkSocial,
);

router.post(
  '/unlinkSocial',
  authenticate,
  validate({ body: schema.unlinkSocialSchema }),
  controller.unlinkSocial,
);

router.post(
  '/checkAvailability',
  validate({ body: schema.checkAvailabilitySchema }),
  controller.checkAvailability,
);

router.get('/sessions', authenticate, controller.listSessions);

router.delete(
  '/sessions/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.revokeSession,
);

router.post(
  '/acceptConsent',
  authenticate,
  validate({ body: schema.acceptConsentSchema }),
  controller.acceptConsent,
);

router.get(
  '/getMyConsents',
  authenticate,
  validate({ body: schema.getMyConsentsSchema }),
  controller.getMyConsents,
);

export default router;
