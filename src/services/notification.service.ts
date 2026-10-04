import { prisma } from './prisma.service';
import { emitToUser } from './socket.service';
import { SOCKET } from '../config/socket.config';
import { enqueueNotification } from '../jobs/queues';
import { D } from '../utils/defaults';
import { NotificationType } from '../constants/roles';
import { NotificationChannelType } from '../constants/tracking';
import { sendMail } from './email.service';
import { TRACKING_EVENT, TRACKING_EVENT_VALUES } from '../constants/tracking';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { ERROR } from '../messages/error';
import { AppError } from '../utils/AppError';

export interface NotifyInput {
  userId: string;
  type?: NotificationType;
  channel?: NotificationChannelType;
  title: string;
  body: string;
  image?: string;
  data?: Record<string, any>;
}

export const notifyUser = async (input: NotifyInput): Promise<string> => {
  try {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: (input.type ?? 'SYSTEM') as any,
        channel: (input.channel ?? 'IN_APP') as any,
        title: D.str(input.title),
        body: D.str(input.body),
        image: D.str(input.image),
        data: (input.data ?? {}) as any,
        isRead: false,
      },
      select: { id: true, createdAt: true },
    });

    emitToUser(input.userId, SOCKET.EVENTS.NOTIFICATION_NEW, {
      notificationId: row.id,
      title: input.title,
      body: input.body,
      type: input.type ?? 'SYSTEM',
      data: input.data ?? {},
      createdAt: row.createdAt,
    });

    return row.id;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notification] create failed', (err as Error)?.message);
    return '';
  }
};

export const notifyUsers = async (
  userIds: string[],
  input: Omit<NotifyInput, 'userId'>,
): Promise<number> => {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const results = await Promise.all(unique.map((userId) => notifyUser({ ...input, userId })));
  return results.filter(Boolean).length;
};

export const sendMailNotification = async (input: {
  to: string;
  templateKey?: string;
  templateData?: Record<string, any>;
  subject?: string;
  html?: string;
  text?: string;
}): Promise<boolean> => {
  const result = await enqueueNotification('email', input);
  if (result.queued) return true;
  const sent = await sendMail(input);
  return sent.sent;
};

export const assertAllowedEvent = (eventName: string): string => {
  const value = D.str(eventName);
  if (!value || !TRACKING_EVENT_VALUES.includes(value)) {
    throw new AppError(
      ERROR.COMMON.VALIDATION_FAILED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.VALIDATION_ERROR,
    );
  }
  return value;
};

export const isKnownEvent = (eventName: string): boolean =>
  TRACKING_EVENT_VALUES.includes(D.str(eventName));

export { TRACKING_EVENT };
