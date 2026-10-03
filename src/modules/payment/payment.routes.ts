import { Router } from 'express';
import { validate, idParamSchema, paginationSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './payment.controller';
import * as schema from './payment.schema';

// ── Payments ─────────────────────────────────────────────────────────────────

const payment = Router();

/** GET /payments/methods — public so a signed-out cart can still price itself */
payment.get('/methods', controller.getMethods);

/** GET /payments/getAll — admin */
payment.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listPaymentsSchema }),
  controller.getAll,
);

/** GET /payments/getByOrder/:orderId */
payment.get(
  '/getByOrder/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema }),
  controller.getByOrder,
);

/** POST /payments/payToken/:orderId */
payment.post(
  '/payToken/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.verifyTokenPaymentSchema.omit({ orderId: true }),
  }),
  controller.verifyTokenPayment,
);

/** POST /payments/payBalance/:orderId */
payment.post(
  '/payBalance/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.payBalanceSchema.omit({ orderId: true }),
  }),
  controller.payBalance,
);

/** POST /payments/verifyUpi/:orderId */
payment.post(
  '/verifyUpi/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, body: schema.manualPaymentSchema }),
  controller.verifyUpi,
);

/** POST /payments/verifyBank/:orderId */
payment.post(
  '/verifyBank/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, body: schema.manualPaymentSchema }),
  controller.verifyBank,
);

/** PATCH /payments/markCodCollected/:orderId — vendor or admin */
payment.patch(
  '/markCodCollected/:orderId',
  authenticate,
  validate({
    params: schema.paymentOrderParamSchema,
    body: schema.codCollectSchema.omit({ orderId: true }),
  }),
  controller.codCollect,
);

/** PATCH /payments/confirmPayment/:id — admin */
payment.patch(
  '/confirmPayment/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.confirmPayment,
);

/** POST /payments/refund/:id — admin */
payment.post(
  '/refund/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.initiateRefundSchema.omit({ paymentId: true }) }),
  controller.createRefund,
);

/** GET /payments/getRefundHistory/:orderId */
payment.get(
  '/getRefundHistory/:orderId',
  authenticate,
  validate({ params: schema.paymentOrderParamSchema, query: paginationSchema }),
  controller.getRefundHistory,
);

/** POST /payments/razorpay/createOrder */
payment.post(
  '/razorpay/createOrder',
  authenticate,
  validate({ body: schema.gatewayOrderSchema }),
  controller.createRazorpayOrder,
);

/** POST /payments/razorpay/verify */
payment.post(
  '/razorpay/verify',
  authenticate,
  validate({ body: schema.gatewayVerifySchema }),
  controller.verifyRazorpayPayment,
);

/** POST /payments/stripe/createIntent */
payment.post(
  '/stripe/createIntent',
  authenticate,
  validate({ body: schema.gatewayOrderSchema }),
  controller.createStripeIntent,
);

/** GET /payments/walletBalance — the wallet balance, under its original path */
payment.get('/walletBalance', authenticate, controller.walletBalance);

export const paymentRoutes = payment;

// ── Payouts ──────────────────────────────────────────────────────────────────

const payout = Router();

/** GET /payouts/getVendorEarnings */
payout.get(
  '/getVendorEarnings',
  authenticate,
  ...controller.guards.vendor,
  validate({ query: schema.earningsSchema }),
  controller.earnings,
);

/** GET /payouts/getAll — admin */
payout.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listPayoutsSchema }),
  controller.payoutList,
);

/** PATCH /payouts/approvePayout/:id — admin */
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

/** PATCH /payouts/rejectPayout/:id — admin */
payout.patch(
  '/rejectPayout/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.payoutIdParamSchema, body: schema.rejectPayoutSchema }),
  controller.rejectPayout,
);

/** POST /payouts/generateCycles — admin */
payout.post('/generateCycles', authenticate, ...controller.guards.admin, controller.generateCycles);

/** GET /payouts/getSummary — admin */
payout.get(
  '/getSummary',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.payoutSummarySchema }),
  controller.getSummary,
);

/** GET /payouts/getStatement/:vendorId — admin */
payout.get(
  '/getStatement/:vendorId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.vendorIdParamSchema, query: schema.statementQuerySchema }),
  controller.getStatement,
);

/** POST /payouts/bulkApprove — admin */
payout.post(
  '/bulkApprove',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.bulkApproveSchema }),
  controller.bulkApprove,
);

/** GET /payouts/getPendingAmount/:vendorId — vendor */
payout.get(
  '/getPendingAmount/:vendorId',
  authenticate,
  ...controller.guards.vendor,
  validate({ params: schema.vendorIdParamSchema }),
  controller.getPendingAmount,
);

/** PATCH /payouts/updateStatus/:id — admin */
payout.patch(
  '/updateStatus/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.payoutIdParamSchema, body: schema.payoutStatusSchema }),
  controller.updatePayoutStatus,
);

export const payoutRoutes = payout;

// ── Returns ──────────────────────────────────────────────────────────────────

const returns = Router();

/** GET /returns/getReasons — declared before /:id so it is not shadowed */
returns.get('/getReasons', authenticate, controller.returnReasons);

/** POST /returns/addReason — admin */
returns.post(
  '/addReason',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.returnReasonSchema }),
  controller.addReturnReason,
);

/** POST /returns/createRequest */
returns.post(
  '/createRequest',
  authenticate,
  validate({ body: schema.requestReturnSchema }),
  controller.requestReturn,
);

/** GET /returns/getAll */
returns.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listReturnsSchema }),
  controller.returnList,
);

/** GET /returns/getById/:id */
returns.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema }),
  controller.returnById,
);

/** PATCH /returns/approve/:id */
returns.patch(
  '/approve/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.approveReturn,
);

/** PATCH /returns/reject/:id */
returns.patch(
  '/reject/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.rejectReturnSchema }),
  controller.rejectReturn,
);

/** PATCH /returns/markPickedUp/:id */
returns.patch(
  '/markPickedUp/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.markPickedUp,
);

/** PATCH /returns/markReceived/:id */
returns.patch(
  '/markReceived/:id',
  authenticate,
  validate({ params: schema.returnIdParamSchema, body: schema.returnTransitionSchema }),
  controller.markReceived,
);

/** PATCH /returns/processRefund/:id — admin */
returns.patch(
  '/processRefund/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.returnIdParamSchema, body: schema.processReturnRefundSchema }),
  controller.processReturnRefund,
);

export const returnRoutes = returns;

// ── Wallet ───────────────────────────────────────────────────────────────────

const wallet = Router();

/** GET /wallet/getBalance */
wallet.get('/getBalance', authenticate, controller.walletBalance);

/** GET /wallet/getTransactions */
wallet.get(
  '/getTransactions',
  authenticate,
  validate({ query: schema.walletListSchema }),
  controller.walletTransactions,
);

/** POST /wallet/addMoney */
wallet.post(
  '/addMoney',
  authenticate,
  validate({ body: schema.walletTopUpSchema }),
  controller.addMoney,
);

/** POST /wallet/useForOrder */
wallet.post(
  '/useForOrder',
  authenticate,
  validate({ body: schema.walletRedeemSchema }),
  controller.useForOrder,
);

/** POST /wallet/adminCredit — admin */
wallet.post(
  '/adminCredit',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.walletCreditSchema }),
  controller.adminCredit,
);

/** POST /wallet/adminDebit — admin */
wallet.post(
  '/adminDebit',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.walletDebitSchema }),
  controller.adminDebit,
);

export const walletRoutes = wallet;

export default paymentRoutes;
