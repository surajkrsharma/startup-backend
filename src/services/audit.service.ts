import { prisma } from './prisma.service';
import { logger } from './logger.service';
import { AdminAction } from '../constants/roles';
import { D } from '../utils/defaults';

export interface AuditInput {
  req?: any;
  actorId?: string;
  actorRole?: string;
  action: AdminAction;
  entity: string;
  entityId?: string;
  description?: string;
  changes?: Record<string, any>;
  meta?: Record<string, any>;
  impersonatedById?: string;
}

const fromRequest = (req: any, input: AuditInput) => ({
  actorId: input.actorId ?? req?.auth?.userId ?? undefined,
  actorRole: input.actorRole ?? req?.auth?.role ?? '',
  ip: D.str(req?.ip),
  userAgent: D.str(req?.headers?.['user-agent']),
  requestId: D.str(req?.id),
});

export const writeAuditLog = async (input: AuditInput): Promise<void> => {
  try {
    const ctx = fromRequest(input.req, input);
    await prisma.auditLog.create({
      data: {
        actorId: ctx.actorId,
        actorRole: ctx.actorRole,
        action: input.action,
        entity: input.entity,
        entityId: D.str(input.entityId),
        description: D.str(input.description),
        changes: (input.changes ?? {}) as any,
        meta: (input.meta ?? {}) as any,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        impersonatedById: input.impersonatedById,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error)?.message, entity: input.entity }, '[audit] write failed');
  }
};

export const writeActivityLog = async (input: {
  req?: any;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, any>;
}): Promise<void> => {
  try {
    await prisma.activityLog.create({
      data: {
        userId: input.userId ?? input.req?.auth?.userId ?? undefined,
        action: D.str(input.action),
        entity: D.str(input.entity),
        entityId: D.str(input.entityId),
        meta: (input.meta ?? {}) as any,
        ip: D.str(input.req?.ip),
        userAgent: D.str(input.req?.headers?.['user-agent']),
        deviceId: D.str(input.req?.deviceId),
        requestId: D.str(input.req?.id),
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[activity] write failed');
  }
};

export const diffChanges = (
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
): Record<string, { from: any; to: any }> => {
  const out: Record<string, { from: any; to: any }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  const SENSITIVE = ['passwordHash', 'password', 'token', 'secret', 'twoFactorSecret'];

  for (const key of keys) {
    if (SENSITIVE.includes(key)) continue;
    const from = (before as any)?.[key];
    const to = (after as any)?.[key];
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
      out[key] = { from: from ?? null, to: to ?? null };
    }
  }

  return out;
};
