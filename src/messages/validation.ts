import { ERROR_CODE } from '../constants/http';

export const VALIDATION = {
  REQUIRED: (field: string) => `${field} is required.`,
  INVALID_EMAIL: 'Please enter a valid email address.',
  MIN_LENGTH: (field: string, n: number) => `${field} must be at least ${n} characters.`,
  MAX_LENGTH: (field: string, n: number) => `${field} must not exceed ${n} characters.`,
  INVALID_PHONE: 'Please enter a valid phone number.',
  INVALID_URL: 'Please enter a valid URL.',
  INVALID_NUMBER: 'Please enter a valid number.',
  INVALID_DATE: 'Please enter a valid date.',
  INVALID_ENUM: (field: string) => `${field} has invalid value.`,
  STRICT_FIELD: (field: string) => `Unknown field: ${field}`,
  INVALID_PASSWORD:
    'Password must be 8-64 characters with upper, lower, number and special character.',
  INVALID_SLUG: 'Slug may only contain lowercase letters, numbers and hyphens.',
  INVALID_OTP_FORMAT: 'Please enter a valid 6 digit OTP.',
  INVALID_UUID: 'Please enter a valid identifier.',
  INVALID_CURRENCY: 'Please enter a valid currency code.',
  INVALID_COUNTRY: 'Please enter a valid country code.',
  INVALID_PINCODE: 'Please enter a valid pincode.',
  INVALID_GSTIN: 'Please enter a valid GSTIN.',
  INVALID_PAN: 'Please enter a valid PAN number.',
  INVALID_IFSC: 'Please enter a valid IFSC code.',
  INVALID_UPI: 'Please enter a valid UPI ID.',
  INVALID_CARTON: (field: string) => `Invalid ${field}.`,
  INVALID_JSON: 'Please provide a valid JSON object.',
  INVALID_RANGE: 'Please provide a valid range.',
  NEGATIVE_NOT_ALLOWED: (field: string) => `${field} cannot be negative.`,
  INVALID_QUANTITY: 'Quantity must be at least 1.',
  INVALID_PRICE: 'Price must be greater than 0.',
  INVALID_RATING: 'Rating must be between 1 and 5.',
  INVALID_PERCENT: 'Percent must be between 0 and 100.',
  INVALID_ARRAY: 'Please provide a valid array.',
  INVALID_BOOLEAN: 'Please provide a valid boolean value.',
  INVALID_DATE_RANGE: 'End date must be after start date.',
  EMAIL_REQUIRED: 'Email is required.',
  OTP_REQUIRED: 'OTP is required.',
  TYPE_REQUIRED: 'Type is required.',
  IDENTIFIER_REQUIRED: 'Email or phone is required.',
  STRICT_OBJECT: 'Request body contains unknown fields.',
};

/**
 * Maps a Zod issue to a human message. Falls back to the generic
 * VALIDATION_FAILED text so no internal detail ever leaks.
 */
export const zodIssueToMessage = (issue: {
  path?: (string | number)[];
  code: string;
  message?: string;
}): string => {
  const field = issue.path?.length ? String(issue.path[0]) : '';

  switch (issue.code) {
    case 'invalid_type':
      return VALIDATION.INVALID_ENUM(field || 'value');
    case 'too_small':
      return VALIDATION.MIN_LENGTH(field || 'value', (issue as any).minimum ?? 0);
    case 'too_big':
      return VALIDATION.MAX_LENGTH(field || 'value', (issue as any).maximum ?? 0);
    case 'invalid_string':
      if (issue.message?.includes('email')) return VALIDATION.INVALID_EMAIL;
      if (issue.message?.includes('phone')) return VALIDATION.INVALID_PHONE;
      if (issue.message?.includes('url')) return VALIDATION.INVALID_URL;
      if (issue.message?.includes('date')) return VALIDATION.INVALID_DATE;
      return VALIDATION.INVALID_ENUM(field || 'value');
    case 'unrecognized_keys':
      return VALIDATION.STRICT_FIELD((issue as any).keys?.[0] ?? 'unknown');
    case 'invalid_literal':
    case 'invalid_enum_value':
      return VALIDATION.INVALID_ENUM(field || 'value');
    case 'custom':
      // Zod already carries a purpose-written message for these cases.
      return issue.message || VALIDATION.REQUIRED(field || 'value');
    default:
      return VALIDATION.INVALID_ENUM(field || 'value');
  }
};

export const VALIDATION_ERROR_CODE = ERROR_CODE.VALIDATION_ERROR;
