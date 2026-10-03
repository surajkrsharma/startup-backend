import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { isAdminRole, ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './review.service';
import * as cartService from '../cart/cart.service';
import { serializeCartDetail } from '../cart/cart.serializer';
import {
  serializeReviewDetail,
  serializeQuestion,
  serializeCoupon,
  serializeCouponUsage,
  serializeFlashSaleDetail,
} from './review.serializer';

/** Coupon details attached to a totals object, for the `couponData` block. */
const couponExtras = (totals: any): Record<string, any> => ({
  couponCode: D.str(totals?.couponCode),
  couponTitle: D.str(totals?.couponTitle),
  couponType: D.str(totals?.couponType),
  couponDiscount: D.float(totals?.couponDiscount),
  freeShipping: D.bool(totals?.couponFreeShipping),
  couponInvalid: D.bool(totals?.couponInvalid),
});

const userId = (req: Request): string => req.auth!.userId;
const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  vendor: [requireRole('VENDOR')],
  customer: [requireRole('CUSTOMER')],
};

// ═══ Reviews ═════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /reviews/getAll:
 *   get:
 *     tags: [Reviews]
 *     summary: Approved reviews
 *     description: >
 *       Filters: `?productId=`, `?vendorId=`, `?minRating=`, `?maxRating=`,
 *       `?withImages=true`. Only APPROVED reviews are public.
 *     responses:
 *       200: { description: Paginated reviews, pagination fields first }
 */
export const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listReviews({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.REVIEW.FETCHED,
    result: { itemList: rows.map(serializeReviewDetail) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /reviews/getSummary/:productId:
 *   get:
 *     tags: [Reviews]
 *     summary: Rating breakdown for a product
 *     responses:
 *       200: { description: Average plus a per-star distribution }
 */
export const getSummary = asyncHandler(async (req, res) => {
  const summary = await service.getReviewSummary(D.str(req.params.productId));
  return ApiResponse.success(res, { message: SUCCESS.REVIEW.SUMMARY_FETCHED, result: summary });
});

/**
 * @openapi
 * /reviews/addReview:
 *   post:
 *     tags: [Reviews]
 *     summary: Review a delivered purchase
 *     description: >
 *       Only a delivered order line qualifies, which is what makes the verified
 *       badge trustworthy. New reviews wait for moderation.
 *     responses:
 *       201: { description: Review added }
 *       409: { description: Already reviewed this product }
 *       422: { description: No delivered purchase, or reviewing own product }
 */
export const addReview = asyncHandler(async (req, res) => {
  const review = await service.addReview(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.REVIEW.ADDED, serializeReviewDetail(review));
});

/**
 * @openapi
 * /reviews/updateReview/:id:
 *   patch:
 *     tags: [Reviews]
 *     summary: Edit an own review (it returns to moderation)
 *     responses:
 *       200: { description: Review updated }
 */
export const updateReview = asyncHandler(async (req, res) => {
  const review = await service.updateReview(userId(req), D.str(req.params.id), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.REVIEW.UPDATED,
    result: serializeReviewDetail(review),
  });
});

/**
 * @openapi
 * /reviews/deleteReview/:id:
 *   delete:
 *     tags: [Reviews]
 *     summary: Remove an own review, or any review as admin
 *     responses:
 *       200: { description: Review deleted }
 */
export const deleteReview = asyncHandler(async (req, res) => {
  const isAdmin = isAdminRole(D.str(req.auth!.role));
  await service.deleteReview(D.str(req.params.id), isAdmin ? null : userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.REVIEW.DELETED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /reviews/moderate/:id:
 *   patch:
 *     tags: [Reviews]
 *     summary: Approve or reject a review (admin)
 *     responses:
 *       200: { description: Moderated }
 */
export const moderate = asyncHandler(async (req, res) => {
  const review = await service.moderateReview(
    D.str(req.params.id),
    D.str(req.body.status),
    req.auth!.userId,
    req,
  );

  const message =
    D.str(req.body.status) === 'APPROVED' ? SUCCESS.REVIEW.APPROVED : SUCCESS.REVIEW.REJECTED;

  return ApiResponse.success(res, { message, result: serializeReviewDetail(review) });
});

/**
 * @openapi
 * /reviews/reply/:id:
 *   post:
 *     tags: [Reviews]
 *     summary: The selling shop replies to a review
 *     responses:
 *       201: { description: Reply posted }
 *       404: { description: Review not found for this shop }
 */
export const reply = asyncHandler(async (req, res) => {
  const review = await service.replyReview(
    vendorId(req),
    D.str(req.params.id),
    D.str(req.body.reply),
    req.auth!.userId,
    req,
  );

  return ApiResponse.created(res, SUCCESS.REVIEW.REPLIED, serializeReviewDetail(review));
});

/**
 * @openapi
 * /reviews/markHelpful/:id:
 *   post:
 *     tags: [Reviews]
 *     summary: Mark a review as helpful
 *     responses:
 *       200: { description: Count incremented }
 */
export const markHelpful = asyncHandler(async (req, res) => {
  const review = await service.markHelpful(D.str(req.params.id), userId(req));
  return ApiResponse.success(res, {
    message: SUCCESS.REVIEW.VOTED,
    result: serializeReviewDetail(review),
  });
});

// ═══ Moderation shortcuts ═════════════════════════════════════════════════════

/** Each of these pins the target status, so the route itself documents the intent. */
const moderateReviewStatus = (status: string, message: string) =>
  asyncHandler(async (req: Request, res: any) => {
    const review = await service.moderateReview(
      D.str(req.params.id),
      status,
      req.auth!.userId,
      req,
    );

    return ApiResponse.success(res, { message, result: serializeReviewDetail(review) });
  });

export const approveReview = moderateReviewStatus('APPROVED', SUCCESS.REVIEW.APPROVED);
export const rejectReview = moderateReviewStatus('REJECTED', SUCCESS.REVIEW.REJECTED);

// ═══ Questions ════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /reviews/questions/getAll:
 *   get:
 *     tags: [Questions]
 *     summary: Product questions
 *     description: >
 *       Anonymous callers see approved questions only; a customer sees their own,
 *       a vendor sees the ones addressed to their shop.
 *     responses:
 *       200: { description: Paginated questions }
 */
export const listQuestions = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const role = req.auth!.role;

  const { rows, total } = await service.listQuestions(
    { ...(req.query as any), skip, take },
    role === 'CUSTOMER' ? userId(req) : undefined,
    role === 'VENDOR' ? vendorId(req) : undefined,
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.QUESTION.FETCHED,
    result: { itemList: rows.map(serializeQuestion) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /reviews/questions/ask:
 *   post:
 *     tags: [Questions]
 *     summary: Ask a question about a product
 *     responses:
 *       201: { description: Question posted }
 */
export const ask = asyncHandler(async (req, res) => {
  const row = await service.askQuestion(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.QUESTION.ASKED, serializeQuestion(row));
});

/**
 * @openapi
 * /reviews/questions/:id/answer:
 *   post:
 *     tags: [Questions]
 *     summary: Answer a question (the selling shop or an admin)
 *     responses:
 *       201: { description: Answer posted }
 *       403: { description: Not this product's shop }
 */
export const answer = asyncHandler(async (req, res) => {
  const row = await service.answerQuestion(
    userId(req),
    D.str(req.params.id),
    D.str(req.body.answer),
    req,
  );
  return ApiResponse.created(res, SUCCESS.QUESTION.ANSWERED, { answerId: D.str(row.id) });
});

/**
 * @openapi
 * /reviews/questions/:id/moderate:
 *   patch:
 *     tags: [Questions]
 *     summary: Show or hide a question (admin or the selling shop)
 *     responses:
 *       200: { description: Question moderated }
 */
/** PATCH /questions/approve/:id — admin */
export const approveQuestion = asyncHandler(async (req, res) => {
  const row = await service.moderateQuestion(D.str(req.params.id), true, req.auth!.userId, req);

  return ApiResponse.success(res, {
    message: SUCCESS.QUESTION.APPROVED,
    result: serializeQuestion(row),
  });
});

/**
 * @openapi
 * /reviews/questions/:id/delete:
 *   delete:
 *     tags: [Questions]
 *     summary: Remove an own question, or any question as admin
 *     responses:
 *       200: { description: Question deleted }
 */
export const deleteQuestion = asyncHandler(async (req, res) => {
  const isAdmin = isAdminRole(D.str(req.auth!.role));
  await service.deleteQuestion(D.str(req.params.id), isAdmin ? undefined : userId(req), req);
  return ApiResponse.success(res, {
    message: SUCCESS.QUESTION.DELETED,
    result: { id: D.str(req.params.id) },
  });
});

// ═══ Coupons ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /coupons/getAll:
 *   get:
 *     tags: [Coupons]
 *     summary: List coupons (admin)
 *     responses:
 *       200: { description: Paginated coupons }
 */
export const couponList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listCoupons({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.COUPON.FETCHED,
    result: { itemList: rows.map(serializeCoupon) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /coupons/createCoupon:
 *   post:
 *     tags: [Coupons]
 *     summary: Create a coupon (admin)
 *     responses:
 *       201: { description: Coupon created }
 *       409: { description: Code already in use }
 */
export const couponCreate = asyncHandler(async (req, res) => {
  const row = await service.createCoupon(req.body, req.auth!.userId, req);
  return ApiResponse.created(res, SUCCESS.COUPON.CREATED, serializeCoupon(row));
});

/**
 * @openapi
 * /coupons/updateCoupon/:id:
 *   patch:
 *     tags: [Coupons]
 *     summary: Update a coupon (admin)
 *     responses:
 *       200: { description: Coupon updated }
 */
export const couponUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateCoupon(D.str(req.params.id), req.body, req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.COUPON.UPDATED,
    result: serializeCoupon(row),
  });
});

/**
 * @openapi
 * /coupons/deleteCoupon/:id:
 *   delete:
 *     tags: [Coupons]
 *     summary: Soft-delete a coupon (admin)
 *     responses:
 *       200: { description: Coupon deleted }
 */
export const couponDelete = asyncHandler(async (req, res) => {
  await service.deleteCoupon(D.str(req.params.id), req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.COUPON.DELETED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /coupons/toggleStatus/:id:
 *   patch:
 *     tags: [Coupons]
 *     summary: Enable or disable a coupon (admin)
 *     responses:
 *       200: { description: Status changed }
 */
export const couponToggle = asyncHandler(async (req, res) => {
  const row = await service.toggleCoupon(
    D.str(req.params.id),
    Boolean(req.body.isActive),
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.COUPON.TOGGLED,
    result: serializeCoupon(row),
  });
});

/**
 * @openapi
 * /coupons/getById:
 *   get:
 *     tags: [Coupons]
 *     summary: Single coupon
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Coupon }
 *       404: { description: Not found }
 */
export const couponDetail = asyncHandler(async (req, res) => {
  const row = await service.getCouponById(D.str(req.params.id));
  return ApiResponse.success(res, {
    message: SUCCESS.COUPON.FETCHED,
    result: serializeCoupon(row),
  });
});

/**
 * @openapi
 * /coupons/applyCoupon:
 *   post:
 *     tags: [Coupons]
 *     summary: Apply a coupon to the caller's cart
 *     responses:
 *       200: { description: Cart with the coupon applied }
 *       404: { description: Unknown code }
 *       422: { description: Expired, exhausted, or minimum not met }
 */
export const couponApply = asyncHandler(async (req, res) => {
  const { totals } = await cartService.applyCoupon(userId(req), D.str(req.body.code), req);

  return ApiResponse.success(res, {
    message: SUCCESS.CART.COUPON_APPLIED,
    result: serializeCartDetail(
      await cartService.getCart(userId(req)),
      totals,
      couponExtras(totals),
    ),
  });
});

/**
 * @openapi
 * /coupons/validate:
 *   post:
 *     tags: [Coupons]
 *     summary: Dry-run a coupon against an order value
 *     responses:
 *       200: { description: Coupon is valid and what it would discount }
 *       422: { description: Expired, exhausted, or minimum not met }
 */
export const couponValidate = asyncHandler(async (req, res) => {
  const result = await service.validateCouponOnly(D.str(req.body.code), D.num(req.body.orderValue));
  return ApiResponse.success(res, { message: SUCCESS.COUPON.VALIDATED, result });
});

/**
 * @openapi
 * /coupons/getUsages:
 *   get:
 *     tags: [Coupons]
 *     summary: Coupon redemption history (admin)
 *     responses:
 *       200: { description: Paginated usages }
 */
export const couponUsages = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listCouponUsages({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.COUPON.USAGES_FETCHED,
    result: { itemList: rows.map(serializeCouponUsage) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

// ═══ Flash sale ═══════════════════════════════════════════════════════════════

/**
 * @openapi
 * /flash-sales/getAll:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Flash sales, optionally scoped by time window
 *     description: "Send `?scope=live|upcoming|ended|all` to narrow the list."
 *     responses:
 *       200: { description: Paginated flash sales }
 */
export const flashList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listFlashSales({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.FLASH_SALE.FETCHED,
    result: { itemList: rows.map(serializeFlashSaleDetail) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /flash-sales/getLive:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Sales running right now
 *     responses:
 *       200: { description: Live flash sales }
 */
export const flashLive = asyncHandler(async (req, res) => {
  const { rows } = await service.listFlashSales({ scope: 'live', skip: 0, take: 20 });

  return ApiResponse.success(res, {
    message: SUCCESS.FLASH_SALE.ACTIVE_FETCHED,
    result: { itemCount: rows.length, itemList: rows.map(serializeFlashSaleDetail) },
  });
});

/**
 * @openapi
 * /flash-sales/getBySlug/:slug:
 *   get:
 *     tags: [Flash Sales]
 *     summary: A single flash sale by slug
 *     responses:
 *       200: { description: Flash sale detail }
 *       404: { description: Not found }
 */
export const flashBySlug = asyncHandler(async (req, res) => {
  const row = await service.getFlashSaleBySlug(D.str(req.params.slug));
  return ApiResponse.success(res, {
    message: SUCCESS.FLASH_SALE.FETCHED,
    result: serializeFlashSaleDetail(row),
  });
});

/**
 * @openapi
 * /flash-sales/create:
 *   post:
 *     tags: [Flash Sales]
 *     summary: Create a flash sale (admin)
 *     responses:
 *       201: { description: Flash sale created }
 *       422: { description: End before start, or unknown products }
 */
export const flashCreate = asyncHandler(async (req, res) => {
  const row = await service.createFlashSale(req.body, req.auth!.userId, req);
  return ApiResponse.created(res, SUCCESS.FLASH_SALE.CREATED, serializeFlashSaleDetail(row));
});

/**
 * @openapi
 * /flash-sales/update/:id:
 *   patch:
 *     tags: [Flash Sales]
 *     summary: Update a flash sale (admin)
 *     description: Passing `items` replaces the sale's line items wholesale.
 *     responses:
 *       200: { description: Flash sale updated }
 */
export const flashUpdate = asyncHandler(async (req, res) => {
  const row = await service.updateFlashSale(D.str(req.params.id), req.body, req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.FLASH_SALE.UPDATED,
    result: serializeFlashSaleDetail(row),
  });
});

/**
 * @openapi
 * /flash-sales/delete/:id:
 *   delete:
 *     tags: [Flash Sales]
 *     summary: Delete a flash sale (admin)
 *     responses:
 *       200: { description: Flash sale deleted }
 */
export const flashDelete = asyncHandler(async (req, res) => {
  await service.deleteFlashSale(D.str(req.params.id), req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.FLASH_SALE.DELETED,
    result: { id: D.str(req.params.id) },
  });
});
