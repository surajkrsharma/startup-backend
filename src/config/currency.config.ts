import { APP } from './app.config';

export const CURRENCY = {
  CODE: APP.DEFAULT_CURRENCY,
  SYMBOL: '₹',
  DECIMALS: 2,
  POSITION: 'before' as 'before' | 'after',
  THOUSAND_SEPARATOR: ',',
  DECIMAL_SEPARATOR: '.',
};

export const LOCALE = {
  DEFAULT: APP.DEFAULT_LOCALE,
  SUPPORTED: ['en', 'hi'] as string[],
  FALLBACK: 'en',
};

export const TIMEZONE = {
  DEFAULT: APP.DEFAULT_TIMEZONE,
};

export const DATE = {
  DISPLAY_FORMAT: APP.DEFAULT_DATE_FORMAT,
  TIME_FORMAT: APP.DEFAULT_TIME_FORMAT,
  STORAGE_FORMAT: 'YYYY-MM-DD HH:mm:ss',
  DAYJS_PLUGINS: ['utc', 'timezone', 'relativeTime', 'dayjs'] as const,
};

export const ROUNDING = {
  PRECISION: 2,
  MODE: 'round' as const,
};

export const LOYALTY_TIER = [
  { name: 'BRONZE', minPoints: 0, multiplier: 1 },
  { name: 'SILVER', minPoints: 500, multiplier: 1.25 },
  { name: 'GOLD', minPoints: 2000, multiplier: 1.5 },
  { name: 'PLATINUM', minPoints: 5000, multiplier: 2 },
  { name: 'DIAMOND', minPoints: 10000, multiplier: 3 },
];
