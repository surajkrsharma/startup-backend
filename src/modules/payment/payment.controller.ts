import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './payment.service';
import {
  serializePaymentSummary,
  serializePayment,
  serializePayoutDetail,
  serializeVendorEarning,
  serializeRefund,
  serializeWalletEntry,
  serializeReturnDetail,
  serializeReturnReason,
} from './payment.serializer';

const userId = (req: Request): string => req.auth!.userId;
const vendorId = (req: Request): string => req.auth!.vendorId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  vendor: [requireRole('VENDOR')],
};

// ═══ Payments ════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /payments/getAll:
 *   get:
 *     tags: [Payments]
 *     summary: The caller's payments
 *     responses:
 *       200: { description: Paginated payment list }
 */
export const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  // This listing is admin-only and is meant to be the whole book, so the caller's
  // id is deliberately NOT passed as a filter — `listPayments` narrows by user only
  // when one is given.
  const { rows, total } = await service.listPayments(null, {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.PAYMENT.FETCHED,
    result: { itemList: rows.map(serializePaymentSummary) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/getByOrder/:orderId:
 *   get:
 *     tags: [Payments]
 *     summary: Every payment attempt on an order
 *     responses:
 *       200: { description: Payment list }
 *       404: { description: No payment record for this order }
 */
export const getByOrder = asyncHandler(async (req, res) => {
  const rows = await service.getPaymentByOrder(D.str(req.params.orderId), userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.BY_ORDER_FETCHED,
    result: {
      orderId: D.str(req.params.orderId),
      itemCount: rows.length,
      itemList: rows.map(serializePayment),
    },
  });
});

/**
 * @openapi
 * /payments/verifyTokenPayment:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm the token / advance payment
 *     description: >
 *       The order stays in PENDING_TOKEN until the remaining balance clears.
 *     responses:
 *       200: { description: Token payment recorded }
 *       422: { description: No token pending, or already paid }
 */
export const verifyTokenPayment = asyncHandler(async (req, res) => {
  // The route carries the order in the path and the schema omits it from the body,
  // so the service still needs it merged back in.
  const payment = await service.verifyTokenPayment(
    userId(req),
    { ...req.body, orderId: D.str(req.params.orderId) },
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.TOKEN_PAID,
    result: serializePayment(payment),
  });
});

/**
 * @openapi
 * /payments/payBalance:
 *   post:
 *     tags: [Payments]
 *     summary: Settle the remaining balance on a token order
 *     responses:
 *       200: { description: Balance recorded }
 *       422: { description: Nothing outstanding }
 */
export const payBalance = asyncHandler(async (req, res) => {
  const payment = await service.payBalance(
    userId(req),
    { ...req.body, orderId: D.str(req.params.orderId) },
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.BALANCE_PAID,
    result: serializePayment(payment),
  });
});

/**
 * @openapi
 * /payments/codCollect:
 *   post:
 *     tags: [Payments]
 *     summary: Record cash collected for a COD order (admin)
 *     responses:
 *       200: { description: Cash recorded }
 */
export const codCollect = asyncHandler(async (req, res) => {
  const payment = await service.collectCod(
    { ...req.body, orderId: D.str(req.params.orderId) },
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.COD_COLLECTED,
    result: serializePayment(payment),
  });
});

/**
 * @openapi
 * /payments/initiateRefund:
 *   post:
 *     tags: [Payments]
 *     summary: Open a refund against what was actually paid
 *     responses:
 *       201: { description: Refund opened }
 *       422: { description: Refund exceeds the paid amount }
 */
export const initiateRefund = asyncHandler(async (req, res) => {
  const refund = await service.initiateRefund(req.body, req.auth!.userId, req);
  return ApiResponse.created(res, SUCCESS.PAYMENT.REFUND_INITIATED, serializeRefund(refund));
});

/**
 * @openapi
 * /payments/getRefunds:
 *   get:
 *     tags: [Payments]
 *     summary: Refund history
 *     responses:
 *       200: { description: Paginated refunds }
 */
export const getRefunds = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listRefunds({ ...(req.query as any), skip, take });

  return ApiResponse.paginated(res, {
    message: SUCCESS.PAYMENT.REFUND_HISTORY_FETCHED,
    result: { itemList: rows.map(serializeRefund) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/processRefund/:id:
 *   patch:
 *     tags: [Payments]
 *     summary: Mark a pending refund paid or failed (admin)
 *     responses:
 *       200: { description: Refund processed }
 *       422: { description: Already processed }
 */
export const processRefund = asyncHandler(async (req, res) => {
  const refund = await service.processRefund(D.str(req.params.id), req.body, req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.REFUND_INITIATED,
    result: serializeRefund(refund),
  });
});

/**
 * @openapi
 * /payments/getMethods:
 *   get:
 *     tags: [Payments]
 *     summary: Enabled payment methods and their limits
 *     responses:
 *       200: { description: Method configuration }
 */
export const getMethods = asyncHandler(async (_req, res) => {
  const cfg = await service.getPaymentMethodsConfig();

  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.METHODS_FETCHED,
    result: {
      cod: {
        method: 'COD',
        isEnabled: cfg.cod.enabled,
        maxAmount: cfg.cod.maxAmount,
        extraCharge: cfg.cod.extraCharge,
      },
      upi: { method: 'UPI', isEnabled: cfg.upi.enabled, upiId: cfg.upi.upiId },
      bank: {
        method: 'BANK',
        isEnabled: cfg.bank.enabled,
        holderName: cfg.bank.holderName,
        accountNo: cfg.bank.accountNo,
        ifsc: cfg.bank.ifsc,
      },
    },
  });
});

/** POST /payments/verifyUpi/:orderId — the customer submits a UPI reference */
export const verifyUpi = asyncHandler(async (req, res) => {
  const payment = await service.submitManualPayment(
    userId(req),
    { ...req.body, orderId: D.str(req.params.orderId), method: 'UPI' },
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.UPI_VERIFIED,
    result: serializePayment(payment),
  });
});

/** POST /payments/verifyBank/:orderId — the customer submits a bank transfer slip */
export const verifyBank = asyncHandler(async (req, res) => {
  const payment = await service.submitManualPayment(
    userId(req),
    { ...req.body, orderId: D.str(req.params.orderId), method: 'BANK' },
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.BANK_VERIFIED,
    result: serializePayment(payment),
  });
});

/** PATCH /payments/confirmPayment/:id — admin */
export const confirmPayment = asyncHandler(async (req, res) => {
  const payment = await service.confirmPayment(D.str(req.params.id), req.auth!.userId, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.CONFIRMED,
    result: serializePayment(payment),
  });
});

/** POST /payments/refund/:id — admin opens a refund against a payment */
export const createRefund = asyncHandler(async (req, res) => {
  const refund = await service.initiateRefund(
    { ...req.body, paymentId: D.str(req.params.id) },
    req.auth!.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.PAYMENT.REFUND_INITIATED, serializeRefund(refund));
});

/**
 * @openapi
 * /payments/getRefundHistory/:orderId:
 *   get:
 *     tags: [Payments]
 *     summary: Refunds raised against one order
 *     responses:
 *       200: { description: Paginated refunds }
 */
export const getRefundHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listRefundsByOrder(D.str(req.params.orderId), userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.PAYMENT.REFUND_HISTORY_FETCHED,
    result: { orderId: D.str(req.params.orderId), refundList: rows.map(serializeRefund) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/** POST /payments/razorpay/createOrder */
export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const result = await service.createGatewayOrder(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PAYMENT.RAZORPAY_ORDER_CREATED, result);
});

/** POST /payments/razorpay/verify */
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const payment = await service.verifyGatewayPayment(userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.PAYMENT.RAZORPAY_VERIFIED,
    result: serializePayment(payment),
  });
});

/** POST /payments/stripe/createIntent */
export const createStripeIntent = asyncHandler(async (req, res) => {
  const result = await service.createStripeIntent(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PAYMENT.STRIPE_INTENT_CREATED, result);
});

// ═══ Wallet ═══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /payments/wallet/balance:
 *   get:
 *     tags: [Payments]
 *     summary: Wallet balance and redemption limits
 *     responses:
 *       200: { description: Balance summary }
 */
export const walletBalance = asyncHandler(async (req, res) => {
  const summary = await service.getWalletSummary(userId(req));
  return ApiResponse.success(res, { message: SUCCESS.WALLET.BALANCE_FETCHED, result: summary });
});

/**
 * @openapi
 * /payments/wallet/transactions:
 *   get:
 *     tags: [Payments]
 *     summary: Wallet ledger
 *     responses:
 *       200: { description: Paginated transactions }
 */
export const walletTransactions = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listWalletTransactions(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.WALLET.TRANSACTIONS_FETCHED,
    result: { itemList: rows.map(serializeWalletEntry) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/wallet/adjust:
 *   post:
 *     tags: [Payments]
 *     summary: Credit or debit a wallet (admin)
 *     responses:
 *       201: { description: Wallet adjusted }
 *       422: { description: Wallet disabled or balance would go negative }
 */
export const walletAdjust = asyncHandler(async (req, res) => {
  const row = await service.adjustWallet(D.str(req.body.userId), req.body, req.auth!.userId, req);
  return ApiResponse.created(res, SUCCESS.WALLET.CREDITED, serializeWalletEntry(row));
});

/** POST /wallet/addMoney — the customer tops their own wallet up */
export const addMoney = asyncHandler(async (req, res) => {
  const row = await service.addMoneyToWallet(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.WALLET.ADDED, serializeWalletEntry(row));
});

/** POST /wallet/useForOrder — redeem balance at checkout */
export const useForOrder = asyncHandler(async (req, res) => {
  const row = await service.useWalletForOrder(userId(req), req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.WALLET.USED,
    result: { ...serializeWalletEntry(row), balance: D.float(row.balance) },
  });
});

/** POST /wallet/adminCredit — admin */
export const adminCredit = asyncHandler(async (req, res) => {
  const row = await service.adjustWallet(
    D.str(req.body.userId),
    { ...req.body, amount: Math.abs(D.num(req.body.amount)) },
    req.auth!.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.WALLET.CREDITED, serializeWalletEntry(row));
});

/** POST /wallet/adminDebit — admin */
export const adminDebit = asyncHandler(async (req, res) => {
  const row = await service.adjustWallet(
    D.str(req.body.userId),
    { ...req.body, amount: -Math.abs(D.num(req.body.amount)) },
    req.auth!.userId,
    req,
  );
  return ApiResponse.created(res, SUCCESS.WALLET.DEBITED, serializeWalletEntry(row));
});

// ═══ Payout ═══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /payments/payouts/getAll:
 *   get:
 *     tags: [Payments]
 *     summary: Payouts (vendor sees their own, admin sees all)
 *     responses:
 *       200: { description: Paginated payouts }
 */
export const payoutList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const isVendor = req.auth!.role === 'VENDOR';

  const { rows, total } = await service.listPayouts(
    { ...(req.query as any), skip, take },
    isVendor ? vendorId(req) : undefined,
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.PAYOUT.SUMMARY_FETCHED,
    result: { itemList: rows.map(serializePayoutDetail) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/payouts/earnings:
 *   get:
 *     tags: [Payments]
 *     summary: Vendor earnings with a status summary
 *     responses:
 *       200: { description: Paginated earnings plus totals by status }
 */
export const earnings = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const isVendor = req.auth!.role === 'VENDOR';

  const { rows, total, summary } = await service.listEarnings(
    { ...(req.query as any), skip, take },
    isVendor ? vendorId(req) : undefined,
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.PAYOUT.EARNINGS_FETCHED,
    result: { summary, itemList: rows.map(serializeVendorEarning) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/payouts/request:
 *   post:
 *     tags: [Payments]
 *     summary: Request a payout of cleared earnings (vendor)
 *     responses:
 *       201: { description: Payout requested }
 *       422: { description: Below minimum, nothing available, or no bank details }
 */
export const requestPayout = asyncHandler(async (req, res) => {
  const payout = await service.requestPayout(vendorId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.PAYOUT.REQUESTED, serializePayoutDetail(payout));
});

/**
 * @openapi
 * /payments/payouts/updateStatus/:id:
 *   patch:
 *     tags: [Payments]
 *     summary: Approve, reject or settle a payout (admin)
 *     responses:
 *       200: { description: Payout updated }
 *       422: { description: Transition not allowed }
 */
export const updatePayoutStatus = asyncHandler(async (req, res) => {
  const payout = await service.updatePayoutStatus(
    D.str(req.params.id),
    req.body,
    req.auth!.userId,
    req,
  );

  const messages: Record<string, string> = {
    APPROVED: SUCCESS.PAYOUT.APPROVED,
    REJECTED: SUCCESS.PAYOUT.REJECTED,
  };

  return ApiResponse.success(res, {
    message: messages[D.str(req.body.status)] ?? SUCCESS.PAYOUT.STATUS_UPDATED,
    result: serializePayoutDetail(payout),
  });
});

// ═══ Payout transition shortcuts ══════════════════════════════════════════════

/** Each of these pins the target status, so the route itself documents the intent. */
const transitionPayout = (status: string, message: string) =>
  asyncHandler(async (req: Request, res: any) => {
    const payout = await service.updatePayoutStatus(
      D.str(req.params.id),
      { ...req.body, status },
      req.auth!.userId,
      req,
    );

    return ApiResponse.success(res, { message, result: serializePayoutDetail(payout) });
  });

export const approvePayout = transitionPayout('APPROVED', SUCCESS.PAYOUT.APPROVED);
export const rejectPayout = transitionPayout('REJECTED', SUCCESS.PAYOUT.REJECTED);

/** POST /payouts/generateCycles — admin batch run */
export const generateCycles = asyncHandler(async (req, res) => {
  const result = await service.generatePayoutCycles(req);
  return ApiResponse.success(res, { message: SUCCESS.PAYOUT.GENERATED, result });
});

/** GET /payouts/getSummary — admin */
export const getSummary = asyncHandler(async (req, res) => {
  const result = await service.getPayoutSummary(req.query as any);
  return ApiResponse.success(res, { message: SUCCESS.PAYOUT.SUMMARY_FETCHED, result });
});

/** GET /payouts/getStatement/:vendorId — admin */
export const getStatement = asyncHandler(async (req, res) => {
  const vendorId = D.str(req.params.vendorId);
  const result = await service.getVendorStatement(vendorId, req.query as any);

  if (D.str(req.query.format as string) === 'pdf') {
    const { generatePayoutStatementPdf, pdfFileName } = await import('../../services/pdf.service');

    const pdf = await generatePayoutStatementPdf(
      result.vendorData,
      D.arr(result.earningList).map((e: any) => ({
        reference: D.str(e.orderId),
        date: D.str(e.createdAt),
        description: `Order ${e.orderId}`,
        qty: 1,
        rate: D.float(e.amount),
        amount: D.float(e.netAmount),
      })),
      {
        gross: D.float(result.grossAmount),
        commission: D.float(result.commissionAmount),
        net: D.float(result.netAmount),
      },
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${pdfFileName('PAYOUT_STATEMENT', vendorId)}"`,
    );
    return res.send(pdf);
  }

  return ApiResponse.success(res, { message: SUCCESS.PAYOUT.STATEMENT_GENERATED, result });
});

/** POST /payouts/bulkApprove — admin */
export const bulkApprove = asyncHandler(async (req, res) => {
  const result = await service.bulkApprovePayouts(req.body, req.auth!.userId, req);
  return ApiResponse.success(res, { message: SUCCESS.PAYOUT.BULK_APPROVED, result });
});

/** GET /payouts/getPendingAmount/:vendorId */
export const getPendingAmount = asyncHandler(async (req, res) => {
  const result = await service.getVendorPendingAmount(D.str(req.params.vendorId));
  return ApiResponse.success(res, { message: SUCCESS.PAYOUT.PENDING_FETCHED, result });
});

// ═══ Returns ══════════════════════════════════════════════════════════════════

/**
 * @openapi
 * /payments/returns/getAll:
 *   get:
 *     tags: [Returns]
 *     summary: Returns (customer sees their own, vendor sees their shop's)
 *     responses:
 *       200: { description: Paginated return requests }
 */
export const returnList = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const role = req.auth!.role;

  const { rows, total } = await service.listReturns(
    { ...(req.query as any), skip, take },
    role === 'CUSTOMER' ? userId(req) : undefined,
    role === 'VENDOR' ? vendorId(req) : undefined,
  );

  const settlementDays = await service.getReturnSettlementEta();

  return ApiResponse.paginated(res, {
    message: SUCCESS.RETURN.FETCHED,
    result: { itemList: rows.map((r) => serializeReturnDetail(r, settlementDays)) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /payments/returns/getById/:id:
 *   get:
 *     tags: [Returns]
 *     summary: A single return request with its items
 *     responses:
 *       200: { description: Return detail }
 *       404: { description: Not found or not visible to the caller }
 */
export const returnById = asyncHandler(async (req, res) => {
  const role = req.auth!.role;

  const row = await service.getReturnById(
    D.str(req.params.id),
    role === 'CUSTOMER' ? userId(req) : undefined,
    role === 'VENDOR' ? vendorId(req) : undefined,
  );

  const settlementDays = await service.getReturnSettlementEta();

  return ApiResponse.success(res, {
    message: SUCCESS.RETURN.RETRIEVED,
    result: serializeReturnDetail(row, settlementDays),
  });
});

/**
 * @openapi
 * /payments/returns/request:
 *   post:
 *     tags: [Returns]
 *     summary: Request a return on a delivered order
 *     description: >
 *       Only items actually bought can be returned, within the configured window.
 *     responses:
 *       201: { description: Return requested }
 *       422: { description: Window passed, item not purchased, or reason missing }
 */
export const requestReturn = asyncHandler(async (req, res) => {
  const row = await service.requestReturn(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.RETURN.REQUESTED, serializeReturnDetail(row));
});

/**
 * @openapi
 * /payments/returns/updateStatus/:id:
 *   patch:
 *     tags: [Returns]
 *     summary: Advance a return through its state machine
 *     responses:
 *       200: { description: Return updated }
 *       422: { description: Transition not allowed }
 */
export const updateReturnStatus = asyncHandler(async (req, res) => {
  const isVendor = req.auth!.role === 'VENDOR';

  const row = await service.updateReturnStatus(
    D.str(req.params.id),
    req.body,
    req.auth!.userId,
    isVendor ? vendorId(req) : undefined,
    req,
  );

  const messages: Record<string, string> = {
    APPROVED: SUCCESS.RETURN.APPROVED,
    REJECTED: SUCCESS.RETURN.REJECTED,
    PICKED_UP: SUCCESS.RETURN.PICKED_UP,
    RECEIVED: SUCCESS.RETURN.RECEIVED,
  };

  const settlementDays = await service.getReturnSettlementEta();

  return ApiResponse.success(res, {
    message: messages[D.str(req.body.status)] ?? SUCCESS.RETURN.FETCHED,
    result: serializeReturnDetail(row, settlementDays),
  });
});

/**
 * @openapi
 * /payments/returns/processRefund/:id:
 *   patch:
 *     tags: [Returns]
 *     summary: Refund a received return and put the stock back (admin)
 *     responses:
 *       200: { description: Refund completed }
 *       422: { description: Return has not been received yet }
 */
export const processReturnRefund = asyncHandler(async (req, res) => {
  const row = await service.processReturnRefund(
    D.str(req.params.id),
    req.body,
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.RETURN.REFUNDED,
    result: serializeReturnDetail(row),
  });
});

/**
 * @openapi
 * /payments/returns/reasons:
 *   get:
 *     tags: [Returns]
 *     summary: Return reasons
 *     responses:
 *       200: { description: Reason list }
 */
export const returnReasons = asyncHandler(async (req, res) => {
  const activeOnly = req.auth!.role === 'CUSTOMER';
  const rows = await service.listReturnReasons(activeOnly);

  return ApiResponse.success(res, {
    message: SUCCESS.RETURN.REASONS_FETCHED,
    result: { itemCount: rows.length, itemList: rows.map(serializeReturnReason) },
  });
});

/**
 * @openapi
 * /payments/returns/addReason:
 *   post:
 *     tags: [Returns]
 *     summary: Add a return reason (admin)
 *     responses:
 *       201: { description: Reason added }
 */
export const addReturnReason = asyncHandler(async (req, res) => {
  const row = await service.createReturnReason(req.body);
  return ApiResponse.created(res, SUCCESS.RETURN.REASON_ADDED, serializeReturnReason(row));
});

/**
 * @openapi
 * /payments/returns/updateReason/:id:
 *   patch:
 *     tags: [Returns]
 *     summary: Update a return reason (admin)
 *     responses:
 *       200: { description: Reason updated }
 */
export const updateReturnReason = asyncHandler(async (req, res) => {
  const row = await service.updateReturnReason(D.str(req.params.id), req.body);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.UPDATED,
    result: serializeReturnReason(row),
  });
});

// ═══ Return transition shortcuts ══════════════════════════════════════════════

/** Each of these pins the target status, so the route itself documents the intent. */
const transitionReturn = (status: string, message: string) =>
  asyncHandler(async (req: Request, res: any) => {
    const isVendor = req.auth!.role === 'VENDOR';

    const row = await service.updateReturnStatus(
      D.str(req.params.id),
      { ...req.body, status },
      req.auth!.userId,
      isVendor ? vendorId(req) : undefined,
      req,
    );

    const settlementDays = await service.getReturnSettlementEta();

    return ApiResponse.success(res, {
      message,
      result: serializeReturnDetail(row, settlementDays),
    });
  });

export const approveReturn = transitionReturn('APPROVED', SUCCESS.RETURN.APPROVED);
export const rejectReturn = transitionReturn('REJECTED', SUCCESS.RETURN.REJECTED);
export const markPickedUp = transitionReturn('PICKED_UP', SUCCESS.RETURN.PICKED_UP);
export const markReceived = transitionReturn('RECEIVED', SUCCESS.RETURN.RECEIVED);
