import { io as ClientSocket, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomInfoResponse,
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

async function runUnlimitedRoomCreationTests() {
  console.log('\n======================================================');
  console.log('--- REPEATED ROOM CREATION (ZERO RATE LIMIT) SUITE ---');
  console.log('======================================================\n');

  const client = createClient();

  await new Promise<void>((resolve) => {
    client.on('connect', () => resolve());
  });

  assert(Boolean(client.id), 'Client connected to server');

  console.log('\n1. Creating 10 consecutive rooms in rapid succession...');
  const createdCodes: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const result = await new Promise<{ success: boolean; data?: RoomInfoResponse; error?: string }>((resolve) => {
      client.emit('room:create', { displayName: `Creator_${i}`, capacity: 2 }, (res) => {
        resolve(res);
      });
    });

    assert(
      result.success === true && Boolean(result.data?.publicCode),
      `Consecutive Room #${i} created successfully (Code: #${result.data?.publicCode})`,
      result.error
    );

    if (result.data?.publicCode) {
      createdCodes.push(result.data.publicCode);
    }
  }

  assert(createdCodes.length === 10, 'All 10 consecutive rooms created without any rate limit error');

  console.log('\n2. Verifying security validation remains intact...');

  // Test invalid capacity (0)
  const invalidCapZero = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    client.emit('room:create', { displayName: 'Tester', capacity: 0 as any }, (res) => {
      resolve(res);
    });
  });
  assert(invalidCapZero.success === false, 'Invalid capacity (0) rejected properly');

  // Test invalid capacity (25)
  const invalidCapLarge = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    client.emit('room:create', { displayName: 'Tester', capacity: 25 as any }, (res) => {
      resolve(res);
    });
  });
  assert(invalidCapLarge.success === false, 'Invalid capacity (25) rejected properly');

  // Test empty display name
  const emptyName = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    client.emit('room:create', { displayName: '   ', capacity: 2 }, (res) => {
      resolve(res);
    });
  });
  assert(emptyName.success === false, 'Blank display name rejected properly');

  // Test malformed payload
  const malformed = await new Promise<{ success: boolean; error?: string }>((resolve) => {
    client.emit('room:create', 'not an object' as any, (res) => {
      resolve(res);
    });
  });
  assert(malformed.success === false, 'Malformed payload rejected properly');

  client.disconnect();

  console.log('\n======================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runUnlimitedRoomCreationTests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
