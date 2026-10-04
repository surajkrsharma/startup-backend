import {
  GiftCardStatus,
  LoyaltyTxnType,
  NotificationChannel,
  Prisma,
  ReferralStatus,
} from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { D } from '../../utils/defaults';
import { money } from '../../utils/calculations';
import { generateCode } from '../../utils/slug';
import { LOYALTY_TIER } from '../../config/currency.config';
import {
  getLoyaltyConfig,
  getReferralConfig,
  getGiftCardConfig,
} from '../../services/settings.service';
import { writeActivityLog, writeAuditLog } from '../../services/audit.service';

const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + Math.max(0, D.num(days)) * 24 * 60 * 60 * 1000);

const currentBalance = async (userId: string): Promise<number> => {
  const total = await prisma.loyaltyTransaction.aggregate({
    where: { userId },
    _sum: { points: true },
  });

  return D.num(total._sum?.points);
};

const tierFor = (balance: number) =>
  [...LOYALTY_TIER].reverse().find((t) => balance >= D.num(t.minPoints)) ?? LOYALTY_TIER[0];

export const getLoyaltySummary = async (userId: string): Promise<Record<string, any>> => {
  const config = await getLoyaltyConfig();

  const balance = await currentBalance(userId);
  const [earned, redeemed, expired, history] = await Promise.all([
    prisma.loyaltyTransaction.aggregate({
      where: { userId, type: 'EARN' },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { userId, type: 'REDEEM' },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.aggregate({
      where: { userId, type: 'EXPIRE' },
      _sum: { points: true },
    }),
    prisma.loyaltyTransaction.count({ where: { userId } }),
  ]);

  const tier = tierFor(balance);
  const nextTier = [...LOYALTY_TIER].find((t) => D.num(t.minPoints) > balance);

  return {
    userId,
    isEnabled: config.enabled,
    balance,
    tier: D.str(tier.name),
    multiplier: D.float(tier.multiplier),

    pointsToNextTier: nextTier ? D.num(nextTier.minPoints) - balance : 0,
    nextTier: D.str(nextTier?.name ?? tier.name),
    totalEarned: D.num(earned._sum.points),
    totalRedeemed: D.num(redeemed._sum.points),
    totalExpired: D.num(expired._sum.points),
    transactionCount: D.num(history),
    pointValue: config.pointValue,
    redeemableAmount: money(balance * config.pointValue),
    minRedeemPoints: config.minRedeemPoints,
    tierList: LOYALTY_TIER.map((t) => ({
      name: t.name,
      minPoints: D.num(t.minPoints),
      multiplier: D.float(t.multiplier),
    })),
  };
};

export const listLoyaltyTiers = (): Record<string, any>[] =>
  LOYALTY_TIER.map((t) => ({
    name: t.name,
    minPoints: D.num(t.minPoints),
    multiplier: D.float(t.multiplier),
  }));

export const listLoyaltyHistory = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.LoyaltyTransactionWhereInput = { userId };

  if (D.str(query.type)) where.type = D.str(query.type) as LoyaltyTxnType;

  const [rows, total] = await Promise.all([
    prisma.loyaltyTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.loyaltyTransaction.count({ where }),
  ]);

  return { rows, total };
};

const writeLoyaltyTxn = async (
  userId: string,
  input: { type: LoyaltyTxnType; points: number; orderId?: string; description?: string },
  tx?: Prisma.TransactionClient,
): Promise<{ balanceAfter: number; row: any }> => {
  const client = tx ?? prisma;
  const balance = money((await currentBalance(userId)) + D.num(input.points));

  const row = await client.loyaltyTransaction.create({
    data: {
      userId,
      type: input.type,
      points: D.num(input.points),
      balanceAfter: balance,
      orderId: D.str(input.orderId),
      description: D.str(input.description),
    },
  });

  await client.user.update({
    where: { id: userId },
    data: { loyaltyTier: D.str(tierFor(balance).name) },
  });

  return { balanceAfter: balance, row };
};

export const earnPoints = async (
  userId: string,
  orderId: string,
  orderValue: number,
): Promise<{ points: number; balanceAfter: number }> => {
  const config = await getLoyaltyConfig();

  if (!config.enabled) return { points: 0, balanceAfter: await currentBalance(userId) };

  const points = Math.max(0, Math.floor(money(D.float(orderValue)) * config.pointsPerRupee));

  if (points <= 0) return { points: 0, balanceAfter: await currentBalance(userId) };

  const existing = await prisma.loyaltyTransaction.findFirst({
    where: { userId, orderId, type: 'EARN' },
    select: { id: true },
  });

  if (existing) return { points: 0, balanceAfter: await currentBalance(userId) };

  const result = await prisma.$transaction((tx) =>
    writeLoyaltyTxn(
      userId,
      { type: 'EARN', points, orderId, description: `Earned on order ${orderId}` },
      tx,
    ),
  );

  return { points, balanceAfter: result.balanceAfter };
};

export const redeemPoints = async (
  userId: string,
  points: number,
  req?: any,
): Promise<Record<string, any>> => {
  const config = await getLoyaltyConfig();

  if (!config.enabled) throw AppError.forbidden(ERROR.LOYALTY.NOT_ENABLED);

  const requested = D.num(points);

  if (requested < config.minRedeemPoints) throw AppError.unprocessable(ERROR.LOYALTY.MIN_POINTS);

  const balance = await currentBalance(userId);

  if (requested > balance) throw AppError.unprocessable(ERROR.LOYALTY.INSUFFICIENT_POINTS);

  const result = await prisma.$transaction((tx) =>
    writeLoyaltyTxn(
      userId,
      { type: 'REDEEM', points: -requested, description: 'Points redeemed for wallet credit' },
      tx,
    ),
  );

  void writeActivityLog({
    req,
    userId,
    action: 'LOYALTY_REDEEMED',
    entity: 'LoyaltyTransaction',
    entityId: result.row.id,
    meta: { points: requested },
  });

  return {
    userId,
    redeemedPoints: requested,
    amount: money(requested * config.pointValue),
    balanceAfter: result.balanceAfter,
    tier: D.str(tierFor(result.balanceAfter).name),
  };
};

export const adjustPoints = async (
  targetUserId: string,
  points: number,
  description: string,
  req?: any,
): Promise<Record<string, any>> => {
  const amount = D.num(points);

  if (amount === 0) throw AppError.badRequest(ERROR.LOYALTY.ZERO_POINTS);

  const user = await prisma.user.findFirst({
    where: { id: targetUserId, deletedAt: null },
    select: { id: true },
  });

  if (!user) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  if (amount < 0) {
    const balance = await currentBalance(targetUserId);

    if (Math.abs(amount) > balance) throw AppError.unprocessable(ERROR.LOYALTY.INSUFFICIENT_POINTS);
  }

  const result = await prisma.$transaction((tx) =>
    writeLoyaltyTxn(
      targetUserId,
      { type: 'ADJUSTMENT', points: amount, description: D.str(description) || 'Admin adjustment' },
      tx,
    ),
  );

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'LoyaltyTransaction',
    entityId: result.row.id,
    meta: { points: amount },
  });

  return {
    userId: targetUserId,
    adjustedPoints: amount,
    balanceAfter: result.balanceAfter,
    tier: D.str(tierFor(result.balanceAfter).name),
  };
};

const ensureReferralCode = async (userId: string): Promise<string> => {
  const existing = await prisma.referral.findFirst({
    where: { referrerId: userId, refereeId: null },
    select: { referralCode: true },
  });

  if (existing?.referralCode) return existing.referralCode;

  for (let i = 0; i < 5; i += 1) {
    const code = `REF${generateCode(8)}`;

    const clash = await prisma.referral.findFirst({
      where: { referralCode: code, refereeId: null },
      select: { id: true },
    });

    if (clash) continue;

    await prisma.referral.create({
      data: { referrerId: userId, refereeId: null, referralCode: code },
    });

    return code;
  }

  throw AppError.internal(ERROR.REFERRAL.ALLOCATION_FAILED);
};

export const getReferralSummary = async (userId: string): Promise<Record<string, any>> => {
  const config = await getReferralConfig();

  const code = await ensureReferralCode(userId);

  const [made, completed, rewards] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId, refereeId: { not: null } } }),
    prisma.referral.count({ where: { referrerId: userId, status: 'COMPLETED' } }),
    prisma.referral.aggregate({
      where: { referrerId: userId, status: 'COMPLETED' },
      _sum: { referrerReward: true },
    }),
  ]);

  return {
    userId,
    isEnabled: config.enabled,
    referralCode: code,
    referralCount: D.num(made),
    completedCount: D.num(completed),
    totalEarned: money(D.float(rewards._sum.referrerReward)),
    referrerReward: config.referrerReward,
    refereeReward: config.refereeReward,
    expiryDays: config.expiryDays,
  };
};

export const applyReferralCode = async (
  userId: string,
  code: string,
  req?: any,
): Promise<Record<string, any>> => {
  const config = await getReferralConfig();

  if (!config.enabled) throw AppError.forbidden(ERROR.SYSTEM.FEATURE_DISABLED);

  const existing = await prisma.referral.findUnique({
    where: { refereeId: userId },
    select: { id: true },
  });

  if (existing) throw AppError.conflict(ERROR.REFERRAL.ALREADY_APPLIED, ERROR_CODE.DUPLICATE);

  const codeRow = await prisma.referral.findFirst({
    where: { referralCode: D.str(code).toUpperCase(), refereeId: null },
    select: { id: true, referrerId: true },
  });

  if (!codeRow) throw AppError.notFound(ERROR.REFERRAL.INVALID_CODE);
  if (codeRow.referrerId === userId) throw AppError.badRequest(ERROR.REFERRAL.SELF_REFERRAL);

  const row = await prisma.referral.create({
    data: {
      referrerId: codeRow.referrerId,
      refereeId: userId,
      referralCode: D.str(code).toUpperCase(),
      status: 'PENDING',
      referrerReward: config.referrerReward,
      refereeReward: config.refereeReward,
      expiresAt: addDays(new Date(), config.expiryDays),
    },
  });

  await prisma.user.update({ where: { id: userId }, data: { referredById: codeRow.referrerId } });

  void writeActivityLog({
    req,
    userId,
    action: 'REFERRAL_APPLIED',
    entity: 'Referral',
    entityId: row.id,
  });

  return {
    referralId: D.str(row.id),
    status: D.str(row.status),
    referrerReward: D.float(row.referrerReward),
    refereeReward: D.float(row.refereeReward),
    expiresAt: D.date(row.expiresAt),
  };
};

export const listMyReferrals = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.ReferralWhereInput = { referrerId: userId, refereeId: { not: null } };

  if (D.str(query.status)) where.status = D.str(query.status) as ReferralStatus;

  const [rows, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: { referee: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.referral.count({ where }),
  ]);

  return { rows, total };
};

export const listAllReferrals = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.ReferralWhereInput = { refereeId: { not: null } };

  if (D.str(query.status)) where.status = D.str(query.status) as ReferralStatus;

  const [rows, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: { referee: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.referral.count({ where }),
  ]);

  return { rows, total };
};

export const completeReferral = async (
  referralId: string,
  req?: any,
): Promise<Record<string, any>> => {
  const existing = await prisma.referral.findUnique({ where: { id: referralId } });

  if (!existing) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  if (existing.status === 'COMPLETED')
    return { referralId, status: 'COMPLETED', alreadyCompleted: true };

  if (existing.status !== 'PENDING') throw AppError.unprocessable(ERROR.REFERRAL.EXPIRED);

  if (!existing.refereeId) throw AppError.unprocessable(ERROR.REFERRAL.NOT_APPLIED);

  const config = await getReferralConfig();
  const referrerReward = D.float(existing.referrerReward) || config.referrerReward;
  const refereeReward = D.float(existing.refereeReward) || config.refereeReward;

  const payouts: { userId: string; amount: number; description: string }[] = [
    { userId: existing.referrerId, amount: referrerReward, description: 'Referral reward' },
    {
      userId: D.str(existing.refereeId),
      amount: refereeReward,
      description: 'Referral signup bonus',
    },
  ];

  const row = await prisma.$transaction(async (tx) => {
    const settled = await tx.referral.update({
      where: { id: referralId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    for (const payout of payouts) {
      const balance = await tx.walletTransaction.aggregate({
        where: { userId: payout.userId, status: 'SUCCESS' },
        _sum: { amount: true },
      });

      await tx.walletTransaction.create({
        data: {
          userId: payout.userId,
          type: 'CREDIT',
          amount: money(payout.amount),
          balanceAfter: money(D.float(balance._sum?.amount) + payout.amount),
          description: payout.description,
          reference: `referral_${D.str(referralId)}`,
        },
      });
    }

    return settled;
  });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'Referral',
    entityId: referralId,
    meta: { referrerReward, refereeReward },
  });

  return {
    referralId,
    status: D.str(row.status),
    referrerReward,
    refereeReward,
    completedAt: D.date(row.completedAt),
    alreadyCompleted: false,
  };
};

export const updateReferralStatus = async (
  referralId: string,
  status: ReferralStatus,
  req?: any,
): Promise<Record<string, any>> => {
  const existing = await prisma.referral.findUnique({
    where: { id: referralId },
    select: { id: true, status: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  const row = await prisma.referral.update({ where: { id: referralId }, data: { status } });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'Referral',
    entityId: referralId,
    meta: { from: existing.status, to: status },
  });

  return {
    referralId: D.str(row.id),
    status: D.str(row.status),
    completedAt: D.date(row.completedAt),
    expiresAt: D.date(row.expiresAt),
    createdAt: D.date(row.createdAt),
  };
};

export const expireStaleReferrals = async (): Promise<number> => {
  const { count } = await prisma.referral.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });

  return D.num(count);
};

const giftCardValue = (input: Record<string, any>): number => {
  const value = money(D.float(input.value));

  if (value <= 0) throw AppError.badRequest(ERROR.GIFT_CARD.INVALID_VALUE);

  return value;
};

export const listGiftCards = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.GiftCardWhereInput = { userId };

  if (D.str(query.status)) where.status = D.str(query.status) as GiftCardStatus;

  const [rows, total] = await Promise.all([
    prisma.giftCard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.giftCard.count({ where }),
  ]);

  return { rows, total };
};

export const listAllGiftCards = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.GiftCardWhereInput = {};

  if (D.str(query.status)) where.status = D.str(query.status) as GiftCardStatus;

  const [rows, total] = await Promise.all([
    prisma.giftCard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.giftCard.count({ where }),
  ]);

  return { rows, total };
};

export const createGiftCard = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const config = await getGiftCardConfig();

  if (!config.enabled) throw AppError.forbidden(ERROR.SYSTEM.FEATURE_DISABLED);

  const value = giftCardValue(input);

  if (value < config.minAmount || value > config.maxAmount) {
    throw AppError.badRequest(
      `Gift card value must be between ${config.minAmount} and ${config.maxAmount}.`,
    );
  }

  let code = D.str(input.code).toUpperCase();

  if (code) {
    const clash = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
    if (clash) throw AppError.conflict(ERROR.GIFT_CARD.CODE_EXISTS, ERROR_CODE.DUPLICATE);
  } else {
    for (let i = 0; i < 5; i += 1) {
      code = `GC${generateCode(18)}`;
      const clash = await prisma.giftCard.findUnique({ where: { code }, select: { id: true } });
      if (!clash) break;
    }
  }

  if (D.str(input.userId)) {
    const owner = await prisma.user.findFirst({
      where: { id: D.str(input.userId), deletedAt: null },
      select: { id: true },
    });
    if (!owner) throw AppError.notFound(ERROR.USER.NOT_FOUND);
  }

  const expiresInDays =
    input.expiresInDays === undefined ? config.expiryDays : D.num(input.expiresInDays);

  const row = await prisma.giftCard.create({
    data: {
      code,
      title: D.str(input.title),
      description: D.str(input.description),
      value,
      initialValue: value,
      userId: D.str(input.userId) || null,
      status: 'ACTIVE',
      expiresAt: expiresInDays > 0 ? addDays(new Date(), expiresInDays) : null,
    },
  });

  void writeAuditLog({
    req,
    action: 'CREATE',
    entity: 'GiftCard',
    entityId: row.id,
    meta: { code: row.code, value },
  });

  return {
    giftCardId: D.str(row.id),
    code: D.str(row.code),
    title: D.str(row.title),
    description: D.str(row.description),
    value: D.float(row.value),
    status: D.str(row.status),
    userId: D.str(row.userId),
    usedOrderId: D.str(row.usedOrderId),
    expiresAt: D.date(row.expiresAt),
    redeemedAt: D.date(row.redeemedAt),
    createdAt: D.date(row.createdAt),
  };
};

export const checkGiftCard = async (code: string): Promise<Record<string, any>> => {
  const row = await prisma.giftCard.findUnique({ where: { code: D.str(code).toUpperCase() } });

  if (!row) throw AppError.notFound(ERROR.GIFT_CARD.NOT_FOUND);

  const expired = Boolean(row.expiresAt) && new Date(row.expiresAt as Date) < new Date();

  return {
    code: D.str(row.code),
    title: D.str(row.title),
    balance: D.float(row.value),
    initialValue: D.float(row.initialValue),
    isValid: D.str(row.status) === 'ACTIVE' && !expired,
    isExpired: expired,
    status: D.str(row.status),
    expiresAt: D.date(row.expiresAt),
  };
};

export const redeemGiftCard = async (
  code: string,
  input: { orderId?: string; amount?: number },
  req?: any,
): Promise<Record<string, any>> => {
  const card = await prisma.giftCard.findUnique({ where: { code: D.str(code).toUpperCase() } });

  if (!card) throw AppError.notFound(ERROR.GIFT_CARD.NOT_FOUND);
  if (D.str(card.status) === 'DISABLED') throw AppError.forbidden(ERROR.GIFT_CARD.DISABLED);
  if (D.str(card.status) === 'REDEEMED')
    throw AppError.unprocessable(ERROR.GIFT_CARD.ALREADY_REDEEMED);
  if (card.expiresAt && new Date(card.expiresAt) < new Date())
    throw AppError.unprocessable(ERROR.GIFT_CARD.EXPIRED);
  if (D.float(card.value) <= 0) throw AppError.unprocessable(ERROR.GIFT_CARD.INSUFFICIENT_BALANCE);

  const requested = input.amount === undefined ? D.float(card.value) : money(D.float(input.amount));

  if (requested <= 0) throw AppError.badRequest(ERROR.GIFT_CARD.INVALID_REDEEM_AMOUNT);

  const applied = Math.min(requested, D.float(card.value));

  const row = await prisma.$transaction(async (tx) => {
    const locked = await tx.giftCard.findUnique({ where: { id: card.id } });

    if (!locked) throw AppError.notFound(ERROR.GIFT_CARD.NOT_FOUND);
    if (D.str(locked.status) === 'REDEEMED')
      throw AppError.unprocessable(ERROR.GIFT_CARD.ALREADY_REDEEMED);

    const remaining = money(D.float(locked.value) - applied);

    if (remaining < 0) throw AppError.unprocessable(ERROR.GIFT_CARD.INSUFFICIENT_BALANCE);

    return tx.giftCard.update({
      where: { id: locked.id },
      data: {
        value: remaining,

        status: remaining <= 0 ? 'REDEEMED' : 'ACTIVE',
        redeemedAt: remaining <= 0 ? new Date() : locked.redeemedAt,
        usedOrderId: D.str(input.orderId) || locked.usedOrderId,
      },
    });
  });

  void writeActivityLog({
    req,
    userId: D.str(card.userId),
    action: 'GIFT_CARD_REDEEMED',
    entity: 'GiftCard',
    entityId: row.id,
    meta: { amount: applied },
  });

  return {
    giftCardId: D.str(row.id),
    code: D.str(row.code),
    redeemedAmount: applied,
    remainingBalance: D.float(row.value),
    isFullyRedeemed: D.str(row.status) === 'REDEEMED',
    status: D.str(row.status),
    usedOrderId: D.str(row.usedOrderId),
  };
};

export const disableGiftCard = async (id: string, req?: any): Promise<Record<string, any>> => {
  const existing = await prisma.giftCard.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!existing) throw AppError.notFound(ERROR.GIFT_CARD.NOT_FOUND);

  const row = await prisma.giftCard.update({ where: { id }, data: { status: 'DISABLED' } });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'GiftCard',
    entityId: id,
    meta: { status: D.str(row.status) },
  });

  return {
    giftCardId: D.str(row.id),
    code: D.str(row.code),
    status: D.str(row.status),
    value: D.float(row.value),
    expiresAt: D.date(row.expiresAt),
    redeemedAt: D.date(row.redeemedAt),
    createdAt: D.date(row.createdAt),
  };
};

export const deleteGiftCard = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.giftCard.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!existing) throw AppError.notFound(ERROR.GIFT_CARD.NOT_FOUND);

  if (D.str(existing.status) === 'REDEEMED') {
    throw AppError.unprocessable(
      'A redeemed gift card is kept for accounting and cannot be deleted.',
    );
  }

  await prisma.giftCard.delete({ where: { id } });

  void writeAuditLog({ req, action: 'DELETE', entity: 'GiftCard', entityId: id });
};

export const getGiftCardBalance = async (userId: string): Promise<Record<string, any>> => {
  const [cards, totals] = await Promise.all([
    prisma.giftCard.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { value: true, expiresAt: true },
    }),
    prisma.giftCard.aggregate({ where: { userId }, _sum: { value: true, initialValue: true } }),
  ]);

  const now = Date.now();

  return {
    userId,
    cardCount: D.num(cards.length),
    balance: money(D.float(totals._sum.value)),
    issuedValue: money(D.float(totals._sum.initialValue)),
    usableBalance: money(
      cards
        .filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > now)
        .reduce((s, c) => s + D.float(c.value), 0),
    ),
  };
};

const render = (body: string, values: Record<string, any>): string =>
  body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = values?.[key];

    return value === undefined || value === null ? match : String(value);
  });

export const listEmailTemplates = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.EmailTemplateWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.emailTemplate.findMany({
      where,
      orderBy: { key: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.emailTemplate.count({ where }),
  ]);

  return { rows, total };
};

export const upsertEmailTemplate = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const key = D.str(input.key).toLowerCase();

  const row = await prisma.emailTemplate.upsert({
    where: { key },
    create: {
      key,
      name: D.str(input.name),
      subject: D.str(input.subject),
      htmlBody: D.str(input.htmlBody),
      textBody: D.str(input.textBody),
      variables: D.strArr(input.variables),
      isActive: input.isActive !== false,
    },
    update: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.subject === undefined ? {} : { subject: D.str(input.subject) }),
      ...(input.htmlBody === undefined ? {} : { htmlBody: D.str(input.htmlBody) }),
      ...(input.textBody === undefined ? {} : { textBody: D.str(input.textBody) }),
      ...(input.variables === undefined ? {} : { variables: D.strArr(input.variables) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'EmailTemplate',
    entityId: row.id,
    meta: { key },
  });

  return {
    templateId: D.str(row.id),
    key: D.str(row.key),
    name: D.str(row.name),
    subject: D.str(row.subject),
    variables: D.strArr(row.variables),
    isActive: D.bool(row.isActive),
    updatedAt: D.date(row.updatedAt),
  };
};

export const deleteEmailTemplate = async (key: string, req?: any): Promise<void> => {
  const existing = await prisma.emailTemplate.findUnique({
    where: { key: D.str(key).toLowerCase() },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  await prisma.emailTemplate.delete({ where: { id: existing.id } });

  void writeAuditLog({
    req,
    action: 'DELETE',
    entity: 'EmailTemplate',
    entityId: existing.id,
    meta: { key },
  });
};

export const renderEmailTemplate = async (
  key: string,
  values: Record<string, any>,
): Promise<Record<string, any>> => {
  const row = await prisma.emailTemplate.findUnique({ where: { key: D.str(key).toLowerCase() } });

  if (!row) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  const missing = D.strArr(row.variables).filter((v) => values?.[v] === undefined);

  return {
    key: D.str(row.key),
    subject: render(D.str(row.subject), values),
    htmlBody: render(D.str(row.htmlBody), values),
    textBody: render(D.str(row.textBody), values),
    variables: D.strArr(row.variables),

    missingVariables: missing,
  };
};

export const listSmsTemplates = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.SmsTemplateWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.smsTemplate.findMany({
      where,
      orderBy: { key: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.smsTemplate.count({ where }),
  ]);

  return { rows, total };
};

export const upsertSmsTemplate = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const key = D.str(input.key).toLowerCase();

  const row = await prisma.smsTemplate.upsert({
    where: { key },
    create: {
      key,
      name: D.str(input.name),
      body: D.str(input.body),
      variables: D.strArr(input.variables),
      isActive: input.isActive !== false,
    },
    update: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.body === undefined ? {} : { body: D.str(input.body) }),
      ...(input.variables === undefined ? {} : { variables: D.strArr(input.variables) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'SmsTemplate',
    entityId: row.id,
    meta: { key },
  });

  return {
    templateId: D.str(row.id),
    key: D.str(row.key),
    name: D.str(row.name),
    variables: D.strArr(row.variables),
    isActive: D.bool(row.isActive),
    updatedAt: D.date(row.updatedAt),
  };
};

export const deleteSmsTemplate = async (key: string, req?: any): Promise<void> => {
  const existing = await prisma.smsTemplate.findUnique({
    where: { key: D.str(key).toLowerCase() },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  await prisma.smsTemplate.delete({ where: { id: existing.id } });

  void writeAuditLog({
    req,
    action: 'DELETE',
    entity: 'SmsTemplate',
    entityId: existing.id,
    meta: { key },
  });
};

export const renderSmsTemplate = async (
  key: string,
  values: Record<string, any>,
): Promise<Record<string, any>> => {
  const row = await prisma.smsTemplate.findUnique({ where: { key: D.str(key).toLowerCase() } });

  if (!row) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  const missing = D.strArr(row.variables).filter((v) => values?.[v] === undefined);

  return {
    key: D.str(row.key),
    body: render(D.str(row.body), values),
    variables: D.strArr(row.variables),
    missingVariables: missing,
  };
};

export const listNotificationTemplates = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.NotificationTemplateWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  if (D.str(query.isActive) === 'false') where.isActive = false;
  if (D.str(query.channel)) where.channel = D.str(query.channel) as NotificationChannel;

  const [rows, total] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where,
      orderBy: { key: 'asc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.notificationTemplate.count({ where }),
  ]);

  return { rows, total };
};

export const upsertNotificationTemplate = async (
  input: Record<string, any>,
  req?: any,
): Promise<Record<string, any>> => {
  const key = D.str(input.key).toLowerCase();

  const row = await prisma.notificationTemplate.upsert({
    where: { key },
    create: {
      key,
      name: D.str(input.name),
      channel: (input.channel ?? 'PUSH') as NotificationChannel,
      title: D.str(input.title),
      body: D.str(input.body),
      variables: D.strArr(input.variables),
      isActive: input.isActive !== false,
    },
    update: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.channel === undefined ? {} : { channel: input.channel as NotificationChannel }),
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.body === undefined ? {} : { body: D.str(input.body) }),
      ...(input.variables === undefined ? {} : { variables: D.strArr(input.variables) }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });

  void writeAuditLog({
    req,
    action: 'UPDATE',
    entity: 'NotificationTemplate',
    entityId: row.id,
    meta: { key },
  });

  return {
    templateId: D.str(row.id),
    key: D.str(row.key),
    name: D.str(row.name),
    channel: D.str(row.channel),
    variables: D.strArr(row.variables),
    isActive: D.bool(row.isActive),
    updatedAt: D.date(row.updatedAt),
  };
};

export const deleteNotificationTemplate = async (key: string, req?: any): Promise<void> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { key: D.str(key).toLowerCase() },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  await prisma.notificationTemplate.delete({ where: { id: existing.id } });

  void writeAuditLog({
    req,
    action: 'DELETE',
    entity: 'NotificationTemplate',
    entityId: existing.id,
    meta: { key },
  });
};

export const renderNotificationTemplate = async (
  key: string,
  values: Record<string, any>,
): Promise<Record<string, any>> => {
  const row = await prisma.notificationTemplate.findUnique({
    where: { key: D.str(key).toLowerCase() },
  });

  if (!row) throw AppError.notFound(ERROR.COMMON.NOT_FOUND);

  const missing = D.strArr(row.variables).filter((v) => values?.[v] === undefined);

  return {
    key: D.str(row.key),
    channel: D.str(row.channel),
    title: render(D.str(row.title), values),
    body: render(D.str(row.body), values),
    variables: D.strArr(row.variables),
    missingVariables: missing,
  };
};
