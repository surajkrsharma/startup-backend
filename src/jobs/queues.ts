import { Queue, QueueOptions } from 'bullmq';
import IORedis from 'ioredis';
import { ENV, isRedisConfigured } from '../config/env.config';
import { QUEUE, QueueName, JOB, JobName } from '../config/socket.config';
import { logger } from '../services/logger.service';

/**
 * BullMQ queues. Redis is required; when it is not configured every enqueue is a
 * no-op so the HTTP API still works (jobs simply run inline or get skipped).
 */
let connection: IORedis | null = null;

export const getQueueConnection = (): IORedis | null => {
  if (!isRedisConfigured) return null;
  if (connection) return connection;
  connection = new IORedis(ENV.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on('error', (err) => logger.error({ err: err?.message }, '[queue] redis error'));
  return connection;
};

const baseOptions = {
  prefix: `${ENV.QUEUE_PREFIX}:bull`,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
};

const queues = new Map<QueueName, Queue>();

export const getQueue = (name: QueueName): Queue | null => {
  if (!ENV.QUEUE_ENABLED || !isRedisConfigured) return null;
  const cached = queues.get(name);
  if (cached) return cached;

  const conn = getQueueConnection();
  if (!conn) return null;

  const queue = new Queue(name, { ...baseOptions, connection: conn } as QueueOptions);
  queue.on('error', (err) => logger.error({ err: err?.message, queue: name }, '[queue] error'));
  queues.set(name, queue);
  return queue;
};

export interface EnqueueResult {
  queued: boolean;
  jobId: string;
}

export const enqueue = async (
  queueName: QueueName,
  jobName: JobName,
  data: Record<string, any>,
  opts: { delay?: number; jobId?: string } = {},
): Promise<EnqueueResult> => {
  const queue = getQueue(queueName);
  if (!queue) return { queued: false, jobId: '' };

  try {
    const job = await queue.add(jobName, data, {
      delay: opts.delay,
      jobId: opts.jobId,
    });
    return { queued: true, jobId: job.id ?? '' };
  } catch (err) {
    logger.error(
      { err: (err as Error)?.message, queue: queueName, jobName },
      '[queue] enqueue failed',
    );
    return { queued: false, jobId: '' };
  }
};

// ─── Typed enqueue helpers ────────────────────────────────────────────────────

export const enqueueEmail = (data: {
  to: string;
  templateKey?: string;
  templateData?: Record<string, any>;
  subject?: string;
  html?: string;
  text?: string;
}) => enqueue(QUEUE.EMAIL, JOB.SEND_EMAIL, data as any);

export const enqueueNotification = (
  channel: 'email' | 'sms' | 'push' | 'inApp',
  data: Record<string, any>,
) => enqueue(QUEUE.NOTIFICATION, JOB.SEND_NOTIFICATION, { channel, ...data });

export const enqueueNotificationBlast = (data: {
  title: string;
  body: string;
  userIds?: string[];
  segment?: Record<string, any>;
  type?: string;
}) => enqueue(QUEUE.NOTIFICATION, JOB.NOTIFICATION_BLAST, data as any);

export const enqueuePayoutCycle = (data: { vendorId?: string; period?: string }) =>
  enqueue(QUEUE.PAYOUT, JOB.GENERATE_PAYOUT_CYCLE, data as any);

export const enqueueOrderStatusRollup = (data: { orderId: string; status: string }) =>
  enqueue(QUEUE.ORDER_STATUS, JOB.ROLLUP_ORDER_STATUS, data as any);

export const enqueueAnalyticsRollup = (data: { date?: string } = {}) =>
  enqueue(QUEUE.ANALYTICS, JOB.AGGREGATE_ANALYTICS, data as any, {
    jobId: `rollup-${data.date ?? 'now'}`,
  });

export const enqueueBulkImport = (data: Record<string, any>) =>
  enqueue(QUEUE.BULK_IMPORT, JOB.PROCESS_BULK_IMPORT, data as any);

export const enqueueReport = (data: Record<string, any>) =>
  enqueue(QUEUE.REPORT, JOB.GENERATE_REPORT, data as any);

export const enqueueAutoCancelUnpaid = () =>
  enqueue(QUEUE.ORDER_STATUS, JOB.AUTO_CANCEL_UNPAID, {} as any);

export const enqueueTokenReminders = () =>
  enqueue(QUEUE.NOTIFICATION, JOB.TOKEN_BALANCE_REMINDER, {} as any);

export const enqueueCleanup = () => enqueue(QUEUE.CLEANUP, JOB.CLEANUP_EXPIRED, {} as any);

export const closeQueues = async (): Promise<void> => {
  await Promise.all(
    Array.from(queues.values()).map((queue) => queue.close().catch(() => undefined)),
  );
  queues.clear();

  if (connection) {
    await connection.quit().catch(() => connection?.disconnect());
    connection = null;
  }
};

export const getJobStatus = async (jobId: string): Promise<Record<string, any>> => {
  const names = Object.values(QUEUE) as QueueName[];
  for (const name of names) {
    const queue = getQueue(name);
    if (!queue) continue;
    const job = await queue.getJob(jobId).catch(() => null);
    if (!job) continue;
    return {
      jobId,
      queue: name,
      name: job.name,
      status: job.getState(),
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? '',
      data: job.data ?? {},
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }
  return { jobId, status: 'NOT_FOUND' };
};
