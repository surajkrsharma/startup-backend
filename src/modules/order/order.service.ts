import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D, money } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import {
  ORDER_STATUS,
  canTransitionOrder,
  canTransitionSubOrder,
  TERMINAL_ORDER_STATUSES,
} from '../../constants/statuses';
import { PaymentMethod, PaymentStatus, type OrderStatus as OrderStatusType } from '@prisma/client';
import { calcCommission, calcTokenAmount } from '../../utils/calculations';
import { generateOrderNumber } from '../../utils/slug';
import {
  getOrderMaxItems,
  getOrderMinAmount,
  getOrderCancelWindowMin,
  getPaymentMethodsConfig,
  getGiftWrapConfig,
  getShippingConfig,
  getTokenPaymentConfig,
  getTokenPolicy,
  getWalletConfig,
} from '../../services/settings.service';
import { cacheDel, cacheSet, cacheGet } from '../../services/redis.service';
import { writeActivityLog } from '../../services/audit.service';
import { notifyUser } from '../../services/notification.service';
import { getOrCreateCart, calculateTotals, getWalletBalance } from '../cart/cart.service';
import { assertVendorAcceptingOrders } from '../vendor/vendor.service';
import { recordEarning, requestReturn, updateReturnStatus } from '../payment/payment.service';
import { addMinutes, daysBetween } from '../../utils/dates';
import { WARRANTY } from '../../config/password.config';
import { VENDOR_BULK_ACTION } from './order.schema';

export const ORDER_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  address: true,
  items: true,
  payments: { orderBy: { createdAt: 'desc' } },
  refunds: true,
  subOrders: {
    include: {
      vendor: { select: { id: true, shopName: true, slug: true } },
      items: true,
      shipments: { orderBy: { createdAt: 'desc' } },
      deliveries: { orderBy: { createdAt: 'desc' } },
    },
  },
  timelines: { orderBy: { createdAt: 'asc' } },
  tags: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const withRelations = (id: string): Promise<OrderRow> =>
  prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE }) as Promise<OrderRow>;

/**
 * Resolves an id-or-number reference to an order id without pulling the whole
 * relation tree, which tag writes would otherwise pay for on every call.
 */
const resolveOrderIdForActor = async (orderRef: string, userId?: string): Promise<string> => {
  const byId = await prisma.order.findFirst({
    where: { id: orderRef, deletedAt: null },
    select: { id: true, userId: true },
  });

  const order =
    byId ??
    (await prisma.order.findFirst({
      where: { orderNumber: D.str(orderRef), deletedAt: null },
      select: { id: true, userId: true },
    }));

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  if (userId && order.userId !== userId) {
    throw AppError.notFound(ERROR.ORDER.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  return order.id;
};

const pushTimeline = async (
  tx: Prisma.TransactionClient | typeof prisma,
  input: {
    orderId: string;
    subOrderId?: string;
    status: string;
    fromStatus?: string;
    remark?: string;
    location?: string;
    createdById?: string;
  },
): Promise<void> => {
  await tx.orderTimeline.create({
    data: {
      orderId: input.orderId,
      subOrderId: D.str(input.subOrderId),
      status: input.status as OrderStatusType,
      fromStatus: D.str(input.fromStatus),
      remark: D.str(input.remark),
      location: D.str(input.location),
      createdById: D.str(input.createdById) || null,
    },
  });
};

export interface PlaceOrderResult {
  order: OrderRow;

  skipped: { productId: string; name: string; reason: string }[];
}

export const placeOrder = async (
  userId: string,
  input: {
    addressId?: string;
    address?: Record<string, any>;
    paymentMethod: string;
    couponCode?: string;
    useWalletBalance?: boolean;
    walletAmount?: number;
    notes?: string;
    skipStatus?: boolean;

    skipUnavailable?: boolean;
  },
  req?: any,
): Promise<PlaceOrderResult> => {
  const cart = await getOrCreateCart(userId);
  const cartItems = D.arr(cart.items);

  if (!cartItems.length) {
    throw AppError.badRequest(ERROR.CART.EMPTY, ERROR_CODE.CART_EMPTY);
  }

  const [minAmount, maxItems] = await Promise.all([getOrderMinAmount(), getOrderMaxItems()]);
  const methods = await getPaymentMethodsConfig();

  const method = D.str(input.paymentMethod) || PaymentMethod.COD;
  if (!isMethodEnabled(method, methods)) {
    throw AppError.unprocessable(ERROR.PAYMENT.METHOD_DISABLED);
  }

  let addressId = D.str(input.addressId);

  if (!addressId && input.address) {
    const created = await prisma.address.create({
      data: { ...input.address, userId, type: 'HOME' },
    });
    addressId = created.id;
  }

  if (!addressId) throw AppError.badRequest(ERROR.ADDRESS.DEFAULT_REQUIRED);

  const address = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true, pincode: true, city: true, state: true, country: true },
  });

  if (!address) throw AppError.notFound(ERROR.ADDRESS.NOT_FOUND);

  const totals = await calculateTotals(cart, {
    couponCode: D.str(input.couponCode) || undefined,
    paymentMethod: method,
    useWallet: D.bool(input.useWalletBalance),
    walletAmount: D.num(input.walletAmount),
  });

  if (cartItems.length > maxItems) {
    throw AppError.unprocessable(`An order may contain at most ${maxItems} items.`);
  }

  const goodsValue = money(totals.subtotal - totals.couponDiscount + totals.taxAmount);
  if (goodsValue < minAmount) {
    throw AppError.unprocessable(
      `${ERROR.ORDER.MIN_AMOUNT} (minimum ${minAmount})`,
      ERROR_CODE.MIN_AMOUNT,
    );
  }

  const skipped: PlaceOrderResult['skipped'] = [];

  for (const line of totals.lines) {
    if (!line.isAvailable) {
      skipped.push({
        productId: D.str(line.item.productId),
        name: D.str(line.item.product?.name),
        reason: line.availableStock <= 0 ? 'out of stock' : `only ${line.availableStock} left`,
      });
    }
  }

  if (skipped.length && !D.bool(input.skipUnavailable)) {
    throw AppError.unprocessable(ERROR.ORDER.STOCK_CHANGED, ERROR_CODE.STOCK_CHANGED);
  }

  const usable = skipped.length ? totals.lines.filter((l) => l.isAvailable) : totals.lines;

  if (!usable.length) {
    throw AppError.unprocessable(ERROR.ORDER.STOCK_CHANGED, ERROR_CODE.STOCK_CHANGED);
  }

  const usableSubtotal = money(usable.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const usableTax = money(usable.reduce((sum, l) => sum + l.lineTax, 0));

  let couponDiscount = 0;
  if (totals.couponDiscount > 0) {
    couponDiscount = Math.min(totals.couponDiscount, usableSubtotal);
  }

  const shipping =
    D.bool(input.skipUnavailable) && skipped.length ? 0 : D.float(totals.shippingAmount);

  const giftWrapCount = usable.filter((l) => D.bool(l.item.isGiftWrap)).length;
  const giftWrapAmount = giftWrapCount
    ? money((await getGiftWrapConfig()).charge * giftWrapCount)
    : 0;

  const payable = money(
    Math.max(0, usableSubtotal - couponDiscount + usableTax + shipping + giftWrapAmount),
  );

  let walletAmount = 0;
  if (D.bool(input.useWalletBalance)) {
    const walletCfg = await getWalletConfig();
    if (!walletCfg.enabled) {
      throw AppError.unprocessable(ERROR.WALLET.NOT_ENABLED);
    }
    const balance = await getWalletBalance(userId);
    walletAmount = money(Math.min(D.num(input.walletAmount) || balance, payable, balance));
  }

  const total = money(Math.max(0, payable - walletAmount));

  const tokenCfg = await getTokenPaymentConfig();
  const tokenAmount = calcTokenAmount(total, tokenCfg);
  const tokenRequired = tokenAmount > 0 && tokenAmount < total;

  const byVendor = new Map<string, typeof usable>();
  for (const line of usable) {
    const vendorId = D.str(line.item.product?.vendorId);
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
    byVendor.get(vendorId)!.push(line);
  }

  const vendors = await prisma.vendorProfile.findMany({
    where: { id: { in: Array.from(byVendor.keys()) } },
    select: { id: true, userId: true, commissionRate: true, status: true, isOnVacation: true },
  });

  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  for (const vendorId of byVendor.keys()) {
    if (vendorMap.get(vendorId)?.status !== 'APPROVED') {
      throw AppError.forbidden(ERROR.PRODUCT.VENDOR_NOT_APPROVED, ERROR_CODE.VENDOR_NOT_APPROVED);
    }
  }

  await assertVendorAcceptingOrders(vendors.filter((v) => v.isOnVacation).map((v) => v.id));

  const vendorOwnerUserIds = vendors.map((v) => D.str(v.userId)).filter((id) => id !== '');

  const block = vendorOwnerUserIds.length
    ? await prisma.userBlock.findFirst({
        where: { blockedId: userId, blockerId: { in: vendorOwnerUserIds } },
        select: { blockerId: true },
      })
    : null;

  if (block) {
    throw AppError.forbidden(ERROR.CHAT.USER_BLOCKED, ERROR_CODE.USER_BLOCKED);
  }

  const orderNumber = generateOrderNumber();

  const result = await prisma.$transaction(
    async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNumber,
          userId,
          addressId,
          status: (tokenRequired
            ? ORDER_STATUS.PENDING_TOKEN
            : ORDER_STATUS.PENDING) as OrderStatusType,
          paymentMethod: method as PaymentMethod,
          paymentStatus: (tokenRequired
            ? PaymentStatus.PENDING
            : PaymentStatus.COD_PENDING) as PaymentStatus,
          subtotal: usableSubtotal,
          couponDiscount,
          taxAmount: usableTax,
          shippingAmount: shipping,
          giftWrapAmount,
          walletAmount,
          total,
          tokenRequired,
          tokenAmount,
          balanceAmount: money(total - walletAmount),
          balanceDueDays: tokenRequired ? (await getTokenPolicy()).balanceDueDays : 0,
          notes: D.str(input.notes),
        },
      });

      let apportionedShipping = shipping;
      let apportionedCoupon = couponDiscount;
      const vendorIds = Array.from(byVendor.keys());

      for (let i = 0; i < vendorIds.length; i += 1) {
        const vendorId = vendorIds[i];
        const lines = byVendor.get(vendorId)!;

        const isLast = i === vendorIds.length - 1;
        const share =
          usableSubtotal > 0
            ? money(
                usableSubtotal ? lines.reduce((s, l) => s + l.lineSubtotal, 0) / usableSubtotal : 0,
              )
            : 0;

        const vendorTax = money(lines.reduce((s, l) => s + l.lineTax, 0));
        const vendorShipping = isLast ? money(apportionedShipping) : money(shipping * share);
        const vendorCoupon = isLast ? money(apportionedCoupon) : money(couponDiscount * share);

        apportionedShipping = money(apportionedShipping - vendorShipping);
        apportionedCoupon = money(apportionedCoupon - vendorCoupon);

        const vendorSubtotal = money(lines.reduce((s, l) => s + l.lineSubtotal, 0));
        const commissionRate = D.float(vendorMap.get(vendorId)?.commissionRate);

        const split = calcCommission({ subtotal: vendorSubtotal, commissionRate });

        const subOrder = await tx.subOrder.create({
          data: {
            orderId: created.id,
            vendorId,
            status: (tokenRequired
              ? ORDER_STATUS.PENDING_TOKEN
              : ORDER_STATUS.PENDING) as OrderStatusType,
            subtotal: vendorSubtotal,
            taxAmount: vendorTax,
            shippingAmount: vendorShipping,
            total: money(vendorSubtotal - vendorCoupon + vendorTax + vendorShipping),
            commissionRate,
            commission: split.commission,
            platformFee: split.platformFee,
            vendorEarning: split.vendorEarning,
          },
        });

        for (const line of lines) {
          const item = line.item;

          await tx.orderItem.create({
            data: {
              orderId: created.id,
              subOrderId: subOrder.id,
              productId: D.str(item.productId),
              variantId: D.str(item.variantId) || null,
              name: D.str(item.product?.name),
              sku: D.str(item.variant?.sku ?? item.product?.sku),
              image: D.str((D.arr(item.product?.images)[0] as any)?.url),
              attributes: (item.variant?.attributes ?? {}) as Prisma.InputJsonValue,
              price: line.unitPrice,
              qty: D.num(item.qty),
              taxPercent: line.taxPercent,
              taxAmount: line.lineTax,
              total: line.lineSubtotal,
              commission: split.commission,
              vendorEarning: split.vendorEarning,
              isGiftWrap: D.bool(item.isGiftWrap),
              giftWrapNote: D.str(item.giftWrapNote),
              deliveryNote: D.str(item.deliveryNote),
            },
          });

          if (item.variantId) {
            await tx.productVariant.update({
              where: { id: D.str(item.variantId) },
              data: { stock: { decrement: D.num(item.qty) } },
            });
          } else {
            await tx.product.update({
              where: { id: D.str(item.productId) },
              data: {
                stock: { decrement: D.num(item.qty) },
                soldCount: { increment: D.num(item.qty) },
              },
            });
          }

          const remaining = line.availableStock - D.num(item.qty);
          if (remaining <= 0 && !D.bool(item.product?.allowBackorder)) {
            if (item.variantId) {
              await tx.productVariant.update({
                where: { id: D.str(item.variantId) },
                data: { isActive: false },
              });
            } else {
              await tx.product.update({
                where: { id: D.str(item.productId) },
                data: { status: 'DRAFT' },
              });
            }
          }
        }
      }

      await tx.payment.create({
        data: {
          orderId: created.id,
          userId,
          amount: total,
          paidAmount: walletAmount,
          method: method as PaymentMethod,
          status:
            walletAmount >= total
              ? PaymentStatus.PAID
              : tokenRequired
                ? PaymentStatus.PENDING
                : PaymentStatus.COD_PENDING,
          isBalancePayment: walletAmount > 0,
          paidAt: walletAmount >= total ? new Date() : null,
        },
      });

      if (totals.couponCode && totals.coupon) {
        await tx.couponUsage.create({
          data: {
            couponId: totals.coupon.id,
            userId,
            orderId: created.id,
            amount: couponDiscount,
          },
        });

        await tx.coupon.update({
          where: { id: totals.coupon.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      if (walletAmount > 0) {
        await tx.walletTransaction.create({
          data: {
            userId,
            type: 'REDEEM',
            amount: walletAmount,
            balanceAfter: money((await getWalletBalance(userId)) - walletAmount),
            orderId: created.id,
            description: `Order ${orderNumber}`,
            reference: orderNumber,
          },
        });
      }

      await pushTimeline(tx, {
        orderId: created.id,
        status: created.status,
        remark: 'Order placed',
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: '' } });

      if (D.bool(input.skipStatus)) {
        const nextStatus = tokenRequired ? ORDER_STATUS.PENDING_TOKEN : ORDER_STATUS.CONFIRMED;

        await tx.order.update({ where: { id: created.id }, data: { status: nextStatus } });
        await tx.subOrder.updateMany({
          where: { orderId: created.id },
          data: { status: nextStatus },
        });
      }

      return created;
    },
    { timeout: 20_000, maxWait: 8_000 },
  );

  await cacheDel(`cart:${userId}`);
  await cacheSet(`order:${result.id}`, '1', 300);

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_PLACED',
    entity: 'Order',
    entityId: result.id,
    meta: { orderNumber, total, vendors: Array.from(byVendor.keys()) },
  });

  void notifyUser({
    userId,
    type: 'ORDER',
    title: `Order ${orderNumber} placed`,
    body: `We received your order of ${total}.`,
    data: { orderId: result.id, orderNumber },
  });

  return { order: await withRelations(result.id), skipped };
};

const isMethodEnabled = (method: string, methods: any): boolean => {
  if (method === PaymentMethod.COD) return methods.cod.enabled;
  if (method === PaymentMethod.UPI) return methods.upi.enabled;
  if (method === PaymentMethod.BANK) return methods.bank.enabled;

  return method === PaymentMethod.CARD || method === PaymentMethod.NETBANKING;
};

export const listOrders = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: OrderRow[]; total: number }> => {
  const where: Prisma.OrderWhereInput = { userId, deletedAt: null };

  if (D.str(query.status)) where.status = query.status as OrderStatusType;
  if (D.str(query.paymentStatus)) where.paymentStatus = query.paymentStatus as PaymentStatus;
  if (D.str(query.paymentMethod)) where.paymentMethod = query.paymentMethod as PaymentMethod;
  if (D.str(query.vendorId)) {
    where.subOrders = { some: { vendorId: D.str(query.vendorId) } };
  }

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  if (D.str(query.search)) {
    const term = D.str(query.search);
    where.OR = [
      { orderNumber: { contains: term, mode: 'insensitive' } },
      { items: { some: { name: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: resolveSort(query.sort, 'createdAt'),
      skip: D.num(query.skip),
      take: D.num(query.take),
    }) as Promise<OrderRow[]>,
    prisma.order.count({ where }),
  ]);

  return { rows, total };
};

const resolveSort = (sort: string, fallback: string): Prisma.OrderOrderByWithRelationInput => {
  const raw = D.str(sort);
  if (!raw) return { createdAt: 'desc' };

  const desc = raw.startsWith('-');
  const field = desc ? raw.slice(1) : raw;

  if (!['createdAt', 'total', 'status', 'paymentStatus'].includes(field)) {
    return { [fallback]: 'desc' };
  }

  return { [field]: desc ? 'desc' : 'asc' } as Prisma.OrderOrderByWithRelationInput;
};

export const listVendorOrders = async (
  vendorId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.SubOrderWhereInput = { vendorId };

  if (D.str(query.status)) where.status = query.status as OrderStatusType;

  if (D.str(query.from) || D.str(query.to)) {
    where.createdAt = {
      ...(D.str(query.from) ? { gte: new Date(D.str(query.from)) } : {}),
      ...(D.str(query.to) ? { lte: new Date(D.str(query.to)) } : {}),
    };
  }

  const orderBy: Prisma.SubOrderOrderByWithRelationInput =
    D.str(query.sort) === 'total' ? { total: 'desc' } : { createdAt: 'desc' };

  const [rows, total] = await Promise.all([
    prisma.subOrder.findMany({
      where,
      orderBy,
      skip: D.num(query.skip),
      take: D.num(query.take),
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            createdAt: true,
            user: { select: { id: true, name: true, phone: true } },
            address: true,
          },
        },
        items: true,
        shipments: { orderBy: { createdAt: 'desc' } },
      },
    }),
    prisma.subOrder.count({ where }),
  ]);

  return { rows, total };
};

export const getOrderById = async (orderRef: string, userId?: string): Promise<OrderRow> => {
  const byId = await withRelations(orderRef);

  const order =
    byId && !byId.deletedAt
      ? byId
      : await prisma.order.findUnique({
          where: { orderNumber: D.str(orderRef) },
          include: ORDER_INCLUDE,
        });

  if (!order || order.deletedAt) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  if (userId && order.userId !== userId) {
    throw AppError.notFound(ERROR.ORDER.NOT_FOUND);
  }

  return order;
};

export const getOrderByNumber = async (orderNumber: string, userId?: string): Promise<OrderRow> => {
  const order = (await prisma.order.findUnique({
    where: { orderNumber },
    include: ORDER_INCLUDE,
  })) as OrderRow;

  if (!order || order.deletedAt) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);
  if (userId && order.userId !== userId) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  return order;
};

export const getTimeline = async (orderId: string): Promise<any[]> =>
  prisma.orderTimeline.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

export const trackOrder = async (orderNumber: string): Promise<any> => {
  const order = await prisma.order.findFirst({
    where: { orderNumber, deletedAt: null },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      total: true,
      createdAt: true,
      deliveredAt: true,
      address: { select: { city: true, state: true, pincode: true } },
      subOrders: {
        select: {
          id: true,
          status: true,
          trackingNumber: true,
          vendor: { select: { shopName: true } },
          shipments: {
            select: { awb: true, trackingUrl: true, status: true, estimatedDays: true },
          },
        },
      },
      timelines: {
        orderBy: { createdAt: 'asc' },
        select: { status: true, remark: true, location: true, createdAt: true },
      },
    },
  });

  if (!order) throw AppError.notFound(ERROR.ORDER.NOT_FOUND);

  return order;
};

export const updateOrderStatus = async (
  orderId: string,
  input: { status: string; remark?: string; location?: string },
  actorId?: string,
  req?: any,
): Promise<OrderRow> => {
  const order = await getOrderById(orderId);

  if (!canTransitionOrder(order.status, D.str(input.status))) {
    throw AppError.unprocessable(
      `${ERROR.ORDER.INVALID_STATUS_TRANSITION} (${order.status} -> ${input.status})`,
      ERROR_CODE.INVALID_STATUS_TRANSITION,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: input.status as OrderStatusType,
        ...(input.status === ORDER_STATUS.DELIVERED ? { deliveredAt: new Date() } : {}),
        ...(input.status === ORDER_STATUS.CANCELLED
          ? { isCancelled: true, cancelledAt: new Date() }
          : {}),
      },
    });

    await tx.subOrder.updateMany({
      where: { orderId, status: { notIn: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED] } },
      data: { status: input.status as OrderStatusType },
    });

    if (input.status === ORDER_STATUS.DELIVERED && order.paymentMethod === PaymentMethod.COD) {
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.COD_PENDING },
        data: {
          status: PaymentStatus.COD_COLLECTED,
          paidAmount: { increment: order.total - order.walletAmount },
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: PaymentStatus.PAID, balancePaid: true },
      });
    }

    await pushTimeline(tx, {
      orderId,
      status: input.status,
      fromStatus: order.status,
      remark: input.remark,
      location: input.location,
      createdById: actorId,
    });

    if (input.status === ORDER_STATUS.CANCELLED) {
      await restoreStock(tx, orderId);
    }
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'ORDER_STATUS_UPDATED',
    entity: 'Order',
    entityId: orderId,
    meta: { from: order.status, to: input.status },
  });

  if (D.str(input.status) === ORDER_STATUS.DELIVERED) {
    void notifyUser({
      userId: order.userId,
      type: 'ORDER',
      title: `Order ${order.orderNumber} delivered`,
      body: 'Your order has been delivered.',
      data: { orderId },
    });
  }

  if (D.str(input.status) === ORDER_STATUS.DELIVERED) {
    await bookVendorEarnings(orderId);
  }

  return withRelations(orderId);
};

const bookVendorEarnings = async (orderId: string): Promise<void> => {
  const subs = await prisma.subOrder.findMany({
    where: { orderId, status: ORDER_STATUS.DELIVERED },
    select: { id: true, vendorId: true, subtotal: true, commission: true, platformFee: true },
  });

  for (const sub of subs) {
    const existing = await prisma.vendorEarning.findFirst({
      where: { subOrderId: sub.id },
      select: { id: true },
    });

    if (existing) continue;

    await recordEarning(sub.vendorId, sub.id, orderId, {
      amount: D.float(sub.subtotal),
      commission: D.float(sub.commission),
      platformFee: D.float(sub.platformFee),
    });

    await prisma.vendorProfile.update({
      where: { id: sub.vendorId },
      data: {
        totalSales: { increment: D.float(sub.subtotal) },
        pendingAmount: { increment: D.float(sub.subtotal) },
      },
    });
  }
};

export const updateSubOrderStatus = async (
  subOrderId: string,
  vendorId: string,
  input: { status: string; remark?: string },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const sub = await prisma.subOrder.findFirst({
    where: { id: subOrderId, vendorId },
    include: { order: { select: { id: true, orderNumber: true } } },
  });

  if (!sub) throw AppError.notFound(ERROR.ORDER.SUB_ORDER_NOT_FOUND);

  if (!canTransitionSubOrder(sub.status, D.str(input.status))) {
    throw AppError.unprocessable(
      `${ERROR.ORDER.INVALID_STATUS_TRANSITION} (${sub.status} -> ${input.status})`,
      ERROR_CODE.INVALID_STATUS_TRANSITION,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.subOrder.update({
      where: { id: subOrderId },
      data: { status: input.status as OrderStatusType },
    });

    await pushTimeline(tx, {
      orderId: sub.orderId,
      subOrderId,
      status: input.status,
      fromStatus: sub.status,
      remark: input.remark,
      createdById: actorId,
    });

    if (input.status === ORDER_STATUS.CANCELLED) {
      await restoreStock(tx, sub.orderId, subOrderId);
    }
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'SUB_ORDER_STATUS_UPDATED',
    entity: 'SubOrder',
    entityId: subOrderId,
    meta: { from: sub.status, to: input.status },
  });

  return prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: { items: true, vendor: true },
  });
};

const BULK_STATUS_BY_ACTION: Record<string, string> = {
  [VENDOR_BULK_ACTION.ACCEPT]: ORDER_STATUS.CONFIRMED,
  [VENDOR_BULK_ACTION.REJECT]: ORDER_STATUS.CANCELLED,
};

/**
 * `updated` and `skipped` together account for every id the caller asked for.
 */
export interface BulkSubOrderStatusResult {
  action: string;
  requested: number;
  updated: any[];
  skipped: { subOrderId: string; reason: string }[];
}

/**
 * Moves many of a vendor's own sub-orders in one call and reports every id that
 * could not move, because a triage pass must not lose the rows that did.
 */
export const bulkUpdateSubOrderStatus = async (
  vendorId: string,
  input: { subOrderIds: string[]; action: string; reason?: string; remark?: string },
  actorId?: string,
  req?: any,
): Promise<BulkSubOrderStatusResult> => {
  const action = D.str(input.action);
  const target = D.str(BULK_STATUS_BY_ACTION[action]);
  const isReject = action === VENDOR_BULK_ACTION.REJECT;

  const ids = Array.from(new Set(D.arr(input.subOrderIds).map((id: string) => D.str(id)))).filter(
    (id) => id !== '',
  );

  const rows = await prisma.subOrder.findMany({
    where: { id: { in: ids }, vendorId },
    select: { id: true, orderId: true, status: true },
  });

  const owned = new Map(rows.map((r) => [r.id, r]));

  const applicable = ids.filter(
    (id) => owned.has(id) && canTransitionSubOrder(D.str(owned.get(id)?.status), target),
  );

  if (!applicable.length) {
    throw AppError.unprocessable(
      ERROR.ORDER.BULK_NO_SUB_ORDERS,
      ERROR_CODE.INVALID_STATUS_TRANSITION,
    );
  }

  const moved = new Set(applicable);

  const skipped = ids
    .filter((id) => !moved.has(id))
    .map((id) => ({
      subOrderId: id,
      reason: owned.has(id)
        ? ERROR.ORDER.INVALID_STATUS_TRANSITION
        : ERROR.ORDER.SUB_ORDER_NOT_FOUND,
    }));

  const updated = await prisma.$transaction(
    async (tx) => {
      for (const id of applicable) {
        const sub = owned.get(id)!;

        await tx.subOrder.update({
          where: { id },
          data: {
            status: target as OrderStatusType,
            ...(isReject ? { cancelReason: D.str(input.reason) } : {}),
          },
        });

        await pushTimeline(tx, {
          orderId: sub.orderId,
          subOrderId: id,
          status: target,
          fromStatus: sub.status,
          remark: D.str(input.reason) || D.str(input.remark),
          createdById: actorId,
        });

        if (isReject) {
          await restoreStock(tx, sub.orderId, id);
        }
      }

      const parents = Array.from(new Set(applicable.map((id) => owned.get(id)!.orderId)));

      for (const parentOrderId of parents) {
        await refreshParentStatus(tx, parentOrderId);
      }

      return tx.subOrder.findMany({
        where: { id: { in: applicable } },
        include: {
          items: true,
          vendor: true,
          shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
    },
    { timeout: 20_000, maxWait: 8_000 },
  );

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'SUB_ORDER_STATUS_UPDATED',
    entity: 'SubOrder',
    entityId: applicable.join(','),
    meta: { action, to: target, subOrderIds: applicable, skippedCount: skipped.length },
  });

  return { action, requested: ids.length, updated, skipped };
};

const restoreStock = async (
  tx: Prisma.TransactionClient,
  orderId: string,
  subOrderId?: string,
): Promise<void> => {
  const items = await tx.orderItem.findMany({
    where: { orderId, ...(subOrderId ? { subOrderId } : {}) },
  });

  for (const item of items) {
    if (item.variantId) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
    } else {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stock: { increment: item.qty },
          soldCount: { decrement: item.qty },
          status: 'ACTIVE',
        },
      });
    }
  }
};

export const cancelOrder = async (
  orderId: string,
  userId: string,
  input: { reason: string; subOrderId?: string },
  req?: any,
): Promise<OrderRow> => {
  const order = await getOrderById(orderId, userId);

  if (order.isCancelled || order.status === ORDER_STATUS.CANCELLED) {
    throw AppError.unprocessable(ERROR.ORDER.ALREADY_CANCELLED);
  }

  if (order.status === ORDER_STATUS.DELIVERED) {
    throw AppError.unprocessable(ERROR.ORDER.ALREADY_DELIVERED);
  }

  const windowMin = await getOrderCancelWindowMin();
  const ageMin = (Date.now() - new Date(order.createdAt).getTime()) / 60_000;

  if (ageMin > windowMin) {
    throw AppError.unprocessable(
      `${ERROR.ORDER.CANCEL_WINDOW_PASSED} (${windowMin} minutes)`,
      ERROR_CODE.CANCEL_WINDOW_PASSED,
    );
  }

  if (D.str(input.subOrderId)) {
    const sub = await prisma.subOrder.findFirst({
      where: { id: D.str(input.subOrderId), orderId },
      select: { id: true, vendorId: true, status: true },
    });

    if (!sub) throw AppError.notFound(ERROR.ORDER.SUB_ORDER_NOT_FOUND);

    if (!canTransitionSubOrder(sub.status, ORDER_STATUS.CANCELLED)) {
      throw AppError.unprocessable(
        ERROR.ORDER.INVALID_STATUS_TRANSITION,
        ERROR_CODE.INVALID_STATUS_TRANSITION,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.subOrder.update({
        where: { id: sub.id },
        data: { status: ORDER_STATUS.CANCELLED as OrderStatusType, cancelReason: input.reason },
      });
      await restoreStock(tx, orderId, sub.id);
      await pushTimeline(tx, {
        orderId,
        subOrderId: sub.id,
        status: ORDER_STATUS.CANCELLED,
        remark: input.reason,
      });
      await refreshParentStatus(tx, orderId);
    });

    return withRelations(orderId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: ORDER_STATUS.CANCELLED as OrderStatusType,
        isCancelled: true,
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
    });

    await tx.subOrder.updateMany({
      where: { orderId, status: { not: ORDER_STATUS.CANCELLED } },
      data: { status: ORDER_STATUS.CANCELLED as OrderStatusType, cancelReason: input.reason },
    });

    await restoreStock(tx, orderId);

    if (order.walletAmount > 0) {
      await tx.walletTransaction.create({
        data: {
          userId: order.userId,
          type: 'REFUND',
          amount: order.walletAmount,
          balanceAfter: 0,
          orderId,
          description: `Refund for cancelled order ${order.orderNumber}`,
          reference: order.orderNumber,
        },
      });
    }

    await pushTimeline(tx, {
      orderId,
      status: ORDER_STATUS.CANCELLED,
      remark: input.reason,
    });
  });

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_CANCELLED',
    entity: 'Order',
    entityId: orderId,
    meta: { reason: input.reason },
  });

  void notifyUser({
    userId: order.userId,
    type: 'ORDER',
    title: `Order ${order.orderNumber} cancelled`,
    body: input.reason,
    data: { orderId },
  });

  return withRelations(orderId);
};

const refreshParentStatus = async (
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> => {
  const subs = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });

  if (!subs.length) return;

  const statuses = subs.map((s) => D.str(s.status));
  const allCancelled = statuses.every((s) => s === ORDER_STATUS.CANCELLED);

  if (allCancelled) {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: ORDER_STATUS.CANCELLED as OrderStatusType,
        isCancelled: true,
        cancelledAt: new Date(),
      },
    });
    return;
  }

  const rank: string[] = [
    ORDER_STATUS.PENDING,
    ORDER_STATUS.PENDING_TOKEN,
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.SHIPPED,
    ORDER_STATUS.OUT_FOR_DELIVERY,
    ORDER_STATUS.DELIVERED,
  ];

  const live = statuses.filter((s) => !(TERMINAL_ORDER_STATUSES as string[]).includes(s));
  const best = live.sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0];

  if (best) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: best as OrderStatusType },
    });
  }
};

export const assignDeliveryBoy = async (
  subOrderId: string,
  deliveryBoyId: string,
  actorId?: string,
  req?: any,
): Promise<any> => {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    select: { id: true, orderId: true, status: true, vendorId: true },
  });

  if (!sub) throw AppError.notFound(ERROR.ORDER.SUB_ORDER_NOT_FOUND);

  const boy = await prisma.deliveryBoy.findFirst({
    where: { id: deliveryBoyId, isActive: true },
    select: { id: true },
  });

  if (!boy) throw AppError.notFound(ERROR.DELIVERY_BOY.NOT_FOUND);

  const sub2 = await prisma.subOrder.update({
    where: { id: subOrderId },
    data: { deliveryBoyId },
    include: { vendor: true, order: { select: { orderNumber: true } } },
  });

  await prisma.deliveryBoy.update({
    where: { id: deliveryBoyId },
    data: { currentLoad: { increment: 1 } },
  });

  await pushTimeline(prisma, {
    orderId: sub.orderId,
    subOrderId,
    status: sub.status,
    remark: 'Delivery boy assigned',
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'DELIVERY_BOY_ASSIGNED',
    entity: 'SubOrder',
    entityId: subOrderId,
    meta: { deliveryBoyId },
  });

  void sub2;
  return sub2;
};

export const confirmDelivery = async (
  subOrderId: string,
  input: { otp?: string; remarks?: string; collectedAmount?: number },
  actorId?: string,
  req?: any,
): Promise<any> => {
  const sub = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    include: {
      order: true,
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!sub) throw AppError.notFound(ERROR.ORDER.SUB_ORDER_NOT_FOUND);
  if (sub.status === ORDER_STATUS.DELIVERED) {
    throw AppError.unprocessable(ERROR.DELIVERY_BOY.ALREADY_DELIVERED);
  }

  if (!canTransitionSubOrder(sub.status, ORDER_STATUS.DELIVERED)) {
    throw AppError.unprocessable(
      ERROR.ORDER.INVALID_STATUS_TRANSITION,
      ERROR_CODE.INVALID_STATUS_TRANSITION,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.subOrder.update({
      where: { id: subOrderId },
      data: { status: ORDER_STATUS.DELIVERED as OrderStatusType },
    });

    const shipment = D.arr(sub.shipments)[0];

    let shipmentId = D.str(shipment?.id);

    if (!shipmentId) {
      const created = await tx.shipment.create({
        data: {
          subOrderId,
          orderId: sub.orderId,
          status: 'DELIVERED',
          deliveredAt: new Date(),
          remarks: D.str(input.remarks),
        },
      });
      shipmentId = created.id;
    } else {
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
    }

    await tx.delivery.create({
      data: {
        shipmentId,
        subOrderId,
        deliveryBoyId: D.str(sub.deliveryBoyId),
        status: 'DELIVERED',
        remarks: D.str(input.remarks),
        deliveredAt: new Date(),
      },
    });

    if (sub.deliveryBoyId) {
      await tx.deliveryBoy.update({
        where: { id: sub.deliveryBoyId },
        data: { currentLoad: { decrement: 1 }, totalDelivered: { increment: 1 } },
      });
    }

    if (sub.order.paymentMethod === PaymentMethod.COD) {
      const collected =
        D.num(input.collectedAmount) || money(sub.order.total - sub.order.walletAmount);

      await tx.payment.updateMany({
        where: { orderId: sub.orderId, status: PaymentStatus.COD_PENDING },
        data: {
          status: PaymentStatus.COD_COLLECTED,
          paidAmount: { increment: collected },
          collectedBy: D.str(actorId),
          paidAt: new Date(),
        },
      });

      await tx.order.update({
        where: { id: sub.orderId },
        data: { paymentStatus: PaymentStatus.PAID, balancePaid: true },
      });
    }

    await pushTimeline(tx, {
      orderId: sub.orderId,
      subOrderId,
      status: ORDER_STATUS.DELIVERED,
      fromStatus: sub.status,
      remark: input.remarks,
    });

    await refreshParentStatus(tx, sub.orderId);

    return tx.subOrder.findUnique({
      where: { id: subOrderId },
      include: { vendor: true, items: true },
    });
  });

  void writeActivityLog({
    req,
    userId: actorId,
    action: 'DELIVERY_CONFIRMED',
    entity: 'SubOrder',
    entityId: subOrderId,
  });

  void notifyUser({
    userId: sub.order.userId,
    type: 'ORDER',
    title: `Order ${sub.order.orderNumber} delivered`,
    body: 'Your order has been delivered.',
    data: { orderId: sub.orderId },
  });

  return updated;
};

export const reorder = async (
  userId: string,
  input: { orderId: string; skipUnavailable?: boolean },
  req?: any,
): Promise<{ added: number; skipped: any[] }> => {
  const order = await getOrderById(D.str(input.orderId), userId);

  let added = 0;
  const skipped: any[] = [];

  for (const item of D.arr(order.items) as any[]) {
    try {
      const { addItem } = await import('../cart/cart.service');
      await addItem(
        userId,
        {
          productId: D.str(item.productId),
          variantId: D.str(item.variantId),
          qty: D.num(item.qty),
        },
        req,
      );
      added += 1;
    } catch (err: any) {
      skipped.push({
        productId: D.str(item.productId),
        name: D.str(item.name),
        reason: D.str(err?.message),
      });
    }
  }

  void writeActivityLog({
    req,
    userId,
    action: 'REORDER',
    entity: 'Order',
    entityId: order.id,
    meta: { added, skipped: skipped.length },
  });

  return { added, skipped };
};

export const getOrderSummary = async (orderId: string): Promise<string | null> => {
  const cached = await cacheGet(`order:${orderId}`);
  return cached ? '1' : null;
};

export const getSubOrderForVendor = async (subOrderId: string, vendorId: string): Promise<any> => {
  const sub = await prisma.subOrder.findFirst({
    where: { id: subOrderId, vendorId },
    include: {
      vendor: { select: { id: true, shopName: true, slug: true, gstNumber: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true, images: true } } },
      },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      order: {
        include: {
          address: true,
          user: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
    },
  });

  if (!sub) throw AppError.notFound(ERROR.ORDER.SUB_ORDER_NOT_FOUND);

  return sub;
};

export const listOrderTags = async (orderRef: string, userId?: string): Promise<any[]> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);
  return prisma.orderTag.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
  });
};

export const addOrderTags = async (
  orderRef: string,
  input: { labels: string[]; color?: string },
  userId?: string,
  req?: any,
): Promise<any[]> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);
  const labels = D.arr(input.labels)
    .map((label: any) => D.str(label).trim().toUpperCase())
    .filter((label: string) => label !== '');

  if (!labels.length) {
    throw AppError.badRequest(ERROR.ORDER.TAG_REQUIRED, ERROR_CODE.VALIDATION_ERROR);
  }

  const total = (await prisma.orderTag.count({ where: { orderId } })) + labels.length;

  if (total > WARRANTY.MAX_TAGS_PER_ORDER) {
    throw AppError.unprocessable(ERROR.ORDER.TAG_LIMIT, ERROR_CODE.VALIDATION_ERROR);
  }

  const created = await prisma.$transaction(
    labels.map((label: string) =>
      prisma.orderTag.upsert({
        where: { orderId_label: { orderId, label } },
        create: {
          orderId,
          label,
          color: D.str(input.color),
          createdBy: D.str(req?.auth?.userId),
        },
        update: { color: D.str(input.color) || undefined },
      }),
    ),
  );

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_TAGGED',
    entity: 'Order',
    entityId: orderId,
    meta: { labels },
  });

  return created;
};

export const removeOrderTag = async (
  orderRef: string,
  tagId: string,
  userId?: string,
  req?: any,
): Promise<boolean> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);

  const tag = await prisma.orderTag.findFirst({ where: { id: tagId, orderId } });
  if (!tag) throw AppError.notFound(ERROR.ORDER.TAG_NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.orderTag.delete({ where: { id: tag.id } });

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_TAG_REMOVED',
    entity: 'Order',
    entityId: orderId,
    meta: { label: tag.label },
  });

  return true;
};

export const addOrderNote = async (
  orderRef: string,
  userId: string,
  input: { note: string },
  req?: any,
): Promise<any> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);

  const note = await prisma.orderNote.create({
    data: {
      orderId,
      userId,
      note: D.str(input.note),
    },
    select: {
      id: true,
      orderId: true,
      userId: true,
      note: true,
      createdAt: true,
    },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_NOTE_ADDED',
    entity: 'Order',
    entityId: orderId,
    meta: { noteId: note.id },
  });

  return note;
};

export const listOrderNotes = async (orderRef: string, userId: string): Promise<any[]> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);

  return prisma.orderNote.findMany({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      orderId: true,
      userId: true,
      note: true,
      createdAt: true,
    },
  });
};

export const deleteOrderNote = async (
  orderRef: string,
  noteId: string,
  userId: string,
  req?: any,
): Promise<boolean> => {
  const orderId = await resolveOrderIdForActor(orderRef, userId);

  const note = await prisma.orderNote.findFirst({ where: { id: noteId, orderId } });
  if (!note) throw AppError.notFound(ERROR.ORDER.NOTE_NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.orderNote.delete({ where: { id: noteId } });

  void writeActivityLog({
    req,
    userId,
    action: 'ORDER_NOTE_DELETED',
    entity: 'Order',
    entityId: orderId,
    meta: { noteId },
  });

  return true;
};

export const requestReturnForOrder = async (
  userId: string,
  input: {
    orderId: string;
    subOrderId?: string;
    reasonId?: string;
    reasonText?: string;
    comment?: string;
    images?: string[];
    items: { orderItemId: string; qty: number }[];
  },
  req?: any,
): Promise<any> => requestReturn(userId, input, req);

export const decideReturnForOrder = async (
  returnId: string,
  status: string,
  actorId?: string,
  vendorId?: string,
  req?: any,
): Promise<any> =>
  updateReturnStatus(returnId, { ...(req?.body ?? {}), status }, actorId, vendorId, req);

export { daysBetween, addMinutes, getShippingConfig };
