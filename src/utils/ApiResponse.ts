import type { Response } from 'express';
import { D } from './defaults';
import { PAGINATION } from '../config/pagination.config';

/**
 * Strict response envelope. Exactly three top-level keys, always in this order:
 *   1. status   -> boolean
 *   2. message  -> string (never empty)
 *   3. result   -> object (never null, never a bare array)
 *
 * Request tracking is exposed via the `X-Request-Id` response header, never in the body.
 */
export class ApiResponse {
  static success(
    res: Response,
    {
      statusCode = 200,
      message,
      result,
    }: {
      statusCode?: number;
      message: string;
      result?: any;
    },
  ) {
    return res.status(statusCode).json({
      status: true,
      message: D.str(message),
      result: result ?? {},
    });
  }

  static created(res: Response, message: string, result: any = {}) {
    return ApiResponse.success(res, { statusCode: 201, message, result });
  }

  static accepted(res: Response, message: string, result: any = {}) {
    return ApiResponse.success(res, { statusCode: 202, message, result });
  }

  static noContent(res: Response, message: string, result: any = {}) {
    return res.status(204).json({
      status: true,
      message: D.str(message),
      result: result ?? {},
    });
  }

  /**
   * List response. Pagination numbers come first inside `result`, in this exact
   * order: totalRecord, totalPage, currentPage, limit, hasNext, hasPrevious,
   * nextPage, previousPage — followed by filterData and then the xxxList array.
   */
  static paginated(
    res: Response,
    {
      statusCode = 200,
      message,
      result = {},
      totalRecord = 0,
      totalPage = 0,
      currentPage = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      hasNext,
      hasPrevious,
      nextPage,
      previousPage,
    }: {
      statusCode?: number;
      message: string;
      result?: any;
      totalRecord?: number;
      /** Derived from totalRecord/limit when omitted. */
      totalPage?: number;
      currentPage?: number;
      limit?: number;
      /** Derived from totalRecord/currentPage/limit when omitted. */
      hasNext?: boolean;
      /** Derived from currentPage when omitted. */
      hasPrevious?: boolean;
      nextPage?: number;
      previousPage?: number;
    },
  ) {
    const safeTotal = D.num(totalRecord);
    const safePage = Math.max(1, D.num(currentPage));
    const safeLimit = Math.max(1, D.num(limit));
    const derivedTotalPage = safeLimit > 0 ? Math.ceil(safeTotal / safeLimit) : 0;
    const derivedHasNext = safePage * safeLimit < safeTotal;
    const derivedHasPrevious = safePage > 1;

    return res.status(statusCode).json({
      status: true,
      message: D.str(message),
      result: {
        totalRecord: safeTotal,
        totalPage: totalPage > 0 ? D.num(totalPage) : derivedTotalPage,
        currentPage: safePage,
        limit: safeLimit,
        hasNext: typeof hasNext === 'boolean' ? hasNext : derivedHasNext,
        hasPrevious: typeof hasPrevious === 'boolean' ? hasPrevious : derivedHasPrevious,
        nextPage:
          typeof nextPage === 'number' ? D.num(nextPage) : derivedHasNext ? safePage + 1 : 0,
        previousPage:
          typeof previousPage === 'number'
            ? D.num(previousPage)
            : derivedHasPrevious
              ? safePage - 1
              : 0,
        ...(result ?? {}),
      },
    });
  }

  static error(
    res: Response,
    {
      statusCode = 500,
      message,
      code,
    }: {
      statusCode?: number;
      message: string;
      code?: string;
    },
  ) {
    const finalCode = D.str(code) || 'INTERNAL_ERROR';
    return res.status(statusCode).json({
      status: false,
      message: `${D.str(message)} Error Code (${finalCode})`,
      result: {},
    });
  }

  /**
   * Builds the paginated result payload without touching the response object.
   * Useful for nested composition and for tests/snapshot assertions.
   */
  static buildPaginatedResult(
    rows: any[],
    total: number,
    page: number,
    limit: number,
    extra: Record<string, any> = {},
  ) {
    const safeTotal = D.num(total);
    const safePage = Math.max(1, D.num(page));
    const safeLimit = Math.max(1, D.num(limit));
    const totalPage = safeLimit > 0 ? Math.ceil(safeTotal / safeLimit) : 0;
    const hasNext = safePage * safeLimit < safeTotal;
    const hasPrevious = safePage > 1;

    return {
      totalRecord: safeTotal,
      totalPage,
      currentPage: safePage,
      limit: safeLimit,
      hasNext,
      hasPrevious,
      nextPage: hasNext ? safePage + 1 : 0,
      previousPage: hasPrevious ? safePage - 1 : 0,
      ...extra,
    };
  }
}
