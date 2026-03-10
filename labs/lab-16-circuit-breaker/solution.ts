// =============================================================================
// Lab 16 — Circuit Breaker & Bulkhead (Solution)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
  assertCircuitBreakerState,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Circuit Breaker
// =============================================================================

class CircuitBreaker {
  state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private lastFailureTime = 0;

  constructor(options: { failureThreshold: number; resetTimeoutMs: number }) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeoutMs) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    if (this.state === 'half-open') {
      try {
        const result = await fn();
        this.state = 'closed';
        this.failureCount = 0;
        return result;
      } catch (err) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
        throw err;
      }
    }

    // closed state
    try {
      const result = await fn();
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
      throw err;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }
}

// =============================================================================
// Exercise 2: Failure Counting
// =============================================================================

class SlidingWindowFailureCounter {
  private windowMs: number;
  private failures: number[] = [];
  private successes: number[] = [];

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  recordFailure(): void {
    this.failures.push(Date.now());
  }

  recordSuccess(): void {
    this.successes.push(Date.now());
  }

  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter(t => t > cutoff);
    this.successes = this.successes.filter(t => t > cutoff);
  }

  getFailureCount(): number {
    this.cleanup();
    return this.failures.length;
  }

  getSuccessCount(): number {
    this.cleanup();
    return this.successes.length;
  }

  getFailureRate(): number {
    this.cleanup();
    const total = this.failures.length + this.successes.length;
    if (total === 0) return 0;
    return this.failures.length / total;
  }
}

// =============================================================================
// Exercise 3: Half-Open Recovery
// =============================================================================

class AdvancedCircuitBreaker {
  state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private halfOpenMaxAttempts: number;
  private halfOpenAttempts = 0;
  private lastFailureTime = 0;

  constructor(options: {
    failureThreshold: number;
    resetTimeoutMs: number;
    halfOpenMaxAttempts: number;
  }) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeoutMs) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
      this.halfOpenAttempts = 0;
    }

    if (this.state === 'half-open') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
        throw new Error('Circuit breaker is open');
      }
      this.halfOpenAttempts++;
      try {
        const result = await fn();
        this.state = 'closed';
        this.failureCount = 0;
        this.halfOpenAttempts = 0;
        return result;
      } catch (err) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
        throw err;
      }
    }

    // closed state
    try {
      const result = await fn();
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
      throw err;
    }
  }

  getHalfOpenAttempts(): number {
    return this.halfOpenAttempts;
  }
}

// =============================================================================
// Exercise 4: Bulkhead
// =============================================================================

class Bulkhead {
  private maxConcurrent: number;
  private activeCount = 0;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      throw new Error('Bulkhead capacity exceeded');
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getAvailableSlots(): number {
    return this.maxConcurrent - this.activeCount;
  }
}

// =============================================================================
// Exercise 5: Backpressure Queue
// =============================================================================

class BackpressureQueue<T> {
  private items: T[] = [];
  private maxSize: number;
  private strategy: 'drop-newest' | 'reject';

  constructor(maxSize: number, strategy: 'drop-newest' | 'reject') {
    this.maxSize = maxSize;
    this.strategy = strategy;
  }

  enqueue(item: T): boolean {
    if (this.items.length >= this.maxSize) {
      if (this.strategy === 'drop-newest') {
        return false;
      }
      throw new Error('Queue is full');
    }
    this.items.push(item);
    return true;
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  size(): number {
    return this.items.length;
  }

  isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

// =============================================================================
// Exercise 6: Combined Resilience
// =============================================================================

function createResilientWrapper(options: {
  failureThreshold: number;
  resetTimeoutMs: number;
  maxConcurrent: number;
  timeoutMs: number;
}): {
  call: <T>(fn: () => Promise<T>) => Promise<T>;
  getCircuitState: () => string;
  getActiveCount: () => number;
} {
  const circuitBreaker = new CircuitBreaker({
    failureThreshold: options.failureThreshold,
    resetTimeoutMs: options.resetTimeoutMs,
  });
  const bulkhead = new Bulkhead(options.maxConcurrent);

  return {
    async call<T>(fn: () => Promise<T>): Promise<T> {
      return bulkhead.call(() =>
        circuitBreaker.call(() =>
          Promise.race([
            fn(),
            new Promise<T>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Operation timed out after ${options.timeoutMs}ms`)),
                options.timeoutMs
              )
            ),
          ])
        )
      );
    },
    getCircuitState() {
      return circuitBreaker.state;
    },
    getActiveCount() {
      return bulkhead.getActiveCount();
    },
  };
}

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
