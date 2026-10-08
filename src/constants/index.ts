export { ROLES, ROLE_VALUES, ADMIN_ROLES, REGISTER_TYPE, OTP_TYPE, SOCIAL_PROVIDER } from './roles';
export type {
  Role,
  RegisterType,
  OtpType,
  SocialProvider,
  Platform,
  PaymentMethod,
  PaymentStatus,
  VendorStatus,
  ProductStatus,
  PayoutStatus,
  CouponType,
  CouponStatus,
  AttributeType,
  CollectionType,
  ShipmentStatus,
  AddressType,
  WalletTxnType,
  LoyaltyTxnType,
  ReferralStatus,
  GiftCardStatus,
  ReviewStatus,
  TicketPriority,
  JobStatus,
  WebhookProvider,
  AdminAction,
  NotificationType,
  OtpChannel,
} from './roles';

export {
  ORDER_STATUS,
  ORDER_STATUS_VALUES,
  ORDER_TRANSITIONS,
  SUB_ORDER_TRANSITIONS,
  canTransitionOrder,
  canTransitionSubOrder,
  RETURN_STATUS,
  RETURN_STATUS_VALUES,
  RETURN_TRANSITIONS,
  canTransitionReturn,
  TICKET_STATUS,
  TICKET_STATUS_VALUES,
  TICKET_TRANSITIONS,
  canTransitionTicket,
  PAYOUT_STATUS_TRANSITIONS,
  SHIPMENT_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  DELIVERED_ORDER_STATUSES,
} from './statuses';

export {
  TRACKING_EVENT,
  TRACKING_EVENT_VALUES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_CHANNEL_VALUES,
  DEFAULT_NOTIFICATION_ORDER_EVENTS,
  NOTIFICATION_EVENT,
  EMAIL_TEMPLATE_KEY,
} from './tracking';

export { HTTP_STATUS, HTTP_STATUS_MESSAGE, ERROR_CODE } from './http';
export type { HttpStatus, ErrorCode } from './http';

export {
  PERMISSION,
  PERMISSION_VALUES,
  PERMISSION_GROUPS,
  DEFAULT_ROLE_PERMISSIONS,
} from './permissions';
export type { Permission } from './permissions';

export {
  SEGMENT_KIND,
  SEGMENT_KIND_VALUES,
  SEGMENT_SOURCE,
  SEGMENT_SOURCE_VALUES,
  AUTO_SEGMENT_KINDS,
  isAutoSegmentKind,
  ANNOUNCEMENT_STATUS,
  ANNOUNCEMENT_STATUS_VALUES,
  BAN_REASON_MAX_LENGTH,
  VACATION_MAX_DAYS,
} from './segments';
export type { SegmentKind, SegmentSource, AnnouncementStatus } from './segments';

export {
  COUNTRY_CODE,
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_DIAL_CODE,
  PHONE_REGEX,
  EMAIL_REGEX,
  SLUG_REGEX,
  GSTIN_REGEX,
  PAN_REGEX,
  IFSC_REGEX,
  UPI_REGEX,
  COUPON_CODE_REGEX,
  ORDER_NUMBER_PREFIX,
  RETURN_NUMBER_PREFIX,
  TICKET_NUMBER_PREFIX,
} from './countries';
export type { CountryCode, CountryMeta } from './countries';
