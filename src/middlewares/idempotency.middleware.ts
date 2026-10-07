import { NextFunction, Request, Response } from 'express';
import { prisma } from '../services/prisma.service';
import { logger } from '../services/logger.service';
import { AppError } from '../utils/AppError';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { HEADER, IDEMPOTENCY } from '../config/app.config';
import { sha256 } from '../utils/crypto';
import { D } from '../utils/defaults';
import { addHours } from '../utils/dates';

const IN_PROGRESS = 'IN_PROGRESS';
const COMPLETED = 'COMPLETED';

/**
 * Hashes what the client actually sent, so the same key pointed at a different
 * body is refused instead of being answered with the first call's result.
 */
const hashRequest = (req: Request): string =>
  sha256(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`);

const readKey = (req: Request): string => {
  const raw = req.headers[HEADER.IDEMPOTENCY_KEY];
  const value = D.str(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!value) return '';
  if (value.length < IDEMPOTENCY.KEY_MIN_LENGTH || value.length > IDEMPOTENCY.KEY_MAX_LENGTH) {
    throw new AppError(
      ERROR.PAYMENT.IDEMPOTENCY_KEY_INVALID,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.IDEMPOTENCY_KEY_INVALID,
    );
  }
  return value;
};

const replay = (
  res: Response,
  row: { responseStatus: number | null; responseBody: string | null },
): void => {
  res.setHeader(HEADER.IDEMPOTENCY_REPLAYED, 'true');

  let body: unknown = {};
  try {
    body = row.responseBody ? JSON.parse(row.responseBody) : {};
  } catch {
    body = {};
  }

  res.status(D.num(row.responseStatus) || HTTP_STATUS.OK).json(body);
};

/**
 * Taps `res.json` rather than asking `ApiResponse` to record anything, so every
 * controller is captured without a single call site changing.
 */
const captureJson = (res: Response): { body: unknown } => {
  const store: { body: unknown } = { body: null };
  const original = res.json.bind(res);

  res.json = ((payload: unknown) => {
    store.body = payload;
    return original(payload);
  }) as Response['json'];

  return store;
};

/**
 * Opt-in per route. Without the header the request passes straight through, so
 * adding this to a route cannot break a client that has not adopted keys yet.
 *
 * The first caller takes the key by inserting an IN_PROGRESS row; the unique
 * index on (userId, key) is what actually serialises concurrent retries, since
 * a check-then-insert would race. A completed key replays its stored response
 * verbatim, including the status code.
 */
export const idempotency =
  (scope: string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let key: string;

    try {
      key = readKey(req);
    } catch (err) {
      next(err);
      return;
    }

    if (!key) {
      next();
      return;
    }

    const userId = D.str(req.auth?.userId);
    const requestHash = hashRequest(req);
    const now = new Date();

    const existing = await prisma.idempotencyKey.findFirst({
      where: { userId, key },
      select: {
        id: true,
        requestHash: true,
        state: true,
        responseStatus: true,
        responseBody: true,
        updatedAt: true,
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        next(
          new AppError(
            ERROR.PAYMENT.IDEMPOTENCY_KEY_REUSED,
            HTTP_STATUS.CONFLICT,
            ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
          ),
        );
        return;
      }

      if (existing.state === COMPLETED) {
        replay(res, existing);
        return;
      }

      const ageSec = (now.getTime() - existing.updatedAt.getTime()) / 1000;
      if (ageSec > IDEMPOTENCY.IN_PROGRESS_MAX_AGE_SEC) {
        await prisma.idempotencyKey.update({
          where: { id: existing.id },
          data: { requestHash, expiresAt: addHours(IDEMPOTENCY.RETENTION_HOURS) },
        });
        next();
        return;
      }

      next(
        new AppError(
          ERROR.PAYMENT.IDEMPOTENCY_IN_PROGRESS,
          HTTP_STATUS.CONFLICT,
          ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
        ),
      );
      return;
    }

    try {
      await prisma.idempotencyKey.create({
        data: {
          key,
          scope,
          userId,
          requestHash,
          state: IN_PROGRESS,
          expiresAt: addHours(IDEMPOTENCY.RETENTION_HOURS),
        },
      });
    } catch {
      // Lost the insert race: the other caller now owns the key.
      next(
        new AppError(
          ERROR.PAYMENT.IDEMPOTENCY_IN_PROGRESS,
          HTTP_STATUS.CONFLICT,
          ERROR_CODE.IDEMPOTENCY_IN_PROGRESS,
        ),
      );
      return;
    }

    const captured = captureJson(res);

    res.on('finish', () => {
      /**
       * A key belongs to a call that succeeded. Anything 4xx or 5xx releases it
       * so the client can fix the request and retry, rather than being locked
       * out of a key it has not actually spent.
       */
      if (res.statusCode >= HTTP_STATUS.BAD_REQUEST) {
        void prisma.idempotencyKey
          .deleteMany({ where: { userId, key, state: IN_PROGRESS } })
          .catch((err: Error) => {
            logger.error({ err: err.message, key, scope }, '[idempotency] release failed');
          });
        return;
      }

      void prisma.idempotencyKey
        .updateMany({
          where: { userId, key, state: IN_PROGRESS },
          data: {
            state: COMPLETED,
            responseStatus: res.statusCode,
            responseBody: JSON.stringify(captured.body ?? {}),
          },
        })
        .catch((err: Error) => {
          logger.error({ err: err.message, key, scope }, '[idempotency] store response failed');
        });
    });

    next();
  };
