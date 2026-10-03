import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './engagement.controller';
import * as schema from './engagement.schema';

// ── Loyalty ───────────────────────────────────────────────────────────────────

const loyalty = Router();

/** GET /loyalty/getPoints */
loyalty.get('/getPoints', authenticate, controller.getSummary);

/** GET /loyalty/getTiers */
loyalty.get('/getTiers', controller.getTiers);

/** GET /loyalty/getHistory */
loyalty.get(
  '/getHistory',
  authenticate,
  validate({ query: schema.listLoyaltySchema }),
  controller.getHistory,
);

/** POST /loyalty/redeem */
loyalty.post(
  '/redeem',
  authenticate,
  validate({ body: schema.redeemPointsSchema }),
  controller.redeemPoints,
);

/** POST /loyalty/adjust/:userId — admin */
loyalty.post(
  '/adjust/:userId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.loyaltyUserIdParamSchema, body: schema.adjustPointsSchema }),
  controller.adjust,
);

// ── Referrals ─────────────────────────────────────────────────────────────────

const referrals = Router();

/** GET /referral/getMyCode */
referrals.get('/getMyCode', authenticate, controller.getReferralSummary);

/** POST /referral/applyCode */
referrals.post(
  '/applyCode',
  authenticate,
  validate({ body: schema.applyReferralSchema }),
  controller.applyCode,
);

/** GET /referral/getRewards */
referrals.get(
  '/getRewards',
  authenticate,
  validate({ query: schema.listReferralsSchema }),
  controller.getMyReferrals,
);

/** GET /referral/getLeaderboard */
referrals.get('/getLeaderboard', authenticate, controller.getLeaderboard);

/** GET /referral/admin/getAll — admin */
referrals.get(
  '/admin/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAdminReferralsSchema }),
  controller.getAllReferrals,
);

/** POST /referral/complete/:id — admin */
referrals.post(
  '/complete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.referralIdParamSchema }),
  controller.complete,
);

/** PATCH /referral/updateStatus/:id — admin */
referrals.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.referralIdParamSchema, body: schema.referralStatusSchema }),
  controller.updateStatus,
);

// ── Gift cards ────────────────────────────────────────────────────────────────

const giftCards = Router();

/** GET /giftCards/checkBalance/:code */
giftCards.get(
  '/checkBalance/:code',
  validate({ params: schema.giftCardCodeParamSchema }),
  controller.check,
);

/** POST /giftCards/redeem */
giftCards.post(
  '/redeem',
  authenticate,
  validate({ body: schema.redeemGiftCardSchema }),
  controller.redeemGiftCard,
);

/** GET /giftCards/getAll — admin */
giftCards.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAllGiftCardsSchema }),
  controller.getAllGiftCards,
);

/** POST /giftCards/create — admin */
giftCards.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createGiftCardSchema }),
  controller.createGiftCard,
);

/** PATCH /giftCards/disable/:id — admin */
giftCards.patch(
  '/disable/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.giftCardIdParamSchema }),
  controller.disableGiftCard,
);

/** DELETE /giftCards/delete/:id — admin */
giftCards.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.giftCardIdParamSchema }),
  controller.removeGiftCard,
);

// ── Message templates ────────────────────────────────────────────────────────

const templates = Router();

/** GET /templates/email/getAll — admin */
templates.get(
  '/email/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listEmail,
);

/** POST /templates/email/upsert — admin */
templates.post(
  '/email/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createEmailTemplateSchema }),
  controller.upsertEmail,
);

/** POST /templates/email/:key/render — admin */
templates.post(
  '/email/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderEmail,
);

/** DELETE /templates/email/:key/delete — admin */
templates.delete(
  '/email/:key/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema }),
  controller.deleteEmail,
);

/** GET /templates/sms/getAll — admin */
templates.get(
  '/sms/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listSms,
);

/** POST /templates/sms/upsert — admin */
templates.post(
  '/sms/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createSmsTemplateSchema }),
  controller.upsertSms,
);

/** POST /templates/sms/:key/render — admin */
templates.post(
  '/sms/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderSms,
);

/** DELETE /templates/sms/:key/delete — admin */
templates.delete(
  '/sms/:key/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema }),
  controller.deleteSms,
);

/** GET /templates/notification/getAll — admin */
templates.get(
  '/notification/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listNotifications,
);

/** POST /templates/notification/upsert — admin */
templates.post(
  '/notification/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createNotificationTemplateSchema }),
  controller.upsertNotification,
);

/** POST /templates/notification/:key/render — admin */
templates.post(
  '/notification/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderNotification,
);

/** DELETE /templates/notification/:key/delete — admin */
templates.delete(
  '/notification/:key/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema }),
  controller.deleteNotification,
);

export const loyaltyRoutes = loyalty;
export const referralRoutes = referrals;
export const giftCardRoutes = giftCards;
export const templateRoutes = templates;
