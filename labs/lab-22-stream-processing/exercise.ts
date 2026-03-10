// =============================================================================
// Lab 22 — Stream Processing (Exercise)
// =============================================================================

import {
  createTestRunner,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Partitioned Log
// =============================================================================
// TODO: Define LogRecord interface:
//   { key: string; value: unknown; timestamp: number; partition: number; offset: number }

// TODO: Implement class PartitionedLog with:
//   - constructor(numPartitions: number)
//   - append(key: string, value: unknown): LogRecord
//     - Route to partition based on hash of key: hashCode(key) % numPartitions
//     - Assign sequential offset within partition
//   - read(partition: number, fromOffset?: number): LogRecord[]
//     - Return records from partition, optionally starting from offset
//   - getPartitionCount(): number
//   - getPartitionSize(partition: number): number

// =============================================================================
// Exercise 2: Consumer Groups
// =============================================================================
// TODO: Define Assignment interface:
//   { consumerId: string; partitions: number[] }

// TODO: Implement class ConsumerGroup with:
//   - constructor(groupId: string, numPartitions: number)
//   - addConsumer(consumerId: string): Assignment[]
//     - Rebalance partitions across all consumers (round-robin)
//     - Return full assignment list
//   - removeConsumer(consumerId: string): Assignment[]
//     - Remove consumer and rebalance, return new assignments
//   - getAssignment(consumerId: string): number[]
//   - getConsumerCount(): number

// =============================================================================
// Exercise 3: Tumbling Window
// =============================================================================
// TODO: Define WindowEvent interface:
//   { key: string; value: number; timestamp: number }

// TODO: Define WindowResult interface:
//   { windowStart: number; windowEnd: number; key: string; count: number; sum: number; avg: number }

// TODO: Implement class TumblingWindow with:
//   - constructor(windowSizeMs: number)
//   - add(event: WindowEvent): WindowResult | null
//     - Add event to its window (determined by timestamp)
//     - If event's window is after current window, close current window and emit result
//     - Return WindowResult when a window closes, null otherwise
//   - flush(): WindowResult[] — close all open windows and return results

// =============================================================================
// Exercise 4: Sliding Window
// =============================================================================
// TODO: Implement class SlidingWindow with:
//   - constructor(windowSizeMs: number, slideMs: number)
//   - add(event: WindowEvent): void
//   - getWindows(upToTimestamp: number): WindowResult[]
//     - Return results for all completed windows up to the given timestamp
//     - A window [start, start+windowSize) is complete when upToTimestamp >= start+windowSize

// =============================================================================
// Exercise 5: Stream-Table Join
// =============================================================================
// TODO: Define ChangelogEntry interface:
//   { key: string; oldValue: unknown | null; newValue: unknown; timestamp: number }

// TODO: Implement class StreamTable with:
//   - constructor()
//   - update(key: string, value: unknown): ChangelogEntry
//     - Update table, record old value, return changelog entry
//   - get(key: string): unknown | undefined
//   - getChangelog(): ChangelogEntry[]
//   - snapshot(): Record<string, unknown> — return current table state

// =============================================================================
// Exercise 6: Exactly-Once Simulation
// =============================================================================
// TODO: Implement class ExactlyOnceConsumer with:
//   - constructor()
//   - process(messageId: string, payload: unknown): { processed: boolean; result: unknown }
//     - If messageId already processed, return cached result with processed=false
//     - Otherwise process, cache result, return with processed=true
//   - getOffset(): number — return number of unique messages processed
//   - replay(messages: { id: string; payload: unknown }[]): { processed: number; duplicates: number }
//     - Process array of messages, count new vs duplicates

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
