import { Prisma } from '@prisma/client';
import { prisma } from '../../services/prisma.service';
import { AppError } from '../../utils/AppError';
import { D } from '../../utils/defaults';
import { ERROR } from '../../messages/error';
import { ERROR_CODE } from '../../constants/http';
import { canTransitionTicket } from '../../constants/statuses';
import type { NotificationChannel, Platform, TicketPriority } from '@prisma/client';
import { notifyUsers, notifyUser } from '../../services/notification.service';
import { emitToConversation, emitToUser } from '../../services/socket.service';
import { SOCKET } from '../../config/socket.config';
import { OPS } from '../../config/app.config';
import { writeActivityLog } from '../../services/audit.service';
import { generateTicketNumber, uniqueTicketCategorySlug } from '../../utils/slug';

export const listNotifications = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number; unreadCount: number }> => {
  const where: Prisma.NotificationWhereInput = { userId };

  if (D.str(query.type)) where.type = query.type as any;
  if (D.str(query.channel)) where.channel = query.channel as NotificationChannel;
  if (D.str(query.isRead) === 'true') where.isRead = true;
  if (D.str(query.isRead) === 'false') where.isRead = false;

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { rows, total, unreadCount: unread };
};

export const getUnreadCount = async (
  userId: string,
): Promise<{ total: number; byType: Record<string, number> }> => {
  const grouped = await prisma.notification.groupBy({
    by: ['type'],
    where: { userId, isRead: false },
    _count: { _all: true },
  });

  const byType: Record<string, number> = {};
  let total = 0;

  for (const g of grouped) {
    const count = D.num(g._count._all);
    byType[D.str(g.type)] = count;
    total += count;
  }

  return { total, byType };
};

export const markRead = async (
  userId: string,
  ids: string[] | undefined,
  all = false,
): Promise<number> => {
  const where: Prisma.NotificationWhereInput = {
    userId,
    isRead: false,
    ...(all ? {} : { id: { in: D.arr(ids).map(String) } }),
  };

  const { count } = await prisma.notification.updateMany({
    where,
    data: { isRead: true, readAt: new Date() },
  });

  if (all) {
    emitToUser(userId, SOCKET.EVENTS.NOTIFICATION_READ_ALL, { count });
  } else if (count) {
    emitToUser(userId, SOCKET.EVENTS.NOTIFICATION_READ, { ids: D.arr(ids).map(String), count });
  }

  return count;
};

export const deleteNotification = async (userId: string, id: string): Promise<void> => {
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.NOTIFICATION.NOT_FOUND);

  await prisma.notification.delete({ where: { id: existing.id } });
};

export const getPreferences = async (userId: string): Promise<any[]> =>
  prisma.notificationPreference.findMany({
    where: { userId },
    orderBy: [{ channel: 'asc' }, { eventType: 'asc' }],
  });

export const setPreferences = async (
  userId: string,
  preferences: { channel: string; eventType: string; isEnabled: boolean }[],
): Promise<number> => {
  await prisma.$transaction(
    preferences.map((p) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_channel_eventType: { userId, channel: p.channel as any, eventType: p.eventType },
        },
        create: {
          userId,
          channel: p.channel as any,
          eventType: D.str(p.eventType),
          isEnabled: p.isEnabled,
        },
        update: { isEnabled: p.isEnabled },
      }),
    ),
  );

  return preferences.length;
};

export const broadcast = async (input: {
  userIds?: string[];
  toAll?: boolean;
  type?: string;
  channel?: string;
  title: string;
  body?: string;
  data?: Record<string, any>;
}): Promise<number> => {
  const targets = D.arr(input.userIds).map(String);

  if (D.bool(input.toAll)) {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true },
      take: OPS.JOB_BATCH_SIZE,
    });
    return notifyUsers(
      users.map((u) => u.id),
      {
        type: D.str(input.type) as any,
        channel: D.str(input.channel) as any,
        title: input.title,
        body: D.str(input.body),
        data: input.data ?? {},
      },
    );
  }

  return notifyUsers(targets, {
    type: D.str(input.type) as any,
    channel: D.str(input.channel) as any,
    title: input.title,
    body: D.str(input.body),
    data: input.data ?? {},
  });
};

const CONVERSATION_INCLUDE = {
  participants: {
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      vendor: { select: { id: true, shopName: true, slug: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
  },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

const loadConversation = async (
  conversationId: string,
  userId: string,
): Promise<ConversationRow> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: CONVERSATION_INCLUDE,
  });

  if (!conversation) throw AppError.notFound(ERROR.CHAT.NOT_FOUND);

  const isParticipant = D.arr(conversation.participants).some(
    (p: any) => D.str(p.userId) === userId,
  );

  if (!isParticipant) throw AppError.notFound(ERROR.CHAT.NOT_FOUND);

  return conversation as ConversationRow;
};

const assertNotBlocked = async (senderId: string, receiverId: string): Promise<void> => {
  const blocked = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: senderId, blockedId: receiverId },
        { blockerId: receiverId, blockedId: senderId },
      ],
    },
    select: { blockerId: true },
  });

  if (blocked) {
    throw blocked.blockerId === senderId
      ? AppError.forbidden(ERROR.CHAT.USER_BLOCKED, ERROR_CODE.USER_BLOCKED)
      : AppError.forbidden(ERROR.CHAT.BLOCKED_BY_USER, ERROR_CODE.USER_BLOCKED);
  }
};

export const startConversation = async (
  userId: string,
  input: { vendorId: string; message: string },
  req?: any,
): Promise<{ conversation: any; message: any }> => {
  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: D.str(input.vendorId) },
    select: { id: true, userId: true, status: true },
  });

  if (!vendor) throw AppError.notFound(ERROR.VENDOR.NOT_FOUND);

  if (vendor.userId === userId) {
    throw AppError.unprocessable(ERROR.CHAT.SELF_CHAT);
  }

  await assertNotBlocked(userId, vendor.userId);

  const conversationId = await prisma.$transaction(async (tx) => {
    const existing = await tx.conversationParticipant.findFirst({
      where: {
        userId,
        conversation: {
          isActive: true,
          participants: { some: { vendorId: vendor.id } },
        },
      },
      select: { conversationId: true },
    });

    let id = existing?.conversationId;

    if (!id) {
      const created = await tx.conversation.create({
        data: {
          participants: {
            create: [
              { userId, lastReadAt: new Date() },
              { userId: vendor.userId, vendorId: vendor.id },
            ],
          },
        },
        select: { id: true },
      });

      id = created.id;
    }

    const message = await tx.message.create({
      data: {
        conversationId: id,
        senderId: userId,
        body: D.str(input.message),
      },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
    });

    await tx.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
    });

    await tx.conversationParticipant.updateMany({
      where: { conversationId: id, userId },
      data: { lastReadAt: new Date() },
    });

    void message;

    return id;
  });

  const conversation = await loadConversation(conversationId, userId);

  const firstMessage = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
  });

  emitToConversation(conversationId, SOCKET.EVENTS.CHAT_NEW, {
    conversationId,
    messageId: firstMessage?.id,
  });
  emitToUser(vendor.userId, SOCKET.EVENTS.CHAT_CONVERSATION, {
    conversationId,
    vendorId: vendor.id,
  });

  void writeActivityLog({
    req,
    userId,
    action: 'CHAT_STARTED',
    entity: 'Conversation',
    entityId: conversationId,
  });

  return { conversation, message: firstMessage };
};

export const listConversations = async (
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: ConversationRow[]; total: number; unreadTotal: number }> => {
  const where: Prisma.ConversationParticipantWhereInput = { userId };

  if (D.str(query.isArchived) === 'true') where.isArchived = true;
  if (D.str(query.isArchived) === 'false') where.isArchived = false;

  const [rows, total] = await Promise.all([
    prisma.conversationParticipant.findMany({
      where,
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      skip: D.num(query.skip),
      take: D.num(query.take),
      include: { conversation: { include: CONVERSATION_INCLUDE } },
    }),
    prisma.conversationParticipant.count({ where }),
  ]);

  const unreadTotal = await prisma.conversationParticipant
    .aggregate({
      where: { userId, isArchived: false },
      _count: { _all: true },
    })
    .then(async () => {
      const parts = await prisma.conversationParticipant.findMany({
        where: { userId },
        include: {
          conversation: {
            include: { messages: { where: { isRead: false }, select: { senderId: true } } },
          },
        },
      });

      return parts.filter((p) =>
        D.arr(p.conversation.messages).some((m: any) => D.str(m.senderId) !== userId),
      ).length;
    });

  void unreadTotal;

  const withUnread = await Promise.all(
    rows.map(async (row) => {
      const unread = await prisma.message.count({
        where: { conversationId: row.conversationId, isRead: false, senderId: { not: userId } },
      });

      return { ...(row.conversation as ConversationRow), unreadCount: unread };
    }),
  );

  const unreadCounts: number[] = await Promise.all(
    (
      await prisma.conversationParticipant.findMany({
        where: { userId, isArchived: false },
        select: { conversationId: true },
      })
    ).map(async (p) => {
      const count = await prisma.message.count({
        where: { conversationId: p.conversationId, isRead: false, senderId: { not: userId } },
      });
      return count > 0 ? 1 : 0;
    }),
  );

  return { rows: withUnread, total, unreadTotal: unreadCounts.reduce((s, c) => s + c, 0) };
};

export const getMessages = async (
  conversationId: string,
  userId: string,
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  await loadConversation(conversationId, userId);

  const where: Prisma.MessageWhereInput = { conversationId };

  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.message.count({ where }),
  ]);

  return { rows, total };
};

export const sendMessage = async (
  conversationId: string,
  userId: string,
  input: { body: string; attachments?: string[] },
  req?: any,
): Promise<any> => {
  const conversation = await loadConversation(conversationId, userId);

  if (!conversation.isActive) {
    throw AppError.unprocessable(ERROR.CHAT.CLOSED);
  }

  const others = D.arr(conversation.participants).filter((p: any) => D.str(p.userId) !== userId);

  for (const other of others) {
    await assertNotBlocked(userId, D.str(other.userId));
  }

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: userId,
      body: D.str(input.body),
      attachments: D.arr(input.attachments).map(String),
    },
    include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  emitToConversation(conversationId, SOCKET.EVENTS.CHAT_NEW, {
    conversationId,
    messageId: message.id,
  });

  for (const other of others) {
    emitToUser(D.str(other.userId), SOCKET.EVENTS.CHAT_NEW, {
      conversationId,
      messageId: message.id,
    });
  }

  void writeActivityLog({
    req,
    userId,
    action: 'CHAT_MESSAGE_SENT',
    entity: 'Message',
    entityId: message.id,
  });

  return message;
};

export const markConversationRead = async (
  conversationId: string,
  userId: string,
  lastReadAt?: string,
): Promise<number> => {
  await loadConversation(conversationId, userId);

  const at = lastReadAt ? new Date(D.str(lastReadAt)) : new Date();

  const { count } = await prisma.message.updateMany({
    where: {
      conversationId,
      isRead: false,
      senderId: { not: userId },
      createdAt: { lte: at },
    },
    data: { isRead: true, readAt: at },
  });

  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId },
    data: { lastReadAt: at },
  });

  emitToConversation(conversationId, SOCKET.EVENTS.CHAT_READ, { conversationId, userId, at });

  return count;
};

export const deleteMessage = async (
  messageId: string,
  userId: string,
  isAdmin = false,
): Promise<void> => {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, senderId: true },
  });

  if (!message) throw AppError.notFound(ERROR.CHAT.MESSAGE_NOT_FOUND);

  if (message.senderId !== userId && !isAdmin) {
    throw AppError.notFound(ERROR.CHAT.MESSAGE_NOT_FOUND);
  }

  await prisma.message.delete({ where: { id: message.id } });
};

export const blockUser = async (
  userId: string,
  targetId: string,
  reason?: string,
  req?: any,
): Promise<void> => {
  if (userId === targetId) {
    throw AppError.unprocessable(ERROR.CHAT.SELF_BLOCK);
  }

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });

  if (!target) throw AppError.notFound(ERROR.USER.NOT_FOUND);

  await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
    create: { blockerId: userId, blockedId: targetId, reason: D.str(reason) },
    update: { reason: D.str(reason) },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'USER_BLOCKED',
    entity: 'User',
    entityId: targetId,
  });
};

export const unblockUser = async (userId: string, targetId: string): Promise<void> => {
  await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
};

export const listBlockedUsers = async (userId: string): Promise<any[]> =>
  prisma.userBlock.findMany({
    where: { blockerId: userId },
    include: { blocked: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' },
  });

export const getChatUnreadCount = async (userId: string): Promise<Record<string, number>> => {
  const parts = await prisma.conversationParticipant.findMany({
    where: { userId, isArchived: false },
    select: { conversationId: true },
  });

  let total = 0;

  for (const part of parts) {
    total += await prisma.message.count({
      where: { conversationId: part.conversationId, isRead: false, senderId: { not: userId } },
    });
  }

  return { total };
};

const TICKET_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true } },
  category: { select: { id: true, name: true, slug: true } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.TicketInclude;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

export const listTicketCategories = async (activeOnly = false): Promise<any[]> =>
  prisma.ticketCategory.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

export const createTicketCategory = async (input: {
  name: string;
  isActive?: boolean;
  sortOrder?: number;
}): Promise<any> => {
  const slug = await uniqueTicketCategorySlug(D.str(input.name));

  return prisma.ticketCategory.create({
    data: {
      name: D.str(input.name),
      slug,
      isActive: input.isActive !== false,
      sortOrder: D.num(input.sortOrder),
    },
  });
};

export const listTickets = async (
  query: Record<string, any>,
  userId?: string,
): Promise<{ rows: TicketRow[]; total: number }> => {
  const where: Prisma.TicketWhereInput = {};

  if (userId) where.userId = userId;
  if (D.str(query.status)) where.status = query.status as any;
  if (D.str(query.priority)) where.priority = query.priority as TicketPriority;
  if (D.str(query.categoryId)) where.categoryId = D.str(query.categoryId);
  if (D.str(query.assignedToId)) where.assignedToId = D.str(query.assignedToId);

  if (D.str(query.search)) {
    const term = D.str(query.search);
    where.OR = [
      { subject: { contains: term, mode: 'insensitive' } },
      { ticketNumber: { contains: term, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: { ...TICKET_INCLUDE, messages: undefined },
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.ticket.count({ where }),
  ]);

  const safe = rows.map((t: any) => ({ ...t, messages: [] }));

  return { rows: (userId ? safe : rows) as TicketRow[], total };
};

export const createTicket = async (
  userId: string,
  input: {
    subject: string;
    description?: string;
    categoryId?: string;
    priority?: string;
    attachments?: string[];
  },
  req?: any,
): Promise<TicketRow> => {
  if (D.str(input.categoryId)) {
    const category = await prisma.ticketCategory.findFirst({
      where: { id: D.str(input.categoryId), isActive: true },
      select: { id: true },
    });

    if (!category) throw AppError.notFound(ERROR.TICKET.CATEGORY_NOT_FOUND);
  }

  const row = await prisma.ticket.create({
    data: {
      ticketNumber: generateTicketNumber(),
      userId,
      categoryId: D.str(input.categoryId) || null,
      subject: D.str(input.subject),
      description: D.str(input.description),
      priority: (D.str(input.priority) || 'MEDIUM') as TicketPriority,
      attachments: D.arr(input.attachments).map(String),
      status: 'OPEN',

      messages: {
        create: {
          userId,
          message: D.str(input.description) || D.str(input.subject),
        },
      },
    },
    include: TICKET_INCLUDE,
  });

  void writeActivityLog({
    req,
    userId,
    action: 'TICKET_CREATED',
    entity: 'Ticket',
    entityId: row.id,
    meta: { ticketNumber: row.ticketNumber },
  });

  void notifyUser({
    userId,
    type: 'TICKET',
    title: `Support ticket ${row.ticketNumber} created`,
    body: 'Our team will get back to you shortly.',
    data: { ticketId: row.id },
  });

  return row as TicketRow;
};

export const getTicketById = async (
  ticketId: string,
  userId?: string,
  isStaff = false,
): Promise<TicketRow> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: TICKET_INCLUDE,
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  if (userId && ticket.userId !== userId) {
    throw AppError.notFound(ERROR.TICKET.NOT_FOUND);
  }

  if (!isStaff) {
    return {
      ...ticket,
      messages: D.arr(ticket.messages).filter((m: any) => !D.bool(m.isInternal)),
    } as TicketRow;
  }

  return ticket as TicketRow;
};

export const replyTicket = async (
  ticketId: string,
  userId: string,
  input: { message: string; isInternal?: boolean },
  isStaff = false,
  req?: any,
): Promise<any> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, userId: true, ticketNumber: true },
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  if (ticket.status === 'CLOSED') {
    throw AppError.unprocessable(ERROR.TICKET.CLOSED, ERROR_CODE.TICKET_CLOSED);
  }

  const isOwner = ticket.userId === userId;

  if (!isOwner && !isStaff) {
    throw AppError.forbidden(ERROR.PERMISSION.NOT_GRANTED);
  }

  const isInternal = D.bool(input.isInternal);

  if (isInternal && !isStaff) {
    throw AppError.forbidden(ERROR.TICKET.INTERNAL_NOTES_FORBIDDEN);
  }

  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      userId: isInternal ? null : userId,
      message: D.str(input.message),
      isInternal,
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (isStaff && !isInternal && ticket.status === 'OPEN') {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'IN_PROGRESS' } });
  }

  if (!isInternal) {
    void notifyUser({
      userId: ticket.userId,
      type: 'TICKET',
      title: `New reply on ${ticket.ticketNumber}`,
      body: D.str(input.message).slice(0, OPS.NOTIFICATION_BODY_MAX_CHARS),
      data: { ticketId: ticket.id },
    });
  }

  void writeActivityLog({
    req,
    userId,
    action: 'TICKET_REPLIED',
    entity: 'Ticket',
    entityId: ticket.id,
    meta: { isInternal },
  });

  return message;
};

export const updateTicketStatus = async (
  ticketId: string,
  status: string,
  remark?: string,
  isStaff = false,
  req?: any,
): Promise<TicketRow> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, userId: true, ticketNumber: true },
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  if (!isStaff) {
    if (ticket.userId === undefined) {
      throw AppError.forbidden(ERROR.PERMISSION.NOT_GRANTED);
    }

    if (status !== 'CLOSED') {
      throw AppError.forbidden(ERROR.TICKET.STATUS_ROLE_FORBIDDEN);
    }
  }

  if (!canTransitionTicket(ticket.status, status)) {
    throw AppError.unprocessable(
      `${ERROR.ORDER.INVALID_STATUS_TRANSITION} (${ticket.status} -> ${status})`,
      ERROR_CODE.INVALID_STATUS_TRANSITION,
    );
  }

  if (status === 'CLOSED' && ticket.status === 'CLOSED') {
    throw AppError.unprocessable(ERROR.TICKET.ALREADY_CLOSED);
  }

  const row = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      status: status as any,
      ...(status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
      ...(status === 'CLOSED' ? { closedAt: new Date() } : {}),
      ...(D.str(remark)
        ? { messages: { create: { userId: null, message: D.str(remark), isInternal: true } } }
        : {}),
    },
    include: TICKET_INCLUDE,
  });

  void writeActivityLog({
    req,
    action: 'TICKET_STATUS_UPDATED',
    entity: 'Ticket',
    entityId: ticket.id,
    meta: { from: ticket.status, to: status },
  });

  void notifyUser({
    userId: ticket.userId,
    type: 'TICKET',
    title: `Ticket ${ticket.ticketNumber} is now ${status.toLowerCase().replace('_', ' ')}`,
    body: D.str(remark),
    data: { ticketId: ticket.id },
  });

  return row as TicketRow;
};

export const assignTicket = async (
  ticketId: string,
  assignedToId: string,
  req?: any,
): Promise<TicketRow> => {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { id: true } });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  if (D.str(assignedToId)) {
    const agent = await prisma.user.findFirst({
      where: {
        id: D.str(assignedToId),
        role: { in: ['SUPER_ADMIN', 'SUB_ADMIN'] },
        isActive: true,
      },
      select: { id: true },
    });

    if (!agent) throw AppError.notFound(ERROR.TICKET.INVALID_ASSIGNEE);
  }

  const row = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { assignedToId: D.str(assignedToId) || null },
    include: TICKET_INCLUDE,
  });

  void writeActivityLog({
    req,
    action: 'TICKET_ASSIGNED',
    entity: 'Ticket',
    entityId: ticket.id,
    meta: { assignedToId },
  });

  return row as TicketRow;
};

export const getTicketStats = async (): Promise<Record<string, number>> => {
  const grouped = await prisma.ticket.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const out: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0, total: 0 };

  for (const g of grouped) {
    const count = D.num(g._count._all);
    out[D.str(g.status)] = count;
    out.total += count;
  }

  return out;
};

export const registerDeviceToken = async (
  userId: string,
  input: { deviceId: string; fcmToken: string; platform?: string },
): Promise<any> => {
  const existing = await prisma.device.findUnique({
    where: { deviceId: D.str(input.deviceId) },
    select: { id: true, userId: true },
  });

  if (existing && existing.userId && existing.userId !== userId) {
    throw AppError.forbidden(ERROR.DEVICE.DIFFERENT_ACCOUNT);
  }

  return prisma.device.upsert({
    where: { deviceId: D.str(input.deviceId) },
    create: {
      deviceId: D.str(input.deviceId),
      userId,
      fcmToken: D.str(input.fcmToken),
      platform: (D.str(input.platform) || 'WEB') as Platform,
      lastSeenAt: new Date(),
    },
    update: { userId, fcmToken: D.str(input.fcmToken), lastSeenAt: new Date() },
  });
};

export const unregisterDeviceToken = async (
  userId: string,
  deviceId: string,
): Promise<{ deviceId: string; isRemoved: boolean }> => {
  const existing = await prisma.device.findFirst({
    where: { deviceId: D.str(deviceId), userId },
    select: { id: true },
  });

  if (!existing) return { deviceId: D.str(deviceId), isRemoved: false };

  await prisma.device.update({
    where: { id: existing.id },
    data: { fcmToken: '' },
  });

  return { deviceId: D.str(deviceId), isRemoved: true };
};

export const listNotificationTemplates = async (): Promise<any[]> =>
  prisma.notificationTemplate.findMany({ orderBy: [{ channel: 'asc' }, { key: 'asc' }] });

export const createNotificationTemplate = async (
  input: {
    key: string;
    name?: string;
    channel?: string;
    title: string;
    body: string;
    variables?: string[];
    isActive?: boolean;
  },
  req?: any,
): Promise<any> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { key: D.str(input.key) },
    select: { id: true },
  });

  if (existing) throw AppError.conflict(ERROR.NOTIFICATION.TEMPLATE_KEY_TAKEN);

  const row = await prisma.notificationTemplate.create({
    data: {
      key: D.str(input.key),
      name: D.str(input.name),
      channel: (D.str(input.channel) || 'PUSH') as NotificationChannel,
      title: D.str(input.title),
      body: D.str(input.body),
      variables: D.strArr(input.variables),
      isActive: input.isActive !== false,
    },
  });

  void writeActivityLog({
    req,
    action: 'CREATE',
    entity: 'NotificationTemplate',
    entityId: row.id,
    meta: { key: input.key },
  });

  return row;
};

export const updateNotificationTemplate = async (
  id: string,
  input: Record<string, any>,
  req?: any,
): Promise<any> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.NOTIFICATION.TEMPLATE_NOT_FOUND);

  const row = await prisma.notificationTemplate.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: D.str(input.name) }),
      ...(input.title === undefined ? {} : { title: D.str(input.title) }),
      ...(input.body === undefined ? {} : { body: D.str(input.body) }),
      ...(input.variables === undefined ? {} : { variables: D.strArr(input.variables) }),
      ...(input.isActive === undefined ? {} : { isActive: Boolean(input.isActive) }),
    },
  });

  void writeActivityLog({
    req,
    action: 'UPDATE',
    entity: 'NotificationTemplate',
    entityId: id,
  });

  return row;
};

export const deleteNotificationTemplate = async (id: string, req?: any): Promise<void> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.NOTIFICATION.TEMPLATE_NOT_FOUND);

  await prisma.notificationTemplate.delete({ where: { id } });

  void writeActivityLog({
    req,
    action: 'DELETE',
    entity: 'NotificationTemplate',
    entityId: id,
  });
};

export const deleteTicket = async (ticketId: string, req?: any): Promise<void> => {
  const existing = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });

  if (!existing) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  await prisma.ticket.delete({ where: { id: ticketId } });

  void writeActivityLog({ req, action: 'DELETE', entity: 'Ticket', entityId: ticketId });
};

export const addTicketNote = async (
  ticketId: string,
  userId: string,
  input: { note: string },
  req?: any,
): Promise<any> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  const note = await prisma.ticketNote.create({
    data: {
      ticketId,
      userId,
      note: D.str(input.note),
    },
    select: { id: true, ticketId: true, userId: true, note: true, createdAt: true },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'TICKET_NOTE_ADDED',
    entity: 'Ticket',
    entityId: ticketId,
    meta: { noteId: note.id },
  });

  return note;
};

export const listTicketNotes = async (ticketId: string, userId: string): Promise<any[]> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  return prisma.ticketNote.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, ticketId: true, userId: true, note: true, createdAt: true },
  });
};

export const deleteTicketNote = async (
  ticketId: string,
  noteId: string,
  userId: string,
  req?: any,
): Promise<boolean> => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });

  if (!ticket) throw AppError.notFound(ERROR.TICKET.NOT_FOUND);

  const note = await prisma.ticketNote.findFirst({ where: { id: noteId, ticketId } });
  if (!note) throw AppError.notFound(ERROR.NOTIFICATION.NOTE_NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.ticketNote.delete({ where: { id: noteId } });

  void writeActivityLog({
    req,
    userId,
    action: 'TICKET_NOTE_DELETED',
    entity: 'Ticket',
    entityId: ticketId,
    meta: { noteId },
  });

  return true;
};

export const listCannedResponses = async (
  query: Record<string, any>,
): Promise<{ rows: any[]; total: number }> => {
  const where: Prisma.CannedResponseWhereInput = {};

  if (D.str(query.isActive) === 'true') where.isActive = true;
  else if (D.str(query.isActive) === 'false') where.isActive = false;

  const [rows, total] = await Promise.all([
    prisma.cannedResponse.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: D.num(query.skip),
      take: D.num(query.take),
    }),
    prisma.cannedResponse.count({ where }),
  ]);

  return { rows, total };
};

export const createCannedResponse = async (
  input: { title: string; body: string },
  userId: string,
  req?: any,
): Promise<any> => {
  const response = await prisma.cannedResponse.create({
    data: {
      title: D.str(input.title),
      body: D.str(input.body),
      createdBy: userId,
    },
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'CANNED_RESPONSE_CREATED',
    entity: 'CannedResponse',
    entityId: response.id,
    meta: { title: response.title },
  });

  return response;
};

export const updateCannedResponse = async (
  responseId: string,
  input: { title?: string; body?: string; isActive?: boolean },
  userId: string,
  req?: any,
): Promise<any> => {
  const existing = await prisma.cannedResponse.findUnique({
    where: { id: responseId },
    select: { id: true, title: true, body: true, isActive: true },
  });

  if (!existing)
    throw AppError.notFound(ERROR.NOTIFICATION.CANNED_RESPONSE_NOT_FOUND, ERROR_CODE.NOT_FOUND);

  const response = await prisma.cannedResponse.update({
    where: { id: responseId },
    data: {
      ...(input.title !== undefined ? { title: D.str(input.title) } : {}),
      ...(input.body !== undefined ? { body: D.str(input.body) } : {}),
      ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
    },
    select: {
      id: true,
      title: true,
      body: true,
      isActive: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  void writeActivityLog({
    req,
    userId,
    action: 'CANNED_RESPONSE_UPDATED',
    entity: 'CannedResponse',
    entityId: responseId,
    meta: { fields: Object.keys(input) },
  });

  return response;
};

export const deleteCannedResponse = async (responseId: string, req?: any): Promise<boolean> => {
  const existing = await prisma.cannedResponse.findUnique({
    where: { id: responseId },
    select: { id: true },
  });

  if (!existing)
    throw AppError.notFound(ERROR.NOTIFICATION.CANNED_RESPONSE_NOT_FOUND, ERROR_CODE.NOT_FOUND);

  await prisma.cannedResponse.delete({ where: { id: responseId } });

  void writeActivityLog({
    req,
    action: 'CANNED_RESPONSE_DELETED',
    entity: 'CannedResponse',
    entityId: responseId,
  });

  return true;
};
