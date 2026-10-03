export const ANALYTICS = {
  REALTIME_WINDOW_MIN: 5,
  AGGREGATION_CRON: '0 2 * * *',
  RETENTION_DAYS: {
    RAW_EVENTS: 90,
    SESSIONS: 365,
    AGGREGATES: 1095,
  },
  CACHE_TTL_SEC: 300,
  COHORT_WEEKS: 12,
  DEFAULT_RANGE_DAYS: 30,
  MAX_RANGE_DAYS: 365,
  EXPORT_MAX_ROWS: 50_000,
  REVENUE_STATUSES: ['DELIVERED', 'SHIPPED', 'CONFIRMED', 'OUT_FOR_DELIVERY'] as const,
};

export const REALTIME = {
  WINDOW_SEC: 300,
  ACTIVE_KEY: 'rt:active',
  ONLINE_TTL_SEC: 60,
};

export const METRIC = {
  VISITOR: 'visitor',
  PAGE_VIEW: 'page_view',
  EVENT: 'event',
  CRASH: 'crash',
  SESSION: 'session',
  ORDER: 'order',
  CONVERSION: 'conversion',
  CLICK: 'click',
  SCROLL: 'scroll',
  SEARCH: 'search',
  HEARTBEAT: 'heartbeat',
} as const;

export type MetricName = (typeof METRIC)[keyof typeof METRIC];
