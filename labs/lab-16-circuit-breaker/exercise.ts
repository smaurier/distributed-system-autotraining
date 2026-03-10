// =============================================================================
// Lab 16 — Circuit Breaker & Bulkhead (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
  assertCircuitBreakerState,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Circuit Breaker
// =============================================================================
// TODO: Implement class CircuitBreaker with:
//   - state: 'closed' | 'open' | 'half-open'
//   - constructor(options: { failureThreshold: number; resetTimeoutMs: number })
//   - async call<T>(fn: () => Promise<T>): Promise<T>
//     - closed: call fn; on failure increment failure count; open if threshold reached
//     - open: throw Error('Circuit breaker is open') if reset timeout not elapsed
//             transition to half-open if timeout elapsed, then try fn
//     - half-open: try fn; on success go to closed (reset failures); on failure go to open
//   - reset(): void — force reset to closed state

// =============================================================================
// Exercise 2: Failure Counting
// =============================================================================
// TODO: Implement class SlidingWindowFailureCounter with:
//   - constructor(windowMs: number)
//   - recordFailure(): void — record a failure timestamp
//   - recordSuccess(): void — record a success timestamp
//   - getFailureCount(): number — count failures in current window
//   - getSuccessCount(): number — count successes in current window
//   - getFailureRate(): number — failures / total in window (0 if no records)
//   - cleanup(): void — remove entries older than window

// =============================================================================
// Exercise 3: Half-Open Recovery
// =============================================================================
// TODO: Implement class AdvancedCircuitBreaker with:
//   - state: 'closed' | 'open' | 'half-open'
//   - constructor(options: { failureThreshold: number; resetTimeoutMs: number; halfOpenMaxAttempts: number })
//   - async call<T>(fn: () => Promise<T>): Promise<T>
//     - Same as Exercise 1, but in half-open state:
//       - Track number of test attempts
//       - Allow up to halfOpenMaxAttempts test calls
//       - On success: transition to closed
//       - On failure: transition to open and reset timer
//   - getHalfOpenAttempts(): number — return number of attempts in half-open state

// =============================================================================
// Exercise 4: Bulkhead
// =============================================================================
// TODO: Implement class Bulkhead with:
//   - constructor(maxConcurrent: number)
//   - async call<T>(fn: () => Promise<T>): Promise<T>
//     - If active calls < maxConcurrent, execute fn
//     - Otherwise throw Error('Bulkhead capacity exceeded')
//     - Always decrement active count when fn completes (success or failure)
//   - getActiveCount(): number
//   - getAvailableSlots(): number

// =============================================================================
// Exercise 5: Backpressure Queue
// =============================================================================
// TODO: Implement class BackpressureQueue<T> with:
//   - constructor(maxSize: number, strategy: 'drop-newest' | 'reject')
//   - enqueue(item: T): boolean
//     - If not full, add item, return true
//     - If full and strategy is 'drop-newest': drop the item (don't add), return false
//     - If full and strategy is 'reject': throw Error('Queue is full')
//   - dequeue(): T | undefined — remove and return front item
//   - peek(): T | undefined — return front item without removing
//   - size(): number
//   - isFull(): boolean
//   - isEmpty(): boolean

// =============================================================================
// Exercise 6: Combined Resilience
// =============================================================================
// TODO: Implement function createResilientWrapper(options: {
//   failureThreshold: number;
//   resetTimeoutMs: number;
//   maxConcurrent: number;
//   timeoutMs: number;
// }): { call: <T>(fn: () => Promise<T>) => Promise<T>; getCircuitState: () => string; getActiveCount: () => number }
//   - Internally create a CircuitBreaker and a Bulkhead
//   - call() should:
//     1. Pass through Bulkhead (concurrency limit)
//     2. Pass through CircuitBreaker
//     3. Apply timeout (use Promise.race)
//   - getCircuitState() returns circuit breaker state
//   - getActiveCount() returns bulkhead active count

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, summary } = createTestRunner('Lab 16 — Circuit Breaker & Bulkhead');

// --- Exercise 1 Tests ---
await test('Ex1: circuit breaker starts closed', () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  assertEqual(cb.state, 'closed');
});

await test('Ex1: circuit breaker allows successful calls', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  const result = await cb.call(async () => 'ok');
  assertEqual(result, 'ok');
  assertEqual(cb.state, 'closed');
});

await test('Ex1: circuit breaker opens after threshold failures', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
  for (let i = 0; i < 2; i++) {
    try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  }
  assertEqual(cb.state, 'open');
});

await test('Ex1: circuit breaker rejects when open', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
  try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  try {
    await cb.call(async () => 'should not run');
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('open'), 'Should mention open state');
  }
});

// --- Exercise 2 Tests ---
await test('Ex2: sliding window counts failures', () => {
  const counter = new SlidingWindowFailureCounter(60000);
  counter.recordFailure();
  counter.recordFailure();
  counter.recordSuccess();
  assertEqual(counter.getFailureCount(), 2);
  assertEqual(counter.getSuccessCount(), 1);
});

await test('Ex2: sliding window calculates failure rate', () => {
  const counter = new SlidingWindowFailureCounter(60000);
  counter.recordFailure();
  counter.recordSuccess();
  counter.recordSuccess();
  counter.recordSuccess();
  assertEqual(counter.getFailureRate(), 0.25);
});

await test('Ex2: sliding window returns 0 rate when empty', () => {
  const counter = new SlidingWindowFailureCounter(60000);
  assertEqual(counter.getFailureRate(), 0);
});

// --- Exercise 3 Tests ---
await test('Ex3: advanced circuit breaker tracks half-open attempts', async () => {
  const cb = new AdvancedCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 50,
    halfOpenMaxAttempts: 2,
  });
  // Trip to open
  try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  assertEqual(cb.state, 'open');

  // Wait for reset timeout
  await simulateNetworkDelay(60);

  // First call in half-open should succeed and close
  const result = await cb.call(async () => 'recovered');
  assertEqual(result, 'recovered');
  assertEqual(cb.state, 'closed');
});

await test('Ex3: half-open failure returns to open', async () => {
  const cb = new AdvancedCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 50,
    halfOpenMaxAttempts: 2,
  });
  try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  await simulateNetworkDelay(60);
  try { await cb.call(async () => { throw new Error('still failing'); }); } catch {}
  assertEqual(cb.state, 'open');
});

// --- Exercise 4 Tests ---
await test('Ex4: bulkhead allows calls within capacity', async () => {
  const bh = new Bulkhead(2);
  const result = await bh.call(async () => 'ok');
  assertEqual(result, 'ok');
  assertEqual(bh.getActiveCount(), 0);
});

await test('Ex4: bulkhead rejects when full', async () => {
  const bh = new Bulkhead(1);
  // Start a long-running call
  const promise = bh.call(async () => {
    await simulateNetworkDelay(200);
    return 'slow';
  });
  // Try another call while the first is running
  try {
    await bh.call(async () => 'should not run');
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('exceeded'), 'Should mention capacity exceeded');
  }
  await promise; // cleanup
});

await test('Ex4: bulkhead tracks available slots', () => {
  const bh = new Bulkhead(5);
  assertEqual(bh.getAvailableSlots(), 5);
});

// --- Exercise 5 Tests ---
await test('Ex5: queue enqueue and dequeue', () => {
  const q = new BackpressureQueue<number>(3, 'reject');
  q.enqueue(1);
  q.enqueue(2);
  assertEqual(q.size(), 2);
  assertEqual(q.dequeue(), 1);
  assertEqual(q.dequeue(), 2);
});

await test('Ex5: queue drop-newest strategy', () => {
  const q = new BackpressureQueue<number>(2, 'drop-newest');
  q.enqueue(1);
  q.enqueue(2);
  const added = q.enqueue(3);
  assertEqual(added, false);
  assertEqual(q.size(), 2);
  assertEqual(q.peek(), 1);
});

await test('Ex5: queue reject strategy throws', () => {
  const q = new BackpressureQueue<number>(1, 'reject');
  q.enqueue(1);
  try {
    q.enqueue(2);
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('full'), 'Should mention queue full');
  }
});

await test('Ex5: queue isEmpty and isFull', () => {
  const q = new BackpressureQueue<string>(2, 'reject');
  assert(q.isEmpty(), 'Should be empty');
  assert(!q.isFull(), 'Should not be full');
  q.enqueue('a');
  q.enqueue('b');
  assert(!q.isEmpty(), 'Should not be empty');
  assert(q.isFull(), 'Should be full');
});

// --- Exercise 6 Tests ---
await test('Ex6: combined resilience succeeds normally', async () => {
  const wrapper = createResilientWrapper({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
    maxConcurrent: 5,
    timeoutMs: 1000,
  });
  const result = await wrapper.call(async () => 'hello');
  assertEqual(result, 'hello');
  assertEqual(wrapper.getCircuitState(), 'closed');
  assertEqual(wrapper.getActiveCount(), 0);
});

await test('Ex6: combined resilience opens circuit after failures', async () => {
  const wrapper = createResilientWrapper({
    failureThreshold: 2,
    resetTimeoutMs: 5000,
    maxConcurrent: 5,
    timeoutMs: 1000,
  });
  for (let i = 0; i < 2; i++) {
    try { await wrapper.call(async () => { throw new Error('fail'); }); } catch {}
  }
  assertEqual(wrapper.getCircuitState(), 'open');
});

await test('Ex6: combined resilience respects timeout', async () => {
  const wrapper = createResilientWrapper({
    failureThreshold: 5,
    resetTimeoutMs: 1000,
    maxConcurrent: 5,
    timeoutMs: 50,
  });
  try {
    await wrapper.call(async () => {
      await simulateNetworkDelay(200);
      return 'slow';
    });
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('timed out'), 'Should mention timeout');
  }
});

summary();
