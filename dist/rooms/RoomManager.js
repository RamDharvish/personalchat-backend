import crypto from 'node:crypto';
const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_INJECTION_REGEX = /javascript:|data:|vbscript:/i;
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
export const MAX_ACTIVE_ROOMS = 1000;
export const ROOM_INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours of inactivity
export class RoomManager {
    // Keyed by internalId (UUID)
    rooms = new Map();
    // Keyed by public 4-digit code -> internalId
    codeToId = new Map();
    // Reverse lookup: socketId -> internalId
    socketToRoom = new Map();
    constructor() {
        // Background garbage collection for stale/inactive rooms
        setInterval(() => this.cleanupInactiveRooms(), 10 * 60 * 1000).unref();
    }
    /**
     * Generates a unique 4-digit public room code (1000 - 9999).
     * Ensures no active code collision in memory.
     */
    generateUniquePublicCode() {
        const maxAttempts = 10000;
        for (let i = 0; i < maxAttempts; i++) {
            const code = Math.floor(1000 + Math.random() * 9000).toString();
            if (!this.codeToId.has(code)) {
                return code;
            }
        }
        throw new Error('Server room code capacity exhausted. Please try again later.');
    }
    /**
     * Sanitizes and validates user display name with control character and script filtering.
     */
    sanitizeDisplayName(name) {
        if (typeof name !== 'string') {
            return { valid: false, sanitized: '', error: 'Display name must be a string' };
        }
        const cleaned = name.replace(CONTROL_CHARS_REGEX, '').trim();
        if (!cleaned) {
            return { valid: false, sanitized: '', error: 'Name is required' };
        }
        if (cleaned.length < 2) {
            return { valid: false, sanitized: cleaned, error: 'Name must be at least 2 characters' };
        }
        if (cleaned.length > 24) {
            return { valid: false, sanitized: cleaned.slice(0, 24), error: 'Name must be 24 characters or less' };
        }
        if (HTML_TAG_REGEX.test(name) || SCRIPT_INJECTION_REGEX.test(name)) {
            return { valid: false, sanitized: cleaned.replace(HTML_TAG_REGEX, ''), error: 'Invalid characters in name' };
        }
        return { valid: true, sanitized: cleaned };
    }
    /**
     * Creates a new ephemeral room with the creator as the first member and host.
     */
    createRoom(hostSocketId, rawDisplayName, rawCapacity) {
        if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
            return { success: false, error: 'Server room capacity reached. Please try again later.' };
        }
        if (typeof rawCapacity !== 'number' || isNaN(rawCapacity)) {
            return { success: false, error: 'Please enter the maximum number of members.' };
        }
        if (!Number.isInteger(rawCapacity)) {
            return { success: false, error: 'Maximum members must be a whole number.' };
        }
        if (rawCapacity < 2 || rawCapacity > 20) {
            return { success: false, error: 'Room capacity must be between 2 and 20 members.' };
        }
        const capacity = rawCapacity;
        const nameCheck = this.sanitizeDisplayName(rawDisplayName);
        if (!nameCheck.valid) {
            return { success: false, error: nameCheck.error || 'Invalid display name' };
        }
        this.leaveRoom(hostSocketId);
        const internalId = crypto.randomUUID();
        const publicCode = this.generateUniquePublicCode();
        const now = Date.now();
        const hostMember = {
            socketId: hostSocketId,
            sessionId: crypto.randomUUID(),
            displayName: nameCheck.sanitized,
            isHost: true,
            joinedAt: now,
            connectionState: 'connected',
        };
        const room = {
            internalId,
            publicCode,
            hostSocketId,
            maxCapacity: capacity,
            members: new Map([[hostSocketId, hostMember]]),
            messages: new Map(),
            isLocked: false,
            createdAt: now,
            lastActivityAt: now,
        };
        this.rooms.set(internalId, room);
        this.codeToId.set(publicCode, internalId);
        this.socketToRoom.set(hostSocketId, internalId);
        return {
            success: true,
            roomInfo: {
                internalId,
                publicCode,
                maxCapacity: capacity,
                isHost: true,
                isLocked: false,
                members: this.getSanitizedMembers(room),
                selfSocketId: hostSocketId,
            },
        };
    }
    /**
     * Joins an existing ephemeral room by 4-digit public code.
     */
    joinRoom(socketId, rawDisplayName, rawRoomCode) {
        if (typeof rawRoomCode !== 'string') {
            return { success: false, error: 'Invalid room code.' };
        }
        const code = rawRoomCode.trim();
        if (!/^\d{4}$/.test(code)) {
            return { success: false, error: 'Room code must be exactly 4 digits.' };
        }
        const internalId = this.codeToId.get(code);
        if (!internalId) {
            return { success: false, error: 'Room not found. Please check the 4-digit code.' };
        }
        const room = this.rooms.get(internalId);
        if (!room) {
            this.codeToId.delete(code);
            return { success: false, error: 'Room not found. Please check the 4-digit code.' };
        }
        if (room.isLocked) {
            return { success: false, error: 'Room is locked.' };
        }
        if (room.members.size >= room.maxCapacity) {
            return { success: false, error: 'This room is full.' };
        }
        const nameCheck = this.sanitizeDisplayName(rawDisplayName);
        if (!nameCheck.valid) {
            return { success: false, error: nameCheck.error || 'Invalid display name' };
        }
        this.leaveRoom(socketId);
        const now = Date.now();
        const newMember = {
            socketId,
            sessionId: crypto.randomUUID(),
            displayName: nameCheck.sanitized,
            isHost: false,
            joinedAt: now,
            connectionState: 'connected',
        };
        room.members.set(socketId, newMember);
        room.lastActivityAt = now;
        this.socketToRoom.set(socketId, internalId);
        const sanitizedNewMember = {
            socketId: newMember.socketId,
            displayName: newMember.displayName,
            isHost: newMember.isHost,
            joinedAt: newMember.joinedAt,
        };
        return {
            success: true,
            room,
            newMember: sanitizedNewMember,
            roomInfo: {
                internalId: room.internalId,
                publicCode: room.publicCode,
                maxCapacity: room.maxCapacity,
                isHost: false,
                isLocked: room.isLocked,
                members: this.getSanitizedMembers(room),
                selfSocketId: socketId,
            },
        };
    }
    /**
     * Removes a member from their room, handling host reassignment and room destruction.
     */
    leaveRoom(socketId) {
        const internalId = this.socketToRoom.get(socketId);
        if (!internalId) {
            return { left: false };
        }
        const room = this.rooms.get(internalId);
        this.socketToRoom.delete(socketId);
        if (!room) {
            return { left: false };
        }
        const member = room.members.get(socketId);
        room.members.delete(socketId);
        const leavingMember = member
            ? {
                socketId: member.socketId,
                displayName: member.displayName,
                isHost: member.isHost,
                joinedAt: member.joinedAt,
            }
            : undefined;
        // If room is now empty, destroy it completely
        if (room.members.size === 0) {
            this.rooms.delete(internalId);
            this.codeToId.delete(room.publicCode);
            return {
                left: true,
                internalId,
                roomClosed: true,
                leavingMember,
            };
        }
        let newHostSocketId;
        // If the leaving member was the host, reassign host to the earliest joined member
        if (room.hostSocketId === socketId) {
            let earliestMember = null;
            for (const m of room.members.values()) {
                if (!earliestMember || m.joinedAt < earliestMember.joinedAt) {
                    earliestMember = m;
                }
            }
            if (earliestMember) {
                earliestMember.isHost = true;
                room.hostSocketId = earliestMember.socketId;
                newHostSocketId = earliestMember.socketId;
            }
        }
        room.lastActivityAt = Date.now();
        const updatedMembers = this.getSanitizedMembers(room);
        return {
            left: true,
            internalId,
            roomClosed: false,
            leavingMember,
            newHostSocketId,
            updatedMembers,
        };
    }
    /**
     * Toggles room locked state. Strictly verifies the caller socket is the true host.
     */
    toggleRoomLock(socketId) {
        const internalId = this.socketToRoom.get(socketId);
        if (!internalId) {
            return { success: false, error: 'You are not in a room.' };
        }
        const room = this.rooms.get(internalId);
        if (!room) {
            return { success: false, error: 'Room not found.' };
        }
        if (room.hostSocketId !== socketId) {
            return { success: false, error: 'Only the room host can lock or unlock the room.' };
        }
        room.isLocked = !room.isLocked;
        room.lastActivityAt = Date.now();
        return {
            success: true,
            isLocked: room.isLocked,
            internalId,
        };
    }
    /**
     * Periodic sweep to destroy stale/abandoned rooms.
     */
    cleanupInactiveRooms() {
        const now = Date.now();
        for (const [internalId, room] of this.rooms.entries()) {
            if (now - room.lastActivityAt > ROOM_INACTIVITY_TIMEOUT_MS) {
                console.log(`[RoomManager GC] Cleaning up inactive room #${room.publicCode}`);
                // Clean up reverse socket mappings
                for (const socketId of room.members.keys()) {
                    this.socketToRoom.delete(socketId);
                }
                this.codeToId.delete(room.publicCode);
                this.rooms.delete(internalId);
            }
        }
    }
    addMessage(internalId, message) {
        const room = this.rooms.get(internalId);
        if (!room)
            return;
        // Cap message history to 500 in memory to prevent memory leaks
        if (room.messages.size >= 500) {
            const oldestKey = room.messages.keys().next().value;
            if (oldestKey) {
                room.messages.delete(oldestKey);
            }
        }
        room.messages.set(message.id, message);
        room.lastActivityAt = Date.now();
    }
    getMessage(internalId, messageId) {
        const room = this.rooms.get(internalId);
        return room?.messages.get(messageId);
    }
    editMessage(internalId, messageId, senderSocketId, newText) {
        const room = this.rooms.get(internalId);
        if (!room) {
            return { success: false, error: 'Room not found.' };
        }
        const message = room.messages.get(messageId);
        if (!message) {
            return { success: false, error: 'Message not found.' };
        }
        if (message.type === 'system') {
            return { success: false, error: 'System messages cannot be edited.' };
        }
        if (message.isDeleted) {
            return { success: false, error: 'Deleted messages cannot be edited.' };
        }
        if (message.senderId !== senderSocketId) {
            return { success: false, error: 'You are not authorized to edit this message.' };
        }
        message.text = newText;
        message.isEdited = true;
        message.editedAt = Date.now();
        room.lastActivityAt = Date.now();
        return { success: true, message };
    }
    deleteMessage(internalId, messageId, senderSocketId) {
        const room = this.rooms.get(internalId);
        if (!room) {
            return { success: false, error: 'Room not found.' };
        }
        const message = room.messages.get(messageId);
        if (!message) {
            return { success: false, error: 'Message not found.' };
        }
        if (message.type === 'system') {
            return { success: false, error: 'System messages cannot be deleted.' };
        }
        if (message.isDeleted) {
            return { success: false, error: 'Message is already deleted.' };
        }
        if (message.senderId !== senderSocketId) {
            return { success: false, error: 'You are not authorized to delete this message.' };
        }
        message.isDeleted = true;
        message.text = 'This message was deleted';
        room.lastActivityAt = Date.now();
        return { success: true, message };
    }
    getSanitizedMembers(room) {
        return Array.from(room.members.values()).map((m) => ({
            socketId: m.socketId,
            displayName: m.displayName,
            isHost: m.isHost,
            joinedAt: m.joinedAt,
        }));
    }
    getRoomBySocketId(socketId) {
        const internalId = this.socketToRoom.get(socketId);
        return internalId ? this.rooms.get(internalId) : undefined;
    }
    getRoomByInternalId(internalId) {
        return this.rooms.get(internalId);
    }
    getRoomByPublicCode(code) {
        const internalId = this.codeToId.get(code);
        return internalId ? this.rooms.get(internalId) : undefined;
    }
    getActiveRoomCount() {
        return this.rooms.size;
    }
}
export const roomManager = new RoomManager();
