import type { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { SOCKET } from '../config/socket.config';
import { ENV, isProduction } from '../config/env.config';
import { logger } from './logger.service';
import { verifyAccessToken } from '../utils/crypto';
import { prisma } from './prisma.service';
import { ROLES } from '../constants/roles';
import { ERROR } from '../messages/error';

type AuthedSocket = Socket & {
  data: {
    userId: string;
    role: string;
    vendorId: string;
    deviceId: string;
  };
};

let io: SocketServer | null = null;

const socketOrigins = (): string[] =>
  ENV.SOCKET_CORS_ORIGINS.length ? ENV.SOCKET_CORS_ORIGINS : ENV.CORS_ORIGINS;

/**
 * Socket.io realtime layer.
 *
 * Auth is verified on the handshake (JWT), connections join a private
 * `user:<id>` room plus role/vendor rooms, and every broadcast is room-scoped.
 */
export const initSocket = (server: HttpServer): SocketServer => {
  io = new SocketServer(server, {
    path: '/socket.io',
    cors: {
      origin: isProduction ? socketOrigins() : true,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingInterval: SOCKET.HEARTBEAT_INTERVAL_MS,
    pingTimeout: SOCKET.HEARTBEAT_INTERVAL_MS * 2,
    connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
    maxHttpBufferSize: SOCKET.MAX_BUFFER_BYTES,
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.headers?.authorization as string)?.replace(/^Bearer\s+/i, '') ||
      (socket.handshake.query?.token as string);

    /**
     * Socket.IO hands the reason to the client verbatim, so it comes from the message catalogue
     * rather than an inline literal.
     */
    if (!token) return next(new Error(ERROR.AUTH.UNAUTHORIZED));

    try {
      const payload = verifyAccessToken(token);
      (socket as AuthedSocket).data = {
        userId: payload.sub,
        role: payload.role,
        vendorId: payload.vendorId ?? '',
        deviceId: payload.deviceId ?? '',
      };
      return next();
    } catch {
      return next(new Error(ERROR.AUTH.UNAUTHORIZED));
    }
  });

  io.on('connection', async (socket: AuthedSocket) => {
    const { userId, role, vendorId } = socket.data;

    socket.join(SOCKET.ROOMS.USER(userId));
    if (role === ROLES.VENDOR && vendorId) socket.join(SOCKET.ROOMS.VENDOR(vendorId));
    if (role === ROLES.SUPER_ADMIN || role === ROLES.SUB_ADMIN) socket.join(SOCKET.ROOMS.ADMIN);

    logger.debug({ userId, socketId: socket.id }, '[socket] connected');

    // ── Order tracking ──────────────────────────────────────────────────────
    socket.on(SOCKET.EMIT.ORDER_JOIN, async (payload: any, ack?: (r: any) => void) => {
      const orderId = String(payload?.orderId ?? '');
      if (!orderId) return ack?.({ success: false });

      const allowed = await canJoinOrder(userId, role, orderId);
      if (!allowed) return ack?.({ success: false });

      socket.join(SOCKET.ROOMS.ORDER(orderId));
      return ack?.({ success: true });
    });

    socket.on(SOCKET.EMIT.ORDER_LEAVE, (payload: any) => {
      const orderId = String(payload?.orderId ?? '');
      if (orderId) socket.leave(SOCKET.ROOMS.ORDER(orderId));
    });

    // ── Chat ────────────────────────────────────────────────────────────────
    socket.on(SOCKET.EMIT.CHAT_SEND, (payload: any, ack?: (r: any) => void) => {
      const conversationId = String(payload?.conversationId ?? '');
      if (!conversationId) return ack?.({ success: false });

      /**
       * Routed through the same service the HTTP endpoint uses, so the message is persisted and the
       * block check runs. Imported lazily because notification.service imports this module for its
       * emit helpers.
       */
      void (async () => {
        try {
          const { sendMessage } = await import('../modules/notification/notification.service');
          const message = await sendMessage(conversationId, userId, {
            body: String(payload?.body ?? ''),
            attachments: Array.isArray(payload?.attachments) ? payload.attachments.map(String) : [],
          });

          socket.to(SOCKET.ROOMS.CONVERSATION(conversationId)).emit(SOCKET.EVENTS.CHAT_NEW, {
            conversationId,
            message,
          });
          return ack?.({ success: true, message });
        } catch (err) {
          logger.error(
            { err: (err as Error)?.message, conversationId, userId },
            '[socket] chat send failed',
          );
          return ack?.({ success: false, message: (err as Error)?.message ?? 'send failed' });
        }
      })();
    });

    socket.on(SOCKET.EMIT.CHAT_TYPING, (payload: any) => {
      const conversationId = String(payload?.conversationId ?? '');
      if (!conversationId) return;
      socket.to(SOCKET.ROOMS.CONVERSATION(conversationId)).emit(SOCKET.EVENTS.TYPING_START, {
        conversationId,
        userId,
        isTyping: Boolean(payload?.isTyping),
      });
    });

    socket.on(SOCKET.EMIT.CHAT_READ, (payload: any) => {
      const conversationId = String(payload?.conversationId ?? '');
      if (!conversationId) return;
      socket.to(SOCKET.ROOMS.CONVERSATION(conversationId)).emit(SOCKET.EVENTS.CHAT_READ, {
        conversationId,
        userId,
      });
    });

    // ── Live analytics dashboard ────────────────────────────────────────────
    socket.on(SOCKET.EMIT.ANALYTICS_JOIN, (ack?: (r: any) => void) => {
      if (role === ROLES.SUPER_ADMIN || role === ROLES.SUB_ADMIN) {
        socket.join(SOCKET.ROOMS.ADMIN);
        return ack?.({ success: true });
      }
      return ack?.({ success: false });
    });

    socket.on(SOCKET.EMIT.PING, (ack?: (r: any) => void) =>
      ack?.({ success: true, serverTime: new Date().toISOString() }),
    );

    socket.on('disconnect', (reason) => {
      logger.debug({ userId, socketId: socket.id, reason }, '[socket] disconnected');
    });
  });

  return io;
};

const canJoinOrder = async (userId: string, role: string, orderId: string): Promise<boolean> => {
  if (role === ROLES.SUPER_ADMIN || role === ROLES.SUB_ADMIN) return true;

  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      OR: [
        { userId },
        ...(role === ROLES.VENDOR
          ? [{ subOrders: { some: { vendor: { userId } } } }]
          : [{ subOrders: { some: { deliveries: { some: { deliveryBoy: { userId } } } } } }]),
      ],
    },
    select: { id: true },
  });

  return Boolean(order);
};

/** Sends to one user across all their devices. */
export const emitToUser = (userId: string, event: string, payload: any): void => {
  io?.to(SOCKET.ROOMS.USER(userId)).emit(event, payload);
};

/** Sends to every device of a vendor's staff. */
export const emitToVendor = (vendorId: string, event: string, payload: any): void => {
  io?.to(SOCKET.ROOMS.VENDOR(vendorId)).emit(event, payload);
};

export const emitToOrder = (orderId: string, event: string, payload: any): void => {
  io?.to(SOCKET.ROOMS.ORDER(orderId)).emit(event, payload);
};

export const emitToConversation = (conversationId: string, event: string, payload: any): void => {
  io?.to(SOCKET.ROOMS.CONVERSATION(conversationId)).emit(event, payload);
};

export const emitToAdmins = (event: string, payload: any): void => {
  io?.to(SOCKET.ROOMS.ADMIN).emit(event, payload);
};

export const getOnlineUserIds = (): string[] => {
  if (!io) return [];
  const users = new Set<string>();
  io.sockets.sockets.forEach((socket: any) => {
    if (socket?.data?.userId) users.add(socket.data.userId);
  });
  return Array.from(users);
};

export const getIo = (): SocketServer | null => io;

export const closeSocket = async (): Promise<void> => {
  if (!io) return;
  await new Promise<void>((resolve) => {
    io!.close(() => resolve());
  });
  io = null;
};

export { SOCKET };
