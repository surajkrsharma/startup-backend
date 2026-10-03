import { clamp, money, round } from './defaults';

export interface TokenConfig {
  enabled: boolean;
  mode: 'percent' | 'fixed';
  percent: number;
  fixedAmount: number;
  minAmount: number;
  maxAmount: number;
  applicableAbove: number;
}

/**
 * Token / advance amount formula (spec §7.14).
 *
 *  1. Order total below `applicableAbove`  -> token not required (0)
 *  2. raw = percent% of total, or the fixed amount
 *  3. clamp between minAmount and maxAmount
 *  4. never exceed the order total
 */
export const calcTokenAmount = (orderTotal: number, cfg: TokenConfig): number => {
  const total = money(orderTotal);
  if (!cfg.enabled) return 0;
  if (total < cfg.applicableAbove) return 0;

  const raw =
    cfg.mode === 'fixed'
      ? money(cfg.fixedAmount)
      : money((total * (Number(cfg.percent) || 0)) / 100);

  const clamped = clamp(raw, cfg.minAmount, cfg.maxAmount);
  return money(Math.min(clamped, total));
};

export const isTokenRequired = (orderTotal: number, cfg: TokenConfig): boolean =>
  cfg.enabled && money(orderTotal) >= cfg.applicableAbove && calcTokenAmount(orderTotal, cfg) > 0;

export interface CommissionBreakdown {
  subtotal: number;
  commissionRate: number;
  commission: number;
  platformFee: number;
  vendorEarning: number;
  taxAmount: number;
  total: number;
}

/**
 * Vendor earnings split.
 *   earnings = subtotal − commission − platformFee
 * Commission is a percentage of the subtotal; platform fee is a flat amount.
 */
export const calcCommission = (input: {
  subtotal: number;
  commissionRate: number;
  platformFee?: number;
  taxPercent?: number;
  taxInclusive?: boolean;
}): CommissionBreakdown => {
  const subtotal = money(input.subtotal);
  const rate = clamp(Number(input.commissionRate) || 0, 0, 100);

  let base = subtotal;
  let taxAmount = 0;

  if (input.taxInclusive) {
    // tax already inside the price — extract it from the gross
    const taxPercent = clamp(Number(input.taxPercent) || 0, 0, 100);
    taxAmount = money((subtotal * taxPercent) / (100 + taxPercent));
    base = money(subtotal - taxAmount);
  } else {
    taxAmount = money((subtotal * (Number(input.taxPercent) || 0)) / 100);
  }

  const commission = money((base * rate) / 100);
  const platformFee = money(input.platformFee ?? 0);
  const vendorEarning = money(Math.max(0, base - commission - platformFee));

  return {
    subtotal,
    commissionRate: rate,
    commission,
    platformFee,
    vendorEarning,
    taxAmount,
    total: money(base + taxAmount),
  };
};

/** Applies a coupon to a cart/order subtotal. */
export const calcCouponDiscount = (input: {
  subtotal: number;
  type: 'FLAT' | 'PERCENT' | 'FREE_SHIPPING' | 'FIRST_ORDER';
  value: number;
  maxDiscount: number;
  globalMaxDiscount: number;
}): { discount: number; freeShipping: boolean } => {
  const subtotal = money(input.subtotal);

  if (input.type === 'FREE_SHIPPING') {
    return { discount: 0, freeShipping: true };
  }

  let discount =
    input.type === 'PERCENT'
      ? money((subtotal * (Number(input.value) || 0)) / 100)
      : money(input.value);

  const caps = [input.maxDiscount, input.globalMaxDiscount].filter((c) => Number(c) > 0);
  if (caps.length) discount = money(Math.min(discount, ...caps));

  discount = money(Math.max(0, Math.min(discount, subtotal)));
  return { discount, freeShipping: false };
};

export interface CartTotals {
  subtotal: number;
  discount: number;
  couponDiscount: number;
  taxAmount: number;
  shippingAmount: number;
  walletAmount: number;
  total: number;
  itemCount: number;
  totalQty: number;
}

export const calcCartTotals = (input: {
  subtotal: number;
  discount?: number;
  couponDiscount?: number;
  taxPercent?: number;
  shippingCharge?: number;
  freeShippingAbove?: number;
  walletAmount?: number;
  itemCount?: number;
  totalQty?: number;
}): CartTotals => {
  const subtotal = money(input.subtotal);
  const discount = money(input.discount ?? 0);
  const couponDiscount = money(input.couponDiscount ?? 0);
  const afterDiscount = money(Math.max(0, subtotal - discount - couponDiscount));

  const taxPercent = clamp(Number(input.taxPercent) || 0, 0, 100);
  const taxAmount = money((afterDiscount * taxPercent) / 100);

  const gross = money(afterDiscount + taxAmount);
  const freeAbove = money(input.freeShippingAbove ?? 0);

  let shippingAmount = money(input.shippingCharge ?? 0);
  if (input.freeShippingAbove !== undefined && freeAbove > 0 && gross >= freeAbove)
    shippingAmount = 0;

  let walletAmount = money(input.walletAmount ?? 0);
  if (walletAmount > gross) walletAmount = gross;

  const total = money(Math.max(0, gross + shippingAmount - walletAmount));

  return {
    subtotal,
    discount,
    couponDiscount,
    taxAmount,
    shippingAmount,
    walletAmount,
    total,
    itemCount: Number(input.itemCount ?? 0),
    totalQty: Number(input.totalQty ?? 0),
  };
};

/** Shipping charge with optional free-shipping threshold and per-kg component. */
export const calcShippingCharge = (input: {
  orderValue: number;
  defaultCharge: number;
  freeAbove?: number;
  perKgCharge?: number;
  weightKg?: number;
}): { charge: number; isFree: boolean; weightKg: number } => {
  const weightKg = round(Number(input.weightKg ?? 0), 2);
  const freeAbove = money(input.freeAbove ?? 0);
  const isFree = freeAbove > 0 && money(input.orderValue) >= freeAbove;

  let charge = money(input.defaultCharge);
  const perKg = money(input.perKgCharge ?? 0);
  if (perKg > 0 && weightKg > 0) charge = money(charge + perKg * weightKg);

  return { charge: isFree ? 0 : charge, isFree, weightKg };
};

/** Loyalty points earned for an order value. */
export const calcLoyaltyPoints = (orderValue: number, pointsPerRupee: number): number =>
  Math.max(0, Math.floor(money(orderValue) * (Number(pointsPerRupee) || 0)));

export { clamp, money, round };
