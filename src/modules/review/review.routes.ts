import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import * as controller from './review.controller';
import * as schema from './review.schema';
import * as cartSchema from '../cart/cart.schema';

// ── Reviews ──────────────────────────────────────────────────────────────────

const review = Router();

/** GET /reviews/getAll */
review.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listReviewsSchema }),
  controller.getAll,
);

/** GET /reviews/getSummary/:productId */
review.get(
  '/getSummary/:productId',
  optionalAuth,
  validate({ params: schema.reviewSummaryParamSchema }),
  controller.getSummary,
);

/** POST /reviews/addReview */
review.post(
  '/addReview',
  authenticate,
  validate({ body: schema.addReviewSchema }),
  controller.addReview,
);

/** PATCH /reviews/updateReview/:id */
review.patch(
  '/updateReview/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.updateReviewSchema }),
  controller.updateReview,
);

/** DELETE /reviews/deleteReview/:id */
review.delete(
  '/deleteReview/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteReview,
);

/** PATCH /reviews/approve/:id — admin */
review.patch(
  '/approve/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.approveReview,
);

/** PATCH /reviews/reject/:id — admin */
review.patch(
  '/reject/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.rejectReview,
);

/** POST /reviews/voteHelpful/:id */
review.post(
  '/voteHelpful/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.markHelpful,
);

/** POST /reviews/reply/:id — the selling shop */
review.post(
  '/reply/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, body: schema.replyReviewSchema }),
  controller.reply,
);

export const reviewRoutes = review;

// ── Questions ────────────────────────────────────────────────────────────────

const question = Router();

/** GET /questions/getAll/:productId */
question.get(
  '/getAll/:productId',
  optionalAuth,
  validate({ params: schema.questionProductParamSchema, query: schema.listQuestionsSchema }),
  controller.listQuestions,
);

/** POST /questions/ask */
question.post('/ask', authenticate, validate({ body: schema.askQuestionSchema }), controller.ask);

/** POST /questions/answer/:id — the selling shop */
question.post(
  '/answer/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, body: schema.answerQuestionSchema }),
  controller.answer,
);

/** PATCH /questions/approve/:id — admin */
question.patch(
  '/approve/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.approveQuestion,
);

/** DELETE /questions/delete/:id — own question, or any as admin */
question.delete(
  '/delete/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteQuestion,
);

export const questionRoutes = question;

// ── Coupons ──────────────────────────────────────────────────────────────────

const coupon = Router();

/** GET /coupons/getAll — admin */
coupon.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listCouponsSchema }),
  controller.couponList,
);

/** POST /coupons/createCoupon — admin */
/** GET /coupons/getById/:id - admin */
coupon.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema }),
  controller.couponDetail,
);

/** POST /coupons/applyCoupon - customer, applies to the caller's cart */
coupon.post(
  '/applyCoupon',
  authenticate,
  ...controller.guards.customer,
  validate({ body: cartSchema.applyCouponSchema }),
  controller.couponApply,
);

/** POST /coupons/createCoupon - admin */
coupon.post(
  '/createCoupon',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createCouponSchema }),
  controller.couponCreate,
);

/** PATCH /coupons/updateCoupon/:id — admin */
coupon.patch(
  '/updateCoupon/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, body: schema.updateCouponSchema }),
  controller.couponUpdate,
);

/** DELETE /coupons/deleteCoupon/:id — admin */
coupon.delete(
  '/deleteCoupon/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema }),
  controller.couponDelete,
);

/** POST /coupons/validateCoupon */
coupon.post(
  '/validateCoupon',
  authenticate,
  validate({ body: schema.validateCouponSchema }),
  controller.couponValidate,
);

/** GET /coupons/getUsages/:id — admin */
coupon.get(
  '/getUsages/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, query: schema.listCouponsSchema }),
  controller.couponUsages,
);

/** PATCH /coupons/toggleStatus/:id — admin */
coupon.patch(
  '/toggleStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, body: schema.toggleCouponSchema }),
  controller.couponToggle,
);

export const couponRoutes = coupon;

// ── Flash sales ──────────────────────────────────────────────────────────────

const flash = Router();

/** GET /flashSales/getActive */
flash.get(
  '/getActive',
  optionalAuth,
  validate({ query: schema.listFlashSalesSchema }),
  controller.flashLive,
);

/** GET /flashSales/getAll — admin */
flash.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listFlashSalesSchema }),
  controller.flashList,
);

/** GET /flashSales/getBySlug/:slug */
flash.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.flashSlugParamSchema }),
  controller.flashBySlug,
);

/** POST /flashSales/create — admin */
flash.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createFlashSaleSchema }),
  controller.flashCreate,
);

/** PATCH /flashSales/update/:id — admin */
flash.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.flashSaleIdParamSchema, body: schema.updateFlashSaleSchema }),
  controller.flashUpdate,
);

/** DELETE /flashSales/delete/:id — admin */
flash.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.flashSaleIdParamSchema }),
  controller.flashDelete,
);

export const flashSaleRoutes = flash;

export default reviewRoutes;
