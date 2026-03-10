// =============================================================================
// Lab 14 — Outbox Pattern (Exercice)
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
// Demontrer le probleme : on ecrit en BD puis on publie un message.
// Si la publication echoue, la BD et le broker sont incoherents.
//
// Implementer dualWriteOperation qui :
// - Ecrit dans le "database" (Map)
// - Publie un message via le broker
// - Si publishShouldFail=true, la publication throw apres l'ecriture BD
// - Retourner { dbWritten: boolean, messagePublished: boolean }
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
  // TODO: Implementer l'operation dual write
  // 1. Ecrire le record dans db
  // 2. Tenter de publier sur le broker (channel 'events')
  //    - Si publishShouldFail, throw new Error('Broker unavailable')
  // 3. Retourner le resultat (dbWritten/messagePublished)
  // 4. En cas d'erreur de publication, dbWritten=true mais messagePublished=false
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Outbox Table
// Ecrire l'evenement dans l'outbox dans la meme "transaction" que la donnee.
// Ainsi, si l'ecriture reussit, l'outbox contient aussi l'evenement.
// =============================================================================

interface OutboxWriter {
  writeWithOutbox(record: DatabaseRecord, eventType: string, eventPayload: Record<string, unknown>): { record: DatabaseRecord; outboxEntry: OutboxEntry };
  getDatabase(): Map<string, DatabaseRecord>;
  getOutbox(): OutboxEntry[];
}

function createOutboxWriter(): OutboxWriter {
  // TODO: Implementer l'outbox writer
  // - writeWithOutbox() ecrit le record ET l'entree outbox atomiquement
  // - L'entree outbox a published=false initialement
  // - Generer un id unique pour l'entree outbox (ex: `outbox-${counter}`)
  // - getDatabase() retourne la map BD
  // - getOutbox() retourne toutes les entrees outbox
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Polling Publisher
// Un poller lit periodiquement les entrees outbox non publiees
// et les publie sur le broker, puis les marque comme publiees.
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
  // TODO: Implementer le polling publisher
  // - pollAndPublish() parcourt les entrees non publiees (published===false)
  // - Pour chaque entree, publier le payload sur le broker
  // - Marquer l'entree comme published=true
  // - Retourner le nombre d'entrees publiees dans ce cycle
  // - getPublishedCount() retourne le total cumule
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Inbox Deduplication
// Un inbox stocke les IDs des messages deja traites.
// Avant de traiter un message, on verifie s'il a deja ete vu.
// =============================================================================

interface Inbox {
  isProcessed(messageId: string): boolean;
  markProcessed(messageId: string): void;
  getProcessedCount(): number;
}

function createInbox(): Inbox {
  // TODO: Implementer l'inbox
  // - isProcessed() verifie si un messageId a deja ete traite
  // - markProcessed() marque un messageId comme traite
  // - getProcessedCount() retourne le nombre de messages traites
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Idempotent Consumer
// Un consommateur qui utilise l'inbox pour ne traiter chaque message
// qu'une seule fois, meme s'il est recu plusieurs fois.
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
  // TODO: Implementer le consommateur idempotent
  // - consume() verifie si le message a deja ete traite (via inbox)
  // - Si oui, retourner { processed: false, duplicate: true }
  // - Si non, appeler handler(message), stocker le resultat, marquer comme traite
  // - Retourner { processed: true, duplicate: false }
  // - getResults() retourne les resultats par messageId
  // - getProcessedCount() retourne le nombre de messages effectivement traites
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : End-to-End Reliable Messaging
// Combiner outbox producer + inbox consumer pour un messaging fiable.
// Le producteur ecrit dans l'outbox, le publisher poll et publie,
// le consommateur deduplique avec l'inbox.
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
  // TODO: Implementer le systeme de messaging fiable
  // - Utiliser createOutboxWriter pour la production
  // - Utiliser createPollingPublisher pour la publication
  // - Utiliser createIdempotentConsumer pour la consommation
  // - getStats() retourne les compteurs
  throw new Error('Not implemented');
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
