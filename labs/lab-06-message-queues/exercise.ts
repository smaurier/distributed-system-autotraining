// =============================================================================
// Lab 06 — Message Queues (Exercise)
// =============================================================================

import { createTestRunner, simulateMessages } from '../test-utils';

// =============================================================================
// Exercice 1 : Simple queue (FIFO)
// =============================================================================

class SimpleQueue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    // TODO: Ajouter un element a la fin de la file
    throw new Error('Not implemented');
  }

  dequeue(): T | undefined {
    // TODO: Retirer et retourner le premier element
    throw new Error('Not implemented');
  }

  peek(): T | undefined {
    // TODO: Retourner le premier element sans le retirer
    throw new Error('Not implemented');
  }

  size(): number {
    // TODO: Retourner le nombre d'elements
    throw new Error('Not implemented');
  }

  isEmpty(): boolean {
    // TODO: Retourner true si la file est vide
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 2 : Pub/Sub
// =============================================================================

type MessageHandler<T> = (message: T) => void;

class PubSub<T> {
  private subscribers: Map<string, MessageHandler<T>[]> = new Map();

  subscribe(topic: string, handler: MessageHandler<T>): void {
    // TODO: Abonner un handler a un topic
    throw new Error('Not implemented');
  }

  publish(topic: string, message: T): void {
    // TODO: Publier un message a tous les abonnes du topic
    throw new Error('Not implemented');
  }

  unsubscribe(topic: string, handler: MessageHandler<T>): void {
    // TODO: Desabonner un handler d'un topic
    throw new Error('Not implemented');
  }

  getSubscriberCount(topic: string): number {
    // TODO: Retourner le nombre d'abonnes pour un topic
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 3 : Consumer groups
// =============================================================================

interface ConsumerGroup<T> {
  groupId: string;
  consumers: ((message: T) => void)[];
  nextIndex: number;
}

class ConsumerGroupQueue<T> {
  private groups: Map<string, ConsumerGroup<T>> = new Map();
  private messageLog: { groupId: string; message: T; consumerId: number }[] = [];

  addConsumer(groupId: string, consumer: (message: T) => void): void {
    // TODO: Ajouter un consommateur a un groupe
    throw new Error('Not implemented');
  }

  publish(message: T): void {
    // TODO: Envoyer le message a UN consommateur par groupe (round-robin)
    // Enregistrer dans messageLog le groupId, message, et consumerId (index du consommateur)
    throw new Error('Not implemented');
  }

  getLog(): { groupId: string; message: T; consumerId: number }[] {
    return [...this.messageLog];
  }
}

// =============================================================================
// Exercice 4 : Dead letter queue
// =============================================================================

interface DLQMessage<T> {
  originalMessage: T;
  error: string;
  attempts: number;
  timestamp: number;
}

class DeadLetterQueue<T> {
  private maxRetries: number;
  private deadLetters: DLQMessage<T>[] = [];
  private processed: T[] = [];

  constructor(maxRetries: number) {
    this.maxRetries = maxRetries;
  }

  process(message: T, handler: (msg: T) => void): void {
    // TODO: Tenter de traiter le message avec handler
    // En cas d'erreur, reessayer jusqu'a maxRetries fois
    // Si toutes les tentatives echouent, ajouter a la DLQ
    // Si succes, ajouter a processed
    throw new Error('Not implemented');
  }

  getDeadLetters(): DLQMessage<T>[] {
    return [...this.deadLetters];
  }

  getProcessed(): T[] {
    return [...this.processed];
  }

  reprocessDeadLetters(handler: (msg: T) => void): number {
    // TODO: Tenter de retraiter les messages de la DLQ
    // Retourner le nombre de messages retraites avec succes
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 5 : Message ordering
// =============================================================================

interface SequencedMessage<T> {
  sequenceNumber: number;
  payload: T;
}

class OrderedQueue<T> {
  private buffer: Map<number, T> = new Map();
  private nextExpected: number = 0;
  private delivered: T[] = [];

  receive(message: SequencedMessage<T>): T[] {
    // TODO: Recevoir un message avec un numero de sequence
    // Si c'est le numero attendu, le delivrer et verifier le buffer pour les suivants
    // Sinon, le mettre dans le buffer (gap detecte)
    // Retourner les messages delivres dans l'ordre
    throw new Error('Not implemented');
  }

  getDelivered(): T[] {
    return [...this.delivered];
  }

  getBufferSize(): number {
    return this.buffer.size;
  }

  getNextExpected(): number {
    return this.nextExpected;
  }

  hasGap(): boolean {
    // TODO: Retourner true si le buffer contient des messages (= trou dans la sequence)
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 6 : Backpressure
// =============================================================================

type OverflowStrategy = 'drop-newest' | 'drop-oldest' | 'reject';

class BoundedQueue<T> {
  private items: T[] = [];
  private capacity: number;
  private strategy: OverflowStrategy;
  private dropped: T[] = [];
  private rejected: T[] = [];

  constructor(capacity: number, strategy: OverflowStrategy) {
    this.capacity = capacity;
    this.strategy = strategy;
  }

  enqueue(item: T): boolean {
    // TODO: Ajouter un element selon la strategie de debordement
    // 'drop-newest' : si plein, ignorer le nouveau message (ajouter a dropped)
    // 'drop-oldest' : si plein, retirer le plus ancien, ajouter le nouveau (ancien dans dropped)
    // 'reject' : si plein, lever une erreur (ajouter a rejected)
    // Retourner true si l'element a ete ajoute, false sinon
    throw new Error('Not implemented');
  }

  dequeue(): T | undefined {
    // TODO: Retirer et retourner le premier element
    throw new Error('Not implemented');
  }

  size(): number {
    return this.items.length;
  }

  isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  getDropped(): T[] {
    return [...this.dropped];
  }

  getRejected(): T[] {
    return [...this.rejected];
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  const { test, assert, assertEqual, assertDeepEqual, assertThrows, summary } = createTestRunner('Lab 06 — Message Queues');

  // --- Exercice 1 ---
  console.log('\n📘 Exercice 1 : Simple queue');

  await test('Enqueue and dequeue in FIFO order', () => {
    const q = new SimpleQueue<number>();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    assertEqual(q.dequeue(), 1);
    assertEqual(q.dequeue(), 2);
    assertEqual(q.dequeue(), 3);
  });

  await test('Peek returns first without removing', () => {
    const q = new SimpleQueue<string>();
    q.enqueue('a');
    q.enqueue('b');
    assertEqual(q.peek(), 'a');
    assertEqual(q.size(), 2);
  });

  await test('Size and isEmpty are correct', () => {
    const q = new SimpleQueue<number>();
    assert(q.isEmpty(), 'New queue should be empty');
    assertEqual(q.size(), 0);
    q.enqueue(42);
    assert(!q.isEmpty(), 'Queue with item should not be empty');
    assertEqual(q.size(), 1);
  });

  await test('Dequeue on empty returns undefined', () => {
    const q = new SimpleQueue<number>();
    assertEqual(q.dequeue(), undefined);
    assertEqual(q.peek(), undefined);
  });

  // --- Exercice 2 ---
  console.log('\n📘 Exercice 2 : Pub/Sub');

  await test('Publish delivers to all subscribers', () => {
    const ps = new PubSub<string>();
    const received: string[] = [];
    ps.subscribe('news', (msg) => received.push('A:' + msg));
    ps.subscribe('news', (msg) => received.push('B:' + msg));
    ps.publish('news', 'hello');
    assertDeepEqual(received, ['A:hello', 'B:hello']);
  });

  await test('Different topics are independent', () => {
    const ps = new PubSub<string>();
    const received: string[] = [];
    ps.subscribe('topic1', (msg) => received.push('T1:' + msg));
    ps.subscribe('topic2', (msg) => received.push('T2:' + msg));
    ps.publish('topic1', 'msg1');
    assertDeepEqual(received, ['T1:msg1']);
  });

  await test('Unsubscribe removes handler', () => {
    const ps = new PubSub<string>();
    const received: string[] = [];
    const handler = (msg: string) => received.push(msg);
    ps.subscribe('test', handler);
    ps.publish('test', 'before');
    ps.unsubscribe('test', handler);
    ps.publish('test', 'after');
    assertDeepEqual(received, ['before']);
  });

  await test('Subscriber count is correct', () => {
    const ps = new PubSub<string>();
    assertEqual(ps.getSubscriberCount('test'), 0);
    const h1 = () => {};
    const h2 = () => {};
    ps.subscribe('test', h1);
    ps.subscribe('test', h2);
    assertEqual(ps.getSubscriberCount('test'), 2);
    ps.unsubscribe('test', h1);
    assertEqual(ps.getSubscriberCount('test'), 1);
  });

  // --- Exercice 3 ---
  console.log('\n📘 Exercice 3 : Consumer groups');

  await test('Each group receives each message once', () => {
    const cg = new ConsumerGroupQueue<string>();
    const groupA: string[] = [];
    const groupB: string[] = [];
    cg.addConsumer('A', (msg) => groupA.push(msg));
    cg.addConsumer('B', (msg) => groupB.push(msg));
    cg.publish('msg1');
    cg.publish('msg2');
    assertEqual(groupA.length, 2);
    assertEqual(groupB.length, 2);
  });

  await test('Round-robin within a group', () => {
    const cg = new ConsumerGroupQueue<string>();
    const consumer0: string[] = [];
    const consumer1: string[] = [];
    cg.addConsumer('G', (msg) => consumer0.push(msg));
    cg.addConsumer('G', (msg) => consumer1.push(msg));
    cg.publish('m1');
    cg.publish('m2');
    cg.publish('m3');
    cg.publish('m4');
    assertEqual(consumer0.length, 2);
    assertEqual(consumer1.length, 2);
    assertDeepEqual(consumer0, ['m1', 'm3']);
    assertDeepEqual(consumer1, ['m2', 'm4']);
  });

  await test('Message log tracks consumer assignments', () => {
    const cg = new ConsumerGroupQueue<string>();
    cg.addConsumer('G', () => {});
    cg.addConsumer('G', () => {});
    cg.publish('m1');
    cg.publish('m2');
    const log = cg.getLog();
    assertEqual(log.length, 2);
    assertEqual(log[0].consumerId, 0);
    assertEqual(log[1].consumerId, 1);
  });

  // --- Exercice 4 ---
  console.log('\n📘 Exercice 4 : Dead letter queue');

  await test('Successful processing', () => {
    const dlq = new DeadLetterQueue<string>(3);
    dlq.process('msg1', () => {});
    assertEqual(dlq.getProcessed().length, 1);
    assertEqual(dlq.getDeadLetters().length, 0);
  });

  await test('Message goes to DLQ after max retries', () => {
    const dlq = new DeadLetterQueue<string>(3);
    dlq.process('bad-msg', () => { throw new Error('processing error'); });
    assertEqual(dlq.getProcessed().length, 0);
    assertEqual(dlq.getDeadLetters().length, 1);
    assertEqual(dlq.getDeadLetters()[0].attempts, 3);
  });

  await test('Succeeds after some retries', () => {
    const dlq = new DeadLetterQueue<string>(3);
    let attempts = 0;
    dlq.process('retry-msg', () => {
      attempts++;
      if (attempts < 2) throw new Error('temporary error');
    });
    assertEqual(dlq.getProcessed().length, 1);
    assertEqual(dlq.getDeadLetters().length, 0);
  });

  await test('Reprocess dead letters', () => {
    const dlq = new DeadLetterQueue<string>(1);
    dlq.process('fail1', () => { throw new Error('fail'); });
    dlq.process('fail2', () => { throw new Error('fail'); });
    assertEqual(dlq.getDeadLetters().length, 2);
    const reprocessed = dlq.reprocessDeadLetters(() => {});
    assertEqual(reprocessed, 2);
    assertEqual(dlq.getDeadLetters().length, 0);
  });

  // --- Exercice 5 ---
  console.log('\n📘 Exercice 5 : Message ordering');

  await test('In-order delivery', () => {
    const oq = new OrderedQueue<string>();
    const d0 = oq.receive({ sequenceNumber: 0, payload: 'A' });
    const d1 = oq.receive({ sequenceNumber: 1, payload: 'B' });
    const d2 = oq.receive({ sequenceNumber: 2, payload: 'C' });
    assertDeepEqual(d0, ['A']);
    assertDeepEqual(d1, ['B']);
    assertDeepEqual(d2, ['C']);
  });

  await test('Out-of-order buffering and delivery', () => {
    const oq = new OrderedQueue<string>();
    const d2 = oq.receive({ sequenceNumber: 2, payload: 'C' });
    assertDeepEqual(d2, []);
    assert(oq.hasGap(), 'Should detect gap');
    const d1 = oq.receive({ sequenceNumber: 1, payload: 'B' });
    assertDeepEqual(d1, []);
    const d0 = oq.receive({ sequenceNumber: 0, payload: 'A' });
    assertDeepEqual(d0, ['A', 'B', 'C']);
    assert(!oq.hasGap(), 'No more gaps');
  });

  await test('Buffer size tracks pending messages', () => {
    const oq = new OrderedQueue<string>();
    oq.receive({ sequenceNumber: 3, payload: 'D' });
    oq.receive({ sequenceNumber: 5, payload: 'F' });
    assertEqual(oq.getBufferSize(), 2);
    assertEqual(oq.getNextExpected(), 0);
  });

  await test('Duplicate messages are ignored', () => {
    const oq = new OrderedQueue<string>();
    oq.receive({ sequenceNumber: 0, payload: 'A' });
    const d = oq.receive({ sequenceNumber: 0, payload: 'A-dup' });
    assertDeepEqual(d, []);
    assertDeepEqual(oq.getDelivered(), ['A']);
  });

  // --- Exercice 6 ---
  console.log('\n📘 Exercice 6 : Backpressure');

  await test('Drop-newest strategy', () => {
    const q = new BoundedQueue<number>(3, 'drop-newest');
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    const added = q.enqueue(4);
    assertEqual(added, false);
    assertEqual(q.size(), 3);
    assertEqual(q.dequeue(), 1);
    assertDeepEqual(q.getDropped(), [4]);
  });

  await test('Drop-oldest strategy', () => {
    const q = new BoundedQueue<number>(3, 'drop-oldest');
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    const added = q.enqueue(4);
    assertEqual(added, true);
    assertEqual(q.size(), 3);
    assertEqual(q.dequeue(), 2);
    assertDeepEqual(q.getDropped(), [1]);
  });

  await test('Reject strategy throws', () => {
    const q = new BoundedQueue<number>(2, 'reject');
    q.enqueue(1);
    q.enqueue(2);
    assertThrows(() => q.enqueue(3));
    assertEqual(q.size(), 2);
    assertDeepEqual(q.getRejected(), [3]);
  });

  await test('Under capacity always succeeds', () => {
    const q = new BoundedQueue<string>(5, 'drop-newest');
    assertEqual(q.enqueue('a'), true);
    assertEqual(q.enqueue('b'), true);
    assertEqual(q.size(), 2);
    assert(!q.isFull(), 'Should not be full');
  });

  summary();
}

main().catch(console.error);
