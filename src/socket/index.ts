import crypto from 'node:crypto';
import { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  ChatMessage,
} from '../types/index.js';
import { roomManager } from '../rooms/RoomManager.js';
import {
  messageFloodLimiter,
  signalingFloodLimiter,
  joinBruteForceProtection,
} from '../utils/rateLimiter.js';

const HTML_ESCAPE_MAP: { [key: string]: string } = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
};

function escapeHtml(str: string): string {
  return str.replace(/[&<>"'/]/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

export function initializeSocket(httpServer: HttpServer): SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> {
  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 1e6, // 1MB buffer cap to prevent memory exhaustion
    pingTimeout: 20000,
    pingInterval: 10000,
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
    const clientIp = socket.handshake.address || socket.id;

    socket.on('ping', () => {
      socket.emit('pong', Date.now());
    });

    /**
     * Room Creation Event
     */
    socket.on('room:create', (payload, callback) => {
      if (!payload || typeof payload !== 'object') {
        return callback({ success: false, error: 'Invalid payload structure' });
      }

      const result = roomManager.createRoom(socket.id, payload.displayName, payload.capacity);

      if (!result.success || !result.roomInfo) {
        return callback({
          success: false,
          error: result.error || 'Failed to create room',
        });
      }

      const roomChannel = `room:${result.roomInfo.internalId}`;
      socket.join(roomChannel);

      socket.data.roomCode = result.roomInfo.publicCode;
      socket.data.internalRoomId = result.roomInfo.internalId;
      socket.data.displayName = payload.displayName;

      console.log(`[RoomManager] Room created (#${result.roomInfo.publicCode})`);

      socket.emit('room:created', result.roomInfo);

      const systemMessage: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        roomCode: result.roomInfo.publicCode,
        text: `Room #${result.roomInfo.publicCode} created. All messages exist strictly in browser memory.`,
        timestamp: Date.now(),
        type: 'system',
      };
      socket.emit('chat:message', systemMessage);

      callback({
        success: true,
        data: result.roomInfo,
      });
    });

    /**
     * Room Joining Event with Brute-Force Protection
     */
    socket.on('room:join', (payload, callback) => {
      // Check brute-force lockout on this IP
      const lockout = joinBruteForceProtection.isLockedOut(clientIp);
      if (lockout.locked) {
        return callback({
          success: false,
          error: `Too many failed join attempts. Please wait ${lockout.remainingSeconds} seconds before trying again.`,
        });
      }

      if (!payload || typeof payload !== 'object') {
        return callback({ success: false, error: 'Invalid payload structure' });
      }

      const result = roomManager.joinRoom(socket.id, payload.displayName, payload.roomCode);

      if (!result.success || !result.roomInfo || !result.newMember) {
        joinBruteForceProtection.recordFailure(clientIp);
        return callback({
          success: false,
          error: result.error || 'Failed to join room',
        });
      }

      // Successful join -> clear failure history
      joinBruteForceProtection.recordSuccess(clientIp);

      const roomChannel = `room:${result.roomInfo.internalId}`;
      socket.join(roomChannel);

      socket.data.roomCode = result.roomInfo.publicCode;
      socket.data.internalRoomId = result.roomInfo.internalId;
      socket.data.displayName = payload.displayName;

      console.log(`[RoomManager] Member joined room #${result.roomInfo.publicCode}`);

      socket.emit('room:joined', result.roomInfo);
      socket.to(roomChannel).emit('room:member-joined', result.newMember);
      io.to(roomChannel).emit('room:member-list-updated', result.roomInfo.members);

      const joinNotice: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        roomCode: result.roomInfo.publicCode,
        text: `${result.newMember.displayName} joined the room.`,
        timestamp: Date.now(),
        type: 'system',
      };
      io.to(roomChannel).emit('chat:message', joinNotice);

      callback({
        success: true,
        data: result.roomInfo,
      });
    });

    /**
     * Live Text Message Event (Ephemeral Relay with Flood Throttling)
     */
    socket.on('chat:message', (payload, callback) => {
      if (messageFloodLimiter.isRateLimited(socket.id)) {
        if (callback) {
          callback({ success: false, error: 'Message sending rate limit exceeded. Slow down.' });
        }
        return;
      }

      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        if (callback) callback({ success: false, error: 'You are not in an active room.' });
        return;
      }

      const member = room.members.get(socket.id);
      if (!member) {
        if (callback) callback({ success: false, error: 'Member profile not found.' });
        return;
      }

      if (!payload || typeof payload.text !== 'string') {
        if (callback) callback({ success: false, error: 'Invalid message payload.' });
        return;
      }

      const trimmedText = payload.text.trim();
      if (!trimmedText) {
        if (callback) callback({ success: false, error: 'Cannot send empty message.' });
        return;
      }

      if (trimmedText.length > 2000) {
        if (callback) callback({ success: false, error: 'Message exceeds maximum length of 2000 characters.' });
        return;
      }

      // Sanitize and escape message text
      const sanitizedText = escapeHtml(trimmedText);

      const message: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: socket.id,
        senderName: member.displayName,
        roomCode: room.publicCode,
        text: sanitizedText,
        timestamp: Date.now(),
        type: 'user',
      };

      roomManager.addMessage(room.internalId, message);

      const roomChannel = `room:${room.internalId}`;
      io.to(roomChannel).emit('chat:message', message);

      if (callback) {
        callback({ success: true, data: message });
      }
    });

    /**
     * Edit Message Event (Authorized by Socket ID)
     */
    socket.on('chat:edit-message', (payload, callback) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        if (callback) callback({ success: false, error: 'You are not in an active room.' });
        return;
      }

      if (!payload || typeof payload.messageId !== 'string' || typeof payload.text !== 'string') {
        if (callback) callback({ success: false, error: 'Invalid edit payload.' });
        return;
      }

      const trimmedText = payload.text.trim();
      if (!trimmedText) {
        if (callback) callback({ success: false, error: 'Cannot save empty message.' });
        return;
      }

      if (trimmedText.length > 2000) {
        if (callback) callback({ success: false, error: 'Message exceeds maximum length of 2000 characters.' });
        return;
      }

      const sanitizedText = escapeHtml(trimmedText);
      const result = roomManager.editMessage(room.internalId, payload.messageId, socket.id, sanitizedText);

      if (!result.success || !result.message) {
        if (callback) callback({ success: false, error: result.error || 'Failed to edit message.' });
        return;
      }

      const roomChannel = `room:${room.internalId}`;
      io.to(roomChannel).emit('chat:message-edited', {
        messageId: payload.messageId,
        text: sanitizedText,
        editedAt: result.message.editedAt || Date.now(),
      });

      if (callback) {
        callback({ success: true, data: result.message });
      }
    });

    /**
     * Delete Message Event (Authorized by Socket ID)
     */
    socket.on('chat:delete-message', (payload, callback) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) {
        if (callback) callback({ success: false, error: 'You are not in an active room.' });
        return;
      }

      if (!payload || typeof payload.messageId !== 'string') {
        if (callback) callback({ success: false, error: 'Invalid delete payload.' });
        return;
      }

      const result = roomManager.deleteMessage(room.internalId, payload.messageId, socket.id);

      if (!result.success) {
        if (callback) callback({ success: false, error: result.error || 'Failed to delete message.' });
        return;
      }

      const roomChannel = `room:${room.internalId}`;
      io.to(roomChannel).emit('chat:message-deleted', {
        messageId: payload.messageId,
      });

      if (callback) {
        callback({ success: true, data: { messageId: payload.messageId } });
      }
    });

    /**
     * Typing Indicator Event
     */
    socket.on('chat:typing', (payload) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;

      const member = room.members.get(socket.id);
      if (!member) return;

      const roomChannel = `room:${room.internalId}`;
      socket.to(roomChannel).emit('chat:typing', {
        socketId: socket.id,
        displayName: member.displayName,
        isTyping: Boolean(payload?.isTyping),
      });
    });

    /**
     * WebRTC Signaling Events with Rate Limiting
     */
    socket.on('signal:call-start', (payload) => {
      if (signalingFloodLimiter.isRateLimited(socket.id)) return;

      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;

      const member = room.members.get(socket.id);
      if (!member) return;

      const roomChannel = `room:${room.internalId}`;
      socket.to(roomChannel).emit('signal:incoming-call', {
        fromSocketId: socket.id,
        fromDisplayName: member.displayName,
        callType: payload.callType === 'video' ? 'video' : 'voice',
      });
    });

    socket.on('signal:call-accept', (payload) => {
      if (signalingFloodLimiter.isRateLimited(socket.id)) return;
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;

      if (payload?.toSocketId) {
        io.to(payload.toSocketId).emit('signal:call-accepted', { fromSocketId: socket.id });
      } else {
        const roomChannel = `room:${room.internalId}`;
        socket.to(roomChannel).emit('signal:call-accepted', { fromSocketId: socket.id });
      }
    });

    socket.on('signal:call-reject', (payload) => {
      if (payload?.toSocketId) {
        io.to(payload.toSocketId).emit('signal:call-rejected', {
          fromSocketId: socket.id,
          reason: typeof payload.reason === 'string' ? escapeHtml(payload.reason.slice(0, 100)) : undefined,
        });
      }
    });

    socket.on('signal:call-end', () => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;

      const roomChannel = `room:${room.internalId}`;
      socket.to(roomChannel).emit('signal:call-ended', { fromSocketId: socket.id });
    });

    socket.on('signal:offer', (payload) => {
      if (signalingFloodLimiter.isRateLimited(socket.id)) return;
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room || !payload?.toSocketId) return;

      const member = room.members.get(socket.id);
      if (!member) return;

      io.to(payload.toSocketId).emit('signal:offer', {
        fromSocketId: socket.id,
        fromDisplayName: member.displayName,
        offer: payload.offer,
        callType: payload.callType === 'video' ? 'video' : payload.callType === 'voice' ? 'voice' : 'data',
      });
    });

    socket.on('signal:answer', (payload) => {
      if (signalingFloodLimiter.isRateLimited(socket.id)) return;
      if (!payload?.toSocketId) return;

      io.to(payload.toSocketId).emit('signal:answer', {
        fromSocketId: socket.id,
        answer: payload.answer,
      });
    });

    socket.on('signal:ice-candidate', (payload) => {
      if (signalingFloodLimiter.isRateLimited(socket.id)) return;
      if (!payload?.toSocketId) return;

      io.to(payload.toSocketId).emit('signal:ice-candidate', {
        fromSocketId: socket.id,
        candidate: payload.candidate,
      });
    });

    socket.on('signal:media-toggle', (payload) => {
      const room = roomManager.getRoomBySocketId(socket.id);
      if (!room) return;

      const roomChannel = `room:${room.internalId}`;
      socket.to(roomChannel).emit('signal:media-toggle', {
        socketId: socket.id,
        isMuted: Boolean(payload?.isMuted),
        isCameraOff: Boolean(payload?.isCameraOff),
      });
    });

    /**
     * Room Leave Event
     */
    socket.on('room:leave', (callback) => {
      handleSocketLeave(socket, io);
      if (callback) {
        callback({ success: true, data: { left: true } });
      }
    });

    /**
     * Toggle Room Lock Event (Host only)
     */
    socket.on('room:toggle-lock', (callback) => {
      const result = roomManager.toggleRoomLock(socket.id);

      if (!result.success || result.isLocked === undefined || !result.internalId) {
        if (callback) {
          callback({
            success: false,
            error: result.error || 'Failed to toggle room lock',
          });
        }
        return;
      }

      const room = roomManager.getRoomByInternalId(result.internalId);
      const roomChannel = `room:${result.internalId}`;
      io.to(roomChannel).emit('room:lock-updated', { isLocked: result.isLocked });

      const lockNotice: ChatMessage = {
        id: crypto.randomUUID(),
        senderId: 'system',
        senderName: 'System',
        roomCode: room?.publicCode || '',
        text: `Room has been ${result.isLocked ? 'locked' : 'unlocked'} by the host.`,
        timestamp: Date.now(),
        type: 'system',
      };
      io.to(roomChannel).emit('chat:message', lockNotice);

      if (callback) {
        callback({
          success: true,
          data: { isLocked: result.isLocked },
        });
      }
    });

    /**
     * Disconnect Event
     */
    socket.on('disconnect', () => {
      messageFloodLimiter.reset(socket.id);
      signalingFloodLimiter.reset(socket.id);
      handleSocketLeave(socket, io);
    });
  });

  return io;
}

function handleSocketLeave(
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
): void {
  const result = roomManager.leaveRoom(socket.id);

  if (!result.left || !result.internalId) {
    return;
  }

  const roomChannel = `room:${result.internalId}`;
  socket.leave(roomChannel);

  socket.to(roomChannel).emit('signal:call-ended', { fromSocketId: socket.id });

  if (result.roomClosed) {
    console.log(`[RoomManager] Room destroyed (empty)`);
    io.to(roomChannel).emit('room:closed', { reason: 'All members left the room.' });
  } else if (result.leavingMember) {
    console.log(`[RoomManager] Member left room. Remaining: ${result.updatedMembers?.length ?? 0}`);

    io.to(roomChannel).emit('room:member-left', {
      socketId: result.leavingMember.socketId,
      displayName: result.leavingMember.displayName,
      newHostSocketId: result.newHostSocketId,
    });

    if (result.updatedMembers) {
      io.to(roomChannel).emit('room:member-list-updated', result.updatedMembers);
    }

    const leaveNotice: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: 'system',
      senderName: 'System',
      roomCode: '',
      text: `${result.leavingMember.displayName} left the room.`,
      timestamp: Date.now(),
      type: 'system',
    };
    io.to(roomChannel).emit('chat:message', leaveNotice);
  }
}
