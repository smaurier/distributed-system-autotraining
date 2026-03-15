# Screencast 22 — Stream Processing & Event Streaming

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/22-stream-processing-event-streaming.md`
- **Lab associe** : Lab 22
- **Prérequis** : Screencast 21

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/22-stream-processing-event-streaming.md` ouvert
- [ ] Terminal supplementaire pour les demos
- [ ] Fichier `labs/lab-22-stream-processing/` pret

## Script

### [00:00-02:00] Introduction — Du batch au stream

> Jusqu'ici, on a traite les messages un par un. Le stream processing change de perspective : les donnees sont un flux continu et infini. Au lieu de traiter un batch de 10 000 enregistrements toutes les heures, on traite chaque événement en temps réel à mesure qu'il arrive. Kafka, Pulsar, et Kinesis sont batis sur cette idee.

**Action** : Ouvrir le module 22 et afficher le diagramme.

```
BATCH PROCESSING :                  STREAM PROCESSING :
┌─────────────────┐                ┌─────────────────┐
│  Collecte des   │                │  Flux continu   │
│  donnees        │                │  d'evenements   │
│  (1h de donnees)│                │  (temps reel)   │
└────────┬────────┘                └────────┬────────┘
         │ toutes les heures               │ en continu
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│  Traitement     │                │  Traitement     │
│  (MapReduce)    │                │  (fenetre 5s)   │
│  Duree: 30 min  │                │  Latence: ~100ms│
└─────────────────┘                └─────────────────┘

Latence : ~1h30                    Latence : ~100ms
```

### [02:00-06:00] Partitioned log — Le fondement du streaming

> Le partitioned log est la structure de donnees au coeur de Kafka. C'est un journal append-only divise en partitions, chacune avec son propre offset.

**Action** : Créer un fichier `stream-processing.ts`.

```typescript
interface StreamRecord {
  key: string;
  value: unknown;
  timestamp: number;
  offset: number;
  partition: number;
}

class PartitionedLog {
  private partitions: Map<number, StreamRecord[]> = new Map();
  private numPartitions: number;

  constructor(numPartitions: number = 3) {
    this.numPartitions = numPartitions;
    for (let i = 0; i < numPartitions; i++) {
      this.partitions.set(i, []);
    }
  }

  private getPartition(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % this.numPartitions;
  }

  append(key: string, value: unknown): StreamRecord {
    const partition = this.getPartition(key);
    const records = this.partitions.get(partition)!;
    const record: StreamRecord = {
      key,
      value,
      timestamp: Date.now(),
      offset: records.length,
      partition,
    };
    records.push(record);
    return record;
  }

  // Lire depuis un offset (le consommateur decide ou il en est)
  readFrom(partition: number, fromOffset: number, maxRecords: number = 10): StreamRecord[] {
    const records = this.partitions.get(partition) ?? [];
    return records.slice(fromOffset, fromOffset + maxRecords);
  }

  getPartitionCount(): number {
    return this.numPartitions;
  }

  getLatestOffset(partition: number): number {
    return (this.partitions.get(partition) ?? []).length;
  }
}

// Demo
const log = new PartitionedLog(3);

// Ecrire des evenements
for (let i = 0; i < 10; i++) {
  const userId = `user-${i % 4}`;
  const record = log.append(userId, { action: 'page_view', page: `/page-${i}` });
  console.log(`Appended: key=${userId}, partition=${record.partition}, offset=${record.offset}`);
}

// Lire une partition depuis le debut
console.log('\n=== Reading partition 0 ===');
const records = log.readFrom(0, 0);
for (const r of records) {
  console.log(`  offset=${r.offset}, key=${r.key}, value=${JSON.stringify(r.value)}`);
}
```

> Le partitioned log a deux propriétés clé : l'ordre est garanti au sein d'une partition (pas entre partitions), et les consommateurs controlent leur propre offset. Si un consommateur crashe, il reprend la ou il s'etait arrete. Pas de perte de message, pas de doublon (si idempotent).

### [06:00-10:00] Windowing — Agrreger dans le temps

> Le stream processing travaille avec des fenetres temporelles : agrreger les événements des 5 dernières minutes, compter les clics par seconde, calculer la moyenne mobile.

**Action** : Implementer trois types de fenetres.

```typescript
type WindowType = 'tumbling' | 'sliding' | 'session';

interface WindowedResult<T> {
  windowStart: number;
  windowEnd: number;
  key: string;
  value: T;
}

class TumblingWindow<T> {
  private windows: Map<string, { start: number; records: StreamRecord[] }> = new Map();

  constructor(private windowSizeMs: number) {}

  add(record: StreamRecord): void {
    const windowStart = Math.floor(record.timestamp / this.windowSizeMs) * this.windowSizeMs;
    const windowKey = `${record.key}:${windowStart}`;

    if (!this.windows.has(windowKey)) {
      this.windows.set(windowKey, { start: windowStart, records: [] });
    }
    this.windows.get(windowKey)!.records.push(record);
  }

  getResults(aggregator: (records: StreamRecord[]) => T): WindowedResult<T>[] {
    const results: WindowedResult<T>[] = [];
    for (const [windowKey, window] of this.windows) {
      const key = windowKey.split(':')[0];
      results.push({
        windowStart: window.start,
        windowEnd: window.start + this.windowSizeMs,
        key,
        value: aggregator(window.records),
      });
    }
    return results.sort((a, b) => a.windowStart - b.windowStart);
  }
}

class SlidingWindow {
  private records: StreamRecord[] = [];

  constructor(private windowSizeMs: number, private slideMs: number) {}

  add(record: StreamRecord): void {
    this.records.push(record);
  }

  getWindowAt(timestamp: number): StreamRecord[] {
    const start = timestamp - this.windowSizeMs;
    return this.records.filter(r => r.timestamp >= start && r.timestamp < timestamp);
  }
}

// Demo : compter les evenements par fenetre de 5 secondes
const tumbling = new TumblingWindow<number>(5000);
const baseTime = Date.now();

for (let i = 0; i < 20; i++) {
  tumbling.add({
    key: 'user-1',
    value: { action: 'click' },
    timestamp: baseTime + i * 1000, // 1 evenement par seconde
    offset: i,
    partition: 0,
  });
}

console.log('\n=== Tumbling Window (5s) ===');
const results = tumbling.getResults(records => records.length);
for (const r of results) {
  console.log(`  Window [${new Date(r.windowStart).toISOString().slice(11, 19)} - ${new Date(r.windowEnd).toISOString().slice(11, 19)}]: ${r.key} → ${r.value} events`);
}
```

> Trois types de fenetres. Tumbling : fenetres fixes qui ne se chevauchent pas (0-5s, 5-10s, 10-15s). Sliding : fenetres qui se chevauchent (0-5s, 1-6s, 2-7s). Session : fenetres basees sur l'activite de l'utilisateur (se ferment après un gap d'inactivite).

### [10:00-13:00] Stream-table duality

> Un stream et une table sont les deux faces d'une même piece. Un stream est un journal de changements. Une table est l'état actuel. On peut construire une table à partir d'un stream (materialiser), et un stream à partir d'une table (changelog).

**Action** : Implementer la dualite.

```typescript
class StreamTableDuality {
  // Stream → Table : materialiser le dernier etat par cle
  static materialize(records: StreamRecord[]): Map<string, unknown> {
    const table = new Map<string, unknown>();
    for (const record of records) {
      table.set(record.key, record.value);
    }
    return table;
  }

  // Table → Stream : generer un changelog
  static toChangelog(
    oldTable: Map<string, unknown>,
    newTable: Map<string, unknown>
  ): { key: string; oldValue: unknown; newValue: unknown }[] {
    const changes: { key: string; oldValue: unknown; newValue: unknown }[] = [];

    for (const [key, newValue] of newTable) {
      const oldValue = oldTable.get(key);
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({ key, oldValue, newValue });
      }
    }

    // Deletions
    for (const [key, oldValue] of oldTable) {
      if (!newTable.has(key)) {
        changes.push({ key, oldValue, newValue: null });
      }
    }

    return changes;
  }
}

// Demo
const stream: StreamRecord[] = [
  { key: 'user-1', value: { name: 'Alice' }, timestamp: 1, offset: 0, partition: 0 },
  { key: 'user-2', value: { name: 'Bob' }, timestamp: 2, offset: 1, partition: 0 },
  { key: 'user-1', value: { name: 'Alice Dupont' }, timestamp: 3, offset: 2, partition: 0 },
];

const table = StreamTableDuality.materialize(stream);
console.log('\n=== Stream → Table ===');
for (const [key, value] of table) {
  console.log(`  ${key}: ${JSON.stringify(value)}`);
}
// user-1: {name: "Alice Dupont"} (derniere valeur)
// user-2: {name: "Bob"}
```

> C'est le principe de Kafka Streams et ksqlDB : chaque table est une vue materialisee d'un stream. Si le stream est `order.events`, la table materialisee contient l'état actuel de chaque commande. L'avantage : on peut reconstruire la table en rejouant le stream depuis le debut.

### [13:00-16:00] Exactly-once semantics

> Le saint graal du stream processing : traiter chaque événement exactement une fois. En pratique, c'est très difficile. Kafka propose une semantique "exactly-once" via les transactions producer-consumer.

**Action** : Montrer le problème et la solution.

```typescript
class ExactlyOnceProcessor {
  private processedOffsets: Map<number, number> = new Map(); // partition → last offset
  private outputLog: PartitionedLog;
  private stateStore: Map<string, unknown> = new Map();

  constructor(outputLog: PartitionedLog) {
    this.outputLog = outputLog;
  }

  async processRecord(record: StreamRecord): Promise<void> {
    const lastOffset = this.processedOffsets.get(record.partition) ?? -1;

    // Deduplication : ignorer les records deja traites
    if (record.offset <= lastOffset) {
      console.log(`  [EOS] Skipping duplicate: partition=${record.partition}, offset=${record.offset}`);
      return;
    }

    // Traitement atomique : state + output + offset dans une transaction
    try {
      // 1. Mettre a jour l'etat local
      const currentCount = (this.stateStore.get(record.key) as number) ?? 0;
      this.stateStore.set(record.key, currentCount + 1);

      // 2. Produire dans le log de sortie
      this.outputLog.append(record.key, {
        count: currentCount + 1,
        lastEvent: record.value,
      });

      // 3. Commiter l'offset (dans la meme transaction)
      this.processedOffsets.set(record.partition, record.offset);

      console.log(`  [EOS] Processed: key=${record.key}, offset=${record.offset}, count=${currentCount + 1}`);
    } catch (err) {
      // En cas d'erreur, rien n'est commite → le record sera re-traite
      console.error(`  [EOS] Failed, will retry: ${err}`);
    }
  }

  getState(): Map<string, unknown> {
    return new Map(this.stateStore);
  }
}

// Demo
const inputLog = new PartitionedLog(1);
const outputLog = new PartitionedLog(1);
const processor = new ExactlyOnceProcessor(outputLog);

// Simuler des evenements
for (let i = 0; i < 5; i++) {
  inputLog.append('user-1', { action: 'click', page: i });
}

console.log('\n=== Exactly-Once Processing ===');
const records = inputLog.readFrom(0, 0, 10);
for (const record of records) {
  await processor.processRecord(record);
}

// Re-traiter (simule un crash + replay) — les doublons sont ignores
console.log('\n=== Re-processing after crash ===');
for (const record of records) {
  await processor.processRecord(record);
}

console.log('\nFinal state:', Object.fromEntries(processor.getState()));
```

> La clé : l'update de l'état, la production du message de sortie, et le commit de l'offset sont dans une seule transaction atomique. Si le processus crashe avant le commit, tout est annule et le record est re-traite. Si le commit reussit, le record ne sera jamais re-traite.

### [16:00-17:30] Récapitulatif

> Recapitulons. Le partitioned log est la fondation du streaming : append-only, ordonne par partition, offset controle par le consommateur. Le windowing agrege les événements dans le temps. La stream-table duality permet de passer d'un flux à un état et inversement. Et l'exactly-once semantics garantit un traitement correct même en cas de crash.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Partitioned log = append-only, ordre par partition, offset consommateur
2. Windowing = tumbling (fixes), sliding (chevauchement), session (activite)
3. Stream-table duality = un stream materialise est une table, un changelog est un stream
4. Exactly-once = state + output + offset dans une seule transaction
5. Le consommateur controle son offset → replay, rewind, fast-forward

PROCHAINE ETAPE :
→ Screencast 23 : CRDTs — Resolution de conflits sans coordination
```

> Au prochain screencast, on va découvrir les CRDTs — des structures de donnees qui convergent automatiquement sans coordination entre les noeuds. C'est la solution elegante aux conflits en eventual consistency. A bientot !

## Points d'attention pour l'enregistrement
- Le diagramme batch vs stream doit etre très clair en introduction
- Le partitioned log est le concept fondamental — bien expliquer l'offset et la partition key
- Les trois types de fenetres doivent etre illustres avec des exemples concrets
- La stream-table duality est un "aha moment" — prendre le temps
- L'exactly-once est subtil — bien insister sur la transaction atomique (state + output + offset)
- Mentionner Kafka, Pulsar, Kinesis comme systèmes réels qui implementent ces concepts
