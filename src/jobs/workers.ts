import { Worker, Job } from 'bullmq';
import { prisma } from '../services/prisma.service';
import { sendMail } from '../services/email.service';
import { notifyUser, notifyUsers } from '../services/notification.service';
import { logger, moduleLogger } from '../services/logger.service';
import { getQueueConnection } from './queues';
import { isExhausted, recordFailedJob, pruneFailedJobs } from './deadletter.service';
import { QUEUE, JOB, JobName, QueueName } from '../config/socket.config';
import { QUEUE_POLICY } from '../config/queue.config';
import { ENV } from '../config/env.config';
import { OPS } from '../config/app.config';
import { money } from '../utils/calculations';
import { D } from '../utils/defaults';
import { toDayKey, subtractDays } from '../utils/dates';
import { emitToAdmins, emitToUser } from '../services/socket.service';
import { SOCKET } from '../config/socket.config';
import { ORDER_STATUS } from '../constants/statuses';
import { PAYOUT_STATUS, PAYMENT_STATUS, VENDOR_STATUS } from '../constants/roles';
import { generatePayoutStatementPdf } from '../services/pdf.service';
import { ANALYTICS } from '../config/analytics.config';
import { scanPriceDrops } from '../modules/cart/cart.service';
import { liftExpiredBans, refreshCustomerSegments } from '../modules/user/user.service';

const log = moduleLogger('jobs');
const workers: Worker[] = [];

const register = (name: QueueName, jobName: JobName, handler: (data: any) => Promise<any>) => {
  const connection = getQueueConnection();
  if (!connection) return;

  const worker = new Worker(
    name,
    async (job: Job) => {
      try {
        return await handler(job.data);
      } catch (err) {
        log.error({ err: (err as Error)?.message, jobName, jobId: job.id }, '[worker] job failed');
        throw err;
      }
    },
    {
      connection,
      prefix: `${ENV.QUEUE_PREFIX}:bull`,
      concurrency: QUEUE_POLICY.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    log.error(
      { err: err?.message, jobId: job?.id, attempts: job?.attemptsMade },
      '[worker] failed',
    );
    if (!job) return;
    if (!isExhausted(job.attemptsMade, job.opts?.attempts)) return;

    void recordFailedJob({
      queue: name,
      jobName: job.name,
      jobId: D.str(job.id),
      payload: (job.data ?? {}) as Record<string, any>,
      error: err?.message ?? '',
      attemptsMade: job.attemptsMade,
    });
  });
  worker.on('completed', (job) =>
    log.debug({ jobId: job.id, jobName: job.name }, '[worker] completed'),
  );

  workers.push(worker);
};

register(QUEUE.EMAIL, JOB.SEND_EMAIL, async (data) => sendMail(data));

register(QUEUE.NOTIFICATION, JOB.SEND_NOTIFICATION, async (data) => {
  if (data.channel === 'email') return sendMail(data);
  if (data.channel === 'inApp' && data.userId) {
    return notifyUser({
      userId: D.str(data.userId),
      title: D.str(data.title),
      body: D.str(data.body),
      type: data.type,
      data: data.meta,
    });
  }
  return { skipped: true };
});

register(QUEUE.NOTIFICATION, JOB.NOTIFICATION_BLAST, async (data) => {
  const userIds: string[] = Array.isArray(data.userIds) ? data.userIds : [];

  const resolved =
    userIds.length > 0
      ? userIds
      : (
          await prisma.user.findMany({
            where: {
              isActive: true,
              deletedAt: null,
              ...(data.segment?.role ? { role: data.segment.role } : {}),
            },
            select: { id: true },
            take: 100_000,
          })
        ).map((u) => u.id);

  const sent = await notifyUsers(resolved, {
    title: D.str(data.title),
    body: D.str(data.body),
    type: data.type,
  });

  emitToAdmins(SOCKET.EVENTS.NOTIFICATION_NEW, {
    blast: true,
    title: data.title,
    recipients: resolved.length,
    sent,
  });

  return { recipients: resolved.length, sent };
});

register(QUEUE.NOTIFICATION, JOB.TOKEN_BALANCE_REMINDER, async () => {
  const now = new Date();
  const orders = await prisma.order.findMany({
    where: {
      tokenRequired: true,
      tokenPaid: true,
      balancePaid: false,
      isCancelled: false,
      status: { in: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.SHIPPED, ORDER_STATUS.OUT_FOR_DELIVERY] },
    },
    select: {
      id: true,
      orderNumber: true,
      userId: true,
      balanceAmount: true,
      balanceDueDays: true,
      createdAt: true,
    },
    take: OPS.JOB_BATCH_SIZE,
  });

  let reminded = 0;
  for (const order of orders) {
    const dueAt = new Date(order.createdAt).getTime() + (order.balanceDueDays || 7) * 86400000;
    const hoursLeft = (dueAt - now.getTime()) / 3600000;
    if (hoursLeft <= 72 && hoursLeft > 0) {
      await notifyUser({
        userId: order.userId,
        type: 'PAYMENT',
        title: `Balance due for ${order.orderNumber}`,
        body: `Balance of ${order.balanceAmount} is due soon.`,
        data: { orderId: order.id, balanceAmount: order.balanceAmount },
      });
      emitToUser(order.userId, SOCKET.EVENTS.ORDER_STATUS, {
        orderId: order.id,
        event: 'balance_due',
        balanceAmount: order.balanceAmount,
      });
      reminded += 1;
    }
  }

  return { reminded };
});

register(QUEUE.ORDER_STATUS, JOB.ROLLUP_ORDER_STATUS, async (data) => {
  const order = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { id: true, userId: true, orderNumber: true, status: true },
  });
  if (!order) return { skipped: true };

  emitToUser(order.userId, SOCKET.EVENTS.ORDER_STATUS, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: data.status,
  });

  return { rolledUp: true };
});

register(QUEUE.ORDER_STATUS, JOB.AUTO_CANCEL_UNPAID, async () => {
  const cutoff = new Date(Date.now() - 1440 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: { in: [ORDER_STATUS.PENDING, ORDER_STATUS.PENDING_TOKEN] },
      isCancelled: false,
      createdAt: { lt: cutoff },
    },
    select: { id: true, userId: true, orderNumber: true, subOrders: { select: { id: true } } },
    take: 500,
  });

  let cancelled = 0;
  for (const order of orders) {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: ORDER_STATUS.CANCELLED,
          isCancelled: true,
          cancelledAt: new Date(),
          cancelReason: 'Auto cancelled — payment not received',
        },
      }),
      prisma.subOrder.updateMany({
        where: { orderId: order.id },
        data: { status: ORDER_STATUS.CANCELLED, cancelReason: 'Auto cancelled' },
      }),

      ...(await buildStockRestores(order.id)),
    ]);
    cancelled += 1;
  }

  return { cancelled };
});

const buildStockRestores = async (orderId: string) => {
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { productId: true, variantId: true, qty: true },
  });

  return items.flatMap((item) => {
    const ops = [];
    if (item.variantId) {
      ops.push(
        prisma.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.qty } },
        }),
      );
    }
    ops.push(
      prisma.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.qty } },
      }),
    );
    return ops;
  });
};

register(QUEUE.PAYOUT, JOB.GENERATE_PAYOUT_CYCLE, async (data) => {
  const period = data.period ?? new Date().toISOString().slice(0, 10);
  const vendors = await prisma.vendorProfile.findMany({
    where: { status: VENDOR_STATUS.APPROVED, ...(data.vendorId ? { id: data.vendorId } : {}) },
    select: { id: true, shopName: true, payoutCycleDays: true },
  });

  let created = 0;
  for (const vendor of vendors) {
    const pending = await prisma.vendorEarning.aggregate({
      where: { vendorId: vendor.id, status: PAYOUT_STATUS.PENDING },
      _sum: { netAmount: true },
    });

    const amount = money(pending._sum.netAmount ?? 0);
    if (amount <= 0) continue;

    const exists = await prisma.payout.findFirst({
      where: {
        vendorId: vendor.id,
        period,
        status: { in: [PAYOUT_STATUS.PENDING, PAYOUT_STATUS.APPROVED] },
      },
      select: { id: true },
    });
    if (exists) continue;

    await prisma.$transaction([
      prisma.payout.create({
        data: {
          vendorId: vendor.id,
          amount,
          method: 'BANK',
          status: PAYOUT_STATUS.PENDING,
          period,
          notes: `Auto generated cycle (${vendor.payoutCycleDays || 7}d)`,
        },
      }),
      prisma.vendorEarning.updateMany({
        where: { vendorId: vendor.id, status: PAYOUT_STATUS.PENDING },
        data: { status: PAYOUT_STATUS.APPROVED, period },
      }),
    ]);

    created += 1;
  }

  return { period, created };
});

register(QUEUE.ANALYTICS, JOB.AGGREGATE_ANALYTICS, async (data) => {
  const target = data?.date ? new Date(data.date) : subtractDays(1);
  const dayKey = toDayKey(target);
  const start = new Date(dayKey);
  const end = new Date(dayKey.getTime() + 86400000 - 1);

  const [pageViews, visitors, sessions, orders, newUsers, crashes] = await Promise.all([
    prisma.pageView.count({ where: { createdAt: { gte: start, lte: end } } }),
    prisma.visitorLog.groupBy({
      by: ['sessionKey'],
      where: { createdAt: { gte: start, lte: end } },
    }),
    prisma.session.count({ where: { startedAt: { gte: start, lte: end } } }),
    prisma.order.aggregate({
      where: { createdAt: { gte: start, lte: end }, isCancelled: false },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { createdAt: { gte: start, lte: end }, deletedAt: null } }),
    prisma.crashLog.count({ where: { createdAt: { gte: start, lte: end } } }),
  ]);

  const uniqueVisitors = visitors.length;
  const deviceBreakdown = await prisma.pageView.groupBy({
    by: ['platform'],
    where: { createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });
  const events = await prisma.event.groupBy({
    by: ['name'],
    where: { createdAt: { gte: start, lte: end } },
    _count: { _all: true },
    orderBy: { _count: { name: 'desc' } },
    take: 50,
  });

  const completedSessions = await prisma.session.findMany({
    where: { startedAt: { gte: start, lte: end }, endedAt: { not: null } },
    select: { startedAt: true, endedAt: true },
    take: 1000,
  });

  const avgSessionDuration = completedSessions.length
    ? Math.round(
        completedSessions.reduce(
          (sum, s) => sum + ((s.endedAt?.getTime() ?? 0) - s.startedAt.getTime()),
          0,
        ) /
          completedSessions.length /
          1000,
      )
    : 0;

  const geoRows = await prisma.pageView.groupBy({
    by: ['deviceType'],
    where: { createdAt: { gte: start, lte: end } },
    _count: { _all: true },
  });

  const payload = {
    visitors: visitors.length,
    uniqueVisitors,
    pageViews,
    sessions,
    newUsers,
    orders: orders._count._all,
    revenue: money(orders._sum.total ?? 0),
    crashes,
    bounces: 0,
    avgSessionDuration,
    deviceBreakdown: deviceBreakdown.reduce<Record<string, number>>((acc, row) => {
      acc[D.str(row.platform) || 'WEB'] = row._count._all;
      return acc;
    }, {}),
    geoBreakdown: geoRows.reduce<Record<string, number>>((acc, row) => {
      acc[D.str(row.deviceType) || 'unknown'] = row._count._all;
      return acc;
    }, {}),
    trafficSources: events.reduce<Record<string, number>>((acc, row) => {
      acc[D.str(row.name)] = row._count._all;
      return acc;
    }, {}),
  };

  await prisma.analyticsDaily.upsert({
    where: { date: dayKey },
    create: { date: dayKey, ...payload },
    update: payload,
  });

  await prisma.crashLog.deleteMany({
    where: { createdAt: { lt: subtractDays(ANALYTICS.RETENTION_DAYS.RAW_EVENTS) } },
  });

  return payload;
});

register(QUEUE.REPORT, JOB.GENERATE_REPORT, async (data) => {
  if (D.str(data.type) === 'PAYOUT_STATEMENT' && data.vendorId) {
    const vendor = await prisma.vendorProfile.findUnique({ where: { id: data.vendorId } });
    if (!vendor) return { skipped: true };

    const earnings = await prisma.vendorEarning.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const gross = money(earnings.reduce((s, e) => s + e.amount, 0));
    const commission = money(earnings.reduce((s, e) => s + e.commission + e.platformFee, 0));
    const net = money(earnings.reduce((s, e) => s + e.netAmount, 0));

    const buffer = await generatePayoutStatementPdf(
      vendor,
      earnings.map((e) => ({
        period: D.str(e.period),
        orders: D.num(0),
        gross: money(e.amount),
        commission: money(e.commission + e.platformFee),
        net: money(e.netAmount),
      })),
      { gross, commission, net },
    );

    return { generated: true, bytes: buffer.length, gross, commission, net };
  }

  return { skipped: true };
});

register(QUEUE.CLEANUP, JOB.CLEANUP_EXPIRED, async () => {
  const now = new Date();

  const [refreshTokens, otps, sessions, idempotencyKeys] = await Promise.all([
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.session.updateMany({
      where: { isActive: true, lastSeenAt: { lt: subtractDays(2) } },
      data: { isActive: false, endedAt: now },
    }),
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  return {
    refreshTokens: refreshTokens.count,
    otps: otps.count,
    sessions: sessions.count,
    idempotencyKeys: idempotencyKeys.count,
  };
});

register(QUEUE.CLEANUP, JOB.PURGE_DELETED_ACCOUNTS, async () => {
  const purged = await prisma.user.deleteMany({
    where: { deletedAt: { not: null }, purgeAfter: { lte: new Date() } },
  });
  return { purged: purged.count };
});

register(QUEUE.NOTIFICATION, JOB.PRICE_DROP_SCAN, async () => {
  const { checked, notified } = await scanPriceDrops();
  return { checked, notified };
});

register(QUEUE.CLEANUP, JOB.PRUNE_FAILED_JOBS, async () => pruneFailedJobs());

register(QUEUE.CLEANUP, JOB.LIFT_EXPIRED_BANS, async () => {
  const lifted = await liftExpiredBans();
  return { lifted };
});

register(QUEUE.CLEANUP, JOB.REFRESH_CUSTOMER_SEGMENTS, async () => refreshCustomerSegments());

export const startWorkers = (): void => {
  if (!ENV.WORKER_ENABLED) {
    logger.warn('[jobs] WORKER_ENABLED=false — background workers not started');
    return;
  }
  if (!getQueueConnection()) {
    logger.warn('[jobs] REDIS_URL missing — background workers not started');
    return;
  }
  logger.info({ workers: workers.length }, '[jobs] workers started');
};

export const stopWorkers = async (): Promise<void> => {
  await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
  workers.length = 0;
};

export const getActiveWorkerCount = (): number => workers.length;
