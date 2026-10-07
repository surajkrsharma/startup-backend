import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/prisma.service', async () => {
  const fake = await import('./helpers/deadletter-fake');
  return {
    prisma: fake.prisma,
    PrismaService: class {},
    mapPrismaError: () => null,
    disconnectPrisma: async () => undefined,
    connectPrisma: async () => undefined,
  };
});

vi.mock('../src/services/logger.service', () => ({
  logger: {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  },
  moduleLogger: () => ({
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  }),
}));

vi.mock('../src/services/settings.service', () => ({
  getQueueConfig: async () => ({ maxAttempts: 3, backoffDelayMs: 3000, maxReplays: 2 }),
}));

vi.mock('../src/jobs/queues', async () => {
  const fake = await import('./helpers/deadletter-fake');
  return {
    getQueue: (name: string) => (fake.queueAvailable.value ? ({ name } as any) : null),
    enqueue: async (queue: string, jobName: string, data: any, opts: any) => {
      fake.enqueued.push({ queue, jobName, data, opts });
      return { queued: true, jobId: opts?.jobId ?? 'generated' };
    },
  };
});

import {
  isExhausted,
  recordFailedJob,
  listFailedJobs,
  retryFailedJob,
  resolveFailedJob,
  pruneFailedJobs,
  getFailedJobCounts,
} from '../src/jobs/deadletter.service';
import { FAILED_JOB_STATUS } from '../src/constants/statuses';
import { DLQ } from '../src/config/queue.config';
import { serializeFailedJob } from '../src/utils/serialize';
import {
  rows,
  reset,
  enqueued,
  resetEnqueued,
  queueAvailable,
  prisma,
} from './helpers/deadletter-fake';

const failure = (over: Record<string, any> = {}) => ({
  queue: 'email' as const,
  jobName: 'send-email',
  jobId: 'job-1',
  payload: { to: 'a@b.com' },
  error: 'smtp timeout',
  attemptsMade: 3,
  ...over,
});

describe('exhaustion check', () => {
  it('treats a transient failure as not exhausted so the retry can absorb it', () => {
    expect(isExhausted(1, 3)).toBe(false);
    expect(isExhausted(2, 3)).toBe(false);
  });

  it('treats the last attempt as exhausted', () => {
    expect(isExhausted(3, 3)).toBe(true);
    expect(isExhausted(4, 3)).toBe(true);
  });

  it('falls back to a single attempt when the job carries no attempts option', () => {
    expect(isExhausted(1, undefined)).toBe(true);
    expect(isExhausted(0, undefined)).toBe(false);
  });
});

describe('recording an exhausted job', () => {
  beforeEach(() => {
    reset();
    resetEnqueued();
  });

  it('stores the failure with its payload and error', async () => {
    await expect(recordFailedJob(failure())).resolves.toBe(true);

    expect(rows.size).toBe(1);
    const row = [...rows.values()][0];
    expect(row.queue).toBe('email');
    expect(row.jobName).toBe('send-email');
    expect(row.error).toBe('smtp timeout');
    expect(row.payload).toEqual({ to: 'a@b.com' });
    expect(row.status).toBe(FAILED_JOB_STATUS.PENDING);
  });

  it('updates the one row when the same job fails again instead of duplicating it', async () => {
    await recordFailedJob(failure());
    await recordFailedJob(failure({ error: 'still failing', attemptsMade: 6 }));

    expect(rows.size).toBe(1);
    const row = [...rows.values()][0];
    expect(row.error).toBe('still failing');
    expect(row.attemptsMade).toBe(6);
  });

  it('reopens a resolved row when its job comes back failing', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];
    await resolveFailedJob(row.id, 'admin-1');
    expect(row.status).toBe(FAILED_JOB_STATUS.RESOLVED);

    await recordFailedJob(failure({ error: 'failed again' }));

    expect(rows.size).toBe(1);
    expect(row.status).toBe(FAILED_JOB_STATUS.PENDING);
    expect(row.resolvedAt).toBeNull();
  });

  it('truncates a huge error rather than storing it whole', async () => {
    await recordFailedJob(failure({ error: 'x'.repeat(5000) }));

    expect([...rows.values()][0].error).toHaveLength(DLQ.ERROR_MAX_LENGTH);
  });

  it('reports failure without throwing when the write itself fails', async () => {
    prisma.failedJob.upsert.mockImplementationOnce(() => {
      throw new Error('db down');
    });
    await expect(recordFailedJob(failure())).resolves.toBe(false);
  });
});

describe('replaying a failed job', () => {
  beforeEach(() => {
    reset();
    resetEnqueued();
  });

  it('re-queues the original payload and counts the replay', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];

    const result = await retryFailedJob(row);

    expect(result.retried).toBe(true);
    expect(result.replayCount).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].queue).toBe('email');
    expect(enqueued[0].jobName).toBe('send-email');
    expect(enqueued[0].data).toEqual({ to: 'a@b.com' });
    expect(row.replayCount).toBe(1);
    expect(row.replayedAt).not.toBeNull();
  });

  it('gives the replay its own queue id so it cannot collide with the retained one', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];

    await retryFailedJob(row);

    expect(enqueued[0].opts.jobId).not.toBe(row.jobId);
    expect(enqueued[0].opts.jobId).toContain(row.jobId);
  });

  it('refuses to replay past the configured limit', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];
    row.replayCount = 2;

    const result = await retryFailedJob(row);

    expect(result).toEqual({ retried: false, replayCount: 2, reason: 'REPLAY_LIMIT' });
    expect(enqueued).toHaveLength(0);
  });

  it('reports the queue being unavailable instead of throwing', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];
    queueAvailable.value = false;

    const result = await retryFailedJob(row);

    expect(result.retried).toBe(false);
    expect(result.reason).toBe('QUEUE_UNAVAILABLE');
  });
});

describe('listing and counting', () => {
  beforeEach(() => {
    reset();
    resetEnqueued();
  });

  it('filters by status and counts pending separately from the page total', async () => {
    await recordFailedJob(failure({ jobId: 'a', queue: 'email' }));
    await recordFailedJob(failure({ jobId: 'b', queue: 'payout' }));

    const result = await listFailedJobs({
      status: FAILED_JOB_STATUS.PENDING,
      queue: 'payout',
      skip: 0,
      take: 20,
    });

    expect(result.total).toBe(1);
    expect(result.rows[0].jobId).toBe('b');
    expect(result.pending).toBe(2);
  });

  it('breaks the counts down per status', async () => {
    await recordFailedJob(failure({ jobId: 'a' }));
    await recordFailedJob(failure({ jobId: 'b' }));
    const second = [...rows.values()][1];
    await resolveFailedJob(second.id, 'admin-1');

    expect(await getFailedJobCounts()).toEqual({ pending: 1, resolved: 1, abandoned: 0 });
  });
});

describe('pruning', () => {
  beforeEach(() => {
    reset();
    resetEnqueued();
  });

  it('abandons an untouched pending row that outlived the stale window', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];
    row.createdAt = new Date(Date.now() - (DLQ.STALE_PENDING_DAYS + 1) * 86400000);

    const result = await pruneFailedJobs();

    expect(result.abandoned).toBe(1);
    expect(row.status).toBe(FAILED_JOB_STATUS.ABANDONED);
  });

  it('leaves a recent pending row alone', async () => {
    await recordFailedJob(failure());

    const result = await pruneFailedJobs();

    expect(result.abandoned).toBe(0);
    expect([...rows.values()][0].status).toBe(FAILED_JOB_STATUS.PENDING);
  });

  it('deletes a resolved row once its retention window has passed', async () => {
    await recordFailedJob(failure());
    const row = [...rows.values()][0];
    await resolveFailedJob(row.id, 'admin-1');
    row.updatedAt = new Date(Date.now() - (DLQ.RESOLVED_RETENTION_DAYS + 1) * 86400000);

    const result = await pruneFailedJobs();

    expect(result.pruned).toBe(1);
    expect(rows.size).toBe(0);
  });
});

describe('serializer', () => {
  it('never emits null and nests the payload as an object', () => {
    const out = serializeFailedJob({
      id: 'dj-1',
      queue: 'email',
      jobName: 'send-email',
      jobId: 'job-1',
      status: 'PENDING',
      error: 'boom',
      attemptsMade: 3,
      replayCount: 1,
      resolvedBy: null,
      lastErrorAt: new Date('2026-01-01T00:00:00.000Z'),
      replayedAt: null,
      resolvedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { to: 'a@b.com' },
    });

    expect(out.failedJobId).toBe('dj-1');
    expect(out.sourceJobId).toBe('job-1');
    expect(out.payloadData).toEqual({ to: 'a@b.com' });
    for (const [key, value] of Object.entries(out)) {
      expect(value, key).not.toBeNull();
    }
  });

  it('defaults a missing payload to an empty object', () => {
    expect(serializeFailedJob({ id: 'dj-2' }).payloadData).toEqual({});
  });
});
