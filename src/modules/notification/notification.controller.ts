import { Request } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { asyncHandler } from '../../utils/asyncHandler';
import { isAdminRole, ROLES } from '../../constants/roles';
import { D } from '../../utils/defaults';
import { getPagination } from '../../utils/pagination';
import { requireRole } from '../../middlewares/auth.middleware';
import * as service from './notification.service';
import {
  serializeNotification,
  serializeConversation,
  serializeMessage,
  serializeTicket,
  serializeTicketCategory,
  serializeTicketNote,
  serializeTicketNoteList,
  serializeCannedResponse,
  serializeCannedResponseList,
} from '../../utils/serialize';

const userId = (req: Request): string => req.auth!.userId;

export const guards = {
  admin: [requireRole(ROLES.SUPER_ADMIN, ROLES.SUB_ADMIN)],
  superAdmin: [requireRole(ROLES.SUPER_ADMIN)],
};

const isStaff = (req: Request): boolean => isAdminRole(D.str(req.auth?.role));

/**
 * @openapi
 * /notifications/getAll:
 *   get:
 *     tags: [Notifications]
 *     summary: The caller's notifications
 *     responses:
 *       200: { description: Paginated list plus the unread count }
 */
export const getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total, unreadCount } = await service.listNotifications(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.NOTIFICATION.FETCHED,
    result: { unreadCount: D.num(unreadCount), itemList: rows.map(serializeNotification) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /notifications/getUnreadCount:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread notification count, broken down by type
 *     responses:
 *       200: { description: Total plus a per-type breakdown }
 */
export const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await service.getUnreadCount(userId(req));
  return ApiResponse.success(res, { message: SUCCESS.NOTIFICATION.UNREAD_COUNT_FETCHED, result });
});

/**
 * @openapi
 * /notifications/markRead:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark specific notifications read, or all of them
 *     responses:
 *       200: { description: How many were marked }
 */

export const markNotificationRead = asyncHandler(async (req, res) => {
  const count = await service.markRead(userId(req), [D.str(req.params.id)], false);

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.MARKED_READ,
    result: { markedCount: D.num(count) },
  });
});

export const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const count = await service.markRead(userId(req), [], true);

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.MARKED_ALL_READ,
    result: { markedCount: D.num(count) },
  });
});

/**
 * @openapi
 * /notifications/:id/delete:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete one of the caller's notifications
 *     responses:
 *       200: { description: Deleted }
 */
export const remove = asyncHandler(async (req, res) => {
  await service.deleteNotification(userId(req), D.str(req.params.id));
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.DELETED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /notifications/getPreferences:
 *   get:
 *     tags: [Notifications]
 *     summary: Per-channel notification preferences
 *     responses:
 *       200: { description: Preference rows }
 */
export const getPreferences = asyncHandler(async (req, res) => {
  const rows = await service.getPreferences(userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.PREFERENCES_FETCHED,
    result: {
      itemCount: rows.length,
      itemList: rows.map((p: any) => ({
        channel: D.str(p.channel),
        eventType: D.str(p.eventType),
        isEnabled: D.bool(p.isEnabled),
      })),
    },
  });
});

/**
 * @openapi
 * /notifications/preferences:
 *   patch:
 *     tags: [Notifications]
 *     summary: Update notification preferences
 *     responses:
 *       200: { description: How many preferences were written }
 */
export const setPreferences = asyncHandler(async (req, res) => {
  const count = await service.setPreferences(userId(req), req.body.preferences);
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.PREFERENCES_UPDATED,
    result: { updatedCount: D.num(count) },
  });
});

/**
 * @openapi
 * /chat/getAll:
 *   get:
 *     tags: [Chat]
 *     summary: The caller's conversations
 *     responses:
 *       200: { description: Paginated threads with per-thread unread counts }
 */
export const getConversations = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total, unreadTotal } = await service.listConversations(userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.CHAT.CONVERSATIONS_FETCHED,
    result: {
      unreadTotal: D.num(unreadTotal),
      itemList: rows.map((c: any) => ({
        ...serializeConversation(c),
        unreadCount: D.num(c.unreadCount),
      })),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /chat/startConversation:
 *   post:
 *     tags: [Chat]
 *     summary: Open (or reuse) the thread with a shop
 *     responses:
 *       201: { description: Conversation with its first message }
 *       403: { description: Blocked in either direction }
 */
export const startConversation = asyncHandler(async (req, res) => {
  const { conversation, message } = await service.startConversation(userId(req), req.body, req);

  return ApiResponse.created(res, SUCCESS.CHAT.STARTED, {
    conversation: serializeConversation(conversation),
    lastMessage: serializeMessage(message),
  });
});

/**
 * @openapi
 * /chat/getMessages/:id:
 *   get:
 *     tags: [Chat]
 *     summary: Messages in a conversation
 *     responses:
 *       200: { description: Paginated messages, newest first }
 *       404: { description: Not a participant }
 */
export const getMessages = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.getMessages(D.str(req.params.conversationId), userId(req), {
    ...(req.query as any),
    skip,
    take,
  });

  return ApiResponse.paginated(res, {
    message: SUCCESS.CHAT.MESSAGES_FETCHED,
    result: {
      conversationId: D.str(req.params.conversationId),
      itemList: rows.map(serializeMessage),
    },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /chat/:id/sendMessage:
 *   post:
 *     tags: [Chat]
 *     summary: Send a message
 *     responses:
 *       201: { description: Message sent }
 *       403: { description: Blocked in either direction }
 */
export const sendMessage = asyncHandler(async (req, res) => {
  const message = await service.sendMessage(
    D.str(req.body.conversationId),
    userId(req),
    req.body,
    req,
  );
  return ApiResponse.created(res, SUCCESS.CHAT.MESSAGE_SENT, serializeMessage(message));
});

/**
 * @openapi
 * /chat/:id/read:
 *   post:
 *     tags: [Chat]
 *     summary: Mark the other party's messages as read
 *     responses:
 *       200: { description: How many were marked }
 */
export const markConversationRead = asyncHandler(async (req, res) => {
  const count = await service.markConversationRead(
    D.str(req.params.conversationId),
    userId(req),
    req.body.lastReadAt,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.CHAT.READ,
    result: { markedCount: D.num(count) },
  });
});

/**
 * @openapi
 * /chat/:id/deleteMessage:
 *   delete:
 *     tags: [Chat]
 *     summary: Delete one of your own messages
 *     responses:
 *       200: { description: Deleted }
 */
export const deleteMessage = asyncHandler(async (req, res) => {
  await service.deleteMessage(D.str(req.params.id), userId(req), isStaff(req));
  return ApiResponse.success(res, {
    message: SUCCESS.CHAT.MESSAGE_DELETED,
    result: { id: D.str(req.params.id) },
  });
});

/**
 * @openapi
 * /chat/getUnreadCount:
 *   get:
 *     tags: [Chat]
 *     summary: Unread message count across all threads
 *     responses:
 *       200: { description: Total unread }
 */
export const chatUnread = asyncHandler(async (req, res) => {
  const result = await service.getChatUnreadCount(userId(req));
  return ApiResponse.success(res, { message: SUCCESS.CHAT.UNREAD_COUNT_FETCHED, result });
});

/**
 * @openapi
 * /chat/blockUser/:userId:
 *   post:
 *     tags: [Chat]
 *     summary: Block a user
 *     responses:
 *       200: { description: Blocked }
 */
export const block = asyncHandler(async (req, res) => {
  const targetId = D.str(req.params.userId);
  await service.blockUser(userId(req), targetId, D.str(req.body.reason), req);
  return ApiResponse.success(res, {
    message: SUCCESS.CHAT.USER_BLOCKED,
    result: { userId: targetId, isBlocked: true },
  });
});

/**
 * @openapi
 * /chat/unblock/:id:
 *   post:
 *     tags: [Chat]
 *     summary: Unblock a user
 *     responses:
 *       200: { description: Unblocked }
 */
export const unblock = asyncHandler(async (req, res) => {
  await service.unblockUser(userId(req), D.str(req.params.id));
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.REMOVED,
    result: { userId: D.str(req.params.id), isBlocked: false },
  });
});

/**
 * @openapi
 * /chat/getBlocked:
 *   get:
 *     tags: [Chat]
 *     summary: Users the caller has blocked
 *     responses:
 *       200: { description: Blocked list }
 */
export const getBlocked = asyncHandler(async (req, res) => {
  const rows = await service.listBlockedUsers(userId(req));

  return ApiResponse.success(res, {
    message: SUCCESS.CHAT.CONVERSATIONS_FETCHED,
    result: {
      itemCount: rows.length,
      itemList: rows.map((r: any) => ({
        userId: D.str(r.blockedId),
        reason: D.str(r.reason),
        createdAt: D.date(r.createdAt),
        userData: {
          userId: D.str(r.blocked?.id),
          name: D.str(r.blocked?.name),
          email: D.str(r.blocked?.email),
          avatarUrl: D.str(r.blocked?.avatarUrl),
        },
      })),
    },
  });
});

/**
 * @openapi
 * /tickets/getAll:
 *   get:
 *     tags: [Tickets]
 *     summary: Tickets (a customer sees their own, staff see all)
 *     responses:
 *       200: { description: Paginated tickets }
 */
export const getTickets = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);

  const { rows, total } = await service.listTickets(
    { ...(req.query as any), skip, take },
    isStaff(req) ? undefined : userId(req),
  );

  return ApiResponse.paginated(res, {
    message: SUCCESS.TICKET.FETCHED,
    result: { itemList: rows.map((t: any) => ({ ...serializeTicket(t), messageList: [] })) },
    totalRecord: total,
    currentPage: page,
    limit,
  });
});

/**
 * @openapi
 * /tickets/createTicket:
 *   post:
 *     tags: [Tickets]
 *     summary: Open a support ticket
 *     responses:
 *       201: { description: Ticket created with its opening message }
 */
export const createTicket = asyncHandler(async (req, res) => {
  const row = await service.createTicket(userId(req), req.body, req);
  return ApiResponse.created(res, SUCCESS.TICKET.CREATED, serializeTicket(row));
});

/**
 * @openapi
 * /tickets/getById/:id:
 *   get:
 *     tags: [Tickets]
 *     summary: A ticket with its message thread
 *     description: Internal staff notes are stripped for non-staff callers.
 *     responses:
 *       200: { description: Ticket detail }
 *       404: { description: Not found or not the caller's ticket }
 */
export const getById = asyncHandler(async (req, res) => {
  const row = await service.getTicketById(
    D.str(req.params.id),
    isStaff(req) ? undefined : userId(req),
    isStaff(req),
  );
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.RETRIEVED,
    result: serializeTicket(row),
  });
});

/**
 * @openapi
 * /tickets/:id/reply:
 *   post:
 *     tags: [Tickets]
 *     summary: Reply to a ticket
 *     description: "Staff may pass `isInternal: true` for a note the customer cannot see."
 *     responses:
 *       201: { description: Reply posted }
 *       422: { description: Ticket is closed }
 */
export const reply = asyncHandler(async (req, res) => {
  const message = await service.replyTicket(
    D.str(req.params.id),
    userId(req),
    req.body,
    isStaff(req),
    req,
  );
  return ApiResponse.created(res, SUCCESS.TICKET.REPLIED, { messageId: D.str(message.id) });
});

/**
 * @openapi
 * /tickets/:id/updateStatus:
 *   patch:
 *     tags: [Tickets]
 *     summary: Change ticket status
 *     description: A customer may only close their own ticket; staff may move it through the workflow.
 *     responses:
 *       200: { description: Status updated }
 *       403: { description: Customer attempting a staff-only transition }
 */
export const updateStatus = asyncHandler(async (req, res) => {
  const row = await service.updateTicketStatus(
    D.str(req.params.id),
    D.str(req.body.status),
    D.str(req.body.remark),
    isStaff(req),
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.STATUS_UPDATED,
    result: serializeTicket(row),
  });
});

/**
 * @openapi
 * /tickets/:id/assign:
 *   patch:
 *     tags: [Tickets]
 *     summary: Assign a ticket to an admin (staff only)
 *     responses:
 *       200: { description: Assigned }
 */
export const assign = asyncHandler(async (req, res) => {
  const row = await service.assignTicket(D.str(req.params.id), D.str(req.body.assignedToId), req);
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.ASSIGNED,
    result: serializeTicket(row),
  });
});

export const getCategories = asyncHandler(async (req, res) => {
  const rows = await service.listTicketCategories(!isStaff(req));

  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.CATEGORIES_FETCHED,
    result: { itemCount: rows.length, itemList: rows.map(serializeTicketCategory) },
  });
});

export const createCategory = asyncHandler(async (req, res) => {
  const row = await service.createTicketCategory(req.body);
  return ApiResponse.created(res, SUCCESS.COMMON.CREATED, serializeTicketCategory(row));
});

export const getStats = asyncHandler(async (_req, res) => {
  const result = await service.getTicketStats();
  return ApiResponse.success(res, { message: SUCCESS.TICKET.FETCHED, result });
});

/**
 * @openapi
 * /admin/notifications/broadcast:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a notification to specific users, or everyone active (admin)
 *     responses:
 *       202: { description: How many notifications were created }
 */
export const broadcast = asyncHandler(async (req, res) => {
  const count = await service.broadcast(req.body);
  return ApiResponse.accepted(res, SUCCESS.NOTIFICATION.BULK_SENT, { sentCount: D.num(count) });
});

export const registerDevice = asyncHandler(async (req, res) => {
  const row = await service.registerDeviceToken(userId(req), req.body);

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.DEVICE_REGISTERED,
    result: {
      deviceId: D.str(row.deviceId),
      platform: D.str(row.platform),
      hasToken: D.bool(row.fcmToken),
      lastSeenAt: D.date(row.lastSeenAt),
    },
  });
});

export const unregisterDevice = asyncHandler(async (req, res) => {
  const result = await service.unregisterDeviceToken(userId(req), D.str(req.body.deviceId));
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.DEVICE_UNREGISTERED,
    result,
  });
});

export const getTemplates = asyncHandler(async (_req, res) => {
  const rows = await service.listNotificationTemplates();

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.TEMPLATES_FETCHED,
    result: {
      itemCount: rows.length,
      itemList: rows.map((t: any) => ({
        templateId: D.str(t.id),
        key: D.str(t.key),
        name: D.str(t.name),
        channel: D.str(t.channel),
        title: D.str(t.title),
        body: D.str(t.body),
        variables: D.strArr(t.variables),
        isActive: D.bool(t.isActive),
        updatedAt: D.date(t.updatedAt),
      })),
    },
  });
});

export const createTemplate = asyncHandler(async (req, res) => {
  const row = await service.createNotificationTemplate(req.body, req);
  return ApiResponse.created(res, SUCCESS.NOTIFICATION.TEMPLATE_CREATED, {
    templateId: D.str(row.id),
    key: D.str(row.key),
    channel: D.str(row.channel),
  });
});

export const updateTemplate = asyncHandler(async (req, res) => {
  const row = await service.updateNotificationTemplate(D.str(req.params.id), req.body, req);

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.TEMPLATE_UPDATED,
    result: { templateId: D.str(row.id), isActive: D.bool(row.isActive) },
  });
});

export const deleteTemplate = asyncHandler(async (req, res) => {
  await service.deleteNotificationTemplate(D.str(req.params.id), req);

  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.TEMPLATE_DELETED,
    result: { templateId: D.str(req.params.id), isDeleted: true },
  });
});

export const closeTicket = asyncHandler(async (req, res) => {
  const row = await service.updateTicketStatus(
    D.str(req.params.id),
    'CLOSED',
    D.str(req.body?.remark),
    isStaff(req),
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.CLOSED,
    result: { ticketId: D.str(row.id), status: D.str(row.status) },
  });
});

export const deleteTicket = asyncHandler(async (req, res) => {
  await service.deleteTicket(D.str(req.params.id), req);

  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.DELETED,
    result: { ticketId: D.str(req.params.id), isDeleted: true },
  });
});

/**
 * @openapi
 * /tickets/addNote/:id:
 *   post:
 *     tags: [Tickets]
 *     summary: Add an internal note to a ticket
 *     description: Admin only.
 *     responses:
 *       200: { description: Note added }
 *       400: { description: Note is required }
 *       404: { description: Ticket not found }
 */
export const addTicketNote = asyncHandler(async (req, res) => {
  const note = await service.addTicketNote(D.str(req.params.id), req.auth!.userId, req.body, req);
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.NOTE_ADDED,
    result: serializeTicketNote(note),
  });
});

/**
 * @openapi
 * /tickets/getNotes/:id:
 *   get:
 *     tags: [Tickets]
 *     summary: List internal notes for a ticket
 *     description: Admin only.
 *     responses:
 *       200: { description: Note list, newest first }
 *       404: { description: Ticket not found }
 */
export const getTicketNotes = asyncHandler(async (req, res) => {
  const notes = await service.listTicketNotes(D.str(req.params.id), req.auth!.userId);
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.NOTES_FETCHED,
    result: serializeTicketNoteList(notes),
  });
});

/**
 * @openapi
 * /tickets/removeNote/:id/:noteId:
 *   delete:
 *     tags: [Tickets]
 *     summary: Remove an internal note from a ticket
 *     description: Admin only.
 *     responses:
 *       200: { description: Note removed }
 *       404: { description: Ticket or note not found }
 */
export const removeTicketNote = asyncHandler(async (req, res) => {
  await service.deleteTicketNote(
    D.str(req.params.id),
    D.str(req.params.noteId),
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.TICKET.NOTE_REMOVED,
    result: { isRemoved: true },
  });
});

/**
 * @openapi
 * /cannedResponses/getAll:
 *   get:
 *     tags: [Notifications]
 *     summary: List canned responses
 *     description: Admin only.
 *     responses:
 *       200: { description: Paginated canned responses }
 */
export const listCannedResponses = asyncHandler(async (req, res) => {
  const { page, limit, skip, take } = getPagination(req.query as any);
  const { rows, total } = await service.listCannedResponses({
    ...(req.query as any),
    skip,
    take,
  });
  return ApiResponse.paginated(res, {
    message: SUCCESS.NOTIFICATION.CANNED_RESPONSES_FETCHED,
    result: serializeCannedResponseList(rows),
    totalRecord: total,
    totalPage: Math.ceil(total / limit),
    currentPage: page,
    limit,
    hasNext: page * limit < total,
    hasPrevious: page > 1,
    nextPage: page * limit < total ? page + 1 : 0,
    previousPage: page > 1 ? page - 1 : 0,
  });
});

/**
 * @openapi
 * /cannedResponses/create:
 *   post:
 *     tags: [Notifications]
 *     summary: Create a canned response
 *     description: Admin only.
 *     responses:
 *       201: { description: Canned response created }
 *       400: { description: Title and body are required }
 */
export const createCannedResponse = asyncHandler(async (req, res) => {
  const response = await service.createCannedResponse(req.body, req.auth!.userId, req);
  return ApiResponse.created(
    res,
    SUCCESS.NOTIFICATION.CANNED_RESPONSE_CREATED,
    serializeCannedResponse(response),
  );
});

/**
 * @openapi
 * /cannedResponses/update/:id:
 *   patch:
 *     tags: [Notifications]
 *     summary: Update a canned response
 *     description: Admin only.
 *     responses:
 *       200: { description: Canned response updated }
 *       404: { description: Canned response not found }
 */
export const updateCannedResponse = asyncHandler(async (req, res) => {
  const response = await service.updateCannedResponse(
    D.str(req.params.id),
    req.body,
    req.auth!.userId,
    req,
  );
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.CANNED_RESPONSE_UPDATED,
    result: serializeCannedResponse(response),
  });
});

/**
 * @openapi
 * /cannedResponses/delete/:id:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete a canned response
 *     description: Admin only.
 *     responses:
 *       200: { description: Canned response deleted }
 *       404: { description: Canned response not found }
 */
export const deleteCannedResponse = asyncHandler(async (req, res) => {
  await service.deleteCannedResponse(D.str(req.params.id), req);
  return ApiResponse.success(res, {
    message: SUCCESS.NOTIFICATION.CANNED_RESPONSE_DELETED,
    result: { isDeleted: true },
  });
});
