import { Router } from 'express';
import { validate, idParamSchema, paginationSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './payment.controller';
import * as schema from './payment.schema';

const payment = Router();

payment.get('/methods', controller.getMethods);

payment.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listPaymentsSchema }),
  controller.getAll,
);

payment.get(
  '/getByOrder/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema }),
  controller.getByOrder,
);

payment.post(
  '/payToken/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.verifyTokenPaymentSchema.omit({ orderId: true }),
  }),
  controller.verifyTokenPayment,
);

payment.post(
  '/payBalance/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.payBalanceSchema.omit({ orderId: true }),
  }),
  controller.payBalance,
);

payment.post(
  '/verifyUpi/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, body: schema.manualPaymentSchema }),
  controller.verifyUpi,
);

payment.post(
  '/verifyBank/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, body: schema.manualPaymentSchema }),
  controller.verifyBank,
);

payment.patch(
  '/markCodCollected/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.codCollectSchema.omit({ orderId: true }),
  }),
  controller.codCollect,
);

payment.patch(
  '/confirmPayment/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.confirmPayment,
);

payment.post(
  '/refund/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.initiateRefundSchema.omit({ paymentId: true }) }),
  controller.createRefund,
);

payment.get(
  '/getRefundHistory/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, query: paginationSchema }),
  controller.getRefundHistory,
);

payment.post(
  '/razorpay/createOrder',
  authenticate,
  validate({ body: schema.gatewayOrderSchema }),
  controller.createRazorpayOrder,
);

payment.post(
  '/razorpay/verify',
  authenticate,
  validate({ body: schema.gatewayVerifySchema }),
  controller.verifyRazorpayPayment,
);

payment.post(
  '/stripe/createIntent',
  authenticate,
  validate({ body: schema.gatewayOrderSchema }),
  controller.createStripeIntent,
);

payment.get('/walletBalance', authenticate, controller.walletBalance);

export const paymentRoutes = payment;

const payout = Router();

payout.get(
  '/getVendorEarnings',
  authenticate,
  ...controller.guards.vendor,
  validate({ query: schema.earningsSchema }),
  controller.earnings,
);

payout.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listPayoutsSchema }),
  controller.payoutList,
);

payout.patch(
  '/approvePayout/:id',
  authenticate,
  ...controller.guards.admin,
  validate({
    params: schema.payoutIdParamSchema,
    body: schema.payoutStatusSchema.omit({ status: true }),
  }),
  controller.approvePayout,
);

payout.patch(
  '/rejectPayout/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.payoutIdParamSchema, body: schema.rejectPayoutSchema }),
  controller.rejectPayout,
);

payout.post('/generateCycles', authenticate, ...controller.guards.admin, controller.generateCycles);

payout.get(
  '/getSummary',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.payoutSummarySchema }),
  controller.getSummary,
);

payout.get(
  '/getStatement/:vendorId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.vendorIdParamSchema, query: schema.statementQuerySchema }),
  controller.getStatement,
);

payout.post(
  '/bulkApprove',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkApproveSchema }),
  controller.bulkApprove,
);

payout.get(
  '/getPendingAmount/:vendorId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: schema.vendorIdParamSchema }),
  controller.getPendingAmount,
);

payout.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.payoutIdParamSchema, body: schema.payoutStatusSchema }),
  controller.updatePayoutStatus,
);

export const payoutRoutes = payout;

const returns = Router();

returns.get('/getReasons', authenticate, controller.returnReasons);

returns.post(
  '/addReason',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.returnReasonSchema }),
  controller.addReturnReason,
);

returns.post(
  '/createRequest',
  authenticate,
  validate({ body: schema.requestReturnSchema }),
  controller.requestReturn,
);

returns.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listReturnsSchema }),
  controller.returnList,
);

returns.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema }),
  controller.returnById,
);

returns.patch(
  '/approve/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.approveReturn,
);

returns.patch(
  '/reject/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.rejectReturnSchema }),
  controller.rejectReturn,
);

returns.patch(
  '/markPickedUp/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.markPickedUp,
);

returns.patch(
  '/markReceived/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.markReceived,
);

returns.patch(
  '/processRefund/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.returnIdParamSchema, body: schema.processReturnRefundSchema }),
  controller.processReturnRefund,
);

export const returnRoutes = returns;

const wallet = Router();

wallet.get('/getBalance', authenticate, controller.walletBalance);

wallet.get(
  '/getTransactions',
  authenticate,
  validate({ query: schema.walletListSchema }),
  controller.walletTransactions,
);

wallet.post(
  '/addMoney',
  authenticate,
  validate({ body: schema.walletTopUpSchema }),
  controller.addMoney,
);

wallet.post(
  '/useForOrder',
  authenticate,
  validate({ body: schema.walletRedeemSchema }),
  controller.useForOrder,
);

wallet.post(
  '/adminCredit',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.walletCreditSchema }),
  controller.adminCredit,
);

wallet.post(
  '/adminDebit',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.walletDebitSchema }),
  controller.adminDebit,
);

export const walletRoutes = wallet;

export default paymentRoutes;
