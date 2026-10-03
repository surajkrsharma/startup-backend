import type { RequestHandler } from 'express';

/** Wraps an async route handler so rejections reach the central error handler. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Same, but for non-Express async work (services, jobs). */
export const asyncSafe = <T>(fn: () => Promise<T>): Promise<T | undefined> =>
  Promise.resolve(fn()).catch(() => undefined);
