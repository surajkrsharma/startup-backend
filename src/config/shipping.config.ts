export const SHIPPING = {
  DEFAULT_WEIGHT_UNIT: 'kg',
  DEFAULT_DIMENSION_UNIT: 'cm',
  DEFAULT_PARTNER: 'manual',
  TRACKING_REFRESH_MIN: 60,
  DEFAULT_METHOD_CODE: 'STANDARD',
  DEFAULT_PARTNER_CODE: 'manual',
  COD_COLLECTION_METHOD: 'COD',
  AWB_PREFIX: 'AWB',
};

export const DELIVERY = {
  DEFAULT_OTP_LENGTH: 6,
  OTP_EXPIRY_MIN: 10,
  MAX_ATTEMPTS: 3,
  MAX_DISTANCE_KM_DEFAULT: 25,
  STATUS_LABELS: {
    PENDING: 'Order placed',
    LABEL_CREATED: 'Shipping label created',
    PICKED_UP: 'Picked up',
    IN_TRANSIT: 'In transit',
    OUT_FOR_DELIVERY: 'Out for delivery',
    DELIVERED: 'Delivered',
    FAILED: 'Delivery failed',
    RETURNED: 'Returned',
    CANCELLED: 'Cancelled',
  } as Record<string, string>,
};
