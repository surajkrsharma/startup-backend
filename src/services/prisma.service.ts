import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger.service';
import { OPS } from '../config/app.config';

export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
});

prisma.$on('error' as any, (err: any) => {
  logger.error({ err: err?.message }, '[prisma] error');
});

const SERIALISE = process.env.PGLITE_MODE === 'true';

let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
  if (!SERIALISE) return run();

  const result = queue.then(run, run);

  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const QUERY_METHOD =
  /^(find|create|update|delete|upsert|aggregate|count|groupBy|executeRaw|queryRaw)/;

if (SERIALISE) {
  const root = prisma as unknown as Record<string, any>;

  for (const name of Object.keys(root)) {
    if (name.startsWith('$') || name.startsWith('_')) continue;

    const delegate = root[name];
    if (!delegate || typeof delegate !== 'object') continue;

    for (const method of Object.getOwnPropertyNames(delegate)) {
      if (!QUERY_METHOD.test(method)) continue;

      const descriptor = Object.getOwnPropertyDescriptor(delegate, method);
      const original = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (typeof original !== 'function') continue;

      Object.defineProperty(delegate, method, {
        ...descriptor,
        value: (...args: unknown[]) => enqueue(() => original.apply(delegate, args)),
        writable: true,
        configurable: true,
      });
    }
  }

  logger.info('[prisma] PGlite serialise mode enabled');
}

export const serialise = <T>(run: () => Promise<T>): Promise<T> => enqueue(run);

export type Tx = Prisma.TransactionClient;
export type TxClient = Prisma.TransactionClient | typeof prisma;

export const prismaTypes = Prisma;

export const disconnectPrisma = async (): Promise<void> => {
  await prisma.$disconnect();
};

export const isDatabaseHealthy = async (): Promise<boolean> => {
  try {
    await enqueue(() => prisma.$queryRaw`SELECT 1`);
    return true;
  } catch {
    return false;
  }
};

export const databaseLatencyMs = async (): Promise<number> => {
  const started = Date.now();
  try {
    await enqueue(() => prisma.$queryRaw`SELECT 1`);
    return Date.now() - started;
  } catch {
    return -1;
  }
};

export const PRISMA_ERROR_MAP: Record<string, { status: number; code: string }> = {
  P2000: { status: 400, code: 'VALIDATION_ERROR' },
  P2001: { status: 404, code: 'NOT_FOUND' },
  P2002: { status: 409, code: 'DUPLICATE' },
  P2003: { status: 400, code: 'FOREIGN_KEY_CONSTRAINT' },
  P2011: { status: 400, code: 'NULL_CONSTRAINT' },
  P2025: { status: 404, code: 'NOT_FOUND' },
  P2034: { status: 409, code: 'TRANSACTION_CONFLICT' },
};

export const mapPrismaError = (err: unknown): { status: number; code: string } | null => {
  const code = (err as any)?.code as string | undefined;
  if (code && PRISMA_ERROR_MAP[code]) return PRISMA_ERROR_MAP[code];
  return null;
};

export const withTransaction = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => fn(tx), {
    maxWait: OPS.TX_MAX_WAIT_MS,
    timeout: OPS.TX_TIMEOUT_MS,
  });
