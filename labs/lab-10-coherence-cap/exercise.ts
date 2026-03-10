// =============================================================================
// Lab 10 — Coherence & CAP (Exercise)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : Strong consistency store
// =============================================================================
// Single-leader store : les ecritures passent par le leader et sont repliquees
// de maniere synchrone. Les lectures retournent toujours la derniere valeur.

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
    // TODO: Ecrire sur le leader, incrementer la version
    // Repliquer de maniere synchrone sur tous les followers
    // Retourner la version et le nombre de repliques mises a jour
    throw new Error('Not implemented');
  }

  read(key: string): { value: unknown; version: number } | undefined {
    // TODO: Lire depuis le leader (coherence forte garantie)
    throw new Error('Not implemented');
  }

  readFromFollower(followerId: string, key: string): { value: unknown; version: number } | undefined {
    // TODO: Lire depuis un follower specifique (peut etre utile pour les tests)
    throw new Error('Not implemented');
  }

  getFollowerIds(): string[] {
    return this.followers.map(f => f.id);
  }
}

// =============================================================================
// Exercice 2 : Eventual consistency
// =============================================================================
// Store avec replication asynchrone. Les lectures peuvent retourner des donnees
// perimees. La convergence se fait apres un delai.

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
    // TODO: Ecrire sur le noeud specifie, incrementer la version globale
    // Ajouter des replications en attente pour les autres noeuds
    // Retourner la version
    throw new Error('Not implemented');
  }

  read(nodeId: string, key: string): { value: unknown; version: number } | undefined {
    // TODO: Lire depuis le noeud specifie (peut etre perime)
    throw new Error('Not implemented');
  }

  sync(): number {
    // TODO: Appliquer toutes les replications en attente
    // Retourner le nombre de replications appliquees
    // Ne mettre a jour que si la version est plus recente
    throw new Error('Not implemented');
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
// Ecritures et lectures avec quorum configurable.
// Coherence forte quand W + R > N.

interface QuorumConfig {
  n: number; // nombre total de repliques
  w: number; // quorum d'ecriture
  r: number; // quorum de lecture
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
    // TODO: Ecrire sur W repliques, incrementer la version
    // Succes si au moins W repliques confirment
    // Retourner la version, le nombre d'acks et le succes
    throw new Error('Not implemented');
  }

  read(key: string): { value: unknown; version: number; nodesRead: number } | undefined {
    // TODO: Lire depuis R repliques
    // Retourner la valeur avec la version la plus haute
    throw new Error('Not implemented');
  }

  isStronglyConsistent(): boolean {
    // TODO: Retourner true si W + R > N
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 4 : CAP simulation
// =============================================================================
// Systeme a 3 noeuds. On peut injecter une partition reseau.
// Mode CP : rejette les ecritures pendant une partition.
// Mode AP : accepte les ecritures mais les lectures peuvent etre perimees.

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
    // TODO: Marquer un noeud comme partitionne (isole du reste)
    throw new Error('Not implemented');
  }

  healPartition(nodeId: string): void {
    // TODO: Retirer le noeud de la partition
    throw new Error('Not implemented');
  }

  write(nodeId: string, key: string, value: unknown): boolean {
    // TODO: En mode CP, refuser l'ecriture si un noeud est partitionne (retourner false)
    // En mode AP, accepter l'ecriture sur le noeud local uniquement
    // Si pas de partition, repliquer sur tous les noeuds
    throw new Error('Not implemented');
  }

  read(nodeId: string, key: string): unknown | undefined {
    // TODO: Lire depuis le noeud specifie
    throw new Error('Not implemented');
  }

  isPartitioned(): boolean {
    return this.partitioned.size > 0;
  }
}

// =============================================================================
// Exercice 5 : Read repair
// =============================================================================
// Pendant une lecture quorum, si les repliques ne sont pas d'accord,
// reparer les repliques perimees.

class ReadRepairStore {
  private replicas: Map<string, { value: unknown; version: number }>[];
  private repairCount: number = 0;

  constructor(replicaCount: number) {
    this.replicas = Array.from({ length: replicaCount }, () => new Map());
  }

  writeToReplica(replicaIndex: number, key: string, value: unknown, version: number): void {
    // TODO: Ecrire directement sur une replique specifique (pour simuler des divergences)
    throw new Error('Not implemented');
  }

  readWithRepair(key: string): { value: unknown; version: number; repaired: number } | undefined {
    // TODO: Lire depuis toutes les repliques
    // Trouver la valeur avec la version la plus haute
    // Reparer (mettre a jour) les repliques perimees
    // Retourner la valeur, la version et le nombre de repliques reparees
    throw new Error('Not implemented');
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
// Store avec niveaux de coherence ajustables.

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
    // TODO: Ecrire selon le niveau de coherence :
    // ONE : ecrire sur 1 replique
    // QUORUM : ecrire sur floor(N/2)+1 repliques
    // ALL : ecrire sur toutes les repliques
    throw new Error('Not implemented');
  }

  read(key: string, level: ConsistencyLevel): { value: unknown; version: number } | undefined {
    // TODO: Lire selon le niveau de coherence :
    // ONE : lire depuis 1 replique
    // QUORUM : lire depuis floor(N/2)+1 repliques, retourner la version la plus haute
    // ALL : lire depuis toutes les repliques, retourner la version la plus haute
    throw new Error('Not implemented');
  }

  private getRequiredNodes(level: ConsistencyLevel): number {
    // TODO: Retourner le nombre de noeuds requis selon le niveau
    throw new Error('Not implemented');
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
