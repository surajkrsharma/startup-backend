import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { PAYMENT_METHOD } from '../../constants/roles';
import type { CouponType } from '@prisma/client';
import { calcCouponDiscount, calcShippingCharge } from '../../utils/calculations';
import {
  getCartMaxItems,
  getCouponConfig,
  getDefaultGstPercent,
  getPaymentMethodsConfig,
  getShippingConfig,
  getTaxInclusive,
  getWalletConfig,
} from '../../services/settings.service';
import { cacheDel } from '../../services/redis.service';
import { writeActivityLog } from '../../services/audit.service';
import { isFuture, isPast } from '../../utils/dates';

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          mrpPrice: true,
          stock: true,
          status: true,
          taxPercent: true,
          weight: true,
          allowBackorder: true,
          categoryId: true,
          vendorId: true,
          vendor: { select: { id: true, shopName: true, slug: true, status: true } },
          images: { select: { url: true, sortOrder: true } },
        },
      },
      variant: {
        select: {
          id: true,
          title: true,
          sku: true,
          price: true,
          mrpPrice: true,
          stock: true,
          isActive: true,
          attributes: true,
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;

export const getOrCreateCart = async (userId: string): Promise<CartRow> => {
  const existing = await prisma.cart.findUnique({ where: { userId }, include: CART_INCLUDE });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId }, include: CART_INCLUDE });
};

export const getCart = async (userId: string): Promise<CartRow> => getOrCreateCart(userId);

const dropCartCache = async (userId: string): Promise<void> => {
  await cacheDel(`cart:${userId}`);
};

export interface CartLine {
  item: any;
  unitPrice: number;
  lineSubtotal: number;
  lineTax: number;
  taxPercent: number;
  availableStock: number;
  isAvailable: boolean;
}

export interface CartTotalsResult {
  lines: CartLine[];
  itemCount: number;
  totalQty: number;
  subtotal: number;
  discount: number;
  couponDiscount: number;
  taxAmount: number;
  shippingAmount: number;
  shippingFree: boolean;
  walletAmount: number;
  total: number;
  couponCode: string;

  coupon: CouponSummary | null;
  couponTitle: string;
  couponType: string;
  couponFreeShipping: boolean;

  couponInvalid: boolean;
  hasStockIssue: boolean;
}

export const EMPTY_TOTALS: CartTotalsResult = {
  lines: [],
  itemCount: 0,
  totalQty: 0,
  subtotal: 0,
  discount: 0,
  couponDiscount: 0,
  taxAmount: 0,
  shippingAmount: 0,
  shippingFree: false,
  walletAmount: 0,
  total: 0,
  couponCode: '',
  coupon: null,
  couponTitle: '',
  couponType: '',
  couponFreeShipping: false,
  couponInvalid: false,
  hasStockIssue: false,
};

export const calculateTotals = async (
  cart: CartRow,
  options: {
    couponCode?: string;
    paymentMethod?: string;
    useWallet?: boolean;
    walletAmount?: number;
  } = {},
): Promise<CartTotalsResult> => {
  const items = D.arr(cart?.items) as any[];

  if (!items.length) {
    return { ...EMPTY_TOTALS, couponCode: D.str(options.couponCode ?? cart?.couponCode) };
  }

  const [taxInclusive, defaultGst, shippingCfg] = await Promise.all([
    getTaxInclusive(),
    getDefaultGstPercent(),
    getShippingConfig(),
  ]);

  const lines: CartLine[] = items.map((item) => {
    const product = item.product;
    const variant = item.variant;
    const qty = D.num(item.qty);

    const unitPrice = money(variant?.price ?? product?.price ?? D.float(item.price));
    const availableStock = D.num(variant?.stock ?? product?.stock);

    const isAvailable =
      D.str(product?.status) === 'ACTIVE' &&
      D.str(product?.vendor?.status) === 'APPROVED' &&
      (!variant || variant.isActive !== false) &&
      (availableStock >= qty || D.bool(product?.allowBackorder));

    const taxPercent =
      product?.taxPercent === null || product?.taxPercent === undefined
        ? D.float(defaultGst)
        : D.float(product.taxPercent);

    const lineSubtotal = money(unitPrice * qty);

    const lineTax = taxInclusive
      ? money((lineSubtotal * taxPercent) / (100 + taxPercent))
      : money((lineSubtotal * taxPercent) / 100);

    return { item, unitPrice, lineSubtotal, lineTax, taxPercent, availableStock, isAvailable };
  });

  const itemCount = lines.length;
  const totalQty = lines.reduce((sum, l) => sum + D.num(l.item.qty), 0);
  const subtotal = money(lines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const taxAmount = money(lines.reduce((sum, l) => sum + l.lineTax, 0));

  const requestedCode = D.str(options.couponCode ?? cart?.couponCode);
  let couponDiscount = 0;
  let couponFreeShipping = false;
  let coupon: CouponSummary | null = null;
  let couponTitle = '';
  let couponType = '';

  let couponInvalid = false;

  if (requestedCode) {
    try {
      const resolved = await resolveCoupon(requestedCode, subtotal, lines);
      coupon = resolved.coupon;
      couponDiscount = resolved.discount;
      couponFreeShipping = resolved.freeShipping;
      couponTitle = D.str(resolved.coupon.title);
      couponType = D.str(resolved.coupon.type);
    } catch {
      couponInvalid = true;
    }
  }

  const weightKg = money(
    lines.reduce((sum, l) => sum + D.float(l.item.product?.weight), 0),
    3,
  );
  const goodsValue = money(subtotal - couponDiscount + taxAmount);

  let shippingAmount = 0;
  let shippingFree = false;

  if (shippingCfg.enabled) {
    if (couponFreeShipping || (shippingCfg.freeAbove > 0 && goodsValue >= shippingCfg.freeAbove)) {
      shippingFree = true;
    } else {
      const charge = calcShippingCharge({
        orderValue: goodsValue,
        defaultCharge: shippingCfg.defaultCharge,
        perKgCharge: shippingCfg.perKgCharge,
        weightKg,
      });
      shippingAmount = charge.charge;
      shippingFree = charge.isFree;
    }

    if (D.str(options.paymentMethod) === PAYMENT_METHOD.COD) {
      const methods = await getPaymentMethodsConfig();
      shippingAmount = money(shippingAmount + methods.cod.extraCharge);
    }
  }

  const payable = money(Math.max(0, subtotal - couponDiscount + taxAmount + shippingAmount));

  let walletAmount = 0;
  if (options.useWallet) {
    const walletCfg = await getWalletConfig();
    if (walletCfg.enabled) {
      walletAmount = money(
        Math.min(D.num(options.walletAmount) || payable, payable, walletCfg.maxBalance),
      );
    }
  }

  const total = money(Math.max(0, payable - walletAmount));

  return {
    lines,
    itemCount,
    totalQty,
    subtotal,
    discount: 0,
    couponDiscount,
    taxAmount,
    shippingAmount,
    shippingFree,
    walletAmount,
    total,
    couponCode: requestedCode,
    coupon,
    couponTitle,
    couponType,
    couponFreeShipping,
    couponInvalid,
    hasStockIssue: lines.some((l) => !l.isAvailable),
  };
};

export interface CouponSummary {
  id: string;
  code: string;
  title: string;
  type: string;
  discount: number;
  freeShipping: boolean;
}

interface ResolvedCoupon {
  coupon: CouponSummary;
  discount: number;
  freeShipping: boolean;
}

const resolveCoupon = async (
  code: string,
  subtotal: number,
  lines: CartLine[],
): Promise<ResolvedCoupon> => {
  const upper = D.str(code).toUpperCase();

  const row = await prisma.coupon.findFirst({
    where: { code: upper, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      type: true,
      value: true,
      maxDiscount: true,
      minOrderAmount: true,
      maxUsage: true,
      usedCount: true,
      maxUsagePerUser: true,
      vendorId: true,
      productIds: true,
      categoryIds: true,
      startsAt: true,
      expiresAt: true,
      isActive: true,
      status: true,
    },
  });

  if (!row) throw AppError.notFound(ERROR.COUPON.NOT_FOUND, ERROR_CODE.COUPON_NOT_FOUND);

  if (!row.isActive || row.status !== 'ACTIVE') {
    throw AppError.unprocessable(ERROR.COUPON.INVALID);
  }

  if (isFuture(row.startsAt)) throw AppError.unprocessable(ERROR.COUPON.INVALID);

  if (row.expiresAt && isPast(row.expiresAt)) {
    throw AppError.unprocessable(ERROR.COUPON.EXPIRED);
  }

  const config = await getCouponConfig();
  const minRequired = Math.max(D.float(row.minOrderAmount), D.float(config.minOrderAmount));

  if (minRequired > 0 && subtotal < minRequired) {
    throw AppError.unprocessable(`${ERROR.COUPON.MIN_NOT_MET} (minimum ${minRequired})`);
  }

  if (row.maxUsage > 0 && row.usedCount >= row.maxUsage) {
    throw AppError.unprocessable(ERROR.COUPON.USAGE_LIMIT);
  }

  const applyDiscount = (base: number) => {
    const applied = calcCouponDiscount({
      subtotal: base,
      type: row.type as CouponType,
      value: row.value,
      maxDiscount: row.maxDiscount,
      globalMaxDiscount: config.maxDiscount,
    });

    return {
      coupon: {
        id: row.id,
        code: row.code,
        title: row.title,
        type: row.type,
        discount: applied.discount,
        freeShipping: applied.freeShipping,
      },
      discount: applied.discount,
      freeShipping: applied.freeShipping,
    } satisfies ResolvedCoupon;
  };

  if (row.vendorId) {
    if (!lines.some((l) => D.str(l.item.product?.vendorId) === row.vendorId)) {
      throw AppError.unprocessable(ERROR.COUPON.NOT_APPLICABLE);
    }
  }

  const productIds = D.strArr(row.productIds);
  const categoryIds = D.strArr(row.categoryIds);

  if (productIds.length) {
    const eligible = lines.filter((l) => productIds.includes(D.str(l.item.productId)));
    if (!eligible.length) throw AppError.unprocessable(ERROR.COUPON.NOT_APPLICABLE);
    return applyDiscount(money(eligible.reduce((sum, l) => sum + l.lineSubtotal, 0)));
  }

  if (categoryIds.length) {
    const eligible = lines.filter((l) => categoryIds.includes(D.str(l.item.product?.categoryId)));
    if (!eligible.length) throw AppError.unprocessable(ERROR.COUPON.NOT_APPLICABLE);
    return applyDiscount(money(eligible.reduce((sum, l) => sum + l.lineSubtotal, 0)));
  }

  return applyDiscount(subtotal);
};

export const validateCoupon = async (userId: string, code: string): Promise<ResolvedCoupon> => {
  const cart = await getOrCreateCart(userId);
  const totals = await calculateTotals(cart, { couponCode: '' });
  return resolveCoupon(code, totals.subtotal, totals.lines);
};

interface SellableProduct {
  product: { id: string; name: string; price: number; stock: number; allowBackorder: boolean };
  variantId: string;
  unitPrice: number;
  stock: number;
  allowBackorder: boolean;
}

const loadSellableProduct = async (
  productId: string,
  variantId: string,
): Promise<SellableProduct> => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      status: true,
      allowBackorder: true,
      vendorId: true,
      vendor: { select: { status: true } },
    },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND);

  if (product.vendor?.status !== 'APPROVED') {
    throw AppError.forbidden(ERROR.PRODUCT.VENDOR_NOT_APPROVED, ERROR_CODE.VENDOR_NOT_APPROVED);
  }

  if (product.status !== 'ACTIVE') {
    throw AppError.unprocessable(ERROR.PRODUCT.NOT_FOUND);
  }

  if (!variantId) {
    return {
      product: {
        id: product.id,
        name: product.name,
        price: D.float(product.price),
        stock: D.num(product.stock),
        allowBackorder: D.bool(product.allowBackorder),
      },
      variantId: '',
      unitPrice: money(product.price),
      stock: D.num(product.stock),
      allowBackorder: D.bool(product.allowBackorder),
    };
  }

  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true, price: true, stock: true, isActive: true },
  });

  if (!variant || !variant.isActive) {
    throw AppError.notFound(ERROR.PRODUCT.INVALID_VARIANT);
  }

  return {
    product: {
      id: product.id,
      name: product.name,
      price: D.float(product.price),
      stock: D.num(product.stock),
      allowBackorder: D.bool(product.allowBackorder),
    },
    variantId: variant.id,
    unitPrice: money(variant.price) || money(product.price),
    stock: D.num(variant.stock),
    allowBackorder: D.bool(product.allowBackorder),
  };
};

const assertStock = (stock: number, qty: number, allowBackorder: boolean): void => {
  if (allowBackorder) return;
  if (stock <= 0) throw AppError.unprocessable(ERROR.PRODUCT.OUT_OF_STOCK, ERROR_CODE.OUT_OF_STOCK);
  if (stock < qty) {
    throw AppError.unprocessable(`Only ${stock} left in stock.`, ERROR_CODE.OUT_OF_STOCK);
  }
};

export const addItem = async (
  userId: string,
  input: { productId: string; variantId?: string; qty: number },
  req?: any,
): Promise<{ item: any; totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);
  const variantId = D.str(input.variantId);
  const qty = Math.max(1, D.num(input.qty));

  const sellable = await loadSellableProduct(D.str(input.productId), variantId);
  assertStock(sellable.stock, qty, sellable.allowBackorder);

  const existing = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      productId: sellable.product.id,
      variantId: variantId || null,
    },
    select: { id: true, qty: true },
  });

  const newQty = D.num(existing?.qty) + qty;
  assertStock(sellable.stock, newQty, sellable.allowBackorder);

  const maxItems = await getCartMaxItems();

  if (!existing) {
    const itemCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
    if (itemCount >= maxItems) {
      throw AppError.unprocessable(ERROR.CART.MAX_ITEMS, ERROR_CODE.CART_MAX_ITEMS);
    }
  }

  const lineData = { qty: newQty, price: sellable.unitPrice };

  const item = existing
    ? await prisma.cartItem.update({ where: { id: existing.id }, data: lineData })
    : await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: sellable.product.id,
          variantId: variantId || null,
          ...lineData,
          userId,
        },
      });

  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'CART_ITEM_ADDED',
    entity: 'CartItem',
    entityId: item.id,
    meta: { productId: sellable.product.id, qty: newQty },
  });

  return { item, totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const updateItem = async (
  userId: string,
  input: { productId: string; variantId?: string; qty: number },
  req?: any,
): Promise<{ removed: boolean; totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);
  const variantId = D.str(input.variantId);
  const qty = D.num(input.qty);

  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: D.str(input.productId), variantId: variantId || null },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CART.ITEM_NOT_FOUND, ERROR_CODE.CART_ITEM_NOT_FOUND);

  if (qty <= 0) {
    await prisma.cartItem.delete({ where: { id: existing.id } });
    await dropCartCache(userId);
    return { removed: true, totals: await calculateTotals(await getOrCreateCart(userId)) };
  }

  const sellable = await loadSellableProduct(D.str(input.productId), variantId);
  assertStock(sellable.stock, qty, sellable.allowBackorder);

  await prisma.cartItem.update({ where: { id: existing.id }, data: { qty } });
  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'CART_ITEM_UPDATED',
    entity: 'CartItem',
    entityId: existing.id,
    meta: { qty },
  });

  return { removed: false, totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const removeItem = async (
  userId: string,
  input: { id?: string; productId?: string; variantId?: string },
  req?: any,
): Promise<{ totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);

  const existing = await prisma.cartItem.findFirst({
    where: {
      cartId: cart.id,
      ...(D.str(input.id)
        ? { id: D.str(input.id) }
        : {
            productId: D.str(input.productId),
            variantId: D.str(input.variantId) || null,
          }),
    },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.CART.ITEM_NOT_FOUND, ERROR_CODE.CART_ITEM_NOT_FOUND);

  await prisma.cartItem.delete({ where: { id: existing.id } });
  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'CART_ITEM_REMOVED',
    entity: 'CartItem',
    entityId: existing.id,
  });

  return { totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const clearCart = async (
  userId: string,
  req?: any,
): Promise<{ removedCount: number; totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);

  const { count } = await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: '' } });
  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'CART_CLEARED',
    entity: 'Cart',
    entityId: cart.id,
    meta: { removedCount: count },
  });

  return { removedCount: count, totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const applyCoupon = async (
  userId: string,
  code: string,
  req?: any,
): Promise<{ totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);

  await validateCoupon(userId, code);

  await prisma.cart.update({
    where: { id: cart.id },
    data: { couponCode: D.str(code).toUpperCase() },
  });
  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'CART_COUPON_APPLIED',
    entity: 'Cart',
    entityId: cart.id,
    meta: { code: D.str(code).toUpperCase() },
  });

  return { totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const removeCoupon = async (userId: string): Promise<{ totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);
  await prisma.cart.update({ where: { id: cart.id }, data: { couponCode: '' } });
  await dropCartCache(userId);
  return { totals: await calculateTotals(await getOrCreateCart(userId)) };
};

export const estimate = async (
  userId: string,
  input: {
    addressId?: string;
    paymentMethod?: string;
    useWalletBalance?: boolean;
    walletAmount?: number;
    couponCode?: string;
  },
): Promise<{
  totals: CartTotalsResult;
  address: Record<string, any> | null;
  payment: Record<string, any>;
  walletBalance: number;
}> => {
  const cart = await getOrCreateCart(userId);

  if (!D.arr(cart.items).length) {
    throw AppError.badRequest(ERROR.CART.EMPTY);
  }

  const method = D.str(input.paymentMethod) || PAYMENT_METHOD.COD;
  const methods = await getPaymentMethodsConfig();

  const enabled =
    method === PAYMENT_METHOD.COD
      ? methods.cod.enabled
      : method === PAYMENT_METHOD.UPI
        ? methods.upi.enabled
        : method === PAYMENT_METHOD.BANK
          ? methods.bank.enabled
          : false;

  if (!enabled) throw AppError.unprocessable(ERROR.PAYMENT.METHOD_DISABLED);

  const totals = await calculateTotals(cart, {
    couponCode: D.str(input.couponCode) || undefined,
    paymentMethod: method,
    useWallet: D.bool(input.useWalletBalance),
    walletAmount: D.num(input.walletAmount),
  });

  if (method === PAYMENT_METHOD.COD && totals.total > methods.cod.maxAmount) {
    throw AppError.unprocessable(
      `Cash on delivery is not available above ${methods.cod.maxAmount}.`,
    );
  }

  let address: Record<string, any> | null = null;

  if (D.str(input.addressId)) {
    const row = await prisma.address.findFirst({
      where: { id: D.str(input.addressId), userId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        line1: true,
        line2: true,
        landmark: true,
        deliveryInstructions: true,
        city: true,
        state: true,
        stateCode: true,
        country: true,
        pincode: true,
        isDefault: true,
      },
    });

    if (!row) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND);

    address = {
      addressId: D.str(row.id),
      fullName: D.str(row.fullName),
      phone: D.str(row.phone),
      line1: D.str(row.line1),
      line2: D.str(row.line2),
      landmark: D.str(row.landmark),
      deliveryInstructions: D.str(row.deliveryInstructions),
      city: D.str(row.city),
      state: D.str(row.state),
      stateCode: D.str(row.stateCode),
      country: D.str(row.country),
      pincode: D.str(row.pincode),
    };
  }

  let walletBalance = 0;
  if (D.bool(input.useWalletBalance)) {
    walletBalance = await getWalletBalance(userId);
  }

  return {
    totals,
    address,
    payment: {
      method,
      isCod: method === PAYMENT_METHOD.COD,
      codMaxAmount: methods.cod.maxAmount,
    },
    walletBalance,
  };
};

export const mergeGuestCart = async (
  userId: string,
  input: { sessionKey?: string; items: { productId: string; variantId?: string; qty: number }[] },
  req?: any,
): Promise<{ mergedCount: number; skippedCount: number; totals: CartTotalsResult }> => {
  const cart = await getOrCreateCart(userId);
  const sessionKey = D.str(input.sessionKey ?? req?.sessionKey);

  const incoming: { productId: string; variantId: string; qty: number }[] = [];

  if (sessionKey) {
    const sessionCarts = await prisma.cart.findMany({
      where: { sessionKey },
      select: { id: true },
    });

    if (sessionCarts.length) {
      const rows = await prisma.cartItem.findMany({
        where: { cartId: { in: sessionCarts.map((c) => c.id) } },
        select: { productId: true, variantId: true, qty: true },
      });

      for (const row of rows) {
        incoming.push({
          productId: row.productId,
          variantId: D.str(row.variantId),
          qty: D.num(row.qty),
        });
      }
    }
  }

  for (const row of D.arr(input.items) as any[]) {
    incoming.push({
      productId: D.str(row.productId),
      variantId: D.str(row.variantId),
      qty: Math.max(1, D.num(row.qty)),
    });
  }

  if (!incoming.length) {
    return { mergedCount: 0, skippedCount: 0, totals: await calculateTotals(cart) };
  }

  const merged = new Map<string, { productId: string; variantId: string; qty: number }>();
  for (const entry of incoming) {
    const key = `${entry.productId}:${entry.variantId}`;
    const prior = merged.get(key);
    if (prior) prior.qty += entry.qty;
    else merged.set(key, { ...entry });
  }

  const maxItems = await getCartMaxItems();
  let mergedCount = 0;
  let skippedCount = 0;

  for (const entry of merged.values()) {
    try {
      const sellable = await loadSellableProduct(entry.productId, entry.variantId);

      const existing = await prisma.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId: sellable.product.id,
          variantId: entry.variantId || null,
        },
        select: { id: true, qty: true },
      });

      const wanted = D.num(existing?.qty) + entry.qty;

      const qty = sellable.allowBackorder ? wanted : Math.min(wanted, sellable.stock);

      if (qty <= 0) {
        skippedCount += 1;
        continue;
      }

      if (!existing) {
        const count = await prisma.cartItem.count({ where: { cartId: cart.id } });
        if (count >= maxItems) {
          skippedCount += 1;
          continue;
        }
      }

      const lineData = { qty, price: sellable.unitPrice };

      await (existing
        ? prisma.cartItem.update({ where: { id: existing.id }, data: lineData })
        : prisma.cartItem.create({
            data: {
              cartId: cart.id,
              productId: sellable.product.id,
              variantId: entry.variantId || null,
              ...lineData,
              userId,
            },
          }));

      mergedCount += 1;
    } catch {
      skippedCount += 1;
    }
  }

  await dropCartCache(userId);

  void writeActivityLog({
    req,
    userId,
    action: 'GUEST_CART_MERGED',
    entity: 'Cart',
    entityId: cart.id,
    meta: { mergedCount, skippedCount },
  });

  return {
    mergedCount,
    skippedCount,
    totals: await calculateTotals(await getOrCreateCart(userId)),
  };
};

export const getWalletBalance = async (userId: string): Promise<number> => {
  const [credits, debits] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        userId,
        status: 'SUCCESS',
        type: { in: ['CREDIT', 'REFUND', 'REWARD', 'ADJUSTMENT'] },
      },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { userId, status: 'SUCCESS', type: { in: ['DEBIT', 'REDEEM'] } },
      _sum: { amount: true },
    }),
  ]);

  return money(D.float(credits._sum.amount) - D.float(debits._sum.amount));
};

const WISHLIST_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      mrpPrice: true,
      stock: true,
      status: true,
      vendorId: true,
      vendor: { select: { id: true, shopName: true, slug: true, status: true } },
      images: { select: { url: true, sortOrder: true } },
    },
  },
} satisfies Prisma.WishlistItemInclude;

const getOrCreateWishlist = async (userId: string): Promise<{ id: string }> => {
  const existing = await prisma.wishlist.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing;
  return prisma.wishlist.create({ data: { userId }, select: { id: true } });
};

export const listWishlist = async (userId: string): Promise<any[]> => {
  const wishlist = await getOrCreateWishlist(userId);

  return prisma.wishlistItem.findMany({
    where: { wishlistId: wishlist.id },
    orderBy: { createdAt: 'desc' },
    include: WISHLIST_INCLUDE,
  });
};

export const addWishlistItem = async (
  userId: string,
  productId: string,
  req?: any,
): Promise<any> => {
  const product = await prisma.product.findFirst({
    where: { id: D.str(productId), deletedAt: null },
    select: { id: true },
  });

  if (!product) throw AppError.notFound(ERROR.PRODUCT.NOT_FOUND);

  const wishlist = await getOrCreateWishlist(userId);

  const existing = await prisma.wishlistItem.findFirst({
    where: { wishlistId: wishlist.id, productId: product.id },
    select: { id: true },
  });

  if (existing) {
    throw AppError.conflict(ERROR.PRODUCT.ALREADY_IN_WISHLIST, ERROR_CODE.DUPLICATE);
  }

  const item = await prisma.wishlistItem.create({
    data: { wishlistId: wishlist.id, productId: product.id, userId },
    include: WISHLIST_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId,
    action: 'WISHLIST_ITEM_ADDED',
    entity: 'WishlistItem',
    entityId: item.id,
    meta: { productId: product.id },
  });

  return item;
};

export const removeWishlistItem = async (
  userId: string,
  reference: string,
  req?: any,
): Promise<void> => {
  const wishlist = await getOrCreateWishlist(userId);

  const item = await prisma.wishlistItem.findFirst({
    where: { wishlistId: wishlist.id, OR: [{ id: reference }, { productId: reference }] },
    select: { id: true },
  });

  if (!item) throw AppError.notFound(ERROR.PRODUCT.NOT_IN_WISHLIST);

  await prisma.wishlistItem.delete({ where: { id: item.id } });

  void writeActivityLog({
    req,
    userId,
    action: 'WISHLIST_ITEM_REMOVED',
    entity: 'WishlistItem',
    entityId: item.id,
  });
};

export const clearWishlist = async (
  userId: string,
  req?: any,
): Promise<{ removedCount: number }> => {
  const wishlist = await getOrCreateWishlist(userId);

  const { count } = await prisma.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id } });

  void writeActivityLog({
    req,
    userId,
    action: 'WISHLIST_CLEARED',
    entity: 'Wishlist',
    entityId: wishlist.id,
    meta: { removedCount: count },
  });

  return { removedCount: count };
};

export const moveWishlistItemToCart = async (
  userId: string,
  input: { productId?: string; variantId?: string; qty?: number },
  req?: any,
): Promise<{ item: any; totals: CartTotalsResult }> => {
  const wishlist = await getOrCreateWishlist(userId);
  const reference = D.str(input.productId);

  const item = await prisma.wishlistItem.findFirst({
    where: {
      wishlistId: wishlist.id,
      OR: [{ id: reference }, { productId: reference }],
    },
    select: { id: true, productId: true },
  });

  if (!item) throw AppError.notFound(ERROR.PRODUCT.NOT_IN_WISHLIST);

  const added = await addItem(
    userId,
    {
      productId: item.productId,
      variantId: D.str(input.variantId),
      qty: Math.max(1, D.num(input.qty)),
    },
    req,
  );

  await prisma.wishlistItem.delete({ where: { id: item.id } });

  void writeActivityLog({
    req,
    userId,
    action: 'WISHLIST_MOVED_TO_CART',
    entity: 'WishlistItem',
    entityId: item.id,
    meta: { productId: item.productId },
  });

  return added;
};
