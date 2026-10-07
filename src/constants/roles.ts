export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUB_ADMIN: 'SUB_ADMIN',
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
  DELIVERY_BOY: 'DELIVERY_BOY',
} as const;

export type Role = keyof typeof ROLES;

export const ROLE_VALUES = Object.values(ROLES) as Role[];

export const ADMIN_ROLES: Role[] = [ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN];

export const isAdminRole = (role: string): boolean => ADMIN_ROLES.includes(role as Role);

export const REGISTER_TYPE = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
} as const;

export type RegisterType = keyof typeof REGISTER_TYPE;

export const REGISTER_TYPE_VALUES = Object.values(REGISTER_TYPE) as RegisterType[];

export const OTP_TYPE = {
  REGISTER: 'REGISTER',
  FORGOT_PASSWORD: 'FORGOT_PASSWORD',
  LOGIN: 'LOGIN',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
  PHONE_VERIFY: 'PHONE_VERIFY',
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  TWO_FA: 'TWO_FA',
  EMAIL_CHANGE: 'EMAIL_CHANGE',
  PHONE_CHANGE: 'PHONE_CHANGE',
} as const;

export type OtpType = keyof typeof OTP_TYPE;

export const OTP_TYPE_VALUES = Object.values(OTP_TYPE) as OtpType[];

export const OTP_TYPES_REQUIRING_ACCOUNT: OtpType[] = [
  OTP_TYPE.LOGIN,
  OTP_TYPE.FORGOT_PASSWORD,
  OTP_TYPE.CHANGE_PASSWORD,
  OTP_TYPE.PHONE_VERIFY,
  OTP_TYPE.EMAIL_VERIFY,
  OTP_TYPE.EMAIL_CHANGE,
  OTP_TYPE.PHONE_CHANGE,
];

export const LOGIN_OTP_TYPES: OtpType[] = [OTP_TYPE.LOGIN];

export const VERIFICATION_PURPOSE = {
  REGISTER: 'REGISTER',
  LOGIN: 'LOGIN',
  EMAIL_CHANGE: 'EMAIL_CHANGE',
  PHONE_CHANGE: 'PHONE_CHANGE',
} as const;

export type VerificationPurpose = keyof typeof VERIFICATION_PURPOSE;

export const VERIFICATION_PURPOSE_VALUES = Object.values(
  VERIFICATION_PURPOSE,
) as VerificationPurpose[];

export const OTP_CHANNEL = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  BOTH: 'BOTH',
} as const;

export type OtpChannel = keyof typeof OTP_CHANNEL;

export const SOCIAL_PROVIDER = {
  GOOGLE: 'GOOGLE',
  APPLE: 'APPLE',
  FACEBOOK: 'FACEBOOK',
} as const;

export type SocialProvider = keyof typeof SOCIAL_PROVIDER;

export const SOCIAL_PROVIDER_VALUES = Object.values(SOCIAL_PROVIDER) as SocialProvider[];

export const PLATFORM = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
  OTHER: 'OTHER',
} as const;

export type Platform = keyof typeof PLATFORM;

export const PLATFORM_VALUES = Object.values(PLATFORM) as Platform[];

export const PAYMENT_METHOD = {
  COD: 'COD',
  UPI: 'UPI',
  BANK: 'BANK',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
  RAZORPAY: 'RAZORPAY',
  STRIPE: 'STRIPE',
} as const;

export type PaymentMethod = keyof typeof PAYMENT_METHOD;

export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD) as PaymentMethod[];

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  COD_PENDING: 'COD_PENDING',
  COD_COLLECTED: 'COD_COLLECTED',
} as const;

export type PaymentStatus = keyof typeof PAYMENT_STATUS;

export const VENDOR_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'INACTIVE',
} as const;

export type VendorStatus = keyof typeof VENDOR_STATUS;

export const PRODUCT_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ProductStatus = keyof typeof PRODUCT_STATUS;

export const PRODUCT_CONDITION = {
  NEW: 'NEW',
  USED: 'USED',
  REFURBISHED: 'REFURBISHED',
  OPEN_BOX: 'OPEN_BOX',
} as const;

export type ProductCondition = keyof typeof PRODUCT_CONDITION;

export const PRODUCT_CONDITION_VALUES = Object.values(PRODUCT_CONDITION) as ProductCondition[];

export const ORDER_TAG = {
  URGENT: 'URGENT',
  GIFT: 'GIFT',
  FRAGILE: 'FRAGILE',
  PRIORITY: 'PRIORITY',
  HOLD: 'HOLD',
  FOLLOW_UP: 'FOLLOW_UP',
} as const;

export type OrderTag = keyof typeof ORDER_TAG;

export const ORDER_TAG_VALUES = Object.values(ORDER_TAG) as OrderTag[];

export const PAYOUT_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;

export type PayoutStatus = keyof typeof PAYOUT_STATUS;

export const COUPON_TYPE = {
  FLAT: 'FLAT',
  PERCENT: 'PERCENT',
  FREE_SHIPPING: 'FREE_SHIPPING',
  FIRST_ORDER: 'FIRST_ORDER',
} as const;

export type CouponType = keyof typeof COUPON_TYPE;

export const COUPON_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  EXPIRED: 'EXPIRED',
  SCHEDULED: 'SCHEDULED',
} as const;

export type CouponStatus = keyof typeof COUPON_STATUS;

export const ATTRIBUTE_TYPE = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  SELECT: 'SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  COLOR: 'COLOR',
  SIZE: 'SIZE',
} as const;

export type AttributeType = keyof typeof ATTRIBUTE_TYPE;

export const COLLECTION_TYPE = {
  MANUAL: 'MANUAL',
  DYNAMIC: 'DYNAMIC',
} as const;

export type CollectionType = keyof typeof COLLECTION_TYPE;

export const SHIPMENT_STATUS = {
  PENDING: 'PENDING',
  LABEL_CREATED: 'LABEL_CREATED',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
  CANCELLED: 'CANCELLED',
} as const;

export type ShipmentStatus = keyof typeof SHIPMENT_STATUS;

export const ADDRESS_TYPE = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;

export type AddressType = keyof typeof ADDRESS_TYPE;

export const WALLET_TXN_TYPE = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
  REFUND: 'REFUND',
  REWARD: 'REWARD',
  REDEEM: 'REDEEM',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type WalletTxnType = keyof typeof WALLET_TXN_TYPE;

export const LOYALTY_TXN_TYPE = {
  EARN: 'EARN',
  REDEEM: 'REDEEM',
  EXPIRE: 'EXPIRE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export type LoyaltyTxnType = keyof typeof LOYALTY_TXN_TYPE;

export const REFERRAL_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  REJECTED: 'REJECTED',
} as const;

export type ReferralStatus = keyof typeof REFERRAL_STATUS;

export const GIFT_CARD_STATUS = {
  ACTIVE: 'ACTIVE',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  DISABLED: 'DISABLED',
} as const;

export type GiftCardStatus = keyof typeof GIFT_CARD_STATUS;

export const REVIEW_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type ReviewStatus = keyof typeof REVIEW_STATUS;

export const TICKET_PRIORITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;

export type TicketPriority = keyof typeof TICKET_PRIORITY;

export const JOB_STATUS = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type JobStatus = keyof typeof JOB_STATUS;

export const WEBHOOK_PROVIDER = {
  RAZORPAY: 'RAZORPAY',
  STRIPE: 'STRIPE',
  SHIPPING: 'SHIPPING',
  CUSTOM: 'CUSTOM',
} as const;

export type WebhookProvider = keyof typeof WEBHOOK_PROVIDER;

export const ADMIN_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  SUSPEND: 'SUSPEND',
  ACTIVATE: 'ACTIVATE',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  EXPORT: 'EXPORT',
  IMPORT: 'IMPORT',
  SEND: 'SEND',
  TOGGLE: 'TOGGLE',
  RESET: 'RESET',
  IMPERSONATE: 'IMPERSONATE',
} as const;

export type AdminAction = keyof typeof ADMIN_ACTION;

export const WEBHOOK_DIRECTION = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;

export type WebhookDirection = keyof typeof WEBHOOK_DIRECTION;

export const NOTIFICATION_TYPE = {
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  PAYOUT: 'PAYOUT',
  RETURN: 'RETURN',
  TICKET: 'TICKET',
  PROMO: 'PROMO',
  SYSTEM: 'SYSTEM',
  ALERT: 'ALERT',
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPE;
