import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { APP } from '../config/app.config';
import { CURRENCY, DATE, TIMEZONE } from '../config/currency.config';
import { D } from './defaults';

let configured = false;

export const DAYJS_SETUP = (tz: string = TIMEZONE.DEFAULT): void => {
  if (!configured) {
    dayjs.extend(utc);
    dayjs.extend(timezone);
    dayjs.extend(relativeTime);
    dayjs.extend(customParseFormat);
    configured = true;
  }
  dayjs.tz.setDefault(tz);
};

DAYJS_SETUP();

export const now = (): Date => new Date();

export const formatDate = (
  value: Date | string | null | undefined,
  format: string = DATE.DISPLAY_FORMAT,
): string => {
  if (!value) return '';
  const d = dayjs(value);
  return d.isValid() ? d.format(format) : '';
};

export const formatDateTime = (value: Date | string | null | undefined): string =>
  formatDate(value, `${DATE.DISPLAY_FORMAT} ${DATE.TIME_FORMAT}`);

export const formatTime = (value: Date | string | null | undefined): string =>
  formatDate(value, DATE.TIME_FORMAT);

export const fromNow = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  const d = dayjs(value);
  return d.isValid() ? d.fromNow() : '';
};

export const addMinutes = (minutes: number, from: Date = new Date()): Date =>
  dayjs(from).add(minutes, 'minute').toDate();

export const addHours = (hours: number, from: Date = new Date()): Date =>
  dayjs(from).add(hours, 'hour').toDate();

export const addDays = (days: number, from: Date = new Date()): Date =>
  dayjs(from).add(days, 'day').toDate();

export const subtractMinutes = (minutes: number, from: Date = new Date()): Date =>
  dayjs(from).subtract(minutes, 'minute').toDate();

export const subtractDays = (days: number, from: Date = new Date()): Date =>
  dayjs(from).subtract(days, 'day').toDate();

export const startOfDay = (value: Date | string = new Date()): Date =>
  dayjs(value).startOf('day').toDate();

export const endOfDay = (value: Date | string = new Date()): Date =>
  dayjs(value).endOf('day').toDate();

export const daysBetween = (from: Date | string, to: Date | string = new Date()): number =>
  Math.floor(dayjs(to).diff(dayjs(from), 'day', true));

export const isPast = (value: Date | string): boolean => dayjs(value).isBefore(dayjs());

export const isFuture = (value: Date | string): boolean => dayjs(value).isAfter(dayjs());

export const toDayKey = (value: Date | string = new Date()): Date =>
  dayjs(value).utc().startOf('day').toDate();

export const formatMoney = (
  value: number | null | undefined,
  currencySymbol = CURRENCY.SYMBOL,
): string => {
  const amount = Number(value ?? 0);
  const decimals = CURRENCY.DECIMALS;
  const fixed = Math.abs(amount).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, CURRENCY.THOUSAND_SEPARATOR);
  const body = decimals > 0 ? `${grouped}${CURRENCY.DECIMAL_SEPARATOR}${decPart}` : grouped;
  const sign = amount < 0 ? '-' : '';
  return CURRENCY.POSITION === 'before'
    ? `${sign}${currencySymbol}${body}`
    : `${sign}${body} ${currencySymbol}`;
};

export const dateRange = (from: string | Date, to: string | Date): { from: Date; to: Date } => {
  const start = dayjs(from).startOf('day').toDate();
  const end = dayjs(to).endOf('day').toDate();
  return { from: start, to: end };
};

export const daysAgo = (days: number): Date => subtractDays(days, startOfDay(new Date()));

export const ageInDays = (value: Date | string): number => daysBetween(value, new Date());

export const isoDate = (value: Date | string | null | undefined): string => D.date(value);

export { APP, TIMEZONE };
