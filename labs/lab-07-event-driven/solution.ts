// =============================================================================
// Lab 07 — Event-Driven (Solution)
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

interface BaseEvent {
  id: string;
  type: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface OrderCreated extends BaseEvent {
  type: 'OrderCreated';
  payload: { orderId: string; customerId: string; items: Array<{ productId: string; quantity: number; price: number }> };
}

interface PaymentProcessed extends BaseEvent {
  type: 'PaymentProcessed';
  payload: { orderId: string; amount: number; method: string };
}

interface StockReserved extends BaseEvent {
  type: 'StockReserved';
  payload: { orderId: string; items: Array<{ productId: string; quantity: number }> };
}

interface CustomerNotified extends BaseEvent {
  type: 'CustomerNotified';
  payload: { orderId: string; customerId: string; channel: string; message: string };
}

type DomainEvent = OrderCreated | PaymentProcessed | StockReserved | CustomerNotified;

function createEvent<T extends DomainEvent>(type: T['type'], payload: T['payload'], metadata?: Record<string, unknown>): T {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: Date.now(),
    payload,
    metadata,
  } as T;
}

// =============================================================================
// Exercise 2: Event Bus — typed EventBus with on, emit, off
// =============================================================================

type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => void | Promise<void>;

class EventBus {
  private handlers: Map<string, Set<EventHandler<any>>> = new Map();

  on<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        await handler(event);
      }
    }
  }

  off<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

// =============================================================================
// Exercise 3: Domain Events — Aggregate base class with Order aggregate
// =============================================================================

abstract class Aggregate {
  private uncommittedEvents: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this.uncommittedEvents.push(event);
  }

  getUncommittedEvents(): DomainEvent[] {
    return [...this.uncommittedEvents];
  }

  clearEvents(): void {
    this.uncommittedEvents = [];
  }
}

class Order extends Aggregate {
  public status: string = 'created';
  public orderId: string;
  public customerId: string;
  public items: Array<{ productId: string; quantity: number; price: number }>;

  constructor(orderId: string, customerId: string, items: Array<{ productId: string; quantity: number; price: number }>) {
    super();
    this.orderId = orderId;
    this.customerId = customerId;
    this.items = items;

    this.addEvent(createEvent<OrderCreated>('OrderCreated', {
      orderId,
      customerId,
      items,
    }));
  }

  reserveStock(): void {
    if (this.status !== 'created') throw new Error('Cannot reserve stock: invalid state');
    this.status = 'stock_reserved';
    this.addEvent(createEvent<StockReserved>('StockReserved', {
      orderId: this.orderId,
      items: this.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
    }));
  }

  processPayment(amount: number, method: string): void {
    if (this.status !== 'stock_reserved') throw new Error('Cannot process payment: invalid state');
    this.status = 'payment_processed';
    this.addEvent(createEvent<PaymentProcessed>('PaymentProcessed', {
      orderId: this.orderId,
      amount,
      method,
    }));
  }

  notifyCustomer(channel: string, message: string): void {
    if (this.status !== 'payment_processed') throw new Error('Cannot notify: invalid state');
    this.status = 'completed';
    this.addEvent(createEvent<CustomerNotified>('CustomerNotified', {
      orderId: this.orderId,
      customerId: this.customerId,
      channel,
      message,
    }));
  }
}

// =============================================================================
// Exercise 4: Idempotent Event Handler
// =============================================================================

class IdempotentHandler<T extends DomainEvent> {
  private processedIds: Set<string> = new Set();
  private handler: EventHandler<T>;
  public processedCount: number = 0;

  constructor(handler: EventHandler<T>) {
    this.handler = handler;
  }

  async handle(event: T): Promise<boolean> {
    if (this.processedIds.has(event.id)) {
      return false; // already processed
    }
    this.processedIds.add(event.id);
    await this.handler(event);
    this.processedCount++;
    return true;
  }

  isProcessed(eventId: string): boolean {
    return this.processedIds.has(eventId);
  }

  reset(): void {
    this.processedIds.clear();
    this.processedCount = 0;
  }
}

// =============================================================================
// Exercise 5: Event Versioning — upcasting V1 to V2
// =============================================================================

interface OrderCreatedV1 {
  type: 'OrderCreated';
  version: 1;
  data: {
    orderId: string;
    customer: string; // V1: single string
    total: number;
  };
}

interface OrderCreatedV2 {
  type: 'OrderCreated';
  version: 2;
  data: {
    orderId: string;
    customer: { id: string; name: string; email: string }; // V2: structured
    total: number;
    currency: string; // V2: added field
  };
}

function upcastOrderCreatedV1toV2(v1: OrderCreatedV1): OrderCreatedV2 {
  return {
    type: 'OrderCreated',
    version: 2,
    data: {
      orderId: v1.data.orderId,
      customer: {
        id: v1.data.customer,
        name: v1.data.customer,
        email: `${v1.data.customer}@unknown.com`,
      },
      total: v1.data.total,
      currency: 'EUR', // default for V1 events
    },
  };
}

type VersionedEvent = OrderCreatedV1 | OrderCreatedV2;

function upcastEvent(event: VersionedEvent): OrderCreatedV2 {
  if (event.version === 1) {
    return upcastOrderCreatedV1toV2(event as OrderCreatedV1);
  }
  return event as OrderCreatedV2;
}

// =============================================================================
// Exercise 6: Event Chain — event-driven workflow
// =============================================================================

interface WorkflowContext {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  stepsCompleted: string[];
}

async function runEventDrivenWorkflow(context: WorkflowContext): Promise<WorkflowContext> {
  const bus = new EventBus();
  const result = { ...context, stepsCompleted: [] as string[] };

  // Step 2: reserve stock when order created
  bus.on<OrderCreated>('OrderCreated', async (_event) => {
    await simulateNetworkDelay(5);
    result.stepsCompleted.push('stock_reserved');
    await bus.emit(createEvent<StockReserved>('StockReserved', {
      orderId: result.orderId,
      items: result.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
    }));
  });

  // Step 3: process payment when stock reserved
  bus.on<StockReserved>('StockReserved', async (_event) => {
    await simulateNetworkDelay(5);
    const totalAmount = result.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    result.stepsCompleted.push('payment_processed');
    await bus.emit(createEvent<PaymentProcessed>('PaymentProcessed', {
      orderId: result.orderId,
      amount: totalAmount,
      method: 'card',
    }));
  });

  // Step 4: notify when payment processed
  bus.on<PaymentProcessed>('PaymentProcessed', async (_event) => {
    await simulateNetworkDelay(5);
    result.stepsCompleted.push('customer_notified');
  });

  // Step 1: emit order created
  result.stepsCompleted.push('order_created');
  await bus.emit(createEvent<OrderCreated>('OrderCreated', {
    orderId: result.orderId,
    customerId: result.customerId,
    items: result.items,
  }));

  return result;
}

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
