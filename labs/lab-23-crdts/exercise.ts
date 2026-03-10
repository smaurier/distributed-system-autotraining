// =============================================================================
// Lab 23 — CRDTs (Exercise)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: G-Counter
// =============================================================================
// TODO: Implement class GCounter with:
//   - constructor()
//   - increment(nodeId: string): void — increment nodeId's counter by 1
//   - value(): number — sum of all node counters
//   - merge(other: GCounter): GCounter — return new GCounter taking max per node
//   - getState(): Record<string, number> — return copy of internal counters

// =============================================================================
// Exercise 2: PN-Counter
// =============================================================================
// TODO: Implement class PNCounter with:
//   - constructor()
//   - increment(nodeId: string): void — increment positive counter
//   - decrement(nodeId: string): void — increment negative counter
//   - value(): number — positive.value() - negative.value()
//   - merge(other: PNCounter): PNCounter — merge both G-Counters
//   - getState(): { positive: Record<string, number>; negative: Record<string, number> }

// =============================================================================
// Exercise 3: LWW-Register
// =============================================================================
// TODO: Implement class LWWRegister<T> with:
//   - constructor()
//   - set(value: T, timestamp: number): void — set value if timestamp > current
//   - get(): T | undefined — return current value
//   - getTimestamp(): number — return current timestamp
//   - merge(other: LWWRegister<T>): LWWRegister<T> — return new register with highest timestamp value

// =============================================================================
// Exercise 4: OR-Set (Observed-Remove Set)
// =============================================================================
// TODO: Implement class ORSet<T> with:
//   - constructor()
//   - add(element: T): void — add element with a unique tag
//   - remove(element: T): void — remove all currently observed tags for element
//   - has(element: T): boolean — true if element has any active tags
//   - values(): T[] — return all elements with active tags
//   - merge(other: ORSet<T>): ORSet<T> — union of adds, minus observed removes (add-wins)

// =============================================================================
// Exercise 5: Convergence Proof
// =============================================================================
// TODO: Implement function proveConvergence():
//   { commutative: boolean; associative: boolean; idempotent: boolean }
//   - Create 3 GCounters with different states
//   - Test commutative: merge(a,b).value() === merge(b,a).value()
//   - Test associative: merge(merge(a,b),c).value() === merge(a,merge(b,c)).value()
//   - Test idempotent: merge(a,a).value() === a.value()

// =============================================================================
// Exercise 6: Multi-Replica Simulation
// =============================================================================
// TODO: Implement function simulateMultiReplica():
//   { converged: boolean; finalValue: number; replicaValues: number[] }
//   - Create 3 GCounter replicas
//   - Each replica does some local increments:
//     - Replica A: increment 3 times
//     - Replica B: increment 2 times
//     - Replica C: increment 5 times
//   - Do pairwise merges: A=merge(A,B), B=merge(B,A), then A=merge(A,C), C=merge(C,A), B=merge(B,C), C=merge(C,B)
//   - Check all replicas have same value
//   - Return { converged, finalValue, replicaValues }

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
  // A: max(2,1)=2, B: max(0,2)=2 → total=4
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
