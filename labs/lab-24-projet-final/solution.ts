// =============================================================================
// Lab 24 — Projet Final (Solution)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Service Communication
// =============================================================================

function generateUUID(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const s = (n: number) => Array.from({ length: n }, hex).join('');
  const variant = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  return `${s(8)}-${s(4)}-4${s(3)}-${variant}${s(3)}-${s(12)}`;
}

interface ServiceResponse {
  status: number;
  data: unknown;
  correlationId: string;
  durationMs: number;
}

class ServiceClient {
  private timeoutMs: number;

  constructor(options: { timeoutMs: number }) {
    this.timeoutMs = options.timeoutMs;
  }

  async callService(
    name: string,
    path: string,
    options?: { correlationId?: string; body?: unknown }
  ): Promise<ServiceResponse> {
    const correlationId = options?.correlationId || generateUUID();
    const start = Date.now();

    // Simulate service call
    await simulateNetworkDelay(5);

    return {
      status: 200,
      data: { service: name, path, body: options?.body },
      correlationId,
      durationMs: Date.now() - start,
    };
  }
}

// =============================================================================
// Exercise 2: Event Store
// =============================================================================

interface DomainEvent {
  eventId: string;
  streamId: string;
  type: string;
  data: unknown;
  timestamp: number;
  version: number;
}

class EventStore {
  private events: DomainEvent[] = [];
  private streamVersions: Map<string, number> = new Map();

  append(streamId: string, events: { type: string; data: unknown }[]): DomainEvent[] {
    const currentVersion = this.streamVersions.get(streamId) || 0;
    const domainEvents: DomainEvent[] = [];

    for (let i = 0; i < events.length; i++) {
      const version = currentVersion + i + 1;
      const domainEvent: DomainEvent = {
        eventId: generateUUID(),
        streamId,
        type: events[i].type,
        data: events[i].data,
        timestamp: Date.now(),
        version,
      };
      domainEvents.push(domainEvent);
      this.events.push(domainEvent);
    }

    this.streamVersions.set(streamId, currentVersion + events.length);
    return domainEvents;
  }

  getStream(streamId: string): DomainEvent[] {
    return this.events.filter(e => e.streamId === streamId);
  }

  getAllEvents(): DomainEvent[] {
    return [...this.events];
  }

  getStreamVersion(streamId: string): number {
    return this.streamVersions.get(streamId) || 0;
  }
}

// =============================================================================
// Exercise 3: Saga Orchestrator
// =============================================================================

interface SagaStep {
  name: string;
  execute: () => Promise<unknown>;
  compensate: () => Promise<void>;
}

interface SagaResult {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  compensatedSteps: string[];
  error?: string;
}

class SagaOrchestrator {
  private steps: SagaStep[] = [];

  addStep(
    name: string,
    execute: () => Promise<unknown>,
    compensate: () => Promise<void>
  ): void {
    this.steps.push({ name, execute, compensate });
  }

  async run(): Promise<SagaResult> {
    const completedSteps: string[] = [];
    const compensatedSteps: string[] = [];

    for (const step of this.steps) {
      try {
        await step.execute();
        completedSteps.push(step.name);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        // Run compensations in reverse order
        for (let i = completedSteps.length - 1; i >= 0; i--) {
          const stepName = completedSteps[i];
          const compensateStep = this.steps.find(s => s.name === stepName);
          if (compensateStep) {
            try {
              await compensateStep.compensate();
              compensatedSteps.push(stepName);
            } catch {
              // Compensation failures are logged but don't stop other compensations
            }
          }
        }

        return {
          success: false,
          completedSteps,
          failedStep: step.name,
          compensatedSteps,
          error,
        };
      }
    }

    return {
      success: true,
      completedSteps,
      compensatedSteps,
    };
  }
}

// =============================================================================
// Exercise 4: Circuit Breaker
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
      return await fn();
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }
      throw err;
    }
  }
}

// =============================================================================
// Exercise 5: Rate Limiter (Token Bucket)
// =============================================================================

class TokenBucket {
  private maxTokens: number;
  private refillRate: number;
  private tokens: number;
  private lastRefillTime: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefillTime = 0;
  }

  private refill(now: number): void {
    if (this.lastRefillTime === 0) {
      this.lastRefillTime = now;
      return;
    }
    const elapsedMs = now - this.lastRefillTime;
    const elapsedSec = elapsedMs / 1000;
    const newTokens = elapsedSec * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefillTime = now;
  }

  tryConsume(now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }

  getRemaining(now: number = Date.now()): number {
    this.refill(now);
    return Math.floor(this.tokens);
  }
}

// =============================================================================
// Exercise 6: Outbox + Inbox
// =============================================================================

interface OutboxMessage {
  messageId: string;
  destination: string;
  payload: unknown;
  createdAt: number;
  published: boolean;
}

class OutboxPublisher {
  private messages: Map<string, OutboxMessage> = new Map();

  publish(destination: string, payload: unknown): OutboxMessage {
    const message: OutboxMessage = {
      messageId: generateUUID(),
      destination,
      payload,
      createdAt: Date.now(),
      published: false,
    };
    this.messages.set(message.messageId, message);
    return message;
  }

  markPublished(messageId: string): void {
    const msg = this.messages.get(messageId);
    if (msg) msg.published = true;
  }

  getPending(): OutboxMessage[] {
    return Array.from(this.messages.values()).filter(m => !m.published);
  }

  getAll(): OutboxMessage[] {
    return Array.from(this.messages.values());
  }
}

class InboxConsumer {
  private processedMessages: Map<string, unknown> = new Map();

  async consume(
    messageId: string,
    payload: unknown,
    handler: (payload: unknown) => Promise<unknown>
  ): Promise<{ processed: boolean; result: unknown }> {
    if (this.processedMessages.has(messageId)) {
      return { processed: false, result: this.processedMessages.get(messageId) };
    }

    const result = await handler(payload);
    this.processedMessages.set(messageId, result);
    return { processed: true, result };
  }

  isProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }
}

// =============================================================================
// Exercise 7: Health Check
// =============================================================================

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

class HealthAggregator {
  private checks: { name: string; check: () => Promise<boolean>; critical: boolean }[] = [];

  register(name: string, check: () => Promise<boolean>, critical: boolean): void {
    this.checks.push({ name, check, critical });
  }

  async check(): Promise<{
    status: HealthStatus;
    details: { name: string; healthy: boolean; critical: boolean }[];
  }> {
    const details: { name: string; healthy: boolean; critical: boolean }[] = [];

    for (const dep of this.checks) {
      let healthy: boolean;
      try {
        healthy = await dep.check();
      } catch {
        healthy = false;
      }
      details.push({ name: dep.name, healthy, critical: dep.critical });
    }

    let status: HealthStatus = 'healthy';
    const hasCriticalFailure = details.some(d => d.critical && !d.healthy);
    const hasAnyFailure = details.some(d => !d.healthy);

    if (hasCriticalFailure) {
      status = 'unhealthy';
    } else if (hasAnyFailure) {
      status = 'degraded';
    }

    return { status, details };
  }
}

// =============================================================================
// Exercise 8: Integration Test
// =============================================================================

async function runOrderFlow(): Promise<{
  sagaResult: SagaResult;
  events: DomainEvent[];
  idempotent: boolean;
}> {
  const eventStore = new EventStore();
  const orderId = 'order-' + generateUUID();

  // Helper to check if order already has a specific event type
  function hasEvent(type: string): boolean {
    return eventStore.getStream(orderId).some(e => e.type === type);
  }

  function createSaga(): SagaOrchestrator {
    const saga = new SagaOrchestrator();

    saga.addStep(
      'create-order',
      async () => {
        if (!hasEvent('OrderCreated')) {
          eventStore.append(orderId, [{ type: 'OrderCreated', data: { orderId } }]);
        }
        return 'created';
      },
      async () => {
        eventStore.append(orderId, [{ type: 'OrderCancelled', data: { orderId } }]);
      }
    );

    saga.addStep(
      'reserve-stock',
      async () => {
        if (!hasEvent('StockReserved')) {
          eventStore.append(orderId, [{ type: 'StockReserved', data: { orderId, item: 'widget' } }]);
        }
        return 'reserved';
      },
      async () => {
        eventStore.append(orderId, [{ type: 'StockReleased', data: { orderId } }]);
      }
    );

    saga.addStep(
      'process-payment',
      async () => {
        if (!hasEvent('PaymentProcessed')) {
          eventStore.append(orderId, [{ type: 'PaymentProcessed', data: { orderId, amount: 99.99 } }]);
        }
        return 'paid';
      },
      async () => {
        eventStore.append(orderId, [{ type: 'PaymentRefunded', data: { orderId } }]);
      }
    );

    return saga;
  }

  // Run the saga
  const sagaResult = await createSaga().run();

  // Get events after first run
  const eventsAfterFirstRun = eventStore.getStream(orderId).filter(
    e => ['OrderCreated', 'StockReserved', 'PaymentProcessed'].includes(e.type)
  );
  const firstRunCount = eventsAfterFirstRun.length;

  // Run again for idempotency check
  await createSaga().run();

  const eventsAfterSecondRun = eventStore.getStream(orderId).filter(
    e => ['OrderCreated', 'StockReserved', 'PaymentProcessed'].includes(e.type)
  );
  const secondRunCount = eventsAfterSecondRun.length;

  const idempotent = firstRunCount === secondRunCount;

  return {
    sagaResult,
    events: eventsAfterFirstRun,
    idempotent,
  };
}

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 24 — Projet Final');

// --- Exercise 1 Tests ---
await test('Ex1: service client makes calls with correlationId', async () => {
  const client = new ServiceClient({ timeoutMs: 5000 });
  const response = await client.callService('order-service', '/orders', {
    correlationId: 'test-corr-id',
    body: { orderId: '123' },
  });
  assertEqual(response.correlationId, 'test-corr-id');
  assertEqual(response.status, 200);
  assert(response.durationMs >= 0, 'Should have durationMs');
});

await test('Ex1: service client generates correlationId if not provided', async () => {
  const client = new ServiceClient({ timeoutMs: 5000 });
  const response = await client.callService('user-service', '/users');
  assert(response.correlationId.length > 0, 'Should generate correlationId');
});

// --- Exercise 2 Tests ---
await test('Ex2: event store appends and retrieves events', () => {
  const store = new EventStore();
  const events = store.append('order-1', [
    { type: 'OrderCreated', data: { item: 'widget' } },
    { type: 'OrderConfirmed', data: {} },
  ]);
  assertEqual(events.length, 2);
  assertEqual(events[0].version, 1);
  assertEqual(events[1].version, 2);
  assertEqual(store.getStream('order-1').length, 2);
});

await test('Ex2: event store tracks versions per stream', () => {
  const store = new EventStore();
  store.append('stream-A', [{ type: 'E1', data: {} }]);
  store.append('stream-B', [{ type: 'E1', data: {} }]);
  store.append('stream-A', [{ type: 'E2', data: {} }]);
  assertEqual(store.getStreamVersion('stream-A'), 2);
  assertEqual(store.getStreamVersion('stream-B'), 1);
  assertEqual(store.getAllEvents().length, 3);
});

// --- Exercise 3 Tests ---
await test('Ex3: saga completes successfully', async () => {
  const saga = new SagaOrchestrator();
  saga.addStep('step-1', async () => 'ok-1', async () => {});
  saga.addStep('step-2', async () => 'ok-2', async () => {});
  const result = await saga.run();
  assertEqual(result.success, true);
  assertEqual(result.completedSteps.length, 2);
  assertEqual(result.compensatedSteps.length, 0);
});

await test('Ex3: saga compensates on failure', async () => {
  const compensated: string[] = [];
  const saga = new SagaOrchestrator();
  saga.addStep('create-order', async () => 'done', async () => { compensated.push('create-order'); });
  saga.addStep('reserve-stock', async () => 'done', async () => { compensated.push('reserve-stock'); });
  saga.addStep('process-payment', async () => { throw new Error('Payment failed'); }, async () => { compensated.push('process-payment'); });
  const result = await saga.run();
  assertEqual(result.success, false);
  assertEqual(result.failedStep, 'process-payment');
  // Should compensate in reverse: reserve-stock, then create-order
  assertEqual(compensated[0], 'reserve-stock');
  assertEqual(compensated[1], 'create-order');
});

// --- Exercise 4 Tests ---
await test('Ex4: circuit breaker allows successful calls', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
  const result = await cb.call(async () => 'ok');
  assertEqual(result, 'ok');
  assertEqual(cb.state, 'closed');
});

await test('Ex4: circuit breaker opens after failures', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
  for (let i = 0; i < 2; i++) {
    try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  }
  assertEqual(cb.state, 'open');
  try {
    await cb.call(async () => 'should not run');
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('open'), 'Should reject when open');
  }
});

await test('Ex4: circuit breaker recovers in half-open', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
  try { await cb.call(async () => { throw new Error('fail'); }); } catch {}
  assertEqual(cb.state, 'open');
  await simulateNetworkDelay(60);
  const result = await cb.call(async () => 'recovered');
  assertEqual(result, 'recovered');
  assertEqual(cb.state, 'closed');
});

// --- Exercise 5 Tests ---
await test('Ex5: token bucket allows burst', () => {
  const bucket = new TokenBucket(3, 1);
  const now = 1000;
  assertEqual(bucket.tryConsume(now), true);
  assertEqual(bucket.tryConsume(now), true);
  assertEqual(bucket.tryConsume(now), true);
  assertEqual(bucket.tryConsume(now), false);
});

await test('Ex5: token bucket refills', () => {
  const bucket = new TokenBucket(5, 2); // 2 tokens/sec
  const now = 1000;
  for (let i = 0; i < 5; i++) bucket.tryConsume(now);
  assertEqual(bucket.getRemaining(now), 0);
  assertEqual(bucket.getRemaining(now + 1000), 2);
});

// --- Exercise 6 Tests ---
await test('Ex6: outbox publishes and tracks messages', () => {
  const outbox = new OutboxPublisher();
  const msg = outbox.publish('orders', { orderId: '123' });
  assert(msg.messageId.length > 0, 'Should have messageId');
  assertEqual(msg.published, false);
  assertEqual(outbox.getPending().length, 1);
  outbox.markPublished(msg.messageId);
  assertEqual(outbox.getPending().length, 0);
});

await test('Ex6: inbox deduplicates messages', async () => {
  const inbox = new InboxConsumer();
  let callCount = 0;
  const handler = async (payload: unknown) => { callCount++; return 'processed'; };
  const r1 = await inbox.consume('msg-1', { data: 'test' }, handler);
  assertEqual(r1.processed, true);
  const r2 = await inbox.consume('msg-1', { data: 'test' }, handler);
  assertEqual(r2.processed, false);
  assertEqual(callCount, 1);
});

// --- Exercise 7 Tests ---
await test('Ex7: health aggregator — healthy', async () => {
  const health = new HealthAggregator();
  health.register('database', async () => true, true);
  health.register('cache', async () => true, false);
  const result = await health.check();
  assertEqual(result.status, 'healthy');
});

await test('Ex7: health aggregator — unhealthy on critical failure', async () => {
  const health = new HealthAggregator();
  health.register('database', async () => false, true);
  health.register('cache', async () => true, false);
  const result = await health.check();
  assertEqual(result.status, 'unhealthy');
});

await test('Ex7: health aggregator — degraded on non-critical failure', async () => {
  const health = new HealthAggregator();
  health.register('database', async () => true, true);
  health.register('cache', async () => false, false);
  const result = await health.check();
  assertEqual(result.status, 'degraded');
});

// --- Exercise 8 Tests ---
await test('Ex8: full order flow runs successfully', async () => {
  const result = await runOrderFlow();
  assertEqual(result.sagaResult.success, true);
  assertEqual(result.events.length, 3);
  assertEqual(result.idempotent, true);
});

summary();
