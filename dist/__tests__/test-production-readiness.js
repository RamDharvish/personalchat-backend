import { io as ClientSocket } from 'socket.io-client';
const TEST_PORT = 5005;
const TEST_HOST = '127.0.0.1';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;
// Dynamically import compiled dist server or source
async function runTests() {
    console.log('=== PersonalChat Production Readiness Verification Suite ===\n');
    let passed = 0;
    let failed = 0;
    function assert(condition, msg) {
        if (condition) {
            console.log(`  [PASS] ${msg}`);
            passed++;
        }
        else {
            console.error(`  [FAIL] ${msg}`);
            failed++;
        }
    }
    // 1. Start Server using environment variables
    process.env.PORT = String(TEST_PORT);
    process.env.HOST = '0.0.0.0';
    console.log('1. Starting Server with PORT=5005, HOST=0.0.0.0...');
    // Import the compiled server
    const serverModule = await import('../../dist/server.js');
    // Wait for server to bind
    await new Promise((r) => setTimeout(r, 1000));
    // 2. Test GET /health
    console.log('\n2. Testing GET /health endpoint...');
    try {
        const res = await fetch(`${BASE_URL}/health`);
        const data = await res.json();
        assert(res.status === 200, 'Status code is 200');
        assert(data.status === 'ok', 'Body contains status: "ok"');
        assert(!('rooms' in data) && !('members' in data) && !('env' in data), 'No sensitive/internal data exposed');
    }
    catch (err) {
        assert(false, `Health check failed: ${err}`);
    }
    // 3. Test HTTP CORS from an arbitrary origin
    console.log('\n3. Testing HTTP CORS with arbitrary origin...');
    try {
        const origin = 'https://some-remote-domain.vercel.app';
        const res = await fetch(`${BASE_URL}/health`, {
            headers: { Origin: origin },
        });
        const acao = res.headers.get('access-control-allow-origin');
        const acac = res.headers.get('access-control-allow-credentials');
        assert(acao === origin || acao === '*', `CORS Allow-Origin allows origin (${acao})`);
        assert(acac !== 'true', `CORS Allow-Credentials is NOT true (acac=${acac})`);
    }
    catch (err) {
        assert(false, `CORS check failed: ${err}`);
    }
    // 4. Test Socket.IO connection from arbitrary origin
    console.log('\n4. Testing Socket.IO connection & open origin...');
    let clientA = null;
    let clientB = null;
    try {
        clientA = ClientSocket(BASE_URL, {
            transports: ['websocket', 'polling'],
            withCredentials: false,
            extraHeaders: {
                Origin: 'https://anywhere-frontend.org',
            },
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Client A connection timeout')), 4000);
            clientA.on('connect', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        assert(clientA.connected, 'Client A connected via Socket.IO from arbitrary origin');
        // 5. Test Room Creation
        console.log('\n5. Testing Room Creation & Validation...');
        let roomCode = '';
        await new Promise((resolve) => {
            clientA.emit('room:create', { displayName: 'HostAlice', capacity: 4 }, (response) => {
                assert(response.success === true, 'Room created successfully');
                assert(response.data.maxCapacity === 4, 'Capacity is set to 4');
                assert(response.data.isHost === true, 'Creator is designated as host');
                roomCode = response.data.publicCode;
                resolve();
            });
        });
        // 6. Test Capacity Validation (Rejection <2 or >20)
        await new Promise((resolve) => {
            clientA.emit('room:create', { displayName: 'InvalidCap', capacity: 25 }, (response) => {
                assert(response.success === false, 'Rejected capacity > 20');
                resolve();
            });
        });
        // 7. Test Client B Joining Room
        console.log('\n6. Testing Client B Joining Room...');
        clientB = ClientSocket(BASE_URL, {
            transports: ['websocket', 'polling'],
            withCredentials: false,
        });
        await new Promise((resolve) => {
            clientB.on('connect', () => {
                clientB.emit('room:join', { displayName: 'BobUser', roomCode }, (response) => {
                    assert(response.success === true, 'Client B joined room successfully');
                    assert(response.data.members.length === 2, 'Room now has 2 members');
                    resolve();
                });
            });
        });
        // 8. Test Chat Message with length validation
        console.log('\n7. Testing Chat Message Length Limits & Sanitize...');
        await new Promise((resolve) => {
            clientA.emit('chat:message', { text: 'Hello Bob! <script>alert(1)</script>' }, (response) => {
                assert(response.success === true, 'Valid message accepted');
                assert(!response.data.text.includes('<script>'), 'HTML/script tags properly escaped');
                resolve();
            });
        });
        // Oversized message > 2000 chars
        await new Promise((resolve) => {
            const oversizedText = 'A'.repeat(2005);
            clientA.emit('chat:message', { text: oversizedText }, (response) => {
                assert(response.success === false, 'Rejected oversized message > 2000 characters');
                resolve();
            });
        });
        // 9. Test WebRTC Signaling Relay
        console.log('\n8. Testing WebRTC Signaling Relay (offer/answer/ice)...');
        const signalingReceived = new Promise((resolve) => {
            clientB.on('signal:offer', (data) => {
                assert(data.fromSocketId === clientA.id, 'Relayed offer from Client A to Client B');
                assert(data.callType === 'video', 'Relayed callType correctly');
                resolve();
            });
        });
        clientA.emit('signal:offer', {
            toSocketId: clientB.id,
            offer: { type: 'offer', sdp: 'fake-sdp-data' },
            callType: 'video',
        });
        await signalingReceived;
        // 10. Test Room Lock (Host Authorization)
        console.log('\n9. Testing Room Lock Authorization...');
        await new Promise((resolve) => {
            // Bob tries to lock (non-host) -> Should fail
            clientB.emit('room:toggle-lock', (response) => {
                assert(response.success === false, 'Non-host locked room attempt rejected');
                resolve();
            });
        });
        await new Promise((resolve) => {
            // Alice locks (host) -> Should succeed
            clientA.emit('room:toggle-lock', (response) => {
                assert(response.success === true && response.data.isLocked === true, 'Host locked room successfully');
                resolve();
            });
        });
        // 11. Test Disconnect Cleanup
        console.log('\n10. Testing Disconnect Cleanup...');
        const clientBSocketId = clientB.id;
        const memberLeftPromise = new Promise((resolve) => {
            clientA.on('room:member-left', (data) => {
                assert(data.socketId === clientBSocketId, 'Host notified when Bob disconnects');
                resolve();
            });
        });
        clientB.disconnect();
        await memberLeftPromise;
        clientA.disconnect();
    }
    finally {
        if (clientA?.connected)
            clientA.disconnect();
        if (clientB?.connected)
            clientB.disconnect();
    }
    console.log(`\n========================================`);
    console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);
    process.exit(failed > 0 ? 1 : 0);
}
runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
