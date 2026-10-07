import { vi } from 'vitest';

export interface FailedJobRow {
  id: string;
  queue: string;
  jobName: string;
  jobId: string;
  payload: any;
  error: string;
  attemptsMade: number;
  replayCount: number;
  status: string;
  lastErrorAt: Date;
  replayedAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const rows = new Map<string, FailedJobRow>();

let idSeq = 0;

export const reset = () => {
  rows.clear();
  idSeq = 0;
};

export const enqueued: Array<{ queue: string; jobName: string; data: any; opts: any }> = [];
export const queueAvailable = { value: true };

export const resetEnqueued = () => {
  enqueued.length = 0;
  queueAvailable.value = true;
};

const mapKey = (queue: string, jobId: string) => `${queue}:${jobId}`;
const byId = (id: string) => [...rows.values()].find((r) => r.id === id);

const asyncFn = (impl: (...args: any[]) => any) => vi.fn(impl) as any;

const matchesDate = (value: Date, filter: { lt?: Date; gt?: Date } | undefined): boolean => {
  if (!filter) return true;
  if (filter.lt && !(value.getTime() < filter.lt.getTime())) return false;
  if (filter.gt && !(value.getTime() > filter.gt.getTime())) return false;
  return true;
};

/**
 * Only the filters the service actually builds, so an unsupported clause fails
 * the test rather than silently matching everything.
 */
const matches = (row: FailedJobRow, where: any): boolean => {
  if (!where) return true;
  if (where.status) {
    const wanted = where.status.in ?? [where.status];
    if (!wanted.includes(row.status)) return false;
  }
  if (where.queue && row.queue !== where.queue) return false;
  if (where.jobName && row.jobName !== where.jobName) return false;
  if (where.id && row.id !== where.id) return false;
  if (where.createdAt && !matchesDate(row.createdAt, where.createdAt)) return false;
  if (where.updatedAt && !matchesDate(row.updatedAt, where.updatedAt)) return false;
  if (where.OR && !where.OR.some((clause: any) => matches(row, clause))) return false;
  return true;
};

const applyData = (row: FailedJobRow, data: any) => {
  const next: Record<string, any> = { ...data };
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value && typeof value === 'object' && 'increment' in value) {
      next[key] = (row as any)[key] + value.increment;
    }
  }
  return next;
};

const selected = (where: any) => [...rows.values()].filter((r) => matches(r, where));

export const prisma = {
  failedJob: {
    upsert: asyncFn(async ({ where, create, update }: any) => {
      const unique = where.queue_jobId;
      const key = mapKey(unique.queue, unique.jobId);
      const existing = rows.get(key);

      if (existing) {
        Object.assign(existing, applyData(existing, update), { updatedAt: new Date() });
        return { ...existing };
      }

      const row: FailedJobRow = {
        id: `dj-${(idSeq += 1)}`,
        queue: create.queue,
        jobName: create.jobName,
        jobId: create.jobId,
        payload: create.payload ?? {},
        error: create.error ?? '',
        attemptsMade: create.attemptsMade ?? 0,
        replayCount: create.replayCount ?? 0,
        status: create.status ?? 'PENDING',
        lastErrorAt: create.lastErrorAt ?? new Date(),
        replayedAt: create.replayedAt ?? null,
        resolvedAt: create.resolvedAt ?? null,
        resolvedBy: create.resolvedBy ?? null,
        createdAt: create.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      rows.set(key, row);
      return { ...row };
    }),

    findUnique: asyncFn(async ({ where }: any) => {
      const row = byId(where.id);
      return row ? { ...row } : null;
    }),

    findMany: asyncFn(async ({ where, skip, take }: any) => {
      const all = selected(where);
      return all.slice(skip ?? 0, (skip ?? 0) + (take ?? all.length)).map((r) => ({ ...r }));
    }),

    count: asyncFn(async ({ where }: any) => selected(where).length),

    groupBy: asyncFn(async ({ by }: any) => {
      const key = by[0] as keyof FailedJobRow;
      const buckets = new Map<string, number>();
      for (const row of rows.values()) {
        const value = String(row[key]);
        buckets.set(value, (buckets.get(value) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
    }),

    update: asyncFn(async ({ where, data }: any) => {
      const row = byId(where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, applyData(row, data), { updatedAt: new Date() });
      return { ...row };
    }),

    updateMany: asyncFn(async ({ where, data }: any) => {
      const matches_ = selected(where);
      for (const row of matches_) {
        Object.assign(row, applyData(row, data), { updatedAt: new Date() });
      }
      return { count: matches_.length };
    }),

    delete: asyncFn(async ({ where }: any) => {
      const row = byId(where.id);
      if (!row) throw new Error('not found');
      rows.delete(mapKey(row.queue, row.jobId));
      return { ...row };
    }),

    deleteMany: asyncFn(async ({ where }: any) => {
      const doomed = selected(where);
      for (const row of doomed) rows.delete(mapKey(row.queue, row.jobId));
      return { count: doomed.length };
    }),
  },
};
