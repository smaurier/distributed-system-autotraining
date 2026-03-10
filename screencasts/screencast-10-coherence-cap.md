# Screencast 10 — Coherence et Theoreme CAP

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/10-coherence-et-theoreme-cap.md`
- **Lab associe** : Lab 10
- **Prerequis** : Screencast 09

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/10-coherence-et-theoreme-cap.md` ouvert
- [ ] Navigateur pret pour la visualisation `cap-theorem.html` (si disponible)
- [ ] Terminal supplementaire pour les demos

## Script

### [00:00-02:00] Introduction — Le theoreme CAP

> Jusqu'ici, on a construit des services qui communiquent entre eux. Mais que se passe-t-il quand deux copies d'une meme donnee divergent ? Le theoreme CAP, formule par Eric Brewer en 2000, dit qu'un systeme distribue ne peut garantir simultanement que deux des trois proprietes suivantes : Consistency, Availability, et Partition tolerance.

**Action** : Ouvrir le module 10 et afficher le triangle CAP.

```
                    CONSISTENCY
                    (toutes les lectures
                     retournent la derniere
                     ecriture)
                        /\
                       /  \
                      /    \
                     / CP   \
                    /  sys   \
                   /          \
                  /     CA     \
                 /    systems   \
                /    (impossible \
               /    en distribue)\
              /                   \
             /________AP___________\
    AVAILABILITY              PARTITION
    (chaque requete            TOLERANCE
     recoit une reponse)      (le systeme fonctionne
                               malgre les coupures reseau)
```

> En realite, la partition tolerance n'est pas un choix — les partitions reseau se produisent. Le vrai choix est donc entre CP (coherence + partition tolerance) et AP (disponibilite + partition tolerance). C'est le dilemme fondamental.

### [02:00-06:00] Strong consistency vs Eventual consistency

> Demontrons la difference avec du code concret.

**Action** : Creer un fichier `consistency-demo.ts`.

```typescript
// --- Strong Consistency : toutes les repliques sont synchronisees avant de repondre ---
class StrongConsistencyStore {
  private replicas: Map<string, string>[] = [];

  constructor(numReplicas: number) {
    for (let i = 0; i < numReplicas; i++) {
      this.replicas.push(new Map());
    }
  }

  async write(key: string, value: string): Promise<{ success: boolean; latencyMs: number }> {
    const start = performance.now();
    let ackCount = 0;

    // Ecrire sur TOUTES les repliques avant de confirmer
    for (let i = 0; i < this.replicas.length; i++) {
      await this.simulateNetworkDelay();
      this.replicas[i].set(key, value);
      ackCount++;
      console.log(`  [Strong] Replica ${i} acknowledged write "${key}" = "${value}"`);
    }

    const latency = performance.now() - start;
    console.log(`  [Strong] Write confirmed (all ${ackCount} replicas) — ${latency.toFixed(1)}ms`);
    return { success: true, latencyMs: latency };
  }

  read(key: string, replicaIndex: number = 0): string | undefined {
    // Toutes les repliques sont identiques → lire n'importe laquelle
    return this.replicas[replicaIndex].get(key);
  }

  private simulateNetworkDelay(): Promise<void> {
    return new Promise(r => setTimeout(r, 10 + Math.random() * 40));
  }
}

// --- Eventual Consistency : ecrire rapidement, propager en arriere-plan ---
class EventualConsistencyStore {
  private replicas: Map<string, string>[] = [];
  private pendingSync: { key: string; value: string; targetReplica: number }[] = [];

  constructor(numReplicas: number) {
    for (let i = 0; i < numReplicas; i++) {
      this.replicas.push(new Map());
    }
  }

  async write(key: string, value: string): Promise<{ success: boolean; latencyMs: number }> {
    const start = performance.now();

    // Ecrire uniquement sur la replique locale
    this.replicas[0].set(key, value);
    console.log(`  [Eventual] Primary replica acknowledged — fast!`);

    // Planifier la propagation en arriere-plan
    for (let i = 1; i < this.replicas.length; i++) {
      this.pendingSync.push({ key, value, targetReplica: i });
    }

    const latency = performance.now() - start;
    console.log(`  [Eventual] Write confirmed — ${latency.toFixed(1)}ms (sync pending for ${this.replicas.length - 1} replicas)`);
    return { success: true, latencyMs: latency };
  }

  read(key: string, replicaIndex: number): string | undefined {
    return this.replicas[replicaIndex].get(key);
  }

  async syncReplicas(): Promise<void> {
    for (const sync of this.pendingSync) {
      await this.simulateNetworkDelay();
      this.replicas[sync.targetReplica].set(sync.key, sync.value);
      console.log(`  [Eventual] Synced replica ${sync.targetReplica}: "${sync.key}" = "${sync.value}"`);
    }
    this.pendingSync = [];
  }

  private simulateNetworkDelay(): Promise<void> {
    return new Promise(r => setTimeout(r, 10 + Math.random() * 40));
  }
}
```

**Action** : Comparer les deux modes.

```typescript
console.log('=== Strong Consistency (3 replicas) ===');
const strong = new StrongConsistencyStore(3);
await strong.write('user:1:name', 'Alice');
// Lecture immediate sur n'importe quelle replique = toujours "Alice"
console.log(`Read from replica 0: ${strong.read('user:1:name', 0)}`);
console.log(`Read from replica 2: ${strong.read('user:1:name', 2)}`);

console.log('\n=== Eventual Consistency (3 replicas) ===');
const eventual = new EventualConsistencyStore(3);
await eventual.write('user:1:name', 'Alice');
// Lecture immediate sur une replique secondaire = peut etre undefined !
console.log(`Read from replica 0: ${eventual.read('user:1:name', 0)}`); // "Alice"
console.log(`Read from replica 2: ${eventual.read('user:1:name', 2)}`); // undefined !

// Apres la synchronisation...
await eventual.syncReplicas();
console.log(`Read from replica 2 (after sync): ${eventual.read('user:1:name', 2)}`); // "Alice"
```

> Voila le trade-off : la strong consistency est lente (3 ecritures reseau synchrones) mais coherente. L'eventual consistency est rapide (1 ecriture locale) mais peut retourner des donnees obsoletes pendant une fenetre de temps.

### [06:00-09:00] Quorum — Le compromis

> Le quorum est un compromis elegant entre les deux extremes. Au lieu d'attendre toutes les repliques ou une seule, on attend une majorite.

**Action** : Implementer un quorum store.

```typescript
class QuorumStore {
  private replicas: Map<string, { value: string; version: number }>[] = [];
  private numReplicas: number;

  constructor(numReplicas: number) {
    this.numReplicas = numReplicas;
    for (let i = 0; i < numReplicas; i++) {
      this.replicas.push(new Map());
    }
  }

  private quorumSize(): number {
    return Math.floor(this.numReplicas / 2) + 1;
  }

  async write(key: string, value: string): Promise<boolean> {
    const version = Date.now();
    let ackCount = 0;

    // Envoyer a toutes les repliques en parallele
    const results = await Promise.allSettled(
      this.replicas.map(async (replica, i) => {
        await this.simulateNetwork(i);
        replica.set(key, { value, version });
        return i;
      })
    );

    ackCount = results.filter(r => r.status === 'fulfilled').length;
    const quorum = this.quorumSize();
    const success = ackCount >= quorum;

    console.log(`[Quorum] Write "${key}" = "${value}": ${ackCount}/${this.numReplicas} acks (need ${quorum}): ${success ? 'OK' : 'FAIL'}`);
    return success;
  }

  async read(key: string): Promise<string | undefined> {
    const results = await Promise.allSettled(
      this.replicas.map(async (replica, i) => {
        await this.simulateNetwork(i);
        return replica.get(key);
      })
    );

    // Prendre la valeur avec la version la plus recente
    let latest: { value: string; version: number } | undefined;
    let responseCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        responseCount++;
        if (!latest || result.value.version > latest.version) {
          latest = result.value;
        }
      }
    }

    if (responseCount >= this.quorumSize() && latest) {
      console.log(`[Quorum] Read "${key}": "${latest.value}" (${responseCount} responses, version ${latest.version})`);
      return latest.value;
    }

    console.log(`[Quorum] Read "${key}": quorum not reached (${responseCount} responses)`);
    return undefined;
  }

  private async simulateNetwork(replicaIndex: number): Promise<void> {
    // Simuler une replique lente ou en panne
    if (Math.random() < 0.1) throw new Error(`Replica ${replicaIndex} unreachable`);
    await new Promise(r => setTimeout(r, 5 + Math.random() * 20));
  }
}
```

> Avec 5 repliques et un quorum de 3, on tolere 2 pannes. La formule cle : si W + R > N, on a la strong consistency. W = nombre d'ecritures confirmees, R = nombre de lectures, N = nombre total de repliques. Avec W=3 et R=3, tant qu'on a 3 repliques vivantes, le systeme est coherent et disponible.

### [09:00-12:30] PACELC — Au-dela du CAP

> Le theoreme CAP est utile mais incomplet. Il ne parle que du cas ou il y a une partition. PACELC etend le modele : en cas de Partition, choisir entre A et C. Sinon (Else), choisir entre Latency et Consistency.

**Action** : Afficher le tableau PACELC.

```
SYSTEME           | Partition (P→A/C)  | Normal (E→L/C)
──────────────────|────────────────────|─────────────────
DynamoDB          | PA                 | EL (fast reads)
Cassandra         | PA                 | EL (tunable)
MongoDB (default) | PC                 | EC (strong)
PostgreSQL        | PC                 | EC (ACID)
CockroachDB       | PC                 | EC (serializable)
Redis Cluster     | PA                 | EL (in-memory)
```

```typescript
// Le choix depend du contexte metier
interface ConsistencyChoice {
  useCase: string;
  choice: 'PA/EL' | 'PC/EC';
  reason: string;
}

const decisions: ConsistencyChoice[] = [
  {
    useCase: 'Panier e-commerce',
    choice: 'PA/EL',
    reason: 'Mieux vaut un panier temporairement incoherent qu\'un site indisponible',
  },
  {
    useCase: 'Solde bancaire',
    choice: 'PC/EC',
    reason: 'Un solde incoherent peut causer un decouvert non autorise',
  },
  {
    useCase: 'Timeline Twitter',
    choice: 'PA/EL',
    reason: 'Un tweet affiche avec 2 secondes de retard est acceptable',
  },
  {
    useCase: 'Reservation de siege avion',
    choice: 'PC/EC',
    reason: 'Deux personnes sur le meme siege = incident grave',
  },
];

for (const d of decisions) {
  console.log(`${d.useCase}: ${d.choice} — ${d.reason}`);
}
```

> Le choix n'est pas technique, il est metier. Un architecte doit comprendre les consequences business de chaque compromis.

### [12:30-15:30] Visualisation interactive du CAP

> Ouvrons la visualisation interactive pour voir concretement ce qui se passe pendant une partition.

**Action** : Ouvrir la visualisation `cap-theorem.html` dans le navigateur (ou montrer le diagramme dans le module).

```typescript
// Simulation d'une partition reseau
class PartitionSimulator {
  private nodes: Map<string, { data: string; healthy: boolean }> = new Map();

  constructor(nodeCount: number) {
    for (let i = 0; i < nodeCount; i++) {
      this.nodes.set(`node-${i}`, { data: 'initial', healthy: true });
    }
  }

  partition(groupA: string[], groupB: string[]): void {
    console.log(`\n[Partition] Network split: [${groupA}] | [${groupB}]`);
  }

  writeCP(key: string, value: string, availableNodes: string[]): boolean {
    // CP : refuse l'ecriture si quorum impossible
    if (availableNodes.length < Math.floor(this.nodes.size / 2) + 1) {
      console.log(`[CP] Write REJECTED: only ${availableNodes.length} nodes reachable (need majority)`);
      return false;
    }
    for (const nodeId of availableNodes) {
      this.nodes.get(nodeId)!.data = value;
    }
    console.log(`[CP] Write accepted on ${availableNodes.length} nodes`);
    return true;
  }

  writeAP(key: string, value: string, availableNodes: string[]): boolean {
    // AP : accepte toujours l'ecriture, meme partiel
    for (const nodeId of availableNodes) {
      this.nodes.get(nodeId)!.data = value;
    }
    console.log(`[AP] Write accepted on ${availableNodes.length} nodes (may diverge)`);
    return true;
  }

  printState(): void {
    for (const [id, node] of this.nodes) {
      console.log(`  ${id}: data="${node.data}"`);
    }
  }
}
```

**Action** : Simuler une partition et montrer le comportement CP vs AP.

> En mode CP, le systeme refuse les ecritures pendant la partition pour garder la coherence. En mode AP, il accepte les ecritures des deux cotes — mais les donnees divergent et devront etre reconciliees apres la partition.

### [15:30-17:00] Recapitulatif

> Recapitulons. Le theoreme CAP dit qu'en cas de partition, il faut choisir entre coherence et disponibilite. La strong consistency attend toutes les repliques, l'eventual consistency n'en attend qu'une. Le quorum est un compromis qui attend une majorite. PACELC etend le CAP au cas normal (sans partition). Et le choix depend toujours du contexte metier.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. CAP = en cas de partition, choisir Consistency OU Availability
2. Strong consistency = lent mais coherent
3. Eventual consistency = rapide mais donnees potentiellement obsoletes
4. Quorum (W+R>N) = compromis entre les deux
5. PACELC = etend CAP au fonctionnement normal (Latency vs Consistency)
6. Le choix est METIER, pas technique

PROCHAINE ETAPE :
→ Screencast 11 : Replication et partitionnement
```

> Au prochain screencast, on va implementer la replication leader-follower et le consistent hashing. Ce sont les mecanismes concrets qui implementent les choix CAP. A bientot !

## Points d'attention pour l'enregistrement
- Le triangle CAP doit etre affiche clairement — c'est un diagramme celebre
- Bien insister sur le fait que P n'est pas un choix — les partitions arrivent
- La demo strong vs eventual est le moment cle : montrer la lecture undefined en eventual
- Le quorum est un concept mathematique — prendre le temps d'expliquer W+R>N
- Le tableau PACELC est une reference utile — le laisser a l'ecran quelques secondes
- Si la visualisation HTML existe, la montrer en interactif — c'est tres parlant
