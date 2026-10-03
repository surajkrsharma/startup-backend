/**
 * Loads .env before Prisma reads DATABASE_URL. `dotenv/config` is idempotent, so this is safe
 * even when env.config has already loaded it — and it guarantees DATABASE_URL exists for any
 * entry point that imports this file directly (scripts, workers, cron), not just through the
 * app's import chain.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from './logger.service';

/**
 * Prisma reads DATABASE_URL from the environment itself. We deliberately do not
 * pass `datasources` here: doing so would evaluate `process.env.DATABASE_URL`
 * at import time, before dotenv has run in some entry points (scripts, workers).
 */
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

// ─────────────────────────────────────────────────────────────────────────────
//  Single-connection serialisation (local PGlite only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The PGlite TCP bridge serves exactly one connection, so two overlapping
 * queries fail with "Can't reach database server". In that mode only, every model
 * query is funnelled through a promise chain.
 *
 * Production PostgreSQL is unaffected: this is a no-op unless PGLITE_MODE=true.
 */
const SERIALISE = process.env.PGLITE_MODE === 'true';

let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
  if (!SERIALISE) return run();

  const result = queue.then(run, run);
  // Keep the chain alive even when a query rejects.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

/** Model delegate methods that must be serialised. */
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

/** Runs work through the serialise queue (a direct call outside PGlite mode). */
export const serialise = <T>(run: () => Promise<T>): Promise<T> => enqueue(run);

export type Tx = Prisma.TransactionClient;
export type TxClient = Prisma.TransactionClient | typeof prisma;

export const prismaTypes = Prisma;

/** Disconnects cleanly on SIGTERM. */
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

/**
 * Prisma error codes mapped to HTTP semantics.
 * P2002 -> 409 duplicate, P2025 -> 404 not found, P2034 -> 409 transaction conflict.
 */
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

/** Wraps a unit of work in a transaction with bounded wait/timeout. */
export const withTransaction = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => fn(tx), { maxWait: 5000, timeout: 15000 });
