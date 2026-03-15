# Module 14 : Outbox Pattern & Reliable Messaging

> **Difficulty** : 4/5 | **Duration estimee** : 3h30 | **Prerequis** : Modules 1-13

---

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

1. Identifier le probleme du dual write et ses consequences
2. Implementer le pattern Outbox pour des ecritures fiables
3. Comprendre le CDC (Change Data Capture) et son role dans le pattern Outbox
4. Implementer un polling publisher comme alternative simple au CDC
5. Implementer le pattern Inbox pour la deduplication cote consommateur
6. Concevoir des consumers idempotents
7. Combiner Outbox + Inbox pour une messagerie fiable de bout en bout

---

## 1. Le probleme du Dual Write

Dans une architecture microservices, un service doit souvent **ecrire dans sa base de donnees** ET **publier un message/evenement** sur un broker (Kafka, RabbitMQ, etc.). Ce sont deux systemes distincts : il n'y a pas de transaction distribuee entre eux.

```
  Le dual write problem :

  Service
    |
    |-- 1. Write to DB -----------> [Database]    OK
    |
    |-- 2. Publish to Broker -----> [Kafka]       ???
    |
  Si l'etape 2 echoue (crash, reseau), le message est PERDU.
  La DB est a jour, mais les autres services ne sont pas informes.

  Scenario inverse :
    |
    |-- 1. Publish to Broker -----> [Kafka]       OK
    |
    |-- 2. Write to DB -----------> [Database]    ???
    |
  Si l'etape 2 echoue, le message a ete publie mais la DB
  n'a pas ete mise a jour. Etat inconsistant.
```

:::warning
Le dual write est un probleme **fondamental**. Aucun retry, aucun try/catch ne le resout. Meme avec un try/catch autour des deux operations, un crash du processus entre les deux ecritures laisse le systeme dans un etat inconsistant. Il faut un pattern specifique.
:::

### 1.1 Les scenarios d'echec

```typescript
// Anti-pattern : dual write naif
class NaiveDualWrite {
  async createOrder(order: Order): Promise<void> {
    // Etape 1 : ecriture en base
    await this.database.save(order);

    // *** CRASH ICI => message jamais publie ***
    // *** NETWORK ERROR ICI => message jamais publie ***

    // Etape 2 : publication du message
    await this.messageBroker.publish('order.created', order);

    // *** Si le broker confirme mais la connexion se coupe ***
    // *** avant qu'on recive l'ACK, on re-publie en doublon ***
  }
}

interface Order {
  id: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  total: number;
  status: string;
  createdAt: number;
}
```

```
  Scenarios de perte et duplication :

  +-----------------------------+---------------------------+
  | Scenario                    | Consequence               |
  +-----------------------------+---------------------------+
  | DB OK, Broker FAIL          | Message perdu             |
  | Broker OK, DB FAIL          | Message fantome           |
  | DB OK, crash avant publish  | Message perdu             |
  | Les deux OK, ACK perdu      | Message duplique au retry |
  +-----------------------------+---------------------------+
```

---

## 2. Le pattern Outbox

L'idee : au lieu de publier directement sur le broker, ecrire le message dans une **table outbox** dans la meme base de donnees, dans la **meme transaction** que l'ecriture metier. Un processus separe lit la table outbox et publie les messages.

```
  Pattern Outbox :

  Service
    |
    |-- BEGIN TRANSACTION
    |     |-- 1. Write to orders table -----> [orders]
    |     |-- 2. Write to outbox table -----> [outbox]
    |-- COMMIT TRANSACTION
    |
    |  (Les deux ecritures sont atomiques !)
    |
    |                    +------------------+
    |                    | Outbox Publisher  |
    |                    | (polling or CDC) |
    |                    +--------+---------+
    |                             |
    |                             v
    |                         [Kafka/RabbitMQ]
    |                             |
    |                             v
    |                      [Other Services]
```

### 2.1 La table Outbox

```typescript
interface OutboxEntry {
  id: string;                // Unique message ID
  aggregateType: string;     // e.g., "Order", "Payment"
  aggregateId: string;       // e.g., "order-123"
  eventType: string;         // e.g., "OrderCreated"
  payload: string;           // JSON serialized event
  createdAt: number;         // Timestamp
  publishedAt: number | null; // null = not yet published
  retryCount: number;        // Number of publication attempts
}

// Simulated database with transaction support
class Database {
  private tables: Map<string, Map<string, Record<string, unknown>>> =
    new Map();
  private inTransaction: boolean = false;
  private transactionBuffer: Array<{
    table: string;
    id: string;
    data: Record<string, unknown>;
  }> = [];

  constructor() {
    this.tables.set('orders', new Map());
    this.tables.set('outbox', new Map());
  }

  beginTransaction(): void {
    this.inTransaction = true;
    this.transactionBuffer = [];
  }

  insert(table: string, id: string, data: Record<string, unknown>): void {
    if (this.inTransaction) {
      this.transactionBuffer.push({ table, id, data });
    } else {
      this.tables.get(table)?.set(id, data);
    }
  }

  commit(): void {
    // Atomic: all or nothing
    for (const op of this.transactionBuffer) {
      this.tables.get(op.table)?.set(op.id, op.data);
    }
    this.transactionBuffer = [];
    this.inTransaction = false;
  }

  rollback(): void {
    this.transactionBuffer = [];
    this.inTransaction = false;
  }

  query(
    table: string,
    predicate: (row: Record<string, unknown>) => boolean
  ): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const tableData = this.tables.get(table);
    if (tableData) {
      for (const row of tableData.values()) {
        if (predicate(row)) results.push(row);
      }
    }
    return results;
  }

  update(
    table: string,
    id: string,
    updates: Record<string, unknown>
  ): void {
    const tableData = this.tables.get(table);
    const row = tableData?.get(id);
    if (row) {
      Object.assign(row, updates);
    }
  }
}
```

### 2.2 Implementation du pattern Outbox

```typescript
class OrderServiceWithOutbox {
  constructor(private db: Database) {}

  async createOrder(order: Order): Promise<void> {
    const outboxEntry: OutboxEntry = {
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      aggregateType: 'Order',
      aggregateId: order.id,
      eventType: 'OrderCreated',
      payload: JSON.stringify({
        orderId: order.id,
        customerId: order.customerId,
        items: order.items,
        total: order.total,
      }),
      createdAt: Date.now(),
      publishedAt: null,
      retryCount: 0,
    };

    // Both writes in a SINGLE transaction
    this.db.beginTransaction();
    try {
      // Write the order
      this.db.insert('orders', order.id, {
        ...order,
        status: 'CREATED',
      });

      // Write the outbox entry
      this.db.insert('outbox', outboxEntry.id, { ...outboxEntry });

      // Atomic commit
      this.db.commit();
    } catch (error) {
      this.db.rollback();
      throw error;
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    const outboxEntry: OutboxEntry = {
      id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      aggregateType: 'Order',
      aggregateId: orderId,
      eventType: 'OrderCancelled',
      payload: JSON.stringify({ orderId, cancelledAt: Date.now() }),
      createdAt: Date.now(),
      publishedAt: null,
      retryCount: 0,
    };

    this.db.beginTransaction();
    try {
      this.db.update('orders', orderId, { status: 'CANCELLED' });
      this.db.insert('outbox', outboxEntry.id, { ...outboxEntry });
      this.db.commit();
    } catch (error) {
      this.db.rollback();
      throw error;
    }
  }
}
```

:::tip
La cle du pattern Outbox est que les deux ecritures (donnee metier + message outbox) sont dans la **meme transaction ACID**. Si la transaction echoue, les deux sont annulees. Si elle reussit, les deux sont persistees. Plus de dual write.
:::

---

## 3. Outbox Publisher : Polling

Le polling publisher lit periodiquement la table outbox et publie les messages non encore publies.

```
  Polling Publisher :

  +------------------+        +----------+        +---------+
  | Outbox Table     |        | Polling  |        | Message |
  |                  |<-------|Publisher |------->| Broker  |
  | id | published   |  poll  |          | publish|         |
  | 1  | null        |------->| Read     |------->| Publish |
  | 2  | null        |        | unpubl.  |        |         |
  | 3  | 2024-01-01  |        | entries  |        |         |
  +------------------+        +----------+        +---------+
                                   |
                                   v
                              Mark as published
```

```typescript
interface MessageBroker {
  publish(topic: string, message: { key: string; value: string }): Promise<void>;
}

class PollingOutboxPublisher {
  private running: boolean = false;
  private delay: number;
  private readonly minDelay: number;
  private readonly maxDelay: number;
  private batchSize: number;
  private publishedCount: number = 0;

  constructor(
    private db: Database,
    private broker: MessageBroker,
    options: { minDelayMs?: number; maxDelayMs?: number; batchSize?: number } = {}
  ) {
    this.minDelay = options.minDelayMs ?? 500;
    this.maxDelay = options.maxDelayMs ?? 30_000;
    this.delay = this.minDelay;
    this.batchSize = options.batchSize ?? 100;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(
      `[PollingPublisher] Started (initial delay: ${this.delay}ms)`
    );
    this.pollOutbox();
  }

  private async pollOutbox(): Promise<void> {
    if (!this.running) return;

    try {
      const published = await this.pollAndPublish();
      if (published > 0) {
        console.log(`[PollingPublisher] Published ${published} messages`);
        this.delay = this.minDelay; // reset on success
      } else {
        this.delay = Math.min(this.delay * 2, this.maxDelay); // backoff up to maxDelay
      }
    } catch (error) {
      console.error(`[PollingPublisher] Error: ${error}`);
      this.delay = Math.min(this.delay * 2, this.maxDelay);
    }

    setTimeout(() => this.pollOutbox(), this.delay);
  }

  stop(): void {
    this.running = false;
    console.log(
      `[PollingPublisher] Stopped (total published: ${this.publishedCount})`
    );
  }

  private async pollAndPublish(): Promise<number> {
    // Query unpublished entries, ordered by creation time
    const unpublished = this.db
      .query('outbox', (row) => row.publishedAt === null)
      .sort(
        (a, b) => (a.createdAt as number) - (b.createdAt as number)
      )
      .slice(0, this.batchSize);

    let count = 0;

    for (const entry of unpublished) {
      try {
        // Publish to broker
        const topic = `${(entry.aggregateType as string).toLowerCase()}.events`;
        await this.broker.publish(topic, {
          key: entry.aggregateId as string,
          value: JSON.stringify({
            eventId: entry.id,
            eventType: entry.eventType,
            aggregateType: entry.aggregateType,
            aggregateId: entry.aggregateId,
            payload: JSON.parse(entry.payload as string),
            timestamp: entry.createdAt,
          }),
        });

        // Mark as published
        this.db.update('outbox', entry.id as string, {
          publishedAt: Date.now(),
        });

        count++;
        this.publishedCount++;
      } catch (error) {
        // Increment retry count
        this.db.update('outbox', entry.id as string, {
          retryCount: ((entry.retryCount as number) ?? 0) + 1,
        });
        console.error(
          `[PollingPublisher] Failed to publish ${entry.id}: ${error}`
        );
      }
    }

    return count;
  }
}
```

> **Alternative : CDC (Change Data Capture)** — Plutot que de poll la table outbox, des outils comme Debezium lisent directement le WAL (Write-Ahead Log) de PostgreSQL et publient les evenements dans Kafka. Zero polling, latence sub-seconde, mais plus d'infrastructure a operer.

---

## 4. CDC (Change Data Capture)

Le CDC est une alternative au polling : au lieu de lire periodiquement la table, on **ecoute le journal de transactions** (WAL/binlog) de la base de donnees pour detecter les nouvelles ecritures dans la table outbox.

```
  CDC (ex: Debezium) :

  +------------------+        +----------+        +---------+
  | Database         |        | Debezium |        | Kafka   |
  |                  |        | (CDC)    |        |         |
  | Transaction Log  |------->| Read WAL |------->| Publish |
  | (WAL / binlog)   | stream | entries  | events |         |
  |                  |        |          |        |         |
  +------------------+        +----------+        +---------+

  Avantages par rapport au polling :
  - Temps reel (pas de delai de polling)
  - Pas de charge supplementaire sur la DB (pas de requetes)
  - Capture TOUTES les modifications (pas de risque de manquer)
```

```typescript
// Simulated CDC connector (inspired by Debezium)
interface WALEntry {
  lsn: number; // Log Sequence Number
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  timestamp: number;
}

class CDCConnector {
  private lastLSN: number = 0;
  private wal: WALEntry[] = [];
  private subscribers: Array<(entry: WALEntry) => Promise<void>> = [];

  // Simulate database writing to WAL
  appendToWAL(entry: Omit<WALEntry, 'lsn'>): void {
    const walEntry: WALEntry = {
      ...entry,
      lsn: ++this.lastLSN,
    };
    this.wal.push(walEntry);
    this.notifySubscribers(walEntry);
  }

  // Subscribe to WAL changes (filtered by table)
  onTableChange(
    tableName: string,
    handler: (entry: WALEntry) => Promise<void>
  ): void {
    this.subscribers.push(async (entry) => {
      if (entry.table === tableName) {
        await handler(entry);
      }
    });
  }

  private async notifySubscribers(entry: WALEntry): Promise<void> {
    for (const subscriber of this.subscribers) {
      try {
        await subscriber(entry);
      } catch (err) {
        console.error(`CDC subscriber error: ${err}`);
      }
    }
  }
}

class CDCOutboxPublisher {
  constructor(
    private cdc: CDCConnector,
    private broker: MessageBroker
  ) {
    // Listen for new outbox entries via CDC
    this.cdc.onTableChange('outbox', async (entry) => {
      if (entry.operation === 'INSERT' && entry.after) {
        const outboxEntry = entry.after as unknown as OutboxEntry;
        const topic = `${outboxEntry.aggregateType.toLowerCase()}.events`;

        await this.broker.publish(topic, {
          key: outboxEntry.aggregateId,
          value: JSON.stringify({
            eventId: outboxEntry.id,
            eventType: outboxEntry.eventType,
            aggregateType: outboxEntry.aggregateType,
            aggregateId: outboxEntry.aggregateId,
            payload: JSON.parse(outboxEntry.payload),
            timestamp: outboxEntry.createdAt,
          }),
        });

        console.log(
          `[CDC Publisher] Published ${outboxEntry.eventType} ` +
          `for ${outboxEntry.aggregateId}`
        );
      }
    });
  }
}
```

### 4.1 Polling vs CDC

```
  +--------------------+---------------------------+---------------------------+
  | Critere            | Polling                   | CDC                       |
  +--------------------+---------------------------+---------------------------+
  | Latence            | Intervalle de polling     | Quasi temps reel          |
  |                    | (ex: 1 seconde)           | (millisecondes)           |
  +--------------------+---------------------------+---------------------------+
  | Charge sur la DB   | Requetes periodiques      | Zero (lit le WAL)         |
  +--------------------+---------------------------+---------------------------+
  | Complexite         | Simple a implementer      | Necessite un outil        |
  |                    |                           | (Debezium, etc.)          |
  +--------------------+---------------------------+---------------------------+
  | Infrastructure     | Rien de supplementaire    | Debezium + Kafka Connect  |
  +--------------------+---------------------------+---------------------------+
  | Fiabilite          | Peut manquer des entries  | Capture tout via WAL      |
  |                    | en cas de race condition  |                           |
  +--------------------+---------------------------+---------------------------+
```

:::tip
Pour commencer, le **polling** est souvent suffisant et beaucoup plus simple a mettre en place. Migrez vers le **CDC** quand la latence du polling devient un probleme ou quand la charge des requetes de polling impacte la base de donnees.
:::

---

## 5. Le pattern Inbox

Le pattern Inbox est le complement cote **consommateur** du pattern Outbox. Il resout le probleme des **messages dupliques** (at-least-once delivery).

```
  Pourquoi des doublons ?
  - Le publisher re-publie un message apres un timeout (message deja recu)
  - Le broker re-delivre un message non acquitte
  - Le consumer crash apres traitement mais avant ACK

  Pattern Inbox :

  [Kafka] ---> Consumer ---> [Inbox Table] ---> Process if new
                                |
                                v
                          Deduplication par message ID

  Si le message ID existe deja dans l'inbox => ignorer (deja traite)
  Si le message ID est nouveau => traiter + inserer dans l'inbox
```

```typescript
interface InboxEntry {
  messageId: string;
  eventType: string;
  payload: string;
  processedAt: number;
  source: string;
}

class InboxStore {
  private entries: Map<string, InboxEntry> = new Map();

  has(messageId: string): boolean {
    return this.entries.has(messageId);
  }

  add(entry: InboxEntry): void {
    this.entries.set(entry.messageId, entry);
  }

  getEntry(messageId: string): InboxEntry | undefined {
    return this.entries.get(messageId);
  }

  // Cleanup old entries (retention policy)
  cleanup(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, entry] of this.entries) {
      if (entry.processedAt < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    return removed;
  }

  size(): number {
    return this.entries.size;
  }
}

class IdempotentConsumer {
  private inbox: InboxStore;
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.inbox = new InboxStore();
  }

  async handleMessage(message: {
    messageId: string;
    eventType: string;
    payload: string;
    source: string;
  }): Promise<{ processed: boolean; duplicate: boolean }> {
    // Step 1: Check inbox for duplicates
    if (this.inbox.has(message.messageId)) {
      console.log(
        `[Consumer] Duplicate message ${message.messageId} — skipping`
      );
      return { processed: false, duplicate: true };
    }

    // Step 2: Process the message in a transaction
    //         (business logic + inbox insert = same transaction)
    this.db.beginTransaction();
    try {
      // Business logic
      await this.processEvent(message.eventType, message.payload);

      // Record in inbox (deduplication)
      const inboxEntry: InboxEntry = {
        messageId: message.messageId,
        eventType: message.eventType,
        payload: message.payload,
        processedAt: Date.now(),
        source: message.source,
      };
      this.db.insert('inbox', message.messageId, { ...inboxEntry });

      this.db.commit();

      // Update in-memory inbox
      this.inbox.add(inboxEntry);

      console.log(
        `[Consumer] Processed message ${message.messageId} ` +
        `(${message.eventType})`
      );
      return { processed: true, duplicate: false };
    } catch (error) {
      this.db.rollback();
      console.error(
        `[Consumer] Error processing ${message.messageId}: ${error}`
      );
      throw error;
    }
  }

  private async processEvent(
    eventType: string,
    payload: string
  ): Promise<void> {
    const data = JSON.parse(payload);

    switch (eventType) {
      case 'OrderCreated':
        // Example: update inventory, create shipment, etc.
        console.log(`    Processing OrderCreated for order ${data.orderId}`);
        break;
      case 'OrderCancelled':
        console.log(
          `    Processing OrderCancelled for order ${data.orderId}`
        );
        break;
      default:
        console.log(`    Unknown event type: ${eventType}`);
    }
  }

  getInboxSize(): number {
    return this.inbox.size();
  }
}
```

---

## 6. Idempotent Consumers

Au-dela du pattern Inbox, certaines operations doivent etre **naturellement idempotentes** : les appliquer une ou plusieurs fois produit le meme resultat.

```
  Operations idempotentes :
  +---------------------------+----------------------------------+
  | Operation                 | Idempotente ?                    |
  +---------------------------+----------------------------------+
  | SET balance = 100         | OUI (meme resultat a chaque fois)|
  | INCREMENT balance += 50   | NON (chaque appel ajoute 50)     |
  | DELETE WHERE id = 123     | OUI (supprime ou no-op)          |
  | INSERT (si pas de check)  | NON (doublons possibles)         |
  | UPSERT (INSERT or UPDATE) | OUI (meme resultat)              |
  +---------------------------+----------------------------------+
```

```typescript
// Strategies for making operations idempotent
class IdempotencyStrategies {
  // Strategy 1: Idempotency Key
  // Store the result of an operation keyed by a unique request ID
  private resultCache: Map<string, { result: unknown; expiresAt: number }> =
    new Map();

  async withIdempotencyKey<T>(
    key: string,
    operation: () => Promise<T>,
    ttlMs: number = 24 * 60 * 60 * 1000
  ): Promise<T> {
    // Check if we already processed this key
    const cached = this.resultCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`  Idempotency cache hit for key: ${key}`);
      return cached.result as T;
    }

    // Execute the operation
    const result = await operation();

    // Cache the result
    this.resultCache.set(key, {
      result,
      expiresAt: Date.now() + ttlMs,
    });

    return result;
  }

  // Strategy 2: Conditional Update (version-based)
  async conditionalUpdate(
    db: Database,
    table: string,
    id: string,
    updates: Record<string, unknown>,
    expectedVersion: number
  ): Promise<boolean> {
    const rows = db.query(table, (row) => row.id === id);
    if (rows.length === 0) return false;

    const current = rows[0];
    if ((current.version as number) !== expectedVersion) {
      console.log(
        `  Version mismatch: expected ${expectedVersion}, ` +
        `got ${current.version} — skipping update`
      );
      return false; // Already updated by another message
    }

    db.update(table, id, {
      ...updates,
      version: expectedVersion + 1,
    });
    return true;
  }

  // Strategy 3: Natural Idempotency (use absolute values)
  setBalance(
    db: Database,
    accountId: string,
    newBalance: number
  ): void {
    // Idempotent: SET balance = X (not INCREMENT balance += Y)
    db.update('accounts', accountId, { balance: newBalance });
  }

  // Cleanup expired entries
  cleanupCache(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.resultCache) {
      if (entry.expiresAt <= now) {
        this.resultCache.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
```

:::warning
L'idempotence est une propriete **essentielle** dans les systemes distribues. Concevez toutes vos operations de consommation de messages pour etre idempotentes. Si une operation n'est pas naturellement idempotente (comme un increment), utilisez le pattern Inbox ou une cle d'idempotence pour la rendre idempotente.
:::

---

## 7. Outbox + Inbox : messagerie fiable de bout en bout

La combinaison des deux patterns garantit une messagerie **fiable** dans les deux sens.

```
  Architecture complete :

  Service A (Producer)                Service B (Consumer)
  +-------------------+               +-------------------+
  |                   |               |                   |
  | [Business Logic]  |               | [Business Logic]  |
  |       |           |               |       ^           |
  |       v           |               |       |           |
  | [DB + Outbox]     |               | [DB + Inbox]      |
  |   (1 transaction) |               |   (1 transaction) |
  |       |           |               |       ^           |
  +-------+-----------+               +-------+-----------+
          |                                   |
          v                                   |
  +-------+-----------+               +-------+-----------+
  | Outbox Publisher   |               | Idempotent        |
  | (Polling or CDC)   |               | Consumer          |
  +-------+------------+               +-------+-----------+
          |                                     ^
          v                                     |
  +-------+-------------------------------------+---------+
  |                    Message Broker                      |
  |                  (Kafka, RabbitMQ)                     |
  +-------------------------------------------------------+

  Garanties :
  - Pas de message perdu (outbox + transaction)
  - Pas de message duplique traite (inbox + idempotence)
  - Eventually consistent (convergence garantie)
```

```typescript
// Complete reliable messaging pipeline
class ReliableMessagingPipeline {
  private producerDb: Database;
  private consumerDb: Database;
  private orderService: OrderServiceWithOutbox;
  private outboxPublisher: PollingOutboxPublisher;
  private consumer: IdempotentConsumer;
  private messageQueue: Array<{
    topic: string;
    message: { key: string; value: string };
  }> = [];

  constructor() {
    this.producerDb = new Database();
    this.consumerDb = new Database();

    // Producer side
    this.orderService = new OrderServiceWithOutbox(this.producerDb);

    // Simulated broker
    const fakeBroker: MessageBroker = {
      publish: async (topic, message) => {
        this.messageQueue.push({ topic, message });
      },
    };

    this.outboxPublisher = new PollingOutboxPublisher(
      this.producerDb,
      fakeBroker,
      { pollIntervalMs: 100 }
    );

    // Consumer side
    this.consumer = new IdempotentConsumer(this.consumerDb);
  }

  async runDemo(): Promise<void> {
    console.log('=== Reliable Messaging Pipeline Demo ===\n');

    // 1. Create an order (writes to DB + outbox in one transaction)
    const order: Order = {
      id: 'order-001',
      customerId: 'cust-42',
      items: [{ productId: 'prod-1', quantity: 2, price: 29.99 }],
      total: 59.98,
      status: 'PENDING',
      createdAt: Date.now(),
    };

    console.log('1. Creating order (DB + Outbox in same transaction)...');
    await this.orderService.createOrder(order);
    console.log('   Order created successfully\n');

    // 2. Outbox publisher picks up the message
    console.log('2. Outbox publisher polling...');
    // Simulate one poll cycle
    await this.simulatePollCycle();
    console.log(`   Queue size: ${this.messageQueue.length}\n`);

    // 3. Consumer processes the message
    console.log('3. Consumer processing messages...');
    for (const queueEntry of this.messageQueue) {
      const parsed = JSON.parse(queueEntry.message.value);
      await this.consumer.handleMessage({
        messageId: parsed.eventId,
        eventType: parsed.eventType,
        payload: JSON.stringify(parsed.payload),
        source: queueEntry.topic,
      });
    }

    // 4. Simulate duplicate delivery
    console.log('\n4. Simulating duplicate delivery...');
    for (const queueEntry of this.messageQueue) {
      const parsed = JSON.parse(queueEntry.message.value);
      const result = await this.consumer.handleMessage({
        messageId: parsed.eventId,
        eventType: parsed.eventType,
        payload: JSON.stringify(parsed.payload),
        source: queueEntry.topic,
      });
      console.log(`   Duplicate detected: ${result.duplicate}`);
    }

    console.log('\n=== Pipeline demo complete ===');
  }

  private async simulatePollCycle(): Promise<void> {
    const unpublished = this.producerDb.query(
      'outbox',
      (row) => row.publishedAt === null
    );

    for (const entry of unpublished) {
      const topic = `${(entry.aggregateType as string).toLowerCase()}.events`;
      this.messageQueue.push({
        topic,
        message: {
          key: entry.aggregateId as string,
          value: JSON.stringify({
            eventId: entry.id,
            eventType: entry.eventType,
            aggregateType: entry.aggregateType,
            aggregateId: entry.aggregateId,
            payload: JSON.parse(entry.payload as string),
            timestamp: entry.createdAt,
          }),
        },
      });
      this.producerDb.update('outbox', entry.id as string, {
        publishedAt: Date.now(),
      });
    }
  }
}
```

---

## 8. Considerations de performance

```
  +---------------------------+-----------------------------------+
  | Concern                   | Solution                          |
  +---------------------------+-----------------------------------+
  | Outbox table grows        | Purge les entries publiees        |
  | indefinitely              | (retention policy, ex: 7 jours)  |
  +---------------------------+-----------------------------------+
  | Inbox table grows         | Purge les entries traitees        |
  | indefinitely              | (TTL, ex: 30 jours)              |
  +---------------------------+-----------------------------------+
  | Polling frequency         | Adaptive polling: augmenter quand |
  | vs latency                | il y a du trafic, reduire sinon  |
  +---------------------------+-----------------------------------+
  | Ordering guarantee        | Partitionner par aggregate ID    |
  |                           | dans Kafka                       |
  +---------------------------+-----------------------------------+
  | Outbox contention         | Une table outbox par aggregate   |
  | (many writers)            | type si necessaire               |
  +---------------------------+-----------------------------------+
```

```typescript
// Adaptive polling: adjusts interval based on activity
class AdaptivePollingPublisher {
  private minIntervalMs: number;
  private maxIntervalMs: number;
  private currentIntervalMs: number;
  private consecutiveEmpty: number = 0;

  constructor(
    private db: Database,
    private broker: MessageBroker,
    options: { minIntervalMs?: number; maxIntervalMs?: number } = {}
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 50;
    this.maxIntervalMs = options.maxIntervalMs ?? 5000;
    this.currentIntervalMs = this.minIntervalMs;
  }

  async pollOnce(): Promise<number> {
    const unpublished = this.db.query(
      'outbox',
      (row) => row.publishedAt === null
    );

    if (unpublished.length === 0) {
      // No messages: slow down polling (back off)
      this.consecutiveEmpty++;
      this.currentIntervalMs = Math.min(
        this.currentIntervalMs * 2,
        this.maxIntervalMs
      );
      return 0;
    }

    // Messages found: reset to fast polling
    this.consecutiveEmpty = 0;
    this.currentIntervalMs = this.minIntervalMs;

    let published = 0;
    for (const entry of unpublished) {
      try {
        const topic = `${(entry.aggregateType as string).toLowerCase()}.events`;
        await this.broker.publish(topic, {
          key: entry.aggregateId as string,
          value: entry.payload as string,
        });
        this.db.update('outbox', entry.id as string, {
          publishedAt: Date.now(),
        });
        published++;
      } catch {
        break; // Stop on first error, retry next cycle
      }
    }

    return published;
  }

  getCurrentInterval(): number {
    return this.currentIntervalMs;
  }
}

// Outbox table cleanup (retention policy)
class OutboxCleaner {
  constructor(
    private db: Database,
    private retentionMs: number = 7 * 24 * 60 * 60 * 1000 // 7 days
  ) {}

  cleanup(): number {
    const cutoff = Date.now() - this.retentionMs;
    const toDelete = this.db.query(
      'outbox',
      (row) =>
        row.publishedAt !== null &&
        (row.publishedAt as number) < cutoff
    );

    // In a real DB: DELETE FROM outbox WHERE published_at < cutoff
    console.log(
      `[Cleaner] ${toDelete.length} entries eligible for cleanup`
    );
    return toDelete.length;
  }
}
```

---

## Recapitulatif

| Concept | Cle a retenir |
|---------|---------------|
| Dual Write | Ecrire dans DB + broker n'est PAS atomique => inconsistance |
| Outbox Pattern | Ecrire le message dans la DB (meme transaction), publier ensuite |
| Polling Publisher | Simple, interroge periodiquement la table outbox |
| CDC | Temps reel via le WAL, zero charge sur la DB, plus complexe |
| Inbox Pattern | Deduplication cote consommateur via table inbox |
| Idempotent Consumer | Concevoir les operations pour etre naturellement idempotentes |
| Outbox + Inbox | Garantie de bout en bout : pas de perte, pas de doublon traite |

---

## Liens

- [Lab 14 : Implementer le pipeline Outbox + Inbox complet](../labs/lab-14-outbox-pattern/)
- [Quiz 14 : Testez vos connaissances](../quizzes/quiz-14-outbox-pattern.html)
- [Module suivant : Failure Modes](./15-failure-modes.md)
- [Module precedent : CQRS & Event Sourcing](./13-cqrs-event-sourcing.md)
