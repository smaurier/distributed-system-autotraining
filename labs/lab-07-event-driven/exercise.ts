// =============================================================================
// Lab 07 — Event-Driven (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
  createMockMessageBroker,
  assertIdempotent,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Event Types — domain event interfaces with type discriminant
// =============================================================================
// TODO: Define a BaseEvent interface with: id (string), type (string),
//       timestamp (number), metadata (optional Record<string, unknown>)

// TODO: Define OrderCreated interface extending BaseEvent with type 'OrderCreated'
//       payload: { orderId: string; customerId: string; items: Array<{ productId: string; quantity: number; price: number }> }

// TODO: Define PaymentProcessed interface extending BaseEvent with type 'PaymentProcessed'
//       payload: { orderId: string; amount: number; method: string }

// TODO: Define StockReserved interface extending BaseEvent with type 'StockReserved'
//       payload: { orderId: string; items: Array<{ productId: string; quantity: number }> }

// TODO: Define CustomerNotified interface extending BaseEvent with type 'CustomerNotified'
//       payload: { orderId: string; customerId: string; channel: string; message: string }

// TODO: Define DomainEvent union type = OrderCreated | PaymentProcessed | StockReserved | CustomerNotified

// TODO: Implement createEvent<T extends DomainEvent>(type, payload, metadata?) => T
//       Generate a unique id (e.g. `evt-${Date.now()}-${random}`), set timestamp to Date.now()

// =============================================================================
// Exercise 2: Event Bus — typed EventBus with on, emit, off
// =============================================================================
// TODO: Define EventHandler<T> type = (event: T) => void | Promise<void>

// TODO: Implement class EventBus with:
//   - private handlers: Map<string, Set<EventHandler<any>>>
//   - on<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void
//   - async emit(event: DomainEvent): Promise<void> — call all handlers for event.type
//   - off<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void
//   - listenerCount(type: string): number

// =============================================================================
// Exercise 3: Domain Events — Aggregate base class with Order aggregate
// =============================================================================
// TODO: Implement abstract class Aggregate with:
//   - private uncommittedEvents: DomainEvent[]
//   - protected addEvent(event: DomainEvent): void
//   - getUncommittedEvents(): DomainEvent[] — return copy
//   - clearEvents(): void

// TODO: Implement class Order extends Aggregate with:
//   - status: string (starts as 'created')
//   - constructor(orderId, customerId, items) — emits OrderCreated
//   - reserveStock() — changes status to 'stock_reserved', emits StockReserved
//   - processPayment(amount, method) — changes status to 'payment_processed', emits PaymentProcessed
//   - notifyCustomer(channel, message) — changes status to 'completed', emits CustomerNotified
//   Each method should validate state transitions

// =============================================================================
// Exercise 4: Idempotent Event Handler
// =============================================================================
// TODO: Implement class IdempotentHandler<T extends DomainEvent> with:
//   - private processedIds: Set<string>
//   - private handler: EventHandler<T>
//   - processedCount: number
//   - constructor(handler: EventHandler<T>)
//   - async handle(event: T): Promise<boolean> — return true if processed, false if duplicate
//   - isProcessed(eventId: string): boolean
//   - reset(): void

// =============================================================================
// Exercise 5: Event Versioning — upcasting V1 to V2
// =============================================================================
// TODO: Define OrderCreatedV1 interface:
//   { type: 'OrderCreated'; version: 1; data: { orderId: string; customer: string; total: number } }

// TODO: Define OrderCreatedV2 interface:
//   { type: 'OrderCreated'; version: 2; data: { orderId: string; customer: { id: string; name: string; email: string }; total: number; currency: string } }

// TODO: Implement upcastOrderCreatedV1toV2(v1: OrderCreatedV1): OrderCreatedV2
//   - Convert customer string to { id: customer, name: customer, email: `${customer}@unknown.com` }
//   - Add default currency 'EUR'

// TODO: Define VersionedEvent = OrderCreatedV1 | OrderCreatedV2

// TODO: Implement upcastEvent(event: VersionedEvent): OrderCreatedV2
//   - If version === 1, upcast; otherwise return as-is

// =============================================================================
// Exercise 6: Event Chain — event-driven workflow
// =============================================================================
// TODO: Define WorkflowContext interface:
//   { orderId: string; customerId: string; items: Array<{productId,quantity,price}>; stepsCompleted: string[] }

// TODO: Implement async runEventDrivenWorkflow(context: WorkflowContext): Promise<WorkflowContext>
//   1. Create an EventBus
//   2. Register handler for OrderCreated → adds 'stock_reserved' step, emits StockReserved
//   3. Register handler for StockReserved → adds 'payment_processed' step, emits PaymentProcessed
//   4. Register handler for PaymentProcessed → adds 'customer_notified' step
//   5. Add 'order_created' step and emit OrderCreated to start the chain
//   Use simulateNetworkDelay(5) in each handler

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 07 — Event-Driven');

// --- Exercise 1 Tests ---
await test('Ex1: createEvent produces correct OrderCreated event', () => {
  const event = createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1',
    customerId: 'cust-1',
    items: [{ productId: 'prod-1', quantity: 2, price: 29.99 }],
  });
  assertEqual(event.type, 'OrderCreated');
  assertEqual(event.payload.orderId, 'ord-1');
  assert(event.id.startsWith('evt-'), 'Event ID should start with evt-');
  assert(event.timestamp > 0, 'Timestamp should be positive');
});

await test('Ex1: type discriminant enables narrowing', () => {
  const event: DomainEvent = createEvent<PaymentProcessed>('PaymentProcessed', {
    orderId: 'ord-1',
    amount: 59.98,
    method: 'card',
  });
  if (event.type === 'PaymentProcessed') {
    assertEqual(event.payload.amount, 59.98);
    assertEqual(event.payload.method, 'card');
  } else {
    throw new Error('Type narrowing failed');
  }
});

// --- Exercise 2 Tests ---
await test('Ex2: EventBus on/emit delivers events to handlers', async () => {
  const bus = new EventBus();
  const received: DomainEvent[] = [];
  bus.on<OrderCreated>('OrderCreated', (e) => { received.push(e); });
  const event = createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1', customerId: 'cust-1', items: [],
  });
  await bus.emit(event);
  assertEqual(received.length, 1);
  assertEqual(received[0].type, 'OrderCreated');
});

await test('Ex2: EventBus off removes handler', async () => {
  const bus = new EventBus();
  const received: DomainEvent[] = [];
  const handler = (e: OrderCreated) => { received.push(e); };
  bus.on<OrderCreated>('OrderCreated', handler);
  bus.off<OrderCreated>('OrderCreated', handler);
  await bus.emit(createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1', customerId: 'cust-1', items: [],
  }));
  assertEqual(received.length, 0);
});

await test('Ex2: EventBus supports multiple handlers for same type', async () => {
  const bus = new EventBus();
  let count = 0;
  bus.on<OrderCreated>('OrderCreated', () => { count++; });
  bus.on<OrderCreated>('OrderCreated', () => { count++; });
  await bus.emit(createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1', customerId: 'cust-1', items: [],
  }));
  assertEqual(count, 2);
});

// --- Exercise 3 Tests ---
await test('Ex3: Order aggregate collects domain events', () => {
  const order = new Order('ord-1', 'cust-1', [
    { productId: 'p1', quantity: 1, price: 10 },
  ]);
  const events = order.getUncommittedEvents();
  assertEqual(events.length, 1);
  assertEqual(events[0].type, 'OrderCreated');
});

await test('Ex3: Order state transitions emit correct events', () => {
  const order = new Order('ord-1', 'cust-1', [
    { productId: 'p1', quantity: 2, price: 15 },
  ]);
  order.reserveStock();
  order.processPayment(30, 'card');
  order.notifyCustomer('email', 'Your order is confirmed');
  const events = order.getUncommittedEvents();
  assertEqual(events.length, 4);
  assertEqual(events[0].type, 'OrderCreated');
  assertEqual(events[1].type, 'StockReserved');
  assertEqual(events[2].type, 'PaymentProcessed');
  assertEqual(events[3].type, 'CustomerNotified');
  assertEqual(order.status, 'completed');
});

await test('Ex3: Order clearEvents resets uncommitted events', () => {
  const order = new Order('ord-1', 'cust-1', []);
  assertEqual(order.getUncommittedEvents().length, 1);
  order.clearEvents();
  assertEqual(order.getUncommittedEvents().length, 0);
});

// --- Exercise 4 Tests ---
await test('Ex4: IdempotentHandler processes event once', async () => {
  let callCount = 0;
  const handler = new IdempotentHandler<OrderCreated>(() => { callCount++; });
  const event = createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1', customerId: 'cust-1', items: [],
  });
  const first = await handler.handle(event);
  const second = await handler.handle(event);
  assertEqual(first, true);
  assertEqual(second, false);
  assertEqual(callCount, 1);
  assertEqual(handler.processedCount, 1);
});

await test('Ex4: IdempotentHandler tracks processed IDs', async () => {
  const handler = new IdempotentHandler<OrderCreated>(() => {});
  const event = createEvent<OrderCreated>('OrderCreated', {
    orderId: 'ord-1', customerId: 'cust-1', items: [],
  });
  assert(!handler.isProcessed(event.id), 'Should not be processed yet');
  await handler.handle(event);
  assert(handler.isProcessed(event.id), 'Should be processed now');
});

// --- Exercise 5 Tests ---
await test('Ex5: upcast V1 event to V2 format', () => {
  const v1: OrderCreatedV1 = {
    type: 'OrderCreated',
    version: 1,
    data: { orderId: 'ord-1', customer: 'john', total: 100 },
  };
  const v2 = upcastEvent(v1);
  assertEqual(v2.version, 2);
  assertEqual(v2.data.customer.id, 'john');
  assertEqual(v2.data.customer.name, 'john');
  assertEqual(v2.data.currency, 'EUR');
  assertEqual(v2.data.total, 100);
});

await test('Ex5: V2 event passes through unchanged', () => {
  const v2: OrderCreatedV2 = {
    type: 'OrderCreated',
    version: 2,
    data: {
      orderId: 'ord-2',
      customer: { id: 'c1', name: 'Jane', email: 'jane@example.com' },
      total: 200,
      currency: 'USD',
    },
  };
  const result = upcastEvent(v2);
  assertEqual(result.version, 2);
  assertEqual(result.data.currency, 'USD');
  assertEqual(result.data.customer.name, 'Jane');
});

// --- Exercise 6 Tests ---
await test('Ex6: event chain completes all steps in order', async () => {
  const result = await runEventDrivenWorkflow({
    orderId: 'ord-1',
    customerId: 'cust-1',
    items: [{ productId: 'p1', quantity: 2, price: 25 }],
    stepsCompleted: [],
  });
  assertEqual(result.stepsCompleted.length, 4);
  assertEqual(result.stepsCompleted[0], 'order_created');
  assertEqual(result.stepsCompleted[1], 'stock_reserved');
  assertEqual(result.stepsCompleted[2], 'payment_processed');
  assertEqual(result.stepsCompleted[3], 'customer_notified');
});

await test('Ex6: event chain with multiple items', async () => {
  const result = await runEventDrivenWorkflow({
    orderId: 'ord-2',
    customerId: 'cust-2',
    items: [
      { productId: 'p1', quantity: 1, price: 10 },
      { productId: 'p2', quantity: 3, price: 20 },
    ],
    stepsCompleted: [],
  });
  assertEqual(result.stepsCompleted.length, 4);
  assertEqual(result.stepsCompleted[3], 'customer_notified');
});

summary();
