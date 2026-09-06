import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomInfoResponse,
  ChatMessage,
  MessageEditedEvent,
  MessageDeletedEvent,
  SocketAckResponse,
} from '../types/index.js';

const SERVER_URL = 'http://localhost:5000';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function createClient(): TypedSocket {
  return io(SERVER_URL, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  }) as TypedSocket;
}

function connectClient(socket: TypedSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
}

function waitForUserMessage(socket: TypedSocket, expectedText: string): Promise<ChatMessage> {
  return new Promise((resolve) => {
    const handler = (msg: ChatMessage) => {
      if (msg.type === 'user' && msg.text === expectedText) {
        socket.off('chat:message', handler);
        resolve(msg);
      }
    };
    socket.on('chat:message', handler);
  });
}

async function runEditDeleteTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING MESSAGE EDIT/DELETE AUTHORIZATION TEST SUITE');
  console.log('====================================================');

  const clientA = createClient();
  const clientB = createClient();

  try {
    await Promise.all([connectClient(clientA), connectClient(clientB)]);
    console.log('✅ Both test sockets connected to backend.');

    // 1. Client A creates a 2-member room
    const roomInfoA = await new Promise<RoomInfoResponse>((resolve, reject) => {
      clientA.emit('room:create', { displayName: 'Alice', capacity: 2 }, (res) => {
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error || 'Failed to create room'));
      });
    });
    console.log(`✅ Alice created room #${roomInfoA.publicCode}`);

    // 2. Client B joins room
    const roomInfoB = await new Promise<RoomInfoResponse>((resolve, reject) => {
      clientB.emit('room:join', { displayName: 'Bob', roomCode: roomInfoA.publicCode }, (res) => {
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error || 'Failed to join room'));
      });
    });
    console.log(`✅ Bob joined room #${roomInfoB.publicCode}`);

    // Wait a brief tick for room join events to settle
    await new Promise((r) => setTimeout(r, 100));

    // 3. Alice sends a message: "Hello world"
    const messageSentPromiseA = waitForUserMessage(clientA, 'Hello world');
    const messageSentPromiseB = waitForUserMessage(clientB, 'Hello world');

    const sentMessage = await new Promise<ChatMessage>((resolve, reject) => {
      clientA.emit('chat:message', { text: 'Hello world' }, (res) => {
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error || 'Failed to send message'));
      });
    });

    const [receivedA, receivedB] = await Promise.all([messageSentPromiseA, messageSentPromiseB]);
    if (sentMessage.id !== receivedA.id || sentMessage.id !== receivedB.id) {
      throw new Error('Message ID mismatch between sender and receivers');
    }
    console.log(`✅ Alice sent message "${sentMessage.text}" (ID: ${sentMessage.id})`);

    // 4. Alice edits her own message to "Hello everyone!"
    const editPromiseA = new Promise<MessageEditedEvent>((resolve) => {
      clientA.once('chat:message-edited', resolve);
    });
    const editPromiseB = new Promise<MessageEditedEvent>((resolve) => {
      clientB.once('chat:message-edited', resolve);
    });

    const editAck = await new Promise<ChatMessage>((resolve, reject) => {
      clientA.emit('chat:edit-message', { messageId: sentMessage.id, text: 'Hello everyone!' }, (res) => {
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error || 'Failed to edit message'));
      });
    });

    const [editEventA, editEventB] = await Promise.all([editPromiseA, editPromiseB]);

    if (editAck.text !== 'Hello everyone!' || !editAck.isEdited) {
      throw new Error(`Invalid edit ACK state: text=${editAck.text}, isEdited=${editAck.isEdited}`);
    }
    if (editEventA.text !== 'Hello everyone!' || editEventB.text !== 'Hello everyone!') {
      throw new Error('Broadcast edit event text mismatch');
    }
    console.log(`✅ Alice successfully edited her message to "${editAck.text}" (Broadcast received by Alice and Bob)`);

    // 5. Bob attempts unauthorized edit on Alice's message (MUST BE REJECTED)
    const unauthorizedEditRes = await new Promise<SocketAckResponse<ChatMessage>>((resolve) => {
      clientB.emit('chat:edit-message', { messageId: sentMessage.id, text: 'Hacked by Bob' }, (res) => {
        resolve(res);
      });
    });

    if (unauthorizedEditRes.success) {
      throw new Error('SECURITY VULNERABILITY: Bob was able to edit Alice’s message!');
    }
    console.log(`✅ Security test passed: Bob unauthorized edit was rejected (${unauthorizedEditRes.error})`);

    // 6. Bob attempts unauthorized deletion of Alice's message (MUST BE REJECTED)
    const unauthorizedDeleteRes = await new Promise<SocketAckResponse<{ messageId: string }>>((resolve) => {
      clientB.emit('chat:delete-message', { messageId: sentMessage.id }, (res) => {
        resolve(res);
      });
    });

    if (unauthorizedDeleteRes.success) {
      throw new Error('SECURITY VULNERABILITY: Bob was able to delete Alice’s message!');
    }
    console.log(`✅ Security test passed: Bob unauthorized delete was rejected (${unauthorizedDeleteRes.error})`);

    // 7. Alice deletes her own message
    const deletePromiseA = new Promise<MessageDeletedEvent>((resolve) => {
      clientA.once('chat:message-deleted', resolve);
    });
    const deletePromiseB = new Promise<MessageDeletedEvent>((resolve) => {
      clientB.once('chat:message-deleted', resolve);
    });

    const deleteAck = await new Promise<{ messageId: string }>((resolve, reject) => {
      clientA.emit('chat:delete-message', { messageId: sentMessage.id }, (res) => {
        if (res.success && res.data) resolve(res.data);
        else reject(new Error(res.error || 'Failed to delete message'));
      });
    });

    const [deleteEventA, deleteEventB] = await Promise.all([deletePromiseA, deletePromiseB]);
    if (deleteAck.messageId !== sentMessage.id || deleteEventA.messageId !== sentMessage.id || deleteEventB.messageId !== sentMessage.id) {
      throw new Error('Delete event message ID mismatch');
    }
    console.log(`✅ Alice deleted her message. Broadcast received by Alice and Bob.`);

    // 8. Alice attempts to re-edit deleted message (MUST BE REJECTED)
    const reEditRes = await new Promise<SocketAckResponse<ChatMessage>>((resolve) => {
      clientA.emit('chat:edit-message', { messageId: sentMessage.id, text: 'Resurrected' }, resolve);
    });
    if (reEditRes.success) {
      throw new Error('Deleted message should not be editable');
    }
    console.log(`✅ Re-edit deleted message rejected (${reEditRes.error})`);

    // 9. Alice attempts to re-delete already deleted message (MUST BE REJECTED)
    const reDeleteRes = await new Promise<SocketAckResponse<{ messageId: string }>>((resolve) => {
      clientA.emit('chat:delete-message', { messageId: sentMessage.id }, resolve);
    });
    if (reDeleteRes.success) {
      throw new Error('Already deleted message should not be deletable again');
    }
    console.log(`✅ Re-delete already deleted message rejected (${reDeleteRes.error})`);

    console.log('\n🎉 ALL MESSAGE EDIT / DELETE AUTHORIZATION TESTS PASSED! (9/9)\n');
  } finally {
    clientA.disconnect();
    clientB.disconnect();
  }
}

runEditDeleteTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
