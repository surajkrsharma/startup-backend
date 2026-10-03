import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { ReviewStatus, type CouponType } from '@prisma/client';
import { ORDER_STATUS } from '../../constants/statuses';
import { calcCouponDiscount } from '../../utils/calculations';
import { getCouponConfig } from '../../services/settings.service';
import { writeActivityLog } from '../../services/audit.service';
import { isFuture, isPast } from '../../utils/dates';
import { uniqueFlashSaleSlug } from '../../utils/slug';

/**
 * Reviews, product questions, coupons (admin CRUD) and flash sales.
 *
 * A review is only accepted against a delivered order line, which is what makes
 * the "verified purchase" badge trustworthy. Product aggregates are recomputed
 * from APPROVED reviews only, so moderation is reflected immediately.
 */

// ═══ Review ═══════════════════════════════════════════════════════════════════

const REVIEW_INCLUDE = {
  user: { select: { id: true, name: true, avatarUrl: true } },
  vendor: { select: { id: true, shopName: true, slug: true } },
} satisfies Prisma.ReviewInclude;

/** A delivered order line proves the reviewer actually bought the product. */
const findDeliveredOrderItem = async (
  userId: string,
  productId: string,
): Promise<{ id: string } | null> => {
  const row = await prisma.orderItem.findFirst({
    where: {
      productId,
      order: { userId, status: ORDER_STATUS.DELIVERED },
    },
    orderBy: { id: 'desc' },
    select: { id: true },
  });

  return row;
};

export const addReview = async (
  userId: string,
  input: { productId: string; rating: number; title?: string; comment?: string; images?: string[] },
  req?: any,
): Promise<any> => {
  const product = await prisma.product.findFirst({
    where: { id: D.str(input.productId), deletedAt: null },
    select: {
      id: true,
      name: true,
      vendorId: true,
      vendor: { select: { userId: true, status: true } },
    },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND);

  // A shop rating its own product makes the aggregate meaningless.
  if (product.vendor?.userId === userId) {
    throw AppError.unprocessable(ERROR.REVIEW.OWN_PRODUCT);
  }

  const existing = await prisma.review.findFirst({
    where: { productId: product.id, userId },
    select: { id: true },
  });

  if (existing) {
    throw AppError.conflict(ERROR.REVIEW.ALREADY_REVIEWED, ERROR_CODE.ALREADY_REVIEWED);
  }

  const orderItem = await findDeliveredOrderItem(userId, product.id);

  if (!orderItem) {
    throw AppError.unprocessable(ERROR.REVIEW.PURCHASE_REQUIRED, ERROR_CODE.PURCHASE_REQUIRED);
  }

  const review = await prisma.review.create({
    data: {
      productId: product.id,
      userId,
      vendorId: product.vendorId,
      orderItemId: orderItem.id,
      rating: D.num(input.rating),
      title: D.str(input.title),
      comment: D.str(input.comment),
      images: D.arr(input.images).map(String),
      isVerified: true,
      /**
       * Public listings show APPROVED reviews only, so a new one waits for moderation unless the
       * shop has no other reviews yet.
       */
      status: ReviewStatus.PENDING,
    },
    include: REVIEW_INCLUDE,
  });

  await recalcProductRating(product.id);

  void writeActivityLog({
    req,
    userId,
    action: 'REVIEW_ADDED',
    entity: 'Review',
    entityId: review.id,
    meta: { productId: product.id, rating: input.rating },
  });

  return review;
};

export const updateReview = async (
  userId: string,
  reviewId: string,
  input: { rating?: number; title?: string; comment?: string; images?: string[] },
  req?: any,
): Promise<any> => {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true, productId: true },
  });

  if (!review) throw AppError.notFound(ERROR.REVIEW.NOT_FOUND);

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      ...(input.rating === undefined ? {} : { rating: D.num(input.rating) }),
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.comment === undefined ? {} : { comment: D.str(input.comment) }),
      ...(input.images === undefined ? {} : { images: D.arr(input.images).map(String) }),
      // Edited text needs to clear moderation again.
      status: ReviewStatus.PENDING,
    },
    include: REVIEW_INCLUDE,
  });

  await recalcProductRating(review.productId);

  void writeActivityLog({
    req,
    userId,
    action: 'REVIEW_UPDATED',
    entity: 'Review',
    entityId: review.id,
  });

  return updated;
};

export const deleteReview = async (
  reviewId: string,
  userId: string | null,
  req?: any,
): Promise<void> => {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, ...(userId ? { userId } : {}) },
    select: { id: true, productId: true },
  });

  if (!review) throw AppError.notFound(ERROR.REVIEW.NOT_FOUND);

  await prisma.review.delete({ where: { id: review.id } });
  await recalcProductRating(review.productId);

  void writeActivityLog({
    req,
    userId: userId ?? undefined,
    action: 'REVIEW_DELETED',
    entity: 'Review',
    entityId: review.id,
  });
};

export const listReviews = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.ReviewWhereInput = { status: ReviewStatus.APPROVED };

  if (D.str(query.productId)) where.productId = D.str(query.productId);
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.userId)) where.userId = D.str(query.userId);
  if (D.str(query.status)) where.status = query.status;

  if (D.num(query.minRating) || D.num(query.maxRating)) {
    where.rating = {
      ...(D.num(query.minRating) ? { gte: D.num(query.minRating) } : {}),
      ...(D.num(query.maxRating) ? { lte: D.num(query.maxRating) } : {}),
    };
  }

  // "has images" is a post-filter: Prisma cannot express a non-empty array.
  const withImages = D.str(query.withImages) === 'true';

  const [all, total] = await Promise.all([
    prisma.review.findMany({
      where,
      include: REVIEW_INCLUDE,
      orderBy: { createdAt: 'desc' },
      ...(withImages ? {} : { skip: D.num(query.skip), take: D.num(query.take) }),
    }),
    prisma.review.count({ where }),
  ]);

  const filtered = withImages ? all.filter((r) => D.arr(r.images).length > 0) : all;
  const rows = withImages
    ? filtered.slice(D.num(query.skip), D.num(query.skip) + D.num(query.take))
    : filtered;

  return { rows, total: withImages ? filtered.length : total };
};

/** Rating breakdown plus the counters a product page shows. */
export const getReviewSummary = async (productId: string): Promise<Record<string, any>> => {
  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId, status: ReviewStatus.APPROVED },
    _count: { _all: true },
  });

  const buckets: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let total = 0;
  let weighted = 0;

  for (const g of grouped) {
    const count = D.num(g._count._all);
    const rating = D.num(g.rating);
    buckets[String(rating)] = count;
    total += count;
    weighted += rating * count;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { rating: true, ratingCount: true },
  });

  return {
    productId,
    averageRating:
      total > 0 ? D.float(Math.round((weighted / total) * 100) / 100) : D.float(product?.rating),
    totalCount: total,
    verifiedCount: total,

    distributionList: [5, 4, 3, 2, 1].map((star) => ({
      rating: star,
      count: D.num(buckets[String(star)]),
      percentage:
        total > 0 ? D.float(Math.round((D.num(buckets[String(star)]) / total) * 1000) / 10) : 0,
    })),
  };
};

/** Recomputes the denormalised rating on the product row. */
const recalcProductRating = async (productId: string): Promise<void> => {
  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { productId, status: ReviewStatus.APPROVED },
    _count: { _all: true },
  });

  let total = 0;
  let weighted = 0;

  for (const g of grouped) {
    const count = D.num(g._count._all);
    total += count;
    weighted += D.num(g.rating) * count;
  }

  const rating = total > 0 ? D.float(Math.round((weighted / total) * 100) / 100) : 0;

  await prisma.product.update({
    where: { id: productId },
    data: { rating, ratingCount: total },
  });
};

/** Shop-level rating, used on the vendor card. */
const recalcVendorRating = async (vendorId: string): Promise<void> => {
  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: { vendorId, status: ReviewStatus.APPROVED },
    _count: { _all: true },
  });

  let total = 0;
  let weighted = 0;

  for (const g of grouped) {
    const count = D.num(g._count._all);
    total += count;
    weighted += D.num(g.rating) * count;
  }

  await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      rating: total > 0 ? D.float(Math.round((weighted / total) * 100) / 100) : 0,
      ratingCount: total,
    },
  });
};

/** Approve or reject a pending review. */
export const moderateReview = async (
  reviewId: string,
  status: string,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, productId: true, vendorId: true, status: true },
  });

  if (!review) throw AppError.notFound(ERROR.REVIEW.NOT_FOUND);

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: { status: status as ReviewStatus },
    include: REVIEW_INCLUDE,
  });

  await recalcProductRating(review.productId);
  if (review.vendorId) await recalcVendorRating(review.vendorId);

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'REVIEW_MODERATED',
    entity: 'Review',
    entityId: review.id,
    meta: { from: review.status, to: status },
  });

  return updated;
};

/** The selling shop answers a review once. */
export const replyReview = async (
  vendorId: string,
  reviewId: string,
  reply: string,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, vendorId },
    select: { id: true, productId: true },
  });

  if (!review) throw AppError.notFound(ERROR.REVIEW.NOT_FOUND);

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: { vendorReply: D.str(reply), repliedAt: new Date(), repliedById: D.str(actorId) || null },
    include: REVIEW_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'REVIEW_REPLIED',
    entity: 'Review',
    entityId: review.id,
  });

  return updated;
};

/** Customers mark a review helpful. */
export const markHelpful = async (reviewId: string, userId: string): Promise<any> => {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, productId: true },
  });

  if (!review) throw AppError.notFound(ERROR.REVIEW.NOT_FOUND);

  return prisma.review.update({
    where: { id: review.id },
    data: { isHelpful: { increment: 1 } },
    include: REVIEW_INCLUDE,
  });

  void userId;
};

// ═══ Question / Answer ════════════════════════════════════════════════════════

const QUESTION_INCLUDE = {
  user: { select: { id: true, name: true } },
  answers: {
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.QuestionInclude;

export const askQuestion = async (
  userId: string,
  input: { productId: string; question: string; isAnonymous?: boolean },
  req?: any,
): Promise<any> => {
  const product = await prisma.product.findFirst({
    where: { id: D.str(input.productId), deletedAt: null },
    select: { id: true, vendorId: true, vendor: { select: { status: true } } },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND);

  /**
   * Questions auto-approve so a shopper is not left waiting; the shop can hide anything it does
   * not want public.
   */
  const isApproved = product.vendor?.status === 'APPROVED';

  const row = await prisma.question.create({
    data: {
      productId: product.id,
      userId,
      vendorId: product.vendorId,
      question: D.str(input.question),
      isAnonymous: D.bool(input.isAnonymous),
      isApproved,
    },
    include: QUESTION_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId,
    action: 'QUESTION_ASKED',
    entity: 'Question',
    entityId: row.id,
  });

  return row;
};

export const listQuestions = async (
  query: Record<string, any>,
  userId?: string,
  vendorId?: string,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.QuestionWhereInput = {};

  if (userId) where.userId = userId;
  if (vendorId) where.vendorId = vendorId;
  if (D.str(query.productId)) where.productId = D.str(query.productId);
  if (D.str(query.userId)) where.userId = D.str(query.userId);
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);

  // A public list only shows approved questions.
  if (!userId && !vendorId) where.isApproved = true;

  const [rows, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: QUESTION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.question.count({ where }),
  ]);

  return { rows, total };
};

export const answerQuestion = async (
  userId: string,
  questionId: string,
  answer: string,
  req?: any,
): Promise<any> => {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      vendorId: true,
      product: { select: { vendor: { select: { userId: true } } } },
    },
  });

  if (!question) throw AppError.notFound(ERROR.QUESTION.NOT_FOUND);

  // The shop that sells the product answers for it; so does any admin.
  const isSeller = question.product?.vendor?.userId === userId;
  if (!isSeller && !req?.auth?.role?.includes('ADMIN')) {
    throw AppError.forbidden(ERROR.PERMISSION.NOT_GRANTED);
  }

  const row = await prisma.answer.create({
    data: { questionId: question.id, userId, answer: D.str(answer), isApproved: true },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'QUESTION_ANSWERED',
    entity: 'Answer',
    entityId: row.id,
  });

  return row;
};

export const moderateQuestion = async (
  questionId: string,
  isApproved: boolean,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true },
  });

  if (!question) throw AppError.notFound(ERROR.QUESTION.NOT_FOUND);

  const row = await prisma.question.update({
    where: { id: question.id },
    data: { isApproved },
    include: QUESTION_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: isApproved ? 'QUESTION_APPROVED' : 'QUESTION_HIDDEN',
    entity: 'Question',
    entityId: question.id,
  });

  return row;
};

export const deleteQuestion = async (
  questionId: string,
  userId?: string,
  req?: any,
): Promise<void> => {
  const question = await prisma.question.findFirst({
    where: { id: questionId, ...(userId ? { userId } : {}) },
    select: { id: true },
  });

  if (!question) throw AppError.notFound(ERROR.QUESTION.NOT_FOUND);

  await prisma.question.delete({ where: { id: question.id } });

  void writeActivityLog({
    req,
    userId,
    action: 'QUESTION_DELETED',
    entity: 'Question',
    entityId: question.id,
  });
};

// ═══ Coupon (admin) ═══════════════════════════════════════════════════════════

export const listCoupons = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.CouponWhereInput = { deletedAt: null };

  if (D.str(query.type)) where.type = query.type as CouponType;
  if (D.str(query.status)) where.status = query.status as any;
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.coupon.count({ where }),
  ]);

  return { rows, total };
};

export const getCouponById = async (id: string): Promise<any> => {
  const row = await prisma.coupon.findFirst({ where: { id, deletedAt: null } });

  if (!row) throw AppError.notFound('Coupon not found.', ERROR_CODE.NOT_FOUND);

  return row;
};

export const createCoupon = async (
  input: Record<string, any>,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const code = D.str(input.code).toUpperCase();

  const existing = await prisma.coupon.findFirst({ where: { code }, select: { id: true } });

  if (existing) {
    throw AppError.conflict('This coupon code already exists.', ERROR_CODE.DUPLICATE);
  }

  // Referenced ids must exist, or the coupon silently never matches.
  const [vendor, products, categories] = await Promise.all([
    D.str(input.vendorId)
      ? prisma.vendorProfile.findUnique({
          where: { id: D.str(input.vendorId) },
          select: { id: true },
        })
      : null,
    D.arr(input.productIds).length
      ? prisma.product.count({ where: { id: { in: D.arr(input.productIds).map(String) } } })
      : 0,
    D.arr(input.categoryIds).length
      ? prisma.category.count({ where: { id: { in: D.arr(input.categoryIds).map(String) } } })
      : 0,
  ]);

  if (D.str(input.vendorId) && !vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND);

  if (D.arr(input.productIds).length && D.num(products) !== D.arr(input.productIds).length) {
    throw AppError.unprocessable('One or more products do not exist.');
  }

  if (D.arr(input.categoryIds).length && D.num(categories) !== D.arr(input.categoryIds).length) {
    throw AppError.unprocessable('One or more categories do not exist.');
  }

  const row = await prisma.coupon.create({
    data: {
      code,
      title: D.str(input.title),
      description: D.str(input.description),
      type: (D.str(input.type) || 'FLAT') as CouponType,
      value: D.float(input.value),
      maxDiscount: D.float(input.maxDiscount),
      minOrderAmount: D.float(input.minOrderAmount),
      maxUsage: D.num(input.maxUsage),
      maxUsagePerUser: D.num(input.maxUsagePerUser),
      vendorId: D.str(input.vendorId) || null,
      productIds: D.arr(input.productIds).map(String),
      categoryIds: D.arr(input.categoryIds).map(String),
      startsAt: input.startsAt ? new Date(D.str(input.startsAt)) : new Date(),
      expiresAt: input.expiresAt ? new Date(D.str(input.expiresAt)) : null,
      isActive: input.isActive !== false,
    },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'COUPON_CREATED',
    entity: 'Coupon',
    entityId: row.id,
    meta: { code },
  });

  return row;
};

export const updateCoupon = async (
  couponId: string,
  input: Record<string, any>,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const existing = await prisma.coupon.findFirst({
    where: { id: couponId, deletedAt: null },
    select: { id: true, code: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COUPON.NOT_FOUND);

  // A code already in use elsewhere cannot be taken over.
  if (input.code && D.str(input.code).toUpperCase() !== existing.code) {
    const clash = await prisma.coupon.findFirst({
      where: { code: D.str(input.code).toUpperCase(), id: { not: couponId } },
      select: { id: true },
    });

    if (clash) throw AppError.conflict('This coupon code already exists.', ERROR_CODE.DUPLICATE);
  }

  const row = await prisma.coupon.update({
    where: { id: couponId },
    data: {
      ...(input.code ? { code: D.str(input.code).toUpperCase() } : {}),
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.description === undefined ? {} : { description: D.str(input.description) }),
      ...(input.type === undefined ? {} : { type: input.type as CouponType }),
      ...(input.value === undefined ? {} : { value: D.float(input.value) }),
      ...(input.maxDiscount === undefined ? {} : { maxDiscount: D.float(input.maxDiscount) }),
      ...(input.minOrderAmount === undefined
        ? {}
        : { minOrderAmount: D.float(input.minOrderAmount) }),
      ...(input.maxUsage === undefined ? {} : { maxUsage: D.num(input.maxUsage) }),
      ...(input.maxUsagePerUser === undefined
        ? {}
        : { maxUsagePerUser: D.num(input.maxUsagePerUser) }),
      ...(input.vendorId === undefined ? {} : { vendorId: D.str(input.vendorId) || null }),
      ...(input.productIds === undefined
        ? {}
        : { productIds: D.arr(input.productIds).map(String) }),
      ...(input.categoryIds === undefined
        ? {}
        : { categoryIds: D.arr(input.categoryIds).map(String) }),
      ...(input.startsAt === undefined ? {} : { startsAt: new Date(D.str(input.startsAt)) }),
      ...(input.expiresAt === undefined
        ? {}
        : { expiresAt: input.expiresAt ? new Date(D.str(input.expiresAt)) : null }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'COUPON_UPDATED',
    entity: 'Coupon',
    entityId: couponId,
  });

  return row;
};

/** Coupons are soft-deleted so historical usage stays traceable. */
export const deleteCoupon = async (
  couponId: string,
  actorId?: string,
  req?: any,
): Promise<void> => {
  const existing = await prisma.coupon.findFirst({
    where: { id: couponId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COUPON.NOT_FOUND);

  await prisma.coupon.update({
    where: { id: couponId },
    data: { deletedAt: new Date(), isActive: false },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'COUPON_DELETED',
    entity: 'Coupon',
    entityId: couponId,
  });
};

export const toggleCoupon = async (
  couponId: string,
  isActive: boolean,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const existing = await prisma.coupon.findFirst({
    where: { id: couponId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COUPON.NOT_FOUND);

  const row = await prisma.coupon.update({ where: { id: couponId }, data: { isActive } });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'COUPON_TOGGLED',
    entity: 'Coupon',
    entityId: couponId,
  });

  return row;
};

/** Dry-run a coupon against an order value without touching the cart. */
export const validateCouponOnly = async (
  code: string,
  orderValue: number,
): Promise<Record<string, any>> => {
  const coupon = await prisma.coupon.findFirst({
    where: { code: D.str(code).toUpperCase(), deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      type: true,
      value: true,
      maxDiscount: true,
      minOrderAmount: true,
      maxUsage: true,
      usedCount: true,
      startsAt: true,
      expiresAt: true,
      isActive: true,
    },
  });

  if (!coupon) throw AppError.notFound(ERROR.COUPON.NOT_FOUND);

  if (!coupon.isActive) throw AppError.unprocessable(ERROR.COUPON.INVALID);
  if (isFuture(coupon.startsAt)) throw AppError.unprocessable(ERROR.COUPON.INVALID);
  if (coupon.expiresAt && isPast(coupon.expiresAt))
    throw AppError.unprocessable(ERROR.COUPON.EXPIRED);

  if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) {
    throw AppError.unprocessable(ERROR.COUPON.USAGE_LIMIT);
  }

  const config = await getCouponConfig();
  const minRequired = Math.max(D.float(coupon.minOrderAmount), D.float(config.minOrderAmount));

  if (minRequired > 0 && orderValue < minRequired) {
    throw AppError.unprocessable(`${ERROR.COUPON.MIN_NOT_MET} (minimum ${minRequired})`);
  }

  const applied = calcCouponDiscount({
    subtotal: orderValue,
    type: coupon.type as CouponType,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    globalMaxDiscount: config.maxDiscount,
  });

  return {
    code: coupon.code,
    title: coupon.title,
    type: coupon.type,
    isValid: true,
    discount: applied.discount,
    freeShipping: applied.freeShipping,
    payable: money(Math.max(0, orderValue - applied.discount)),
  };
};

export const listCouponUsages = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.CouponUsageWhereInput = {};
  if (D.str(query.couponId)) where.couponId = D.str(query.couponId);
  if (D.str(query.userId)) where.userId = D.str(query.userId);
  if (D.str(query.orderId)) where.orderId = D.str(query.orderId);

  const [rows, total] = await Promise.all([
    prisma.couponUsage.findMany({
      where,
      include: {
        coupon: { select: { id: true, code: true, title: true, type: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.couponUsage.count({ where }),
  ]);

  return { rows, total };
};

// ═══ Flash sale ═══════════════════════════════════════════════════════════════

const SALE_INCLUDE = {
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          mrpPrice: true,
          stock: true,
          status: true,
          images: { select: { url: true, sortOrder: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.FlashSaleInclude;

/** Sale price from the sale's own rule, capped by an explicit override. */
const salePriceFor = (product: any, discountType: string, discountValue: number): number => {
  const price = D.float(product?.price);
  const computed =
    discountType === 'PERCENT'
      ? money(price * (1 - D.float(discountValue) / 100))
      : money(Math.max(0, price - D.float(discountValue)));

  const override = D.float(product?.__override);
  return override > 0 ? money(Math.min(computed, override)) : computed;
};

export const listFlashSales = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.FlashSaleWhereInput = {};
  const now = new Date();

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const scope = D.str(query.scope) || 'all';

  if (scope === 'live') {
    where.isActive = true;
    where.startsAt = { lte: now };
    where.endsAt = { gte: now };
  } else if (scope === 'upcoming') {
    where.startsAt = { gt: now };
  } else if (scope === 'ended') {
    where.endsAt = { lt: now };
  }

  const [rows, total] = await Promise.all([
    prisma.flashSale.findMany({
      where,
      include: SALE_INCLUDE,
      orderBy: { startsAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.flashSale.count({ where }),
  ]);

  return { rows, total };
};

export const getFlashSaleBySlug = async (slug: string): Promise<any> => {
  const sale = await prisma.flashSale.findFirst({ where: { slug }, include: SALE_INCLUDE });

  if (!sale) throw AppError.notFound(ERROR.FLASH_SALE.NOT_FOUND);

  return sale;
};

export const createFlashSale = async (
  input: Record<string, any>,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const startsAt = new Date(D.str(input.startsAt));
  const endsAt = new Date(D.str(input.endsAt));

  if (endsAt <= startsAt) {
    throw AppError.unprocessable(ERROR.FLASH_SALE.INVALID_WINDOW);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: D.arr(input.items).map((i: any) => D.str(i.productId)) }, deletedAt: null },
    select: { id: true, price: true, status: true },
  });

  if (products.length !== D.arr(input.items).length) {
    throw AppError.unprocessable('One or more products do not exist.');
  }

  const priceMap = new Map(products.map((p) => [p.id, p.price]));
  const discountType = D.str(input.discountType) || 'PERCENT';

  const slug = await uniqueFlashSaleSlug(D.str(input.name));

  const row = await prisma.flashSale.create({
    data: {
      name: D.str(input.name),
      slug,
      banner: D.str(input.banner),
      startsAt,
      endsAt,
      discountType,
      discountValue: D.float(input.discountValue),
      isActive: true,
      items: {
        create: D.arr(input.items).map((i: any) => {
          const productId = D.str(i.productId);
          const computed = salePriceFor(
            { price: priceMap.get(productId), __override: D.num(i.salePrice) },
            discountType,
            D.float(input.discountValue),
          );

          return {
            productId,
            // Sale stock never exceeds what the shop actually holds.
            saleStock: Math.min(D.num(i.saleStock), D.num(priceMap.get(productId))),
            salePrice: computed,
            createdById: D.str(actorId),
          };
        }),
      },
    },
    include: SALE_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'FLASH_SALE_CREATED',
    entity: 'FlashSale',
    entityId: row.id,
  });

  return row;
};

export const updateFlashSale = async (
  saleId: string,
  input: Record<string, any>,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const sale = await prisma.flashSale.findUnique({
    where: { id: saleId },
    select: { id: true, discountType: true, discountValue: true },
  });

  if (!sale) throw AppError.notFound(ERROR.FLASH_SALE.NOT_FOUND);

  if (
    input.startsAt &&
    input.endsAt &&
    new Date(D.str(input.endsAt)) <= new Date(D.str(input.startsAt))
  ) {
    throw AppError.unprocessable(ERROR.FLASH_SALE.INVALID_WINDOW);
  }

  if (D.arr(input.items).length) {
    const products = await prisma.product.findMany({
      where: {
        id: { in: D.arr(input.items).map((i: any) => D.str(i.productId)) },
        deletedAt: null,
      },
      select: { id: true, price: true },
    });

    if (products.length !== D.arr(input.items).length) {
      throw AppError.unprocessable('One or more products do not exist.');
    }

    const priceMap = new Map(products.map((p) => [p.id, p.price]));
    const discountType = D.str(input.discountType) || sale.discountType;
    const discountValue = D.num(input.discountValue) || sale.discountValue;

    // Items are replaced wholesale so a removed product really leaves the sale.
    await prisma.flashSaleItem.deleteMany({ where: { flashSaleId: saleId } });

    await prisma.flashSaleItem.createMany({
      data: D.arr(input.items).map((i: any) => {
        const productId = D.str(i.productId);
        return {
          flashSaleId: saleId,
          productId,
          saleStock: Math.min(D.num(i.saleStock), D.num(priceMap.get(productId))),
          salePrice: salePriceFor(
            { price: priceMap.get(productId), __override: D.num(i.salePrice) },
            discountType,
            discountValue,
          ),
          createdById: D.str(actorId),
        };
      }),
    });
  }

  const row = await prisma.flashSale.update({
    where: { id: saleId },
    data: {
      ...(input.name ? { name: D.str(input.name) } : {}),
      ...(input.banner === undefined ? {} : { banner: D.str(input.banner) }),
      ...(input.startsAt ? { startsAt: new Date(D.str(input.startsAt)) } : {}),
      ...(input.endsAt ? { endsAt: new Date(D.str(input.endsAt)) } : {}),
      ...(input.discountType ? { discountType: D.str(input.discountType) } : {}),
      ...(input.discountValue === undefined ? {} : { discountValue: D.float(input.discountValue) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    include: SALE_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'FLASH_SALE_UPDATED',
    entity: 'FlashSale',
    entityId: saleId,
  });

  return row;
};

export const deleteFlashSale = async (
  saleId: string,
  actorId?: string,
  req?: any,
): Promise<void> => {
  const sale = await prisma.flashSale.findUnique({ where: { id: saleId }, select: { id: true } });

  if (!sale) throw AppError.notFound(ERROR.FLASH_SALE.NOT_FOUND);

  await prisma.flashSale.delete({ where: { id: saleId } });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'FLASH_SALE_DELETED',
    entity: 'FlashSale',
    entityId: saleId,
  });
};

export { salePriceFor };
