import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './engagement.controller';
import * as schema from './engagement.schema';

const loyalty = Router();

loyalty.get('/getPoints', authenticate, controller.getSummary);

loyalty.get('/getTiers', controller.getTiers);

loyalty.get(
  '/getHistory',
  authenticate,
  validate({ query: schema.listLoyaltySchema }),
  controller.getHistory,
);

loyalty.post(
  '/redeem',
  authenticate,
  validate({ body: schema.redeemPointsSchema }),
  controller.redeemPoints,
);

loyalty.post(
  '/adjust/:userId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.loyaltyUserIdParamSchema, body: schema.adjustPointsSchema }),
  controller.adjust,
);

const referrals = Router();

referrals.get('/getMyCode', authenticate, controller.getReferralSummary);

referrals.post(
  '/applyCode',
  authenticate,
  validate({ body: schema.applyReferralSchema }),
  controller.applyCode,
);

referrals.get(
  '/getRewards',
  authenticate,
  validate({ query: schema.listReferralsSchema }),
  controller.getMyReferrals,
);

referrals.get('/getLeaderboard', authenticate, controller.getLeaderboard);

referrals.get(
  '/admin/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAdminReferralsSchema }),
  controller.getAllReferrals,
);

referrals.post(
  '/complete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.referralIdParamSchema }),
  controller.complete,
);

referrals.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.referralIdParamSchema, body: schema.referralStatusSchema }),
  controller.updateStatus,
);

const giftCards = Router();

giftCards.get(
  '/checkBalance/:code',
  validate({ params: schema.giftCardCodeParamSchema }),
  controller.check,
);

giftCards.post(
  '/redeem',
  authenticate,
  validate({ body: schema.redeemGiftCardSchema }),
  controller.redeemGiftCard,
);

giftCards.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listAllGiftCardsSchema }),
  controller.getAllGiftCards,
);

giftCards.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createGiftCardSchema }),
  controller.createGiftCard,
);

giftCards.patch(
  '/disable/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.giftCardIdParamSchema }),
  controller.disableGiftCard,
);

giftCards.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.giftCardIdParamSchema }),
  controller.removeGiftCard,
);

const templates = Router();

templates.get(
  '/email/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listEmail,
);

templates.post(
  '/email/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createEmailTemplateSchema }),
  controller.upsertEmail,
);

templates.post(
  '/email/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderEmail,
);

templates.delete(
  '/email/:key/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema }),
  controller.deleteEmail,
);

templates.get(
  '/sms/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listSms,
);

templates.post(
  '/sms/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createSmsTemplateSchema }),
  controller.upsertSms,
);

templates.post(
  '/sms/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderSms,
);

templates.delete(
  '/sms/:key/delete',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema }),
  controller.deleteSms,
);

templates.get(
  '/notification/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listTemplatesSchema }),
  controller.listNotifications,
);

templates.post(
  '/notification/upsert',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createNotificationTemplateSchema }),
  controller.upsertNotification,
);

templates.post(
  '/notification/:key/render',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.templateKeyParamSchema, body: schema.renderTemplateValuesSchema }),
  controller.renderNotification,
);

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
