import { QUEUE, QUEUE_ALL, JOB, CRON, QueueName } from '../config/socket.config';
import { getQueue } from './queues';
import { logger, moduleLogger } from '../services/logger.service';
import { ENV } from '../config/env.config';

const log = moduleLogger('cron');

export interface CronDefinition {
  name: string;
  queue: QueueName;
  job: string;
  cron: string;
  description: string;
}

export const CRON_JOB_LIST: CronDefinition[] = [
  {
    name: 'analytics-rollup',
    queue: QUEUE.ANALYTICS,
    job: JOB.AGGREGATE_ANALYTICS,
    cron: CRON.ANALYTICS_ROLLUP,
    description: 'Nightly analytics aggregation from raw events into AnalyticsDaily',
  },
  {
    name: 'payout-cycle',
    queue: QUEUE.PAYOUT,
    job: JOB.GENERATE_PAYOUT_CYCLE,
    cron: CRON.PAYOUT_CYCLE,
    description: 'Generate vendor payout cycles from pending earnings',
  },
  {
    name: 'auto-cancel-unpaid',
    queue: QUEUE.ORDER_STATUS,
    job: JOB.AUTO_CANCEL_UNPAID,
    cron: CRON.AUTO_CANCEL_UNPAID,
    description: 'Cancel orders whose payment never arrived and restore stock',
  },
  {
    name: 'token-reminder',
    queue: QUEUE.NOTIFICATION,
    job: JOB.TOKEN_BALANCE_REMINDER,
    cron: CRON.TOKEN_REMINDER,
    description: 'Remind customers about an outstanding token-order balance',
  },
  {
    name: 'cleanup-expired',
    queue: QUEUE.CLEANUP,
    job: JOB.CLEANUP_EXPIRED,
    cron: CRON.CLEANUP_EXPIRED,
    description: 'Purge expired refresh tokens, OTPs and stale sessions',
  },
  {
    name: 'purge-deleted-accounts',
    queue: QUEUE.CLEANUP,
    job: JOB.PURGE_DELETED_ACCOUNTS,
    cron: CRON.PURGE_DELETED_ACCOUNTS,
    description: 'Delete accounts whose deletion recovery window has closed',
  },
  {
    name: 'price-drop-scan',
    queue: QUEUE.NOTIFICATION,
    job: JOB.PRICE_DROP_SCAN,
    cron: CRON.PRICE_DROP_SCAN,
    description: 'Compare watched product prices and notify on a drop',
  },
  {
    name: 'prune-failed-jobs',
    queue: QUEUE.CLEANUP,
    job: JOB.PRUNE_FAILED_JOBS,
    cron: CRON.PRUNE_FAILED_JOBS,
    description: 'Age out resolved and abandoned dead letter rows',
  },
];

export const startCronJobs = async (): Promise<number> => {
  if (!ENV.WORKER_ENABLED) {
    logger.warn('[cron] WORKER_ENABLED=false — scheduled jobs not registered');
    return 0;
  }

  let registered = 0;

  for (const definition of CRON_JOB_LIST) {
    const queue = getQueue(definition.queue);
    if (!queue) {
      logger.warn({ name: definition.name }, '[cron] queue unavailable — job not registered');
      continue;
    }

    try {
      const existing = (await queue.getRepeatableJobs().catch(() => [])) ?? [];
      for (const job of existing) {
        if (job.name !== definition.job) continue;
        if (!job.key) continue;
        await queue.removeRepeatableByKey(job.key).catch(() => undefined);
      }

      await queue.add(
        definition.job,
        {},
        {
          repeat: { pattern: definition.cron },
          jobId: definition.name,
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        },
      );

      registered += 1;
    } catch (err) {
      log.error(
        { err: (err as Error)?.message, name: definition.name },
        '[cron] registration failed',
      );
    }
  }

  if (registered > 0) logger.info({ registered }, '[cron] scheduled jobs registered');
  return registered;
};

export const stopCronJobs = async (): Promise<void> => {};

export const triggerCronJob = async (
  name: string,
): Promise<{ triggered: boolean; name: string }> => {
  const definition = CRON_JOB_LIST.find((d) => d.name === name);
  if (!definition) return { triggered: false, name };

  const queue = getQueue(definition.queue);
  if (!queue) return { triggered: false, name };

  try {
    await queue.add(
      definition.job,
      {},
      { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } },
    );
    return { triggered: true, name };
  } catch (err) {
    log.error({ err: (err as Error)?.message, name }, '[cron] manual trigger failed');
    return { triggered: false, name };
  }
};

export const listCronJobs = async (): Promise<
  Array<CronDefinition & { nextRunAt: string; isRegistered: boolean }>
> => {
  return Promise.all(
    CRON_JOB_LIST.map(async (definition) => {
      const queue = getQueue(definition.queue);
      let nextRunAt = '';
      let isRegistered = false;

      if (queue) {
        try {
          const repeatable = await queue.getRepeatableJobs();
          const match = repeatable.find((r) => r.name === definition.name);
          isRegistered = Boolean(match);
          nextRunAt = match?.next ? new Date(match.next).toISOString() : '';
        } catch {
          isRegistered = false;
          nextRunAt = '';
        }
      }

      return { ...definition, nextRunAt, isRegistered };
    }),
  );
};

export const getCronCount = (): number => CRON_JOB_LIST.length;
export { QUEUE_ALL };
