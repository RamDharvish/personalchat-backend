import { io as ClientSocket, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomInfoResponse,
  SignalIncomingCallEvent,
  SignalOfferEvent,
  SignalAnswerEvent,
  SignalIceCandidateEvent,
  SignalMediaToggleEvent,
} from '../types/index.js';

const SERVER_URL = 'http://localhost:5000';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

function createClient(): Socket<ServerToClientEvents, ClientToServerEvents> {
  return ClientSocket(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
  });
}

async function runVideoCallTests() {
  console.log('\n======================================================');
  console.log('--- PERSONALCHAT WEBRTC VIDEO CALL FULL SUITE ---');
  console.log('======================================================\n');

  const client1 = createClient();
  const client2 = createClient();
  const client3 = createClient();

  await new Promise<void>((resolve) => {
    let count = 0;
    const check = () => {
      count++;
      if (count === 3) resolve();
    };
    client1.on('connect', check);
    client2.on('connect', check);
    client3.on('connect', check);
  });

  console.log('1. Connection Setup:');
  assert(Boolean(client1.id && client2.id && client3.id), 'All 3 clients connected to server');

  // Client 1 creates room
  console.log('\n2. Room Creation & Joining:');
  const roomInfo = await new Promise<RoomInfoResponse>((resolve, reject) => {
    client1.emit('room:create', { displayName: 'User1_Caller', capacity: 3 }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  const code = roomInfo.publicCode;
  assert(code.length === 4, `Room #${code} created by User 1`);

  // Client 2 joins
  const peer2Joined = await new Promise<RoomInfoResponse>((resolve, reject) => {
    client2.emit('room:join', { displayName: 'User2_Receiver', roomCode: code }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
  assert(peer2Joined.members.length === 2, 'User 2 joined room with 2 members');

  // Client 1 starts video call
  console.log('\n3. Video Call Initiation:');
  const incomingCallPromise = new Promise<SignalIncomingCallEvent>((resolve) => {
    client2.once('signal:incoming-call', (data) => resolve(data));
  });

  client1.emit('signal:call-start', { callType: 'video' });
  const incomingCall = await incomingCallPromise;

  assert(
    incomingCall.fromSocketId === client1.id && incomingCall.callType === 'video',
    'User 2 received signal:incoming-call with callType="video"'
  );

  // Client 2 accepts call
  console.log('\n4. Call Acceptance & SDP Renegotiation:');
  const callAcceptedPromise = new Promise<{ fromSocketId: string }>((resolve) => {
    client1.once('signal:call-accepted', (data) => resolve(data));
  });

  client2.emit('signal:call-accept', { toSocketId: client1.id! });
  const accepted = await callAcceptedPromise;

  assert(accepted.fromSocketId === client2.id, 'User 1 received signal:call-accepted from User 2');

  // User 1 creates and sends video offer
  const videoOfferPromise = new Promise<SignalOfferEvent>((resolve) => {
    client2.once('signal:offer', (data) => resolve(data));
  });

  const mockVideoOffer = {
    type: 'offer',
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
  };

  client1.emit('signal:offer', {
    toSocketId: client2.id!,
    offer: mockVideoOffer,
    callType: 'video',
  });

  const receivedOffer = await videoOfferPromise;
  assert(
    receivedOffer.fromSocketId === client1.id && receivedOffer.callType === 'video',
    'User 2 received video offer (callType="video")'
  );

  // User 2 replies with answer
  const videoAnswerPromise = new Promise<SignalAnswerEvent>((resolve) => {
    client1.once('signal:answer', (data) => resolve(data));
  });

  const mockVideoAnswer = {
    type: 'answer',
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
  };

  client2.emit('signal:answer', {
    toSocketId: client1.id!,
    answer: mockVideoAnswer,
  });

  const receivedAnswer = await videoAnswerPromise;
  assert(receivedAnswer.fromSocketId === client2.id, 'User 1 received video answer from User 2');

  // ICE exchange
  console.log('\n5. Bidirectional ICE Candidate Exchange:');
  const iceOn2Promise = new Promise<SignalIceCandidateEvent>((resolve) => {
    client2.once('signal:ice-candidate', (data) => resolve(data));
  });

  client1.emit('signal:ice-candidate', {
    toSocketId: client2.id!,
    candidate: { candidate: 'candidate:video1 1 UDP 2122260223 127.0.0.1 50002 typ host', sdpMid: '1', sdpMLineIndex: 1 },
  });

  const iceOn2 = await iceOn2Promise;
  assert(iceOn2.fromSocketId === client1.id, 'User 2 received ICE candidate from User 1');

  // Media Toggle test (Camera off / Mute)
  console.log('\n6. Media Controls Toggle:');
  const mediaTogglePromise = new Promise<SignalMediaToggleEvent>((resolve) => {
    client2.once('signal:media-toggle', (data) => resolve(data));
  });

  client1.emit('signal:media-toggle', { isMuted: true, isCameraOff: true });
  const mediaToggle = await mediaTogglePromise;

  assert(
    mediaToggle.socketId === client1.id && mediaToggle.isMuted && mediaToggle.isCameraOff,
    'User 2 received signal:media-toggle (isMuted=true, isCameraOff=true)'
  );

  // 3-Party Mesh Call
  console.log('\n7. 3-Party Video Call Mesh:');
  const peer3Joined = await new Promise<RoomInfoResponse>((resolve, reject) => {
    client3.emit('room:join', { displayName: 'User3_ThirdPeer', roomCode: code }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  assert(peer3Joined.members.length === 3, 'User 3 joined 3-capacity room');

  const offerTo3From1Promise = new Promise<SignalOfferEvent>((resolve) => {
    client3.once('signal:offer', (data) => resolve(data));
  });

  client1.emit('signal:offer', {
    toSocketId: client3.id!,
    offer: mockVideoOffer,
    callType: 'video',
  });

  const offerTo3 = await offerTo3From1Promise;
  assert(
    offerTo3.fromSocketId === client1.id && offerTo3.callType === 'video',
    'User 3 received video call offer in 3-party mesh'
  );

  // Call Ending
  console.log('\n8. Call Ending & Disconnect:');
  const callEndedPromise = new Promise<{ fromSocketId: string }>((resolve) => {
    client2.once('signal:call-ended', (data) => resolve(data));
  });

  client1.emit('signal:call-end');
  const callEndData = await callEndedPromise;

  assert(callEndData.fromSocketId === client1.id, 'User 2 received signal:call-ended');

  client1.disconnect();
  client2.disconnect();
  client3.disconnect();

  console.log('\n======================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVideoCallTests().catch((err) => {
  console.error('Fatal error in video call test suite:', err);
  process.exit(1);
});
