// =============================================================================
// Lab 14 — Outbox Pattern (Solution)
// =============================================================================

import { createTestRunner, createMockMessageBroker } from '../test-utils.js';

const { test, assert, assertEqual, assertGreaterThan, summary } = createTestRunner('Lab 14 — Outbox Pattern');

// =============================================================================
// Types communs
// =============================================================================

interface OutboxEntry {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
  published: boolean;
}

interface DatabaseRecord {
  id: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

// =============================================================================
// Exercice 1 : Dual Write Problem
// =============================================================================

interface DualWriteResult {
  dbWritten: boolean;
  messagePublished: boolean;
}

function dualWriteOperation(
  db: Map<string, DatabaseRecord>,
  broker: ReturnType<typeof createMockMessageBroker>,
  record: DatabaseRecord,
  publishShouldFail: boolean
): DualWriteResult {
  let dbWritten = false;
  let messagePublished = false;

  // Step 1: Write to DB
  db.set(record.id, record);
  dbWritten = true;

  // Step 2: Try to publish
  try {
    if (publishShouldFail) {
      throw new Error('Broker unavailable');
    }
    broker.publish('events', record);
    messagePublished = true;
  } catch {
    messagePublished = false;
  }

  return { dbWritten, messagePublished };
}

// =============================================================================
// Exercice 2 : Outbox Table
// =============================================================================

interface OutboxWriter {
  writeWithOutbox(record: DatabaseRecord, eventType: string, eventPayload: Record<string, unknown>): { record: DatabaseRecord; outboxEntry: OutboxEntry };
  getDatabase(): Map<string, DatabaseRecord>;
  getOutbox(): OutboxEntry[];
}

function createOutboxWriter(): OutboxWriter {
  const database = new Map<string, DatabaseRecord>();
  const outbox: OutboxEntry[] = [];
  let counter = 0;

  return {
    writeWithOutbox(record, eventType, eventPayload) {
      // Atomic write: both record and outbox entry
      database.set(record.id, record);
      const outboxEntry: OutboxEntry = {
        id: `outbox-${++counter}`,
        aggregateId: record.id,
        eventType,
        payload: eventPayload,
        createdAt: Date.now(),
        published: false,
      };
      outbox.push(outboxEntry);
      return { record, outboxEntry };
    },
    getDatabase() {
      return database;
    },
    getOutbox() {
      return outbox;
    },
  };
}

// =============================================================================
// Exercice 3 : Polling Publisher
// =============================================================================

interface PollingPublisher {
  pollAndPublish(): number;
  getPublishedCount(): number;
}

function createPollingPublisher(
  outbox: OutboxEntry[],
  broker: ReturnType<typeof createMockMessageBroker>,
  channel: string
): PollingPublisher {
  let totalPublished = 0;

  return {
    pollAndPublish() {
      let count = 0;
      for (const entry of outbox) {
        if (!entry.published) {
          broker.publish(channel, entry.payload);
          entry.published = true;
          count++;
          totalPublished++;
        }
      }
      return count;
    },
    getPublishedCount() {
      return totalPublished;
    },
  };
}

// =============================================================================
// Exercice 4 : Inbox Deduplication
// =============================================================================

interface Inbox {
  isProcessed(messageId: string): boolean;
  markProcessed(messageId: string): void;
  getProcessedCount(): number;
}

function createInbox(): Inbox {
  const processed = new Set<string>();

  return {
    isProcessed(messageId) {
      return processed.has(messageId);
    },
    markProcessed(messageId) {
      processed.add(messageId);
    },
    getProcessedCount() {
      return processed.size;
    },
  };
}

// =============================================================================
// Exercice 5 : Idempotent Consumer
// =============================================================================

interface Message {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

interface IdempotentConsumer {
  consume(message: Message): { processed: boolean; duplicate: boolean };
  getResults(): Map<string, unknown>;
  getProcessedCount(): number;
}

function createIdempotentConsumer(
  handler: (message: Message) => unknown
): IdempotentConsumer {
  const inbox = createInbox();
  const results = new Map<string, unknown>();

  return {
    consume(message) {
      if (inbox.isProcessed(message.id)) {
        return { processed: false, duplicate: true };
      }
      const result = handler(message);
      results.set(message.id, result);
      inbox.markProcessed(message.id);
      return { processed: true, duplicate: false };
    },
    getResults() {
      return results;
    },
    getProcessedCount() {
      return inbox.getProcessedCount();
    },
  };
}

// =============================================================================
// Exercice 6 : End-to-End Reliable Messaging
// =============================================================================

interface ReliableMessagingSystem {
  produce(record: DatabaseRecord, eventType: string, payload: Record<string, unknown>): void;
  publishPending(): number;
  consume(message: Message): { processed: boolean; duplicate: boolean };
  getStats(): { produced: number; published: number; consumed: number; duplicatesRejected: number };
}

function createReliableMessagingSystem(
  handler: (message: Message) => unknown
): ReliableMessagingSystem {
  const outboxWriter = createOutboxWriter();
  const broker = createMockMessageBroker();
  const publisher = createPollingPublisher(outboxWriter.getOutbox(), broker, 'events');
  const consumer = createIdempotentConsumer(handler);
  let duplicatesRejected = 0;

  return {
    produce(record, eventType, payload) {
      outboxWriter.writeWithOutbox(record, eventType, payload);
    },
    publishPending() {
      return publisher.pollAndPublish();
    },
    consume(message) {
      const result = consumer.consume(message);
      if (result.duplicate) {
        duplicatesRejected++;
      }
      return result;
    },
    getStats() {
      return {
        produced: outboxWriter.getOutbox().length,
        published: publisher.getPublishedCount(),
        consumed: consumer.getProcessedCount(),
        duplicatesRejected,
      };
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 14 — Outbox Pattern\n');

  // --- Exercice 1 : Dual Write Problem ---
  await test('Ex1: dual write reussit quand le broker fonctionne', () => {
    const db = new Map<string, DatabaseRecord>();
    const broker = createMockMessageBroker();
    const record: DatabaseRecord = { id: 'rec-1', data: { name: 'Alice' }, updatedAt: Date.now() };
    const result = dualWriteOperation(db, broker, record, false);
    assertEqual(result.dbWritten, true);
    assertEqual(result.messagePublished, true);
    assert(db.has('rec-1'), 'Record should be in DB');
    assertEqual(broker.getMessages('events').length, 1);
  });

  await test('Ex1: dual write montre l incoherence quand le broker echoue', () => {
    const db = new Map<string, DatabaseRecord>();
    const broker = createMockMessageBroker();
    const record: DatabaseRecord = { id: 'rec-2', data: { name: 'Bob' }, updatedAt: Date.now() };
    const result = dualWriteOperation(db, broker, record, true);
    assertEqual(result.dbWritten, true);
    assertEqual(result.messagePublished, false);
    assert(db.has('rec-2'), 'Record should be in DB (inconsistency!)');
    assertEqual(broker.getMessages('events').length, 0);
  });

  // --- Exercice 2 : Outbox Table ---
  await test('Ex2: outbox writer ecrit record et outbox atomiquement', () => {
    const writer = createOutboxWriter();
    const record: DatabaseRecord = { id: 'rec-1', data: { name: 'Alice' }, updatedAt: Date.now() };
    const result = writer.writeWithOutbox(record, 'UserCreated', { name: 'Alice' });
    assert(writer.getDatabase().has('rec-1'), 'Record should be in DB');
    assertEqual(writer.getOutbox().length, 1);
    assertEqual(result.outboxEntry.published, false);
    assertEqual(result.outboxEntry.eventType, 'UserCreated');
  });

  await test('Ex2: outbox accumule les entrees', () => {
    const writer = createOutboxWriter();
    writer.writeWithOutbox({ id: 'r1', data: { x: 1 }, updatedAt: Date.now() }, 'Evt1', { x: 1 });
    writer.writeWithOutbox({ id: 'r2', data: { x: 2 }, updatedAt: Date.now() }, 'Evt2', { x: 2 });
    assertEqual(writer.getOutbox().length, 2);
    assertEqual(writer.getDatabase().size, 2);
  });

  // --- Exercice 3 : Polling Publisher ---
  await test('Ex3: polling publisher publie les entrees pending', () => {
    const outbox: OutboxEntry[] = [
      { id: 'o1', aggregateId: 'r1', eventType: 'Evt1', payload: { x: 1 }, createdAt: Date.now(), published: false },
      { id: 'o2', aggregateId: 'r2', eventType: 'Evt2', payload: { x: 2 }, createdAt: Date.now(), published: false },
    ];
    const broker = createMockMessageBroker();
    const publisher = createPollingPublisher(outbox, broker, 'events');
    const count = publisher.pollAndPublish();
    assertEqual(count, 2);
    assertEqual(broker.getMessages('events').length, 2);
    assertEqual(outbox[0].published, true);
    assertEqual(outbox[1].published, true);
  });

  await test('Ex3: polling publisher ne re-publie pas les entrees deja publiees', () => {
    const outbox: OutboxEntry[] = [
      { id: 'o1', aggregateId: 'r1', eventType: 'Evt1', payload: { x: 1 }, createdAt: Date.now(), published: true },
      { id: 'o2', aggregateId: 'r2', eventType: 'Evt2', payload: { x: 2 }, createdAt: Date.now(), published: false },
    ];
    const broker = createMockMessageBroker();
    const publisher = createPollingPublisher(outbox, broker, 'events');
    const count = publisher.pollAndPublish();
    assertEqual(count, 1);
    assertEqual(broker.getMessages('events').length, 1);
  });

  // --- Exercice 4 : Inbox Deduplication ---
  await test('Ex4: inbox detecte les messages deja traites', () => {
    const inbox = createInbox();
    assertEqual(inbox.isProcessed('msg-1'), false);
    inbox.markProcessed('msg-1');
    assertEqual(inbox.isProcessed('msg-1'), true);
    assertEqual(inbox.isProcessed('msg-2'), false);
    assertEqual(inbox.getProcessedCount(), 1);
  });

  // --- Exercice 5 : Idempotent Consumer ---
  await test('Ex5: consumer traite un message une seule fois', () => {
    let callCount = 0;
    const consumer = createIdempotentConsumer((msg) => {
      callCount++;
      return { result: `processed-${msg.id}` };
    });
    const msg: Message = { id: 'msg-1', type: 'TestEvent', payload: { value: 42 } };

    const first = consumer.consume(msg);
    assertEqual(first.processed, true);
    assertEqual(first.duplicate, false);

    const second = consumer.consume(msg);
    assertEqual(second.processed, false);
    assertEqual(second.duplicate, true);

    assertEqual(callCount, 1);
    assertEqual(consumer.getProcessedCount(), 1);
  });

  await test('Ex5: consumer traite des messages differents independamment', () => {
    const consumer = createIdempotentConsumer((msg) => msg.payload);
    consumer.consume({ id: 'a', type: 'T', payload: { v: 1 } });
    consumer.consume({ id: 'b', type: 'T', payload: { v: 2 } });
    consumer.consume({ id: 'a', type: 'T', payload: { v: 1 } }); // duplicate
    assertEqual(consumer.getProcessedCount(), 2);
    assertEqual(consumer.getResults().size, 2);
  });

  // --- Exercice 6 : End-to-End Reliable Messaging ---
  await test('Ex6: systeme fiable produit, publie et consomme', () => {
    const system = createReliableMessagingSystem((msg) => ({ handled: msg.id }));
    system.produce({ id: 'r1', data: { x: 1 }, updatedAt: Date.now() }, 'Evt1', { x: 1 });
    system.produce({ id: 'r2', data: { x: 2 }, updatedAt: Date.now() }, 'Evt2', { x: 2 });

    const published = system.publishPending();
    assertEqual(published, 2);

    const res1 = system.consume({ id: 'msg-1', type: 'Evt1', payload: { x: 1 } });
    assertEqual(res1.processed, true);
    const res2 = system.consume({ id: 'msg-1', type: 'Evt1', payload: { x: 1 } }); // duplicate
    assertEqual(res2.duplicate, true);

    const stats = system.getStats();
    assertEqual(stats.produced, 2);
    assertEqual(stats.published, 2);
    assertEqual(stats.consumed, 1);
    assertEqual(stats.duplicatesRejected, 1);
  });

  summary();
}

main();
