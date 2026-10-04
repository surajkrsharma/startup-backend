export const TRACKING_EVENT = {
  APP_OPEN: 'app_open',
  APP_INSTALL: 'app_install',
  APP_UPDATE: 'app_update',
  SIGNUP_START: 'signup_start',
  SIGNUP_COMPLETE: 'signup_complete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  PRODUCT_VIEW: 'product_view',
  CATEGORY_VIEW: 'category_view',
  SEARCH: 'search',
  FILTER_APPLY: 'filter_apply',
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  ADD_TO_WISHLIST: 'add_to_wishlist',
  CHECKOUT_START: 'checkout_start',
  ADDRESS_ADD: 'address_add',
  PAYMENT_INIT: 'payment_init',
  PAYMENT_SUCCESS: 'payment_success',
  PAYMENT_FAIL: 'payment_fail',
  ORDER_PLACED: 'order_placed',
  ORDER_CANCELLED: 'order_cancelled',
  ORDER_RETURNED: 'order_returned',
  REVIEW_SUBMIT: 'review_submit',
  COUPON_APPLY: 'coupon_apply',
  COUPON_FAIL: 'coupon_fail',
  SHARE: 'share',
  CONTACT_CLICK: 'contact_click',
  CHAT_OPEN: 'chat_open',
  CHAT_SEND: 'chat_send',
  PUSH_RECEIVED: 'push_received',
  PUSH_CLICK: 'push_click',
} as const;

export type TrackingEventName = keyof typeof TRACKING_EVENT;

export const TRACKING_EVENT_VALUES = Object.values(TRACKING_EVENT) as string[];

export const NOTIFICATION_CHANNEL = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  WHATSAPP: 'WHATSAPP',
  IN_APP: 'IN_APP',
} as const;

export type NotificationChannelType = keyof typeof NOTIFICATION_CHANNEL;

export const NOTIFICATION_CHANNEL_VALUES = Object.values(
  NOTIFICATION_CHANNEL,
) as NotificationChannelType[];

export const DEFAULT_NOTIFICATION_ORDER_EVENTS = ['CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

export const NOTIFICATION_EVENT = {
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  TOKEN_BALANCE_REMINDER: 'TOKEN_BALANCE_REMINDER',
  PAYOUT_PROCESSED: 'PAYOUT_PROCESSED',
  RETURN_UPDATE: 'RETURN_UPDATE',
  TICKET_REPLY: 'TICKET_REPLY',
  PROMO: 'PROMO',
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENT;

export const EMAIL_TEMPLATE_KEY = {
  ORDER_CONFIRM: 'order_confirm',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  RESET_PASSWORD: 'reset_password',
  EMAIL_VERIFY: 'email_verify',
  PHONE_VERIFY: 'phone_verify',
  TWO_FA: 'two_factor',
  VENDOR_APPROVED: 'vendor_approved',
  VENDOR_REJECTED: 'vendor_rejected',
  PAYOUT_PROCESSED: 'payout_processed',
  RETURN_UPDATE: 'return_update',
  TOKEN_BALANCE_REMINDER: 'token_balance_reminder',
  CONTACT_SUBMISSION: 'contact_submission',
  NEWSLETTER_WELCOME: 'newsletter_welcome',
} as const;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATE_KEY;
