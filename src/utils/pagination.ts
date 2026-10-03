import { PAGINATION } from '../config/pagination.config';

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export const getPagination = (query: any): PaginationResult => {
  const rawPage = Number(query?.page);
  const rawLimit = Number(query?.limit);

  const page = Math.max(
    1,
    Number.isFinite(rawPage) && rawPage > 0 ? Math.trunc(rawPage) : PAGINATION.DEFAULT_PAGE,
  );

  const limit = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(
      PAGINATION.MIN_LIMIT,
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.trunc(rawLimit) : PAGINATION.DEFAULT_LIMIT,
    ),
  );

  const skip = (page - 1) * limit;
  return { page, limit, skip, take: limit };
};

/**
 * Converts `?sort=-createdAt` into a Prisma `orderBy` clause.
 * Only whitelisted fields are accepted — unknown fields fall back to the default.
 */
export const getSort = (
  query: any,
  allowed: readonly string[] = PAGINATION.ALLOWED_SORTS,
  fallback = PAGINATION.SORT_DEFAULT,
): Record<string, 'asc' | 'desc'> => {
  const raw = String(query?.sort ?? fallback);
  const direction: 'asc' | 'desc' = raw.startsWith('-') ? 'desc' : 'asc';
  const field = raw.replace(/^[-+]/, '');

  if (!allowed.includes(field as any)) {
    return { [fallback.replace(/^[-+]/, '')]: fallback.startsWith('-') ? 'desc' : 'asc' };
  }

  return { [field]: direction };
};

/** Non-paginated cursor helper used by exports and large reports. */
export const getCursor = (query: any, defaultTake = 50) => {
  const take = Math.min(500, Math.max(1, Number(query?.take) || defaultTake));
  return {
    take,
    cursor: query?.cursor ? { id: String(query.cursor) } : undefined,
    skip: query?.cursor ? 1 : 0,
  };
};

/** Whitelisted `fields` selection for list endpoints. */
export const getSelectedFields = (query: any, allowed: string[], fallback: string[]): string[] => {
  const raw = query?.fields;
  if (!raw) return fallback;
  const requested = String(raw)
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  const valid = requested.filter((f) => allowed.includes(f));
  return valid.length ? valid : fallback;
};
