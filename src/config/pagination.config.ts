export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  SORT_DEFAULT: '-createdAt',
  ALLOWED_SORTS: [
    'createdAt',
    'updatedAt',
    'price',
    'name',
    'rating',
    'soldCount',
    'createdAt_asc',
  ] as const,
};

export const EXPORT_PAGINATION = {
  DEFAULT_LIMIT: 1000,
  MAX_LIMIT: 10_000,
};

export const CURSOR_PAGE_SIZE = 50;
