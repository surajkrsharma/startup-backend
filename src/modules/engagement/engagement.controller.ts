import { Request } from 'express';
import { ReferralStatus } from '@prisma/client';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './engagement.service';
import {
  serializeGiftCard,
  serializeLoyaltyTransaction,
  serializeReferral,
} from '../../utils/serialize';

const userId = (req: Request): string => req.auth!.userId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  superAdmin: [requireRole(ROLES.SUPER_ADMIN)],
};

// ═══ Loyalty ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /loyalty/getSummary:
 *   get:
 *     tags: [Loyalty]
 *     summary: Point balance, tier and lifetime totals
 *     responses:
 *       200: { description: The loyalty summary plus the tier table }
 */
export const getSummary = asyncHandler(async (req, res) => {
  const result = await service.getLoyaltySummary(userId(req));

  return ApiResponse.success(res, { message: SUCCESS.LOYALTY.POINTS_FETCHED, result });
});

/**
 * @openapi
 * /loyalty/getTiers:
 *   get:
 *     tags: [Loyalty]
 *     summary: The tier table with its thresholds
 *     responses:
 *       200: { description: Every tier, lowest first }
 */
export const getTiers = asyncHandler(async (_req, res) => {
  const itemList = service.listLoyaltyTiers();

  return ApiResponse.success(res, {
    message: SUCCESS.LOYALTY.TIERS_FETCHED,
    result: { itemList, totalRecord: itemList.length },
  });
});

/**
 * @openapi
 * /loyalty/getHistory:
 *   get:
 *     tags: [Loyalty]
 *     summary: The caller's point ledger, newest first
 *     responses:
 *       200: { description: Paginated ledger }
 */
export const getHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listLoyaltyHistory(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.LOYALTY.HISTORY_FETCHED,
    result: { itemList: rows.map(serializeLoyaltyTransaction) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /loyalty/redeem:
 *   post:
 *     tags: [Loyalty]
 *     summary: Redeem points for wallet credit
 *     responses:
 *       200: { description: The redeemed points and the new balance }
 */
export const redeemPoints = asyncHandler(async (req, res) => {
  const result = await service.redeemPoints(userId(req), D.num(req.body.points), req);

  return ApiResponse.success(res, { message: SUCCESS.LOYALTY.REDEEMED, result });
});

/**
 * @openapi
 * /loyalty/adjust/:userId:
 *   post:
 *     tags: [Loyalty]
 *     summary: Grant or claw back points (admin)
 *     responses:
 *       200: { description: The adjustment and the new balance }
 */
export const adjust = asyncHandler(async (req, res) => {
  const result = await service.adjustPoints(
    D.str(req.params.userId),
    D.num(req.body.points),
    D.str(req.body.description),
    req,
  );

  return ApiResponse.success(res, { message: SUCCESS.LOYALTY.POINTS_FETCHED, result });
});

// ═══ Referral ═════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /referrals/getSummary:
 *   get:
 *     tags: [Referrals]
 *     summary: The caller's referral code and reward totals
 *     responses:
 *       200: { description: Code, counts and reward amounts }
 */
export const getReferralSummary = asyncHandler(async (req, res) => {
  const result = await service.getReferralSummary(userId(req));

  return ApiResponse.success(res, { message: SUCCESS.REFERRAL.CODE_FETCHED, result });
});

/**
 * @openapi
 * /referrals/apply:
 *   post:
 *     tags: [Referrals]
 *     summary: Apply someone else's referral code to the caller's account
 *     responses:
 *       200: { description: The pending referral and its rewards }
 */
export const applyCode = asyncHandler(async (req, res) => {
  const result = await service.applyReferralCode(userId(req), D.str(req.body.referralCode), req);

  return ApiResponse.success(res, { message: SUCCESS.REFERRAL.APPLIED, result });
});

/**
 * @openapi
 * /referrals/getAll:
 *   get:
 *     tags: [Referrals]
 *     summary: Referrals the caller has made
 *     responses:
 *       200: { description: Paginated referral list }
 */
export const getMyReferrals = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listMyReferrals(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.REFERRAL.REWARDS_FETCHED,
    result: { itemList: rows.map(serializeReferral) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /referrals/leaderboard:
 *   get:
 *     tags: [Referrals]
 *     summary: Top referrers by completed referrals
 *     responses:
 *       200: { description: Ranked referrers }
 */
export const getLeaderboard = asyncHandler(async (req, res) => {
  const take = Math.min(100, Math.max(1, Number((req.query as any).limit) || 20));

  const grouped = await service.listAllReferrals({ status: 'COMPLETED', take: 500, skip: 0 });

  const tally = new Map<string, { userId: string; completedCount: number; totalEarned: number }>();

  for (const row of grouped.rows) {
    const current = tally.get(row.referrerId) ?? {
      userId: D.str(row.referrerId),
      completedCount: 0,
      totalEarned: 0,
    };

    current.completedCount += 1;
    current.totalEarned += D.float(row.referrerReward);

    tally.set(D.str(row.referrerId), current);
  }

  const itemList = [...tally.values()]
    .sort((a, b) => b.completedCount - a.completedCount || b.totalEarned - a.totalEarned)
    .slice(0, take)
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  return ApiResponse.success(res, {
    message: SUCCESS.REFERRAL.LEADERBOARD_FETCHED,
    result: { itemList, totalRecord: itemList.length },
  });
});

/**
 * @openapi
 * /referrals/admin/getAll:
 *   get:
 *     tags: [Referrals]
 *     summary: Every referral, for the admin queue (admin)
 *     responses:
 *       200: { description: Paginated referral list }
 */
export const getAllReferrals = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listAllReferrals({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.REFERRAL.REWARDS_FETCHED,
    result: { itemList: rows.map(serializeReferral) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /referrals/:id/complete:
 *   post:
 *     tags: [Referrals]
 *     summary: Settle a pending referral and pay both rewards (admin)
 *     responses:
 *       200: { description: The settled referral }
 */
export const complete = asyncHandler(async (req, res) => {
  const result = await service.completeReferral(req.params.id, req);

  return ApiResponse.success(res, { message: SUCCESS.REFERRAL.REWARDS_FETCHED, result });
});

/**
 * @openapi
 * /referrals/:id/updateStatus:
 *   patch:
 *     tags: [Referrals]
 *     summary: Approve, reject or expire a referral (admin)
 *     responses:
 *       200: { description: The updated referral }
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const result = await service.updateReferralStatus(
    req.params.id,
    D.str(req.body.status).toUpperCase() as ReferralStatus,
    req,
  );

  return ApiResponse.success(res, { message: SUCCESS.REFERRAL.REWARDS_FETCHED, result });
});

// ═══ Gift cards ═══════════════════════════════════════════════════════════════

/**
 * @openapi
 * /gift-cards/getAll:
 *   get:
 *     tags: [Gift Cards]
 *     summary: The caller's gift cards
 *     responses:
 *       200: { description: Paginated gift card list }
 */
export const getMyGiftCards = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listGiftCards(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.GIFT_CARD.FETCHED,
    result: { itemList: rows.map(serializeGiftCard) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /gift-cards/balance:
 *   get:
 *     tags: [Gift Cards]
 *     summary: The caller's total gift card balance
 *     responses:
 *       200: { description: Balance, issued value and unexpired balance }
 */
export const getBalance = asyncHandler(async (req, res) => {
  const result = await service.getGiftCardBalance(userId(req));

  return ApiResponse.success(res, { message: SUCCESS.GIFT_CARD.BALANCE_FETCHED, result });
});

/**
 * @openapi
 * /gift-cards/check:
 *   get:
 *     tags: [Gift Cards]
 *     summary: Look up a gift card balance by code
 *     responses:
 *       200: { description: Balance and validity, never the owner }
 */
export const check = asyncHandler(async (req, res) => {
  const code = D.str(req.params.code) || D.str((req.query as any).code);
  const result = await service.checkGiftCard(code);

  return ApiResponse.success(res, { message: SUCCESS.GIFT_CARD.BALANCE_FETCHED, result });
});

/**
 * @openapi
 * /gift-cards/redeem:
 *   post:
 *     tags: [Gift Cards]
 *     summary: Redeem a gift card against an order
 *     responses:
 *       200: { description: The redeemed amount and the remaining balance }
 */
export const redeemGiftCard = asyncHandler(async (req, res) => {
  const result = await service.redeemGiftCard(
    D.str(req.body.code),
    { orderId: D.str(req.body.orderId), amount: D.float(req.body.amount) },
    req,
  );

  return ApiResponse.success(res, { message: SUCCESS.GIFT_CARD.REDEEMED, result });
});

/**
 * @openapi
 * /gift-cards/admin/getAll:
 *   get:
 *     tags: [Gift Cards]
 *     summary: Every gift card (admin)
 *     responses:
 *       200: { description: Paginated gift card list }
 */
export const getAllGiftCards = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listAllGiftCards({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.GIFT_CARD.FETCHED,
    result: { itemList: rows.map(serializeGiftCard) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /gift-cards/create:
 *   post:
 *     tags: [Gift Cards]
 *     summary: Issue a gift card (admin)
 *     responses:
 *       201: { description: The created gift card, including its code }
 */
export const createGiftCard = asyncHandler(async (req, res) => {
  const result = await service.createGiftCard(req.body, req);

  return ApiResponse.created(res, SUCCESS.GIFT_CARD.CREATED, result);
});

/**
 * @openapi
 * /gift-cards/:id/disable:
 *   patch:
 *     tags: [Gift Cards]
 *     summary: Disable a gift card without deleting it (admin)
 *     responses:
 *       200: { description: The disabled gift card }
 */
export const disableGiftCard = asyncHandler(async (req, res) => {
  const result = await service.disableGiftCard(req.params.id, req);

  return ApiResponse.success(res, { message: SUCCESS.GIFT_CARD.DISABLED, result });
});

/**
 * @openapi
 * /gift-cards/:id/delete:
 *   delete:
 *     tags: [Gift Cards]
 *     summary: Delete an unredeemed gift card (admin)
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const removeGiftCard = asyncHandler(async (req, res) => {
  await service.deleteGiftCard(req.params.id, req);

  return ApiResponse.success(res, {
    message: SUCCESS.GIFT_CARD.DELETED,
    result: { giftCardId: D.str(req.params.id), isDeleted: true },
  });
});

// ═══ Message templates ════════════════════════════════════════════════════════

const emailRow = (t: any) => ({
  templateId: D.str(t?.id),
  key: D.str(t?.key),
  name: D.str(t?.name),
  subject: D.str(t?.subject),
  htmlBody: D.str(t?.htmlBody),
  textBody: D.str(t?.textBody),
  variables: D.strArr(t?.variables),
  isActive: D.bool(t?.isActive),
  createdAt: D.date(t?.createdAt),
  updatedAt: D.date(t?.updatedAt),
});

const smsRow = (t: any) => ({
  templateId: D.str(t?.id),
  key: D.str(t?.key),
  name: D.str(t?.name),
  body: D.str(t?.body),
  variables: D.strArr(t?.variables),
  isActive: D.bool(t?.isActive),
  createdAt: D.date(t?.createdAt),
  updatedAt: D.date(t?.updatedAt),
});

const notificationRow = (t: any) => ({
  templateId: D.str(t?.id),
  key: D.str(t?.key),
  name: D.str(t?.name),
  channel: D.str(t?.channel),
  title: D.str(t?.title),
  body: D.str(t?.body),
  variables: D.strArr(t?.variables),
  isActive: D.bool(t?.isActive),
  createdAt: D.date(t?.createdAt),
  updatedAt: D.date(t?.updatedAt),
});

/**
 * @openapi
 * /templates/email/getAll:
 *   get:
 *     tags: [Templates]
 *     summary: Email templates (admin)
 *     responses:
 *       200: { description: Paginated template list }
 */
export const listEmail = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listEmailTemplates({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.I18N.TRANSLATIONS_FETCHED,
    result: { itemList: rows.map(emailRow) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /templates/email/upsert:
 *   post:
 *     tags: [Templates]
 *     summary: Create or update an email template (admin)
 *     responses:
 *       200: { description: The saved template }
 */
export const upsertEmail = asyncHandler(async (req, res) => {
  const result = await service.upsertEmailTemplate(req.body, req);

  return ApiResponse.success(res, { message: SUCCESS.I18N.UPDATED, result });
});

/**
 * @openapi
 * /templates/email/:key/render:
 *   post:
 *     tags: [Templates]
 *     summary: Render an email template with values (admin)
 *     responses:
 *       200: { description: The rendered subject and bodies, plus any missing variables }
 */
export const renderEmail = asyncHandler(async (req, res) => {
  const result = await service.renderEmailTemplate(req.params.key, req.body.values);

  return ApiResponse.success(res, { message: SUCCESS.I18N.TRANSLATIONS_FETCHED, result });
});

/**
 * @openapi
 * /templates/email/:key/delete:
 *   delete:
 *     tags: [Templates]
 *     summary: Delete an email template (admin)
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteEmail = asyncHandler(async (req, res) => {
  await service.deleteEmailTemplate(req.params.key, req);

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.DELETED,
    result: { key: D.str(req.params.key), isDeleted: true },
  });
});

/**
 * @openapi
 * /templates/sms/getAll:
 *   get:
 *     tags: [Templates]
 *     summary: SMS templates (admin)
 *     responses:
 *       200: { description: Paginated template list }
 */
export const listSms = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listSmsTemplates({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.I18N.TRANSLATIONS_FETCHED,
    result: { itemList: rows.map(smsRow) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /templates/sms/upsert:
 *   post:
 *     tags: [Templates]
 *     summary: Create or update an SMS template (admin)
 *     responses:
 *       200: { description: The saved template }
 */
export const upsertSms = asyncHandler(async (req, res) => {
  const result = await service.upsertSmsTemplate(req.body, req);

  return ApiResponse.success(res, { message: SUCCESS.I18N.UPDATED, result });
});

/**
 * @openapi
 * /templates/sms/:key/render:
 *   post:
 *     tags: [Templates]
 *     summary: Render an SMS template with values (admin)
 *     responses:
 *       200: { description: The rendered body, plus any missing variables }
 */
export const renderSms = asyncHandler(async (req, res) => {
  const result = await service.renderSmsTemplate(req.params.key, req.body.values);

  return ApiResponse.success(res, { message: SUCCESS.I18N.TRANSLATIONS_FETCHED, result });
});

/**
 * @openapi
 * /templates/sms/:key/delete:
 *   delete:
 *     tags: [Templates]
 *     summary: Delete an SMS template (admin)
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteSms = asyncHandler(async (req, res) => {
  await service.deleteSmsTemplate(req.params.key, req);

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.DELETED,
    result: { key: D.str(req.params.key), isDeleted: true },
  });
});

/**
 * @openapi
 * /templates/notification/getAll:
 *   get:
 *     tags: [Templates]
 *     summary: Notification templates (admin)
 *     responses:
 *       200: { description: Paginated template list }
 */
export const listNotifications = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listNotificationTemplates({
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.I18N.TRANSLATIONS_FETCHED,
    result: { itemList: rows.map(notificationRow) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /templates/notification/upsert:
 *   post:
 *     tags: [Templates]
 *     summary: Create or update a notification template (admin)
 *     responses:
 *       200: { description: The saved template }
 */
export const upsertNotification = asyncHandler(async (req, res) => {
  const result = await service.upsertNotificationTemplate(req.body, req);

  return ApiResponse.success(res, { message: SUCCESS.I18N.UPDATED, result });
});

/**
 * @openapi
 * /templates/notification/:key/render:
 *   post:
 *     tags: [Templates]
 *     summary: Render a notification template with values (admin)
 *     responses:
 *       200: { description: The rendered title and body, plus any missing variables }
 */
export const renderNotification = asyncHandler(async (req, res) => {
  const result = await service.renderNotificationTemplate(req.params.key, req.body.values);

  return ApiResponse.success(res, { message: SUCCESS.I18N.TRANSLATIONS_FETCHED, result });
});

/**
 * @openapi
 * /templates/notification/:key/delete:
 *   delete:
 *     tags: [Templates]
 *     summary: Delete a notification template (admin)
 *     responses:
 *       200: { description: Deletion acknowledgement }
 */
export const deleteNotification = asyncHandler(async (req, res) => {
  await service.deleteNotificationTemplate(req.params.key, req);

  return ApiResponse.success(res, {
    message: SUCCESS.I18N.DELETED,
    result: { key: D.str(req.params.key), isDeleted: true },
  });
});
