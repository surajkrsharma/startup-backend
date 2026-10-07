export const SOCKET = {
  NAMESPACE: '/ws',
  EVENTS: {
    CHAT_NEW: 'chat:new',
    CHAT_READ: 'chat:read',
    CHAT_CONVERSATION: 'chat:conversation',
    TYPING_START: 'typing:start',
    TYPING_STOP: 'typing:stop',
    USER_ONLINE: 'user:online',
    USER_OFFLINE: 'user:offline',
    ORDER_STATUS: 'order:status',
    ANALYTICS_LIVE: 'analytics:live',
    NOTIFICATION_NEW: 'notification:new',
    NOTIFICATION_READ: 'notification:read',
    NOTIFICATION_READ_ALL: 'notification:read-all',
  },
  EMIT: {
    CHAT_SEND: 'chat:send',
    CHAT_TYPING: 'chat:typing',
    CHAT_READ: 'chat:read',
    ORDER_JOIN: 'order:join',
    ORDER_LEAVE: 'order:leave',
    ANALYTICS_JOIN: 'analytics:join',
    PING: 'ping',
  },
  ROOMS: {
    USER: (userId: string) => `user:${userId}`,
    VENDOR: (vendorId: string) => `vendor:${vendorId}`,
    ORDER: (orderId: string) => `order:${orderId}`,
    ADMIN: 'admin',
    CONVERSATION: (conversationId: string) => `conversation:${conversationId}`,
  },
  HEARTBEAT_INTERVAL_MS: 25000,
  CONNECTION_STATE_TIMEOUT: 20000,
  MAX_BUFFER_BYTES: 1e6,
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const QUEUE = {
  EMAIL: 'email',
  NOTIFICATION: 'notification',
  PAYOUT: 'payout',
  ORDER_STATUS: 'order-status',
  ANALYTICS: 'analytics',
  BULK_IMPORT: 'bulk-import',
  REPORT: 'report',
  CLEANUP: 'cleanup',
} as const;

export const QUEUE_ALL: QueueName[] = Object.values(QUEUE) as QueueName[];

export const JOB = {
  SEND_EMAIL: 'send-email',
  SEND_NOTIFICATION: 'send-notification',
  NOTIFICATION_BLAST: 'notification-blast',
  GENERATE_PAYOUT_CYCLE: 'generate-payout-cycle',
  AGGREGATE_ANALYTICS: 'aggregate-analytics',
  ROLLUP_ORDER_STATUS: 'rollup-order-status',
  AUTO_CANCEL_UNPAID: 'auto-cancel-unpaid',
  TOKEN_BALANCE_REMINDER: 'token-balance-reminder',
  PROCESS_BULK_IMPORT: 'process-bulk-import',
  GENERATE_REPORT: 'generate-report',
  SLOW_SESSION_CLEANUP: 'cleanup-slow-sessions',
  CLEANUP_EXPIRED: 'cleanup-expired',
  PURGE_DELETED_ACCOUNTS: 'purge-deleted-accounts',
  PRICE_DROP_SCAN: 'price-drop-scan',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export const CRON = {
  ANALYTICS_ROLLUP: '0 2 * * *',
  PAYOUT_CYCLE: '0 3 * * 1',
  AUTO_CANCEL_UNPAID: '*/15 * * * *',
  TOKEN_REMINDER: '0 */6 * * *',
  CLEANUP_EXPIRED: '0 4 * * *',
  PURGE_DELETED_ACCOUNTS: '30 4 * * *',
  PRICE_DROP_SCAN: '0 */2 * * *',
  REALTIME_FLUSH: '*/1 * * * *',
} as const;
