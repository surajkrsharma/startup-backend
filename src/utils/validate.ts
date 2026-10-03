import { EMAIL_REGEX, PHONE_REGEX } from '../constants/countries';

const DEFAULT_COUNTRY_CODE = '+91';

/** True when the identifier looks like an email address rather than a phone number. */
export const isEmailLooking = (value: string): boolean =>
  EMAIL_REGEX.test(String(value ?? '').trim());

export const isPhoneLooking = (value: string): boolean =>
  PHONE_REGEX.test(String(value ?? '').trim());

/**
 * Normalises a phone number to E.164.
 * Accepts `9876543210`, `09876543210`, `+91 98765 43210` with an optional
 * default country code.
 */
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

  // 91XXXXXXXXX -> strip the country code before prefixing it back
  if (!hasPlus && codeDigits && digits.length > 10 && digits.startsWith(codeDigits)) {
    digits = digits.slice(codeDigits.length);
  } else if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  const hasCountryCode = hasPlus || digits.startsWith(codeDigits);
  return hasCountryCode ? `+${digits}` : `${defaultCode}${digits}`;
};

/** Loose email check used outside Zod schemas (service layer guards). */
export const isValidEmail = (value: string): boolean => isEmailLooking(value);

export const isValidPhone = (value: string): boolean => isPhoneLooking(value);

/** Validates that the value is a parseable, non-empty date. */
export const isValidDate = (value: unknown): boolean => {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value as any);
  return !Number.isNaN(d.getTime());
};

/** Ensures `from` is before or equal to `to`. */
export const isValidRange = (from: unknown, to: unknown): boolean => {
  if (!isValidDate(from) || !isValidDate(to)) return false;
  return new Date(from as any).getTime() <= new Date(to as any).getTime();
};

/** Returns the keys present in `value` that are not in `allowed`. */
export const findUnknownKeys = (value: Record<string, any>, allowed: string[]): string[] =>
  Object.keys(value ?? {}).filter((key) => !allowed.includes(key));
