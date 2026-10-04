import type { RequestHandler } from 'express';

export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const asyncSafe = <T>(fn: () => Promise<T>): Promise<T | undefined> =>
  Promise.resolve(fn()).catch(() => undefined);
