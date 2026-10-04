import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { PaymentMethod, PaymentStatus, PayoutStatus, type OrderStatus } from '@prisma/client';
import { ORDER_STATUS } from '../../constants/statuses';
import {
  getPaymentMethodsConfig,
  getTokenPolicy,
  getWalletConfig,
  getMinPayoutAmount,
  getVendorPayoutHoldDays,
} from '../../services/settings.service';
import { writeActivityLog } from '../../services/audit.service';
import { notifyUser } from '../../services/notification.service';
import { generateReturnNumber } from '../../utils/slug';
import { canTransitionReturn } from '../../constants/statuses';
import { getReturnConfig } from '../../services/settings.service';
import { addDays, daysBetween } from '../../utils/dates';
import { ENV, isRazorpayConfigured, isStripeConfigured } from '../../config/env.config';
import { GATEWAY } from '../../config/payment.config';
import { verifyGatewaySignature } from '../../utils/crypto';

const PAYMENT_INCLUDE = {
  order: { select: { id: true, orderNumber: true, status: true, total: true, userId: true } },
  user: { select: { id: true, name: true, email: true } },
  refunds: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export const listPayments = async (
  userId: string | null,
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ rows: PaymentRow[]; total: number }> => {
  const where: Prisma.PaymentWhereInput = {};

  if (userId) where.userId = userId;

  if (vendorId) where.order = { subOrders: { some: { vendorId } } };

  if (D.str(query.status)) where.status = query.status as PaymentStatus;
  if (D.str(query.method)) where.method = query.method as PaymentMethod;
  if (D.str(query.orderId)) where.orderId = D.str(query.orderId);

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: PAYMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.payment.count({ where }),
  ]);

  return { rows, total };
};

export const getPaymentByOrder = async (
  orderId: string,
  userId?: string,
): Promise<PaymentRow[]> => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...(userId ? { userId } : {}) },
    select: { id: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const payments = await prisma.payment.findMany({
    where: { orderId },
    include: PAYMENT_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  if (!payments.length) {
    throw AppError.notFound(ERROR.PAYMENT.NO_PAYMENT_RECORD);
  }

  return payments;
};

const outstanding = async (orderId: string): Promise<{ paid: number; due: number }> => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { total: true, walletAmount: true, tokenPaid: true, tokenAmount: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const paid = money(order.walletAmount + (order.tokenPaid ? order.tokenAmount : 0));

  return { paid, due: money(Math.max(0, order.total - paid)) };
};

export const verifyTokenPayment = async (
  userId: string,
  input: {
    orderId: string;
    paymentId?: string;
    method?: string;
    reference?: string;
    providerRef?: string;
  },
  req?: any,
): Promise<PaymentRow> => {
  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      walletAmount: true,
      tokenAmount: true,
      tokenRequired: true,
      tokenPaid: true,
    },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  if (!order.tokenRequired) {
    throw AppError.unprocessable(ERROR.PAYMENT.TOKEN_NOT_PENDING);
  }

  if (order.tokenPaid) {
    throw AppError.unprocessable(ERROR.PAYMENT.ALREADY_PAID);
  }

  const policy = await getTokenPolicy();

  if (D.str(input.method) && !policy.allowedMethods.includes(D.str(input.method))) {
    throw AppError.unprocessable(
      `This method is not accepted for token payments (${policy.allowedMethods.join(', ')}).`,
    );
  }

  const payment = await prisma.payment
    .update({
      where: { id: D.str(input.paymentId) },
      data: {
        status: PaymentStatus.PENDING,
        reference: D.str(input.reference) || D.str(input.providerRef),
        providerRef: D.str(input.providerRef),
      },
      include: PAYMENT_INCLUDE,
    })
    .catch(() => {
      throw AppError.notFound(ERROR.PAYMENT.NOT_FOUND);
    });

  const balanceDue = money(order.total - order.walletAmount);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        tokenPaid: true,
        balanceAmount: money(Math.max(0, balanceDue - order.tokenAmount)),
      },
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PAID,
        paidAmount: order.tokenAmount,
        isTokenPayment: true,
        paidAt: new Date(),
      },
    });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'TOKEN_PAYMENT_VERIFIED',
    entity: 'Order',
    entityId: order.id,
    meta: { amount: order.tokenAmount },
  });

  const updated = await prisma.payment.findUnique({
    where: { id: payment.id },
    include: PAYMENT_INCLUDE,
  });

  void notifyUser({
    userId,
    type: 'PAYMENT',
    title: `Payment received for ${order.orderNumber}`,
    body: `We recorded ${order.tokenAmount} as your advance payment.`,
    data: { orderId: order.id },
  });

  return updated as PaymentRow;
};

export const payBalance = async (
  userId: string,
  input: { orderId: string; method?: string; reference?: string },
  req?: any,
): Promise<PaymentRow> => {
  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      walletAmount: true,
      tokenAmount: true,
      tokenPaid: true,
      balancePaid: true,
    },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);
  if (order.balancePaid) throw AppError.unprocessable(ERROR.PAYMENT.ALREADY_PAID);

  const { paid, due } = await outstanding(order.id);

  if (due <= 0) {
    throw AppError.unprocessable(ERROR.PAYMENT.ALREADY_PAID);
  }

  const payment = await prisma.$transaction(async (tx) => {
    if (order.tokenPaid && order.status === ORDER_STATUS.PENDING_TOKEN) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: ORDER_STATUS.CONFIRMED as OrderStatus, balancePaid: true },
      });
      await tx.subOrder.updateMany({
        where: { orderId: order.id },
        data: { status: ORDER_STATUS.CONFIRMED as OrderStatus },
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PAID, balancePaid: true, balanceAmount: 0 },
    });

    return tx.payment.create({
      data: {
        orderId: order.id,
        userId,
        amount: due,
        paidAmount: due,
        method: (D.str(input.method) || PaymentMethod.UPI) as PaymentMethod,
        status: PaymentStatus.PAID,
        reference: D.str(input.reference),
        paidAt: new Date(),
      },
      include: PAYMENT_INCLUDE,
    });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'BALANCE_PAID',
    entity: 'Order',
    entityId: order.id,
    meta: { paid, due },
  });

  return payment as PaymentRow;
};

export const collectCod = async (
  input: { orderId: string; amount?: number; reference?: string },
  actorId?: string,
  req?: any,
): Promise<PaymentRow> => {
  const order = await prisma.order.findUnique({
    where: { id: D.str(input.orderId) },
    select: { id: true, orderNumber: true, total: true, walletAmount: true, userId: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: PaymentStatus.COD_PENDING },
    orderBy: { createdAt: 'desc' },
  });

  if (!payment) throw AppError.unprocessable(ERROR.PAYMENT.ALREADY_PAID);

  const amount = D.num(input.amount) || money(order.total - order.walletAmount);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.COD_COLLECTED,
        paidAmount: amount,
        reference: D.str(input.reference),
        collectedBy: D.str(actorId),
        paidAt: new Date(),
      },
      include: PAYMENT_INCLUDE,
    });

    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PAID, balancePaid: true },
    });

    return tx.payment.findUnique({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'COD_COLLECTED',
    entity: 'Order',
    entityId: order.id,
    meta: { amount },
  });

  void notifyUser({
    userId: order.userId,
    type: 'PAYMENT',
    title: `Payment received for ${order.orderNumber}`,
    body: `We recorded ${amount} as collected.`,
    data: { orderId: order.id },
  });

  return updated as PaymentRow;
};

export const initiateRefund = async (
  input: { orderId: string; paymentId?: string; amount?: number; reason: string; mode?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const order = await prisma.order.findUnique({
    where: { id: D.str(input.orderId) },
    select: { id: true, orderNumber: true, userId: true, total: true, walletAmount: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const payment = D.str(input.paymentId)
    ? await prisma.payment.findFirst({ where: { id: D.str(input.paymentId), orderId: order.id } })
    : await prisma.payment.findFirst({
        where: {
          orderId: order.id,
          status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        orderBy: { createdAt: 'desc' },
      });

  if (!payment) throw AppError.notFound(ERROR.PAYMENT.NO_PAYMENT_RECORD);

  const alreadyRefunded = await prisma.refund.aggregate({
    where: {
      paymentId: payment.id,
      status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
    },
    _sum: { amount: true },
  });

  const refundable = money(payment.paidAmount - D.float(alreadyRefunded._sum.amount));
  const amount = D.num(input.amount) || refundable;

  if (amount <= 0) {
    throw AppError.unprocessable(ERROR.PAYMENT.NOTHING_TO_REFUND);
  }

  if (amount > refundable) {
    throw AppError.unprocessable(
      `${ERROR.PAYMENT.REFUND_EXCEEDS_PAID} (refundable ${refundable})`,
      ERROR_CODE.REFUND_EXCEEDS_PAID,
    );
  }

  const mode = D.str(input.mode) || 'ORIGINAL';

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      orderId: order.id,
      amount,
      reason: input.reason,
      status: PaymentStatus.PENDING,
      isInitiatedBy: D.str(actorId) || 'CUSTOMER',
    },
    include: { payment: { select: { id: true, paidAmount: true } } },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'REFUND_INITIATED',
    entity: 'Refund',
    entityId: refund.id,
    meta: { amount, mode },
  });

  return refund;
};

export const processRefund = async (
  refundId: string,
  input: { status: string; providerRef?: string; reason?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { payment: true, order: { select: { id: true, orderNumber: true, userId: true } } },
  });

  if (!refund) throw AppError.notFound(ERROR.PAYMENT.NOT_FOUND);
  if (refund.status !== PaymentStatus.PENDING) {
    throw AppError.unprocessable(ERROR.PAYMENT.REFUND_PROCESSED);
  }

  const succeeded = D.str(input.status) === 'PAID';

  const updated = await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: (succeeded ? PaymentStatus.PAID : PaymentStatus.FAILED) as PaymentStatus,
        providerRef: D.str(input.providerRef),
        processedBy: D.str(actorId) || null,
        processedAt: new Date(),
      },
    });

    if (succeeded) {
      const settled = await tx.refund.aggregate({
        where: { paymentId: refund.paymentId, status: PaymentStatus.PAID },
        _sum: { amount: true },
      });

      const total = D.float(settled._sum.amount);
      const paid = D.float(refund.payment.paidAmount);

      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: total >= paid ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });

      await tx.order.update({
        where: { id: refund.orderId },
        data: {
          paymentStatus: total >= paid ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });
    }

    return tx.refund.findUniqueOrThrow({
      where: { id: refund.id },
      include: { payment: { select: { id: true, method: true } } },
    });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'REFUND_PROCESSED',
    entity: 'Refund',
    entityId: refund.id,
    meta: { status: input.status, amount: refund.amount },
  });

  void notifyUser({
    userId: refund.order.userId,
    type: 'PAYMENT',
    title: succeeded ? 'Refund processed' : 'Refund could not be processed',
    body: succeeded
      ? `${refund.amount} has been refunded for ${refund.order.orderNumber}.`
      : D.str(input.reason) || 'Please contact support.',
    data: { orderId: refund.orderId, refundId: refund.id },
  });

  return updated;
};

export const listRefunds = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.RefundWhereInput = {};

  if (D.str(query.status)) where.status = query.status as PaymentStatus;
  if (D.str(query.orderId)) where.orderId = D.str(query.orderId);

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      include: {
        payment: { select: { id: true, method: true, paidAmount: true, userId: true } },
        order: { select: { id: true, orderNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.refund.count({ where }),
  ]);

  return { rows, total };
};

export const getWalletBalance = async (userId: string): Promise<number> => {
  const [credits, debits] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        userId,
        status: 'SUCCESS',
        type: { in: ['CREDIT', 'REFUND', 'REWARD', 'ADJUSTMENT'] },
      },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { userId, status: 'SUCCESS', type: { in: ['DEBIT', 'REDEEM'] } },
      _sum: { amount: true },
    }),
  ]);

  return money(D.float(credits._sum.amount) - D.float(debits._sum.amount));
};

export const getWalletSummary = async (userId: string): Promise<Record<string, any>> => {
  const cfg = await getWalletConfig();
  const balance = await getWalletBalance(userId);

  const [credited, debited] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        userId,
        status: 'SUCCESS',
        type: { in: ['CREDIT', 'REFUND', 'REWARD', 'ADJUSTMENT'] },
      },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { userId, status: 'SUCCESS', type: { in: ['DEBIT', 'REDEEM'] } },
      _sum: { amount: true },
    }),
  ]);

  return {
    isEnabled: cfg.enabled,
    balance,
    totalCredited: D.float(credited._sum.amount),
    totalDebited: D.float(debited._sum.amount),
    maxBalance: cfg.maxBalance,
    minRedeem: cfg.minRedeem,
    expiryDays: cfg.expiryDays,
    canRedeem: cfg.enabled && balance >= cfg.minRedeem,
  };
};

export const listWalletTransactions = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.WalletTransactionWhereInput = { userId };

  if (D.str(query.type)) where.type = D.str(query.type) as any;
  if (D.str(query.status)) where.status = D.str(query.status);

  const [rows, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.walletTransaction.count({ where }),
  ]);

  return { rows, total };
};

export const adjustWallet = async (
  userId: string,
  input: { amount: number; description?: string; reference?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const cfg = await getWalletConfig();

  if (!cfg.enabled) throw AppError.unprocessable(ERROR.WALLET.NOT_ENABLED);

  const current = await getWalletBalance(userId);
  const next = money(current + D.num(input.amount));

  if (next < 0) {
    throw AppError.unprocessable(ERROR.WALLET.INSUFFICIENT_BALANCE);
  }

  if (next > cfg.maxBalance) {
    throw AppError.unprocessable(`${ERROR.WALLET.MAX_BALANCE} (${cfg.maxBalance})`);
  }

  const row = await prisma.walletTransaction.create({
    data: {
      userId,
      type: D.num(input.amount) >= 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(D.num(input.amount)),
      balanceAfter: next,
      description: D.str(input.description),
      reference: D.str(input.reference),
    },
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'WALLET_ADJUSTED',
    entity: 'WalletTransaction',
    entityId: row.id,
    meta: { amount: input.amount, balanceAfter: next },
  });

  void notifyUser({
    userId,
    type: 'PAYMENT',
    title: next >= current ? 'Wallet credited' : 'Wallet debited',
    body:
      D.str(input.description) ||
      `${Math.abs(D.num(input.amount))} ${next >= current ? 'added to' : 'deducted from'} your wallet.`,
    data: { transactionId: row.id, balance: next },
  });

  return row;
};

export const recordEarning = async (
  vendorId: string,
  subOrderId: string,
  orderId: string,
  input: { amount: number; commission: number; platformFee: number },
): Promise<any> => {
  const holdDays = await getVendorPayoutHoldDays();

  return prisma.vendorEarning.create({
    data: {
      vendorId,
      subOrderId,
      orderId,
      amount: money(input.amount),
      commission: money(input.commission),
      platformFee: money(input.platformFee),
      netAmount: money(input.amount - input.commission - input.platformFee),
      status: PayoutStatus.PENDING,
      period: periodKey(),
      isAvailable: false,
      availableAt: addDays(holdDays),
    },
  });
};

const periodKey = (date: Date = new Date()): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export const requestPayout = async (
  vendorId: string,
  input: { amount?: number; method?: string; notes?: string },
  req?: any,
): Promise<any> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: { id: true, bankAccountNo: true, bankIfsc: true, upiId: true, bankHolderName: true },
  });

  if (!vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND);

  const method = D.str(input.method) || (vendor.upiId ? 'UPI' : 'BANK');

  if (method === 'UPI' && !vendor.upiId) {
    throw AppError.unprocessable(ERROR.PAYOUT.BANK_DETAILS_REQUIRED);
  }

  if (method === 'BANK' && (!vendor.bankAccountNo || !vendor.bankIfsc)) {
    throw AppError.unprocessable(ERROR.PAYOUT.BANK_DETAILS_REQUIRED);
  }

  const minAmount = await getMinPayoutAmount();

  const claimed = await prisma.vendorEarning.findMany({
    where: {
      vendorId,
      status: { in: [PayoutStatus.PAID, PayoutStatus.PROCESSING] },
    },
    select: { id: true },
  });

  const available = await prisma.vendorEarning.findMany({
    where: {
      vendorId,
      isAvailable: true,
      status: PayoutStatus.PENDING,
      id: { notIn: claimed.map((e) => e.id) },
    },
    orderBy: { availableAt: 'asc' },
  });

  const availableTotal = money(available.reduce((sum, e) => sum + D.float(e.netAmount), 0));

  if (available.length === 0) {
    throw AppError.unprocessable(ERROR.PAYOUT.NO_EARNINGS);
  }

  const amount = D.num(input.amount) || availableTotal;

  if (amount < minAmount) {
    throw AppError.unprocessable(
      `${ERROR.PAYOUT.MIN_AMOUNT} (minimum ${minAmount})`,
      ERROR_CODE.PAYOUT_MIN_AMOUNT,
    );
  }

  if (amount > availableTotal) {
    throw AppError.unprocessable(
      `Requested ${amount} but only ${availableTotal} is available.`,
      ERROR_CODE.PAYOUT_MIN_AMOUNT,
    );
  }

  let remaining = amount;
  const claimedIds: string[] = [];

  for (const earning of available) {
    if (remaining <= 0) break;
    claimedIds.push(earning.id);
    remaining = money(remaining - D.float(earning.netAmount));
  }

  const payout = await prisma.$transaction(async (tx) => {
    const created = await tx.payout.create({
      data: {
        vendorId,
        amount,
        method,
        accountRef: method === 'UPI' ? D.str(vendor.upiId) : D.str(vendor.bankAccountNo),
        status: PayoutStatus.PENDING,
        period: periodKey(),
        notes: D.str(input.notes),
        requestedBy: D.str(req?.auth?.userId),
      },
    });

    await tx.vendorEarning.updateMany({
      where: { id: { in: claimedIds } },
      data: { status: PayoutStatus.APPROVED },
    });

    return created;
  });

  void writeActivityLog({
    req,
    action: 'PAYOUT_REQUESTED',
    entity: 'Payout',
    entityId: payout.id,
    meta: { amount, method, earnings: claimedIds.length },
  });

  return payout;
};

export const listPayouts = async (
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.PayoutWhereInput = {};

  if (vendorId) where.vendorId = vendorId;
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.status)) where.status = query.status as PayoutStatus;

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            shopName: true,
            slug: true,
            bankHolderName: true,
            bankIfsc: true,
            upiId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.payout.count({ where }),
  ]);

  return { rows, total };
};

export const listEarnings = async (
  query: Record<string, any>,
  vendorId?: string,
): Promise<{ rows: any[]; total: number; summary: Record<string, number> }> => {
  const where: Prisma.VendorEarningWhereInput = {};

  if (vendorId) where.vendorId = vendorId;
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.status)) where.status = query.status as PayoutStatus;
  if (D.str(query.period)) where.period = D.str(query.period);

  const [rows, total, grouped] = await Promise.all([
    prisma.vendorEarning.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.vendorEarning.count({ where }),
    prisma.vendorEarning.groupBy({ by: ['status'], where, _sum: { netAmount: true } }),
  ]);

  const summary: Record<string, number> = {};
  for (const g of grouped) summary[D.str(g.status)] = D.float(g._sum.netAmount);

  return { rows, total, summary };
};

export const releaseEarnings = async (): Promise<number> => {
  const { count } = await prisma.vendorEarning.updateMany({
    where: {
      isAvailable: false,
      status: PayoutStatus.PENDING,
      availableAt: { lte: new Date() },
    },
    data: { isAvailable: true },
  });

  return count;
};

export const updatePayoutStatus = async (
  payoutId: string,
  input: { status: string; reference?: string; notes?: string; rejectReason?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { vendor: { select: { id: true, shopName: true, userId: true } } },
  });

  if (!payout) throw AppError.notFound(ERROR.PAYOUT.NOT_FOUND);

  const allowed: Record<string, string[]> = {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['PROCESSING', 'PAID', 'FAILED'],
    PROCESSING: ['PAID', 'FAILED'],
    REJECTED: [],
    PAID: [],
    FAILED: ['PENDING'],
  };

  if (!(allowed[payout.status] ?? []).includes(D.str(input.status))) {
    throw AppError.unprocessable(
      `${ERROR.PAYOUT.INVALID_STATUS_TRANSITION} (${payout.status} -> ${input.status})`,
    );
  }

  if (D.str(input.status) === 'REJECTED' && !D.str(input.rejectReason)) {
    throw AppError.unprocessable(ERROR.PAYOUT.REJECTION_REASON_REQUIRED);
  }

  const next = D.str(input.status) as PayoutStatus;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payout.update({
      where: { id: payout.id },
      data: {
        status: next,
        reference: D.str(input.reference) || payout.reference,
        notes: D.str(input.notes) || payout.notes,
        rejectReason: D.str(input.rejectReason),
        approvedBy: next === 'APPROVED' ? D.str(actorId) || null : payout.approvedBy,
        approvedAt: next === 'APPROVED' ? new Date() : payout.approvedAt,
        processedAt: ['PAID', 'FAILED'].includes(next) ? new Date() : payout.processedAt,
      },
    });

    if (next === 'REJECTED') {
      const claimed = await tx.vendorEarning.findMany({
        where: { vendorId: payout.vendorId, status: PayoutStatus.APPROVED },
        select: { id: true },
      });

      await tx.vendorEarning.updateMany({
        where: { id: { in: claimed.map((e) => e.id) } },
        data: { status: PayoutStatus.PENDING },
      });
    }

    if (next === 'PAID') {
      const claimed = await tx.vendorEarning.findMany({
        where: { vendorId: payout.vendorId, status: PayoutStatus.APPROVED },
        select: { id: true },
      });

      await tx.vendorEarning.updateMany({
        where: { id: { in: claimed.map((e) => e.id) } },
        data: { status: PayoutStatus.PAID },
      });

      await tx.vendorProfile.update({
        where: { id: payout.vendorId },
        data: { pendingAmount: { decrement: payout.amount } },
      });
    }

    return tx.payout.findUniqueOrThrow({ where: { id: payout.id }, include: { vendor: true } });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'PAYOUT_STATUS_UPDATED',
    entity: 'Payout',
    entityId: payout.id,
    meta: { from: payout.status, to: next },
  });

  void notifyUser({
    userId: payout.vendor.userId,
    type: 'PAYOUT',
    title: `Payout ${next.toLowerCase()}`,
    body: `${payout.amount} — ${D.str(input.rejectReason) || D.str(input.notes) || payout.status}`,
    data: { payoutId: payout.id, status: next },
  });

  return updated;
};

const RETURN_INCLUDE = {
  reason: true,
  vendor: { select: { id: true, shopName: true, slug: true } },
  order: { select: { id: true, orderNumber: true, total: true, userId: true, status: true } },
  items: {
    include: {
      orderItem: {
        select: { id: true, productId: true, name: true, sku: true, image: true, price: true },
      },
    },
  },
} satisfies Prisma.ReturnRequestInclude;

type ReturnRow = Prisma.ReturnRequestGetPayload<{ include: typeof RETURN_INCLUDE }>;

export const listReturnReasons = async (activeOnly = false): Promise<any[]> =>
  prisma.returnReason.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

export const createReturnReason = async (input: {
  title: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<any> => {
  const { uniqueReturnReasonSlug } = await import('../../utils/slug');
  const slug = await uniqueReturnReasonSlug(D.str(input.title));

  return prisma.returnReason.create({
    data: {
      title: D.str(input.title),
      slug,
      isActive: input.isActive !== false,
      sortOrder: D.num(input.sortOrder),
    },
  });
};

export const updateReturnReason = async (
  id: string,
  input: { title?: string; isActive?: boolean; sortOrder?: number },
): Promise<any> => {
  const existing = await prisma.returnReason.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);

  return prisma.returnReason.update({
    where: { id },
    data: {
      ...(input.title ? { title: D.str(input.title) } : {}),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.sortOrder === undefined ? {} : { sortOrder: D.num(input.sortOrder) }),
    },
  });
};

export const requestReturn = async (
  userId: string,
  input: {
    orderId: string;
    subOrderId?: string;
    reasonId?: string;
    reasonText?: string;
    comment?: string;
    images?: string[];
    items: { orderItemId: string; qty: number }[];
  },
  req?: any,
): Promise<ReturnRow> => {
  const cfg = await getReturnConfig();

  if (!cfg.enabled) {
    throw AppError.unprocessable(ERROR.SYSTEM.FEATURE_DISABLED);
  }

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, status: true, createdAt: true, deliveredAt: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const delivered =
    order.status === ORDER_STATUS.DELIVERED || order.status === ORDER_STATUS.RETURNED;
  if (!delivered) {
    throw AppError.unprocessable(ERROR.RETURN.ORDER_NOT_DELIVERED);
  }

  const deliveredAt = order.deliveredAt ?? order.createdAt;
  if (daysBetween(deliveredAt, new Date()) > cfg.windowDays) {
    throw AppError.unprocessable(
      `${ERROR.RETURN.WINDOW_PASSED} (${cfg.windowDays} days)`,
      ERROR_CODE.RETURN_WINDOW_PASSED,
    );
  }

  if (cfg.reasonRequired && !D.str(input.reasonId) && !D.str(input.reasonText)) {
    throw AppError.unprocessable(ERROR.RETURN.REASON_REQUIRED);
  }

  if (cfg.imagesRequired && !D.arr(input.images).length) {
    throw AppError.unprocessable(ERROR.RETURN.IMAGES_REQUIRED);
  }

  if (D.str(input.reasonId)) {
    const reason = await prisma.returnReason.findFirst({
      where: { id: D.str(input.reasonId), isActive: true },
      select: { id: true },
    });

    if (!reason) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);
  }

  const requested = D.arr(input.items);
  const orderItems = await prisma.orderItem.findMany({
    where: { orderId: order.id, id: { in: requested.map((i) => D.str(i.orderItemId)) } },
    include: { subOrder: { select: { id: true, vendorId: true } } },
  });

  if (orderItems.length !== requested.length) {
    throw AppError.unprocessable(ERROR.RETURN.ITEM_NOT_PURCHASED, ERROR_CODE.PURCHASE_REQUIRED);
  }

  const alreadyReturned = await prisma.returnItem.findMany({
    where: { orderItemId: { in: orderItems.map((i) => i.id) } },
    select: { orderItemId: true, qty: true },
  });

  const returnedQty = new Map<string, number>();
  for (const row of alreadyReturned) {
    returnedQty.set(row.orderItemId, (returnedQty.get(row.orderItemId) ?? 0) + row.qty);
  }

  let refundAmount = 0;

  for (const request of requested) {
    const line = orderItems.find((i) => i.id === D.str(request.orderItemId));

    if (request.qty + (returnedQty.get(line!.id) ?? 0) > line!.qty) {
      throw AppError.unprocessable(
        `Cannot return ${request.qty} of "${line!.name}" — only ${line!.qty} were bought.`,
        ERROR_CODE.PURCHASE_REQUIRED,
      );
    }

    if (D.str(input.subOrderId) && line!.subOrderId !== D.str(input.subOrderId)) {
      throw AppError.unprocessable(ERROR.RETURN.VENDOR_MISMATCH);
    }

    refundAmount = money(refundAmount + (D.float(line!.total) / line!.qty) * request.qty);
  }

  const vendorIds = new Set(orderItems.map((i) => i.subOrder?.vendorId).filter(Boolean));
  const subOrderId =
    D.str(input.subOrderId) || (vendorIds.size === 1 ? D.str(orderItems[0].subOrderId) : '');

  if (vendorIds.size > 1 && !subOrderId) {
    throw AppError.unprocessable(ERROR.RETURN.MULTI_VENDOR_AMBIGUOUS);
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.returnRequest.create({
      data: {
        returnNumber: generateReturnNumber(),
        orderId: order.id,
        subOrderId: subOrderId || null,
        vendorId: vendorIds.size === 1 ? Array.from(vendorIds)[0] : null,
        userId,
        reasonId: D.str(input.reasonId) || null,
        reasonText: D.str(input.reasonText),
        comment: D.str(input.comment),
        images: D.arr(input.images).map(String),
        refundAmount,
        refundMode: cfg.refundMode,
        requestedAt: new Date(),
        items: {
          create: requested.map((r) => {
            const line = orderItems.find((i) => i.id === D.str(r.orderItemId))!;
            return {
              orderItemId: line.id,
              qty: r.qty,
              refundAmount: money((D.float(line.total) / line.qty) * r.qty),
              isApproved: true,
            };
          }),
        },
      },
    });

    await tx.orderTimeline.create({
      data: {
        orderId: order.id,
        status: ORDER_STATUS.RETURNED as OrderStatus,
        remark: `Return requested (${row.returnNumber})`,
      },
    });

    return tx.returnRequest.findUniqueOrThrow({ where: { id: row.id }, include: RETURN_INCLUDE });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'RETURN_REQUESTED',
    entity: 'ReturnRequest',
    entityId: created.id,
    meta: { refundAmount, items: requested.length },
  });

  void notifyUser({
    userId,
    type: 'RETURN',
    title: `Return requested for ${order.orderNumber}`,
    body: `We received your return request for ${refundAmount}.`,
    data: { returnId: created.id, orderId: order.id },
  });

  return created as ReturnRow;
};

export const listReturns = async (
  query: Record<string, any>,
  userId?: string,
  vendorId?: string,
): Promise<{ rows: ReturnRow[]; total: number }> => {
  const where: Prisma.ReturnRequestWhereInput = {};

  if (userId) where.userId = userId;
  if (vendorId) where.vendorId = vendorId;
  if (D.str(query.vendorId)) where.vendorId = D.str(query.vendorId);
  if (D.str(query.orderId)) where.orderId = D.str(query.orderId);
  if (D.str(query.status)) where.status = query.status as any;

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      include: RETURN_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.returnRequest.count({ where }),
  ]);

  return { rows, total };
};

export const getReturnById = async (
  id: string,
  userId?: string,
  vendorId?: string,
): Promise<ReturnRow> => {
  const row = await prisma.returnRequest.findUnique({ where: { id }, include: RETURN_INCLUDE });

  if (!row) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);

  if (userId && row.userId !== userId) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);
  if (vendorId && row.vendorId !== vendorId) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);

  return row as ReturnRow;
};

export const updateReturnStatus = async (
  id: string,
  input: {
    status: string;
    remark?: string;
    rejectReason?: string;
    itemApproval?: { returnItemId: string; isApproved: boolean }[];
  },
  actorId?: string,
  vendorId?: string,
  req?: any,
): Promise<ReturnRow> => {
  const row = await getReturnById(id, undefined, vendorId);

  if (!canTransitionReturn(row.status, D.str(input.status))) {
    throw AppError.unprocessable(
      `${ERROR.RETURN.INVALID_STATUS} (${row.status} -> ${input.status})`,
      ERROR_CODE.RETURN_INVALID_STATUS,
    );
  }

  if (D.str(input.status) === 'REJECTED' && !D.str(input.rejectReason)) {
    throw AppError.unprocessable(ERROR.PAYOUT.REJECTION_REASON_REQUIRED);
  }

  if (D.arr(input.itemApproval).length) {
    for (const entry of D.arr(input.itemApproval) as any[]) {
      const item = await prisma.returnItem.findFirst({
        where: { id: D.str(entry.returnItemId), returnRequestId: row.id },
        select: { id: true },
      });

      if (!item) throw AppError.notFound(ERROR.RETURN.NOT_FOUND);

      await prisma.returnItem.update({
        where: { id: item.id },
        data: { isApproved: Boolean(entry.isApproved) },
      });
    }
  }

  const approvedOnly = D.arr(input.itemApproval).length
    ? await prisma.returnItem.findMany({ where: { returnRequestId: row.id, isApproved: true } })
    : D.arr(row.items);

  const approvedAmount = money(
    approvedOnly.reduce((sum: number, i: any) => sum + D.float(i.refundAmount), 0),
  );

  const next = D.str(input.status);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.returnRequest.update({
      where: { id: row.id },
      data: {
        status: next as any,
        rejectReason: D.str(input.rejectReason),
        refundAmount: next === 'REJECTED' ? 0 : approvedAmount,
        ...(next === 'PICKED_UP' ? { pickedUpAt: new Date() } : {}),
        ...(next === 'RECEIVED' ? { receivedAt: new Date() } : {}),
      },
    });

    if (next === 'APPROVED') {
      await tx.order.update({
        where: { id: row.orderId },
        data: { status: ORDER_STATUS.RETURNED as OrderStatus },
      });
      await tx.orderTimeline.create({
        data: {
          orderId: row.orderId,
          status: ORDER_STATUS.RETURNED as OrderStatus,
          remark: `Return approved (${row.returnNumber})`,
        },
      });
    }

    if (next === 'REJECTED') {
      await tx.orderTimeline.create({
        data: {
          orderId: row.orderId,
          status: ORDER_STATUS.DELIVERED as OrderStatus,
          remark: `Return rejected (${row.returnNumber}): ${D.str(input.rejectReason)}`,
        },
      });
    }

    return tx.returnRequest.findUnique({ where: { id: row.id }, include: RETURN_INCLUDE });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'RETURN_STATUS_UPDATED',
    entity: 'ReturnRequest',
    entityId: row.id,
    meta: { from: row.status, to: next },
  });

  void notifyUser({
    userId: row.userId,
    type: 'RETURN',
    title: `Return ${next.toLowerCase().replace('_', ' ')}`,
    body:
      D.str(input.rejectReason) ||
      D.str(input.remark) ||
      `Return ${row.returnNumber} is now ${next.toLowerCase()}.`,
    data: { returnId: row.id },
  });

  return updated as ReturnRow;
};

export const processReturnRefund = async (
  id: string,
  input: { amount?: number; mode?: string; providerRef?: string },
  actorId?: string,
  req?: any,
): Promise<ReturnRow> => {
  const row = await getReturnById(id);

  if (row.status !== 'RECEIVED') {
    throw AppError.unprocessable(
      'The return must be received before it can be refunded.',
      ERROR_CODE.RETURN_INVALID_STATUS,
    );
  }

  const approved = await prisma.returnItem.findMany({
    where: { returnRequestId: row.id, isApproved: true },
    select: { id: true, orderItemId: true, qty: true, refundAmount: true },
  });

  const amount = D.num(input.amount) || money(approved.reduce((s, i) => s + i.refundAmount, 0));
  const mode = D.str(input.mode) || D.str(row.refundMode) || 'ORIGINAL';

  const payment = await prisma.payment.findFirst({
    where: { orderId: row.orderId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, paidAmount: true, status: true },
  });

  const refund = await prisma.$transaction(async (tx) => {
    if (payment) {
      await tx.refund.create({
        data: {
          paymentId: payment.id,
          orderId: row.orderId,
          amount,
          reason: `Return ${row.returnNumber}`,
          status: PaymentStatus.PAID,
          providerRef: D.str(input.providerRef),
          isInitiatedBy: 'RETURN',
          processedBy: D.str(actorId) || null,
          processedAt: new Date(),
        },
      });
    }

    if (mode === 'WALLET') {
      const balance = await getWalletBalance(row.userId);

      await tx.walletTransaction.create({
        data: {
          userId: row.userId,
          type: 'REFUND',
          amount,
          balanceAfter: money(balance + amount),
          orderId: row.orderId,
          description: `Return refund ${row.returnNumber}`,
          reference: row.returnNumber,
        },
      });
    }

    for (const item of approved) {
      const orderItem = await tx.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { productId: true, variantId: true, qty: true },
      });

      if (!orderItem) continue;

      if (orderItem.variantId) {
        await tx.productVariant.update({
          where: { id: orderItem.variantId },
          data: { stock: { increment: item.qty } },
        });
      } else {
        await tx.product.update({
          where: { id: orderItem.productId },
          data: { stock: { increment: item.qty }, status: 'ACTIVE' },
        });
      }
    }

    await tx.returnRequest.update({
      where: { id: row.id },
      data: {
        status: 'REFUNDED' as any,
        refundedAt: new Date(),
        refundAmount: amount,
        refundMode: mode,
      },
    });

    if (payment) {
      const settled = await tx.refund.aggregate({
        where: { paymentId: payment.id, status: PaymentStatus.PAID },
        _sum: { amount: true },
      });

      const total = D.float(settled._sum.amount);

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status:
            total >= D.float(payment.paidAmount)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });

      await tx.order.update({
        where: { id: row.orderId },
        data: {
          paymentStatus:
            total >= D.float(payment.paidAmount)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
      });
    }

    return tx.returnRequest.findUniqueOrThrow({ where: { id: row.id }, include: RETURN_INCLUDE });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'RETURN_REFUNDED',
    entity: 'ReturnRequest',
    entityId: row.id,
    meta: { amount, mode },
  });

  void notifyUser({
    userId: row.userId,
    type: 'RETURN',
    title: 'Refund processed',
    body: `${amount} has been refunded for return ${row.returnNumber}.`,
    data: { returnId: row.id },
  });

  return refund as ReturnRow;
};

export const getReturnSettlementEta = async (): Promise<number> => {
  const cfg = await getReturnConfig();
  return D.num(cfg.processingDays);
};

export const submitManualPayment = async (
  userId: string,
  input: {
    orderId: string;
    method: 'UPI' | 'BANK';
    reference: string;
    amount?: number;
    paymentId?: string;
    note?: string;
  },
  req?: any,
): Promise<PaymentRow> => {
  const cfg = await getPaymentMethodsConfig();

  if (input.method === 'UPI' && !cfg.upi.enabled) {
    throw AppError.unprocessable(ERROR.PAYMENT.METHOD_DISABLED);
  }

  if (input.method === 'BANK' && !cfg.bank.enabled) {
    throw AppError.unprocessable(ERROR.PAYMENT.METHOD_DISABLED);
  }

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, total: true, walletAmount: true, userId: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const amount = money(D.num(input.amount) || order.total - order.walletAmount);

  const payment = D.str(input.paymentId)
    ? await prisma.payment.update({
        where: { id: D.str(input.paymentId) },
        data: {
          method: PaymentMethod[input.method],
          reference: D.str(input.reference),
          paidAmount: amount,
          status: PaymentStatus.PENDING,
          providerRef: D.str(input.reference),
        },
        include: PAYMENT_INCLUDE,
      })
    : await prisma.payment.create({
        data: {
          orderId: order.id,
          userId,
          method: PaymentMethod[input.method],
          amount,
          reference: D.str(input.reference),
          paidAmount: amount,
          status: PaymentStatus.PENDING,
          providerRef: D.str(input.reference),
          failureReason: D.str(input.note),
        },
        include: PAYMENT_INCLUDE,
      });

  void writeActivityLog({
    req,
    userId,
    action: 'PAYMENT_SUBMITTED',
    entity: 'Payment',
    entityId: payment.id,
    meta: { method: input.method, reference: input.reference, amount },
  });

  return payment;
};

export const confirmPayment = async (
  paymentId: string,
  actorId?: string,
  req?: any,
): Promise<PaymentRow> => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, paidAmount: true, orderId: true, userId: true },
  });

  if (!payment) throw AppError.notFound(ERROR.PAYMENT.NOT_FOUND);

  if (payment.status === PaymentStatus.PAID) {
    throw AppError.unprocessable(ERROR.PAYMENT.ALREADY_PAID);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.PAID, paidAt: new Date() },
      include: PAYMENT_INCLUDE,
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: { paymentStatus: PaymentStatus.PAID },
    });

    return row;
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'PAYMENT_CONFIRMED',
    entity: 'Payment',
    entityId: payment.id,
    meta: { amount: payment.paidAmount },
  });

  void notifyUser({
    userId: payment.userId,
    type: 'PAYMENT',
    title: 'Payment confirmed',
    body: `We received your payment of ${payment.paidAmount}.`,
    data: { paymentId: payment.id },
  });

  return updated as PaymentRow;
};

export const listRefundsByOrder = async (
  orderId: string,
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  return listRefunds({ ...query, orderId });
};

const requireGateway = (name: string, configured: boolean): void => {
  if (!configured) {
    throw AppError.serviceUnavailable(
      `${name} is not configured for this environment.`,
      ERROR_CODE.SERVICE_UNAVAILABLE,
    );
  }
};

export const createGatewayOrder = async (
  userId: string,
  input: { orderId: string; amount?: number },
  req?: any,
): Promise<Record<string, any>> => {
  requireGateway('Razorpay', isRazorpayConfigured);

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, total: true, walletAmount: true, currency: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Razorpay = require('razorpay');
  const client = new Razorpay({ key_id: ENV.RAZORPAY_KEY_ID, key_secret: ENV.RAZORPAY_KEY_SECRET });

  const amount = money(D.num(input.amount) || order.total - order.walletAmount);

  const gatewayOrder = await client.orders.create({
    amount: Math.round(amount * 100),
    currency: order.currency,
    receipt: order.orderNumber,
    notes: { orderId: order.id, userId },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'GATEWAY_ORDER_CREATED',
    entity: 'Order',
    entityId: order.id,
    meta: { gateway: 'razorpay', amount },
  });

  return {
    provider: GATEWAY.RAZORPAY,
    gatewayOrderId: D.str(gatewayOrder.id),
    amount,
    currency: D.str(order.currency),
    keyId: D.str(ENV.RAZORPAY_KEY_ID),
  };
};

export const verifyGatewayPayment = async (
  userId: string,
  input: {
    orderId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  },
  req?: any,
): Promise<PaymentRow> => {
  requireGateway('Razorpay', isRazorpayConfigured);

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, total: true, walletAmount: true, currency: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const expected = verifyGatewaySignature(
    `${D.str(input.razorpayOrderId)}|${D.str(input.razorpayPaymentId)}`,
    D.str(input.razorpaySignature),
    D.str(ENV.RAZORPAY_KEY_SECRET),
  );

  if (!expected) {
    throw AppError.badRequest(ERROR.PAYMENT.INVALID_SIGNATURE, ERROR_CODE.INVALID_SIGNATURE);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Razorpay = require('razorpay');
  const client = new Razorpay({ key_id: ENV.RAZORPAY_KEY_ID, key_secret: ENV.RAZORPAY_KEY_SECRET });

  const gatewayPayment = await client.payments.fetch(D.str(input.razorpayPaymentId));

  if (D.str(gatewayPayment.status) !== 'captured') {
    throw AppError.unprocessable(ERROR.PAYMENT.FAILED);
  }

  const amount = money(Number(gatewayPayment.amount) / 100);

  const payment = await prisma.$transaction(async (tx) => {
    const row = await tx.payment.create({
      data: {
        orderId: order.id,
        userId,
        method: PaymentMethod.RAZORPAY,
        amount,
        reference: D.str(input.razorpayPaymentId),
        providerRef: D.str(input.razorpayOrderId),
        paidAmount: amount,
        status: PaymentStatus.PAID,
        paidAt: new Date(),
      },
      include: PAYMENT_INCLUDE,
    });

    await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: PaymentStatus.PAID, tokenPaid: true },
    });

    return row;
  });

  void writeActivityLog({
    req,
    userId,
    action: 'PAYMENT_VERIFIED',
    entity: 'Order',
    entityId: order.id,
    meta: { gateway: 'razorpay', amount },
  });

  return payment as PaymentRow;
};

export const createStripeIntent = async (
  userId: string,
  input: { orderId: string; amount?: number },
): Promise<Record<string, any>> => {
  requireGateway('Stripe', isStripeConfigured);

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, total: true, walletAmount: true, currency: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require('stripe');
  const stripe = new Stripe(ENV.STRIPE_KEY);

  const amount = money(D.num(input.amount) || order.total - order.walletAmount);

  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: D.str(order.currency).toLowerCase(),
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
  });

  return {
    provider: GATEWAY.STRIPE,
    intentId: D.str(intent.id),
    clientSecret: D.str(intent.client_secret),
    amount,
    currency: D.str(order.currency),
  };
};

export const getPayoutSummary = async (
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  const where: Prisma.PayoutWhereInput = D.str(query.vendorId)
    ? { vendorId: D.str(query.vendorId) }
    : {};

  const [byStatus, pendingEarnings] = await Promise.all([
    prisma.payout.groupBy({
      by: ['status'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.vendorEarning.aggregate({
      where: { status: PayoutStatus.PENDING },
      _sum: { netAmount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    statusList: byStatus.map((g: any) => ({
      status: D.str(g.status),
      count: D.num(g._count._all),
      amount: D.float(g._sum.amount),
    })),
    totalPayouts: byStatus.reduce((s: number, g: any) => s + D.num(g._count._all), 0),
    totalPaid: byStatus
      .filter((g: any) => D.str(g.status) === 'PAID')
      .reduce((s: number, g: any) => s + D.float(g._sum.amount), 0),
    pendingEarningCount: D.num(pendingEarnings._count._all),
    pendingEarningAmount: D.float(pendingEarnings._sum.netAmount),
  };
};

export const generatePayoutCycles = async (req?: any): Promise<Record<string, any>> => {
  const released = await releaseEarnings();
  const minAmount = await getMinPayoutAmount();

  const vendors = await prisma.vendorProfile.findMany({
    where: { status: 'APPROVED', deletedAt: null },
    select: { id: true },
  });

  const results: {
    vendorId: string;
    status: string;
    amount: number;
    error: string;
  }[] = [];

  for (const vendor of vendors) {
    const claimed = await prisma.vendorEarning.findMany({
      where: { vendorId: vendor.id, status: { in: [PayoutStatus.PAID, PayoutStatus.PROCESSING] } },
      select: { id: true },
    });

    const available = await prisma.vendorEarning.findMany({
      where: {
        vendorId: vendor.id,
        isAvailable: true,
        status: PayoutStatus.PENDING,
        id: { notIn: claimed.map((e) => e.id) },
      },
      orderBy: { availableAt: 'asc' },
    });

    const total = money(available.reduce((sum, e) => sum + D.float(e.netAmount), 0));

    if (total < minAmount) {
      results.push({ vendorId: vendor.id, status: 'SKIPPED', amount: total, error: '' });
      continue;
    }

    try {
      const payout = await requestPayout(vendor.id, { amount: total }, req);
      results.push({
        vendorId: vendor.id,
        status: 'CREATED',
        amount: D.float(payout.amount),
        error: '',
      });
    } catch (err) {
      results.push({
        vendorId: vendor.id,
        status: 'FAILED',
        amount: total,
        error: (err as Error)?.message ?? 'unknown error',
      });
    }
  }

  return {
    releasedEarnings: released,
    vendorCount: vendors.length,
    createdCount: results.filter((r) => r.status === 'CREATED').length,
    vendorList: results,
  };
};

export const bulkApprovePayouts = async (
  input: { payoutIds: string[]; notes?: string },
  actorId?: string,
  req?: any,
): Promise<{ approvedCount: number; failedList: { payoutId: string; reason: string }[] }> => {
  const failed: { payoutId: string; reason: string }[] = [];
  let approvedCount = 0;

  for (const payoutId of D.arr(input.payoutIds)) {
    try {
      await updatePayoutStatus(payoutId, { status: 'APPROVED', notes: input.notes }, actorId, req);
      approvedCount += 1;
    } catch (err) {
      failed.push({
        payoutId: D.str(payoutId),
        reason: (err as Error)?.message ?? 'unknown error',
      });
    }
  }

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'PAYOUTS_BULK_APPROVED',
    entity: 'Payout',
    meta: { approvedCount, failedCount: failed.length },
  });

  return { approvedCount, failedList: failed };
};

export const getVendorPendingAmount = async (vendorId: string): Promise<Record<string, any>> => {
  const claimed = await prisma.vendorEarning.findMany({
    where: { vendorId, status: { in: [PayoutStatus.PAID, PayoutStatus.PROCESSING] } },
    select: { id: true },
  });

  const [available, held] = await Promise.all([
    prisma.vendorEarning.findMany({
      where: {
        vendorId,
        isAvailable: true,
        status: PayoutStatus.PENDING,
        id: { notIn: claimed.map((e) => e.id) },
      },
      select: { netAmount: true },
    }),
    prisma.vendorEarning.findMany({
      where: { vendorId, isAvailable: false, status: PayoutStatus.PENDING },
      select: { netAmount: true },
    }),
  ]);

  const minAmount = await getMinPayoutAmount();
  const availableAmount = money(available.reduce((s, e) => s + D.float(e.netAmount), 0));

  return {
    vendorId: D.str(vendorId),
    availableAmount,
    heldAmount: money(held.reduce((s, e) => s + D.float(e.netAmount), 0)),
    minPayoutAmount: minAmount,
    isEligible: availableAmount >= minAmount,
    availableCount: available.length,
  };
};

export const getVendorStatement = async (
  vendorId: string,
  query: Record<string, any>,
): Promise<Record<string, any>> => {
  const where: Prisma.VendorEarningWhereInput = { vendorId };

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const [earnings, payouts, vendor] = await Promise.all([
    prisma.vendorEarning.findMany({ where, orderBy: { createdAt: 'desc' } }),
    prisma.payout.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' } }),
    prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        shopName: true,
        slug: true,
        bankHolderName: true,
        bankIfsc: true,
        upiId: true,
      },
    }),
  ]);

  const gross = money(earnings.reduce((s, e) => s + D.float(e.amount), 0));
  const commission = money(earnings.reduce((s, e) => s + D.float(e.commission), 0));
  const platformFee = money(earnings.reduce((s, e) => s + D.float(e.platformFee), 0));

  return {
    vendorData: {
      vendorId: D.str(vendor?.id),
      shopName: D.str(vendor?.shopName),
      slug: D.str(vendor?.slug),
      bankHolderName: D.str(vendor?.bankHolderName),
      bankIfsc: D.str(vendor?.bankIfsc),
      upiId: D.str(vendor?.upiId),
    },
    earningCount: earnings.length,
    payoutCount: payouts.length,
    grossAmount: gross,
    commissionAmount: commission,
    platformFeeAmount: platformFee,
    netAmount: money(gross - commission - platformFee),
    paidAmount: money(
      payouts
        .filter((p) => p.status === PayoutStatus.PAID)
        .reduce((s, p) => s + D.float(p.amount), 0),
    ),
    earningList: earnings.map((e: any) => ({
      earningId: D.str(e.id),
      orderId: D.str(e.orderId),
      amount: D.float(e.amount),
      commission: D.float(e.commission),
      platformFee: D.float(e.platformFee),
      netAmount: D.float(e.netAmount),
      status: D.str(e.status),
      period: D.str(e.period),
      createdAt: D.date(e.createdAt),
    })),
    payoutList: payouts.map((p: any) => ({
      payoutId: D.str(p.id),
      amount: D.float(p.amount),
      method: D.str(p.method),
      status: D.str(p.status),
      reference: D.str(p.reference),
      period: D.str(p.period),
      createdAt: D.date(p.createdAt),
    })),
  };
};

export const addMoneyToWallet = async (
  userId: string,
  input: { amount: number; method?: string; reference?: string },
  req?: any,
): Promise<any> => {
  const cfg = await getWalletConfig();

  if (!cfg.enabled) throw AppError.unprocessable(ERROR.WALLET.NOT_ENABLED);

  const amount = D.num(input.amount);

  if (amount < cfg.minRedeem) {
    throw AppError.unprocessable(
      `${ERROR.WALLET.MIN_REDEEM} (minimum ${cfg.minRedeem})`,
      ERROR_CODE.MIN_LIMIT,
    );
  }

  const current = await getWalletBalance(userId);
  const next = money(current + amount);

  if (next > cfg.maxBalance) {
    throw AppError.unprocessable(
      `${ERROR.WALLET.MAX_BALANCE} (maximum ${cfg.maxBalance})`,
      ERROR_CODE.MAX_LIMIT,
    );
  }

  const row = await prisma.walletTransaction.create({
    data: {
      userId,
      type: 'CREDIT',
      amount,
      balanceAfter: next,
      description: D.str(input.method) ? `Wallet top-up via ${input.method}` : 'Wallet top-up',
      reference: D.str(input.reference),
      status: 'PENDING',
    },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'WALLET_TOPUP_REQUESTED',
    entity: 'WalletTransaction',
    entityId: row.id,
    meta: { amount, reference: input.reference },
  });

  return row;
};

export const useWalletForOrder = async (
  userId: string,
  input: { orderId: string; amount?: number },
  req?: any,
): Promise<any> => {
  const cfg = await getWalletConfig();

  if (!cfg.enabled) throw AppError.unprocessable(ERROR.WALLET.NOT_ENABLED);

  const order = await prisma.order.findFirst({
    where: { id: D.str(input.orderId), userId },
    select: { id: true, orderNumber: true, total: true, walletAmount: true },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  const amount = money(D.num(input.amount) || order.total - order.walletAmount);

  if (amount < cfg.minRedeem && D.num(input.amount) > 0) {
    throw AppError.unprocessable(
      `${ERROR.WALLET.MIN_REDEEM} (minimum ${cfg.minRedeem})`,
      ERROR_CODE.MIN_LIMIT,
    );
  }

  const current = await getWalletBalance(userId);

  if (amount > current) {
    throw AppError.unprocessable(ERROR.WALLET.INSUFFICIENT_BALANCE);
  }

  const next = money(current - amount);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.walletTransaction.create({
      data: {
        userId,
        type: 'REDEEM',
        amount,
        balanceAfter: next,
        orderId: order.id,
        description: `Wallet used for order ${order.orderNumber}`,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: { walletAmount: money(order.walletAmount + amount) },
    });

    return created;
  });

  void writeActivityLog({
    req,
    userId,
    action: 'WALLET_USED',
    entity: 'Order',
    entityId: order.id,
    meta: { amount, balanceAfter: next },
  });

  return { ...row, balance: next };
};

export { getPaymentMethodsConfig };
