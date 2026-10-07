import { prisma } from './prisma.service';
import { cacheGet, cacheSet, cacheDel, cacheDelByPattern, getRedis } from './redis.service';
import { REDIS_KEYS, CACHE_TTL } from '../config/tracking.config';
import { SETTING_KEY, SETTING_CATEGORY, SettingCategory } from '../config/setting.config';
import { DLQ, QUEUE_POLICY } from '../config/queue.config';
import { logger } from './logger.service';
import { money } from '../utils/calculations';

export const getSetting = async <T>(key: string, fallback: T): Promise<T> => {
  const cacheKey = REDIS_KEYS.SETTING(key);
  const cached = await cacheGet<T>(cacheKey);
  if (cached !== null) return cached;

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    const value = (row?.value as T) ?? fallback;
    await cacheSet(cacheKey, value, CACHE_TTL.SETTING_SEC);
    return value;
  } catch (err) {
    logger.error({ err: (err as Error)?.message, key }, '[settings] read failed, using fallback');
    return fallback;
  }
};

export const getManySettings = async <T extends Record<string, unknown>>(
  defaults: T,
): Promise<T> => {
  const keys = Object.keys(defaults);
  const out: Record<string, unknown> = { ...defaults };

  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    for (const row of rows) out[row.key] = row.value;
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[settings] bulk read failed');
  }

  return out as T;
};

export const setSetting = async (
  key: string,
  value: unknown,
  category: string,
  userId?: string,
  isPublic?: boolean,
): Promise<void> => {
  const data = { key, value: value as any, category, updatedBy: userId, isPublic };
  const row = await prisma.systemSetting.upsert({
    where: { key },
    create: data,
    update: {
      value: value as any,
      category,
      updatedBy: userId,
      ...(typeof isPublic === 'boolean' ? { isPublic } : {}),
    },
  });

  await cacheDel(REDIS_KEYS.SETTING(key));
  await cacheDelByPattern(REDIS_KEYS.SETTING('*'));
  void row;
};

export const setManySettings = async (
  entries: { key: string; value: unknown; category: string; isPublic?: boolean }[],
  userId?: string,
): Promise<number> => {
  if (!entries.length) return 0;

  const result = await prisma.$transaction(
    entries.map((entry) =>
      prisma.systemSetting.upsert({
        where: { key: entry.key },
        create: {
          key: entry.key,
          value: entry.value as any,
          category: entry.category,
          updatedBy: userId,
          isPublic: entry.isPublic ?? false,
        },
        update: {
          value: entry.value as any,
          category: entry.category,
          updatedBy: userId,
          ...(typeof entry.isPublic === 'boolean' ? { isPublic: entry.isPublic } : {}),
        },
      }),
    ),
  );

  await cacheDelByPattern(REDIS_KEYS.SETTING('*'));
  return result.length;
};

export const getSettingByCategory = async (
  category: SettingCategory | string,
): Promise<Record<string, any>> => {
  const rows = await prisma.systemSetting.findMany({ where: { category } });
  return rows.reduce<Record<string, any>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
};

export const getPublicSettings = async (): Promise<Record<string, any>> => {
  const cacheKey = REDIS_KEYS.SETTING('__public__');
  const cached = await cacheGet<Record<string, any>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.systemSetting.findMany({ where: { isPublic: true } });
  const flat = rows.reduce<Record<string, any>>((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});

  const grouped = rows.reduce<Record<string, Record<string, any>>>((acc, row) => {
    acc[row.category] = acc[row.category] || {};
    acc[row.category][row.key] = row.value;
    return acc;
  }, {});

  const payload = { flat, grouped, totalRecord: rows.length };
  await cacheSet(cacheKey, payload, CACHE_TTL.PUBLIC_SETTINGS_SEC);
  return payload;
};

export const getFeatureFlags = async (): Promise<Record<string, boolean>> => {
  const cacheKey = REDIS_KEYS.SETTING('__features__');
  const cached = await cacheGet<Record<string, boolean>>(cacheKey);
  if (cached) return cached;

  const rows = await prisma.systemSetting.findMany({
    where: { category: SETTING_CATEGORY.FEATURE },
  });
  const flags = rows.reduce<Record<string, boolean>>((acc, row) => {
    acc[row.key] = Boolean(row.value);
    return acc;
  }, {});

  await cacheSet(cacheKey, flags, CACHE_TTL.SETTING_SEC);
  return flags;
};

export const toggleFeature = async (
  key: string,
  enabled: boolean,
  userId?: string,
): Promise<boolean> => {
  await setSetting(key, enabled, SETTING_CATEGORY.FEATURE, userId, true);
  await cacheDel(REDIS_KEYS.SETTING('__features__'));
  return enabled;
};

export const isFeatureEnabled = async (key: string, fallback = false): Promise<boolean> => {
  const flags = await getFeatureFlags();
  return key in flags ? flags[key] : fallback;
};

export const resetSettingsToDefault = async (
  defaults: { key: string; value: unknown; category: string; isPublic: boolean }[],
): Promise<number> => {
  const reset = await setManySettings(defaults);
  const redis = getRedis();
  if (redis) {
    try {
      const rows = await prisma.systemSetting.findMany({ select: { key: true } });
      const known = new Set(defaults.map((d) => d.key));
      const stale = rows.map((r) => r.key).filter((k) => !known.has(k));
      if (stale.length) {
        await prisma.systemSetting.deleteMany({ where: { key: { in: stale } } });
      }
    } catch (err) {
      logger.error({ err: (err as Error)?.message }, '[settings] stale cleanup failed');
    }
  }
  return reset;
};

export const getCommissionDefault = () => getSetting<number>(SETTING_KEY.COMMISSION_DEFAULT, 10);
export const getCommissionBounds = async () => ({
  min: await getSetting<number>(SETTING_KEY.COMMISSION_MIN_PERCENT, 0),
  max: await getSetting<number>(SETTING_KEY.COMMISSION_MAX_PERCENT, 50),
});
export const getDefaultGstPercent = () =>
  getSetting<number>(SETTING_KEY.TAX_DEFAULT_GST_PERCENT, 18);
export const getTaxInclusive = () => getSetting<boolean>(SETTING_KEY.TAX_INCLUSIVE, false);
export const getVendorAutoApprove = () =>
  getSetting<boolean>(SETTING_KEY.VENDOR_AUTO_APPROVE, false);
export const getVendorMaxProducts = () => getSetting<number>(SETTING_KEY.VENDOR_MAX_PRODUCTS, 500);
export const getMinPayoutAmount = () =>
  getSetting<number>(SETTING_KEY.VENDOR_MIN_PAYOUT_AMOUNT, 500);
export const getVendorPayoutHoldDays = () =>
  getSetting<number>(SETTING_KEY.VENDOR_PAYOUT_HOLD_DAYS, 3);
export const getOrderMinAmount = () => getSetting<number>(SETTING_KEY.ORDER_MIN_AMOUNT, 100);
export const getOrderMaxItems = () => getSetting<number>(SETTING_KEY.ORDER_MAX_ITEMS, 50);
export const getOrderCancelWindowMin = () =>
  getSetting<number>(SETTING_KEY.ORDER_CANCEL_WINDOW_MIN, 30);
export const getCartMaxItems = () => getSetting<number>(SETTING_KEY.CART_MAX_ITEMS, 50);

export const getGiftWrapConfig = async () => {
  const [charge, noteMax] = await Promise.all([
    getSetting<number>(SETTING_KEY.CART_GIFT_WRAP_CHARGE, 49),
    getSetting<number>(SETTING_KEY.CART_GIFT_WRAP_NOTE_MAX, 200),
  ]);
  return {
    charge: Math.max(0, money(Number(charge ?? 49))),
    noteMaxLength: Math.max(1, Number(noteMax ?? 200)),
  };
};

export const getMaxImagesPerProduct = () =>
  getSetting<number>(SETTING_KEY.CATALOG_MAX_IMAGES_PER_PRODUCT, 10);
export const getCurrencySymbol = () => getSetting<string>(SETTING_KEY.CURRENCY_SYMBOL, '₹');
export const getCurrencyDecimals = () => getSetting<number>(SETTING_KEY.CURRENCY_DECIMALS, 2);
export const getSiteName = () => getSetting<string>(SETTING_KEY.SITE_NAME, 'ProjectName');

export const getReviewEditWindowDays = () =>
  getSetting<number>(SETTING_KEY.REVIEW_EDIT_WINDOW_DAYS, 7);

export const getMaintenanceStatus = async (): Promise<{
  enabled: boolean;
  message: string;
  allowedIps: string[];
}> => {
  const enabled = await getSetting<boolean>(SETTING_KEY.MAINTENANCE_ENABLED, false);
  if (!enabled) {
    return { enabled: false, message: "We'll be back soon.", allowedIps: [] };
  }

  const message = await getSetting<string>(SETTING_KEY.MAINTENANCE_MESSAGE, "We'll be back soon.");
  const allowedIps = await getSetting<string[]>(SETTING_KEY.MAINTENANCE_ALLOWED_IPS, []);
  return {
    enabled: Boolean(enabled),
    message: String(message || "We'll be back soon."),
    allowedIps: Array.isArray(allowedIps) ? allowedIps : [],
  };
};

export const getTokenPaymentConfig = async () => {
  const [enabled, mode, percent, fixedAmount, minAmount, maxAmount, applicableAbove] =
    await Promise.all([
      getSetting<boolean>(SETTING_KEY.PAYMENT_TOKEN_ENABLED, false),
      getSetting<string>(SETTING_KEY.PAYMENT_TOKEN_MODE, 'percent'),
      getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_PERCENT, 20),
      getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_FIXED_AMOUNT, 100),
      getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_MIN_AMOUNT, 50),
      getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_MAX_AMOUNT, 5000),
      getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_APPLICABLE_ABOVE, 2000),
    ]);

  return {
    enabled: Boolean(enabled),
    mode: mode === 'fixed' ? ('fixed' as const) : ('percent' as const),
    percent: Number(percent ?? 20),
    fixedAmount: Number(fixedAmount ?? 100),
    minAmount: Number(minAmount ?? 50),
    maxAmount: Number(maxAmount ?? 5000),
    applicableAbove: Number(applicableAbove ?? 2000),
  };
};

export const getTokenPolicy = async () => {
  const [
    refundable,
    refundPercent,
    cancelWindowMin,
    balanceDueDays,
    allowedMethods,
    forfeitOnNoPay,
    autoCancelAfterDue,
  ] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.PAYMENT_TOKEN_REFUNDABLE, true),
    getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_REFUND_PERCENT, 100),
    getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_CANCEL_WINDOW_MIN, 60),
    getSetting<number>(SETTING_KEY.PAYMENT_TOKEN_BALANCE_DUE_DAYS, 7),
    getSetting<string[]>(SETTING_KEY.PAYMENT_TOKEN_ALLOWED_METHODS, ['UPI', 'CARD', 'NETBANKING']),
    getSetting<boolean>(SETTING_KEY.PAYMENT_TOKEN_FORFEIT_ON_NO_PAY, true),
    getSetting<boolean>(SETTING_KEY.PAYMENT_TOKEN_AUTO_CANCEL_AFTER_DUE, true),
  ]);

  return {
    refundable: Boolean(refundable),
    refundPercent: Number(refundPercent ?? 100),
    cancelWindowMin: Number(cancelWindowMin ?? 60),
    balanceDueDays: Number(balanceDueDays ?? 7),
    allowedMethods: Array.isArray(allowedMethods) ? allowedMethods : [],
    forfeitOnNoPay: Boolean(forfeitOnNoPay),
    autoCancelAfterDue: Boolean(autoCancelAfterDue),
  };
};

export const getShippingConfig = async () => {
  const [enabled, defaultCharge, freeAbove, estimatedDays, perKgCharge, maxDistanceKm, pincodes] =
    await Promise.all([
      getSetting<boolean>(SETTING_KEY.SHIPPING_ENABLED, true),
      getSetting<number>(SETTING_KEY.SHIPPING_DEFAULT_CHARGE, 49),
      getSetting<number>(SETTING_KEY.SHIPPING_FREE_ABOVE, 999),
      getSetting<number>(SETTING_KEY.SHIPPING_ESTIMATED_DAYS, 5),
      getSetting<number>(SETTING_KEY.SHIPPING_PER_KG_CHARGE, 0),
      getSetting<number>(SETTING_KEY.SHIPPING_MAX_DISTANCE_KM, 0),
      getSetting<string[]>(SETTING_KEY.SHIPPING_SERVICEABLE_PINCODES, []),
    ]);

  return {
    enabled: Boolean(enabled),
    defaultCharge: Number(defaultCharge ?? 49),
    freeAbove: Number(freeAbove ?? 999),
    estimatedDays: Number(estimatedDays ?? 5),
    perKgCharge: Number(perKgCharge ?? 0),
    maxDistanceKm: Number(maxDistanceKm ?? 0),
    serviceablePincodes: Array.isArray(pincodes) ? pincodes : [],
  };
};

export const getReturnConfig = async () => {
  const [enabled, windowDays, reasonRequired, imagesRequired, maxQty, processingDays, refundMode] =
    await Promise.all([
      getSetting<boolean>(SETTING_KEY.RETURN_ENABLED, true),
      getSetting<number>(SETTING_KEY.RETURN_WINDOW_DAYS, 7),
      getSetting<boolean>(SETTING_KEY.RETURN_REASON_REQUIRED, true),
      getSetting<boolean>(SETTING_KEY.RETURN_IMAGES_REQUIRED, true),
      getSetting<number>(SETTING_KEY.RETURN_MAX_QTY_PER_ORDER, 0),
      getSetting<number>(SETTING_KEY.REFUND_PROCESSING_DAYS, 5),
      getSetting<string>(SETTING_KEY.REFUND_MODE, 'original'),
    ]);

  return {
    enabled: Boolean(enabled),
    windowDays: Number(windowDays ?? 7),
    reasonRequired: Boolean(reasonRequired),
    imagesRequired: Boolean(imagesRequired),
    maxQtyPerOrder: Number(maxQty ?? 0),
    processingDays: Number(processingDays ?? 5),
    refundMode: String(refundMode ?? 'original'),
  };
};

export const getPaymentMethodsConfig = async () => {
  const [
    codEnabled,
    upiEnabled,
    bankEnabled,
    codMax,
    codEnabledAbove,
    codExtraCharge,
    upiId,
    bankHolder,
    bankAccount,
    bankIfsc,
  ] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.PAYMENT_COD_ENABLED, true),
    getSetting<boolean>(SETTING_KEY.PAYMENT_UPI_ENABLED, true),
    getSetting<boolean>(SETTING_KEY.PAYMENT_BANK_ENABLED, true),
    getSetting<number>(SETTING_KEY.PAYMENT_COD_MAX_AMOUNT, 20000),
    getSetting<number>(SETTING_KEY.PAYMENT_COD_ENABLED_ABOVE, 0),
    getSetting<number>(SETTING_KEY.PAYMENT_COD_EXTRA_CHARGE, 0),
    getSetting<string>(SETTING_KEY.PAYMENT_UPI_ID, ''),
    getSetting<string>(SETTING_KEY.PAYMENT_BANK_HOLDER, ''),
    getSetting<string>(SETTING_KEY.PAYMENT_BANK_ACCOUNT, ''),
    getSetting<string>(SETTING_KEY.PAYMENT_BANK_IFSC, ''),
  ]);

  return {
    cod: {
      enabled: Boolean(codEnabled),
      maxAmount: Number(codMax ?? 20000),
      enabledAbove: Number(codEnabledAbove ?? 0),
      extraCharge: Number(codExtraCharge ?? 0),
    },
    upi: { enabled: Boolean(upiEnabled), upiId: String(upiId ?? '') },
    bank: {
      enabled: Boolean(bankEnabled),
      holderName: String(bankHolder ?? ''),
      accountNo: String(bankAccount ?? ''),
      ifsc: String(bankIfsc ?? ''),
    },
  };
};

export const getWalletConfig = async () => {
  const [enabled, maxBalance, minRedeem, expiryDays] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.WALLET_ENABLED, false),
    getSetting<number>(SETTING_KEY.WALLET_MAX_BALANCE, 50000),
    getSetting<number>(SETTING_KEY.WALLET_MIN_REDEEM, 100),
    getSetting<number>(SETTING_KEY.WALLET_EXPIRY_DAYS, 365),
  ]);
  return {
    enabled: Boolean(enabled),
    maxBalance: Number(maxBalance ?? 50000),
    minRedeem: Number(minRedeem ?? 100),
    expiryDays: Number(expiryDays ?? 365),
  };
};

export const getLoyaltyConfig = async () => {
  const [enabled, pointsPerRupee, pointValue, minRedeemPoints] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.LOYALTY_ENABLED, false),
    getSetting<number>(SETTING_KEY.LOYALTY_POINTS_PER_RUPEE, 1),
    getSetting<number>(SETTING_KEY.LOYALTY_POINT_VALUE, 0.01),
    getSetting<number>(SETTING_KEY.LOYALTY_MIN_REDEEM_POINTS, 100),
  ]);
  return {
    enabled: Boolean(enabled),
    pointsPerRupee: Number(pointsPerRupee ?? 1),
    pointValue: Number(pointValue ?? 0.01),
    minRedeemPoints: Number(minRedeemPoints ?? 100),
  };
};

export const getReferralConfig = async () => {
  const [enabled, referrerReward, refereeReward, expiryDays] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.REFERRAL_ENABLED, false),
    getSetting<number>(SETTING_KEY.REFERRAL_REFERRER_REWARD, 50),
    getSetting<number>(SETTING_KEY.REFERRAL_REFEREE_REWARD, 50),
    getSetting<number>(SETTING_KEY.REFERRAL_EXPIRY_DAYS, 30),
  ]);

  return {
    enabled: Boolean(enabled),
    referrerReward: Number(referrerReward ?? 50),
    refereeReward: Number(refereeReward ?? 50),
    expiryDays: Number(expiryDays ?? 30),
  };
};

export const getGiftCardConfig = async () => {
  const [enabled, minAmount, maxAmount, expiryDays] = await Promise.all([
    getSetting<boolean>(SETTING_KEY.GIFT_CARD_ENABLED, false),
    getSetting<number>(SETTING_KEY.GIFT_CARD_MIN_AMOUNT, 100),
    getSetting<number>(SETTING_KEY.GIFT_CARD_MAX_AMOUNT, 50000),
    getSetting<number>(SETTING_KEY.GIFT_CARD_EXPIRY_DAYS, 365),
  ]);

  return {
    enabled: Boolean(enabled),
    minAmount: Number(minAmount ?? 100),
    maxAmount: Number(maxAmount ?? 50000),
    expiryDays: Number(expiryDays ?? 365),
  };
};

export const getSecurityConfig = async () => {
  const [
    maxAttempts,
    lockoutMinutes,
    sessionDays,
    otpLoginEnabled,
    twoFactorEnabled,
    requirePhoneVerify,
    requireEmailVerify,
    passwordHistoryCount,
    passwordExpiryDays,
    maxActiveSessions,
    loginAlerts,
    newDeviceAlerts,
    accountPurgeDays,
  ] = await Promise.all([
    getSetting<number>(SETTING_KEY.SECURITY_MAX_LOGIN_ATTEMPTS, 5),
    getSetting<number>(SETTING_KEY.SECURITY_LOCKOUT_MINUTES, 15),
    getSetting<number>(SETTING_KEY.SECURITY_SESSION_DAYS, 7),
    getSetting<boolean>(SETTING_KEY.SECURITY_OTP_LOGIN_ENABLED, false),
    getSetting<boolean>(SETTING_KEY.SECURITY_TWO_FACTOR_ENABLED, false),
    getSetting<boolean>(SETTING_KEY.SECURITY_REQUIRE_PHONE_VERIFY, true),
    getSetting<boolean>(SETTING_KEY.SECURITY_REQUIRE_EMAIL_VERIFY, false),
    getSetting<number>(SETTING_KEY.SECURITY_PASSWORD_HISTORY_COUNT, 3),
    getSetting<number>(SETTING_KEY.SECURITY_PASSWORD_EXPIRY_DAYS, 0),
    getSetting<number>(SETTING_KEY.SECURITY_MAX_ACTIVE_SESSIONS, 0),
    getSetting<boolean>(SETTING_KEY.SECURITY_LOGIN_ALERTS, true),
    getSetting<boolean>(SETTING_KEY.SECURITY_NEW_DEVICE_ALERTS, true),
    getSetting<number>(SETTING_KEY.SECURITY_ACCOUNT_PURGE_DAYS, 30),
  ]);
  return {
    maxAttempts: Number(maxAttempts ?? 5),
    lockoutMinutes: Number(lockoutMinutes ?? 15),
    sessionDays: Number(sessionDays ?? 7),
    otpLoginEnabled: Boolean(otpLoginEnabled),
    twoFactorEnabled: Boolean(twoFactorEnabled),
    requirePhoneVerify: Boolean(requirePhoneVerify),
    requireEmailVerify: Boolean(requireEmailVerify),
    passwordHistoryCount: Number(passwordHistoryCount ?? 3),
    passwordExpiryDays: Math.max(0, Number(passwordExpiryDays ?? 0)),
    maxActiveSessions: Math.max(0, Number(maxActiveSessions ?? 0)),
    loginAlerts: Boolean(loginAlerts),
    newDeviceAlerts: Boolean(newDeviceAlerts),
    accountPurgeDays: Math.max(1, Number(accountPurgeDays ?? 30)),
  };
};

export const getCouponConfig = async () => {
  const [maxPerOrder, stackable, minOrderAmount, maxDiscount] = await Promise.all([
    getSetting<number>(SETTING_KEY.COUPON_MAX_PER_ORDER, 1),
    getSetting<boolean>(SETTING_KEY.COUPON_STACKABLE, false),
    getSetting<number>(SETTING_KEY.COUPON_MIN_ORDER_AMOUNT, 0),
    getSetting<number>(SETTING_KEY.COUPON_MAX_DISCOUNT, 0),
  ]);
  return {
    maxPerOrder: Number(maxPerOrder ?? 1),
    stackable: Boolean(stackable),
    minOrderAmount: Number(minOrderAmount ?? 0),
    maxDiscount: Number(maxDiscount ?? 0),
  };
};

export const getCatalogConfig = async () => {
  const [productsPerPage, showOutOfStock, allowBackorder, defaultSort] = await Promise.all([
    getSetting<number>(SETTING_KEY.CATALOG_PRODUCTS_PER_PAGE, 20),
    getSetting<boolean>(SETTING_KEY.CATALOG_SHOW_OUT_OF_STOCK, true),
    getSetting<boolean>(SETTING_KEY.CATALOG_ALLOW_BACKORDER, false),
    getSetting<string>(SETTING_KEY.CATALOG_DEFAULT_SORT, '-createdAt'),
  ]);
  return {
    productsPerPage: Number(productsPerPage ?? 20),
    showOutOfStock: Boolean(showOutOfStock),
    allowBackorder: Boolean(allowBackorder),
    defaultSort: String(defaultSort ?? '-createdAt'),
  };
};

/**
 * Read once per enqueue rather than per call site. The attempt count is clamped
 * to at least one because zero there would silently turn every job into a job
 * that runs once and is never retried.
 */
export const getQueueConfig = async () => {
  const [maxAttempts, backoffDelayMs, maxReplays] = await Promise.all([
    getSetting<number>(SETTING_KEY.QUEUE_MAX_ATTEMPTS, QUEUE_POLICY.ATTEMPTS),
    getSetting<number>(SETTING_KEY.QUEUE_BACKOFF_DELAY_MS, QUEUE_POLICY.BACKOFF_DELAY_MS),
    getSetting<number>(SETTING_KEY.QUEUE_MAX_REPLAYS, DLQ.MAX_REPLAYS),
  ]);
  return {
    maxAttempts: Math.max(1, Number(maxAttempts ?? QUEUE_POLICY.ATTEMPTS)),
    backoffDelayMs: Math.max(0, Number(backoffDelayMs ?? QUEUE_POLICY.BACKOFF_DELAY_MS)),
    maxReplays: Math.max(0, Number(maxReplays ?? DLQ.MAX_REPLAYS)),
  };
};
