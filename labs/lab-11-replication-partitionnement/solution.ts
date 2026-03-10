// =============================================================================
// Lab 11 — Replication & Partitionnement (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils';

// =============================================================================
// Exercice 1 : Leader-follower
// =============================================================================

class LeaderFollowerStore {
  private leader: Map<string, { value: unknown; version: number }> = new Map();
  private followers: Map<string, { value: unknown; version: number }>[];
  private version: number = 0;
  private pendingReplications: { followerIndex: number; key: string; value: unknown; version: number }[] = [];

  constructor(followerCount: number) {
    this.followers = Array.from({ length: followerCount }, () => new Map());
  }

  write(key: string, value: unknown): number {
    this.version++;
    this.leader.set(key, { value, version: this.version });
    for (let i = 0; i < this.followers.length; i++) {
      this.pendingReplications.push({ followerIndex: i, key, value, version: this.version });
    }
    return this.version;
  }

  readFromLeader(key: string): { value: unknown; version: number } | undefined {
    return this.leader.get(key);
  }

  readFromFollower(index: number, key: string): { value: unknown; version: number } | undefined {
    if (index >= this.followers.length) return undefined;
    return this.followers[index].get(key);
  }

  replicateToFollowers(): number {
    let applied = 0;
    for (const rep of this.pendingReplications) {
      const follower = this.followers[rep.followerIndex];
      const existing = follower.get(rep.key);
      if (!existing || existing.version < rep.version) {
        follower.set(rep.key, { value: rep.value, version: rep.version });
        applied++;
      }
    }
    this.pendingReplications = [];
    return applied;
  }

  getPendingCount(): number {
    return this.pendingReplications.length;
  }
}

// =============================================================================
// Exercice 2 : Conflict resolution
// =============================================================================

interface TimestampedValue {
  value: unknown;
  timestamp: number;
  nodeId: string;
}

class ConflictResolver {
  static lastWriterWins(a: TimestampedValue, b: TimestampedValue): TimestampedValue {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp > b.timestamp ? a : b;
    }
    return a.nodeId > b.nodeId ? a : b;
  }

  static merge(values: TimestampedValue[], mergeFn: (a: unknown, b: unknown) => unknown): unknown {
    const sorted = [...values].sort((a, b) => a.timestamp - b.timestamp);
    return sorted.reduce<unknown>((acc, curr, index) => {
      if (index === 0) return curr.value;
      return mergeFn(acc, curr.value);
    }, undefined);
  }
}

class MultiLeaderStore {
  private nodes: Map<string, Map<string, TimestampedValue>> = new Map();

  constructor(nodeIds: string[]) {
    for (const id of nodeIds) {
      this.nodes.set(id, new Map());
    }
  }

  write(nodeId: string, key: string, value: unknown, timestamp: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    node.set(key, { value, timestamp, nodeId });
  }

  read(nodeId: string, key: string): TimestampedValue | undefined {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    return node.get(key);
  }

  syncWithLWW(): number {
    // Collect all keys across all nodes
    const allKeys = new Set<string>();
    for (const [, node] of this.nodes) {
      for (const key of node.keys()) {
        allKeys.add(key);
      }
    }

    let updates = 0;
    for (const key of allKeys) {
      // Find the winning value across all nodes
      let winner: TimestampedValue | undefined;
      for (const [, node] of this.nodes) {
        const entry = node.get(key);
        if (entry) {
          if (!winner) {
            winner = entry;
          } else {
            winner = ConflictResolver.lastWriterWins(winner, entry);
          }
        }
      }
      if (!winner) continue;

      // Apply winner to all nodes
      for (const [, node] of this.nodes) {
        const existing = node.get(key);
        if (!existing || existing.timestamp < winner.timestamp ||
            (existing.timestamp === winner.timestamp && existing.nodeId < winner.nodeId)) {
          if (!existing || JSON.stringify(existing) !== JSON.stringify(winner)) {
            node.set(key, { ...winner });
            updates++;
          }
        }
      }
    }

    return updates;
  }
}

// =============================================================================
// Exercice 3 : Consistent hashing
// =============================================================================

class ConsistentHashRing {
  private ring: Map<number, string> = new Map();
  private sortedHashes: number[] = [];
  private virtualNodes: number;

  constructor(virtualNodes: number = 100) {
    this.virtualNodes = virtualNodes;
  }

  private hash(key: string): number {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h1 ^= key.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    return (h1 >>> 0);
  }

  addNode(nodeId: string): void {
    for (let i = 0; i < this.virtualNodes; i++) {
      const h = this.hash(`${nodeId}-vn-${i}`);
      this.ring.set(h, nodeId);
    }
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  removeNode(nodeId: string): void {
    for (const [h, node] of this.ring) {
      if (node === nodeId) {
        this.ring.delete(h);
      }
    }
    this.sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(key: string): string | undefined {
    if (this.sortedHashes.length === 0) return undefined;
    const h = this.hash(key);
    for (const sh of this.sortedHashes) {
      if (sh >= h) {
        return this.ring.get(sh);
      }
    }
    // Wrap around
    return this.ring.get(this.sortedHashes[0]);
  }

  getNodes(key: string, count: number): string[] {
    if (this.sortedHashes.length === 0) return [];
    const h = this.hash(key);
    const nodes: string[] = [];
    const seen = new Set<string>();

    // Find starting index
    let startIdx = 0;
    for (let i = 0; i < this.sortedHashes.length; i++) {
      if (this.sortedHashes[i] >= h) {
        startIdx = i;
        break;
      }
      if (i === this.sortedHashes.length - 1) {
        startIdx = 0;
      }
    }

    for (let i = 0; i < this.sortedHashes.length && nodes.length < count; i++) {
      const idx = (startIdx + i) % this.sortedHashes.length;
      const nodeId = this.ring.get(this.sortedHashes[idx])!;
      if (!seen.has(nodeId)) {
        seen.add(nodeId);
        nodes.push(nodeId);
      }
    }

    return nodes;
  }

  getNodeCount(): number {
    const nodes = new Set(this.ring.values());
    return nodes.size;
  }
}

// =============================================================================
// Exercice 4 : Hash partitioning
// =============================================================================

class HashPartitioner {
  private partitionCount: number;
  private partitions: Map<number, Map<string, unknown>> = new Map();

  constructor(partitionCount: number) {
    this.partitionCount = partitionCount;
    for (let i = 0; i < partitionCount; i++) {
      this.partitions.set(i, new Map());
    }
  }

  private hash(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  getPartition(key: string): number {
    return this.hash(key) % this.partitionCount;
  }

  put(key: string, value: unknown): number {
    const partition = this.getPartition(key);
    this.partitions.get(partition)!.set(key, value);
    return partition;
  }

  get(key: string): unknown | undefined {
    const partition = this.getPartition(key);
    return this.partitions.get(partition)!.get(key);
  }

  getPartitionSize(partition: number): number {
    return this.partitions.get(partition)?.size || 0;
  }
}

// =============================================================================
// Exercice 5 : Range partitioning
// =============================================================================

interface RangePartition {
  id: number;
  minKey: string;
  maxKey: string;
  data: Map<string, unknown>;
}

class RangePartitioner {
  private partitions: RangePartition[];

  constructor(boundaries: string[]) {
    this.partitions = [];
    const sorted = [...boundaries].sort();
    for (let i = 0; i <= sorted.length; i++) {
      this.partitions.push({
        id: i,
        minKey: i === 0 ? '' : sorted[i - 1],
        maxKey: i === sorted.length ? '\uffff' : sorted[i],
        data: new Map(),
      });
    }
  }

  getPartition(key: string): number {
    for (let i = 0; i < this.partitions.length; i++) {
      const p = this.partitions[i];
      if (key < p.maxKey || i === this.partitions.length - 1) {
        if (i === 0 || key >= p.minKey) {
          return p.id;
        }
      }
    }
    return this.partitions.length - 1;
  }

  put(key: string, value: unknown): number {
    const id = this.getPartition(key);
    this.partitions[id].data.set(key, value);
    return id;
  }

  get(key: string): unknown | undefined {
    const id = this.getPartition(key);
    return this.partitions[id].data.get(key);
  }

  getPartitionCount(): number {
    return this.partitions.length;
  }

  getPartitionSize(id: number): number {
    return this.partitions[id]?.data.size || 0;
  }
}

// =============================================================================
// Exercice 6 : Rebalancing
// =============================================================================

class RebalancingTracker {
  private nodeAssignments: Map<string, string> = new Map();
  private migrations: { key: string; from: string; to: string }[] = [];
  private partitionCount: number;

  constructor(partitionCount: number) {
    this.partitionCount = partitionCount;
  }

  private hash(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  assignKeys(keys: string[], nodeIds: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const id of nodeIds) {
      result.set(id, []);
    }
    for (const key of keys) {
      const nodeIndex = this.hash(key) % nodeIds.length;
      const nodeId = nodeIds[nodeIndex];
      this.nodeAssignments.set(key, nodeId);
      result.get(nodeId)!.push(key);
    }
    return result;
  }

  rebalance(keys: string[], newNodeIds: string[]): { key: string; from: string; to: string }[] {
    const currentMigrations: { key: string; from: string; to: string }[] = [];

    for (const key of keys) {
      const oldNode = this.nodeAssignments.get(key);
      const newIndex = this.hash(key) % newNodeIds.length;
      const newNode = newNodeIds[newIndex];

      if (oldNode && oldNode !== newNode) {
        const migration = { key, from: oldNode, to: newNode };
        currentMigrations.push(migration);
        this.migrations.push(migration);
      }
      this.nodeAssignments.set(key, newNode);
    }

    return currentMigrations;
  }

  getMigrations(): { key: string; from: string; to: string }[] {
    return [...this.migrations];
  }

  getMigrationCount(): number {
    return this.migrations.length;
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 11 — Replication & Partitionnement');

  // --- Exercice 1 ---
  console.log('\n📘 Exercice 1 : Leader-follower');

  await test('Write to leader, read immediately', () => {
    const store = new LeaderFollowerStore(2);
    store.write('key1', 'value1');
    const result = store.readFromLeader('key1');
    assert(result !== undefined, 'Should find on leader');
    assertEqual(result!.value, 'value1');
  });

  await test('Followers are stale before replication', () => {
    const store = new LeaderFollowerStore(2);
    store.write('key1', 'value1');
    assertEqual(store.readFromFollower(0, 'key1'), undefined);
  });

  await test('Followers catch up after replication', () => {
    const store = new LeaderFollowerStore(2);
    store.write('key1', 'value1');
    store.replicateToFollowers();
    const f0 = store.readFromFollower(0, 'key1');
    const f1 = store.readFromFollower(1, 'key1');
    assert(f0 !== undefined, 'Follower 0 should have value');
    assertEqual(f0!.value, 'value1');
    assert(f1 !== undefined, 'Follower 1 should have value');
  });

  await test('Version increments correctly', () => {
    const store = new LeaderFollowerStore(1);
    assertEqual(store.write('a', 1), 1);
    assertEqual(store.write('b', 2), 2);
    assertEqual(store.write('a', 3), 3);
  });

  await test('Pending replications are tracked', () => {
    const store = new LeaderFollowerStore(3);
    store.write('k', 'v');
    assertEqual(store.getPendingCount(), 3);
    store.replicateToFollowers();
    assertEqual(store.getPendingCount(), 0);
  });

  // --- Exercice 2 ---
  console.log('\n📘 Exercice 2 : Conflict resolution');

  await test('LWW picks latest timestamp', () => {
    const a: TimestampedValue = { value: 'old', timestamp: 100, nodeId: 'A' };
    const b: TimestampedValue = { value: 'new', timestamp: 200, nodeId: 'B' };
    assertEqual(ConflictResolver.lastWriterWins(a, b).value, 'new');
  });

  await test('LWW uses nodeId as tiebreaker', () => {
    const a: TimestampedValue = { value: 'fromA', timestamp: 100, nodeId: 'A' };
    const b: TimestampedValue = { value: 'fromB', timestamp: 100, nodeId: 'B' };
    assertEqual(ConflictResolver.lastWriterWins(a, b).value, 'fromB');
  });

  await test('Merge combines values', () => {
    const values: TimestampedValue[] = [
      { value: 1, timestamp: 100, nodeId: 'A' },
      { value: 2, timestamp: 200, nodeId: 'B' },
      { value: 3, timestamp: 300, nodeId: 'C' },
    ];
    const result = ConflictResolver.merge(values, (a, b) => (a as number) + (b as number));
    assertEqual(result, 6);
  });

  await test('Multi-leader sync with LWW', () => {
    const store = new MultiLeaderStore(['A', 'B']);
    store.write('A', 'key', 'oldA', 100);
    store.write('B', 'key', 'newB', 200);
    store.syncWithLWW();
    assertEqual(store.read('A', 'key')!.value, 'newB');
    assertEqual(store.read('B', 'key')!.value, 'newB');
  });

  // --- Exercice 3 ---
  console.log('\n📘 Exercice 3 : Consistent hashing');

  await test('Add and find nodes', () => {
    const ring = new ConsistentHashRing(50);
    ring.addNode('node-A');
    ring.addNode('node-B');
    const node = ring.getNode('mykey');
    assert(node !== undefined, 'Should find a node');
    assert(node === 'node-A' || node === 'node-B', 'Should be one of the nodes');
  });

  await test('Get multiple replica nodes', () => {
    const ring = new ConsistentHashRing(50);
    ring.addNode('node-A');
    ring.addNode('node-B');
    ring.addNode('node-C');
    const nodes = ring.getNodes('mykey', 2);
    assertEqual(nodes.length, 2);
    assert(nodes[0] !== nodes[1], 'Nodes should be distinct');
  });

  await test('Remove node redistributes keys', () => {
    const ring = new ConsistentHashRing(50);
    ring.addNode('node-A');
    ring.addNode('node-B');
    ring.addNode('node-C');
    const before = ring.getNode('testkey');
    ring.removeNode(before!);
    const after = ring.getNode('testkey');
    assert(after !== before, 'Key should move to different node');
    assertEqual(ring.getNodeCount(), 2);
  });

  await test('Keys are distributed across nodes', () => {
    const ring = new ConsistentHashRing(100);
    ring.addNode('A');
    ring.addNode('B');
    ring.addNode('C');
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < 300; i++) {
      const node = ring.getNode(`key-${i}`)!;
      counts[node]++;
    }
    assert(counts['A'] > 0, 'Node A should have keys');
    assert(counts['B'] > 0, 'Node B should have keys');
    assert(counts['C'] > 0, 'Node C should have keys');
  });

  // --- Exercice 4 ---
  console.log('\n📘 Exercice 4 : Hash partitioning');

  await test('Put and get values', () => {
    const hp = new HashPartitioner(4);
    hp.put('user:1', { name: 'Alice' });
    hp.put('user:2', { name: 'Bob' });
    assertDeepEqual(hp.get('user:1'), { name: 'Alice' });
    assertDeepEqual(hp.get('user:2'), { name: 'Bob' });
  });

  await test('Same key always goes to same partition', () => {
    const hp = new HashPartitioner(8);
    const p1 = hp.getPartition('consistent-key');
    const p2 = hp.getPartition('consistent-key');
    assertEqual(p1, p2);
  });

  await test('Keys are distributed across partitions', () => {
    const hp = new HashPartitioner(4);
    for (let i = 0; i < 100; i++) {
      hp.put(`key-${i}`, i);
    }
    let nonEmpty = 0;
    for (let p = 0; p < 4; p++) {
      if (hp.getPartitionSize(p) > 0) nonEmpty++;
    }
    assertGreaterThan(nonEmpty, 1);
  });

  // --- Exercice 5 ---
  console.log('\n📘 Exercice 5 : Range partitioning');

  await test('Keys go to correct range partition', () => {
    const rp = new RangePartitioner(['g', 'n', 't']);
    assertEqual(rp.getPartition('apple'), 0);
    assertEqual(rp.getPartition('hello'), 1);
    assertEqual(rp.getPartition('orange'), 2);
    assertEqual(rp.getPartition('zebra'), 3);
  });

  await test('Put and get with range partitions', () => {
    const rp = new RangePartitioner(['m']);
    rp.put('apple', 1);
    rp.put('zebra', 2);
    assertEqual(rp.get('apple'), 1);
    assertEqual(rp.get('zebra'), 2);
  });

  await test('Partition count matches boundaries', () => {
    const rp = new RangePartitioner(['d', 'h', 'm', 'r']);
    assertEqual(rp.getPartitionCount(), 5);
  });

  await test('Boundary keys go to correct partition', () => {
    const rp = new RangePartitioner(['m']);
    assertEqual(rp.getPartition('m'), 1);
    assertEqual(rp.getPartition('lzzz'), 0);
  });

  // --- Exercice 6 ---
  console.log('\n📘 Exercice 6 : Rebalancing');

  await test('Initial assignment distributes keys', () => {
    const tracker = new RebalancingTracker(16);
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const assignments = tracker.assignKeys(keys, ['node-1', 'node-2', 'node-3']);
    let totalKeys = 0;
    for (const [, keysList] of assignments) {
      totalKeys += keysList.length;
    }
    assertEqual(totalKeys, 6);
  });

  await test('Rebalance detects migrations', () => {
    const tracker = new RebalancingTracker(16);
    const keys = Array.from({ length: 20 }, (_, i) => `key-${i}`);
    tracker.assignKeys(keys, ['A', 'B']);
    const migrations = tracker.rebalance(keys, ['A', 'B', 'C']);
    assert(migrations.length > 0, 'Should have some migrations');
    for (const m of migrations) {
      assert(m.from !== m.to, 'Migration should change node');
    }
  });

  await test('No migration if nodes dont change', () => {
    const tracker = new RebalancingTracker(16);
    const keys = ['x', 'y', 'z'];
    tracker.assignKeys(keys, ['A', 'B']);
    const migrations = tracker.rebalance(keys, ['A', 'B']);
    assertEqual(migrations.length, 0);
  });

  await test('Adding node moves fewer keys than total', () => {
    const tracker = new RebalancingTracker(16);
    const keys = Array.from({ length: 100 }, (_, i) => `k-${i}`);
    tracker.assignKeys(keys, ['A', 'B', 'C']);
    const migrations = tracker.rebalance(keys, ['A', 'B', 'C', 'D']);
    assertLessThan(migrations.length, keys.length);
  });

  summary();
}

main().catch(console.error);
