// =============================================================================
// Lab 21 — Horloges logiques (Solution)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Lamport Clock
// =============================================================================

class LamportClock {
  private time = 0;

  tick(): number {
    return ++this.time;
  }

  send(): number {
    return this.tick();
  }

  receive(remoteTimestamp: number): number {
    this.time = Math.max(this.time, remoteTimestamp) + 1;
    return this.time;
  }

  getTime(): number {
    return this.time;
  }
}

// =============================================================================
// Exercise 2: Vector Clock
// =============================================================================

class VectorClock {
  private vector: Record<string, number> = {};

  constructor(nodeId: string, nodeIds: string[]) {
    for (const id of nodeIds) {
      this.vector[id] = 0;
    }
  }

  tick(nodeId: string): void {
    this.vector[nodeId] = (this.vector[nodeId] || 0) + 1;
  }

  send(nodeId: string): Record<string, number> {
    this.tick(nodeId);
    return { ...this.vector };
  }

  receive(nodeId: string, remoteVector: Record<string, number>): void {
    for (const key of Object.keys(remoteVector)) {
      this.vector[key] = Math.max(this.vector[key] || 0, remoteVector[key]);
    }
    this.tick(nodeId);
  }

  getVector(): Record<string, number> {
    return { ...this.vector };
  }

  compare(other: Record<string, number>): 'before' | 'after' | 'concurrent' | 'equal' {
    const allKeys = new Set([...Object.keys(this.vector), ...Object.keys(other)]);
    let hasLess = false;
    let hasGreater = false;

    for (const key of allKeys) {
      const local = this.vector[key] || 0;
      const remote = other[key] || 0;
      if (local < remote) hasLess = true;
      if (local > remote) hasGreater = true;
    }

    if (!hasLess && !hasGreater) return 'equal';
    if (hasLess && !hasGreater) return 'before';
    if (hasGreater && !hasLess) return 'after';
    return 'concurrent';
  }
}

// =============================================================================
// Exercise 3: Causal Ordering
// =============================================================================

interface CausalMessage {
  id: string;
  senderId: string;
  vectorClock: Record<string, number>;
  payload: string;
}

class CausalOrderingBuffer {
  private nodeId: string;
  private localClock: Record<string, number> = {};
  private buffer: CausalMessage[] = [];

  constructor(nodeId: string, nodeIds: string[]) {
    this.nodeId = nodeId;
    for (const id of nodeIds) {
      this.localClock[id] = 0;
    }
  }

  receive(message: CausalMessage): string[] {
    this.buffer.push(message);
    const delivered: string[] = [];

    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < this.buffer.length; i++) {
        const msg = this.buffer[i];
        if (this.isDeliverable(msg)) {
          this.buffer.splice(i, 1);
          i--;
          // Update local clock
          for (const key of Object.keys(msg.vectorClock)) {
            this.localClock[key] = Math.max(this.localClock[key] || 0, msg.vectorClock[key]);
          }
          delivered.push(msg.id);
          progress = true;
        }
      }
    }

    return delivered;
  }

  private isDeliverable(message: CausalMessage): boolean {
    for (const key of Object.keys(message.vectorClock)) {
      if (key === message.senderId) {
        // Sender's clock must be exactly localClock + 1
        if (message.vectorClock[key] !== (this.localClock[key] || 0) + 1) {
          return false;
        }
      } else {
        // Other clocks must be <= local clock
        if (message.vectorClock[key] > (this.localClock[key] || 0)) {
          return false;
        }
      }
    }
    return true;
  }

  getPendingCount(): number {
    return this.buffer.length;
  }
}

// =============================================================================
// Exercise 4: Hybrid Logical Clock (HLC)
// =============================================================================

interface HLCTimestamp {
  physical: number;
  logical: number;
}

class HybridLogicalClock {
  private getPhysicalTime: () => number;
  private last: HLCTimestamp = { physical: 0, logical: 0 };

  constructor(getPhysicalTime: () => number) {
    this.getPhysicalTime = getPhysicalTime;
  }

  tick(): HLCTimestamp {
    const pt = this.getPhysicalTime();
    if (pt > this.last.physical) {
      this.last = { physical: pt, logical: 0 };
    } else {
      this.last = { physical: this.last.physical, logical: this.last.logical + 1 };
    }
    return { ...this.last };
  }

  send(): HLCTimestamp {
    return this.tick();
  }

  receive(remote: HLCTimestamp): HLCTimestamp {
    const pt = this.getPhysicalTime();

    if (pt > this.last.physical && pt > remote.physical) {
      this.last = { physical: pt, logical: 0 };
    } else if (this.last.physical > remote.physical) {
      this.last = { physical: this.last.physical, logical: this.last.logical + 1 };
    } else if (remote.physical > this.last.physical) {
      this.last = { physical: remote.physical, logical: remote.logical + 1 };
    } else {
      this.last = {
        physical: this.last.physical,
        logical: Math.max(this.last.logical, remote.logical) + 1,
      };
    }

    return { ...this.last };
  }

  getTimestamp(): HLCTimestamp {
    return { ...this.last };
  }
}

// =============================================================================
// Exercise 5: Event Ordering
// =============================================================================

interface CausalEvent {
  id: string;
  vectorClock: Record<string, number>;
}

function compareVectors(
  a: Record<string, number>,
  b: Record<string, number>
): 'before' | 'after' | 'concurrent' | 'equal' {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let hasLess = false;
  let hasGreater = false;

  for (const key of allKeys) {
    const va = a[key] || 0;
    const vb = b[key] || 0;
    if (va < vb) hasLess = true;
    if (va > vb) hasGreater = true;
  }

  if (!hasLess && !hasGreater) return 'equal';
  if (hasLess && !hasGreater) return 'before';
  if (hasGreater && !hasLess) return 'after';
  return 'concurrent';
}

function causalOrder(events: CausalEvent[]): CausalEvent[] {
  // Topological sort using happened-before relation
  const sorted: CausalEvent[] = [];
  const remaining = [...events];

  while (remaining.length > 0) {
    // Find an event that has no unsorted predecessors
    let foundIndex = -1;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let hasPredecessor = false;
      for (let j = 0; j < remaining.length; j++) {
        if (i === j) continue;
        const other = remaining[j];
        const relation = compareVectors(other.vectorClock, candidate.vectorClock);
        if (relation === 'before') {
          hasPredecessor = true;
          break;
        }
      }
      if (!hasPredecessor) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // No clear predecessor; take the first remaining (concurrent events)
      foundIndex = 0;
    }

    sorted.push(remaining.splice(foundIndex, 1)[0]);
  }

  return sorted;
}

// =============================================================================
// Exercise 6: Conflict Detection
// =============================================================================

interface VersionedValue {
  value: unknown;
  vectorClock: Record<string, number>;
  nodeId: string;
}

interface ConflictResult {
  hasConflict: boolean;
  conflictingWrites: VersionedValue[];
}

class ReplicatedKVStore {
  private nodeId: string;
  private clock: VectorClock;
  private store: Map<string, VersionedValue> = new Map();
  private conflicts: Map<string, VersionedValue[]> = new Map();

  constructor(nodeId: string, nodeIds: string[]) {
    this.nodeId = nodeId;
    this.clock = new VectorClock(nodeId, nodeIds);
  }

  write(key: string, value: unknown): VersionedValue {
    const vc = this.clock.send(this.nodeId);
    const versioned: VersionedValue = { value, vectorClock: vc, nodeId: this.nodeId };
    this.store.set(key, versioned);
    this.conflicts.delete(key);
    return versioned;
  }

  read(key: string): VersionedValue | undefined {
    return this.store.get(key);
  }

  receiveWrite(key: string, remote: VersionedValue): ConflictResult {
    const local = this.store.get(key);

    if (!local) {
      // No local value, accept remote
      this.store.set(key, remote);
      // Update clock
      this.clock.receive(this.nodeId, remote.vectorClock);
      return { hasConflict: false, conflictingWrites: [] };
    }

    const relation = compareVectors(remote.vectorClock, local.vectorClock);

    if (relation === 'after') {
      // Remote is causally after local — accept
      this.store.set(key, remote);
      this.conflicts.delete(key);
      this.clock.receive(this.nodeId, remote.vectorClock);
      return { hasConflict: false, conflictingWrites: [] };
    } else if (relation === 'before' || relation === 'equal') {
      // Remote is before or equal to local — ignore
      return { hasConflict: false, conflictingWrites: [] };
    } else {
      // Concurrent — conflict!
      const conflicting = [local, remote];
      this.conflicts.set(key, conflicting);
      return { hasConflict: true, conflictingWrites: conflicting };
    }
  }

  getConflicts(key: string): VersionedValue[] {
    return this.conflicts.get(key) || [];
  }
}

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
