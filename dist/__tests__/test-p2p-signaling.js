import { io as ClientSocket } from 'socket.io-client';
const SERVER_URL = 'http://localhost:5000';
let passed = 0;
let failed = 0;
function assert(condition, testName, detail) {
    if (condition) {
        console.log(`  ✓ [PASS] ${testName}`);
        passed++;
    }
    else {
        console.error(`  ✗ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
        failed++;
    }
}
function createClient() {
    return ClientSocket(SERVER_URL, {
        transports: ['websocket'],
        forceNew: true,
    });
}
async function runSignalingTests() {
    console.log('\n======================================================');
    console.log('--- PERSONALCHAT P2P SIGNALING & MESH TEST SUITE ---');
    console.log('======================================================\n');
    const clientA = createClient();
    const clientB = createClient();
    const clientC = createClient();
    await new Promise((resolve) => {
        let count = 0;
        const check = () => {
            count++;
            if (count === 3)
                resolve();
        };
        clientA.on('connect', check);
        clientB.on('connect', check);
        clientC.on('connect', check);
    });
    console.log('1. Connected 3 simulated peer clients to Socket.IO server:');
    assert(Boolean(clientA.id && clientB.id && clientC.id), 'All 3 clients connected with valid socket IDs');
    // Peer A creates room
    console.log('\n2. Peer A creates room:');
    const roomInfo = await new Promise((resolve, reject) => {
        clientA.emit('room:create', { displayName: 'PeerA', capacity: 4 }, (res) => {
            if (res.success && res.data)
                resolve(res.data);
            else
                reject(new Error(res.error));
        });
    });
    assert(roomInfo.publicCode.length === 4, `Room created with code #${roomInfo.publicCode}`);
    const code = roomInfo.publicCode;
    // Peer B joins room
    console.log('\n3. Peer B joins room:');
    const peerBJoinPromise = new Promise((resolve, reject) => {
        clientB.emit('room:join', { displayName: 'PeerB', roomCode: code }, (res) => {
            if (res.success && res.data)
                resolve(res.data);
            else
                reject(new Error(res.error));
        });
    });
    const memberJoinedOnA = new Promise((resolve) => {
        clientA.once('room:member-joined', (m) => resolve(m));
    });
    const bRoomInfo = await peerBJoinPromise;
    const joinedMember = await memberJoinedOnA;
    assert(bRoomInfo.publicCode === code, 'Peer B joined room successfully');
    assert(joinedMember.socketId === clientB.id, 'Peer A received room:member-joined event for Peer B');
    // Test P2P Data Signaling: Peer A sends data offer to Peer B
    console.log('\n4. Test P2P DataChannel Offer/Answer Exchange:');
    const offerPromise = new Promise((resolve) => {
        clientB.once('signal:offer', (data) => resolve(data));
    });
    const mockOffer = { type: 'offer', sdp: 'v=0\r\no=mockOffer\r\ns=test' };
    clientA.emit('signal:offer', {
        toSocketId: clientB.id,
        offer: mockOffer,
        callType: 'data',
    });
    const receivedOffer = await offerPromise;
    assert(receivedOffer.fromSocketId === clientA.id && receivedOffer.callType === 'data', 'Peer B received DataChannel offer with callType: "data" (no microphone requested)');
    // Peer B replies with answer
    const answerPromise = new Promise((resolve) => {
        clientA.once('signal:answer', (data) => resolve(data));
    });
    const mockAnswer = { type: 'answer', sdp: 'v=0\r\no=mockAnswer\r\ns=test' };
    clientB.emit('signal:answer', {
        toSocketId: clientA.id,
        answer: mockAnswer,
    });
    const receivedAnswer = await answerPromise;
    assert(receivedAnswer.fromSocketId === clientB.id, 'Peer A received DataChannel answer from Peer B');
    // Test ICE Candidate exchange
    console.log('\n5. Test ICE Candidate exchange:');
    const icePromise = new Promise((resolve) => {
        clientB.once('signal:ice-candidate', (data) => resolve(data));
    });
    const mockCandidate = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    clientA.emit('signal:ice-candidate', {
        toSocketId: clientB.id,
        candidate: mockCandidate,
    });
    const receivedIce = await icePromise;
    assert(receivedIce.fromSocketId === clientA.id && Boolean(receivedIce.candidate), 'Peer B received ICE candidate from Peer A');
    // 3-way mesh: Peer C joins room
    console.log('\n6. 3-Peer Mesh Expansion (Peer C joins):');
    const peerCJoinPromise = new Promise((resolve, reject) => {
        clientC.emit('room:join', { displayName: 'PeerC', roomCode: code }, (res) => {
            if (res.success && res.data)
                resolve(res.data);
            else
                reject(new Error(res.error));
        });
    });
    const cRoomInfo = await peerCJoinPromise;
    assert(cRoomInfo.members.length === 3, 'Peer C joined room, member count is 3');
    // Peer A and Peer B can both exchange DataChannel offers with Peer C
    const offerToCPromise = new Promise((resolve) => {
        clientC.once('signal:offer', (data) => resolve(data));
    });
    clientA.emit('signal:offer', {
        toSocketId: clientC.id,
        offer: mockOffer,
        callType: 'data',
    });
    const cReceivedOffer = await offerToCPromise;
    assert(cReceivedOffer.fromSocketId === clientA.id && cReceivedOffer.callType === 'data', 'Peer C received DataChannel offer from Peer A in 3-peer mesh');
    // Peer disconnect & cleanup
    console.log('\n7. Peer Disconnection & Cleanup:');
    const memberLeftOnA = new Promise((resolve) => {
        clientA.once('room:member-left', (data) => resolve(data));
    });
    const bSocketId = clientB.id;
    clientB.disconnect();
    const leftData = await memberLeftOnA;
    assert(leftData.socketId === bSocketId, 'Peer A received room:member-left when Peer B disconnected');
    clientA.disconnect();
    clientC.disconnect();
    console.log('\n======================================================');
    console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('======================================================\n');
    if (failed > 0) {
        process.exit(1);
    }
    else {
        process.exit(0);
    }
}
runSignalingTests().catch((err) => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
});
