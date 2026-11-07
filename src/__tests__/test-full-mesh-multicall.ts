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

async function runMultiParticipantMeshTests() {
  console.log('\n================================================================');
  console.log('--- PERSONALCHAT 3 & 4 PARTICIPANT FULL-MESH CALL TEST SUITE ---');
  console.log('================================================================\n');

  const c1 = createClient();
  const c2 = createClient();
  const c3 = createClient();
  const c4 = createClient();

  await new Promise<void>((resolve) => {
    let count = 0;
    const check = () => {
      count++;
      if (count === 4) resolve();
    };
    c1.on('connect', check);
    c2.on('connect', check);
    c3.on('connect', check);
    c4.on('connect', check);
  });

  console.log('Phase 1: Initial Connection & Room Setup (3 Participants)');
  assert(Boolean(c1.id && c2.id && c3.id && c4.id), 'All 4 clients connected to server');

  const roomRes = await new Promise<RoomInfoResponse>((resolve, reject) => {
    c1.emit('room:create', { displayName: 'User1_Alice', capacity: 4 }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  const code = roomRes.publicCode;
  assert(code.length === 4, `Room #${code} created by Alice (c1)`);

  await new Promise<RoomInfoResponse>((resolve, reject) => {
    c2.emit('room:join', { displayName: 'User2_Bob', roomCode: code }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  const join3Res = await new Promise<RoomInfoResponse>((resolve, reject) => {
    c3.emit('room:join', { displayName: 'User3_Charlie', roomCode: code }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  assert(join3Res.members.length === 3, 'Alice, Bob, and Charlie joined room (3 members)');

  console.log('\nPhase 2: 3-Way Video Call Initiation & Acceptance');
  // Alice starts video call
  const incomingOnBobPromise = new Promise<SignalIncomingCallEvent>((resolve) => {
    c2.once('signal:incoming-call', (data) => resolve(data));
  });
  const incomingOnCharliePromise = new Promise<SignalIncomingCallEvent>((resolve) => {
    c3.once('signal:incoming-call', (data) => resolve(data));
  });

  c1.emit('signal:call-start', { callType: 'video' });

  const [incBob, incCharlie] = await Promise.all([incomingOnBobPromise, incomingOnCharliePromise]);
  assert(incBob.fromSocketId === c1.id && incBob.callType === 'video', 'Bob received incoming video call from Alice');
  assert(incCharlie.fromSocketId === c1.id && incCharlie.callType === 'video', 'Charlie received incoming video call from Alice');

  // Bob accepts call -> Alice receives call-accepted from Bob
  const aliceSeesBobAccepted = new Promise<{ fromSocketId: string }>((resolve) => {
    c1.once('signal:call-accepted', (data) => resolve(data));
  });
  c2.emit('signal:call-accept', { toSocketId: c1.id! });
  const bobAccepted = await aliceSeesBobAccepted;
  assert(bobAccepted.fromSocketId === c2.id, 'Alice received signal:call-accepted from Bob');

  // Charlie accepts call -> BOTH Alice and Bob receive call-accepted from Charlie!
  const aliceSeesCharlieAccepted = new Promise<{ fromSocketId: string }>((resolve) => {
    c1.once('signal:call-accepted', (data) => resolve(data));
  });
  const bobSeesCharlieAccepted = new Promise<{ fromSocketId: string }>((resolve) => {
    c2.once('signal:call-accepted', (data) => resolve(data));
  });

  c3.emit('signal:call-accept', { toSocketId: c1.id! });
  const [charlieAcceptedAlice, charlieAcceptedBob] = await Promise.all([
    aliceSeesCharlieAccepted,
    bobSeesCharlieAccepted,
  ]);
  assert(charlieAcceptedAlice.fromSocketId === c3.id, 'Alice received signal:call-accepted from Charlie');
  assert(charlieAcceptedBob.fromSocketId === c3.id, 'Bob received signal:call-accepted from Charlie (Mesh trigger!)');

  console.log('\nPhase 3: 3-Way Mesh SDP & ICE Signaling Exchange (A↔B, A↔C, B↔C)');
  // A sends offer to B
  const bReceivesAOffer = new Promise<SignalOfferEvent>((resolve) => {
    c2.once('signal:offer', (data) => resolve(data));
  });
  c1.emit('signal:offer', { toSocketId: c2.id!, offer: { type: 'offer', sdp: 'sdp:A->B' }, callType: 'video' });
  const offerAB = await bReceivesAOffer;
  assert(offerAB.fromSocketId === c1.id, 'Bob received media offer from Alice (A->B)');

  // B sends answer to A
  const aReceivesBAnswer = new Promise<SignalAnswerEvent>((resolve) => {
    c1.once('signal:answer', (data) => resolve(data));
  });
  c2.emit('signal:answer', { toSocketId: c1.id!, answer: { type: 'answer', sdp: 'sdp:B->A' } });
  const answerBA = await aReceivesBAnswer;
  assert(answerBA.fromSocketId === c2.id, 'Alice received media answer from Bob (B->A)');

  // A sends offer to C
  const cReceivesAOffer = new Promise<SignalOfferEvent>((resolve) => {
    c3.once('signal:offer', (data) => resolve(data));
  });
  c1.emit('signal:offer', { toSocketId: c3.id!, offer: { type: 'offer', sdp: 'sdp:A->C' }, callType: 'video' });
  const offerAC = await cReceivesAOffer;
  assert(offerAC.fromSocketId === c1.id, 'Charlie received media offer from Alice (A->C)');

  // C sends answer to A
  const aReceivesCAnswer = new Promise<SignalAnswerEvent>((resolve) => {
    c1.once('signal:answer', (data) => resolve(data));
  });
  c3.emit('signal:answer', { toSocketId: c1.id!, answer: { type: 'answer', sdp: 'sdp:C->A' } });
  const answerCA = await aReceivesCAnswer;
  assert(answerCA.fromSocketId === c3.id, 'Alice received media answer from Charlie (C->A)');

  // B sends offer to C (The crucial mesh connection that was previously missing!)
  const cReceivesBOffer = new Promise<SignalOfferEvent>((resolve) => {
    c3.once('signal:offer', (data) => resolve(data));
  });
  c2.emit('signal:offer', { toSocketId: c3.id!, offer: { type: 'offer', sdp: 'sdp:B->C' }, callType: 'video' });
  const offerBC = await cReceivesBOffer;
  assert(offerBC.fromSocketId === c2.id, 'Charlie received media offer from Bob (B->C full mesh link)');

  // C sends answer to B
  const bReceivesCAnswer = new Promise<SignalAnswerEvent>((resolve) => {
    c2.once('signal:answer', (data) => resolve(data));
  });
  c3.emit('signal:answer', { toSocketId: c2.id!, answer: { type: 'answer', sdp: 'sdp:C->B' } });
  const answerCB = await bReceivesCAnswer;
  assert(answerCB.fromSocketId === c3.id, 'Bob received media answer from Charlie (C->B full mesh link)');

  console.log('\nPhase 4: Independent Media Controls (Alice Mutes Mic & Disables Camera)');
  const bobSeesToggle = new Promise<SignalMediaToggleEvent>((resolve) => {
    c2.once('signal:media-toggle', (data) => resolve(data));
  });
  const charlieSeesToggle = new Promise<SignalMediaToggleEvent>((resolve) => {
    c3.once('signal:media-toggle', (data) => resolve(data));
  });

  c1.emit('signal:media-toggle', { isMuted: true, isCameraOff: true });
  const [toggleBob, toggleCharlie] = await Promise.all([bobSeesToggle, charlieSeesToggle]);

  assert(toggleBob.socketId === c1.id && toggleBob.isMuted && toggleBob.isCameraOff, 'Bob received Alice media toggle (muted & camera off)');
  assert(toggleCharlie.socketId === c1.id && toggleCharlie.isMuted && toggleCharlie.isCameraOff, 'Charlie received Alice media toggle (muted & camera off)');

  console.log('\nPhase 5: 4th Participant Joins Late (David)');
  // David joins room while call is active
  const join4Res = await new Promise<RoomInfoResponse>((resolve, reject) => {
    c4.emit('room:join', { displayName: 'User4_David', roomCode: code }, (res) => {
      if (res.success && res.data) resolve(res.data);
      else reject(new Error(res.error));
    });
  });

  assert(join4Res.members.length === 4, 'David joined room with 4 members');
  assert(
    join4Res.activeCall !== undefined &&
      join4Res.activeCall !== null &&
      join4Res.activeCall.callType === 'video' &&
      join4Res.activeCall.participantCount >= 3,
    'David received activeCall state in room:join response (Late Joiner Awareness)'
  );

  // David accepts/joins call
  const aliceSeesDavid = new Promise<{ fromSocketId: string }>((resolve) => {
    c1.once('signal:call-accepted', (data) => resolve(data));
  });
  const bobSeesDavid = new Promise<{ fromSocketId: string }>((resolve) => {
    c2.once('signal:call-accepted', (data) => resolve(data));
  });
  const charlieSeesDavid = new Promise<{ fromSocketId: string }>((resolve) => {
    c3.once('signal:call-accepted', (data) => resolve(data));
  });

  c4.emit('signal:call-accept', { toSocketId: c1.id! });
  const [accAlice, accBob, accCharlie] = await Promise.all([aliceSeesDavid, bobSeesDavid, charlieSeesDavid]);
  assert(accAlice.fromSocketId === c4.id, 'Alice received call-accepted from David (A↔D)');
  assert(accBob.fromSocketId === c4.id, 'Bob received call-accepted from David (B↔D)');
  assert(accCharlie.fromSocketId === c4.id, 'Charlie received call-accepted from David (C↔D)');

  console.log('\nPhase 6: Participant Disconnection & Mesh Resilience (Bob Leaves)');
  // Save Bob's socket id before disconnecting (socket.io-client sets socket.id to undefined on disconnect)
  const bobId = c2.id!;

  // Bob disconnects from room
  const aliceSeesBobLeave = new Promise<{ socketId: string }>((resolve) => {
    c1.once('room:member-left', (data) => resolve(data));
  });
  const charlieSeesBobLeave = new Promise<{ socketId: string }>((resolve) => {
    c3.once('room:member-left', (data) => resolve(data));
  });
  const davidSeesBobLeave = new Promise<{ socketId: string }>((resolve) => {
    c4.once('room:member-left', (data) => resolve(data));
  });

  c2.disconnect();
  const [leftAlice, leftCharlie, leftDavid] = await Promise.all([
    aliceSeesBobLeave,
    charlieSeesBobLeave,
    davidSeesBobLeave,
  ]);

  assert(leftAlice.socketId === bobId, 'Alice notified that Bob left');
  assert(leftCharlie.socketId === bobId, 'Charlie notified that Bob left');
  assert(leftDavid.socketId === bobId, 'David notified that Bob left');

  // Verify remaining participants (Alice, Charlie, David) can still signal each other
  const davidSeesCharlieIce = new Promise<SignalIceCandidateEvent>((resolve) => {
    c4.once('signal:ice-candidate', (data) => resolve(data));
  });
  c3.emit('signal:ice-candidate', {
    toSocketId: c4.id!,
    candidate: { candidate: 'candidate:charlie-to-david', sdpMid: '0', sdpMLineIndex: 0 },
  });
  const charlieIceOnDavid = await davidSeesCharlieIce;
  assert(charlieIceOnDavid.fromSocketId === c3.id, 'Charlie and David remain fully connected after Bob departed');

  c1.disconnect();
  c3.disconnect();
  c4.disconnect();

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMultiParticipantMeshTests().catch((err) => {
  console.error('Fatal error in multi-participant mesh test suite:', err);
  process.exit(1);
});
