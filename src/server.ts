import http from 'http';
import { createApp } from './app';
import { SERVER, APP } from './config/app.config';
import { logger } from './services/logger.service';
import { disconnectPrisma, isDatabaseHealthy } from './services/prisma.service';
import { disconnectRedis, isRedisAvailable, isRedisHealthy } from './services/redis.service';
import { closeQueues } from './jobs/queues';
import { stopWorkers } from './jobs/workers';
import { stopCronJobs } from './jobs/cron';
import { initSocket, closeSocket } from './services/socket.service';
import { startWorkers } from './jobs/workers';
import { startCronJobs } from './jobs/cron';
import { encryptionBootWarning } from './config/encryption.config';
import { ENV } from './config/env.config';

const start = async (): Promise<void> => {
  const app = createApp();
  const server = http.createServer(app);

  initSocket(server);
  startWorkers();
  await startCronJobs();

  server.listen(SERVER.PORT, SERVER.HOST, async () => {
    /**
     * `isRedisAvailable` only means REDIS_URL is set, so ping for real — a configured-but-dead
     * Redis must not be reported as connected.
     */
    const [dbOk, redisOk] = await Promise.all([
      isDatabaseHealthy(),
      isRedisAvailable ? isRedisHealthy() : Promise.resolve(false),
    ]);

    logger.info(
      {
        port: SERVER.PORT,
        env: SERVER.NODE_ENV,
        apiPrefix: APP.API_PREFIX,
        docs: `${APP.API_PREFIX}/docs`,
        health: `${APP.API_PREFIX}/health`,
        database: dbOk ? 'connected' : 'unreachable',
        redis: !isRedisAvailable ? 'disabled' : redisOk ? 'connected' : 'unreachable',
        workers: ENV.WORKER_ENABLED ? 'enabled' : 'disabled',
      },
      `[${APP.NAME}] API listening on ${SERVER.HOST}:${SERVER.PORT}`,
    );

    if (!dbOk) {
      logger.error('[server] DATABASE_URL is unreachable — every DB-backed route will 500');
    }
    if (isRedisAvailable && !redisOk) {
      logger.error('[server] REDIS_URL is unreachable — queues, cron and rate limiting degrade');
    }

    const warn = encryptionBootWarning();
    if (warn) logger.warn(warn);
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '[server] graceful shutdown started');

    const forceTimer = setTimeout(() => {
      logger.error('[server] forced exit after shutdown timeout');
      process.exit(1);
    }, APP.SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      logger.info('[server] http server closed');

      await closeSocket();
      await stopCronJobs();
      await stopWorkers();
      await closeQueues();
      await disconnectRedis();
      await disconnectPrisma();

      logger.info('[server] graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: (err as Error)?.message }, '[server] shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, '[process] unhandled rejection');
    void shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err?.message, stack: err?.stack }, '[process] uncaught exception');
    void shutdown('uncaughtException');
  });
};

start().catch((err) => {
  logger.fatal({ err: err?.message, stack: err?.stack }, '[server] failed to start');
  process.exit(1);
});
