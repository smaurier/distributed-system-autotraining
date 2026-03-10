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

summary();
