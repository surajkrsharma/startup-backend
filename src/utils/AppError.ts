import { ERROR_CODE } from '../constants/http';
import { ERROR } from '../messages/error';

export interface AppErrorOptions {
  statusCode?: number;
  code?: string;
  errors?: any[];
  cause?: unknown;
  isOperational?: boolean;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errors: any[];
  public readonly isOperational: boolean;
  public readonly cause?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code: string = ERROR_CODE.INTERNAL_ERROR,
    errors: any[] = [],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(
    message: string = ERROR.COMMON.BAD_REQUEST,
    code: string = ERROR_CODE.VALIDATION_ERROR,
  ) {
    return new AppError(message, 400, code);
  }

  static unauthorized(
    message: string = ERROR.AUTH.UNAUTHORIZED,
    code: string = ERROR_CODE.UNAUTHORIZED,
  ) {
    return new AppError(message, 401, code);
  }

  static forbidden(message: string = ERROR.COMMON.FORBIDDEN, code: string = ERROR_CODE.FORBIDDEN) {
    return new AppError(message, 403, code);
  }

  static notFound(message: string = ERROR.COMMON.NOT_FOUND, code: string = ERROR_CODE.NOT_FOUND) {
    return new AppError(message, 404, code);
  }

  static conflict(message: string = ERROR.COMMON.DUPLICATE, code: string = ERROR_CODE.DUPLICATE) {
    return new AppError(message, 409, code);
  }

  static unprocessable(message: string, code: string = ERROR_CODE.VALIDATION_ERROR) {
    return new AppError(message, 422, code);
  }

  static tooManyRequests(
    message: string = ERROR.COMMON.RATE_LIMITED,
    code: string = ERROR_CODE.RATE_LIMITED,
  ) {
    return new AppError(message, 429, code);
  }

  static payloadTooLarge(message: string = ERROR.UPLOAD.PAYLOAD_TOO_LARGE) {
    return new AppError(message, 413, ERROR_CODE.PAYLOAD_TOO_LARGE);
  }

  static unsupportedMediaType(message: string = ERROR.UPLOAD.UNSUPPORTED_TYPE) {
    return new AppError(message, 415, ERROR_CODE.UNSUPPORTED_TYPE);
  }

  static serviceUnavailable(
    message: string = ERROR.SYSTEM.MAINTENANCE,
    code: string = ERROR_CODE.MAINTENANCE,
  ) {
    return new AppError(message, 503, code);
  }

  static internal(message: string = ERROR.COMMON.SERVER_ERROR) {
    return new AppError(message, 500, ERROR_CODE.INTERNAL_ERROR);
  }
}
