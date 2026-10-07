/**
 * Defaults for the BullMQ layer: how often a job is retried before it is
 * written to the dead letter queue, and how long the dead letter rows are kept.
 *
 * Every number here is an ops decision, not a business rule, so an admin can
 * change the retries at runtime through the `queue.*` settings while these
 * values stay the answer whenever no override exists.
 */
export const QUEUE_POLICY = {
  ATTEMPTS: 3,
  BACKOFF_TYPE: 'exponential' as const,
  BACKOFF_DELAY_MS: 3000,
  MAX_BACKOFF_DELAY_MS: 60_000,
  REMOVE_ON_COMPLETE_COUNT: 200,
  REMOVE_ON_FAIL_COUNT: 500,
  WORKER_CONCURRENCY: 5,
} as const;

/**
 * The dead letter queue is a table rather than a Bull queue: a failed job has to
 * survive a Redis flush, and it has to be queryable by an admin over HTTP.
 */
export const DLQ = {
  /** How many manual replays one row is allowed before it is treated as poison. */
  MAX_REPLAYS: 3,
  /** Resolved rows older than this are pruned by the nightly job. */
  RESOLVED_RETENTION_DAYS: 30,
  /** Attempts that stay PENDING with no replay this long count as abandoned. */
  STALE_PENDING_DAYS: 30,
  /** Error text kept per row — the full stack does not survive a round trip usefully. */
  ERROR_MAX_LENGTH: 1000,
} as const;
