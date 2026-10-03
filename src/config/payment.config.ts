export const PAYMENT = {
  CODE_LENGTH: 6,
  REFERENCE_MAX_LENGTH: 100,
  GATEWAY_TIMEOUT_MS: 20_000,
  COD_MAX_AMOUNT_DEFAULT: 20_000,
  UPI_MAX_AMOUNT_DEFAULT: 100_000,
  BANK_MAX_AMOUNT_DEFAULT: 500_000,
  MIN_AMOUNT_DEFAULT: 1,
  WALLET_MAX_TXN_AMOUNT_DEFAULT: 50_000,
  ROUNDING_PRECISION: 2,
};

export const PAYMENT_FLOW = {
  TOKEN_MODE: { PERCENT: 'percent', FIXED: 'fixed' } as const,
  REFUND_MODE: { ORIGINAL: 'original', WALLET: 'wallet', bank: 'bank' } as const,
  BALANCE_TRIGGER: { DELIVERY: 'DELIVERY', DAYS: 'DAYS', MANUAL: 'MANUAL' } as const,
};

export const ORDER_NUMBER_LENGTH = 12;
export const RETURN_NUMBER_LENGTH = 10;
export const TICKET_NUMBER_LENGTH = 10;

export const GATEWAY = {
  RAZORPAY: 'razorpay',
  STRIPE: 'stripe',
} as const;

export type GatewayName = (typeof GATEWAY)[keyof typeof GATEWAY];

export const WEBHOOK_EVENT = {
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  REFUND_PROCESSED: 'refund.processed',
  ORDER_PAID: 'order.paid',
  SHIPMENT_DISPATCHED: 'shipment.dispatched',
  SHIPMENT_DELIVERED: 'shipment.delivered',
} as const;
