// =============================================================================
// Lab 09 — Retries & Idempotency (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
  calculateExponentialBackoff,
  assertIdempotent,
  createMockKVStore,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Exponential Backoff
// =============================================================================
// TODO: Define RetryOptions interface:
//   { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; jitter: boolean }

// TODO: Implement async retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>
//   - Loop up to maxAttempts
//   - Call fn(), return result on success
//   - On failure, calculate delay with calculateExponentialBackoff(attempt, baseDelayMs, maxDelayMs, jitter)
//   - Wait with simulateNetworkDelay(delay) before next attempt
//   - After all attempts, throw the last error

// =============================================================================
// Exercise 2: Retry with Budget
// =============================================================================
// TODO: Implement class RetryBudget with:
//   - constructor(maxRetries: number, windowMs: number)
//   - canRetry(): boolean — cleanup old attempts, check if under budget
//   - recordAttempt(): void — record current timestamp
//   - remaining(): number — return remaining retries in current window
//   - async retryWithBudget<T>(fn, maxAttempts): Promise<T>
//     - Like retryWithBackoff but checks budget before each retry
//     - Throws 'Retry budget exhausted' if budget is empty

// =============================================================================
// Exercise 3: Timeout Wrapper
// =============================================================================
// TODO: Implement class TimeoutError extends Error
//   constructor(ms: number) — message: `Operation timed out after ${ms}ms`

// TODO: Implement async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>
//   - Use Promise.race between fn() and a setTimeout that rejects with TimeoutError

// =============================================================================
// Exercise 4: Idempotency Key Store with TTL
// =============================================================================
// TODO: Define IdempotencyEntry<T> interface:
//   { value: T; createdAt: number; expiresAt: number }

// TODO: Implement class IdempotencyKeyStore<T> with:
//   - set(key, value, ttlMs): void — store with expiration
//   - get(key): T | undefined — return value if not expired, delete if expired
//   - has(key): boolean
//   - delete(key): boolean
//   - cleanup(): number — remove all expired entries, return count removed
//   - size(): number — cleanup first, then return count

// =============================================================================
// Exercise 5: Idempotent Handler
// =============================================================================
// TODO: Implement createIdempotentHandler<TArgs extends unknown[], TResult>(
//   handler: (...args: TArgs) => Promise<TResult>,
//   options: { ttlMs: number; keyFn: (...args: TArgs) => string }
// ): (...args: TArgs) => Promise<TResult>
//   - Create an IdempotencyKeyStore internally
//   - On call: check cache by key, return cached if exists
//   - Otherwise call handler, cache result, return it

// =============================================================================
// Exercise 6: Resilient Client
// =============================================================================
// TODO: Define ResilientClientOptions interface:
//   { maxAttempts, baseDelayMs, maxDelayMs, timeoutMs, idempotencyTtlMs }

// TODO: Implement createResilientClient<T>(options):
//   Returns async function call(idempotencyKey: string, fn: () => Promise<T>): Promise<T>
//   1. Check idempotency cache — return if cached
//   2. Call fn wrapped in withTimeout, wrapped in retryWithBackoff
//   3. Cache successful result by idempotency key
//   4. Return result

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 09 — Retries & Idempotency');

// --- Exercise 1 Tests ---
await test('Ex1: retryWithBackoff succeeds on first attempt', async () => {
  let attempts = 0;
  const result = await retryWithBackoff(async () => { attempts++; return 'ok'; }, {
    maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitter: false,
  });
  assertEqual(result, 'ok');
  assertEqual(attempts, 1);
});

await test('Ex1: retryWithBackoff retries on failure then succeeds', async () => {
  let attempts = 0;
  const result = await retryWithBackoff(async () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  }, { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100, jitter: false });
  assertEqual(result, 'success');
  assertEqual(attempts, 3);
});

await test('Ex1: retryWithBackoff throws after max attempts', async () => {
  let attempts = 0;
  try {
    await retryWithBackoff(async () => { attempts++; throw new Error('always fails'); }, {
      maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitter: false,
    });
    throw new Error('Should have thrown');
  } catch (err) {
    assertEqual((err as Error).message, 'always fails');
    assertEqual(attempts, 3);
  }
});

// --- Exercise 2 Tests ---
await test('Ex2: retry budget tracks remaining attempts', () => {
  const budget = new RetryBudget(5, 60000);
  assertEqual(budget.remaining(), 5);
  budget.recordAttempt();
  budget.recordAttempt();
  assertEqual(budget.remaining(), 3);
});

await test('Ex2: retry budget blocks when exhausted', () => {
  const budget = new RetryBudget(2, 60000);
  budget.recordAttempt();
  budget.recordAttempt();
  assert(!budget.canRetry(), 'Should not allow more retries');
});

// --- Exercise 3 Tests ---
await test('Ex3: withTimeout returns result when fast enough', async () => {
  const result = await withTimeout(async () => {
    await simulateNetworkDelay(10);
    return 42;
  }, 1000);
  assertEqual(result, 42);
});

await test('Ex3: withTimeout throws TimeoutError when too slow', async () => {
  try {
    await withTimeout(async () => {
      await simulateNetworkDelay(500);
      return 'never';
    }, 50);
    throw new Error('Should have thrown');
  } catch (err) {
    assert(err instanceof TimeoutError, 'Should be TimeoutError');
    assert((err as Error).message.includes('50'), 'Should mention timeout duration');
  }
});

// --- Exercise 4 Tests ---
await test('Ex4: idempotency store set/get with TTL', async () => {
  const store = new IdempotencyKeyStore<string>();
  store.set('key-1', 'value-1', 1000);
  assertEqual(store.get('key-1'), 'value-1');
  assert(store.has('key-1'), 'Should have key-1');
});

await test('Ex4: idempotency store expires entries', async () => {
  const store = new IdempotencyKeyStore<string>();
  store.set('key-1', 'value-1', 50); // 50ms TTL
  assertEqual(store.get('key-1'), 'value-1');
  await simulateNetworkDelay(60);
  assertEqual(store.get('key-1'), undefined);
  assert(!store.has('key-1'), 'Should not have expired key');
});

await test('Ex4: idempotency store cleanup removes expired', async () => {
  const store = new IdempotencyKeyStore<string>();
  store.set('a', 'va', 50);
  store.set('b', 'vb', 5000);
  await simulateNetworkDelay(60);
  const removed = store.cleanup();
  assertEqual(removed, 1);
  assertEqual(store.size(), 1);
});

// --- Exercise 5 Tests ---
await test('Ex5: idempotent handler caches results', async () => {
  let callCount = 0;
  const handler = createIdempotentHandler(
    async (orderId: string) => { callCount++; return { orderId, status: 'processed' }; },
    { ttlMs: 5000, keyFn: (orderId) => `order-${orderId}` }
  );
  const r1 = await handler('ord-1');
  const r2 = await handler('ord-1');
  assertDeepEqual(r1, r2);
  assertEqual(callCount, 1);
});

await test('Ex5: idempotent handler different keys call handler', async () => {
  let callCount = 0;
  const handler = createIdempotentHandler(
    async (id: string) => { callCount++; return { id }; },
    { ttlMs: 5000, keyFn: (id) => id }
  );
  await handler('a');
  await handler('b');
  assertEqual(callCount, 2);
});

// --- Exercise 6 Tests ---
await test('Ex6: resilient client succeeds on first try', async () => {
  const client = createResilientClient<string>({
    maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100,
    timeoutMs: 1000, idempotencyTtlMs: 5000,
  });
  const result = await client('key-1', async () => 'hello');
  assertEqual(result, 'hello');
});

await test('Ex6: resilient client retries transient failures', async () => {
  let attempts = 0;
  const client = createResilientClient<string>({
    maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 100,
    timeoutMs: 1000, idempotencyTtlMs: 5000,
  });
  const result = await client('key-2', async () => {
    attempts++;
    if (attempts < 3) throw new Error('transient');
    return 'recovered';
  });
  assertEqual(result, 'recovered');
  assertEqual(attempts, 3);
});

await test('Ex6: resilient client returns cached result for same key', async () => {
  let callCount = 0;
  const client = createResilientClient<string>({
    maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100,
    timeoutMs: 1000, idempotencyTtlMs: 5000,
  });
  const r1 = await client('key-3', async () => { callCount++; return 'cached'; });
  const r2 = await client('key-3', async () => { callCount++; return 'different'; });
  assertEqual(r1, 'cached');
  assertEqual(r2, 'cached');
  assertEqual(callCount, 1);
});

await test('Ex6: resilient client handles timeout with retry', async () => {
  let attempts = 0;
  const client = createResilientClient<string>({
    maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100,
    timeoutMs: 50, idempotencyTtlMs: 5000,
  });
  const result = await client('key-4', async () => {
    attempts++;
    if (attempts < 2) {
      await simulateNetworkDelay(200); // trigger timeout
    }
    return 'done';
  });
  assertEqual(result, 'done');
});

summary();
