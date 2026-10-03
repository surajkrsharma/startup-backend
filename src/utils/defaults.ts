/**
 * Default value helpers.
 *
 * Enforces the project's "No Null" contract: a missing value is never sent as
 * `null` — it is replaced by the type-appropriate empty value.
 *
 *  string  -> ''
 *  number  -> 0
 *  float   -> 0.0
 *  boolean -> false
 *  array   -> []
 *  object  -> {}
 *  date    -> ''
 */
export const D = {
  str: (v?: string | null): string => (v === null || v === undefined ? '' : String(v)),
  num: (v?: number | string | null): number => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  },
  float: (v?: number | string | null): number => {
    if (v === null || v === undefined || v === '') return 0.0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0.0;
  },
  bool: (v?: boolean | string | number | null): boolean => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return v === 'true' || v === '1' || v === 'yes';
  },
  arr: <T>(v?: T[] | null): T[] => (Array.isArray(v) ? v : []),
  strArr: (v?: string[] | null): string[] =>
    Array.isArray(v) ? v.filter((i) => typeof i === 'string') : [],
  obj: <T extends object>(v?: T | null): T => (v && typeof v === 'object' ? v : ({} as T)),
  date: (v?: Date | string | null): string => {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  },
  json: (v?: unknown): any => (v === null || v === undefined ? {} : v),
};

/** Round to N decimals without float drift artefacts. */
export const round = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

/** Money-safe rounding used across totals, commission and payouts. */
export const money = (value: number | null | undefined, decimals = 2): number =>
  round(Number(value ?? 0), decimals);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const toNumber = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const toBoolean = (v: unknown, fallback = false): boolean => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
};
