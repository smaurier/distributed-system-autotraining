// =============================================================================
// Lab 24 — Projet Final (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Service Communication
// =============================================================================
// TODO: Define ServiceResponse interface:
//   { status: number; data: unknown; correlationId: string; durationMs: number }

// TODO: Implement class ServiceClient with:
//   - constructor(options: { timeoutMs: number })
//   - async callService(name: string, path: string, options?: {
//       correlationId?: string; body?: unknown
//     }): Promise<ServiceResponse>
//     - Generate correlationId if not provided (UUID v4 format)
//     - Simulate service call with small delay
//     - Return response with correlationId and durationMs

// =============================================================================
// Exercise 2: Event Store
// =============================================================================
// TODO: Define DomainEvent interface:
//   { eventId: string; streamId: string; type: string; data: unknown; timestamp: number; version: number }

// TODO: Implement class EventStore with:
//   - append(streamId: string, events: { type: string; data: unknown }[]): DomainEvent[]
//     - Assign eventId (uuid), timestamp, and auto-incrementing version per stream
//   - getStream(streamId: string): DomainEvent[]
//   - getAllEvents(): DomainEvent[]
//   - getStreamVersion(streamId: string): number

// =============================================================================
// Exercise 3: Saga Orchestrator
// =============================================================================
// TODO: Define SagaStep interface:
//   { name: string; execute: () => Promise<unknown>; compensate: () => Promise<void> }

// TODO: Define SagaResult interface:
//   { success: boolean; completedSteps: string[]; failedStep?: string; compensatedSteps: string[]; error?: string }

// TODO: Implement class SagaOrchestrator with:
//   - addStep(name: string, execute: () => Promise<unknown>, compensate: () => Promise<void>): void
//   - async run(): Promise<SagaResult>
//     - Execute steps in order
//     - On failure: run compensations in reverse order for completed steps
//     - Return SagaResult

// =============================================================================
// Exercise 4: Circuit Breaker
// =============================================================================
// TODO: Implement class CircuitBreaker with:
//   - state: 'closed' | 'open' | 'half-open'
//   - constructor(options: { failureThreshold: number; resetTimeoutMs: number })
//   - async call<T>(fn: () => Promise<T>): Promise<T>
//     - closed: execute fn, track failures, open if threshold exceeded
//     - open: reject with Error('Circuit breaker is open') unless timeout elapsed
//     - half-open: try fn, close on success, open on failure

// =============================================================================
// Exercise 5: Rate Limiter (Token Bucket)
// =============================================================================
// TODO: Implement class TokenBucket with:
//   - constructor(maxTokens: number, refillRate: number) // tokens per second
//   - tryConsume(now?: number): boolean — consume 1 token if available
//   - getRemaining(now?: number): number — refill first, return available tokens

// =============================================================================
// Exercise 6: Outbox + Inbox
// =============================================================================
// TODO: Define OutboxMessage interface:
//   { messageId: string; destination: string; payload: unknown; createdAt: number; published: boolean }

// TODO: Implement class OutboxPublisher with:
//   - publish(destination: string, payload: unknown): OutboxMessage
//     - Create message in outbox (published=false)
//   - markPublished(messageId: string): void
//   - getPending(): OutboxMessage[]
//   - getAll(): OutboxMessage[]

// TODO: Implement class InboxConsumer with:
//   - async consume(messageId: string, payload: unknown, handler: (payload: unknown) => Promise<unknown>): Promise<{ processed: boolean; result: unknown }>
//     - Deduplicate by messageId; if already seen, return cached result
//   - isProcessed(messageId: string): boolean

// =============================================================================
// Exercise 7: Health Check
// =============================================================================
// TODO: Define HealthStatus type: 'healthy' | 'degraded' | 'unhealthy'

// TODO: Implement class HealthAggregator with:
//   - register(name: string, check: () => Promise<boolean>, critical: boolean): void
//   - async check(): Promise<{ status: HealthStatus; details: { name: string; healthy: boolean; critical: boolean }[] }>
//     - healthy: all pass
//     - unhealthy: any critical fails
//     - degraded: some non-critical fail

// =============================================================================
// Exercise 8: Integration Test
// =============================================================================
// TODO: Implement async function runOrderFlow(): Promise<{
//   sagaResult: SagaResult;
//   events: DomainEvent[];
//   idempotent: boolean;
// }>
//   - Create an EventStore and a SagaOrchestrator
//   - Define saga steps:
//     1. "create-order" — appends OrderCreated event
//     2. "reserve-stock" — appends StockReserved event
//     3. "process-payment" — appends PaymentProcessed event
//   - Run the saga
//   - Check idempotency: run the same order again, verify event count doesn't double
//   - Return results

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
