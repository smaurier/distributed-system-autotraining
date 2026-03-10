// =============================================================================
// Lab 21 — Horloges logiques (Exercise)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Lamport Clock
// =============================================================================
// TODO: Implement class LamportClock with:
//   - time: number (starts at 0)
//   - tick(): number — increment and return new time
//   - send(): number — tick and return timestamp to attach to message
//   - receive(remoteTimestamp: number): number — set time to max(local, remote) + 1, return new time
//   - getTime(): number

// =============================================================================
// Exercise 2: Vector Clock
// =============================================================================
// TODO: Implement class VectorClock with:
//   - constructor(nodeId: string, nodeIds: string[])
//   - tick(nodeId: string): void — increment nodeId's counter
//   - send(nodeId: string): Record<string, number> — tick nodeId, return copy of vector
//   - receive(nodeId: string, remoteVector: Record<string, number>): void
//     — for each key, take max(local, remote), then tick nodeId
//   - getVector(): Record<string, number> — return copy of vector
//   - compare(other: Record<string, number>): 'before' | 'after' | 'concurrent' | 'equal'
//     — compare this vector with another:
//       - equal: all components are the same
//       - before: all components <= other, and at least one <
//       - after: all components >= other, and at least one >
//       - concurrent: otherwise

// =============================================================================
// Exercise 3: Causal Ordering
// =============================================================================
// TODO: Define CausalMessage interface:
//   { id: string; senderId: string; vectorClock: Record<string, number>; payload: string }

// TODO: Implement class CausalOrderingBuffer with:
//   - constructor(nodeId: string, nodeIds: string[])
//   - receive(message: CausalMessage): string[] — buffer message, deliver any
//     causally ready messages, return delivered message IDs in order
//     - A message is deliverable when for every node j:
//       - if j == senderId: message.vectorClock[j] == localClock[j] + 1
//       - otherwise: message.vectorClock[j] <= localClock[j]
//     - After delivery, update local clock
//   - getPendingCount(): number — number of buffered undelivered messages

// =============================================================================
// Exercise 4: Hybrid Logical Clock (HLC)
// =============================================================================
// TODO: Define HLCTimestamp interface:
//   { physical: number; logical: number }

// TODO: Implement class HybridLogicalClock with:
//   - constructor(getPhysicalTime: () => number)
//   - tick(): HLCTimestamp — local event
//     - pt = getPhysicalTime()
//     - if pt > last.physical: new = { physical: pt, logical: 0 }
//     - else: new = { physical: last.physical, logical: last.logical + 1 }
//   - send(): HLCTimestamp — tick and return timestamp
//   - receive(remote: HLCTimestamp): HLCTimestamp
//     - pt = getPhysicalTime()
//     - if pt > last.physical AND pt > remote.physical: new = { physical: pt, logical: 0 }
//     - else if last.physical > remote.physical: new = { physical: last.physical, logical: last.logical + 1 }
//     - else if remote.physical > last.physical: new = { physical: remote.physical, logical: remote.logical + 1 }
//     - else: new = { physical: last.physical, logical: max(last.logical, remote.logical) + 1 }
//   - getTimestamp(): HLCTimestamp

// =============================================================================
// Exercise 5: Event Ordering
// =============================================================================
// TODO: Define CausalEvent interface:
//   { id: string; vectorClock: Record<string, number> }

// TODO: Implement function causalOrder(events: CausalEvent[]): CausalEvent[]
//   - Return events in causal order (topological sort of happened-before)
//   - For concurrent events, maintain original order

// =============================================================================
// Exercise 6: Conflict Detection
// =============================================================================
// TODO: Define VersionedValue interface:
//   { value: unknown; vectorClock: Record<string, number>; nodeId: string }

// TODO: Define ConflictResult interface:
//   { hasConflict: boolean; conflictingWrites: VersionedValue[] }

// TODO: Implement class ReplicatedKVStore with:
//   - constructor(nodeId: string, nodeIds: string[])
//   - write(key: string, value: unknown): VersionedValue — write with current vector clock
//   - read(key: string): VersionedValue | undefined
//   - receiveWrite(key: string, remote: VersionedValue): ConflictResult
//     - Compare remote vector clock with local
//     - If remote is after local: accept (overwrite)
//     - If remote is before local: ignore (keep local)
//     - If concurrent: conflict detected!
//   - getConflicts(key: string): VersionedValue[] — return conflicting writes for a key

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 21 — Horloges logiques');

// --- Exercise 1 Tests ---
await test('Ex1: Lamport clock ticks', () => {
  const clock = new LamportClock();
  assertEqual(clock.getTime(), 0);
  assertEqual(clock.tick(), 1);
  assertEqual(clock.tick(), 2);
});

await test('Ex1: Lamport clock send', () => {
  const clock = new LamportClock();
  const ts = clock.send();
  assertEqual(ts, 1);
});

await test('Ex1: Lamport clock receive takes max', () => {
  const clock = new LamportClock();
  clock.tick(); // time = 1
  const newTime = clock.receive(5); // max(1, 5) + 1 = 6
  assertEqual(newTime, 6);
});

await test('Ex1: Lamport clock receive when local is higher', () => {
  const clock = new LamportClock();
  clock.tick(); // 1
  clock.tick(); // 2
  clock.tick(); // 3
  const newTime = clock.receive(1); // max(3, 1) + 1 = 4
  assertEqual(newTime, 4);
});

// --- Exercise 2 Tests ---
await test('Ex2: vector clock tick increments node', () => {
  const vc = new VectorClock('A', ['A', 'B', 'C']);
  vc.tick('A');
  assertEqual(vc.getVector()['A'], 1);
  assertEqual(vc.getVector()['B'], 0);
});

await test('Ex2: vector clock send returns snapshot', () => {
  const vc = new VectorClock('A', ['A', 'B', 'C']);
  const sent = vc.send('A');
  assertEqual(sent['A'], 1);
});

await test('Ex2: vector clock receive merges', () => {
  const vc = new VectorClock('A', ['A', 'B', 'C']);
  vc.tick('A'); // A:1
  vc.receive('A', { A: 0, B: 3, C: 1 });
  // After merge: max(1,0)=1 for A, max(0,3)=3 for B, max(0,1)=1 for C, then tick A
  const v = vc.getVector();
  assertEqual(v['A'], 2); // merged then ticked
  assertEqual(v['B'], 3);
  assertEqual(v['C'], 1);
});

await test('Ex2: vector clock compare', () => {
  const vc = new VectorClock('A', ['A', 'B']);
  vc.tick('A');
  // local: {A:1, B:0}, compare with {A:2, B:1}
  assertEqual(vc.compare({ A: 2, B: 1 }), 'before');
  assertEqual(vc.compare({ A: 1, B: 0 }), 'equal');
  assertEqual(vc.compare({ A: 0, B: 0 }), 'after');
  assertEqual(vc.compare({ A: 0, B: 1 }), 'concurrent');
});

// --- Exercise 3 Tests ---
await test('Ex3: causal ordering delivers in-order messages', () => {
  const buffer = new CausalOrderingBuffer('B', ['A', 'B']);
  const delivered = buffer.receive({
    id: 'msg-1',
    senderId: 'A',
    vectorClock: { A: 1, B: 0 },
    payload: 'hello',
  });
  assertEqual(delivered.length, 1);
  assertEqual(delivered[0], 'msg-1');
});

await test('Ex3: causal ordering buffers out-of-order messages', () => {
  const buffer = new CausalOrderingBuffer('C', ['A', 'B', 'C']);
  // Message 2 arrives before message 1 (depends on A:1)
  const d1 = buffer.receive({
    id: 'msg-2',
    senderId: 'A',
    vectorClock: { A: 2, B: 0, C: 0 },
    payload: 'second',
  });
  assertEqual(d1.length, 0); // buffered
  assertEqual(buffer.getPendingCount(), 1);

  // Now message 1 arrives
  const d2 = buffer.receive({
    id: 'msg-1',
    senderId: 'A',
    vectorClock: { A: 1, B: 0, C: 0 },
    payload: 'first',
  });
  // Both should be delivered: msg-1 first, then msg-2 becomes deliverable
  assertEqual(d2.length, 2);
  assertEqual(d2[0], 'msg-1');
  assertEqual(d2[1], 'msg-2');
  assertEqual(buffer.getPendingCount(), 0);
});

// --- Exercise 4 Tests ---
await test('Ex4: HLC tick advances time', () => {
  let physTime = 100;
  const hlc = new HybridLogicalClock(() => physTime);
  const ts1 = hlc.tick();
  assertEqual(ts1.physical, 100);
  assertEqual(ts1.logical, 0);

  // Same physical time -> logical increments
  const ts2 = hlc.tick();
  assertEqual(ts2.physical, 100);
  assertEqual(ts2.logical, 1);

  // Advance physical time -> logical resets
  physTime = 200;
  const ts3 = hlc.tick();
  assertEqual(ts3.physical, 200);
  assertEqual(ts3.logical, 0);
});

await test('Ex4: HLC receive merges timestamps', () => {
  let physTime = 100;
  const hlc = new HybridLogicalClock(() => physTime);
  hlc.tick(); // {100, 0}

  // Receive from a node with higher physical time
  const ts = hlc.receive({ physical: 200, logical: 5 });
  assertEqual(ts.physical, 200);
  assertEqual(ts.logical, 6);
});

await test('Ex4: HLC send returns timestamp', () => {
  let physTime = 100;
  const hlc = new HybridLogicalClock(() => physTime);
  const ts = hlc.send();
  assertEqual(ts.physical, 100);
  assertEqual(ts.logical, 0);
});

// --- Exercise 5 Tests ---
await test('Ex5: causal order sorts events', () => {
  const events: CausalEvent[] = [
    { id: 'e3', vectorClock: { A: 2, B: 1 } },
    { id: 'e1', vectorClock: { A: 1, B: 0 } },
    { id: 'e2', vectorClock: { A: 1, B: 1 } },
  ];
  const ordered = causalOrder(events);
  assertEqual(ordered[0].id, 'e1');
  assertEqual(ordered[1].id, 'e2');
  assertEqual(ordered[2].id, 'e3');
});

await test('Ex5: concurrent events maintain relative order', () => {
  const events: CausalEvent[] = [
    { id: 'e1', vectorClock: { A: 1, B: 0 } },
    { id: 'e2', vectorClock: { A: 0, B: 1 } }, // concurrent with e1
  ];
  const ordered = causalOrder(events);
  assertEqual(ordered.length, 2);
  // Both are valid orderings since they're concurrent; maintain original order
  assertEqual(ordered[0].id, 'e1');
  assertEqual(ordered[1].id, 'e2');
});

// --- Exercise 6 Tests ---
await test('Ex6: replicated KV store write and read', () => {
  const store = new ReplicatedKVStore('A', ['A', 'B']);
  const written = store.write('key-1', 'value-1');
  assertEqual(written.value, 'value-1');
  const read = store.read('key-1');
  assert(read !== undefined, 'Should find value');
  assertEqual(read!.value, 'value-1');
});

await test('Ex6: conflict detection on concurrent writes', () => {
  const store = new ReplicatedKVStore('A', ['A', 'B']);
  store.write('key-1', 'value-from-A'); // A:{A:1, B:0}
  // Simulate concurrent write from B
  const result = store.receiveWrite('key-1', {
    value: 'value-from-B',
    vectorClock: { A: 0, B: 1 },
    nodeId: 'B',
  });
  assertEqual(result.hasConflict, true);
  assertEqual(result.conflictingWrites.length, 2);
});

await test('Ex6: no conflict when remote is after local', () => {
  const store = new ReplicatedKVStore('A', ['A', 'B']);
  store.write('key-1', 'old-value'); // A:{A:1, B:0}
  const result = store.receiveWrite('key-1', {
    value: 'new-value',
    vectorClock: { A: 1, B: 1 },
    nodeId: 'B',
  });
  assertEqual(result.hasConflict, false);
  assertEqual(store.read('key-1')!.value, 'new-value');
});

summary();
