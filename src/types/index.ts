/**
 * Type definitions for PersonalChat Server
 */

export type RoomCapacity = number;

export type ConnectionState = 'connected' | 'disconnected';

export type CallType = 'voice' | 'video' | 'data';

export interface RoomMember {
  socketId: string;
  sessionId: string;
  displayName: string;
  isHost: boolean;
  joinedAt: number;
  connectionState: ConnectionState;
}

export interface Room {
  internalId: string;
  publicCode: string;
  hostSocketId: string;
  maxCapacity: RoomCapacity;
  members: Map<string, RoomMember>; // Keyed by socketId
  messages: Map<string, ChatMessage>; // Keyed by messageId (ephemeral in-memory only)
  isLocked: boolean;
  createdAt: number;
  lastActivityAt: number;
}

export interface SanitizedMember {
  socketId: string;
  displayName: string;
  isHost: boolean;
  joinedAt: number;
}

export interface RoomInfoResponse {
  internalId: string;
  publicCode: string;
  maxCapacity: RoomCapacity;
  isHost: boolean;
  isLocked: boolean;
  members: SanitizedMember[];
  selfSocketId: string;
}

export interface HealthResponse {
  status: string;
}

export interface CreateRoomPayload {
  displayName: string;
  capacity: number;
}

export interface JoinRoomPayload {
  displayName: string;
  roomCode: string;
}

export interface SendMessagePayload {
  text: string;
}

export interface EditMessagePayload {
  messageId: string;
  text: string;
}

export interface DeleteMessagePayload {
  messageId: string;
}

export interface MessageEditedEvent {
  messageId: string;
  text: string;
  editedAt: number;
}

export interface MessageDeletedEvent {
  messageId: string;
}

export interface TypingPayload {
  isTyping: boolean;
}

export interface TypingEvent {
  socketId: string;
  displayName: string;
  isTyping: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  roomCode: string;
  text: string;
  timestamp: number;
  type: 'user' | 'system';
  isEdited?: boolean;
  editedAt?: number;
  isDeleted?: boolean;
}

/**
 * WebRTC Signaling Payloads
 */

export interface SignalCallStartPayload {
  callType: CallType;
}

export interface SignalIncomingCallEvent {
  fromSocketId: string;
  fromDisplayName: string;
  callType: CallType;
}

export interface SignalCallAcceptPayload {
  toSocketId?: string;
}

export interface SignalCallRejectPayload {
  toSocketId?: string;
  reason?: string;
}

export interface SignalOfferPayload {
  toSocketId: string;
  offer: unknown; // RTCSessionDescriptionInit
  callType: CallType;
}

export interface SignalOfferEvent {
  fromSocketId: string;
  fromDisplayName: string;
  offer: unknown;
  callType: CallType;
}

export interface SignalAnswerPayload {
  toSocketId: string;
  answer: unknown; // RTCSessionDescriptionInit
}

export interface SignalAnswerEvent {
  fromSocketId: string;
  answer: unknown;
}

export interface SignalIceCandidatePayload {
  toSocketId: string;
  candidate: unknown; // RTCIceCandidateInit
}

export interface SignalIceCandidateEvent {
  fromSocketId: string;
  candidate: unknown;
}

export interface SignalMediaTogglePayload {
  isMuted: boolean;
  isCameraOff: boolean;
}

export interface SignalMediaToggleEvent {
  socketId: string;
  isMuted: boolean;
  isCameraOff: boolean;
}

export interface SocketAckResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: CreateRoomPayload,
    callback: (response: SocketAckResponse<RoomInfoResponse>) => void
  ) => void;
  'room:join': (
    payload: JoinRoomPayload,
    callback: (response: SocketAckResponse<RoomInfoResponse>) => void
  ) => void;
  'room:leave': (callback?: (response: SocketAckResponse<{ left: boolean }>) => void) => void;
  'room:toggle-lock': (
    callback?: (response: SocketAckResponse<{ isLocked: boolean }>) => void
  ) => void;
  'chat:message': (
    payload: SendMessagePayload,
    callback?: (response: SocketAckResponse<ChatMessage>) => void
  ) => void;
  'chat:edit-message': (
    payload: EditMessagePayload,
    callback?: (response: SocketAckResponse<ChatMessage>) => void
  ) => void;
  'chat:delete-message': (
    payload: DeleteMessagePayload,
    callback?: (response: SocketAckResponse<{ messageId: string }>) => void
  ) => void;
  'chat:typing': (payload: TypingPayload) => void;
  // WebRTC signaling client events
  'signal:call-start': (payload: SignalCallStartPayload) => void;
  'signal:call-accept': (payload: SignalCallAcceptPayload) => void;
  'signal:call-reject': (payload: SignalCallRejectPayload) => void;
  'signal:call-end': () => void;
  'signal:offer': (payload: SignalOfferPayload) => void;
  'signal:answer': (payload: SignalAnswerPayload) => void;
  'signal:ice-candidate': (payload: SignalIceCandidatePayload) => void;
  'signal:media-toggle': (payload: SignalMediaTogglePayload) => void;
  ping: () => void;
}

export interface ServerToClientEvents {
  'room:created': (room: RoomInfoResponse) => void;
  'room:joined': (room: RoomInfoResponse) => void;
  'room:member-joined': (member: SanitizedMember) => void;
  'room:member-left': (data: { socketId: string; displayName: string; newHostSocketId?: string }) => void;
  'room:member-list-updated': (members: SanitizedMember[]) => void;
  'room:lock-updated': (data: { isLocked: boolean }) => void;
  'room:closed': (data: { reason: string }) => void;
  'room:error': (data: { message: string }) => void;
  'chat:message': (message: ChatMessage) => void;
  'chat:message-edited': (data: MessageEditedEvent) => void;
  'chat:message-deleted': (data: MessageDeletedEvent) => void;
  'chat:typing': (data: TypingEvent) => void;
  // WebRTC signaling server events
  'signal:incoming-call': (data: SignalIncomingCallEvent) => void;
  'signal:call-accepted': (data: { fromSocketId: string }) => void;
  'signal:call-rejected': (data: { fromSocketId: string; reason?: string }) => void;
  'signal:call-ended': (data: { fromSocketId: string }) => void;
  'signal:offer': (data: SignalOfferEvent) => void;
  'signal:answer': (data: SignalAnswerEvent) => void;
  'signal:ice-candidate': (data: SignalIceCandidateEvent) => void;
  'signal:media-toggle': (data: SignalMediaToggleEvent) => void;
  pong: (timestamp: number) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId?: string;
  displayName?: string;
  roomCode?: string;
  internalRoomId?: string;
}
