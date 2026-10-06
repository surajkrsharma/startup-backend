import { Router } from 'express';
import { validate, idParamSchema } from '../../middlewares/validate.middleware';
import { authenticate } from '../../middlewares/auth.middleware';
import * as controller from './notification.controller';
import * as schema from './notification.schema';

const notification = Router();

notification.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listNotificationsSchema }),
  controller.getAll,
);

notification.get('/getUnreadCount', authenticate, controller.getUnreadCount);

notification.patch(
  '/markRead/:id',
  authenticate,
  validate({ params: schema.notificationIdParamSchema }),
  controller.markNotificationRead,
);

notification.patch('/markAllRead', authenticate, controller.markAllNotificationsRead);

notification.delete(
  '/delete/:id',
  authenticate,
  validate({ params: schema.notificationIdParamSchema }),
  controller.remove,
);

notification.get('/getPreferences', authenticate, controller.getPreferences);

notification.patch(
  '/updatePreferences',
  authenticate,
  validate({ body: schema.preferencesSchema }),
  controller.setPreferences,
);

notification.post(
  '/registerDevice',
  authenticate,
  validate({ body: schema.deviceTokenSchema }),
  controller.registerDevice,
);

notification.post(
  '/unregisterDevice',
  authenticate,
  validate({ body: schema.deviceTokenSchema }),
  controller.unregisterDevice,
);

notification.post(
  '/sendBulk',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.broadcastSchema }),
  controller.broadcast,
);

notification.get(
  '/getTemplates',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listNotificationsSchema }),
  controller.getTemplates,
);

notification.post(
  '/createTemplate',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.templateSchema }),
  controller.createTemplate,
);

notification.patch(
  '/updateTemplate/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema, body: schema.templateSchema.partial() }),
  controller.updateTemplate,
);

notification.delete(
  '/deleteTemplate/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: idParamSchema }),
  controller.deleteTemplate,
);

export const notificationRoutes = notification;

const chat = Router();

chat.get(
  '/getConversations',
  authenticate,
  validate({ query: schema.listConversationsSchema }),
  controller.getConversations,
);

chat.get('/getUnreadCount', authenticate, controller.chatUnread);

chat.post(
  '/startConversation',
  authenticate,
  validate({ body: schema.startConversationSchema }),
  controller.startConversation,
);

chat.get(
  '/getMessages/:conversationId',
  authenticate,
  validate({
    params: schema.conversationIdParamSchema,
    query: schema.listConversationsSchema,
  }),
  controller.getMessages,
);

chat.post(
  '/sendMessage',
  authenticate,
  validate({ body: schema.sendMessageSchema }),
  controller.sendMessage,
);

chat.patch(
  '/markRead/:conversationId',
  authenticate,
  validate({ params: schema.conversationIdParamSchema }),
  controller.markConversationRead,
);

chat.delete(
  '/deleteMessage/:id',
  authenticate,
  validate({ params: idParamSchema }),
  controller.deleteMessage,
);

chat.post(
  '/blockUser/:userId',
  authenticate,
  validate({ params: schema.blockIdParamSchema, body: schema.blockUserSchema }),
  controller.block,
);

chat.post(
  '/unblock/:id',
  authenticate,
  validate({ params: schema.unblockIdParamSchema }),
  controller.unblock,
);

chat.get('/getBlocked', authenticate, controller.getBlocked);

export const chatRoutes = chat;

const ticket = Router();

ticket.get(
  '/getCategories',
  validate({ query: schema.listTicketsSchema }),
  controller.getCategories,
);

ticket.post(
  '/categories',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.ticketCategorySchema }),
  controller.createCategory,
);

ticket.get('/getStats', authenticate, ...controller.guards.admin, controller.getStats);

ticket.post(
  '/create',
  authenticate,
  validate({ body: schema.createTicketSchema }),
  controller.createTicket,
);

ticket.get(
  '/getAll',
  authenticate,
  validate({ query: schema.listTicketsSchema }),
  controller.getTickets,
);

ticket.get(
  '/getById/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema }),
  controller.getById,
);

ticket.post(
  '/reply/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema, body: schema.replyTicketSchema }),
  controller.reply,
);

ticket.patch(
  '/updateStatus/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema, body: schema.ticketStatusSchema }),
  controller.updateStatus,
);

ticket.patch(
  '/assign/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema, body: schema.assignTicketSchema }),
  controller.assign,
);

ticket.patch(
  '/close/:id',
  authenticate,
  validate({ params: schema.ticketIdParamSchema }),
  controller.closeTicket,
);

ticket.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema }),
  controller.deleteTicket,
);

ticket.post(
  '/addNote/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema, body: schema.addTicketNoteSchema }),
  controller.addTicketNote,
);

ticket.get(
  '/getNotes/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketIdParamSchema }),
  controller.getTicketNotes,
);

ticket.delete(
  '/removeNote/:id/:noteId',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.ticketNoteParamSchema }),
  controller.removeTicketNote,
);

export const ticketRoutes = ticket;

// Canned Responses
const cannedResponse = Router();

cannedResponse.get(
  '/getAll',
  authenticate,
  ...controller.guards.admin,
  validate({ query: schema.listCannedResponsesSchema }),
  controller.listCannedResponses,
);

cannedResponse.post(
  '/create',
  authenticate,
  ...controller.guards.admin,
  validate({ body: schema.createCannedResponseSchema }),
  controller.createCannedResponse,
);

cannedResponse.patch(
  '/update/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.cannedResponseIdParamSchema, body: schema.updateCannedResponseSchema }),
  controller.updateCannedResponse,
);

cannedResponse.delete(
  '/delete/:id',
  authenticate,
  ...controller.guards.admin,
  validate({ params: schema.cannedResponseIdParamSchema }),
  controller.deleteCannedResponse,
);

export const cannedResponseRoutes = cannedResponse;

export default notificationRoutes;
