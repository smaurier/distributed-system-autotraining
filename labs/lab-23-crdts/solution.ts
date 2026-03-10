// =============================================================================
// Lab 23 — CRDTs (Solution)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: G-Counter
// =============================================================================

class GCounter {
  private counters: Record<string, number> = {};

  increment(nodeId: string): void {
    this.counters[nodeId] = (this.counters[nodeId] || 0) + 1;
  }

  value(): number {
    return Object.values(this.counters).reduce((sum, v) => sum + v, 0);
  }

  merge(other: GCounter): GCounter {
    const merged = new GCounter();
    const allKeys = new Set([
      ...Object.keys(this.counters),
      ...Object.keys(other.counters),
    ]);
    for (const key of allKeys) {
      merged.counters[key] = Math.max(
        this.counters[key] || 0,
        other.counters[key] || 0
      );
    }
    return merged;
  }

  getState(): Record<string, number> {
    return { ...this.counters };
  }
}

// =============================================================================
// Exercise 2: PN-Counter
// =============================================================================

class PNCounter {
  private positive: GCounter = new GCounter();
  private negative: GCounter = new GCounter();

  increment(nodeId: string): void {
    this.positive.increment(nodeId);
  }

  decrement(nodeId: string): void {
    this.negative.increment(nodeId);
  }

  value(): number {
    return this.positive.value() - this.negative.value();
  }

  merge(other: PNCounter): PNCounter {
    const merged = new PNCounter();
    merged.positive = this.positive.merge(other.positive);
    merged.negative = this.negative.merge(other.negative);
    return merged;
  }

  getState(): { positive: Record<string, number>; negative: Record<string, number> } {
    return {
      positive: this.positive.getState(),
      negative: this.negative.getState(),
    };
  }
}

// =============================================================================
// Exercise 3: LWW-Register
// =============================================================================

class LWWRegister<T> {
  private val: T | undefined = undefined;
  private ts = 0;

  set(value: T, timestamp: number): void {
    if (timestamp > this.ts) {
      this.val = value;
      this.ts = timestamp;
    }
  }

  get(): T | undefined {
    return this.val;
  }

  getTimestamp(): number {
    return this.ts;
  }

  merge(other: LWWRegister<T>): LWWRegister<T> {
    const merged = new LWWRegister<T>();
    if (this.ts >= other.ts) {
      merged.val = this.val;
      merged.ts = this.ts;
    } else {
      merged.val = other.val;
      merged.ts = other.ts;
    }
    return merged;
  }
}

// =============================================================================
// Exercise 4: OR-Set (Observed-Remove Set)
// =============================================================================

class ORSet<T> {
  private entries: Map<string, { element: T; tag: string }> = new Map();
  private tagCounter = 0;

  private generateTag(): string {
    return `tag-${++this.tagCounter}-${Math.random().toString(36).slice(2, 8)}`;
  }

  add(element: T): void {
    const tag = this.generateTag();
    this.entries.set(tag, { element, tag });
  }

  remove(element: T): void {
    for (const [tag, entry] of this.entries) {
      if (this.elementsEqual(entry.element, element)) {
        this.entries.delete(tag);
      }
    }
  }

  has(element: T): boolean {
    for (const entry of this.entries.values()) {
      if (this.elementsEqual(entry.element, element)) return true;
    }
    return false;
  }

  values(): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const entry of this.entries.values()) {
      const key = JSON.stringify(entry.element);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry.element);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): ORSet<T> {
    const merged = new ORSet<T>();
    merged.tagCounter = Math.max(this.tagCounter, other.tagCounter);

    // Add all entries from this
    for (const [tag, entry] of this.entries) {
      merged.entries.set(tag, { ...entry });
    }

    // Add entries from other (add-wins: if tag exists in other but not removed from this, add it)
    for (const [tag, entry] of other.entries) {
      merged.entries.set(tag, { ...entry });
    }

    return merged;
  }

  private elementsEqual(a: T, b: T): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // For internal access during merge
  getEntries(): Map<string, { element: T; tag: string }> {
    return new Map(this.entries);
  }
}

// =============================================================================
// Exercise 5: Convergence Proof
// =============================================================================

function proveConvergence(): { commutative: boolean; associative: boolean; idempotent: boolean } {
  // Create 3 GCounters with different states
  const a = new GCounter();
  a.increment('A');
  a.increment('A');
  a.increment('B');

  const b = new GCounter();
  b.increment('B');
  b.increment('B');
  b.increment('C');

  const c = new GCounter();
  c.increment('A');
  c.increment('C');
  c.increment('C');

  const sortedStringify = (obj: Record<string, number>) =>
    JSON.stringify(Object.keys(obj).sort().reduce((acc: Record<string, number>, key) => { acc[key] = obj[key]; return acc; }, {}));

  // Commutative: merge(a,b) == merge(b,a)
  const ab = a.merge(b);
  const ba = b.merge(a);
  const commutative = ab.value() === ba.value() &&
    sortedStringify(ab.getState()) === sortedStringify(ba.getState());

  // Associative: merge(merge(a,b),c) == merge(a,merge(b,c))
  const ab_c = ab.merge(c);
  const bc = b.merge(c);
  const a_bc = a.merge(bc);
  const associative = ab_c.value() === a_bc.value() &&
    sortedStringify(ab_c.getState()) === sortedStringify(a_bc.getState());

  // Idempotent: merge(a,a) == a
  const aa = a.merge(a);
  const idempotent = aa.value() === a.value() &&
    sortedStringify(aa.getState()) === sortedStringify(a.getState());

  return { commutative, associative, idempotent };
}

// =============================================================================
// Exercise 6: Multi-Replica Simulation
// =============================================================================

function simulateMultiReplica(): { converged: boolean; finalValue: number; replicaValues: number[] } {
  // Create 3 replicas
  let replicaA = new GCounter();
  let replicaB = new GCounter();
  let replicaC = new GCounter();

  // Local operations
  for (let i = 0; i < 3; i++) replicaA.increment('A');
  for (let i = 0; i < 2; i++) replicaB.increment('B');
  for (let i = 0; i < 5; i++) replicaC.increment('C');

  // Pairwise merges to propagate state
  replicaA = replicaA.merge(replicaB);
  replicaB = replicaB.merge(replicaA);
  replicaA = replicaA.merge(replicaC);
  replicaC = replicaC.merge(replicaA);
  replicaB = replicaB.merge(replicaC);
  replicaC = replicaC.merge(replicaB);

  const replicaValues = [replicaA.value(), replicaB.value(), replicaC.value()];
  const converged = replicaValues[0] === replicaValues[1] && replicaValues[1] === replicaValues[2];
  const finalValue = replicaValues[0];

  return { converged, finalValue, replicaValues };
}

// =============================================================================
// Exercise 7: Split-Brain Partition Scenario
// =============================================================================

function simulateSplitBrain(): {
  counterConverged: boolean;
  counterFinalValue: number;
  setConverged: boolean;
  addWinsSemanticsHold: boolean;
  setFinalValues: string[][];
} {
  // --- Phase 1: Create 3 replicas that share initial state ---
  let counterA = new GCounter();
  let counterB = new GCounter();
  let counterC = new GCounter();

  let setA = new ORSet<string>();
  let setB = new ORSet<string>();
  let setC = new ORSet<string>();

  // Shared initial state: all nodes see the same baseline
  counterA.increment('nodeA');
  counterB.increment('nodeB');
  counterC.increment('nodeC');

  // Sync all replicas so they share the initial state
  counterA = counterA.merge(counterB).merge(counterC);
  counterB = counterB.merge(counterA);
  counterC = counterC.merge(counterA);

  setA.add('shared-item');
  setA.add('will-conflict');
  // Sync sets
  setB = setA.merge(setB);
  setC = setA.merge(setC);
  setA = setA.merge(setB); // no-op, just for symmetry

  // --- Phase 2: Network partition — {A, B} isolated from {C} ---
  // Partition side {A, B}: concurrent writes
  counterA.increment('nodeA');
  counterA.increment('nodeA');
  counterB.increment('nodeB');
  counterB.increment('nodeB');
  counterB.increment('nodeB');

  setA.add('only-in-AB-partition');
  setB.add('from-nodeB');
  // nodeA and nodeB can still sync with each other during partition
  counterA = counterA.merge(counterB);
  counterB = counterB.merge(counterA);
  setA = setA.merge(setB);
  setB = setB.merge(setA);

  // Partition side {C}: concurrent writes
  counterC.increment('nodeC');
  counterC.increment('nodeC');
  counterC.increment('nodeC');
  counterC.increment('nodeC');

  setC.add('only-in-C-partition');
  // Concurrent add of 'will-conflict' on C side (C already has it from initial sync)
  // then C removes it — but A/B still have their original tags
  setC.remove('will-conflict');
  // C also adds a new item then removes a different one
  setC.add('c-added');
  setC.remove('shared-item');

  // Meanwhile, A adds 'will-conflict' again with a NEW tag (concurrent with C's remove)
  setA.add('will-conflict');
  // Sync A<->B within partition
  setA = setA.merge(setB);
  setB = setB.merge(setA);

  // --- Phase 3: Reconnect — merge all states pairwise ---
  // Full mesh merge: A<->C, B<->C, A<->B
  counterA = counterA.merge(counterC);
  counterC = counterC.merge(counterA);
  counterB = counterB.merge(counterC);
  counterC = counterC.merge(counterB);
  counterA = counterA.merge(counterB);
  counterB = counterB.merge(counterA);

  setA = setA.merge(setC);
  setC = setC.merge(setA);
  setB = setB.merge(setC);
  setC = setC.merge(setB);
  setA = setA.merge(setB);
  setB = setB.merge(setA);

  // --- Phase 4: Assert convergence ---
  const counterValues = [counterA.value(), counterB.value(), counterC.value()];
  const counterConverged =
    counterValues[0] === counterValues[1] && counterValues[1] === counterValues[2];
  // Expected: A=1+2=3, B=1+3=4, C=1+4=5 -> total = 3+4+5 = 12
  const counterFinalValue = counterValues[0];

  const sortedVals = (s: ORSet<string>) => s.values().slice().sort();
  const setValuesA = sortedVals(setA);
  const setValuesB = sortedVals(setB);
  const setValuesC = sortedVals(setC);
  const setConverged =
    JSON.stringify(setValuesA) === JSON.stringify(setValuesB) &&
    JSON.stringify(setValuesB) === JSON.stringify(setValuesC);

  // Add-wins: 'will-conflict' was removed by C but re-added by A concurrently
  // The new tag from A's add was never observed by C's remove, so it must survive
  const addWinsSemanticsHold = setA.has('will-conflict');

  return {
    counterConverged,
    counterFinalValue,
    setConverged,
    addWinsSemanticsHold,
    setFinalValues: [setValuesA, setValuesB, setValuesC],
  };
}

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 23 — CRDTs');

// --- Exercise 1 Tests ---
await test('Ex1: G-Counter increment and value', () => {
  const counter = new GCounter();
  counter.increment('A');
  counter.increment('A');
  counter.increment('B');
  assertEqual(counter.value(), 3);
});

await test('Ex1: G-Counter merge takes max', () => {
  const a = new GCounter();
  a.increment('A');
  a.increment('A');

  const b = new GCounter();
  b.increment('A');
  b.increment('B');
  b.increment('B');

  const merged = a.merge(b);
  // A: max(2,1)=2, B: max(0,2)=2 -> total=4
  assertEqual(merged.value(), 4);
});

await test('Ex1: G-Counter getState returns counters', () => {
  const counter = new GCounter();
  counter.increment('X');
  counter.increment('Y');
  counter.increment('Y');
  const state = counter.getState();
  assertEqual(state['X'], 1);
  assertEqual(state['Y'], 2);
});

// --- Exercise 2 Tests ---
await test('Ex2: PN-Counter increment and decrement', () => {
  const counter = new PNCounter();
  counter.increment('A');
  counter.increment('A');
  counter.increment('A');
  counter.decrement('A');
  assertEqual(counter.value(), 2);
});

await test('Ex2: PN-Counter merge', () => {
  const a = new PNCounter();
  a.increment('A');
  a.increment('A');

  const b = new PNCounter();
  b.increment('B');
  b.decrement('B');

  const merged = a.merge(b);
  assertEqual(merged.value(), 2); // A:2 + B:1-1 = 2
});

// --- Exercise 3 Tests ---
await test('Ex3: LWW-Register set and get', () => {
  const reg = new LWWRegister<string>();
  reg.set('hello', 1);
  assertEqual(reg.get(), 'hello');
  reg.set('world', 2);
  assertEqual(reg.get(), 'world');
});

await test('Ex3: LWW-Register ignores older writes', () => {
  const reg = new LWWRegister<string>();
  reg.set('new', 10);
  reg.set('old', 5); // should be ignored
  assertEqual(reg.get(), 'new');
});

await test('Ex3: LWW-Register merge keeps highest timestamp', () => {
  const a = new LWWRegister<string>();
  a.set('from-A', 10);

  const b = new LWWRegister<string>();
  b.set('from-B', 20);

  const merged = a.merge(b);
  assertEqual(merged.get(), 'from-B');
});

// --- Exercise 4 Tests ---
await test('Ex4: OR-Set add and has', () => {
  const set = new ORSet<string>();
  set.add('apple');
  set.add('banana');
  assert(set.has('apple'), 'Should have apple');
  assert(set.has('banana'), 'Should have banana');
  assert(!set.has('cherry'), 'Should not have cherry');
});

await test('Ex4: OR-Set remove', () => {
  const set = new ORSet<string>();
  set.add('apple');
  set.remove('apple');
  assert(!set.has('apple'), 'Should not have apple after remove');
});

await test('Ex4: OR-Set add-wins on concurrent add/remove', () => {
  const a = new ORSet<string>();
  a.add('item');

  const b = new ORSet<string>();
  b.add('item');
  b.remove('item'); // remove only observed tags

  // A adds again (new unique tag)
  a.add('item');

  // Merge: A's new tag was not observed by B's remove
  const merged = a.merge(b);
  assert(merged.has('item'), 'Add should win over concurrent remove');
});

await test('Ex4: OR-Set values', () => {
  const set = new ORSet<string>();
  set.add('a');
  set.add('b');
  set.add('c');
  set.remove('b');
  const vals = set.values();
  assertEqual(vals.length, 2);
  assert(vals.includes('a'), 'Should include a');
  assert(vals.includes('c'), 'Should include c');
});

// --- Exercise 5 Tests ---
await test('Ex5: convergence proof passes', () => {
  const proof = proveConvergence();
  assertEqual(proof.commutative, true);
  assertEqual(proof.associative, true);
  assertEqual(proof.idempotent, true);
});

// --- Exercise 6 Tests ---
await test('Ex6: multi-replica simulation converges', () => {
  const result = simulateMultiReplica();
  assertEqual(result.converged, true);
  assertEqual(result.finalValue, 10); // 3 + 2 + 5
  assertEqual(result.replicaValues[0], result.replicaValues[1]);
  assertEqual(result.replicaValues[1], result.replicaValues[2]);
});

// --- Exercise 7 Tests ---
await test('Ex7: split-brain G-Counter converges after reconnect', () => {
  const result = simulateSplitBrain();
  assertEqual(result.counterConverged, true);
  assertEqual(result.counterFinalValue, 12); // nodeA:3 + nodeB:4 + nodeC:5
});

await test('Ex7: split-brain OR-Set converges after reconnect', () => {
  const result = simulateSplitBrain();
  assertEqual(result.setConverged, true);
});

await test('Ex7: split-brain OR-Set add-wins semantics hold', () => {
  const result = simulateSplitBrain();
  assertEqual(result.addWinsSemanticsHold, true);
  // 'will-conflict' must be present: A re-added it concurrently with C's remove
  const finalSet = result.setFinalValues[0];
  assert(finalSet.includes('will-conflict'), 'will-conflict should survive (add-wins)');
  assert(finalSet.includes('only-in-AB-partition'), 'AB-partition item should be present');
  assert(finalSet.includes('only-in-C-partition'), 'C-partition item should be present');
  assert(finalSet.includes('c-added'), 'c-added should be present');
  assert(finalSet.includes('from-nodeB'), 'from-nodeB should be present');
});

summary();
