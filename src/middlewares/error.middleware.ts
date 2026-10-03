import type { ErrorRequestHandler, Request } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { ApiResponse } from '../utils/ApiResponse';
import { AppError } from '../utils/AppError';
import { ERROR } from '../messages/error';
import { VALIDATION, zodIssueToMessage } from '../messages/validation';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { mapPrismaError } from '../services/prisma.service';
import { logger } from '../services/logger.service';

/** Normalises anything thrown anywhere into the strict 3-key error envelope. */
export const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: any, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // ── Zod validation ───────────────────────────────────────────────────────
  if (err instanceof ZodError) {
    // Prefer a field-specific message over a generic union/discriminator complaint.
    const issues = err.errors ?? [];
    const first =
      issues.find((issue) => issue.code === 'custom') ??
      issues.find((issue) => issue.path?.length) ??
      issues[0];
    const message = first ? zodIssueToMessage(first) : VALIDATION.INVALID_JSON;
    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message,
      code: ERROR_CODE.VALIDATION_ERROR,
    });
  }

  // ── Explicit application errors ──────────────────────────────────────────
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(
        { err: err.message, code: err.code, requestId: req?.id, path: req?.originalUrl },
        '[error] app error',
      );
    }
    return ApiResponse.error(res, {
      statusCode: err.statusCode,
      message: err.message,
      code: err.code,
    });
  }

  // ── Multer (file upload) ─────────────────────────────────────────────────
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
        message: ERROR.UPLOAD.PAYLOAD_TOO_LARGE,
        code: ERROR_CODE.PAYLOAD_TOO_LARGE,
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.BAD_REQUEST,
        message: ERROR.UPLOAD.TOO_MANY_FILES,
        code: ERROR_CODE.TOO_MANY_FILES,
      });
    }
    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: ERROR.UPLOAD.FILE_REQUIRED,
      code: ERROR_CODE.VALIDATION_ERROR,
    });
  }

  // ── Body parser ──────────────────────────────────────────────────────────
  if (err?.type === 'entity.too.large') {
    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      message: ERROR.UPLOAD.PAYLOAD_TOO_LARGE,
      code: ERROR_CODE.PAYLOAD_TOO_LARGE,
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: VALIDATION.INVALID_JSON,
      code: ERROR_CODE.VALIDATION_ERROR,
    });
  }

  // ── Prisma ───────────────────────────────────────────────────────────────
  const prismaMapped = mapPrismaError(err);
  if (prismaMapped) {
    const message =
      prismaMapped.code === 'DUPLICATE'
        ? ERROR.COMMON.DUPLICATE
        : prismaMapped.code === 'NOT_FOUND'
          ? ERROR.COMMON.NOT_FOUND
          : ERROR.COMMON.BAD_REQUEST;
    return ApiResponse.error(res, {
      statusCode: prismaMapped.status,
      message,
      code: prismaMapped.code,
    });
  }

  // ── Rate limiter ─────────────────────────────────────────────────────────
  if (err?.statusCode === HTTP_STATUS.TOO_MANY_REQUESTS) {
    return ApiResponse.error(res, {
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
      message: ERROR.COMMON.RATE_LIMITED,
      code: ERROR_CODE.RATE_LIMITED,
    });
  }

  // ── Anything else: log internally, never leak details ────────────────────
  logger.error(
    {
      err: err?.message,
      stack: err?.stack,
      code: err?.code,
      requestId: req?.id,
      path: req?.originalUrl,
      method: req?.method,
    },
    '[error] unhandled',
  );

  return ApiResponse.error(res, {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: ERROR.COMMON.SERVER_ERROR,
    code: ERROR_CODE.INTERNAL_ERROR,
  });
};

export const notFoundHandler = (req: Request, res: any) =>
  ApiResponse.error(res, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    message: ERROR.COMMON.NOT_FOUND,
    code: ERROR_CODE.NOT_FOUND,
  });
