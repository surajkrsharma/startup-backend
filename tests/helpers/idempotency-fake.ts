import { vi } from 'vitest';

export interface StoredRow {
  id: string;
  key: string;
  scope: string;
  userId: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: string | null;
  state: string;
  expiresAt: Date;
  updatedAt: Date;
}

export const rows = new Map<string, StoredRow>();

let idSeq = 0;

const duplicateError = () => {
  const e: any = new Error('duplicate');
  e.code = 'P2002';
  return e;
};

const mapKey = (where: any) => `${where.userId}:${where.key}`;

export const reset = () => {
  rows.clear();
  idSeq = 0;
};

const asyncFn = (impl: (...args: any[]) => any) => vi.fn(impl) as any;

export const prisma = {
  idempotencyKey: {
    findFirst: asyncFn(async ({ where }: any) => {
      const row = rows.get(mapKey(where));
      return row ? { ...row } : null;
    }),
    create: asyncFn(async ({ data }: any) => {
      const k = mapKey(data);
      if (rows.has(k)) throw duplicateError();
      const row: StoredRow = {
        id: `idem-${(idSeq += 1)}`,
        key: data.key,
        scope: data.scope ?? '',
        userId: data.userId ?? '',
        requestHash: data.requestHash ?? '',
        responseStatus: null,
        responseBody: null,
        state: data.state ?? 'IN_PROGRESS',
        expiresAt: data.expiresAt,
        updatedAt: new Date(),
      };
      rows.set(k, row);
      return { ...row };
    }),
    update: asyncFn(async ({ where, data }: any) => {
      const row = rows.get(mapKey(where));
      if (!row) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    updateMany: asyncFn(async ({ where, data }: any) => {
      const row = rows.get(mapKey(where));
      if (!row) return { count: 0 };
      if (where.state && row.state !== where.state) return { count: 0 };
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    deleteMany: asyncFn(async ({ where }: any) => {
      const row = rows.get(mapKey(where));
      if (!row) return { count: 0 };
      if (where.state && row.state !== where.state) return { count: 0 };
      rows.delete(mapKey(where));
      return { count: 1 };
    }),
  },
};
