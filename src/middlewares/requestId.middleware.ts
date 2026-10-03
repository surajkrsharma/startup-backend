import type { RequestHandler } from 'express';
import { nanoid } from 'nanoid';
import { HEADER } from '../config/app.config';

/**
 * Assigns `req.id` so every log line for one request can be correlated.
 * Also echoes it back in the `X-Request-Id` response header (never in the body).
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers[HEADER.REQUEST_ID];
  const id = (Array.isArray(incoming) ? incoming[0] : incoming) || nanoid(16);
  req.id = id;
  res.setHeader(HEADER.RESPONSE_REQUEST_ID, id);
  next();
};

export const getRequestId = (req: any): string => req?.id ?? '';
