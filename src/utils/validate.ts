import { EMAIL_REGEX, PHONE_REGEX } from '../constants/countries';

const DEFAULT_COUNTRY_CODE = '+91';

export const isEmailLooking = (value: string): boolean =>
  EMAIL_REGEX.test(String(value ?? '').trim());

export const isPhoneLooking = (value: string): boolean =>
  PHONE_REGEX.test(String(value ?? '').trim());

export const normalisePhone = (
  value: string,
  defaultCode: string = DEFAULT_COUNTRY_CODE,
): string => {
  const raw = String(value ?? '')
    .trim()
    .replace(/[\s()-]/g, '');
  if (!raw) return '';

  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const codeDigits = defaultCode.replace(/\D/g, '');

  if (!hasPlus && codeDigits && digits.length > 10 && digits.startsWith(codeDigits)) {
    digits = digits.slice(codeDigits.length);
  } else if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  const hasCountryCode = hasPlus || digits.startsWith(codeDigits);
  return hasCountryCode ? `+${digits}` : `${defaultCode}${digits}`;
};

export const isValidEmail = (value: string): boolean => isEmailLooking(value);

export const isValidPhone = (value: string): boolean => isPhoneLooking(value);

export const isValidDate = (value: unknown): boolean => {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value as any);
  return !Number.isNaN(d.getTime());
};

export const isValidRange = (from: unknown, to: unknown): boolean => {
  if (!isValidDate(from) || !isValidDate(to)) return false;
  return new Date(from as any).getTime() <= new Date(to as any).getTime();
};

export const findUnknownKeys = (value: Record<string, any>, allowed: string[]): string[] =>
  Object.keys(value ?? {}).filter((key) => !allowed.includes(key));
