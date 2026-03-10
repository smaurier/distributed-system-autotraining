// =============================================================================
// Lab 10 — Coherence & CAP (Solution)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : Strong consistency store
// =============================================================================

interface Replica {
  id: string;
  data: Map<string, { value: unknown; version: number }>;
}

class StrongConsistencyStore {
  private leader: Replica;
  private followers: Replica[];
  private version: number = 0;

  constructor(followerCount: number) {
    this.leader = { id: 'leader', data: new Map() };
    this.followers = Array.from({ length: followerCount }, (_, i) => ({
      id: `follower-${i}`,
      data: new Map(),
    }));
  }

  write(key: string, value: unknown): { version: number; replicatedTo: number } {
    this.version++;
    const entry = { value, version: this.version };
    this.leader.data.set(key, entry);
    for (const follower of this.followers) {
      follower.data.set(key, { ...entry });
    }
    return { version: this.version, replicatedTo: this.followers.length };
  }

  read(key: string): { value: unknown; version: number } | undefined {
    return this.leader.data.get(key);
  }

  readFromFollower(followerId: string, key: string): { value: unknown; version: number } | undefined {
    const follower = this.followers.find(f => f.id === followerId);
    if (!follower) return undefined;
    return follower.data.get(key);
  }

  getFollowerIds(): string[] {
    return this.followers.map(f => f.id);
  }
}

// =============================================================================
// Exercice 2 : Eventual consistency
// =============================================================================

class EventualConsistencyStore {
  private nodes: Map<string, Map<string, { value: unknown; version: number }>> = new Map();
  private pendingReplications: { targetNode: string; key: string; value: unknown; version: number }[] = [];
  private globalVersion: number = 0;

  constructor(nodeIds: string[]) {
    for (const id of nodeIds) {
      this.nodes.set(id, new Map());
    }
  }

  write(nodeId: string, key: string, value: unknown): number {
    this.globalVersion++;
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    node.set(key, { value, version: this.globalVersion });
    for (const [id] of this.nodes) {
      if (id !== nodeId) {
        this.pendingReplications.push({ targetNode: id, key, value, version: this.globalVersion });
      }
    }
    return this.globalVersion;
  }

  read(nodeId: string, key: string): { value: unknown; version: number } | undefined {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    return node.get(key);
  }

  sync(): number {
    let applied = 0;
    for (const rep of this.pendingReplications) {
      const node = this.nodes.get(rep.targetNode);
      if (!node) continue;
      const existing = node.get(rep.key);
      if (!existing || existing.version < rep.version) {
        node.set(rep.key, { value: rep.value, version: rep.version });
        applied++;
      }
    }
    this.pendingReplications = [];
    return applied;
  }

  getPendingCount(): number {
    return this.pendingReplications.length;
  }

  getNodeIds(): string[] {
    return Array.from(this.nodes.keys());
  }
}

// =============================================================================
// Exercice 3 : Quorum system
// =============================================================================

interface QuorumConfig {
  n: number;
  w: number;
  r: number;
}

class QuorumStore {
  private replicas: Map<string, { value: unknown; version: number }>[];
  private config: QuorumConfig;
  private version: number = 0;

  constructor(config: QuorumConfig) {
    this.config = config;
    this.replicas = Array.from({ length: config.n }, () => new Map());
  }

  write(key: string, value: unknown): { version: number; acks: number; success: boolean } {
    this.version++;
    let acks = 0;
    for (let i = 0; i < this.config.w; i++) {
      this.replicas[i].set(key, { value, version: this.version });
      acks++;
    }
    return { version: this.version, acks, success: acks >= this.config.w };
  }

  read(key: string): { value: unknown; version: number; nodesRead: number } | undefined {
    let best: { value: unknown; version: number } | undefined;
    let nodesRead = 0;
    for (let i = 0; i < this.config.r; i++) {
      const entry = this.replicas[i].get(key);
      nodesRead++;
      if (entry && (!best || entry.version > best.version)) {
        best = entry;
      }
    }
    if (!best) return undefined;
    return { value: best.value, version: best.version, nodesRead };
  }

  isStronglyConsistent(): boolean {
    return this.config.w + this.config.r > this.config.n;
  }
}

// =============================================================================
// Exercice 4 : CAP simulation
// =============================================================================

type CAPMode = 'CP' | 'AP';

class CAPSystem {
  private nodes: Map<string, Map<string, unknown>> = new Map();
  private partitioned: Set<string> = new Set();
  private mode: CAPMode;

  constructor(nodeIds: string[], mode: CAPMode) {
    this.mode = mode;
    for (const id of nodeIds) {
      this.nodes.set(id, new Map());
    }
  }

  injectPartition(nodeId: string): void {
    this.partitioned.add(nodeId);
  }

  healPartition(nodeId: string): void {
    this.partitioned.delete(nodeId);
  }

  write(nodeId: string, key: string, value: unknown): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    if (this.partitioned.size > 0) {
      if (this.mode === 'CP') {
        return false;
      }
      // AP mode: write locally only
      node.set(key, value);
      // Also replicate to non-partitioned nodes if the writer is not partitioned
      if (!this.partitioned.has(nodeId)) {
        for (const [id, n] of this.nodes) {
          if (id !== nodeId && !this.partitioned.has(id)) {
            n.set(key, value);
          }
        }
      }
      return true;
    }

    // No partition: replicate to all
    for (const [, n] of this.nodes) {
      n.set(key, value);
    }
    return true;
  }

  read(nodeId: string, key: string): unknown | undefined {
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    return node.get(key);
  }

  isPartitioned(): boolean {
    return this.partitioned.size > 0;
  }
}

// =============================================================================
// Exercice 5 : Read repair
// =============================================================================

class ReadRepairStore {
  private replicas: Map<string, { value: unknown; version: number }>[];
  private repairCount: number = 0;

  constructor(replicaCount: number) {
    this.replicas = Array.from({ length: replicaCount }, () => new Map());
  }

  writeToReplica(replicaIndex: number, key: string, value: unknown, version: number): void {
    this.replicas[replicaIndex].set(key, { value, version });
  }

  readWithRepair(key: string): { value: unknown; version: number; repaired: number } | undefined {
    // Read from all replicas
    let best: { value: unknown; version: number } | undefined;
    for (const replica of this.replicas) {
      const entry = replica.get(key);
      if (entry && (!best || entry.version > best.version)) {
        best = { value: entry.value, version: entry.version };
      }
    }

    if (!best) return undefined;

    // Repair stale replicas
    let repaired = 0;
    for (const replica of this.replicas) {
      const entry = replica.get(key);
      if (!entry || entry.version < best.version) {
        replica.set(key, { value: best.value, version: best.version });
        repaired++;
        this.repairCount++;
      }
    }

    return { value: best.value, version: best.version, repaired };
  }

  readFromReplica(replicaIndex: number, key: string): { value: unknown; version: number } | undefined {
    return this.replicas[replicaIndex].get(key);
  }

  getRepairCount(): number {
    return this.repairCount;
  }
}

// =============================================================================
// Exercice 6 : Tunable consistency
// =============================================================================

type ConsistencyLevel = 'ONE' | 'QUORUM' | 'ALL';

class TunableConsistencyStore {
  private replicas: Map<string, { value: unknown; version: number }>[];
  private replicaCount: number;
  private version: number = 0;

  constructor(replicaCount: number) {
    this.replicaCount = replicaCount;
    this.replicas = Array.from({ length: replicaCount }, () => new Map());
  }

  write(key: string, value: unknown, level: ConsistencyLevel): { version: number; acks: number } {
    this.version++;
    const required = this.getRequiredNodes(level);
    let acks = 0;
    for (let i = 0; i < required; i++) {
      this.replicas[i].set(key, { value, version: this.version });
      acks++;
    }
    return { version: this.version, acks };
  }

  read(key: string, level: ConsistencyLevel): { value: unknown; version: number } | undefined {
    const required = this.getRequiredNodes(level);
    let best: { value: unknown; version: number } | undefined;
    for (let i = 0; i < required; i++) {
      const entry = this.replicas[i].get(key);
      if (entry && (!best || entry.version > best.version)) {
        best = entry;
      }
    }
    return best;
  }

  private getRequiredNodes(level: ConsistencyLevel): number {
    switch (level) {
      case 'ONE':
        return 1;
      case 'QUORUM':
        return Math.floor(this.replicaCount / 2) + 1;
      case 'ALL':
        return this.replicaCount;
    }
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 10 — Coherence & CAP');

  // --- Exercice 1 ---
  console.log('\n📘 Exercice 1 : Strong consistency store');

  await test('Write and read from leader', () => {
    const store = new StrongConsistencyStore(2);
    store.write('x', 42);
    const result = store.read('x');
    assert(result !== undefined, 'Should find key');
    assertEqual(result!.value, 42);
  });

  await test('Version increments on writes', () => {
    const store = new StrongConsistencyStore(2);
    const r1 = store.write('x', 1);
    const r2 = store.write('x', 2);
    assertEqual(r1.version, 1);
    assertEqual(r2.version, 2);
  });

  await test('Followers are synchronized', () => {
    const store = new StrongConsistencyStore(2);
    store.write('x', 'hello');
    const followerIds = store.getFollowerIds();
    for (const fid of followerIds) {
      const result = store.readFromFollower(fid, 'x');
      assert(result !== undefined, `Follower ${fid} should have value`);
      assertEqual(result!.value, 'hello');
    }
  });

  await test('Write returns replication count', () => {
    const store = new StrongConsistencyStore(3);
    const result = store.write('key', 'value');
    assertEqual(result.replicatedTo, 3);
  });

  // --- Exercice 2 ---
  console.log('\n📘 Exercice 2 : Eventual consistency');

  await test('Write to one node, not immediately visible on others', () => {
    const store = new EventualConsistencyStore(['A', 'B', 'C']);
    store.write('A', 'key1', 'valueA');
    const resultA = store.read('A', 'key1');
    const resultB = store.read('B', 'key1');
    assert(resultA !== undefined, 'Node A should have value');
    assertEqual(resultA!.value, 'valueA');
    assertEqual(resultB, undefined);
  });

  await test('Sync propagates writes to all nodes', () => {
    const store = new EventualConsistencyStore(['A', 'B', 'C']);
    store.write('A', 'key1', 'valueA');
    assert(store.getPendingCount() > 0, 'Should have pending replications');
    store.sync();
    const resultB = store.read('B', 'key1');
    const resultC = store.read('C', 'key1');
    assert(resultB !== undefined, 'Node B should have value after sync');
    assertEqual(resultB!.value, 'valueA');
    assert(resultC !== undefined, 'Node C should have value after sync');
    assertEqual(resultC!.value, 'valueA');
  });

  await test('Later version wins on sync', () => {
    const store = new EventualConsistencyStore(['A', 'B']);
    store.write('A', 'k', 'v1');
    store.write('B', 'k', 'v2');
    store.sync();
    const a = store.read('A', 'k');
    const b = store.read('B', 'k');
    assertEqual(a!.value, 'v2');
    assertEqual(b!.value, 'v2');
  });

  // --- Exercice 3 ---
  console.log('\n📘 Exercice 3 : Quorum system');

  await test('Write with quorum succeeds', () => {
    const store = new QuorumStore({ n: 3, w: 2, r: 2 });
    const result = store.write('key1', 'value1');
    assertEqual(result.success, true);
    assertEqual(result.acks, 2);
  });

  await test('Read returns latest version', () => {
    const store = new QuorumStore({ n: 3, w: 2, r: 2 });
    store.write('key1', 'v1');
    store.write('key1', 'v2');
    const result = store.read('key1');
    assert(result !== undefined, 'Should find key');
    assertEqual(result!.value, 'v2');
  });

  await test('Strong consistency when W+R > N', () => {
    const store = new QuorumStore({ n: 3, w: 2, r: 2 });
    assertEqual(store.isStronglyConsistent(), true);
  });

  await test('Weak consistency when W+R <= N', () => {
    const store = new QuorumStore({ n: 5, w: 2, r: 2 });
    assertEqual(store.isStronglyConsistent(), false);
  });

  // --- Exercice 4 ---
  console.log('\n📘 Exercice 4 : CAP simulation');

  await test('CP mode rejects writes during partition', () => {
    const cp = new CAPSystem(['n1', 'n2', 'n3'], 'CP');
    cp.write('n1', 'key', 'before');
    cp.injectPartition('n3');
    const success = cp.write('n1', 'key', 'during-partition');
    assertEqual(success, false);
  });

  await test('AP mode accepts writes during partition', () => {
    const ap = new CAPSystem(['n1', 'n2', 'n3'], 'AP');
    ap.write('n1', 'key', 'before');
    ap.injectPartition('n3');
    const success = ap.write('n1', 'key', 'during-partition');
    assertEqual(success, true);
  });

  await test('AP mode may have stale reads', () => {
    const ap = new CAPSystem(['n1', 'n2', 'n3'], 'AP');
    ap.write('n1', 'key', 'original');
    ap.injectPartition('n3');
    ap.write('n1', 'key', 'updated');
    assertEqual(ap.read('n1', 'key'), 'updated');
    assertEqual(ap.read('n3', 'key'), 'original');
  });

  await test('Normal operation replicates to all', () => {
    const sys = new CAPSystem(['n1', 'n2', 'n3'], 'CP');
    sys.write('n1', 'key', 'value');
    assertEqual(sys.read('n1', 'key'), 'value');
    assertEqual(sys.read('n2', 'key'), 'value');
    assertEqual(sys.read('n3', 'key'), 'value');
  });

  await test('Heal partition restores normal operation', () => {
    const cp = new CAPSystem(['n1', 'n2', 'n3'], 'CP');
    cp.injectPartition('n2');
    assertEqual(cp.write('n1', 'k', 'v'), false);
    cp.healPartition('n2');
    assertEqual(cp.write('n1', 'k', 'v'), true);
  });

  // --- Exercice 5 ---
  console.log('\n📘 Exercice 5 : Read repair');

  await test('Detect and repair stale replicas', () => {
    const store = new ReadRepairStore(3);
    store.writeToReplica(0, 'key', 'old', 1);
    store.writeToReplica(1, 'key', 'old', 1);
    store.writeToReplica(2, 'key', 'new', 2);
    const result = store.readWithRepair('key');
    assert(result !== undefined, 'Should find key');
    assertEqual(result!.value, 'new');
    assertEqual(result!.version, 2);
    assertEqual(result!.repaired, 2);
  });

  await test('No repair needed if all consistent', () => {
    const store = new ReadRepairStore(3);
    store.writeToReplica(0, 'key', 'same', 1);
    store.writeToReplica(1, 'key', 'same', 1);
    store.writeToReplica(2, 'key', 'same', 1);
    const result = store.readWithRepair('key');
    assertEqual(result!.repaired, 0);
  });

  await test('After repair all replicas agree', () => {
    const store = new ReadRepairStore(3);
    store.writeToReplica(0, 'key', 'v1', 1);
    store.writeToReplica(1, 'key', 'v2', 2);
    store.writeToReplica(2, 'key', 'v1', 1);
    store.readWithRepair('key');
    for (let i = 0; i < 3; i++) {
      const r = store.readFromReplica(i, 'key');
      assertEqual(r!.value, 'v2');
      assertEqual(r!.version, 2);
    }
  });

  await test('Read repair count accumulates', () => {
    const store = new ReadRepairStore(3);
    store.writeToReplica(0, 'a', 'old', 1);
    store.writeToReplica(1, 'a', 'new', 2);
    store.writeToReplica(2, 'a', 'old', 1);
    store.readWithRepair('a');
    store.writeToReplica(0, 'b', 'old', 1);
    store.writeToReplica(1, 'b', 'old', 1);
    store.writeToReplica(2, 'b', 'new', 3);
    store.readWithRepair('b');
    assertEqual(store.getRepairCount(), 4);
  });

  // --- Exercice 6 ---
  console.log('\n📘 Exercice 6 : Tunable consistency');

  await test('ONE writes to single replica', () => {
    const store = new TunableConsistencyStore(3);
    const result = store.write('key', 'val', 'ONE');
    assertEqual(result.acks, 1);
  });

  await test('QUORUM writes to majority', () => {
    const store = new TunableConsistencyStore(5);
    const result = store.write('key', 'val', 'QUORUM');
    assertEqual(result.acks, 3);
  });

  await test('ALL writes to every replica', () => {
    const store = new TunableConsistencyStore(3);
    const result = store.write('key', 'val', 'ALL');
    assertEqual(result.acks, 3);
  });

  await test('Read ONE returns value if any replica has it', () => {
    const store = new TunableConsistencyStore(3);
    store.write('key', 'val', 'ONE');
    const result = store.read('key', 'ONE');
    assert(result !== undefined, 'Should find value');
    assertEqual(result!.value, 'val');
  });

  await test('Read ALL returns latest version', () => {
    const store = new TunableConsistencyStore(3);
    store.write('key', 'v1', 'ALL');
    store.write('key', 'v2', 'ALL');
    const result = store.read('key', 'ALL');
    assertEqual(result!.value, 'v2');
  });

  summary();
}

main().catch(console.error);
