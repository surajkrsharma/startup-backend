import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './notification.controller';
import * as schema from './notification.schema';

// ── Notifications ────────────────────────────────────────────────────────────

const notification = Router();

/** GET /notifications/getAll */
notification.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listNotificationsSchema }),
  controller.getAll,
);

/** GET /notifications/getUnreadCount */
notification.get('/getUnreadCount', authenticate, controller.getUnreadCount);

/** PATCH /notifications/markRead/:id */
notification.patch(
  '/markRead/:id',
  authenticate,
  validate({ params: schema.notificationIdParamSchema }),
  controller.markNotificationRead,
);

/** PATCH /notifications/markAllRead */
notification.patch('/markAllRead', authenticate, controller.markAllNotificationsRead);

/** DELETE /notifications/delete/:id */
notification.delete(
  '/delete/:id',
  authenticate,
  validate({ params: schema.notificationIdParamSchema }),
  controller.remove,
);

/** GET /notifications/getPreferences */
notification.get('/getPreferences', authenticate, controller.getPreferences);

/** PATCH /notifications/updatePreferences */
notification.patch(
  '/updatePreferences',
  authenticate,
  validate({ body: schema.preferencesSchema }),
  controller.setPreferences,
);

/** POST /notifications/registerDevice — stores the FCM token against the caller */
notification.post(
  '/registerDevice',
  authenticate,
  validate({ body: schema.deviceTokenSchema }),
  controller.registerDevice,
);

/** POST /notifications/unregisterDevice */
notification.post(
  '/unregisterDevice',
  authenticate,
  validate({ body: schema.deviceTokenSchema }),
  controller.unregisterDevice,
);

/** POST /notifications/sendBulk — admin */
notification.post(
  '/sendBulk',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.broadcastSchema }),
  controller.broadcast,
);

/** GET /notifications/getTemplates — admin */
notification.get(
  '/getTemplates',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listNotificationsSchema }),
  controller.getTemplates,
);

/** POST /notifications/createTemplate — admin */
notification.post(
  '/createTemplate',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.templateSchema }),
  controller.createTemplate,
);

/** PATCH /notifications/updateTemplate/:id — admin */
notification.patch(
  '/updateTemplate/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.templateSchema.partial() }),
  controller.updateTemplate,
);

/** DELETE /notifications/deleteTemplate/:id — admin */
notification.delete(
  '/deleteTemplate/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.deleteTemplate,
);

export const notificationRoutes = notification;

// ── Chat ─────────────────────────────────────────────────────────────────────

const chat = Router();

/** GET /chat/getConversations */
chat.get(
  '/getConversations',
  authenticate,
  validate({ query: schema.listConversationsSchema }),
  controller.getConversations,
);

/** GET /chat/getUnreadCount */
chat.get('/getUnreadCount', authenticate, controller.chatUnread);

/** POST /chat/startConversation */
chat.post(
  '/startConversation',
  authenticate,
  validate({ body: schema.startConversationSchema }),
  controller.startConversation,
);

/** GET /chat/getMessages/:conversationId */
chat.get(
  '/getMessages/:conversationId',
  authenticate,
  validate({
    params: schema.conversationIdParamSchema,
    query: schema.listConversationsSchema,
  }),
  controller.getMessages,
);

/** POST /chat/sendMessage */
chat.post(
  '/sendMessage',
  authenticate,
  validate({ body: schema.sendMessageSchema }),
  controller.sendMessage,
);

/** PATCH /chat/markRead/:conversationId */
chat.patch(
  '/markRead/:conversationId',
  authenticate,
  validate({ params: schema.conversationIdParamSchema }),
  controller.markConversationRead,
);

/** DELETE /chat/deleteMessage/:id */
chat.delete(
  '/deleteMessage/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteMessage,
);

/** POST /chat/blockUser/:userId */
chat.post(
  '/blockUser/:userId',
  authenticate,
  validate({ params: schema.blockIdParamSchema, body: schema.blockUserSchema }),
  controller.block,
);

/** POST /chat/unblock/:id */
chat.post(
  '/unblock/:id',
  authenticate,
  validate({ params: schema.unblockIdParamSchema }),
  controller.unblock,
);

/** GET /chat/getBlocked */
chat.get('/getBlocked', authenticate, controller.getBlocked);

export const chatRoutes = chat;

// ── Tickets ──────────────────────────────────────────────────────────────────

const ticket = Router();

/** GET /tickets/getCategories — public so a signed-out visitor can open one */
ticket.get(
  '/getCategories',
  validate({ query: schema.listTicketsSchema }),
  controller.getCategories,
);

/** POST /tickets/categories — admin */
ticket.post(
  '/categories',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.ticketCategorySchema }),
  controller.createCategory,
);

/** GET /tickets/getStats — staff only */
ticket.get('/getStats', authenticate, ...controller.guards.admin, controller.getStats);

/** POST /tickets/create */
ticket.post(
  '/create',
  authenticate,
  validate({ body: schema.createTicketSchema }),
  controller.createTicket,
);

/** GET /tickets/getAll */
ticket.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listTicketsSchema }),
  controller.getTickets,
);

/** GET /tickets/getById/:id */
ticket.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema }),
  controller.getById,
);

/** POST /tickets/reply/:id */
ticket.post(
  '/reply/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema, body: schema.replyTicketSchema }),
  controller.reply,
);

/** PATCH /tickets/updateStatus/:id */
ticket.patch(
  '/updateStatus/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema, body: schema.ticketStatusSchema }),
  controller.updateStatus,
);

/** PATCH /tickets/assign/:id — staff only */
ticket.patch(
  '/assign/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema, body: schema.assignTicketSchema }),
  controller.assign,
);

/** PATCH /tickets/close/:id */
ticket.patch(
  '/close/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema }),
  controller.closeTicket,
);

/** DELETE /tickets/delete/:id — admin */
ticket.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema }),
  controller.deleteTicket,
);

export const ticketRoutes = ticket;

export default notificationRoutes;
