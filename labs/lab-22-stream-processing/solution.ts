// =============================================================================
// Lab 22 — Stream Processing (Solution)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Partitioned Log
// =============================================================================

interface LogRecord {
  key: string;
  value: unknown;
  timestamp: number;
  partition: number;
  offset: number;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

class PartitionedLog {
  private numPartitions: number;
  private partitions: LogRecord[][] = [];

  constructor(numPartitions: number) {
    this.numPartitions = numPartitions;
    for (let i = 0; i < numPartitions; i++) {
      this.partitions.push([]);
    }
  }

  append(key: string, value: unknown): LogRecord {
    const partition = hashCode(key) % this.numPartitions;
    const offset = this.partitions[partition].length;
    const record: LogRecord = {
      key,
      value,
      timestamp: Date.now(),
      partition,
      offset,
    };
    this.partitions[partition].push(record);
    return record;
  }

  read(partition: number, fromOffset: number = 0): LogRecord[] {
    return this.partitions[partition].slice(fromOffset);
  }

  getPartitionCount(): number {
    return this.numPartitions;
  }

  getPartitionSize(partition: number): number {
    return this.partitions[partition].length;
  }
}

// =============================================================================
// Exercise 2: Consumer Groups
// =============================================================================

interface Assignment {
  consumerId: string;
  partitions: number[];
}

class ConsumerGroup {
  private groupId: string;
  private numPartitions: number;
  private consumers: string[] = [];

  constructor(groupId: string, numPartitions: number) {
    this.groupId = groupId;
    this.numPartitions = numPartitions;
  }

  private rebalance(): Assignment[] {
    const assignments: Assignment[] = this.consumers.map(id => ({
      consumerId: id,
      partitions: [],
    }));

    if (this.consumers.length === 0) return assignments;

    // Round-robin assignment
    for (let p = 0; p < this.numPartitions; p++) {
      const consumerIndex = p % this.consumers.length;
      assignments[consumerIndex].partitions.push(p);
    }

    return assignments;
  }

  addConsumer(consumerId: string): Assignment[] {
    this.consumers.push(consumerId);
    return this.rebalance();
  }

  removeConsumer(consumerId: string): Assignment[] {
    this.consumers = this.consumers.filter(c => c !== consumerId);
    return this.rebalance();
  }

  getAssignment(consumerId: string): number[] {
    const assignments = this.rebalance();
    const found = assignments.find(a => a.consumerId === consumerId);
    return found ? found.partitions : [];
  }

  getConsumerCount(): number {
    return this.consumers.length;
  }
}

// =============================================================================
// Exercise 3: Tumbling Window
// =============================================================================

interface WindowEvent {
  key: string;
  value: number;
  timestamp: number;
}

interface WindowResult {
  windowStart: number;
  windowEnd: number;
  key: string;
  count: number;
  sum: number;
  avg: number;
}

class TumblingWindow {
  private windowSizeMs: number;
  private currentWindowStart: number | null = null;
  private events: WindowEvent[] = [];

  constructor(windowSizeMs: number) {
    this.windowSizeMs = windowSizeMs;
  }

  private getWindowStart(timestamp: number): number {
    return Math.floor(timestamp / this.windowSizeMs) * this.windowSizeMs;
  }

  private emitWindow(): WindowResult | null {
    if (this.events.length === 0) return null;

    const key = this.events[0].key;
    const sum = this.events.reduce((s, e) => s + e.value, 0);
    const count = this.events.length;

    const result: WindowResult = {
      windowStart: this.currentWindowStart!,
      windowEnd: this.currentWindowStart! + this.windowSizeMs,
      key,
      count,
      sum,
      avg: sum / count,
    };

    this.events = [];
    return result;
  }

  add(event: WindowEvent): WindowResult | null {
    const eventWindowStart = this.getWindowStart(event.timestamp);

    if (this.currentWindowStart === null) {
      this.currentWindowStart = eventWindowStart;
    }

    if (eventWindowStart > this.currentWindowStart) {
      // New window — emit the current one
      const result = this.emitWindow();
      this.currentWindowStart = eventWindowStart;
      this.events.push(event);
      return result;
    }

    this.events.push(event);
    return null;
  }

  flush(): WindowResult[] {
    const results: WindowResult[] = [];
    const result = this.emitWindow();
    if (result) results.push(result);
    return results;
  }
}

// =============================================================================
// Exercise 4: Sliding Window
// =============================================================================

class SlidingWindow {
  private windowSizeMs: number;
  private slideMs: number;
  private events: WindowEvent[] = [];

  constructor(windowSizeMs: number, slideMs: number) {
    this.windowSizeMs = windowSizeMs;
    this.slideMs = slideMs;
  }

  add(event: WindowEvent): void {
    this.events.push(event);
  }

  getWindows(upToTimestamp: number): WindowResult[] {
    if (this.events.length === 0) return [];

    const minTimestamp = Math.min(...this.events.map(e => e.timestamp));
    const firstWindowStart = Math.floor(minTimestamp / this.slideMs) * this.slideMs;
    const results: WindowResult[] = [];

    for (let start = firstWindowStart; start + this.windowSizeMs <= upToTimestamp; start += this.slideMs) {
      const end = start + this.windowSizeMs;
      const windowEvents = this.events.filter(e => e.timestamp >= start && e.timestamp < end);

      if (windowEvents.length === 0) continue;

      const key = windowEvents[0].key;
      const sum = windowEvents.reduce((s, e) => s + e.value, 0);
      const count = windowEvents.length;

      results.push({
        windowStart: start,
        windowEnd: end,
        key,
        count,
        sum,
        avg: sum / count,
      });
    }

    return results;
  }
}

// =============================================================================
// Exercise 5: Stream-Table Join
// =============================================================================

interface ChangelogEntry {
  key: string;
  oldValue: unknown | null;
  newValue: unknown;
  timestamp: number;
}

class StreamTable {
  private table: Map<string, unknown> = new Map();
  private changelog: ChangelogEntry[] = [];

  update(key: string, value: unknown): ChangelogEntry {
    const oldValue = this.table.has(key) ? this.table.get(key) : null;
    this.table.set(key, value);

    const entry: ChangelogEntry = {
      key,
      oldValue,
      newValue: value,
      timestamp: Date.now(),
    };
    this.changelog.push(entry);
    return entry;
  }

  get(key: string): unknown | undefined {
    return this.table.get(key);
  }

  getChangelog(): ChangelogEntry[] {
    return [...this.changelog];
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.table) {
      result[key] = value;
    }
    return result;
  }
}

// =============================================================================
// Exercise 6: Exactly-Once Simulation
// =============================================================================

class ExactlyOnceConsumer {
  private processedMessages: Map<string, unknown> = new Map();

  process(messageId: string, payload: unknown): { processed: boolean; result: unknown } {
    if (this.processedMessages.has(messageId)) {
      return { processed: false, result: this.processedMessages.get(messageId) };
    }

    // Simulate processing — store the payload as result
    const result = payload;
    this.processedMessages.set(messageId, result);
    return { processed: true, result };
  }

  getOffset(): number {
    return this.processedMessages.size;
  }

  replay(messages: { id: string; payload: unknown }[]): { processed: number; duplicates: number } {
    let processed = 0;
    let duplicates = 0;

    for (const msg of messages) {
      const result = this.process(msg.id, msg.payload);
      if (result.processed) {
        processed++;
      } else {
        duplicates++;
      }
    }

    return { processed, duplicates };
  }
}

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 22 — Stream Processing');

// --- Exercise 1 Tests ---
await test('Ex1: partitioned log appends and reads', () => {
  const log = new PartitionedLog(3);
  const r1 = log.append('user-1', { action: 'login' });
  assert(r1.partition >= 0 && r1.partition < 3, 'Partition should be in range');
  assertEqual(r1.offset, 0);
  const records = log.read(r1.partition);
  assertEqual(records.length, 1);
  assertEqual(records[0].key, 'user-1');
});

await test('Ex1: same key goes to same partition', () => {
  const log = new PartitionedLog(4);
  const r1 = log.append('key-A', 'value-1');
  const r2 = log.append('key-A', 'value-2');
  assertEqual(r1.partition, r2.partition);
  assertEqual(r2.offset, 1);
});

await test('Ex1: read from offset', () => {
  const log = new PartitionedLog(1); // single partition
  log.append('a', 1);
  log.append('b', 2);
  log.append('c', 3);
  const fromOffset1 = log.read(0, 1);
  assertEqual(fromOffset1.length, 2);
  assertEqual(fromOffset1[0].key, 'b');
});

// --- Exercise 2 Tests ---
await test('Ex2: consumer group assigns partitions', () => {
  const group = new ConsumerGroup('group-1', 4);
  const assignments = group.addConsumer('consumer-1');
  assertEqual(assignments.length, 1);
  assertEqual(assignments[0].partitions.length, 4);
});

await test('Ex2: consumer group rebalances on add', () => {
  const group = new ConsumerGroup('group-1', 4);
  group.addConsumer('consumer-1');
  const assignments = group.addConsumer('consumer-2');
  assertEqual(assignments.length, 2);
  // Each should get 2 partitions
  assertEqual(assignments[0].partitions.length, 2);
  assertEqual(assignments[1].partitions.length, 2);
});

await test('Ex2: consumer group rebalances on remove', () => {
  const group = new ConsumerGroup('group-1', 4);
  group.addConsumer('consumer-1');
  group.addConsumer('consumer-2');
  const assignments = group.removeConsumer('consumer-2');
  assertEqual(assignments.length, 1);
  assertEqual(assignments[0].partitions.length, 4);
});

// --- Exercise 3 Tests ---
await test('Ex3: tumbling window emits on window close', () => {
  const window = new TumblingWindow(100);
  const r1 = window.add({ key: 'k1', value: 10, timestamp: 50 });
  assertEqual(r1, null); // window not closed yet
  const r2 = window.add({ key: 'k1', value: 20, timestamp: 80 });
  assertEqual(r2, null);
  // Event in next window closes the first
  const r3 = window.add({ key: 'k1', value: 30, timestamp: 150 });
  assert(r3 !== null, 'Should emit result');
  assertEqual(r3!.count, 2);
  assertEqual(r3!.sum, 30);
  assertEqual(r3!.avg, 15);
});

await test('Ex3: tumbling window flush returns remaining', () => {
  const window = new TumblingWindow(100);
  window.add({ key: 'k1', value: 5, timestamp: 10 });
  window.add({ key: 'k1', value: 15, timestamp: 20 });
  const results = window.flush();
  assertEqual(results.length, 1);
  assertEqual(results[0].sum, 20);
});

// --- Exercise 4 Tests ---
await test('Ex4: sliding window produces overlapping windows', () => {
  const sw = new SlidingWindow(100, 50); // 100ms window, 50ms slide
  sw.add({ key: 'k1', value: 10, timestamp: 25 });
  sw.add({ key: 'k1', value: 20, timestamp: 75 });
  sw.add({ key: 'k1', value: 30, timestamp: 125 });
  const windows = sw.getWindows(200);
  // Windows: [0,100), [50,150), [100,200)
  assert(windows.length >= 2, 'Should have at least 2 completed windows');
});

await test('Ex4: sliding window aggregates correctly', () => {
  const sw = new SlidingWindow(100, 100); // same as tumbling
  sw.add({ key: 'k1', value: 10, timestamp: 10 });
  sw.add({ key: 'k1', value: 20, timestamp: 50 });
  const windows = sw.getWindows(200);
  assert(windows.length >= 1, 'Should have at least 1 window');
  assertEqual(windows[0].sum, 30);
});

// --- Exercise 5 Tests ---
await test('Ex5: stream table update and get', () => {
  const table = new StreamTable();
  const entry = table.update('user-1', { name: 'Alice' });
  assertEqual(entry.oldValue, null);
  assertEqual(table.get('user-1')!.toString(), ({ name: 'Alice' }).toString());
});

await test('Ex5: stream table tracks changelog', () => {
  const table = new StreamTable();
  table.update('user-1', 'v1');
  table.update('user-1', 'v2');
  const changelog = table.getChangelog();
  assertEqual(changelog.length, 2);
  assertEqual(changelog[1].oldValue, 'v1');
  assertEqual(changelog[1].newValue, 'v2');
});

await test('Ex5: stream table snapshot', () => {
  const table = new StreamTable();
  table.update('a', 1);
  table.update('b', 2);
  const snap = table.snapshot();
  assertEqual(snap['a'], 1);
  assertEqual(snap['b'], 2);
});

// --- Exercise 6 Tests ---
await test('Ex6: exactly-once processes unique messages', () => {
  const consumer = new ExactlyOnceConsumer();
  const r1 = consumer.process('msg-1', { data: 'hello' });
  assertEqual(r1.processed, true);
  assertEqual(consumer.getOffset(), 1);
});

await test('Ex6: exactly-once deduplicates messages', () => {
  const consumer = new ExactlyOnceConsumer();
  consumer.process('msg-1', { data: 'hello' });
  const r2 = consumer.process('msg-1', { data: 'hello' });
  assertEqual(r2.processed, false);
  assertEqual(consumer.getOffset(), 1);
});

await test('Ex6: exactly-once replay counts correctly', () => {
  const consumer = new ExactlyOnceConsumer();
  consumer.process('msg-1', 'first');
  const result = consumer.replay([
    { id: 'msg-1', payload: 'first' },
    { id: 'msg-2', payload: 'second' },
    { id: 'msg-3', payload: 'third' },
  ]);
  assertEqual(result.processed, 2);
  assertEqual(result.duplicates, 1);
  assertEqual(consumer.getOffset(), 3);
});

summary();
