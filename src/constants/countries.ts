export const COUNTRY_CODE = {
  IN: 'IN',
  US: 'US',
  GB: 'GB',
  AE: 'AE',
  SA: 'SA',
  QA: 'QA',
  KW: 'KW',
  BH: 'BH',
  OM: 'OM',
  SG: 'SG',
  MY: 'MY',
  CA: 'AU',
  NZ: 'NZ',
  DE: 'DE',
  FR: 'FR',
  IT: 'IT',
  ES: 'ES',
  NL: 'NL',
  ZA: 'ZA',
  NP: 'NP',
  LK: 'LK',
  BD: 'BD',
  PK: 'PK',
} as const;

export type CountryCode = keyof typeof COUNTRY_CODE;

export interface CountryMeta {
  code: string;
  name: string;
  dialCode: string;
  currency: string;
}

export const COUNTRIES: CountryMeta[] = [
  { code: 'IN', name: 'India', dialCode: '+91', currency: 'INR' },
  { code: 'US', name: 'United States', dialCode: '+1', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', currency: 'GBP' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', currency: 'AED' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', currency: 'SAR' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', currency: 'QAR' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', currency: 'KWD' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', currency: 'BHD' },
  { code: 'OM', name: 'Oman', dialCode: '+968', currency: 'OMR' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', currency: 'SGD' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', currency: 'MYR' },
  { code: 'AU', name: 'Australia', dialCode: '+61', currency: 'AUD' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', currency: 'NZD' },
  { code: 'DE', name: 'Germany', dialCode: '+49', currency: 'EUR' },
  { code: 'FR', name: 'France', dialCode: '+33', currency: 'EUR' },
  { code: 'IT', name: 'Italy', dialCode: '+39', currency: 'EUR' },
  { code: 'ES', name: 'Spain', dialCode: '+34', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', currency: 'EUR' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', currency: 'ZAR' },
  { code: 'NP', name: 'Nepal', dialCode: '+977', currency: 'NPR' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', currency: 'LKR' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', currency: 'BDT' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', currency: 'PKR' },
];

export const DEFAULT_COUNTRY_CODE = COUNTRY_CODE.IN;
export const DEFAULT_DIAL_CODE = '+91';
export const DEFAULT_PINCODE_LENGTH = 6;

export const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UPI_REGEX = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/;
export const COUPON_CODE_REGEX = /^[A-Z0-9_-]{3,24}$/;
export const ORDER_NUMBER_PREFIX = 'ORD';
export const RETURN_NUMBER_PREFIX = 'RET';
export const TICKET_NUMBER_PREFIX = 'TKT';
