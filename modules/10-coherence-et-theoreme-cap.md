# Module 10 : Coherence & CAP

> **Difficulty** : 4/5 | **Duration estimee** : 3h30 | **Prerequis** : Modules 1-9

---

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

1. Distinguer les differents modeles de coherence (strong, sequential, causal, eventual)
2. Expliquer le theoreme CAP et ses implications concretes
3. Classifier les systemes distribues en CP ou AP
4. Appliquer l'extension PACELC pour affiner l'analyse
5. Implementer des lectures/ecritures par quorum en TypeScript
6. Choisir le bon niveau de coherence selon le cas d'usage

---

## 1. Modeles de coherence

La coherence definit les **garanties** qu'un systeme distribue offre sur l'ordre et la visibilite des operations. Plus la coherence est forte, plus le systeme est simple a raisonner, mais plus il coute cher en latence et disponibilite.

```
Coherence forte (linearizability)
        |
        v
Coherence sequentielle
        |
        v
Coherence causale
        |
        v
Coherence eventuelle (eventual)
        |
        v
Aucune garantie
```

### 1.1 Strong Consistency (Linearizability)

La linearizability est le modele le plus strict : chaque operation apparait comme si elle s'etait executee **instantanement** a un point precis entre son invocation et sa reponse. Toutes les repliques voient le meme etat au meme moment.

```
  Client A          Systeme           Client B
     |                 |                  |
     |--- write(x=1) ->|                  |
     |                 |<-- read(x) ------|
     |<-- ack ---------|                  |
     |                 |--- return x=1 -->|
     |                 |                  |

  Linearizable : la lecture de B DOIT retourner 1
  car le write de A est complete avant la lecture de B.
```

:::tip
La linearizability est souvent appelee "strong consistency". C'est le modele que la plupart des developpeurs attendent intuitivement d'une base de donnees.
:::

### 1.2 Sequential Consistency

Toutes les operations de tous les processus sont vues dans le **meme ordre**, mais cet ordre n'a pas besoin de respecter le temps reel. L'ordre des operations d'un meme processus est preserve.

### 1.3 Causal Consistency

Si l'operation A **cause** l'operation B (A happened-before B), alors tout processus qui voit B doit aussi avoir vu A. Les operations concurrentes (sans lien causal) peuvent etre vues dans n'importe quel ordre.

### 1.4 Eventual Consistency

Si aucune nouvelle ecriture n'est effectuee, **toutes les repliques finiront par converger** vers la meme valeur. Aucune garantie sur le delai de convergence.

:::warning
Eventual consistency ne veut PAS dire "inconsistant". Le systeme finira par converger. Mais pendant la fenetre de convergence, differents clients peuvent lire differentes valeurs.
:::

---

## 2. Simulation TypeScript des modeles de coherence

```typescript
// Types de base pour notre simulation
interface Operation {
  type: 'read' | 'write';
  key: string;
  value?: string;
  timestamp: number;
  clientId: string;
}

interface Replica {
  id: string;
  store: Map<string, string>;
  log: Operation[];
  replicationDelay: number; // ms de delai de replication
}

// --- Strong Consistency Simulation ---
class StrongConsistencyStore {
  private replicas: Replica[] = [];
  private lock: boolean = false;

  constructor(replicaCount: number) {
    for (let i = 0; i < replicaCount; i++) {
      this.replicas.push({
        id: `replica-${i}`,
        store: new Map(),
        log: [],
        replicationDelay: 0,
      });
    }
  }

  async write(key: string, value: string, clientId: string): Promise<void> {
    // Acquire global lock — simulates consensus protocol
    while (this.lock) {
      await new Promise((r) => setTimeout(r, 10));
    }
    this.lock = true;

    try {
      const op: Operation = {
        type: 'write',
        key,
        value,
        timestamp: Date.now(),
        clientId,
      };

      // Write to ALL replicas synchronously before returning
      for (const replica of this.replicas) {
        replica.store.set(key, value);
        replica.log.push(op);
      }
    } finally {
      this.lock = false;
    }
  }

  read(key: string, clientId: string): string | undefined {
    // Any replica returns the same value (linearizable)
    const replica = this.replicas[0];
    const op: Operation = {
      type: 'read',
      key,
      timestamp: Date.now(),
      clientId,
    };
    replica.log.push(op);
    return replica.store.get(key);
  }
}

// --- Eventual Consistency Simulation ---
class EventualConsistencyStore {
  private replicas: Replica[] = [];

  constructor(replicaCount: number, replicationDelay: number) {
    for (let i = 0; i < replicaCount; i++) {
      this.replicas.push({
        id: `replica-${i}`,
        store: new Map(),
        log: [],
        replicationDelay,
      });
    }
  }

  async write(
    key: string,
    value: string,
    replicaIndex: number
  ): Promise<void> {
    // Write to ONE replica immediately
    const primary = this.replicas[replicaIndex];
    primary.store.set(key, value);

    // Replicate asynchronously to others (fire and forget)
    for (const replica of this.replicas) {
      if (replica.id !== primary.id) {
        setTimeout(() => {
          replica.store.set(key, value);
        }, replica.replicationDelay);
      }
    }
  }

  read(key: string, replicaIndex: number): string | undefined {
    // Read from a specific replica — may be stale
    return this.replicas[replicaIndex].store.get(key);
  }
}

// --- Causal Consistency Simulation ---
interface VectorClock {
  [nodeId: string]: number;
}

class CausalConsistencyStore {
  private replicas: Map<string, Map<string, string>> = new Map();
  private clocks: Map<string, VectorClock> = new Map();

  constructor(private nodeIds: string[]) {
    for (const id of nodeIds) {
      this.replicas.set(id, new Map());
      const clock: VectorClock = {};
      for (const nid of nodeIds) clock[nid] = 0;
      this.clocks.set(id, clock);
    }
  }

  write(nodeId: string, key: string, value: string): VectorClock {
    const clock = this.clocks.get(nodeId)!;
    clock[nodeId]++;
    this.replicas.get(nodeId)!.set(key, value);
    return { ...clock };
  }

  canDeliver(targetNodeId: string, senderClock: VectorClock): boolean {
    const localClock = this.clocks.get(targetNodeId)!;
    // All causal dependencies must be satisfied
    for (const [nodeId, time] of Object.entries(senderClock)) {
      if (nodeId !== targetNodeId && time > (localClock[nodeId] || 0)) {
        return false;
      }
    }
    return true;
  }

  replicate(
    fromNodeId: string,
    toNodeId: string,
    key: string,
    value: string,
    senderClock: VectorClock
  ): boolean {
    if (!this.canDeliver(toNodeId, senderClock)) {
      return false; // Cannot deliver yet — causal dependency not met
    }
    this.replicas.get(toNodeId)!.set(key, value);
    // Merge vector clocks
    const localClock = this.clocks.get(toNodeId)!;
    for (const [nodeId, time] of Object.entries(senderClock)) {
      localClock[nodeId] = Math.max(localClock[nodeId] || 0, time);
    }
    return true;
  }
}
```

---

## 3. Le theoreme CAP

Enonce en 2000 par Eric Brewer et prouve formellement en 2002 par Gilbert et Lynch :

> Un systeme distribue ne peut garantir simultanement que **deux** des trois proprietes suivantes :
> - **C**onsistency : chaque lecture retourne la derniere ecriture
> - **A**vailability : chaque requete recoit une reponse (pas d'erreur)
> - **P**artition tolerance : le systeme continue de fonctionner malgre des pertes de messages reseau

```
              Consistency (C)
                  /\
                 /  \
                /    \
               / CP   \
              /  zone  \
             /          \
            /    CAP     \
           /   (impossible)\
          /________________\
   Availability (A) --- Partition Tolerance (P)
                  AP zone

  +-----+------------------+------------------------+
  | Type | Exemples         | Comportement partition |
  +-----+------------------+------------------------+
  | CP  | ZooKeeper, etcd, | Refuse les ecritures   |
  |     | HBase, Spanner   | pour rester coherent   |
  +-----+------------------+------------------------+
  | AP  | Cassandra,       | Accepte les ecritures  |
  |     | DynamoDB, CouchDB| au risque de conflits  |
  +-----+------------------+------------------------+
  | CA  | PostgreSQL       | N'existe pas en vrai   |
  |     | (single node)    | distribue (P requis)   |
  +-----+------------------+------------------------+
```

:::warning
En pratique, les partitions reseau **arrivent**. Elles ne sont pas optionnelles. Le vrai choix est donc entre CP et AP. Un systeme "CA" n'est tout simplement pas distribue.
:::

### 3.1 Pourquoi P est obligatoire

Le reseau est **fondamentalement non fiable** dans un systeme distribue :

- Les cables se debranchent
- Les switches tombent en panne
- Les datacenters perdent la connectivite
- La latence peut etre si elevee qu'elle est indistinguable d'une partition

:::tip
Le "theoreme" FLP (Fischer, Lynch, Paterson, 1985) montre qu'il est impossible de garantir le consensus dans un systeme asynchrone avec meme **un seul** processus defaillant. CAP est une consequence pratique de cette impossibilite fondamentale.
:::

### 3.2 CP : Coherence au prix de la disponibilite

Un systeme CP, face a une partition, **refuse de repondre** plutot que de retourner une donnee potentiellement obsolete.

```typescript
class CPSystem {
  private nodes: Map<string, string> = new Map();
  private partitioned: boolean = false;

  setPartitioned(value: boolean): void {
    this.partitioned = value;
  }

  write(key: string, value: string): { success: boolean; error?: string } {
    if (this.partitioned) {
      // CP: refuse l'ecriture pendant une partition
      return {
        success: false,
        error: 'Service unavailable: network partition detected',
      };
    }
    this.nodes.set(key, value);
    return { success: true };
  }

  read(key: string): { success: boolean; value?: string; error?: string } {
    if (this.partitioned) {
      return {
        success: false,
        error: 'Service unavailable: network partition detected',
      };
    }
    return { success: true, value: this.nodes.get(key) };
  }
}
```

### 3.3 AP : Disponibilite au prix de la coherence

Un systeme AP repond **toujours**, meme si la reponse peut etre obsolete.

```typescript
class APSystem {
  private localStore: Map<string, { value: string; version: number }> =
    new Map();
  private pendingSync: Array<{ key: string; value: string; version: number }> =
    [];

  write(key: string, value: string): { success: true; warning?: string } {
    const current = this.localStore.get(key);
    const version = (current?.version ?? 0) + 1;
    this.localStore.set(key, { value, version });

    // Queue for async replication (may fail if partitioned)
    this.pendingSync.push({ key, value, version });

    return {
      success: true,
      warning: 'Write accepted locally, replication pending',
    };
  }

  read(key: string): { success: true; value?: string; stale: boolean } {
    const entry = this.localStore.get(key);
    return {
      success: true,
      value: entry?.value,
      stale: this.pendingSync.length > 0, // May be stale if sync pending
    };
  }
}
```

---

## 4. PACELC : L'extension du theoreme CAP

Le theoreme CAP ne decrit que le comportement **pendant une partition**. Mais que se passe-t-il le reste du temps (quand le reseau fonctionne) ? C'est la que PACELC entre en jeu.

> **PACELC** : si **P**artition, choisir **A** ou **C** ; sinon (**E**lse), choisir **L**atence ou **C**oherence.

```
  +--------------------+-------------------+-------------------+
  | Systeme            | Pendant Partition  | En fonctionnement |
  |                    | (PA ou PC)         | normal (EL ou EC) |
  +--------------------+-------------------+-------------------+
  | Cassandra          | PA                 | EL                |
  | (PA/EL)            | Disponible         | Faible latence    |
  +--------------------+-------------------+-------------------+
  | DynamoDB           | PA                 | EL                |
  | (PA/EL)            | Disponible         | Faible latence    |
  +--------------------+-------------------+-------------------+
  | ZooKeeper          | PC                 | EC                |
  | (PC/EC)            | Coherent           | Coherent          |
  +--------------------+-------------------+-------------------+
  | Spanner            | PC                 | EC                |
  | (PC/EC)            | Coherent           | Coherent (TrueTime)|
  +--------------------+-------------------+-------------------+
  | MongoDB            | PA                 | EC                |
  | (PA/EC)            | Disponible         | Coherent          |
  +--------------------+-------------------+-------------------+
  | Cosmos DB          | Configurable       | Configurable      |
  | (tunable)          | PA ou PC           | EL ou EC          |
  +--------------------+-------------------+-------------------+
```

```typescript
type PACELCConfig = {
  duringPartition: 'availability' | 'consistency';
  elseNormal: 'latency' | 'consistency';
};

const SYSTEM_PROFILES: Record<string, PACELCConfig> = {
  cassandra: { duringPartition: 'availability', elseNormal: 'latency' },
  zookeeper: { duringPartition: 'consistency', elseNormal: 'consistency' },
  dynamodb: { duringPartition: 'availability', elseNormal: 'latency' },
  spanner: { duringPartition: 'consistency', elseNormal: 'consistency' },
  cosmosdb_strong: {
    duringPartition: 'consistency',
    elseNormal: 'consistency',
  },
  cosmosdb_eventual: {
    duringPartition: 'availability',
    elseNormal: 'latency',
  },
};

function describeSystem(name: string): string {
  const config = SYSTEM_PROFILES[name];
  if (!config) return `Unknown system: ${name}`;

  const partitionBehavior =
    config.duringPartition === 'availability'
      ? 'reste disponible (accepte les ecritures locales)'
      : "refuse les ecritures (maintient la coherence)";

  const normalBehavior =
    config.elseNormal === 'latency'
      ? 'optimise pour la latence (lectures locales rapides)'
      : 'optimise pour la coherence (lectures linearisables)';

  return `${name}:\n  Partition: ${partitionBehavior}\n  Normal: ${normalBehavior}`;
}
```

---

## 5. Quorum Reads/Writes

Le quorum est un mecanisme qui permet d'obtenir differents niveaux de coherence en ajustant le nombre de repliques qui doivent confirmer une operation.

### 5.1 La regle fondamentale

```
  N = nombre total de repliques
  W = nombre de repliques qui doivent confirmer une ecriture
  R = nombre de repliques qui doivent confirmer une lecture

  Si W + R > N => coherence forte (on lit au moins une replique a jour)

  +---------------------------------------------------+
  | Configuration    | W | R | W+R | Coherence        |
  +---------------------------------------------------+
  | Strong (defaut)  | 3 | 3 |  6  | Forte (N=5)      |
  | Quorum           | 3 | 3 |  6  | Forte (N=5)      |
  | Write-heavy      | 1 | 5 |  6  | Forte (N=5)      |
  | Read-heavy       | 5 | 1 |  6  | Forte (N=5)      |
  | Eventual         | 1 | 1 |  2  | Faible (N=5)     |
  +---------------------------------------------------+
```

```
  Ecriture avec W=3 sur N=5 repliques :

  Client
    |
    |--- write(x=42) --->  Replica 1  [ACK]  --|
    |--- write(x=42) --->  Replica 2  [ACK]  --|-- W=3 ACKs recus
    |--- write(x=42) --->  Replica 3  [ACK]  --|     => succes !
    |--- write(x=42) --->  Replica 4  [...]
    |--- write(x=42) --->  Replica 5  [...]
    |
    |<-- SUCCESS (3/5 ACKs)
```

### 5.2 Implementation TypeScript du quorum

```typescript
interface ReplicaNode {
  id: string;
  store: Map<string, { value: string; version: number }>;
  alive: boolean;
  latencyMs: number;
}

class QuorumStore {
  private replicas: ReplicaNode[];
  private readonly N: number;
  private W: number;
  private R: number;

  constructor(replicaCount: number, W: number, R: number) {
    this.N = replicaCount;
    this.W = W;
    this.R = R;
    this.replicas = [];

    for (let i = 0; i < replicaCount; i++) {
      this.replicas.push({
        id: `node-${i}`,
        store: new Map(),
        alive: true,
        latencyMs: Math.floor(Math.random() * 50) + 10,
      });
    }
  }

  isStronglyConsistent(): boolean {
    return this.W + this.R > this.N;
  }

  async write(
    key: string,
    value: string
  ): Promise<{ success: boolean; acksReceived: number; version: number }> {
    const version = Date.now();

    // Send write to all replicas in parallel
    const writePromises = this.replicas.map(async (replica) => {
      if (!replica.alive) {
        throw new Error(`Replica ${replica.id} is down`);
      }
      // Simulate network latency
      await new Promise((resolve) =>
        setTimeout(resolve, replica.latencyMs)
      );
      replica.store.set(key, { value, version });
      return replica.id;
    });

    // Wait for W acknowledgments
    let acksReceived = 0;
    const results = await Promise.allSettled(writePromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        acksReceived++;
      }
    }

    return {
      success: acksReceived >= this.W,
      acksReceived,
      version,
    };
  }

  async read(
    key: string
  ): Promise<{
    success: boolean;
    value?: string;
    version?: number;
    responsesReceived: number;
  }> {
    // Read from all replicas in parallel
    const readPromises = this.replicas.map(async (replica) => {
      if (!replica.alive) {
        throw new Error(`Replica ${replica.id} is down`);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, replica.latencyMs)
      );
      return {
        replicaId: replica.id,
        data: replica.store.get(key) ?? null,
      };
    });

    const results = await Promise.allSettled(readPromises);
    const successfulReads: Array<{
      replicaId: string;
      data: { value: string; version: number } | null;
    }> = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successfulReads.push(result.value);
      }
    }

    if (successfulReads.length < this.R) {
      return { success: false, responsesReceived: successfulReads.length };
    }

    // Return the value with the highest version (most recent write)
    let latest: { value: string; version: number } | null = null;
    for (const read of successfulReads) {
      if (read.data && (!latest || read.data.version > latest.version)) {
        latest = read.data;
      }
    }

    return {
      success: true,
      value: latest?.value,
      version: latest?.version,
      responsesReceived: successfulReads.length,
    };
  }

  // Read repair: update stale replicas after a quorum read
  async readRepair(key: string, latestValue: string, latestVersion: number): Promise<void> {
    const repairPromises = this.replicas
      .filter((r) => r.alive)
      .map(async (replica) => {
        const current = replica.store.get(key);
        if (!current || current.version < latestVersion) {
          replica.store.set(key, {
            value: latestValue,
            version: latestVersion,
          });
        }
      });

    await Promise.allSettled(repairPromises);
  }

  // Dynamically adjust W and R for tunable consistency
  tune(newW: number, newR: number): void {
    if (newW < 1 || newR < 1 || newW > this.N || newR > this.N) {
      throw new Error(`W and R must be between 1 and ${this.N}`);
    }
    this.W = newW;
    this.R = newR;
    console.log(
      `Tuned: W=${this.W}, R=${this.R}, ` +
      `Strong consistency: ${this.isStronglyConsistent()}`
    );
  }

  killNode(index: number): void {
    this.replicas[index].alive = false;
  }

  reviveNode(index: number): void {
    this.replicas[index].alive = true;
  }
}
```

---

## 6. Tunable Consistency

Certains systemes (Cassandra, DynamoDB, Cosmos DB) permettent de choisir le niveau de coherence **par requete**.

```typescript
type ConsistencyLevel = 'ONE' | 'QUORUM' | 'ALL' | 'LOCAL_QUORUM';

function getQuorumParams(
  level: ConsistencyLevel,
  N: number
): { W: number; R: number } {
  const majority = Math.floor(N / 2) + 1;

  switch (level) {
    case 'ONE':
      return { W: 1, R: 1 }; // Fastest, weakest consistency
    case 'QUORUM':
      return { W: majority, R: majority }; // Strong consistency
    case 'ALL':
      return { W: N, R: N }; // Strongest, slowest, least available
    case 'LOCAL_QUORUM':
      return { W: majority, R: majority }; // Within local DC
  }
}

// Usage example
function demonstrateTunableConsistency(): void {
  const N = 5;
  const levels: ConsistencyLevel[] = ['ONE', 'QUORUM', 'ALL'];

  for (const level of levels) {
    const { W, R } = getQuorumParams(level, N);
    const strong = W + R > N;
    console.log(
      `Level: ${level.padEnd(10)} | W=${W}, R=${R} | ` +
      `Strong: ${strong ? 'YES' : 'NO'} | ` +
      `Tolere ${N - W} pannes en ecriture, ${N - R} en lecture`
    );
  }
}
```

---

## 7. Framework de decision

```
  +----------------------------------------------------------+
  |         Quel niveau de coherence choisir ?                |
  +----------------------------------------------------------+
  |                                                          |
  |  Transactions financieres,     Reseaux sociaux,          |
  |  inventaire critique ?         compteurs de likes ?       |
  |         |                              |                  |
  |         v                              v                  |
  |   Strong Consistency             Eventual Consistency     |
  |   (CP, W+R > N)                 (AP, W=1, R=1)           |
  |                                                          |
  |  Sessions utilisateur,         Systeme de logs,          |
  |  ordonnancement causal ?       metriques temps reel ?    |
  |         |                              |                  |
  |         v                              v                  |
  |   Causal Consistency            Eventual avec TTL         |
  |   (Vector clocks)              (AP, convergence rapide)  |
  +----------------------------------------------------------+
```

:::tip
Il n'y a pas de "meilleur" niveau de coherence. Le bon choix depend du **cout metier** d'une lecture obsolete. Un compte bancaire ne tolere pas une lecture stale. Un flux de likes sur un reseau social, si.
:::

---

## 8. Exercice de synthese

```typescript
// Exercice : Implementez un systeme qui change de comportement
// selon la detection de partition

class AdaptiveConsistencySystem {
  private partitionDetected: boolean = false;
  private quorumStore: QuorumStore;

  constructor() {
    this.quorumStore = new QuorumStore(5, 3, 3); // Strong par defaut
  }

  onPartitionDetected(): void {
    this.partitionDetected = true;
    // Degrade to eventual consistency to maintain availability
    this.quorumStore.tune(1, 1);
    console.log('Partition detected: degraded to eventual consistency');
  }

  onPartitionHealed(): void {
    this.partitionDetected = false;
    // Restore strong consistency
    this.quorumStore.tune(3, 3);
    console.log('Partition healed: restored strong consistency');
    // Trigger anti-entropy repair
    this.triggerRepair();
  }

  private triggerRepair(): void {
    console.log('Anti-entropy repair started...');
    // In a real system: Merkle tree comparison, read repair, etc.
  }

  getStatus(): string {
    return this.partitionDetected
      ? 'DEGRADED (AP mode - eventual consistency)'
      : 'NORMAL (CP mode - strong consistency)';
  }
}
```

---

## Recapitulatif

| Concept | Cle a retenir |
|---------|---------------|
| Linearizability | Le plus strict : chaque operation parait instantanee |
| Eventual consistency | Converge a terme, pas de garantie temporelle |
| CAP | En distribue, P est impose => choix entre C et A |
| PACELC | Meme sans partition : choix latence vs coherence |
| Quorum W+R > N | Garantit qu'on lit au moins une replique a jour |
| Tunable consistency | Ajuster W et R par requete selon le besoin metier |

---

## Liens

- [Lab 10 : Implementer un store quorum complet](../labs/lab-10-coherence-cap/)
- [Quiz 10 : Testez vos connaissances](../quizzes/quiz-10-coherence-cap.html)
- [Module suivant : Replication & Partitionnement](./11-replication-et-partitionnement.md)
- [Visualisation interactive : CAP Theorem](../visualizations/cap-theorem.html)
- [Module precedent : Retries, Timeouts & Idempotency](./09-retries-timeouts-idempotency.md)
