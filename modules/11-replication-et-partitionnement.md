# Module 11 : Replication & Partitionnement

> **Difficulty** : 4/5 | **Duration estimee** : 4h | **Prerequis** : Modules 1-10

---

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

1. Expliquer les differentes strategies de replication et leurs compromis
2. Implementer les modeles leader-follower, multi-leader et leaderless
3. Comprendre les strategies de partitionnement (hash vs range)
4. Implementer le consistent hashing avec noeuds virtuels en TypeScript
5. Identifier et resoudre les problemes de hot spots
6. Choisir la bonne strategie de rebalancing

---

## 1. Pourquoi repliquer ?

La replication consiste a maintenir des **copies identiques** des donnees sur plusieurs noeuds. Trois raisons principales :

```
  +-----------------------------------------------------------+
  |                Raisons de la replication                    |
  +-----------------------------------------------------------+
  |                                                           |
  |  1. Tolerance aux pannes     Si un noeud tombe,           |
  |     (Fault Tolerance)        les autres prennent le relais|
  |                                                           |
  |  2. Scalabilite en lecture   Les lectures sont reparties  |
  |     (Read Scaling)           sur plusieurs repliques      |
  |                                                           |
  |  3. Distribution geo         Les donnees sont proches     |
  |     (Geographic)             des utilisateurs             |
  +-----------------------------------------------------------+
```

---

## 2. Replication Leader-Follower (Primary-Replica)

Le modele le plus courant. Un seul noeud (le leader) accepte les ecritures. Les followers recoivent les modifications du leader et servent les lectures.

```
  Client (write)       Client (read)    Client (read)
       |                    |                |
       v                    v                v
  +----------+        +----------+     +----------+
  |  LEADER  |------->| FOLLOWER |     | FOLLOWER |
  | (primary)|  sync  | (replica)|     | (replica)|
  |          |--or--->|          |     |          |
  |  R/W     |  async |  R only  |     |  R only  |
  +----------+        +----------+     +----------+
       |                                     ^
       |           async replication          |
       +--------------------------------------+
```

### 2.1 Replication synchrone vs asynchrone

```typescript
interface ReplicationLog {
  sequence: number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  key: string;
  value: string;
  timestamp: number;
}

class LeaderNode {
  private store: Map<string, string> = new Map();
  private replicationLog: ReplicationLog[] = [];
  private followers: FollowerNode[] = [];
  private sequence: number = 0;

  addFollower(follower: FollowerNode): void {
    this.followers.push(follower);
  }

  async writeSynchronous(key: string, value: string): Promise<boolean> {
    // 1. Write locally
    this.store.set(key, value);
    const logEntry: ReplicationLog = {
      sequence: ++this.sequence,
      operation: 'INSERT',
      key,
      value,
      timestamp: Date.now(),
    };
    this.replicationLog.push(logEntry);

    // 2. Replicate to ALL followers and wait
    const results = await Promise.all(
      this.followers.map((f) => f.applyLog(logEntry))
    );

    // 3. Only return success if ALL followers acknowledged
    const allAcked = results.every((r) => r === true);
    if (!allAcked) {
      // Rollback on failure
      this.store.delete(key);
      this.replicationLog.pop();
      return false;
    }
    return true;
  }

  async writeAsynchronous(key: string, value: string): Promise<boolean> {
    // 1. Write locally
    this.store.set(key, value);
    const logEntry: ReplicationLog = {
      sequence: ++this.sequence,
      operation: 'INSERT',
      key,
      value,
      timestamp: Date.now(),
    };
    this.replicationLog.push(logEntry);

    // 2. Return immediately — replicate in background
    this.replicateAsync(logEntry);
    return true;
  }

  private replicateAsync(logEntry: ReplicationLog): void {
    // Fire and forget — followers will catch up
    for (const follower of this.followers) {
      follower.applyLog(logEntry).catch((err) => {
        console.error(
          `Replication failed for ${follower.id}: ${err.message}`
        );
        // Will be retried by anti-entropy process
      });
    }
  }

  getReplicationLog(fromSequence: number): ReplicationLog[] {
    return this.replicationLog.filter((l) => l.sequence > fromSequence);
  }
}

class FollowerNode {
  readonly id: string;
  private store: Map<string, string> = new Map();
  private lastAppliedSequence: number = 0;
  private latencyMs: number;

  constructor(id: string, latencyMs: number = 50) {
    this.id = id;
    this.latencyMs = latencyMs;
  }

  async applyLog(entry: ReplicationLog): Promise<boolean> {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, this.latencyMs));

    if (entry.sequence <= this.lastAppliedSequence) {
      return true; // Already applied (idempotent)
    }

    switch (entry.operation) {
      case 'INSERT':
      case 'UPDATE':
        this.store.set(entry.key, entry.value);
        break;
      case 'DELETE':
        this.store.delete(entry.key);
        break;
    }

    this.lastAppliedSequence = entry.sequence;
    return true;
  }

  read(key: string): string | undefined {
    return this.store.get(key);
  }

  getLag(): number {
    return this.lastAppliedSequence;
  }
}
```

:::warning
Avec la replication **synchrone**, une ecriture est aussi lente que le follower le plus lent. Avec la replication **asynchrone**, un failover peut perdre les ecritures non encore repliquees. La plupart des systemes utilisent un compromis : **semi-synchrone** (1 follower synchrone, les autres asynchrones).
:::

---

## 3. Replication Multi-Leader

Chaque datacenter a son propre leader. Utile pour la distribution geographique, mais complexe a cause des **conflits d'ecriture**.

```
  Datacenter EU              Datacenter US
  +----------+               +----------+
  | Leader 1 |<-- conflict ->| Leader 2 |
  | (EU)     |   resolution  | (US)     |
  +----+-----+               +-----+----+
       |                           |
  +----+-----+               +----+-----+
  |Follower 1|               |Follower 2|
  +----------+               +----------+
```

```typescript
interface ConflictEntry {
  key: string;
  values: Array<{
    value: string;
    timestamp: number;
    sourceLeader: string;
  }>;
}

type ConflictResolutionStrategy = 'LWW' | 'MERGE' | 'CUSTOM';

class MultiLeaderReplicator {
  private leaders: Map<
    string,
    { store: Map<string, { value: string; timestamp: number }> }
  > = new Map();
  private strategy: ConflictResolutionStrategy;
  private conflictLog: ConflictEntry[] = [];

  constructor(
    leaderIds: string[],
    strategy: ConflictResolutionStrategy = 'LWW'
  ) {
    this.strategy = strategy;
    for (const id of leaderIds) {
      this.leaders.set(id, { store: new Map() });
    }
  }

  write(leaderId: string, key: string, value: string): void {
    const leader = this.leaders.get(leaderId);
    if (!leader) throw new Error(`Unknown leader: ${leaderId}`);
    leader.store.set(key, { value, timestamp: Date.now() });
  }

  // Sync between leaders — this is where conflicts arise
  syncLeaders(): ConflictEntry[] {
    const conflicts: ConflictEntry[] = [];
    const allKeys = new Set<string>();

    for (const [, leader] of this.leaders) {
      for (const key of leader.store.keys()) {
        allKeys.add(key);
      }
    }

    for (const key of allKeys) {
      const entries: ConflictEntry['values'] = [];

      for (const [leaderId, leader] of this.leaders) {
        const entry = leader.store.get(key);
        if (entry) {
          entries.push({
            value: entry.value,
            timestamp: entry.timestamp,
            sourceLeader: leaderId,
          });
        }
      }

      // Detect conflict: multiple leaders have different values
      const uniqueValues = new Set(entries.map((e) => e.value));
      if (uniqueValues.size > 1) {
        const conflict: ConflictEntry = { key, values: entries };
        conflicts.push(conflict);
        this.resolveConflict(conflict);
      }
    }

    this.conflictLog.push(...conflicts);
    return conflicts;
  }

  private resolveConflict(conflict: ConflictEntry): void {
    let winner: { value: string; timestamp: number } | undefined;

    switch (this.strategy) {
      case 'LWW': // Last-Write-Wins
        const sorted = [...conflict.values].sort(
          (a, b) => b.timestamp - a.timestamp
        );
        winner = { value: sorted[0].value, timestamp: sorted[0].timestamp };
        break;

      case 'MERGE': // Concatenate values (for CRDTs-like behavior)
        const merged = conflict.values.map((v) => v.value).join(' | ');
        winner = { value: merged, timestamp: Date.now() };
        break;

      case 'CUSTOM':
        // Application-specific logic
        winner = { value: conflict.values[0].value, timestamp: Date.now() };
        break;
    }

    if (winner) {
      // Apply resolved value to all leaders
      for (const [, leader] of this.leaders) {
        leader.store.set(conflict.key, winner);
      }
    }
  }
}
```

:::tip
**Last-Write-Wins (LWW)** est la strategie la plus simple mais peut perdre des donnees. Pour des cas critiques, preferez les **CRDTs** (Conflict-free Replicated Data Types) qui garantissent une convergence sans perte.
:::

---

## 4. Replication Leaderless

Aucun leader designe. Les ecritures et lectures sont envoyees a **plusieurs repliques** en parallele (modele Dynamo).

```typescript
class LeaderlessStore {
  private nodes: Map<string, Map<string, { value: string; version: number }>>;
  private readonly N: number;
  private readonly W: number;
  private readonly R: number;

  constructor(nodeCount: number, W: number, R: number) {
    this.N = nodeCount;
    this.W = W;
    this.R = R;
    this.nodes = new Map();
    for (let i = 0; i < nodeCount; i++) {
      this.nodes.set(`node-${i}`, new Map());
    }
  }

  async write(key: string, value: string): Promise<boolean> {
    const version = Date.now();
    let acks = 0;

    for (const [, store] of this.nodes) {
      store.set(key, { value, version });
      acks++;
      if (acks >= this.W) return true;
    }
    return false; // Not enough acks
  }

  read(key: string): string | undefined {
    const responses: Array<{ value: string; version: number }> = [];

    for (const [, store] of this.nodes) {
      const entry = store.get(key);
      if (entry) responses.push(entry);
      if (responses.length >= this.R) break;
    }

    if (responses.length < this.R) return undefined;

    // Return the value with the highest version
    responses.sort((a, b) => b.version - a.version);
    return responses[0].value;
  }

  // Anti-entropy: background process to synchronize replicas
  antiEntropy(): number {
    let repairs = 0;
    const allKeys = new Set<string>();

    for (const [, store] of this.nodes) {
      for (const key of store.keys()) allKeys.add(key);
    }

    for (const key of allKeys) {
      let latest: { value: string; version: number } | null = null;

      for (const [, store] of this.nodes) {
        const entry = store.get(key);
        if (entry && (!latest || entry.version > latest.version)) {
          latest = entry;
        }
      }

      if (latest) {
        for (const [, store] of this.nodes) {
          const entry = store.get(key);
          if (!entry || entry.version < latest.version) {
            store.set(key, { ...latest });
            repairs++;
          }
        }
      }
    }

    return repairs;
  }
}
```

---

## 5. Partitionnement (Sharding)

Le partitionnement divise les donnees en **fragments** (shards) distribues sur differents noeuds. Chaque noeud ne gere qu'un sous-ensemble des donnees.

```
  Donnees totales : [A-Z]

  +----------+    +----------+    +----------+
  | Shard 1  |    | Shard 2  |    | Shard 3  |
  | [A-I]    |    | [J-R]    |    | [S-Z]    |
  | Node 1   |    | Node 2   |    | Node 3   |
  +----------+    +----------+    +----------+

  Range Partitioning : les cles sont reparties par intervalles
```

### 5.1 Hash Partitioning vs Range Partitioning

```
  +---------------------+---------------------------+
  | Range Partitioning  | Hash Partitioning         |
  +---------------------+---------------------------+
  | Cles ordonnees      | Distribution uniforme     |
  | Range scans faciles | Pas de range scans        |
  | Risque de hot spots | Meilleure repartition     |
  | Ex: HBase, Spanner  | Ex: Cassandra, DynamoDB   |
  +---------------------+---------------------------+
```

:::warning
Le range partitioning peut creer des **hot spots** si les ecritures se concentrent sur un intervalle (ex: cles basees sur le timestamp => tout va sur le dernier shard). Le hash partitioning repartit mieux la charge mais rend les range queries impossibles.
:::

---

## 6. Consistent Hashing

Le consistent hashing resout le probleme du **rebalancing** : quand on ajoute ou retire un noeud, on ne veut pas re-distribuer toutes les cles.

### 6.1 Le concept

```
  L'anneau de hash (0 a 2^32-1) :

          0
          |
     N3 --|-- N1
    /     |     \
   /      |      \
  |  S3   |  S1   |
  |       |       |
   \      |      /
    \     |     /
     N2 --|-- (wrap)
          |
        2^32

  Chaque cle est hashee et placee sur l'anneau.
  Elle est assignee au premier noeud dans le sens horaire.

  Ajout d'un noeud N4 :
  - Seules les cles entre N3 et N4 sont deplacees
  - Les autres cles ne bougent pas !
```

### 6.2 Implementation avec noeuds virtuels

```typescript
import { createHash } from 'crypto';

interface VirtualNode {
  physicalNode: string;
  virtualId: number;
  position: number; // Position on the hash ring
}

class ConsistentHashRing {
  private ring: Map<number, VirtualNode> = new Map();
  private sortedPositions: number[] = [];
  private readonly virtualNodesPerNode: number;

  constructor(virtualNodesPerNode: number = 150) {
    this.virtualNodesPerNode = virtualNodesPerNode;
  }

  private hash(key: string): number {
    const h = createHash('md5').update(key).digest('hex');
    return parseInt(h.substring(0, 8), 16);
  }

  addNode(nodeId: string): string[] {
    const movedKeys: string[] = [];

    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const virtualKey = `${nodeId}:vnode-${i}`;
      const position = this.hash(virtualKey);

      this.ring.set(position, {
        physicalNode: nodeId,
        virtualId: i,
        position,
      });
    }

    // Rebuild sorted positions
    this.sortedPositions = Array.from(this.ring.keys()).sort((a, b) => a - b);
    return movedKeys;
  }

  removeNode(nodeId: string): void {
    const positionsToRemove: number[] = [];

    for (const [position, vnode] of this.ring) {
      if (vnode.physicalNode === nodeId) {
        positionsToRemove.push(position);
      }
    }

    for (const pos of positionsToRemove) {
      this.ring.delete(pos);
    }

    this.sortedPositions = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(key: string): string {
    if (this.ring.size === 0) {
      throw new Error('No nodes in the ring');
    }

    const position = this.hash(key);

    // Find the first node position >= key position (clockwise)
    for (const nodePos of this.sortedPositions) {
      if (nodePos >= position) {
        return this.ring.get(nodePos)!.physicalNode;
      }
    }

    // Wrap around to the first node
    return this.ring.get(this.sortedPositions[0])!.physicalNode;
  }

  // Get N nodes for replication (N distinct physical nodes)
  getNodes(key: string, replicationFactor: number): string[] {
    if (this.ring.size === 0) {
      throw new Error('No nodes in the ring');
    }

    const position = this.hash(key);
    const nodes: Set<string> = new Set();
    const startIndex = this.findStartIndex(position);

    for (
      let i = 0;
      i < this.sortedPositions.length && nodes.size < replicationFactor;
      i++
    ) {
      const idx = (startIndex + i) % this.sortedPositions.length;
      const vnode = this.ring.get(this.sortedPositions[idx])!;
      nodes.add(vnode.physicalNode);
    }

    return Array.from(nodes);
  }

  private findStartIndex(position: number): number {
    // Binary search for the first position >= target
    let low = 0;
    let high = this.sortedPositions.length - 1;

    if (position > this.sortedPositions[high]) {
      return 0; // Wrap around
    }

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedPositions[mid] < position) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  // Visualize the distribution of keys across nodes
  analyzeDistribution(keys: string[]): Map<string, number> {
    const distribution: Map<string, number> = new Map();

    for (const key of keys) {
      const node = this.getNode(key);
      distribution.set(node, (distribution.get(node) ?? 0) + 1);
    }

    return distribution;
  }

  getNodeCount(): number {
    const uniqueNodes = new Set<string>();
    for (const vnode of this.ring.values()) {
      uniqueNodes.add(vnode.physicalNode);
    }
    return uniqueNodes.size;
  }

  getRingSize(): number {
    return this.ring.size;
  }
}
```

### 6.3 Demonstration de l'impact des noeuds virtuels

```typescript
function demonstrateVirtualNodes(): void {
  // Without virtual nodes (1 per physical)
  const ring1 = new ConsistentHashRing(1);
  ring1.addNode('node-A');
  ring1.addNode('node-B');
  ring1.addNode('node-C');

  // With 150 virtual nodes per physical
  const ring2 = new ConsistentHashRing(150);
  ring2.addNode('node-A');
  ring2.addNode('node-B');
  ring2.addNode('node-C');

  // Generate test keys
  const keys = Array.from({ length: 10000 }, (_, i) => `key-${i}`);

  console.log('--- Sans virtual nodes (1 vnode/node) ---');
  const dist1 = ring1.analyzeDistribution(keys);
  for (const [node, count] of dist1) {
    const pct = ((count / keys.length) * 100).toFixed(1);
    console.log(`  ${node}: ${count} cles (${pct}%)`);
  }

  console.log('\n--- Avec virtual nodes (150 vnodes/node) ---');
  const dist2 = ring2.analyzeDistribution(keys);
  for (const [node, count] of dist2) {
    const pct = ((count / keys.length) * 100).toFixed(1);
    console.log(`  ${node}: ${count} cles (${pct}%)`);
  }
}

// Output approximatif :
// Sans virtual nodes: distribution tres inegale (ex: 60%, 30%, 10%)
// Avec virtual nodes: distribution quasi-uniforme (ex: 34%, 33%, 33%)
```

---

## 7. Strategies de rebalancing

Quand un noeud est ajoute ou retire, les donnees doivent etre redistribuees.

```
  Rebalancing lors de l'ajout de Node D :

  AVANT :                      APRES :
  Node A: [1-33]               Node A: [1-25]
  Node B: [34-66]              Node B: [34-50]
  Node C: [67-100]             Node C: [67-83]
                               Node D: [26-33, 51-66, 84-100]

  Avec consistent hashing, seule une fraction des cles migre.
```

```typescript
class RebalancingManager {
  private ring: ConsistentHashRing;
  private dataStore: Map<string, Map<string, string>> = new Map();

  constructor(virtualNodes: number = 150) {
    this.ring = new ConsistentHashRing(virtualNodes);
  }

  addNodeWithRebalancing(
    newNodeId: string,
    existingData: Map<string, Map<string, string>>
  ): { movedKeys: number; totalKeys: number } {
    // Capture current distribution
    const allKeys: string[] = [];
    for (const [, store] of existingData) {
      for (const key of store.keys()) allKeys.push(key);
    }

    const beforeAssignment = new Map<string, string>();
    for (const key of allKeys) {
      beforeAssignment.set(key, this.ring.getNode(key));
    }

    // Add the new node
    this.ring.addNode(newNodeId);
    this.dataStore.set(newNodeId, new Map());

    // Compute new assignments and migrate
    let movedKeys = 0;
    for (const key of allKeys) {
      const newNode = this.ring.getNode(key);
      const oldNode = beforeAssignment.get(key)!;

      if (newNode !== oldNode) {
        // Migrate key from old to new node
        const value = existingData.get(oldNode)?.get(key);
        if (value !== undefined) {
          existingData.get(oldNode)?.delete(key);
          if (!existingData.has(newNode)) {
            existingData.set(newNode, new Map());
          }
          existingData.get(newNode)!.set(key, value);
          movedKeys++;
        }
      }
    }

    return { movedKeys, totalKeys: allKeys.length };
  }
}
```

---

## 8. Hot spots et attenuation

```
  Hot spot : une cle ou un shard recoit une charge disproportionnee

  Exemple : la page d'accueil d'une celebrite
  => toutes les lectures vont au meme shard

  Strategies d'attenuation :
  +---------------------------------------------+
  | 1. Ajout de salt aleatoire a la cle         |
  |    user:123 => user:123:salt_7              |
  |    (scatter les lectures sur plusieurs shards)|
  +---------------------------------------------+
  | 2. Caching devant les hot shards            |
  +---------------------------------------------+
  | 3. Split dynamique des shards satures       |
  +---------------------------------------------+
  | 4. Rate limiting par shard                  |
  +---------------------------------------------+
```

```typescript
class HotSpotMitigation {
  private ring: ConsistentHashRing;
  private readonly scatterWidth: number;

  constructor(ring: ConsistentHashRing, scatterWidth: number = 10) {
    this.ring = ring;
    this.scatterWidth = scatterWidth;
  }

  // Scatter reads across multiple shards for hot keys
  getScatteredNodes(key: string): string[] {
    const nodes: string[] = [];
    for (let i = 0; i < this.scatterWidth; i++) {
      const scatteredKey = `${key}:scatter_${i}`;
      nodes.push(this.ring.getNode(scatteredKey));
    }
    return [...new Set(nodes)]; // Unique nodes
  }

  // Write with scatter: write to all scattered locations
  writeScattered(
    key: string,
    value: string,
    stores: Map<string, Map<string, string>>
  ): void {
    for (let i = 0; i < this.scatterWidth; i++) {
      const scatteredKey = `${key}:scatter_${i}`;
      const node = this.ring.getNode(scatteredKey);
      if (!stores.has(node)) stores.set(node, new Map());
      stores.get(node)!.set(scatteredKey, value);
    }
  }

  // Read with scatter: read from a random scattered location
  readScattered(
    key: string,
    stores: Map<string, Map<string, string>>
  ): string | undefined {
    const randomIndex = Math.floor(Math.random() * this.scatterWidth);
    const scatteredKey = `${key}:scatter_${randomIndex}`;
    const node = this.ring.getNode(scatteredKey);
    return stores.get(node)?.get(scatteredKey);
  }
}
```

:::tip
Le scatter/gather est un compromis : il repartit la charge mais complique les ecritures (ecrire a N endroits) et les lectures de donnees qui changent souvent. Reservez cette technique aux cles veritablement "hot" identifiees par le monitoring.
:::

---

## 9. Comparaison des strategies de replication

```
  +-------------------+------------+----------+-------------+
  | Strategie         | Coherence  | Latence  | Complexite  |
  +-------------------+------------+----------+-------------+
  | Leader-Follower   | Forte      | Moyenne  | Faible      |
  | (sync)            | (lineariz.)| (attend  | (1 leader)  |
  |                   |            |  tous)   |             |
  +-------------------+------------+----------+-------------+
  | Leader-Follower   | Eventuelle | Faible   | Faible      |
  | (async)           |            | (retour  | (+ failover)|
  |                   |            |  immédiat)|            |
  +-------------------+------------+----------+-------------+
  | Multi-Leader      | Eventuelle | Faible   | Elevee      |
  |                   | + conflits | (write   | (conflits)  |
  |                   |            |  local)  |             |
  +-------------------+------------+----------+-------------+
  | Leaderless        | Tunable    | Variable | Moyenne     |
  | (quorum)          | (W+R>N)    | (quorum) | (quorum)    |
  +-------------------+------------+----------+-------------+
```

---

## Recapitulatif

| Concept | Cle a retenir |
|---------|---------------|
| Leader-Follower | Simple, mais le leader est un SPOF et un bottleneck |
| Multi-Leader | Faible latence geo, mais conflits d'ecriture |
| Leaderless | Flexible (quorum), resilient, mais complexe |
| Hash Partitioning | Bonne distribution, pas de range scans |
| Range Partitioning | Range scans, risque de hot spots |
| Consistent Hashing | Rebalancing minimal lors d'ajout/retrait de noeuds |
| Virtual Nodes | Ameliorent la distribution sur l'anneau de hash |

---

## Liens

- [Lab 11 : Implementer un consistent hash ring complet](../labs/lab-11-replication-partitionnement/)
- [Quiz 11 : Testez vos connaissances](../quizzes/quiz-11-replication.html)
- [Module suivant : Saga Pattern](./12-transactions-distribuees-saga.md)
- [Visualisation interactive : Consistent Hashing](../visualizations/consistent-hashing.html)
- [Module precedent : Coherence & CAP](./10-coherence-et-theoreme-cap.md)
