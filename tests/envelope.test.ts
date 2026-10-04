import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { ZodError } from 'zod';
import { D, money, round, clamp } from '../src/utils/defaults';
import { ApiResponse } from '../src/utils/ApiResponse';
import { AppError } from '../src/utils/AppError';
import { getPagination, getSort } from '../src/utils/pagination';
import { zodIssueToMessage, VALIDATION } from '../src/messages/validation';
import { ERROR } from '../src/messages/error';
import {
  calcTokenAmount,
  calcCommission,
  calcCartTotals,
  calcCouponDiscount,
  calcShippingCharge,
} from '../src/utils/calculations';
import {
  canTransitionOrder,
  canTransitionReturn,
  canTransitionTicket,
  ORDER_STATUS,
} from '../src/constants/statuses';
import { toSlug, generateOrderNumber } from '../src/utils/slug';
import { isEmailLooking, normalisePhone } from '../src/utils/validate';

describe('D defaults (no-null contract)', () => {
  it('substitutes type-appropriate defaults for null and undefined', () => {
    expect(D.str(null)).toBe('');
    expect(D.str(undefined)).toBe('');
    expect(D.num(null)).toBe(0);
    expect(D.num(undefined)).toBe(0);
    expect(D.float(null)).toBe(0.0);
    expect(D.bool(null)).toBe(false);
    expect(D.arr(null)).toEqual([]);
    expect(D.obj(null)).toEqual({});
    expect(D.date(null)).toBe('');
  });

  it('coerces string inputs', () => {
    expect(D.num('42')).toBe(42);
    expect(D.num('abc')).toBe(0);
    expect(D.float('45.67')).toBe(45.67);
    expect(D.bool('true')).toBe(true);
    expect(D.bool('false')).toBe(false);
    expect(D.bool('1')).toBe(true);
  });

  it('preserves falsy-but-present values', () => {
    expect(D.num(0)).toBe(0);
    expect(D.float(0)).toBe(0);
    expect(D.str('')).toBe('');
    expect(D.bool(false)).toBe(false);
  });

  it('returns ISO strings or empty for invalid dates', () => {
    expect(D.date('2025-01-15T10:30:00.000Z')).toBe('2025-01-15T10:30:00.000Z');
    expect(D.date('not-a-date')).toBe('');
    expect(D.date(undefined)).toBe('');
  });

  it('rounds money without float drift', () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(79.999999)).toBe(80);
    expect(round(1.005, 2)).toBe(1.01);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe('ApiResponse envelope', () => {
  const capture = () => {
    let payload: any = null;
    let statusCode = 200;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(body: any) {
        payload = body;
        return res;
      },
    };
    return { res, get: () => payload, getStatus: () => statusCode };
  };

  it('emits exactly three top-level keys in order for success', () => {
    const { res, get } = capture();
    ApiResponse.success(res, {
      message: 'Product created successfully.',
      result: { productId: 'p1' },
    });

    const body = get();
    expect(Object.keys(body)).toEqual(['status', 'message', 'result']);
    expect(body.status).toBe(true);
    expect(body.result).toEqual({ productId: 'p1' });
  });

  it('never emits a null result', () => {
    const { res, get } = capture();
    ApiResponse.success(res, { message: 'Deleted successfully.', result: undefined });
    expect(get().result).toEqual({});
  });

  it('puts pagination numbers first, in the required order', () => {
    const { res, get } = capture();
    ApiResponse.paginated(res, {
      message: 'Products fetched successfully.',
      totalRecord: 145,
      currentPage: 3,
      limit: 2,
      result: { filterData: { search: 'shirt' }, productList: [{ productId: 'p1' }] },
    });

    const result = get().result;
    expect(Object.keys(result)).toEqual([
      'totalRecord',
      'totalPage',
      'currentPage',
      'limit',
      'hasNext',
      'hasPrevious',
      'nextPage',
      'previousPage',
      'filterData',
      'productList',
    ]);
    expect(result.totalRecord).toBe(145);
    expect(result.totalPage).toBe(73);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(true);
    expect(result.nextPage).toBe(4);
    expect(result.previousPage).toBe(2);
  });

  it('omits pagination when hasNext is false by reporting nextPage 0', () => {
    const { res, get } = capture();
    ApiResponse.paginated(res, {
      message: 'Categories retrieved successfully.',
      totalRecord: 5,
      currentPage: 1,
      limit: 20,
      result: { categoryList: [] },
    });

    const result = get().result;
    expect(result.hasNext).toBe(false);
    expect(result.hasPrevious).toBe(false);
    expect(result.nextPage).toBe(0);
    expect(result.previousPage).toBe(0);
  });

  it('appends the error code to the message and keeps result empty', () => {
    const { res, get, getStatus } = capture();
    ApiResponse.error(res, {
      statusCode: 404,
      message: ERROR.PRODUCT.NOT_FOUND,
      code: 'NOT_FOUND',
    });

    expect(getStatus()).toBe(404);
    expect(get().status).toBe(false);
    expect(get().message).toBe('Product not found. Error Code (NOT_FOUND)');
    expect(get().result).toEqual({});
  });

  it('never leaks error details into result', () => {
    const { res, get } = capture();
    ApiResponse.error(res, { message: 'Boom', code: 'INTERNAL_ERROR', statusCode: 500 });
    expect(get().result).toEqual({});
    expect(Object.keys(get().result)).toHaveLength(0);
  });
});

describe('getPagination', () => {
  it('defaults to page 1 / limit 20', () => {
    expect(getPagination({})).toEqual({ page: 1, limit: 20, skip: 0, take: 20 });
  });

  it('computes skip from page and limit', () => {
    expect(getPagination({ page: '3', limit: '20' })).toEqual({
      page: 3,
      limit: 20,
      skip: 40,
      take: 20,
    });
  });

  it('clamps limit to the configured maximum', () => {
    expect(getPagination({ limit: '5000' }).limit).toBe(100);
  });

  it('rejects non-numeric and zero values by falling back to defaults', () => {
    expect(getPagination({ page: 'abc', limit: '0' })).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
      take: 20,
    });
    expect(getPagination({ page: '-5' }).page).toBe(1);
  });
});

describe('getSort', () => {
  const allowed = ['createdAt', 'price', 'name'] as const;

  it('parses a leading dash as descending', () => {
    expect(getSort({ sort: '-price' }, allowed)).toEqual({ price: 'desc' });
  });

  it('treats a bare field as ascending', () => {
    expect(getSort({ sort: 'price' }, allowed)).toEqual({ price: 'asc' });
  });

  it('falls back to the default for fields outside the whitelist', () => {
    expect(getSort({ sort: '-passwordHash' }, allowed, '-createdAt')).toEqual({
      createdAt: 'desc',
    });
  });
});

describe('calcTokenAmount', () => {
  const percentConfig = {
    enabled: true,
    mode: 'percent' as const,
    percent: 20,
    fixedAmount: 100,
    minAmount: 50,
    maxAmount: 5000,
    applicableAbove: 2000,
  };

  it('returns 0 below applicableAbove', () => {
    expect(calcTokenAmount(500, percentConfig)).toBe(0);
  });

  it('computes percent of the order total', () => {
    expect(calcTokenAmount(2000, percentConfig)).toBe(400);
  });

  it('uses the fixed amount in fixed mode', () => {
    expect(calcTokenAmount(2000, { ...percentConfig, mode: 'fixed' })).toBe(100);
  });

  it('clamps to maxAmount for very large orders', () => {
    expect(calcTokenAmount(40000, percentConfig)).toBe(5000);
  });

  it('clamps up to minAmount for tiny but applicable orders', () => {
    expect(calcTokenAmount(2100, { ...percentConfig, percent: 1 })).toBe(50);
  });

  it('never exceeds the order total', () => {
    expect(calcTokenAmount(2000, { ...percentConfig, minAmount: 5000, maxAmount: 9000 })).toBe(
      2000,
    );
  });

  it('returns 0 when the feature is disabled', () => {
    expect(calcTokenAmount(100000, { ...percentConfig, enabled: false })).toBe(0);
  });
});

describe('calcCommission', () => {
  it('splits earnings as subtotal minus commission minus platform fee', () => {
    const result = calcCommission({ subtotal: 799, commissionRate: 10, platformFee: 20 });
    expect(result.commission).toBe(79.9);
    expect(result.platformFee).toBe(20);
    expect(result.vendorEarning).toBe(699.1);
  });

  it('extracts tax from the price when tax is inclusive', () => {
    const result = calcCommission({
      subtotal: 1180,
      commissionRate: 0,
      taxPercent: 18,
      taxInclusive: true,
    });
    expect(result.taxAmount).toBe(180);
    expect(result.vendorEarning).toBe(1000);
  });

  it('adds exclusive tax on top of the subtotal', () => {
    const result = calcCommission({ subtotal: 1000, commissionRate: 0, taxPercent: 18 });
    expect(result.taxAmount).toBe(180);
    expect(result.total).toBe(1180);
  });

  it('never produces a negative vendor earning', () => {
    const result = calcCommission({ subtotal: 100, commissionRate: 100, platformFee: 500 });
    expect(result.vendorEarning).toBe(0);
  });
});

describe('calcCouponDiscount', () => {
  it('applies a flat discount', () => {
    expect(
      calcCouponDiscount({
        subtotal: 1000,
        type: 'FLAT',
        value: 100,
        maxDiscount: 0,
        globalMaxDiscount: 0,
      }).discount,
    ).toBe(100);
  });

  it('applies a percent discount with a cap', () => {
    const result = calcCouponDiscount({
      subtotal: 1000,
      type: 'PERCENT',
      value: 20,
      maxDiscount: 150,
      globalMaxDiscount: 0,
    });
    expect(result.discount).toBe(150);
  });

  it('flags free shipping without discounting', () => {
    const result = calcCouponDiscount({
      subtotal: 1000,
      type: 'FREE_SHIPPING',
      value: 0,
      maxDiscount: 0,
      globalMaxDiscount: 0,
    });
    expect(result.discount).toBe(0);
    expect(result.freeShipping).toBe(true);
  });

  it('never discounts more than the subtotal', () => {
    const result = calcCouponDiscount({
      subtotal: 100,
      type: 'FLAT',
      value: 500,
      maxDiscount: 0,
      globalMaxDiscount: 0,
    });
    expect(result.discount).toBe(100);
  });
});

describe('calcCartTotals', () => {
  it('computes tax, shipping and grand total', () => {
    const result = calcCartTotals({
      subtotal: 1000,
      taxPercent: 18,
      shippingCharge: 49,
      freeShippingAbove: 999,
    });
    expect(result.taxAmount).toBe(180);
    expect(result.shippingAmount).toBe(0);
    expect(result.total).toBe(1180);
  });

  it('charges shipping below the free threshold', () => {
    const result = calcCartTotals({
      subtotal: 500,
      taxPercent: 0,
      shippingCharge: 49,
      freeShippingAbove: 999,
    });
    expect(result.shippingAmount).toBe(49);
    expect(result.total).toBe(549);
  });

  it('applies coupon then wallet without going negative', () => {
    const result = calcCartTotals({
      subtotal: 1000,
      couponDiscount: 200,
      taxPercent: 0,
      shippingCharge: 0,
      walletAmount: 5000,
    });
    expect(result.walletAmount).toBe(800);
    expect(result.total).toBe(0);
  });
});

describe('calcShippingCharge', () => {
  it('adds a per-kg component when configured', () => {
    const result = calcShippingCharge({
      orderValue: 100,
      defaultCharge: 49,
      perKgCharge: 10,
      weightKg: 2.5,
    });
    expect(result.charge).toBe(74);
  });

  it('is free above the threshold', () => {
    const result = calcShippingCharge({ orderValue: 1500, defaultCharge: 49, freeAbove: 999 });
    expect(result.charge).toBe(0);
    expect(result.isFree).toBe(true);
  });
});

describe('order state machine', () => {
  it('allows the documented forward transitions', () => {
    expect(canTransitionOrder(ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.SHIPPED, ORDER_STATUS.OUT_FOR_DELIVERY)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.OUT_FOR_DELIVERY, ORDER_STATUS.DELIVERED)).toBe(true);
  });

  it('blocks random and backward transitions', () => {
    expect(canTransitionOrder(ORDER_STATUS.PENDING, ORDER_STATUS.DELIVERED)).toBe(false);
    expect(canTransitionOrder(ORDER_STATUS.DELIVERED, ORDER_STATUS.SHIPPED)).toBe(false);
    expect(canTransitionOrder(ORDER_STATUS.CANCELLED, ORDER_STATUS.CONFIRMED)).toBe(false);
  });

  it('allows cancellation only before dispatch', () => {
    expect(canTransitionOrder(ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.SHIPPED, ORDER_STATUS.CANCELLED)).toBe(true);
  });
});

describe('return and ticket state machines', () => {
  it('walks a return from request to refund', () => {
    expect(canTransitionReturn('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransitionReturn('APPROVED', 'PICKED_UP')).toBe(true);
    expect(canTransitionReturn('PICKED_UP', 'RECEIVED')).toBe(true);
    expect(canTransitionReturn('RECEIVED', 'REFUNDED')).toBe(true);
  });

  it('blocks skipping return steps', () => {
    expect(canTransitionReturn('REQUESTED', 'REFUNDED')).toBe(false);
    expect(canTransitionReturn('REJECTED', 'REFUNDED')).toBe(false);
  });

  it('does not allow replies on a closed ticket', () => {
    expect(canTransitionTicket('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionTicket('CLOSED', 'OPEN')).toBe(false);
  });
});

describe('slugs and identifiers', () => {
  it('slugifies names to URL-safe form', () => {
    expect(toSlug('Classic Cotton Shirt')).toBe('classic-cotton-shirt');
    expect(toSlug('  Wireless  Headphones!  ')).toBe('wireless-headphones');
  });

  it('generates prefixed unique order numbers', () => {
    const first = generateOrderNumber();
    const second = generateOrderNumber();
    expect(first.startsWith('ORD')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('recognises email identifiers', () => {
    expect(isEmailLooking('ravi@example.com')).toBe(true);
    expect(isEmailLooking('+919876543210')).toBe(false);
  });

  it('normalises phone numbers', () => {
    expect(normalisePhone('9876543210', '+91')).toBe('+919876543210');
    expect(normalisePhone('+919876543210', '+91')).toBe('+919876543210');
  });
});

describe('AppError', () => {
  it('carries status, code and defaults', () => {
    const err = AppError.notFound('Product not found.', 'NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.isOperational).toBe(true);
  });

  it('maps helpers to the documented HTTP codes', () => {
    expect(AppError.badRequest().statusCode).toBe(400);
    expect(AppError.unauthorized().statusCode).toBe(401);
    expect(AppError.forbidden().statusCode).toBe(403);
    expect(AppError.conflict().statusCode).toBe(409);
    expect(AppError.payloadTooLarge().statusCode).toBe(413);
    expect(AppError.tooManyRequests().statusCode).toBe(429);
    expect(AppError.serviceUnavailable().statusCode).toBe(503);
  });
});

describe('validation messages', () => {
  it('builds field messages without leaking internals', () => {
    expect(VALIDATION.REQUIRED('email')).toBe('email is required.');
    expect(VALIDATION.INVALID_EMAIL).toBe('Please enter a valid email address.');
    expect(VALIDATION.MIN_LENGTH('password', 8)).toBe('password must be at least 8 characters.');
    expect(VALIDATION.MAX_LENGTH('name', 50)).toBe('name must not exceed 50 characters.');
  });

  it('maps Zod issues to human messages', () => {
    const err = new ZodError([
      {
        code: 'invalid_string',
        path: ['email'],
        message: 'Invalid email',
        validation: 'email',
      } as any,
    ]);
    const mapped = err.errors.map(zodIssueToMessage);
    expect(mapped[0]).toBe('Please enter a valid email address.');
  });
});

describe('error handler integration', () => {
  it('renders a Zod failure as 400 VALIDATION_ERROR with an empty result', async () => {
    const { errorHandler } = await import('../src/middlewares/error.middleware');
    const { z } = await import('zod');

    const schema = z.object({ email: z.string().email() });
    let body: any = null;
    let statusCode = 0;

    const res: any = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: any) {
        body = payload;
        return res;
      },
    };

    errorHandler(
      new ZodError(schema.safeParse({ email: 'nope' }).error?.errors ?? []),
      { id: 'r1' } as any,
      res,
      () => undefined,
    );

    expect(statusCode).toBe(400);
    expect(body.status).toBe(false);
    expect(body.message).toContain('VALIDATION_ERROR');
    expect(body.result).toEqual({});
  });

  it('renders a Prisma P2002 as 409 DUPLICATE', async () => {
    const { errorHandler } = await import('../src/middlewares/error.middleware');

    let body: any = null;
    let statusCode = 0;
    const res: any = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: any) {
        body = payload;
        return res;
      },
    };

    errorHandler({ code: 'P2002' }, { id: 'r1' } as any, res, () => undefined);

    expect(statusCode).toBe(409);
    expect(body.message).toContain('DUPLICATE');
    expect(body.result).toEqual({});
  });

  it('renders a Prisma P2025 as 404 NOT_FOUND', async () => {
    const { errorHandler } = await import('../src/middlewares/error.middleware');

    let body: any = null;
    let statusCode = 0;
    const res: any = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return res;
      },
      json(payload: any) {
        body = payload;
        return res;
      },
    };

    errorHandler({ code: 'P2025' }, { id: 'r1' } as any, res, () => undefined);

    expect(statusCode).toBe(404);
    expect(body.result).toEqual({});
  });

  it('hides internal details on an unhandled error', async () => {
    const { errorHandler } = await import('../src/middlewares/error.middleware');

    let body: any = null;
    const res: any = {
      headersSent: false,
      status() {
        return res;
      },
      json(payload: any) {
        body = payload;
        return res;
      },
    };

    errorHandler(
      new Error('Prisma error at line 42: secret token abc'),
      { id: 'r1' } as any,
      res,
      () => undefined,
    );

    expect(body.status).toBe(false);
    expect(body.message).toBe(`${ERROR.COMMON.SERVER_ERROR} Error Code (INTERNAL_ERROR)`);
    expect(JSON.stringify(body)).not.toContain('secret token');
    expect(body.result).toEqual({});
  });
});
