// =============================================================================
// Lab 09 — Retries & Idempotency (Solution)
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

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, jitter } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        const delay = calculateExponentialBackoff(attempt, baseDelayMs, maxDelayMs, jitter);
        await simulateNetworkDelay(delay);
      }
    }
  }

  throw lastError;
}

// =============================================================================
// Exercise 2: Retry with Budget
// =============================================================================

class RetryBudget {
  private attempts: number[] = [];
  private maxRetries: number;
  private windowMs: number;

  constructor(maxRetries: number, windowMs: number) {
    this.maxRetries = maxRetries;
    this.windowMs = windowMs;
  }

  canRetry(): boolean {
    this.cleanup();
    return this.attempts.length < this.maxRetries;
  }

  recordAttempt(): void {
    this.attempts.push(Date.now());
  }

  remaining(): number {
    this.cleanup();
    return Math.max(0, this.maxRetries - this.attempts.length);
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.attempts = this.attempts.filter(t => t > cutoff);
  }

  async retryWithBudget<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0 && !this.canRetry()) {
        throw new Error('Retry budget exhausted');
      }
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt > 0) {
          this.recordAttempt();
        }
        if (attempt < maxAttempts - 1) {
          if (!this.canRetry()) {
            throw new Error('Retry budget exhausted');
          }
          await simulateNetworkDelay(10);
        }
      }
    }

    throw lastError;
  }
}

// =============================================================================
// Exercise 3: Timeout Wrapper
// =============================================================================

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(timeoutMs)), timeoutMs);
    }),
  ]);
}

// =============================================================================
// Exercise 4: Idempotency Key Store with TTL
// =============================================================================

interface IdempotencyEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

class IdempotencyKeyStore<T> {
  private store: Map<string, IdempotencyEntry<T>> = new Map();

  set(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttlMs,
    });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  size(): number {
    this.cleanup();
    return this.store.size;
  }
}

// =============================================================================
// Exercise 5: Idempotent Handler
// =============================================================================

function createIdempotentHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
  options: { ttlMs: number; keyFn: (...args: TArgs) => string }
): (...args: TArgs) => Promise<TResult> {
  const store = new IdempotencyKeyStore<TResult>();

  return async (...args: TArgs): Promise<TResult> => {
    const key = options.keyFn(...args);
    const cached = store.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await handler(...args);
    store.set(key, result, options.ttlMs);
    return result;
  };
}

// =============================================================================
// Exercise 6: Resilient Client
// =============================================================================

interface ResilientClientOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  idempotencyTtlMs: number;
}

function createResilientClient<T>(
  options: ResilientClientOptions
) {
  const idempotencyStore = new IdempotencyKeyStore<T>();

  return async function call(
    idempotencyKey: string,
    fn: () => Promise<T>
  ): Promise<T> {
    // Check idempotency cache first
    const cached = idempotencyStore.get(idempotencyKey);
    if (cached !== undefined) {
      return cached;
    }

    // Retry with backoff + timeout
    const result = await retryWithBackoff(
      () => withTimeout(fn, options.timeoutMs),
      {
        maxAttempts: options.maxAttempts,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        jitter: true,
      }
    );

    // Cache result
    idempotencyStore.set(idempotencyKey, result, options.idempotencyTtlMs);
    return result;
  };
}

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
