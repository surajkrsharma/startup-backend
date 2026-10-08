import { describe, expect, it } from 'vitest';

import { banDaysRemaining, evaluateSegmentKinds, isBanActive } from '../src/utils/segments';
import { SEGMENT_KIND } from '../src/constants/segments';

const THRESHOLDS = {
  repeatOrderCount: 2,
  wholesaleOrderCount: 10,
  vipSpendAmount: 10000,
};

const facts = (over: Partial<Parameters<typeof evaluateSegmentKinds>[0]> = {}) => ({
  orderCount: 0,
  deliveredOrderCount: 0,
  totalSpent: 0,
  isBanned: false,
  ...over,
});

describe('evaluateSegmentKinds', () => {
  it('calls a customer with no orders NEW', () => {
    expect(evaluateSegmentKinds(facts(), THRESHOLDS)).toContain(SEGMENT_KIND.NEW);
  });

  it('stops calling a customer NEW once they have ordered', () => {
    const kinds = evaluateSegmentKinds(facts({ orderCount: 1 }), THRESHOLDS);
    expect(kinds).not.toContain(SEGMENT_KIND.NEW);
  });

  it('promotes to REPEAT on delivered orders, not on placed ones', () => {
    expect(
      evaluateSegmentKinds(facts({ orderCount: 5, deliveredOrderCount: 1 }), THRESHOLDS),
    ).not.toContain(SEGMENT_KIND.REPEAT);

    expect(
      evaluateSegmentKinds(facts({ orderCount: 5, deliveredOrderCount: 2 }), THRESHOLDS),
    ).toContain(SEGMENT_KIND.REPEAT);
  });

  it('promotes to VIP once spend reaches the threshold', () => {
    expect(evaluateSegmentKinds(facts({ totalSpent: 9999 }), THRESHOLDS)).not.toContain(
      SEGMENT_KIND.VIP,
    );
    expect(evaluateSegmentKinds(facts({ totalSpent: 10000 }), THRESHOLDS)).toContain(
      SEGMENT_KIND.VIP,
    );
  });

  it('adds WHOLESALE on top of REPEAT rather than instead of it', () => {
    const kinds = evaluateSegmentKinds(
      facts({ orderCount: 12, deliveredOrderCount: 12, totalSpent: 50000 }),
      THRESHOLDS,
    );
    expect(kinds).toEqual(
      expect.arrayContaining([SEGMENT_KIND.REPEAT, SEGMENT_KIND.VIP, SEGMENT_KIND.WHOLESALE]),
    );
  });

  it('segments a banned customer as BLOCKED whatever else is true', () => {
    const kinds = evaluateSegmentKinds(
      facts({ isBanned: true, orderCount: 30, deliveredOrderCount: 30, totalSpent: 90000 }),
      THRESHOLDS,
    );
    expect(kinds).toContain(SEGMENT_KIND.BLOCKED);
  });

  it('never returns the same kind twice', () => {
    const kinds = evaluateSegmentKinds(
      facts({ orderCount: 12, deliveredOrderCount: 12, totalSpent: 50000, isBanned: true }),
      THRESHOLDS,
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('drops a customer into no paid segment when thresholds are corrupt', () => {
    const broken = {
      repeatOrderCount: NaN,
      wholesaleOrderCount: NaN,
      vipSpendAmount: NaN,
    } as unknown as typeof THRESHOLDS;

    const kinds = evaluateSegmentKinds(
      facts({ orderCount: 40, deliveredOrderCount: 40, totalSpent: 999999 }),
      broken,
    );
    expect(kinds).not.toContain(SEGMENT_KIND.VIP);
    expect(kinds).not.toContain(SEGMENT_KIND.WHOLESALE);
    expect(kinds).not.toContain(SEGMENT_KIND.REPEAT);
    expect(kinds).toEqual([]);
  });
});

describe('isBanActive', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');

  it('is false when there is no ban at all', () => {
    expect(isBanActive(null, now)).toBe(false);
    expect(isBanActive(undefined, now)).toBe(false);
  });

  it('holds a ban with no expiry until it is revoked', () => {
    expect(isBanActive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
  });

  it('is false once revoked', () => {
    expect(
      isBanActive({ revokedAt: new Date('2026-10-01T00:00:00.000Z'), expiresAt: null }, now),
    ).toBe(false);
  });

  it('stops holding the moment the expiry passes, without waiting for the cron', () => {
    expect(
      isBanActive({ revokedAt: null, expiresAt: new Date('2026-10-08T11:59:59.000Z') }, now),
    ).toBe(false);
    expect(
      isBanActive({ revokedAt: null, expiresAt: new Date('2026-10-08T12:00:01.000Z') }, now),
    ).toBe(true);
  });
});

describe('banDaysRemaining', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');

  it('is 0 for a permanent ban and for an expired one', () => {
    expect(banDaysRemaining({ expiresAt: null }, now)).toBe(0);
    expect(banDaysRemaining({ expiresAt: new Date('2026-10-01T00:00:00.000Z') }, now)).toBe(0);
  });

  it('rounds up so a ban under a day still reports 1', () => {
    expect(banDaysRemaining({ expiresAt: new Date('2026-10-08T18:00:00.000Z') }, now)).toBe(1);
  });

  it('counts whole days', () => {
    expect(banDaysRemaining({ expiresAt: new Date('2026-10-18T12:00:00.000Z') }, now)).toBe(10);
  });
});
