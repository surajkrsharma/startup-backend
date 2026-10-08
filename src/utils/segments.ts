import { SEGMENT_KIND, type SegmentKind } from '../constants/segments';
import { money } from './defaults';

export interface SegmentFacts {
  orderCount: number;
  deliveredOrderCount: number;
  totalSpent: number;
  isBanned: boolean;
}

export interface SegmentThresholds {
  repeatOrderCount: number;
  wholesaleOrderCount: number;
  vipSpendAmount: number;
}

/**
 * A threshold arrives as a number from settings, so it can arrive as NaN or as
 * something below 1. Falling back to a floor of 1 would put every customer with
 * an order into every segment, so an unusable threshold excludes instead: the
 * segment goes empty and the misconfiguration is visible rather than silent.
 */
const atLeast = (value: number, floor: number): boolean => {
  const limit = Number(floor);
  if (!Number.isFinite(limit) || limit < 1) return false;
  return Math.max(0, Number(value) || 0) >= limit;
};

/**
 * Returns the auto kinds a customer belongs to. New and Blocked are
 * unconditional; the paid segments are ordered cheapest test first so the
 * common customer stops after one or two comparisons.
 */
export const evaluateSegmentKinds = (
  facts: SegmentFacts,
  thresholds: SegmentThresholds,
): SegmentKind[] => {
  const kinds: SegmentKind[] = [];

  if (facts.isBanned) kinds.push(SEGMENT_KIND.BLOCKED);

  if (Math.max(0, Number(facts.orderCount) || 0) === 0) {
    kinds.push(SEGMENT_KIND.NEW);
  }

  if (atLeast(facts.deliveredOrderCount, thresholds.repeatOrderCount)) {
    kinds.push(SEGMENT_KIND.REPEAT);
  }

  if (money(facts.totalSpent) >= money(thresholds.vipSpendAmount)) {
    kinds.push(SEGMENT_KIND.VIP);
  }

  if (atLeast(facts.deliveredOrderCount, thresholds.wholesaleOrderCount)) {
    kinds.push(SEGMENT_KIND.WHOLESALE);
  }

  return Array.from(new Set(kinds));
};

/**
 * A ban holds until it is revoked or its expiry passes. Both are checked
 * against the caller's clock rather than the row's `isActive` flag so an
 * expired ban stops blocking the moment it expires, whether or not the nightly
 * job has run yet.
 */
export const isBanActive = (
  ban: { revokedAt?: Date | null; expiresAt?: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (!ban) return false;
  if (ban.revokedAt) return false;
  if (ban.expiresAt && ban.expiresAt.getTime() <= now.getTime()) return false;
  return true;
};

/**
 * Days left on a ban, rounded up so a ban with 30 minutes remaining still
 * reports 1 rather than 0 — 0 would read to the customer as already lifted.
 */
export const banDaysRemaining = (
  ban: { expiresAt?: Date | null } | null | undefined,
  now: Date = new Date(),
): number => {
  if (!ban?.expiresAt) return 0;
  const ms = ban.expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
};
