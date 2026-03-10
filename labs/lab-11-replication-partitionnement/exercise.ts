// =============================================================================
// Lab 11 — Replication & Partitionnement (Exercise)
// =============================================================================

import { createTestRunner } from '../test-utils';

// =============================================================================
// Exercice 1 : Leader-follower
// =============================================================================
// Ecrire sur le leader, repliquer de maniere asynchrone vers les followers.
// Les lectures depuis les followers peuvent etre perimees.

class LeaderFollowerStore {
  private leader: Map<string, { value: unknown; version: number }> = new Map();
  private followers: Map<string, { value: unknown; version: number }>[];
  private version: number = 0;
  private pendingReplications: { followerIndex: number; key: string; value: unknown; version: number }[] = [];

  constructor(followerCount: number) {
    this.followers = Array.from({ length: followerCount }, () => new Map());
  }

  write(key: string, value: unknown): number {
    // TODO: Ecrire sur le leader, incrementer la version
    // Ajouter des replications en attente pour chaque follower
    // Retourner la version
    throw new Error('Not implemented');
  }

  readFromLeader(key: string): { value: unknown; version: number } | undefined {
    // TODO: Lire depuis le leader
    throw new Error('Not implemented');
  }

  readFromFollower(index: number, key: string): { value: unknown; version: number } | undefined {
    // TODO: Lire depuis un follower (peut etre perime)
    throw new Error('Not implemented');
  }

  replicateToFollowers(): number {
    // TODO: Appliquer les replications en attente
    // Retourner le nombre de replications appliquees
    throw new Error('Not implemented');
  }

  getPendingCount(): number {
    return this.pendingReplications.length;
  }
}

// =============================================================================
// Exercice 2 : Conflict resolution
// =============================================================================
// LWW (Last-Writer-Wins) par timestamp et fonction de fusion.

interface TimestampedValue {
  value: unknown;
  timestamp: number;
  nodeId: string;
}

class ConflictResolver {
  static lastWriterWins(a: TimestampedValue, b: TimestampedValue): TimestampedValue {
    // TODO: Retourner la valeur avec le timestamp le plus recent
    // En cas d'egalite, utiliser l'ordre lexicographique du nodeId
    throw new Error('Not implemented');
  }

  static merge(values: TimestampedValue[], mergeFn: (a: unknown, b: unknown) => unknown): unknown {
    // TODO: Fusionner toutes les valeurs en utilisant mergeFn de maniere cumulative
    // (reduce sur les valeurs triees par timestamp)
    throw new Error('Not implemented');
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
    // TODO: Ecrire sur le noeud specifie avec le timestamp
    throw new Error('Not implemented');
  }

  read(nodeId: string, key: string): TimestampedValue | undefined {
    // TODO: Lire depuis le noeud specifie
    throw new Error('Not implemented');
  }

  syncWithLWW(): number {
    // TODO: Synchroniser tous les noeuds en utilisant LWW
    // Retourner le nombre de mises a jour effectuees
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 3 : Consistent hashing
// =============================================================================
// Anneau de hachage avec noeuds virtuels.

class ConsistentHashRing {
  private ring: Map<number, string> = new Map();
  private sortedHashes: number[] = [];
  private virtualNodes: number;

  constructor(virtualNodes: number = 100) {
    this.virtualNodes = virtualNodes;
  }

  private hash(key: string): number {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  addNode(nodeId: string): void {
    // TODO: Ajouter un noeud avec virtualNodes noeuds virtuels sur l'anneau
    throw new Error('Not implemented');
  }

  removeNode(nodeId: string): void {
    // TODO: Retirer un noeud et tous ses noeuds virtuels de l'anneau
    throw new Error('Not implemented');
  }

  getNode(key: string): string | undefined {
    // TODO: Trouver le noeud responsable d'une cle (premier noeud >= hash de la cle)
    throw new Error('Not implemented');
  }

  getNodes(key: string, count: number): string[] {
    // TODO: Trouver les N noeuds distincts responsables d'une cle (pour la replication)
    throw new Error('Not implemented');
  }

  getNodeCount(): number {
    const nodes = new Set(this.ring.values());
    return nodes.size;
  }
}

// =============================================================================
// Exercice 4 : Hash partitioning
// =============================================================================
// Distribuer les cles sur N partitions en utilisant le hash modulo.

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
    // TODO: Retourner le numero de partition pour une cle
    throw new Error('Not implemented');
  }

  put(key: string, value: unknown): number {
    // TODO: Stocker la valeur dans la bonne partition, retourner le numero de partition
    throw new Error('Not implemented');
  }

  get(key: string): unknown | undefined {
    // TODO: Recuperer la valeur depuis la bonne partition
    throw new Error('Not implemented');
  }

  getPartitionSize(partition: number): number {
    return this.partitions.get(partition)?.size || 0;
  }
}

// =============================================================================
// Exercice 5 : Range partitioning
// =============================================================================
// Partitionner les cles par plages avec des limites configurables.

interface RangePartition {
  id: number;
  minKey: string;
  maxKey: string;
  data: Map<string, unknown>;
}

class RangePartitioner {
  private partitions: RangePartition[];

  constructor(boundaries: string[]) {
    // boundaries definit les limites : ["g", "n", "t"] cree 4 partitions :
    // [min, "g"), ["g", "n"), ["n", "t"), ["t", max)
    // TODO: Creer les partitions a partir des limites
    throw new Error('Not implemented');
  }

  getPartition(key: string): number {
    // TODO: Trouver la partition pour une cle donnee
    throw new Error('Not implemented');
  }

  put(key: string, value: unknown): number {
    // TODO: Stocker la valeur dans la bonne partition, retourner l'id de partition
    throw new Error('Not implemented');
  }

  get(key: string): unknown | undefined {
    // TODO: Recuperer la valeur depuis la bonne partition
    throw new Error('Not implemented');
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
// Suivre les migrations de cles lors de l'ajout/suppression de noeuds.

class RebalancingTracker {
  private nodeAssignments: Map<string, string> = new Map(); // key -> nodeId
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
    // TODO: Distribuer les cles parmi les noeuds (hash modulo)
    // Mettre a jour nodeAssignments et retourner nodeId -> keys[]
    throw new Error('Not implemented');
  }

  rebalance(keys: string[], newNodeIds: string[]): { key: string; from: string; to: string }[] {
    // TODO: Recalculer les assignations avec les nouveaux noeuds
    // Enregistrer les migrations (cles qui changent de noeud)
    // Retourner la liste des migrations
    throw new Error('Not implemented');
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
