import { Router } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { APP } from '../../config/app.config';
import { ENV } from '../../config/env.config';
import { HEALTH_STATUS } from '../../constants/statuses';
import { D } from '../../utils/defaults';
import { isDatabaseHealthy, databaseLatencyMs } from '../../services/prisma.service';
import { isRedisHealthy, isRedisAvailable } from '../../services/redis.service';
import { getActiveWorkerCount } from '../../jobs/workers';
import { QUEUE_ALL, QueueName } from '../../config/socket.config';
import { getJobStatus } from '../../jobs/queues';
import { asyncHandler } from '../../utils/asyncHandler';
import { z } from 'zod';
import { validate } from '../../middlewares/validate.middleware';
import { VALIDATION } from '../../messages/validation';

/** GET /health/jobs/:jobId */
const jobIdParamSchema = z
  .object({ jobId: z.string().trim().min(4, VALIDATION.REQUIRED('jobId')).max(64) })
  .strict();

const router = Router();

const startedAt = Date.now();

const baseResult = () => ({
  timestamp: new Date().toISOString(),
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
});

/**
 * GET /api/v1/health — Render uptime probe.
 * No auth, no DB, no Redis: always answers.
 */
router.get('/', (_req, res) =>
  ApiResponse.success(res, {
    message: SUCCESS.SYSTEM.HEALTH_OK,
    result: {
      status: HEALTH_STATUS.UP,
      service: APP.SERVER_NAME,
      version: APP.VERSION,
      environment: D.str(ENV.NODE_ENV),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    },
  }),
);

router.get(
  '/db',
  asyncHandler(async (_req, res) => {
    const [healthy, latency] = await Promise.all([isDatabaseHealthy(), databaseLatencyMs()]);
    return ApiResponse.success(res, {
      message: healthy ? SUCCESS.SYSTEM.HEALTH_OK : SUCCESS.SYSTEM.DATABASE_UNREACHABLE,
      result: {
        ...baseResult(),
        database: healthy ? HEALTH_STATUS.UP : HEALTH_STATUS.DOWN,
        latencyMs: latency < 0 ? 0 : latency,
      },
    });
  }),
);

router.get(
  '/redis',
  asyncHandler(async (_req, res) => {
    const configured = isRedisAvailable;
    const healthy = configured ? await isRedisHealthy() : false;
    return ApiResponse.success(res, {
      message: healthy ? SUCCESS.SYSTEM.HEALTH_OK : SUCCESS.SYSTEM.REDIS_UNAVAILABLE,
      result: {
        ...baseResult(),
        redis: !configured
          ? HEALTH_STATUS.NOT_CONFIGURED
          : healthy
            ? HEALTH_STATUS.UP
            : HEALTH_STATUS.DOWN,
      },
    });
  }),
);

router.get(
  '/queue',
  asyncHandler(async (_req, res) => {
    const { getQueueConnection } = await import('../../jobs/queues');
    const connection = getQueueConnection();
    const queueList = await Promise.all(
      QUEUE_ALL.map(async (name: QueueName) => {
        try {
          const { getQueue } = await import('../../jobs/queues');
          const queue = getQueue(name);
          if (!queue) {
            return {
              name,
              status: HEALTH_STATUS.DISABLED,
              waiting: 0,
              active: 0,
              completed: 0,
              failed: 0,
            };
          }
          const counts = (await queue.getJobCounts()) as Record<string, number>;
          return {
            name,
            status: HEALTH_STATUS.UP,
            waiting: counts.wait ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
          };
        } catch {
          return {
            name,
            status: HEALTH_STATUS.DOWN,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
          };
        }
      }),
    );

    const healthy = Boolean(connection);
    return ApiResponse.success(res, {
      message: healthy ? SUCCESS.SYSTEM.HEALTH_OK : SUCCESS.SYSTEM.QUEUE_UNAVAILABLE,
      result: {
        ...baseResult(),
        queue: healthy ? HEALTH_STATUS.UP : HEALTH_STATUS.DISABLED,
        workerCount: getActiveWorkerCount(),
        queueList,
      },
    });
  }),
);

router.get(
  '/jobs/:jobId',
  validate({ params: jobIdParamSchema }),
  asyncHandler(async (req, res) =>
    ApiResponse.success(res, {
      message: SUCCESS.BULK.STATUS_FETCHED,
      result: await getJobStatus(req.params.jobId),
    }),
  ),
);

export default router;
