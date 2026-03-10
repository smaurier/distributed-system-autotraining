# Module 13 : CQRS & Event Sourcing

> **Difficulty** : 4/5 | **Duration estimee** : 4h | **Prerequis** : Modules 1-12

---

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

1. Expliquer le principe de CQRS et pourquoi separer lectures et ecritures
2. Implementer des Command Handlers et Query Handlers en TypeScript
3. Comprendre l'Event Sourcing et ses differences avec le stockage classique (CRUD)
4. Implementer un Event Store avec des evenements types
5. Construire des projections (read models) a partir d'evenements
6. Optimiser la reconstruction d'etat avec des snapshots
7. Effectuer des requetes temporelles (etat a un instant T)
8. Combiner CQRS et Event Sourcing dans une architecture complete

---

## 1. CQRS : Command Query Responsibility Segregation

CQRS est un pattern qui **separe** le modele d'ecriture (commandes) du modele de lecture (requetes). Chaque cote peut etre optimise independamment.

### 1.1 Le probleme du modele unique

```
  Architecture classique (CRUD) :

  Client
    |
    v
  +--------------------+
  | Service            |
  |  - create()        |  <-- Meme modele pour
  |  - read()          |      lecture et ecriture
  |  - update()        |
  |  - delete()        |
  +--------+-----------+
           |
           v
  +--------------------+
  |    Base de donnees  |
  |   (un seul schema)  |
  +--------------------+

  Probleme : les besoins de lecture (jointures, aggregations,
  recherche full-text) sont differents des besoins d'ecriture
  (validation, regles metier, coherence).
```

### 1.2 La separation CQRS

```
  Architecture CQRS :

  Client (write)              Client (read)
       |                           |
       v                           v
  +----------+              +----------+
  | Command  |              | Query    |
  | Handler  |              | Handler  |
  +----+-----+              +----+-----+
       |                         |
       v                         v
  +----------+              +----------+
  | Write    |  --- sync -->| Read     |
  | Model    |  (events)    | Model    |
  | (DB 1)   |              | (DB 2)   |
  +----------+              +----------+

  Les deux modeles peuvent utiliser des technologies differentes :
  - Write: PostgreSQL (ACID, normalise)
  - Read: Elasticsearch (denormalise, rapide en recherche)
```

:::tip
CQRS ne necessite pas obligatoirement deux bases de donnees differentes. On peut commencer avec une seule base et des modeles/tables differents pour les lectures et les ecritures. La separation physique vient ensuite si necessaire.
:::

---

## 2. Implementation CQRS en TypeScript

### 2.1 Commandes et Command Handlers

```typescript
// --- Commands ---
interface Command {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId: string;
}

interface CreateAccountCommand extends Command {
  type: 'CREATE_ACCOUNT';
  payload: {
    accountId: string;
    ownerName: string;
    initialBalance: number;
  };
}

interface DepositCommand extends Command {
  type: 'DEPOSIT';
  payload: {
    accountId: string;
    amount: number;
  };
}

interface WithdrawCommand extends Command {
  type: 'WITHDRAW';
  payload: {
    accountId: string;
    amount: number;
  };
}

type AccountCommand = CreateAccountCommand | DepositCommand | WithdrawCommand;

// --- Command Handler ---
interface CommandResult {
  success: boolean;
  error?: string;
  events: DomainEvent[];
}

type CommandHandler<C extends Command> = (command: C) => Promise<CommandResult>;

class CommandBus {
  private handlers: Map<string, CommandHandler<Command>> = new Map();

  register<C extends Command>(
    commandType: string,
    handler: CommandHandler<C>
  ): void {
    this.handlers.set(commandType, handler as CommandHandler<Command>);
  }

  async dispatch(command: Command): Promise<CommandResult> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      return {
        success: false,
        error: `No handler for command: ${command.type}`,
        events: [],
      };
    }
    return handler(command);
  }
}
```

### 2.2 Requetes et Query Handlers

```typescript
// --- Queries ---
interface Query {
  type: string;
  params: Record<string, unknown>;
}

interface GetAccountQuery extends Query {
  type: 'GET_ACCOUNT';
  params: { accountId: string };
}

interface GetAccountHistoryQuery extends Query {
  type: 'GET_ACCOUNT_HISTORY';
  params: { accountId: string; fromDate?: number; toDate?: number };
}

interface GetTopAccountsQuery extends Query {
  type: 'GET_TOP_ACCOUNTS';
  params: { limit: number };
}

type AccountQuery =
  | GetAccountQuery
  | GetAccountHistoryQuery
  | GetTopAccountsQuery;

// --- Query Handler ---
type QueryHandler<Q extends Query, R> = (query: Q) => Promise<R>;

class QueryBus {
  private handlers: Map<string, QueryHandler<Query, unknown>> = new Map();

  register<Q extends Query, R>(
    queryType: string,
    handler: QueryHandler<Q, R>
  ): void {
    this.handlers.set(queryType, handler as QueryHandler<Query, unknown>);
  }

  async dispatch<R>(query: Query): Promise<R> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No handler for query: ${query.type}`);
    }
    return handler(query) as Promise<R>;
  }
}
```

---

## 3. Event Sourcing : stocker les evenements, pas l'etat

### 3.1 CRUD vs Event Sourcing

```
  CRUD (stockage classique) :

  +----+---------+---------+
  | id | owner   | balance |
  +----+---------+---------+
  | 1  | Alice   | 750     |  <-- Seul l'etat actuel est stocke
  +----+---------+---------+      L'historique est perdu !

  Event Sourcing :

  +-----+------------------+--------+-----------+
  | seq | type             | amount | timestamp |
  +-----+------------------+--------+-----------+
  | 1   | ACCOUNT_CREATED  | 1000   | 10:00:00  |
  | 2   | WITHDRAWAL       | -200   | 10:15:00  |
  | 3   | DEPOSIT          | +50    | 11:00:00  |
  | 4   | WITHDRAWAL       | -100   | 14:30:00  |
  +-----+------------------+--------+-----------+
  Balance actuelle : 1000 - 200 + 50 - 100 = 750

  L'etat actuel est DERIVE des evenements.
  Tout l'historique est preserve.
```

:::warning
L'Event Sourcing change fondamentalement la facon dont on pense au stockage. Les evenements sont **immutables** : on ne modifie jamais, on ne supprime jamais un evenement. Pour "corriger" une erreur, on ajoute un evenement correctif.
:::

### 3.2 Les types d'evenements

```typescript
// --- Domain Events ---
interface DomainEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  version: number; // Sequence number within the aggregate
  metadata?: {
    correlationId?: string;
    causationId?: string;
    userId?: string;
  };
}

interface AccountCreatedEvent extends DomainEvent {
  type: 'ACCOUNT_CREATED';
  payload: {
    ownerName: string;
    initialBalance: number;
  };
}

interface MoneyDepositedEvent extends DomainEvent {
  type: 'MONEY_DEPOSITED';
  payload: {
    amount: number;
    description: string;
  };
}

interface MoneyWithdrawnEvent extends DomainEvent {
  type: 'MONEY_WITHDRAWN';
  payload: {
    amount: number;
    description: string;
  };
}

interface AccountClosedEvent extends DomainEvent {
  type: 'ACCOUNT_CLOSED';
  payload: {
    reason: string;
    finalBalance: number;
  };
}

type AccountEvent =
  | AccountCreatedEvent
  | MoneyDepositedEvent
  | MoneyWithdrawnEvent
  | AccountClosedEvent;
```

---

## 4. Implementation de l'Event Store

```typescript
class EventStore {
  // Append-only log of all events, indexed by aggregate ID
  private streams: Map<string, DomainEvent[]> = new Map();
  private globalLog: DomainEvent[] = [];
  private subscribers: Array<(event: DomainEvent) => void> = [];

  // Append events to a stream (with optimistic concurrency)
  append(
    aggregateId: string,
    events: DomainEvent[],
    expectedVersion: number
  ): void {
    const stream = this.streams.get(aggregateId) ?? [];
    const currentVersion = stream.length;

    // Optimistic concurrency check
    if (currentVersion !== expectedVersion) {
      throw new Error(
        `Concurrency conflict: expected version ${expectedVersion}, ` +
        `but current is ${currentVersion} for aggregate ${aggregateId}`
      );
    }

    // Assign version numbers and append
    for (let i = 0; i < events.length; i++) {
      const event = {
        ...events[i],
        version: currentVersion + i + 1,
        eventId:
          events[i].eventId ||
          `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      stream.push(event);
      this.globalLog.push(event);
      this.notifySubscribers(event);
    }

    this.streams.set(aggregateId, stream);
  }

  // Read all events for an aggregate
  getStream(aggregateId: string): DomainEvent[] {
    return [...(this.streams.get(aggregateId) ?? [])];
  }

  // Read events from a specific version
  getStreamFrom(aggregateId: string, fromVersion: number): DomainEvent[] {
    const stream = this.streams.get(aggregateId) ?? [];
    return stream.filter((e) => e.version >= fromVersion);
  }

  // Read the global log (all aggregates)
  getGlobalLog(fromPosition?: number): DomainEvent[] {
    if (fromPosition !== undefined) {
      return this.globalLog.slice(fromPosition);
    }
    return [...this.globalLog];
  }

  // Subscribe to new events (for projections)
  subscribe(handler: (event: DomainEvent) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      const index = this.subscribers.indexOf(handler);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  private notifySubscribers(event: DomainEvent): void {
    for (const handler of this.subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`Subscriber error: ${err}`);
      }
    }
  }

  // Get the current version of an aggregate
  getVersion(aggregateId: string): number {
    return this.streams.get(aggregateId)?.length ?? 0;
  }
}
```

---

## 5. Aggregate : reconstruction de l'etat depuis les evenements

```typescript
interface AccountState {
  accountId: string;
  ownerName: string;
  balance: number;
  status: 'ACTIVE' | 'CLOSED';
  createdAt: number;
  version: number;
}

class AccountAggregate {
  private state: AccountState | null = null;

  getState(): AccountState | null {
    return this.state ? { ...this.state } : null;
  }

  getVersion(): number {
    return this.state?.version ?? 0;
  }

  // Rebuild state from events (event replay)
  loadFromHistory(events: DomainEvent[]): void {
    this.state = null;
    for (const event of events) {
      this.apply(event);
    }
  }

  // Apply a single event to mutate state
  private apply(event: DomainEvent): void {
    switch (event.type) {
      case 'ACCOUNT_CREATED': {
        const payload = event.payload as {
          ownerName: string;
          initialBalance: number;
        };
        this.state = {
          accountId: event.aggregateId,
          ownerName: payload.ownerName,
          balance: payload.initialBalance,
          status: 'ACTIVE',
          createdAt: event.timestamp,
          version: event.version,
        };
        break;
      }
      case 'MONEY_DEPOSITED': {
        if (!this.state) throw new Error('Account not created');
        const { amount } = event.payload as { amount: number };
        this.state.balance += amount;
        this.state.version = event.version;
        break;
      }
      case 'MONEY_WITHDRAWN': {
        if (!this.state) throw new Error('Account not created');
        const { amount } = event.payload as { amount: number };
        this.state.balance -= amount;
        this.state.version = event.version;
        break;
      }
      case 'ACCOUNT_CLOSED': {
        if (!this.state) throw new Error('Account not created');
        this.state.status = 'CLOSED';
        this.state.version = event.version;
        break;
      }
    }
  }

  // --- Command methods that produce events ---
  create(
    accountId: string,
    ownerName: string,
    initialBalance: number
  ): DomainEvent[] {
    if (this.state) throw new Error('Account already exists');
    if (initialBalance < 0) throw new Error('Initial balance cannot be negative');

    const event: DomainEvent = {
      eventId: '',
      aggregateId: accountId,
      type: 'ACCOUNT_CREATED',
      payload: { ownerName, initialBalance },
      timestamp: Date.now(),
      version: 0,
    };

    this.apply(event);
    return [event];
  }

  deposit(amount: number, description: string): DomainEvent[] {
    if (!this.state) throw new Error('Account not found');
    if (this.state.status === 'CLOSED') throw new Error('Account is closed');
    if (amount <= 0) throw new Error('Deposit amount must be positive');

    const event: DomainEvent = {
      eventId: '',
      aggregateId: this.state.accountId,
      type: 'MONEY_DEPOSITED',
      payload: { amount, description },
      timestamp: Date.now(),
      version: 0,
    };

    this.apply(event);
    return [event];
  }

  withdraw(amount: number, description: string): DomainEvent[] {
    if (!this.state) throw new Error('Account not found');
    if (this.state.status === 'CLOSED') throw new Error('Account is closed');
    if (amount <= 0) throw new Error('Withdrawal amount must be positive');
    if (this.state.balance < amount) throw new Error('Insufficient funds');

    const event: DomainEvent = {
      eventId: '',
      aggregateId: this.state.accountId,
      type: 'MONEY_WITHDRAWN',
      payload: { amount, description },
      timestamp: Date.now(),
      version: 0,
    };

    this.apply(event);
    return [event];
  }
}
```

---

## 6. Projections : materialiser des modeles de lecture

Les projections transforment le flux d'evenements en **read models** optimises pour des requetes specifiques.

```
  Event Store                    Projections (Read Models)
  +-------------------+
  | ACCOUNT_CREATED   |--+-----> +-------------------+
  | MONEY_DEPOSITED   |  |      | Account Summary   |
  | MONEY_WITHDRAWN   |  |      | (balance, status) |
  | MONEY_DEPOSITED   |  |      +-------------------+
  | ACCOUNT_CLOSED    |  |
  +-------------------+  +-----> +-------------------+
                         |      | Transaction       |
                         |      | History (list)    |
                         |      +-------------------+
                         |
                         +-----> +-------------------+
                                | Monthly Report    |
                                | (aggregated stats)|
                                +-------------------+
```

```typescript
// --- Account Summary Projection ---
interface AccountSummaryView {
  accountId: string;
  ownerName: string;
  balance: number;
  status: 'ACTIVE' | 'CLOSED';
  transactionCount: number;
  lastUpdated: number;
}

class AccountSummaryProjection {
  private views: Map<string, AccountSummaryView> = new Map();

  // Process an event to update the projection
  handle(event: DomainEvent): void {
    switch (event.type) {
      case 'ACCOUNT_CREATED': {
        const payload = event.payload as {
          ownerName: string;
          initialBalance: number;
        };
        this.views.set(event.aggregateId, {
          accountId: event.aggregateId,
          ownerName: payload.ownerName,
          balance: payload.initialBalance,
          status: 'ACTIVE',
          transactionCount: 0,
          lastUpdated: event.timestamp,
        });
        break;
      }
      case 'MONEY_DEPOSITED': {
        const view = this.views.get(event.aggregateId);
        if (view) {
          const { amount } = event.payload as { amount: number };
          view.balance += amount;
          view.transactionCount++;
          view.lastUpdated = event.timestamp;
        }
        break;
      }
      case 'MONEY_WITHDRAWN': {
        const view = this.views.get(event.aggregateId);
        if (view) {
          const { amount } = event.payload as { amount: number };
          view.balance -= amount;
          view.transactionCount++;
          view.lastUpdated = event.timestamp;
        }
        break;
      }
      case 'ACCOUNT_CLOSED': {
        const view = this.views.get(event.aggregateId);
        if (view) {
          view.status = 'CLOSED';
          view.lastUpdated = event.timestamp;
        }
        break;
      }
    }
  }

  // Query methods on the read model
  getAccount(accountId: string): AccountSummaryView | undefined {
    return this.views.get(accountId);
  }

  getTopAccounts(limit: number): AccountSummaryView[] {
    return Array.from(this.views.values())
      .filter((v) => v.status === 'ACTIVE')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  getActiveAccountCount(): number {
    let count = 0;
    for (const view of this.views.values()) {
      if (view.status === 'ACTIVE') count++;
    }
    return count;
  }

  // Rebuild the entire projection from scratch
  rebuild(events: DomainEvent[]): void {
    this.views.clear();
    for (const event of events) {
      this.handle(event);
    }
  }
}

// --- Transaction History Projection ---
interface TransactionView {
  eventId: string;
  accountId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  description: string;
  balanceAfter: number;
  timestamp: number;
}

class TransactionHistoryProjection {
  private transactions: TransactionView[] = [];
  private runningBalances: Map<string, number> = new Map();

  handle(event: DomainEvent): void {
    if (event.type === 'ACCOUNT_CREATED') {
      const { initialBalance } = event.payload as { initialBalance: number };
      this.runningBalances.set(event.aggregateId, initialBalance);
      return;
    }

    if (
      event.type === 'MONEY_DEPOSITED' ||
      event.type === 'MONEY_WITHDRAWN'
    ) {
      const { amount, description } = event.payload as {
        amount: number;
        description: string;
      };
      const currentBalance =
        this.runningBalances.get(event.aggregateId) ?? 0;
      const newBalance =
        event.type === 'MONEY_DEPOSITED'
          ? currentBalance + amount
          : currentBalance - amount;

      this.runningBalances.set(event.aggregateId, newBalance);

      this.transactions.push({
        eventId: event.eventId,
        accountId: event.aggregateId,
        type: event.type === 'MONEY_DEPOSITED' ? 'DEPOSIT' : 'WITHDRAWAL',
        amount,
        description,
        balanceAfter: newBalance,
        timestamp: event.timestamp,
      });
    }
  }

  getHistory(
    accountId: string,
    fromDate?: number,
    toDate?: number
  ): TransactionView[] {
    return this.transactions.filter((t) => {
      if (t.accountId !== accountId) return false;
      if (fromDate && t.timestamp < fromDate) return false;
      if (toDate && t.timestamp > toDate) return false;
      return true;
    });
  }
}
```

---

## 7. Snapshots : optimiser la reconstruction

Quand un aggregate a des milliers d'evenements, reconstruire l'etat en rejouant tous les evenements est couteux. Les **snapshots** sauvegardent periodiquement l'etat pour accelerer la reconstruction.

```
  Sans snapshot : replay 10 000 evenements
  [E1] -> [E2] -> [E3] -> ... -> [E9999] -> [E10000] => Etat

  Avec snapshot tous les 1000 events :
  [Snapshot @ E9000] -> [E9001] -> ... -> [E10000] => Etat
  (seulement 1000 evenements a rejouer)
```

```typescript
interface Snapshot {
  aggregateId: string;
  state: AccountState;
  version: number; // Version at which the snapshot was taken
  timestamp: number;
}

class SnapshotStore {
  private snapshots: Map<string, Snapshot> = new Map();
  private readonly snapshotInterval: number;

  constructor(snapshotInterval: number = 100) {
    this.snapshotInterval = snapshotInterval;
  }

  save(aggregateId: string, state: AccountState, version: number): void {
    this.snapshots.set(aggregateId, {
      aggregateId,
      state: { ...state },
      version,
      timestamp: Date.now(),
    });
  }

  get(aggregateId: string): Snapshot | undefined {
    return this.snapshots.get(aggregateId);
  }

  shouldSnapshot(currentVersion: number, lastSnapshotVersion: number): boolean {
    return currentVersion - lastSnapshotVersion >= this.snapshotInterval;
  }
}

// --- Repository that uses snapshots ---
class AccountRepository {
  constructor(
    private eventStore: EventStore,
    private snapshotStore: SnapshotStore
  ) {}

  load(accountId: string): AccountAggregate {
    const aggregate = new AccountAggregate();
    const snapshot = this.snapshotStore.get(accountId);

    if (snapshot) {
      // Start from snapshot
      aggregate.loadFromHistory([
        // Synthetic event to restore snapshot state
        {
          eventId: 'snapshot',
          aggregateId: accountId,
          type: 'ACCOUNT_CREATED',
          payload: {
            ownerName: snapshot.state.ownerName,
            initialBalance: snapshot.state.balance,
          },
          timestamp: snapshot.state.createdAt,
          version: snapshot.version,
        },
      ]);

      // Replay only events AFTER the snapshot
      const newEvents = this.eventStore.getStreamFrom(
        accountId,
        snapshot.version + 1
      );
      if (newEvents.length > 0) {
        aggregate.loadFromHistory([
          ...this.eventStore
            .getStream(accountId)
            .slice(0, snapshot.version),
          ...newEvents,
        ]);
      }
    } else {
      // No snapshot: replay all events
      const events = this.eventStore.getStream(accountId);
      aggregate.loadFromHistory(events);
    }

    return aggregate;
  }

  save(aggregate: AccountAggregate, newEvents: DomainEvent[]): void {
    const state = aggregate.getState();
    if (!state) return;

    const currentVersion = this.eventStore.getVersion(state.accountId);
    this.eventStore.append(state.accountId, newEvents, currentVersion);

    // Check if we need a new snapshot
    const snapshot = this.snapshotStore.get(state.accountId);
    const lastSnapshotVersion = snapshot?.version ?? 0;

    if (
      this.snapshotStore.shouldSnapshot(
        aggregate.getVersion(),
        lastSnapshotVersion
      )
    ) {
      this.snapshotStore.save(
        state.accountId,
        state,
        aggregate.getVersion()
      );
    }
  }
}
```

---

## 8. Temporal Queries : voyager dans le temps

Un avantage majeur de l'Event Sourcing : on peut reconstruire l'etat a **n'importe quel moment** dans le passe.

```typescript
class TemporalQueryService {
  constructor(private eventStore: EventStore) {}

  // Get the state of an account at a specific point in time
  getStateAt(accountId: string, atTimestamp: number): AccountState | null {
    const allEvents = this.eventStore.getStream(accountId);

    // Filter events up to the specified timestamp
    const eventsUpToTime = allEvents.filter(
      (e) => e.timestamp <= atTimestamp
    );

    if (eventsUpToTime.length === 0) return null;

    // Rebuild state from filtered events
    const aggregate = new AccountAggregate();
    aggregate.loadFromHistory(eventsUpToTime);
    return aggregate.getState();
  }

  // Get the state of an account at a specific version
  getStateAtVersion(
    accountId: string,
    atVersion: number
  ): AccountState | null {
    const allEvents = this.eventStore.getStream(accountId);
    const eventsUpToVersion = allEvents.filter(
      (e) => e.version <= atVersion
    );

    if (eventsUpToVersion.length === 0) return null;

    const aggregate = new AccountAggregate();
    aggregate.loadFromHistory(eventsUpToVersion);
    return aggregate.getState();
  }

  // Compare state between two points in time
  compareStates(
    accountId: string,
    timestamp1: number,
    timestamp2: number
  ): {
    before: AccountState | null;
    after: AccountState | null;
    balanceDiff: number;
    eventsBetween: DomainEvent[];
  } {
    const before = this.getStateAt(accountId, timestamp1);
    const after = this.getStateAt(accountId, timestamp2);

    const allEvents = this.eventStore.getStream(accountId);
    const eventsBetween = allEvents.filter(
      (e) => e.timestamp > timestamp1 && e.timestamp <= timestamp2
    );

    return {
      before,
      after,
      balanceDiff: (after?.balance ?? 0) - (before?.balance ?? 0),
      eventsBetween,
    };
  }
}
```

---

## 9. CQRS + Event Sourcing ensemble

La combinaison naturelle : les **commandes** produisent des **evenements** stockes dans l'Event Store. Les **projections** consomment ces evenements pour construire des **read models** optimises pour les **requetes**.

```
  +----------+    +----------+    +----------+    +-----------+
  | Command  |--->| Aggregate|--->| Event    |--->| Projection|
  | (write)  |    | (domain  |    | Store    |    | (read     |
  |          |    |  logic)  |    | (append  |    |  model)   |
  +----------+    +----------+    |  only)   |    +-----------+
                                  +----------+          |
                                       |                v
                                       |          +-----------+
                                       +--------->| Query     |
                                                  | Handler   |
                                                  | (read)    |
                                                  +-----------+
```

```typescript
// --- Complete CQRS+ES Application ---
class BankingApplication {
  private eventStore: EventStore;
  private snapshotStore: SnapshotStore;
  private repository: AccountRepository;
  private summaryProjection: AccountSummaryProjection;
  private historyProjection: TransactionHistoryProjection;
  private commandBus: CommandBus;
  private queryBus: QueryBus;

  constructor() {
    this.eventStore = new EventStore();
    this.snapshotStore = new SnapshotStore(100);
    this.repository = new AccountRepository(
      this.eventStore,
      this.snapshotStore
    );

    this.summaryProjection = new AccountSummaryProjection();
    this.historyProjection = new TransactionHistoryProjection();

    // Subscribe projections to events
    this.eventStore.subscribe((event) => {
      this.summaryProjection.handle(event);
      this.historyProjection.handle(event);
    });

    this.commandBus = new CommandBus();
    this.queryBus = new QueryBus();
    this.registerHandlers();
  }

  private registerHandlers(): void {
    // Command handlers
    this.commandBus.register<CreateAccountCommand>(
      'CREATE_ACCOUNT',
      async (cmd) => {
        const aggregate = new AccountAggregate();
        const events = aggregate.create(
          cmd.payload.accountId,
          cmd.payload.ownerName,
          cmd.payload.initialBalance
        );
        this.repository.save(aggregate, events);
        return { success: true, events };
      }
    );

    this.commandBus.register<DepositCommand>('DEPOSIT', async (cmd) => {
      const aggregate = this.repository.load(cmd.payload.accountId);
      try {
        const events = aggregate.deposit(
          cmd.payload.amount,
          'Deposit'
        );
        this.repository.save(aggregate, events);
        return { success: true, events };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          events: [],
        };
      }
    });

    // Query handlers
    this.queryBus.register<GetAccountQuery, AccountSummaryView | undefined>(
      'GET_ACCOUNT',
      async (query) => {
        return this.summaryProjection.getAccount(query.params.accountId);
      }
    );

    this.queryBus.register<GetTopAccountsQuery, AccountSummaryView[]>(
      'GET_TOP_ACCOUNTS',
      async (query) => {
        return this.summaryProjection.getTopAccounts(query.params.limit);
      }
    );
  }

  // Public API
  async executeCommand(command: Command): Promise<CommandResult> {
    return this.commandBus.dispatch(command);
  }

  async executeQuery<R>(query: Query): Promise<R> {
    return this.queryBus.dispatch<R>(query);
  }
}
```

---

## 10. Quand utiliser (et ne PAS utiliser) CQRS/ES

```
  +-------------------------------+-------------------------------+
  | BON CANDIDAT                  | MAUVAIS CANDIDAT              |
  +-------------------------------+-------------------------------+
  | Domaine metier complexe       | CRUD simple (peu de logique)  |
  | Audit trail requis            | Donnees ephemeres             |
  | Requetes temporelles          | Schema qui change souvent     |
  | Read/Write asymetrique        | Equipe petite/inexperimentee  |
  | Scalabilite lecture ≠ ecriture| Prototype / MVP               |
  | Collaboration (multi-user)    | Latence de lecture critique   |
  +-------------------------------+-------------------------------+
```

:::warning
CQRS et Event Sourcing ajoutent de la **complexite significative**. Ne les utilisez pas "par defaut". Commencez simple (CRUD) et migrez vers CQRS/ES seulement quand les benefices justifient le cout. La complexite de gestion des projections, de la coherence eventuelle entre read et write models, et du schema evolution des evenements est reelle.
:::

:::tip
Vous pouvez adopter CQRS **sans** Event Sourcing (juste separer les modeles de lecture et d'ecriture). C'est souvent un bon premier pas avant d'introduire l'Event Sourcing si necessaire.
:::

---

## Recapitulatif

| Concept | Cle a retenir |
|---------|---------------|
| CQRS | Separer lectures et ecritures pour optimiser chaque cote |
| Event Sourcing | Stocker les evenements, pas l'etat — l'etat est derive |
| Event Store | Log append-only avec controle de concurrence optimiste |
| Projection | Read model materialise a partir du flux d'evenements |
| Snapshot | Sauvegarde periodique pour accelerer la reconstruction |
| Temporal Query | Reconstruire l'etat a n'importe quel instant dans le passe |
| CQRS + ES | Combinaison naturelle : commandes -> events -> projections |

---

## Liens

- [Lab 13 : Implementer un Event Store et des projections](../labs/lab-13-cqrs-event-sourcing/)
- [Quiz 13 : Testez vos connaissances](../quizzes/quiz-13-cqrs-event-sourcing.html)
- [Module suivant : Outbox Pattern](./14-outbox-pattern-reliable-messaging.md)
- [Module precedent : Saga Pattern](./12-transactions-distribuees-saga.md)
