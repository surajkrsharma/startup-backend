import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate, optionalAuth } from '../../middlewares/auth.middleware';
import * as controller from './review.controller';
import * as schema from './review.schema';
import * as cartSchema from '../cart/cart.schema';

const review = Router();

review.get(
  '/getAll',
  optionalAuth,
  validate({ query: schema.listReviewsSchema }),
  controller.getAll,
);

review.get(
  '/getSummary/:productId',
  optionalAuth,
  validate({ params: schema.reviewSummaryParamSchema }),
  controller.getSummary,
);

review.post(
  '/addReview',
  authenticate,
  validate({ body: schema.addReviewSchema }),
  controller.addReview,
);

review.patch(
  '/updateReview/:id',
  authenticate,
  validate({ params: idParamSchema, body: schema.updateReviewSchema }),
  controller.updateReview,
);

review.delete(
  '/deleteReview/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteReview,
);

review.patch(
  '/approve/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.approveReview,
);

review.patch(
  '/reject/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.rejectReview,
);

review.post(
  '/voteHelpful/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.markHelpful,
);

review.post(
  '/reply/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, body: schema.replyReviewSchema }),
  controller.reply,
);

export const reviewRoutes = review;

const question = Router();

question.get(
  '/getAll/:productId',
  optionalAuth,
  validate({ params: schema.questionProductParamSchema, query: schema.listQuestionsSchema }),
  controller.listQuestions,
);

question.post('/ask', authenticate, validate({ body: schema.askQuestionSchema }), controller.ask);

question.post(
  '/answer/:id',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: idParamSchema, body: schema.answerQuestionSchema }),
  controller.answer,
);

question.patch(
  '/approve/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.approveQuestion,
);

question.delete(
  '/delete/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteQuestion,
);

export const questionRoutes = question;

const coupon = Router();

coupon.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listCouponsSchema }),
  controller.couponList,
);

coupon.get(
  '/getById/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema }),
  controller.couponDetail,
);

coupon.post(
  '/applyCoupon',
  authenticate,
  ...controller.guards.customer,
  validate({ body: cartSchema.applyCouponSchema }),
  controller.couponApply,
);

coupon.post(
  '/createCoupon',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createCouponSchema }),
  controller.couponCreate,
);

coupon.patch(
  '/updateCoupon/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, body: schema.updateCouponSchema }),
  controller.couponUpdate,
);

coupon.delete(
  '/deleteCoupon/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema }),
  controller.couponDelete,
);

coupon.post(
  '/validateCoupon',
  authenticate,
  validate({ body: schema.validateCouponSchema }),
  controller.couponValidate,
);

coupon.get(
  '/vendorCoupons',
  authenticate,
  ...controller.guards.vendorCoupon,
  validate({ query: schema.listVendorCouponsSchema }),
  controller.vendorCouponList,
);

coupon.post(
  '/vendorCreateCoupon',
  authenticate,
  ...controller.guards.vendorCoupon,
  validate({ body: schema.createVendorCouponSchema }),
  controller.vendorCouponCreate,
);

coupon.patch(
  '/vendorUpdateCoupon/:id',
  authenticate,
  ...controller.guards.vendorCoupon,
  validate({ params: schema.couponIdParamSchema, body: schema.updateVendorCouponSchema }),
  controller.vendorCouponUpdate,
);

coupon.delete(
  '/vendorDeleteCoupon/:id',
  authenticate,
  ...controller.guards.vendorCoupon,
  validate({ params: schema.couponIdParamSchema }),
  controller.vendorCouponDelete,
);

coupon.get(
  '/getUsages/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, query: schema.listCouponsSchema }),
  controller.couponUsages,
);

coupon.patch(
  '/toggleStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.couponIdParamSchema, body: schema.toggleCouponSchema }),
  controller.couponToggle,
);

export const couponRoutes = coupon;

const flash = Router();

flash.get(
  '/getActive',
  optionalAuth,
  validate({ query: schema.listFlashSalesSchema }),
  controller.flashLive,
);

flash.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listFlashSalesSchema }),
  controller.flashList,
);

flash.get(
  '/getBySlug/:slug',
  optionalAuth,
  validate({ params: schema.flashSlugParamSchema }),
  controller.flashBySlug,
);

flash.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createFlashSaleSchema }),
  controller.flashCreate,
);

flash.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.flashSaleIdParamSchema, body: schema.updateFlashSaleSchema }),
  controller.flashUpdate,
);

flash.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.flashSaleIdParamSchema }),
  controller.flashDelete,
);

export const flashSaleRoutes = flash;

export default reviewRoutes;
