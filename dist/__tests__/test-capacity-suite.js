import { RoomManager } from '../rooms/RoomManager.js';
function validateRoomCapacityTest(input) {
    if (input === '' || input === null || input === undefined) {
        return { isValid: false, error: 'Please enter the maximum number of members.', capacity: 2 };
    }
    const str = String(input).trim();
    if (!str)
        return { isValid: false, error: 'Please enter the maximum number of members.', capacity: 2 };
    const num = Number(str);
    if (isNaN(num))
        return { isValid: false, error: 'Please enter the maximum number of members.', capacity: 2 };
    if (!Number.isInteger(num))
        return { isValid: false, error: 'Maximum members must be a whole number.', capacity: num };
    if (num < 2 || num > 20)
        return { isValid: false, error: 'Room capacity must be between 2 and 20 members.', capacity: num };
    return { isValid: true, capacity: num };
}
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
console.log('\n======================================================');
console.log('--- PERSONALCHAT CUSTOM ROOM CAPACITY TEST SUITE ---');
console.log('======================================================\n');
const rm = new RoomManager();
// 1. Create room with 2 members
console.log('Testing Predefined & Custom Valid Capacities:');
const r2 = rm.createRoom('socket-1', 'Alice', 2);
assert(r2.success === true && r2.roomInfo?.maxCapacity === 2, '1. Create room with 2 members');
// 2. Create room with 3 members
const r3 = rm.createRoom('socket-2', 'Bob', 3);
assert(r3.success === true && r3.roomInfo?.maxCapacity === 3, '2. Create room with 3 members');
// 3. Create room with 4 members
const r4 = rm.createRoom('socket-3', 'Charlie', 4);
assert(r4.success === true && r4.roomInfo?.maxCapacity === 4, '3. Create room with 4 members');
// 4. Create room with Custom = 5
const r5 = rm.createRoom('socket-4', 'Dave', 5);
assert(r5.success === true && r5.roomInfo?.maxCapacity === 5, '4. Create room with Custom = 5');
// 5. Create room with Custom = 10
const r10 = rm.createRoom('socket-5', 'Eve', 10);
assert(r10.success === true && r10.roomInfo?.maxCapacity === 10, '5. Create room with Custom = 10');
// 6. Create room with Custom = 20
const r20 = rm.createRoom('socket-6', 'Frank', 20);
assert(r20.success === true && r20.roomInfo?.maxCapacity === 20, '6. Create room with Custom = 20');
// 7. Try Custom = 1 -> reject
console.log('\nTesting Invalid Capacities & Boundary Rejections:');
const rej1 = rm.createRoom('socket-7', 'Grace', 1);
assert(rej1.success === false && rej1.error === 'Room capacity must be between 2 and 20 members.', '7. Try Custom = 1 -> reject');
// 8. Try Custom = 0 -> reject
const rej0 = rm.createRoom('socket-8', 'Heidi', 0);
assert(rej0.success === false && rej0.error === 'Room capacity must be between 2 and 20 members.', '8. Try Custom = 0 -> reject');
// 9. Try Custom = -1 -> reject
const rejNeg = rm.createRoom('socket-9', 'Ivan', -1);
assert(rejNeg.success === false && rejNeg.error === 'Room capacity must be between 2 and 20 members.', '9. Try Custom = -1 -> reject');
// 10. Try Custom = 20.5 -> reject
const rejDec = rm.createRoom('socket-10', 'Judy', 20.5);
assert(rejDec.success === false && rejDec.error === 'Maximum members must be a whole number.', '10. Try Custom = 20.5 -> reject');
// 11. Try Custom = 21 -> reject
const rej21 = rm.createRoom('socket-11', 'Mallory', 21);
assert(rej21.success === false && rej21.error === 'Room capacity must be between 2 and 20 members.', '11. Try Custom = 21 -> reject');
// 12. Try empty custom value / NaN / non-numeric -> reject
const rejNaN = rm.createRoom('socket-12', 'Oscar', NaN);
assert(rejNaN.success === false && rejNaN.error === 'Please enter the maximum number of members.', '12. Try NaN custom value -> reject');
const rejStr = rm.createRoom('socket-13', 'Peggy', 'invalid');
assert(rejStr.success === false && rejStr.error === 'Please enter the maximum number of members.', '12b. Try non-number type -> reject');
// 13. Verify server prevents the (capacity + 1)th member from joining
console.log('\nTesting Room Full Enforcement & Capacity Limits:');
const customRoomTest = rm.createRoom('host-custom-5', 'HostUser', 5);
const code = customRoomTest.roomInfo.publicCode;
// Join up to capacity (total 5 members)
const m2 = rm.joinRoom('peer-2', 'Peer Two', code);
const m3 = rm.joinRoom('peer-3', 'Peer Three', code);
const m4 = rm.joinRoom('peer-4', 'Peer Four', code);
const m5 = rm.joinRoom('peer-5', 'Peer Five', code);
assert(m2.success && m3.success && m4.success && m5.success, '13a. Successfully joined peers up to max capacity (5 members)');
// 6th member attempt
const m6 = rm.joinRoom('peer-6', 'Peer Six', code);
assert(m6.success === false && m6.error === 'This room is full.', '13b. Verify server prevents the (capacity + 1)th member from joining (This room is full.)');
// 14. Verify member count updates correctly
const roomObj = rm.getRoomByPublicCode(code);
assert(roomObj?.members.size === 5 && roomObj?.maxCapacity === 5, '14. Verify member count and capacity in room object match exactly (5/5)');
// 15. Verify existing 2/3/4 member rooms still behave exactly as before
console.log('\nTesting 2/3/4 Rooms Behavior:');
const r3Room = rm.createRoom('host-3p', 'Host3P', 3);
const code3 = r3Room.roomInfo.publicCode;
const j1 = rm.joinRoom('p2-3p', 'User2', code3);
const j2 = rm.joinRoom('p3-3p', 'User3', code3);
const j3 = rm.joinRoom('p4-3p', 'User4', code3);
assert(j1.success && j2.success && j3.success === false && j3.error === 'This room is full.', '15. Verify 3-member room allows 3 and rejects 4th member');
// 16. Verify host transfer still works
console.log('\nTesting Host Transfer & Room Lifecycle:');
const hostLeave = rm.leaveRoom('host-custom-5');
const newHostId = hostLeave.newHostSocketId;
const updatedRoom = rm.getRoomByPublicCode(code);
assert(hostLeave.left && newHostId === 'peer-2' && updatedRoom?.hostSocketId === 'peer-2', '16. Verify host transfer to earliest joined member ("peer-2") on host departure');
// 17. Verify room cleanup still works
rm.leaveRoom('peer-2');
rm.leaveRoom('peer-3');
rm.leaveRoom('peer-4');
const lastLeave = rm.leaveRoom('peer-5');
assert(lastLeave.roomClosed === true && rm.getRoomByPublicCode(code) === undefined, '17. Verify room cleanup and complete removal from memory when empty');
// Frontend validation unit tests
console.log('\nTesting Frontend validateRoomCapacity Utility:');
assert(validateRoomCapacityTest('').isValid === false, 'Frontend: empty string rejected');
assert(validateRoomCapacityTest('   ').isValid === false, 'Frontend: whitespace rejected');
assert(validateRoomCapacityTest('abc').isValid === false, 'Frontend: non-numeric rejected');
assert(validateRoomCapacityTest('0').isValid === false && validateRoomCapacityTest('0').error === 'Room capacity must be between 2 and 20 members.', 'Frontend: "0" rejected');
assert(validateRoomCapacityTest('-1').isValid === false && validateRoomCapacityTest('-1').error === 'Room capacity must be between 2 and 20 members.', 'Frontend: "-1" rejected');
assert(validateRoomCapacityTest('1').isValid === false && validateRoomCapacityTest('1').error === 'Room capacity must be between 2 and 20 members.', 'Frontend: "1" rejected');
assert(validateRoomCapacityTest('2.5').isValid === false && validateRoomCapacityTest('2.5').error === 'Maximum members must be a whole number.', 'Frontend: "2.5" rejected');
assert(validateRoomCapacityTest('21').isValid === false && validateRoomCapacityTest('21').error === 'Room capacity must be between 2 and 20 members.', 'Frontend: "21" rejected');
assert(validateRoomCapacityTest('2').isValid === true && validateRoomCapacityTest('2').capacity === 2, 'Frontend: "2" valid');
assert(validateRoomCapacityTest('10').isValid === true && validateRoomCapacityTest('10').capacity === 10, 'Frontend: "10" valid');
assert(validateRoomCapacityTest('20').isValid === true && validateRoomCapacityTest('20').capacity === 20, 'Frontend: "20" valid');
assert(validateRoomCapacityTest(5).isValid === true && validateRoomCapacityTest(5).capacity === 5, 'Frontend: number 5 valid');
console.log('\n======================================================');
console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('======================================================\n');
if (failed > 0) {
    process.exit(1);
}
else {
    process.exit(0);
}
