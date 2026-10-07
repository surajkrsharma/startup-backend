/**
 * The dead letter queue for background jobs.
 *
 * A job that exhausts its attempts is written here instead of disappearing with
 * the Redis `removeOnFail` window. Two properties matter and both come from
 * storing the row in Postgres rather than in a Bull queue: the failure
 * survives a Redis flush, and an admin can query it over HTTP.
 *
 * The row is keyed on the original BullMQ job id, so a job that fails, is
 * replayed and fails again updates one row rather than accumulating duplicates.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../services/prisma.service';
import { moduleLogger } from '../services/logger.service';
import { FAILED_JOB_STATUS, FailedJobStatus } from '../constants/statuses';
import { DLQ } from '../config/queue.config';
import { getQueueConfig } from '../services/settings.service';
import { getQueue, enqueue } from './queues';
import { QueueName } from '../config/socket.config';
import { D } from '../utils/defaults';
import { subtractDays } from '../utils/dates';

const log = moduleLogger('dlq');

export interface RecordFailureInput {
  queue: QueueName;
  jobName: string;
  jobId: string;
  payload: Record<string, any>;
  error: string;
  attemptsMade: number;
}

/**
 * Persist an exhausted job. Called from the worker's `failed` hook, so a
 * failure here must never throw — losing the record of a failure is worse than
 * the failure itself, and the worker has no way to report a second error.
 */
export const recordFailedJob = async (input: RecordFailureInput): Promise<boolean> => {
  try {
    await prisma.failedJob.upsert({
      where: { queue_jobId: { queue: input.queue, jobId: input.jobId } },
      create: {
        queue: input.queue,
        jobName: input.jobName,
        jobId: input.jobId,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        error: D.str(input.error).slice(0, DLQ.ERROR_MAX_LENGTH),
        attemptsMade: D.num(input.attemptsMade),
        status: FAILED_JOB_STATUS.PENDING,
        lastErrorAt: new Date(),
      },
      update: {
        jobName: input.jobName,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        error: D.str(input.error).slice(0, DLQ.ERROR_MAX_LENGTH),
        attemptsMade: D.num(input.attemptsMade),
        // A job that comes back PENDING after a replay has failed again.
        status: FAILED_JOB_STATUS.PENDING,
        lastErrorAt: new Date(),
        replayedAt: null,
        resolvedAt: null,
        resolvedBy: null,
      },
    });
    return true;
  } catch (err) {
    log.error(
      { err: (err as Error)?.message, queue: input.queue, jobId: input.jobId },
      '[dlq] failed to record exhausted job',
    );
    return false;
  }
};

/**
 * A job counts as exhausted only once BullMQ has spent every attempt. Comparing
 * against `attemptsMade` on its own would write a row on the first transient
 * failure, which is exactly the case the retry exists to absorb.
 */
export const isExhausted = (attemptsMade: number, attempts?: number): boolean => {
  const allowed = D.num(attempts) || 1;
  return D.num(attemptsMade) >= allowed;
};

export const listFailedJobs = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number; pending: number }> => {
  const where: Prisma.FailedJobWhereInput = {};

  const status = D.str(query.status).toUpperCase();
  if (status) where.status = status;

  const queue = D.str(query.queue);
  if (queue) where.queue = queue;

  const jobName = D.str(query.jobName);
  if (jobName) where.jobName = jobName;

  if (D.str(query.search)) {
    where.OR = [
      { jobName: { contains: D.str(query.search), mode: 'insensitive' } },
      { jobId: { contains: D.str(query.search), mode: 'insensitive' } },
      { error: { contains: D.str(query.search), mode: 'insensitive' } },
    ];
  }

  const [rows, total, pending] = await Promise.all([
    prisma.failedJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.failedJob.count({ where }),
    prisma.failedJob.count({ where: { status: FAILED_JOB_STATUS.PENDING } }),
  ]);

  return { rows, total, pending };
};

export const getFailedJob = async (id: string) => prisma.failedJob.findUnique({ where: { id } });

/**
 * Put an exhausted job back on its queue. The replay gets a fresh id on purpose:
 * reusing the BullMQ id would collide with the retained failed job, and the
 * original row stays as the record of what went wrong.
 */
export const retryFailedJob = async (row: {
  id: string;
  queue: string;
  jobName: string;
  jobId: string;
  payload: unknown;
  replayCount: number;
}): Promise<{ retried: boolean; replayCount: number; reason: string }> => {
  const { maxReplays } = await getQueueConfig();
  if (row.replayCount >= maxReplays) {
    return { retried: false, replayCount: row.replayCount, reason: 'REPLAY_LIMIT' };
  }

  const queue = getQueue(row.queue as QueueName);
  if (!queue) return { retried: false, replayCount: row.replayCount, reason: 'QUEUE_UNAVAILABLE' };

  const payload = (row.payload ?? {}) as Record<string, any>;
  const added = await enqueue(row.queue as QueueName, row.jobName as never, payload, {
    jobId: `replay-${row.jobId}-${row.replayCount + 1}`,
  });

  if (!added.queued) {
    return { retried: false, replayCount: row.replayCount, reason: 'ENQUEUE_FAILED' };
  }

  const replayCount = row.replayCount + 1;

  await prisma.failedJob.update({
    where: { id: row.id },
    data: {
      replayCount: { increment: 1 },
      replayedAt: new Date(),
    },
  });

  return { retried: true, replayCount, reason: '' };
};

/**
 * Mark a row resolved without replaying it — the usual answer when the work was
 * completed by hand or turned out to be irrelevant.
 */
export const resolveFailedJob = async (
  id: string,
  actorId: string,
): Promise<{ resolved: boolean; replayCount: number }> => {
  const row = await prisma.failedJob.findUnique({ where: { id } });
  if (!row) return { resolved: false, replayCount: 0 };

  await prisma.failedJob.update({
    where: { id },
    data: {
      status: FAILED_JOB_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedBy: D.str(actorId),
    },
  });

  return { resolved: true, replayCount: row.replayCount };
};

export const deleteFailedJob = async (id: string): Promise<boolean> => {
  const existing = await prisma.failedJob.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.failedJob.delete({ where: { id } });
  return true;
};

/**
 * Nightly trim. Resolved rows past the retention window go, and so do pending
 * rows nobody has touched in that long — an unreplayed failure that old is
 * almost always a bug that has since been fixed, and keeping it forever only
 * hides the live ones.
 */
export const pruneFailedJobs = async (): Promise<{ pruned: number; abandoned: number }> => {
  const cutoff = subtractDays(DLQ.RESOLVED_RETENTION_DAYS);

  const abandoned = await prisma.failedJob.updateMany({
    where: {
      status: FAILED_JOB_STATUS.PENDING,
      createdAt: { lt: subtractDays(DLQ.STALE_PENDING_DAYS) },
    },
    data: { status: FAILED_JOB_STATUS.ABANDONED },
  });

  const pruned = await prisma.failedJob.deleteMany({
    where: {
      status: { in: [FAILED_JOB_STATUS.RESOLVED, FAILED_JOB_STATUS.ABANDONED] },
      updatedAt: { lt: cutoff },
    },
  });

  if (abandoned.count > 0 || pruned.count > 0) {
    log.info({ abandoned: abandoned.count, pruned: pruned.count }, '[dlq] pruned dead letter rows');
  }

  return { pruned: pruned.count, abandoned: abandoned.count };
};

export const getFailedJobCounts = async (): Promise<{
  pending: number;
  resolved: number;
  abandoned: number;
}> => {
  const grouped = await prisma.failedJob.groupBy({ by: ['status'], _count: { _all: true } });

  const countFor = (status: FailedJobStatus): number =>
    D.num(grouped.find((g) => g.status === status)?._count._all);

  return {
    pending: countFor(FAILED_JOB_STATUS.PENDING),
    resolved: countFor(FAILED_JOB_STATUS.RESOLVED),
    abandoned: countFor(FAILED_JOB_STATUS.ABANDONED),
  };
};
