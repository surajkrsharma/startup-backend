import { describe, expect, it } from 'vitest';

import { toPercent, toPercentDistribution } from '../src/utils/calculations';

describe('toPercent', () => {
  it('returns a 0-100 number, not the raw fraction', () => {
    expect(toPercent(1, 5)).toBe(20);
    expect(toPercent(1, 4)).toBe(25);
  });

  it('keeps one decimal so thirds stay readable', () => {
    expect(toPercent(1, 3)).toBe(33.3);
  });

  it('returns 0 rather than NaN when there is nothing to divide by', () => {
    expect(toPercent(5, 0)).toBe(0);
    expect(toPercent(5, NaN)).toBe(0);
  });

  it('treats a missing part as 0', () => {
    expect(toPercent(undefined as unknown as number, 10)).toBe(0);
  });

  it('stays on the 0-100 scale for a full share', () => {
    expect(toPercent(7, 7)).toBe(100);
  });
});

describe('toPercentDistribution', () => {
  const sum = (parts: number[]) => Math.round(parts.reduce((s, n) => s + n, 0) * 10) / 10;

  it('totals exactly 100 when rounding alone would drift', () => {
    expect(sum(toPercentDistribution([1, 1, 1]))).toBe(100);
    expect(sum(toPercentDistribution([1, 1, 1, 1, 1, 1, 1]))).toBe(100);
  });

  it('puts the residual on the largest share', () => {
    const out = toPercentDistribution([1, 1, 1]);
    expect(out).toEqual([33.4, 33.3, 33.3]);
  });

  it('leaves an already-exact split alone', () => {
    expect(toPercentDistribution([0, 1, 0, 0, 0])).toEqual([0, 100, 0, 0, 0]);
    expect(toPercentDistribution([1, 1])).toEqual([50, 50]);
  });

  it('is all zeros when there is nothing to distribute', () => {
    expect(toPercentDistribution([0, 0, 0])).toEqual([0, 0, 0]);
    expect(toPercentDistribution([])).toEqual([]);
  });

  it('handles a single share without dividing by zero', () => {
    expect(toPercentDistribution([4])).toEqual([100]);
  });

  it('never returns a share above 100', () => {
    const out = toPercentDistribution([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Math.max(...out)).toBeLessThanOrEqual(100);
  });
});
