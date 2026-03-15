# 22 — Stream Processing & Event Streaming

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 120 min       | [Lab 22](../labs/lab-22-stream-processing/) | [Quiz 22](../quizzes/quiz-22-stream-processing.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Comparer le batch processing et le stream processing et identifier quand utiliser chacun
- Decrire l'architecture conceptuelle de Kafka : topics, partitions, offsets, consumer groups
- Implementer une simulation de log partitionne en TypeScript
- Expliquer et implementer les quatre types de fenetres : tumbling, hopping, sliding, session
- Définir la dualite stream-table et son importance pratique
- Distinguer event time et processing time et gérer les événements en retard
- Decrire les mécanismes pour atteindre la semantique exactly-once dans un pipeline de streaming

---

## Batch processing vs Stream processing

```
┌───────────────────────────────────────────────────────────┐
│         BATCH vs STREAM PROCESSING                         │
│                                                           │
│  BATCH :                                                  │
│  ┌──────┐    ┌──────────┐    ┌──────┐                    │
│  │ Data │───►│ Job batch │───►│Result│                    │
│  │ fixe │    │ (minutes/ │    │      │                    │
│  └──────┘    │  heures)  │    └──────┘                    │
│              └──────────┘                                 │
│  Ex: MapReduce, Spark batch, ETL nocturne                 │
│                                                           │
│  STREAM :                                                 │
│  ──event──event──event──event──event──►                   │
│       │      │      │      │      │                       │
│       ▼      ▼      ▼      ▼      ▼                      │
│  ┌──────────────────────────────────┐                     │
│  │    Processeur de stream          │                     │
│  │    (latence : ms a secondes)     │                     │
│  └──────────────────────────────────┘                     │
│       │      │      │      │      │                       │
│       ▼      ▼      ▼      ▼      ▼                      │
│  Ex: Kafka Streams, Flink, real-time analytics            │
└───────────────────────────────────────────────────────────┘
```

| Critere | Batch | Stream |
|---------|-------|--------|
| **Latence** | Minutes a heures | Millisecondes a secondes |
| **Donnees** | Jeu fini (bounded) | Flux infini (unbounded) |
| **Traitement** | Complet, puis résultat | Continu, résultats incrementaux |
| **Rejeu** | Facile (relancer le job) | Possible si log persistant |
| **Complexite** | Plus simple | Gestion du temps, retards, état |
| **Cas d'usage** | Rapports, ETL, ML training | Monitoring, alertes, temps réel |

---

## Concepts de l'event streaming

### Architecture Kafka (conceptuelle)

```
┌─────────────────────────────────────────────────────────────┐
│              ARCHITECTURE KAFKA (conceptuelle)                │
│                                                             │
│  Producers                  Brokers              Consumers   │
│  ┌────────┐               ┌────────────┐       ┌─────────┐ │
│  │ Prod A │──────────────►│ Broker 1   │──────►│ Cons A  │ │
│  └────────┘               │ Topic:orders│      └─────────┘ │
│  ┌────────┐               │ ┌────┬────┐│       ┌─────────┐ │
│  │ Prod B │──────────────►│ │P0  │P1  ││──────►│ Cons B  │ │
│  └────────┘               │ └────┴────┘│       └─────────┘ │
│                           └────────────┘                    │
│                           ┌────────────┐       Consumer     │
│                           │ Broker 2   │       Group        │
│                           │ (replicas) │       ┌─────────┐  │
│                           │ ┌────┬────┐│       │ Group X │  │
│                           │ │P0' │P1' ││       │ Cons A  │  │
│                           │ └────┴────┘│       │ Cons B  │  │
│                           └────────────┘       └─────────┘  │
│                                                             │
│  Topic : canal nomme de messages                            │
│  Partition : sous-ensemble ordonne du topic                 │
│  Offset : position d'un message dans une partition          │
│  Consumer Group : partage les partitions entre consumers    │
└─────────────────────────────────────────────────────────────┘
```

### Concepts clés

- **Topic** : un flux nomme d'événements (ex: `orders`, `payments`, `user-events`)
- **Partition** : chaque topic est divise en partitions numerotees. L'ordre est garanti **au sein d'une partition**, pas entre partitions.
- **Offset** : position sequentielle d'un message dans une partition (0, 1, 2, ...)
- **Consumer Group** : un groupe de consommateurs qui se partagent les partitions. Chaque partition est lue par exactement un consommateur du groupe.
- **Replication Factor** : nombre de copies de chaque partition sur des brokers différents

:::tip Partition et ordre
L'ordre n'est garanti que dans une partition. Si vous avez besoin d'un ordre strict entre les commandes d'un même client, utilisez `clientId` comme clé de partitionnement.
:::

---

## Simulation d'un log partitionne

```typescript
// partitioned-log.ts — Simulation d'un log partitionne type Kafka

interface Event {
  key: string;
  value: string;
  timestamp: number;
  partition?: number;
  offset?: number;
}

class Partition {
  readonly id: number;
  private log: Event[] = [];

  constructor(id: number) {
    this.id = id;
  }

  append(event: Event): number {
    const offset = this.log.length;
    this.log.push({ ...event, partition: this.id, offset });
    return offset;
  }

  read(fromOffset: number, maxCount: number): Event[] {
    return this.log.slice(fromOffset, fromOffset + maxCount);
  }

  get size(): number {
    return this.log.length;
  }

  get latestOffset(): number {
    return this.log.length - 1;
  }
}

class Topic {
  readonly name: string;
  private partitions: Partition[];

  constructor(name: string, numPartitions: number) {
    this.name = name;
    this.partitions = Array.from(
      { length: numPartitions },
      (_, i) => new Partition(i),
    );
  }

  // Partitionnement par hachage de la cle
  private getPartition(key: string): Partition {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % this.partitions.length;
    return this.partitions[idx];
  }

  produce(event: Event): { partition: number; offset: number } {
    const partition = this.getPartition(event.key);
    const offset = partition.append(event);
    return { partition: partition.id, offset };
  }

  getPartitionById(id: number): Partition {
    return this.partitions[id];
  }

  get numPartitions(): number {
    return this.partitions.length;
  }
}

class ConsumerGroup {
  readonly groupId: string;
  private offsets: Map<number, number> = new Map(); // partition → committed offset
  private assignments: Map<string, number[]> = new Map(); // consumerId → partitions

  constructor(groupId: string) {
    this.groupId = groupId;
  }

  // Assigner les partitions aux consommateurs (round-robin simplifie)
  rebalance(consumerIds: string[], numPartitions: number): void {
    this.assignments.clear();
    for (const id of consumerIds) {
      this.assignments.set(id, []);
    }

    for (let p = 0; p < numPartitions; p++) {
      const consumer = consumerIds[p % consumerIds.length];
      this.assignments.get(consumer)!.push(p);
    }

    console.log(`[${this.groupId}] Rebalance:`);
    for (const [consumer, partitions] of this.assignments) {
      console.log(`  ${consumer} → partitions ${JSON.stringify(partitions)}`);
    }
  }

  getAssignment(consumerId: string): number[] {
    return this.assignments.get(consumerId) || [];
  }

  getCommittedOffset(partition: number): number {
    return this.offsets.get(partition) || 0;
  }

  commitOffset(partition: number, offset: number): void {
    this.offsets.set(partition, offset);
  }
}

// --- Simulation ---
function simulatePartitionedLog(): void {
  console.log('=== Simulation Log Partitionne ===\n');

  const topic = new Topic('orders', 3);

  // Produire des evenements
  const events: Event[] = [
    { key: 'user-1', value: 'order-created', timestamp: 1000 },
    { key: 'user-2', value: 'order-created', timestamp: 1001 },
    { key: 'user-1', value: 'payment-received', timestamp: 1002 },
    { key: 'user-3', value: 'order-created', timestamp: 1003 },
    { key: 'user-2', value: 'order-shipped', timestamp: 1004 },
    { key: 'user-1', value: 'order-delivered', timestamp: 1005 },
  ];

  console.log('--- Production ---');
  for (const event of events) {
    const result = topic.produce(event);
    console.log(
      `Produce: key="${event.key}" value="${event.value}" ` +
      `→ partition=${result.partition}, offset=${result.offset}`
    );
  }

  // Consumer group
  console.log('\n--- Consumer Group ---');
  const group = new ConsumerGroup('order-processors');
  group.rebalance(['consumer-A', 'consumer-B'], topic.numPartitions);

  // Chaque consumer lit ses partitions
  console.log('\n--- Consommation ---');
  for (const consumerId of ['consumer-A', 'consumer-B']) {
    const partitions = group.getAssignment(consumerId);
    for (const partId of partitions) {
      const partition = topic.getPartitionById(partId);
      const offset = group.getCommittedOffset(partId);
      const messages = partition.read(offset, 100);

      if (messages.length > 0) {
        console.log(`${consumerId} lit partition ${partId}:`);
        for (const msg of messages) {
          console.log(`  offset=${msg.offset} key="${msg.key}" value="${msg.value}"`);
        }
        group.commitOffset(partId, offset + messages.length);
      }
    }
  }
}

simulatePartitionedLog();
```

---

## Fenetrage (Windowing)

Le fenetrage permet d'agreger les événements d'un flux infini en groupes finis et temporels.

```
┌───────────────────────────────────────────────────────────┐
│                    TYPES DE FENETRES                       │
│                                                           │
│  TUMBLING (fixes, sans chevauchement) :                    │
│  |____W1____|____W2____|____W3____|                        │
│                                                           │
│  HOPPING (fixes, avec chevauchement) :                     │
│  |____W1____|                                              │
│       |____W2____|                                         │
│            |____W3____|                                    │
│                                                           │
│  SLIDING (declenche par chaque evenement) :                │
│  Fenetre = [event.time - size, event.time]                 │
│                                                           │
│  SESSION (basee sur l'inactivite) :                        │
│  |_e_e_e_|    gap    |_e__e_|  gap  |_e_e_e_e_|           │
│   session1           session2        session3              │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript des fenetres

```typescript
// windowing.ts — Implementation des types de fenetres

interface TimestampedEvent {
  timestamp: number;
  value: number;
  key?: string;
}

interface Window {
  start: number;
  end: number;
  events: TimestampedEvent[];
}

// Fenetre tumbling : intervalles fixes sans chevauchement
class TumblingWindow {
  private windows: Map<number, Window> = new Map();

  constructor(private sizeMs: number) {}

  add(event: TimestampedEvent): Window {
    const windowStart = Math.floor(event.timestamp / this.sizeMs) * this.sizeMs;
    const windowEnd = windowStart + this.sizeMs;

    if (!this.windows.has(windowStart)) {
      this.windows.set(windowStart, { start: windowStart, end: windowEnd, events: [] });
    }

    const window = this.windows.get(windowStart)!;
    window.events.push(event);
    return window;
  }

  getWindows(): Window[] {
    return [...this.windows.values()].sort((a, b) => a.start - b.start);
  }
}

// Fenetre hopping : intervalles fixes avec chevauchement
class HoppingWindow {
  private windows: Map<number, Window> = new Map();

  constructor(private sizeMs: number, private advanceMs: number) {}

  add(event: TimestampedEvent): Window[] {
    const affected: Window[] = [];
    // Trouver toutes les fenetres qui contiennent cet evenement
    const earliestStart =
      Math.floor((event.timestamp - this.sizeMs + this.advanceMs) / this.advanceMs) * this.advanceMs;

    for (let start = earliestStart; start <= event.timestamp; start += this.advanceMs) {
      const end = start + this.sizeMs;
      if (event.timestamp >= start && event.timestamp < end) {
        if (!this.windows.has(start)) {
          this.windows.set(start, { start, end, events: [] });
        }
        const window = this.windows.get(start)!;
        window.events.push(event);
        affected.push(window);
      }
    }
    return affected;
  }

  getWindows(): Window[] {
    return [...this.windows.values()].sort((a, b) => a.start - b.start);
  }
}

// Fenetre session : basee sur les gaps d'inactivite
class SessionWindow {
  private sessions: Window[] = [];

  constructor(private gapMs: number) {}

  add(event: TimestampedEvent): Window {
    // Chercher une session existante a etendre
    for (const session of this.sessions) {
      if (
        event.timestamp >= session.start - this.gapMs &&
        event.timestamp <= session.end + this.gapMs
      ) {
        session.events.push(event);
        session.start = Math.min(session.start, event.timestamp);
        session.end = Math.max(session.end, event.timestamp);
        // Fusionner les sessions qui se chevauchent maintenant
        this.mergeSessions();
        return session;
      }
    }

    // Creer une nouvelle session
    const newSession: Window = {
      start: event.timestamp,
      end: event.timestamp,
      events: [event],
    };
    this.sessions.push(newSession);
    return newSession;
  }

  private mergeSessions(): void {
    this.sessions.sort((a, b) => a.start - b.start);
    const merged: Window[] = [];

    for (const session of this.sessions) {
      if (merged.length === 0) {
        merged.push(session);
        continue;
      }
      const last = merged[merged.length - 1];
      if (session.start <= last.end + this.gapMs) {
        last.end = Math.max(last.end, session.end);
        last.events.push(...session.events);
      } else {
        merged.push(session);
      }
    }
    this.sessions = merged;
  }

  getSessions(): Window[] {
    return [...this.sessions];
  }
}

// --- Simulation ---
function simulateWindowing(): void {
  console.log('=== Simulation Fenetrage ===\n');

  const events: TimestampedEvent[] = [
    { timestamp: 100, value: 5 },
    { timestamp: 250, value: 3 },
    { timestamp: 400, value: 8 },
    { timestamp: 550, value: 2 },
    { timestamp: 800, value: 7 },
    { timestamp: 950, value: 1 },
    { timestamp: 1100, value: 4 },
    { timestamp: 1400, value: 6 },
  ];

  // Tumbling : fenetres de 500ms
  console.log('--- Tumbling Window (500ms) ---');
  const tumbling = new TumblingWindow(500);
  for (const e of events) tumbling.add(e);
  for (const w of tumbling.getWindows()) {
    const sum = w.events.reduce((s, e) => s + e.value, 0);
    console.log(
      `  [${w.start}-${w.end}) : ${w.events.length} events, sum=${sum}`
    );
  }

  // Hopping : taille 500ms, avance 250ms
  console.log('\n--- Hopping Window (500ms, hop 250ms) ---');
  const hopping = new HoppingWindow(500, 250);
  for (const e of events) hopping.add(e);
  for (const w of hopping.getWindows()) {
    const sum = w.events.reduce((s, e) => s + e.value, 0);
    console.log(
      `  [${w.start}-${w.end}) : ${w.events.length} events, sum=${sum}`
    );
  }

  // Session : gap de 200ms
  console.log('\n--- Session Window (gap 200ms) ---');
  const session = new SessionWindow(200);
  for (const e of events) session.add(e);
  for (const s of session.getSessions()) {
    const sum = s.events.reduce((acc, e) => acc + e.value, 0);
    console.log(
      `  [${s.start}-${s.end}] : ${s.events.length} events, sum=${sum}`
    );
  }
}

simulateWindowing();
```

---

## Dualite Stream-Table

:::tip Concept fondamental
Un **stream** est le changelog d'une table. Une **table** est la materialisation d'un stream. Ce concept, appele dualite stream-table, est au coeur de l'architecture event-driven.
:::

```
┌───────────────────────────────────────────────────────────┐
│             DUALITE STREAM-TABLE                           │
│                                                           │
│  STREAM (changelog) :                                      │
│  ┌──────────────────────────────────────────────┐         │
│  │ {user:1, name:"Alice"}                       │ t=1     │
│  │ {user:2, name:"Bob"}                         │ t=2     │
│  │ {user:1, name:"Alice Martin"} (update)       │ t=3     │
│  │ {user:3, name:"Charlie"}                     │ t=4     │
│  │ {user:2, name:null} (delete)                 │ t=5     │
│  └──────────────────────────────────────────────┘         │
│                                                           │
│                    │ materialiser                          │
│                    ▼                                       │
│                                                           │
│  TABLE (etat courant) :                                    │
│  ┌──────────────────────────────────┐                     │
│  │ user:1 → "Alice Martin"          │                     │
│  │ user:3 → "Charlie"               │                     │
│  └──────────────────────────────────┘                     │
│  (user:2 supprime)                                        │
│                                                           │
│  TABLE → STREAM : capturer chaque changement (CDC)        │
│  STREAM → TABLE : appliquer chaque evenement a un etat    │
└───────────────────────────────────────────────────────────┘
```

```typescript
// stream-table-duality.ts — Illustration de la dualite

interface ChangeEvent {
  key: string;
  value: string | null; // null = suppression
  timestamp: number;
}

class MaterializedTable {
  private state: Map<string, string> = new Map();
  private changelog: ChangeEvent[] = [];

  // Appliquer un stream pour materialiser la table
  applyEvent(event: ChangeEvent): void {
    this.changelog.push(event);

    if (event.value === null) {
      this.state.delete(event.key);
      console.log(`  [Table] DELETE key="${event.key}"`);
    } else {
      const existed = this.state.has(event.key);
      this.state.set(event.key, event.value);
      console.log(
        `  [Table] ${existed ? 'UPDATE' : 'INSERT'} key="${event.key}" → "${event.value}"`
      );
    }
  }

  // Obtenir l'etat courant
  getState(): Map<string, string> {
    return new Map(this.state);
  }

  // Reconstruire le stream depuis la table (snapshot + ongoing)
  toStream(): ChangeEvent[] {
    return [...this.changelog];
  }

  // Reconstruire la table a un point dans le temps
  stateAt(timestamp: number): Map<string, string> {
    const result = new Map<string, string>();
    for (const event of this.changelog) {
      if (event.timestamp > timestamp) break;
      if (event.value === null) {
        result.delete(event.key);
      } else {
        result.set(event.key, event.value);
      }
    }
    return result;
  }
}

// --- Simulation ---
function simulateStreamTable(): void {
  console.log('=== Simulation Dualite Stream-Table ===\n');

  const table = new MaterializedTable();

  const stream: ChangeEvent[] = [
    { key: 'user-1', value: 'Alice', timestamp: 1 },
    { key: 'user-2', value: 'Bob', timestamp: 2 },
    { key: 'user-1', value: 'Alice Martin', timestamp: 3 },
    { key: 'user-3', value: 'Charlie', timestamp: 4 },
    { key: 'user-2', value: null, timestamp: 5 },
  ];

  console.log('--- Application du stream ---');
  for (const event of stream) {
    table.applyEvent(event);
  }

  console.log('\n--- Etat courant de la table ---');
  for (const [key, value] of table.getState()) {
    console.log(`  ${key} → ${value}`);
  }

  console.log('\n--- Etat a t=2 (voyage dans le temps) ---');
  for (const [key, value] of table.stateAt(2)) {
    console.log(`  ${key} → ${value}`);
  }
}

simulateStreamTable();
```

---

## Exactly-once semantics

Obtenir une semantique exactly-once de bout en bout est un des defis majeurs du stream processing.

```
┌───────────────────────────────────────────────────────────┐
│         NIVEAUX DE GARANTIE DE LIVRAISON                   │
│                                                           │
│  AT-MOST-ONCE :  Envoyer et oublier. Perte possible.      │
│  ┌──┐    ┌──┐                                             │
│  │P │──X─│C │  Message perdu → pas de reessai              │
│  └──┘    └──┘                                             │
│                                                           │
│  AT-LEAST-ONCE : Reessayer jusqu'a l'ACK. Doublons.       │
│  ┌──┐    ┌──┐                                             │
│  │P │═══►│C │  ACK perdu → reessai → doublon               │
│  └──┘    └──┘                                             │
│                                                           │
│  EXACTLY-ONCE : Chaque message traite exactement une fois │
│  ┌──┐    ┌──┐                                             │
│  │P │═══►│C │  Idempotence + transactions + deduplication  │
│  └──┘    └──┘                                             │
└───────────────────────────────────────────────────────────┘
```

Les mécanismes pour atteindre exactly-once :

1. **Producteurs idempotents** : chaque message à un ID de sequence ; le broker deduplique
2. **Transactions** : lecture + traitement + écriture dans une transaction atomique
3. **Deduplication cote consommateur** : stocker les IDs traites et ignorer les doublons

:::warning Exactly-once en pratique
"Exactly-once" est souvent "effectively-once" : on utilise at-least-once + idempotence pour obtenir le même résultat qu'un traitement unique. Le vrai exactly-once de bout en bout nécessité que **tous** les composants (producteur, broker, consommateur, base de donnees) participent au protocole.
:::

---

## Event time vs Processing time

```
┌───────────────────────────────────────────────────────────┐
│        EVENT TIME vs PROCESSING TIME                       │
│                                                           │
│  Event time : quand l'evenement s'est reellement produit   │
│  Processing time : quand le systeme traite l'evenement     │
│                                                           │
│  Evenement :  se produit a t=100                           │
│  Reseau :     delai de 50ms                                │
│  Processing : traite a t=150                               │
│                                                           │
│  Probleme : les evenements arrivent en desordre !          │
│                                                           │
│  Event time :    100   102   105   103   101   108        │
│  Processing time: 150  155   160   165   170   175        │
│                                ▲                          │
│                         103 arrive apres 105               │
│                                                           │
│  Solution : WATERMARKS                                    │
│  "Tous les evenements avec event_time < W ont ete recus"   │
│  Tout evenement arrivant apres le watermark = late event   │
└───────────────────────────────────────────────────────────┘
```

### Simulation d'agregation feneetree avec watermarks

```typescript
// windowed-aggregation.ts — Agregation avec gestion du temps et des retards

interface StreamEvent {
  eventTime: number;
  processingTime: number;
  value: number;
  key: string;
}

interface WindowResult {
  windowStart: number;
  windowEnd: number;
  count: number;
  sum: number;
  isFinal: boolean;
}

class WindowedAggregator {
  private windows: Map<number, { events: StreamEvent[]; emitted: boolean }> = new Map();
  private watermark: number = 0;
  private results: WindowResult[] = [];

  constructor(
    private windowSizeMs: number,
    private allowedLatenessMs: number,
  ) {}

  // Mettre a jour le watermark
  advanceWatermark(newWatermark: number): void {
    this.watermark = newWatermark;
    console.log(`  Watermark avance a ${this.watermark}`);
    this.emitCompleteWindows();
  }

  // Traiter un evenement
  process(event: StreamEvent): void {
    const windowStart =
      Math.floor(event.eventTime / this.windowSizeMs) * this.windowSizeMs;
    const windowEnd = windowStart + this.windowSizeMs;

    // Verifier si l'evenement est trop en retard
    if (windowEnd + this.allowedLatenessMs < this.watermark) {
      console.log(
        `  DROPPED: event(eventTime=${event.eventTime}) est trop en retard ` +
        `(window [${windowStart}-${windowEnd}), watermark=${this.watermark})`
      );
      return;
    }

    if (!this.windows.has(windowStart)) {
      this.windows.set(windowStart, { events: [], emitted: false });
    }

    const window = this.windows.get(windowStart)!;
    window.events.push(event);

    const isLate = event.eventTime < this.watermark;
    console.log(
      `  Process: eventTime=${event.eventTime} → window [${windowStart}-${windowEnd})` +
      `${isLate ? ' (LATE EVENT - updated result)' : ''}`
    );
  }

  // Emettre les resultats des fenetres terminees
  private emitCompleteWindows(): void {
    for (const [windowStart, window] of this.windows) {
      const windowEnd = windowStart + this.windowSizeMs;

      if (windowEnd <= this.watermark && !window.emitted) {
        const result: WindowResult = {
          windowStart,
          windowEnd,
          count: window.events.length,
          sum: window.events.reduce((s, e) => s + e.value, 0),
          isFinal: true,
        };
        this.results.push(result);
        window.emitted = true;
        console.log(
          `  EMIT: window [${windowStart}-${windowEnd}) ` +
          `count=${result.count}, sum=${result.sum}`
        );
      }
    }
  }

  getResults(): WindowResult[] {
    return [...this.results];
  }
}

// --- Simulation ---
function simulateWindowedAggregation(): void {
  console.log('=== Simulation Agregation Feneetree ===\n');

  const aggregator = new WindowedAggregator(
    100,  // fenetres de 100ms
    50,   // tolerance au retard de 50ms
  );

  const events: StreamEvent[] = [
    { eventTime: 10, processingTime: 100, value: 5, key: 'a' },
    { eventTime: 50, processingTime: 110, value: 3, key: 'a' },
    { eventTime: 120, processingTime: 120, value: 8, key: 'a' },
    { eventTime: 80, processingTime: 130, value: 2, key: 'a' },  // En retard mais dans la fenetre
    { eventTime: 150, processingTime: 140, value: 7, key: 'a' },
    { eventTime: 250, processingTime: 150, value: 1, key: 'a' },
  ];

  for (const event of events) {
    console.log(`\n--- ProcessingTime=${event.processingTime} ---`);
    aggregator.process(event);
    // Watermark = min event time vu recemment (simplifie)
    aggregator.advanceWatermark(event.eventTime - 20);
  }

  // Avancer le watermark pour fermer les fenetres restantes
  console.log('\n--- Flush final ---');
  aggregator.advanceWatermark(300);

  console.log('\n--- Resultats finaux ---');
  for (const r of aggregator.getResults()) {
    console.log(
      `  Window [${r.windowStart}-${r.windowEnd}) : count=${r.count}, sum=${r.sum}`
    );
  }
}

simulateWindowedAggregation();
```

---

## Résumé

```
┌──────────────────────────────────────────────────────────┐
│       STREAM PROCESSING : CE QU'IL FAUT RETENIR           │
│                                                          │
│  1. Stream = flux infini d'evenements, traitement continu │
│  2. Partitions : unite de parallelisme et d'ordre         │
│  3. Consumer groups : repartition automatique             │
│  4. Fenetrage : tumbling, hopping, sliding, session       │
│  5. Stream-table duality : stream ↔ table                 │
│  6. Exactly-once = idempotence + transactions             │
│  7. Event time ≠ processing time → watermarks             │
│  8. Evenements en retard : tolerance configurable         │
└──────────────────────────────────────────────────────────┘
```

---

## Ressources complementaires

- [Designing Data-Intensive Applications, Ch. 11](https://dataintensive.net/) — Martin Kleppmann
- [Kafka: The Definitive Guide](https://www.confluent.io/resources/kafka-the-definitive-guide/) — Narkhede, Shapira, Palino
- [The Log: What every software engineer should know](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying) — Jay Kreps
- [Streaming Systems](https://www.oreilly.com/library/view/streaming-systems/9781491983874/) — Akidau, Chernyak, Lax

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [21 - Temps & Horloges](./21-temps-ordre-horloges.md) | [23 - CRDTs & Resolution de Conflits](./23-crdts-resolution-conflits.md) |

| Lab | Quiz |
|:---:|:----:|
| [Lab 22](../labs/lab-22-stream-processing/) | [Quiz 22](../quizzes/quiz-22-stream-processing.html) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 22 stream processing](../screencasts/screencast-22-stream-processing.md)
2. **Lab** : [lab-22-stream-processing](../labs/lab-22-stream-processing/README)
3. **Quiz** : [quiz 22 stream processing](../quizzes/quiz-22-stream-processing.html)
:::
