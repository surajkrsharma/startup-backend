import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../src/services/prisma.service', async () => {
  const fake = await import('./helpers/idempotency-fake');
  return {
    prisma: fake.prisma,
    PrismaService: class {},
    mapPrismaError: () => null,
    disconnectPrisma: async () => undefined,
    connectPrisma: async () => undefined,
  };
});

vi.mock('../src/services/logger.service', () => ({
  logger: {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  },
  moduleLogger: () => ({
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  }),
}));

import { idempotency } from '../src/middlewares/idempotency.middleware';
import { AppError } from '../src/utils/AppError';
import { rows, reset } from './helpers/idempotency-fake';

const ENVELOPE = { status: true, message: 'Balance paid.', result: { orderId: 'ord_1' } };

interface RunOpts {
  key?: string;
  body?: any;
  auth?: any;
}

interface Harness {
  next: ReturnType<typeof vi.fn>;
  statusCode: () => number;
  body: () => any;
  headers: Record<string, any>;
  json: (payload: any) => void;
  fail: (err: Error) => Promise<void>;
  finish: () => Promise<void>;
}

const run = async (opts: RunOpts = {}): Promise<Harness> => {
  const req: any = {
    method: 'POST',
    originalUrl: '/api/v1/payments/payBalance/ord_1',
    body: opts.body ?? { amount: 10 },
    headers: opts.key ? { 'idempotency-key': opts.key } : {},
    auth: opts.auth ?? { userId: 'usr_1' },
  };

  const finishHandlers: Array<() => void> = [];
  const headers: Record<string, any> = {};
  let status = 200;
  let payload: any = null;

  const res: any = {
    statusCode: 200,
    setHeader: (k: string, v: any) => {
      headers[k] = v;
    },
    status(code: number) {
      status = code;
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      payload = body;
      return res;
    },
    on(event: string, handler: () => void) {
      if (event === 'finish') finishHandlers.push(handler);
      return res;
    },
  };

  const fireFinish = () => {
    for (const h of finishHandlers) h();
  };

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  /**
   * Express fires 'finish' after the downstream handler writes, and immediately
   * when the middleware itself short-circuits with an error.
   */
  const next = vi.fn((err?: any) => {
    if (!err) {
      resolveDone();
      return;
    }
    status = err.statusCode ?? 500;
    res.statusCode = status;
    payload = { status: false, message: err.message, result: {} };
    fireFinish();
    resolveDone();
  });

  await idempotency('test.scope')(req as Request, res as Response, next as unknown as NextFunction);

  /**
   * A replay short-circuits without calling next, so only wait when the
   * middleware delegated or errored out.
   */
  await new Promise((resolve) => setImmediate(resolve));
  if (next.mock.calls.length > 0 && next.mock.calls[0][0]) await done;

  return {
    next,
    statusCode: () => status,
    body: () => payload,
    headers,
    json: (p: any) => {
      res.json(p);
    },
    fail: async (err: Error) => {
      next(err);
      await done;
    },
    finish: async () => {
      fireFinish();
      await done;
    },
  };
};

describe('idempotency middleware', () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
  });

  it('passes through when no key is sent', async () => {
    const h = await run();
    expect(h.next).toHaveBeenCalledWith();
    expect(rows.size).toBe(0);
  });

  it('rejects a key that is too short', async () => {
    const h = await run({ key: 'abc' });
    expect(h.next).toHaveBeenCalledWith(expect.any(AppError));
    expect(rows.size).toBe(0);
  });

  it('takes the key on the first call and stores the response', async () => {
    const h = await run({ key: 'key-abcdefgh' });
    expect(h.next).toHaveBeenCalledWith();

    h.json(ENVELOPE);
    await h.finish();

    const stored = rows.get('usr_1:key-abcdefgh');
    expect(stored?.state).toBe('COMPLETED');
    expect(stored?.responseStatus).toBe(200);
    expect(JSON.parse(stored!.responseBody!)).toEqual(ENVELOPE);
  });

  it('replays the stored response instead of re-running the handler', async () => {
    const first = await run({ key: 'key-replay-01' });
    first.json(ENVELOPE);
    await first.finish();

    const second = await run({ key: 'key-replay-01' });

    expect(second.next).not.toHaveBeenCalled();
    expect(second.statusCode()).toBe(200);
    expect(second.body()).toEqual(ENVELOPE);
    expect(second.headers['x-idempotency-replayed']).toBe('true');
  });

  it('preserves envelope key order on replay', async () => {
    const first = await run({ key: 'key-order-001' });
    first.json(ENVELOPE);
    await first.finish();

    const second = await run({ key: 'key-order-001' });

    expect(Object.keys(second.body())).toEqual(['status', 'message', 'result']);
  });

  it('refuses a key reused with a different body', async () => {
    const first = await run({ key: 'key-mismatch1', body: { amount: 10 } });
    first.json(ENVELOPE);
    await first.finish();

    const second = await run({ key: 'key-mismatch1', body: { amount: 999 } });

    expect(second.statusCode()).toBe(409);
    expect(second.body().message).toContain('already used');
  });

  it('releases the key when the call fails, so the client can retry', async () => {
    const failed = await run({ key: 'key-release1' });
    await failed.fail(new AppError('Bad request.', 400, 'VALIDATION_ERROR'));

    expect(rows.has('usr_1:key-release1')).toBe(false);

    const retry = await run({ key: 'key-release1' });
    expect(retry.next).toHaveBeenCalledWith();
  });

  it('tells a concurrent caller the first attempt is still running', async () => {
    const inflight = await run({ key: 'key-inflight' });

    const second = await run({ key: 'key-inflight' });
    expect(second.statusCode()).toBe(409);
    expect(second.body().message).toContain('still in progress');

    inflight.json(ENVELOPE);
    await inflight.finish();
  });

  it('never stores a 5xx response as a replayable success', async () => {
    const failed = await run({ key: 'key-errfail1' });
    await failed.fail(new AppError('Gateway blew up.', 502, 'INTERNAL_ERROR'));

    expect(rows.get('usr_1:key-errfail1')).toBeUndefined();
  });

  it('scopes keys per user so two users cannot collide', async () => {
    const mine = await run({ key: 'key-shared-1', auth: { userId: 'usr_1' } });
    mine.json(ENVELOPE);
    await mine.finish();

    const theirs = await run({ key: 'key-shared-1', auth: { userId: 'usr_2' } });
    expect(theirs.next).toHaveBeenCalledWith();
    expect(theirs.headers['x-idempotency-replayed']).toBeUndefined();
  });

  it('reclaims a key whose first attempt died before finishing', async () => {
    const abandoned = await run({ key: 'key-stuck-01' });
    const stuck = rows.get('usr_1:key-stuck-01');
    expect(stuck?.state).toBe('IN_PROGRESS');
    void abandoned;

    // Still inside the window, so a concurrent caller is turned away.
    const fresh = await run({ key: 'key-stuck-01' });
    expect(fresh.statusCode()).toBe(409);

    stuck!.updatedAt = new Date(Date.now() - 600_000);

    const reclaimed = await run({ key: 'key-stuck-01' });
    expect(reclaimed.next).toHaveBeenCalledWith();
    expect(reclaimed.statusCode()).toBe(200);
  });
});
