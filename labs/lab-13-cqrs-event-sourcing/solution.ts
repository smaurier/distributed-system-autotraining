// =============================================================================
// Lab 13 — CQRS & Event Sourcing (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 13 — CQRS & Event Sourcing');

// =============================================================================
// Types communs
// =============================================================================

interface DomainEvent {
  id: string;
  streamId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  version: number;
}

// =============================================================================
// Exercice 1 : Event Store
// =============================================================================

interface EventStore {
  append(streamId: string, events: Omit<DomainEvent, 'id' | 'version' | 'timestamp'>[]): DomainEvent[];
  getEvents(streamId: string): DomainEvent[];
  getAllEvents(): DomainEvent[];
}

function createEventStore(): EventStore {
  const streams = new Map<string, DomainEvent[]>();
  let globalCounter = 0;

  return {
    append(streamId, events) {
      if (!streams.has(streamId)) {
        streams.set(streamId, []);
      }
      const stream = streams.get(streamId)!;
      const currentVersion = stream.length;
      const appended: DomainEvent[] = events.map((evt, i) => ({
        ...evt,
        id: `evt-${++globalCounter}`,
        version: currentVersion + i + 1,
        timestamp: Date.now(),
      }));
      stream.push(...appended);
      return appended;
    },
    getEvents(streamId) {
      return streams.get(streamId) || [];
    },
    getAllEvents() {
      const all: DomainEvent[] = [];
      for (const events of streams.values()) {
        all.push(...events);
      }
      return all;
    },
  };
}

// =============================================================================
// Exercice 2 : Aggregate from events
// =============================================================================

interface BankAccountState {
  id: string;
  owner: string;
  balance: number;
  isOpen: boolean;
  version: number;
}

function replayBankAccount(events: DomainEvent[]): BankAccountState {
  const initial: BankAccountState = { id: '', owner: '', balance: 0, isOpen: false, version: 0 };

  return events.reduce((state, event) => {
    switch (event.type) {
      case 'AccountOpened':
        return {
          ...state,
          id: event.streamId,
          owner: event.data.owner as string,
          balance: event.data.initialBalance as number,
          isOpen: true,
          version: event.version,
        };
      case 'MoneyDeposited':
        return {
          ...state,
          balance: state.balance + (event.data.amount as number),
          version: event.version,
        };
      case 'MoneyWithdrawn':
        return {
          ...state,
          balance: state.balance - (event.data.amount as number),
          version: event.version,
        };
      case 'AccountClosed':
        return {
          ...state,
          isOpen: false,
          version: event.version,
        };
      default:
        return { ...state, version: event.version };
    }
  }, initial);
}

// =============================================================================
// Exercice 3 : Command Handler
// =============================================================================

interface Command {
  type: string;
  streamId: string;
  data: Record<string, unknown>;
}

function handleCommand(
  command: Command,
  currentEvents: DomainEvent[]
): Omit<DomainEvent, 'id' | 'version' | 'timestamp'>[] {
  const state = replayBankAccount(currentEvents);

  switch (command.type) {
    case 'OpenAccount': {
      if (currentEvents.length > 0) {
        throw new Error('Account already exists');
      }
      return [{
        streamId: command.streamId,
        type: 'AccountOpened',
        data: { owner: command.data.owner, initialBalance: command.data.initialBalance },
      }];
    }
    case 'Deposit': {
      if (!state.isOpen) throw new Error('Account is not open');
      const amount = command.data.amount as number;
      if (amount <= 0) throw new Error('Amount must be positive');
      return [{
        streamId: command.streamId,
        type: 'MoneyDeposited',
        data: { amount },
      }];
    }
    case 'Withdraw': {
      if (!state.isOpen) throw new Error('Account is not open');
      const amount = command.data.amount as number;
      if (amount <= 0) throw new Error('Amount must be positive');
      if (amount > state.balance) throw new Error('Insufficient balance');
      return [{
        streamId: command.streamId,
        type: 'MoneyWithdrawn',
        data: { amount },
      }];
    }
    case 'CloseAccount': {
      if (!state.isOpen) throw new Error('Account is not open');
      return [{
        streamId: command.streamId,
        type: 'AccountClosed',
        data: {},
      }];
    }
    default:
      throw new Error(`Unknown command type: ${command.type}`);
  }
}

// =============================================================================
// Exercice 4 : Projection
// =============================================================================

interface AccountSummary {
  id: string;
  owner: string;
  balance: number;
  isOpen: boolean;
}

interface AccountProjection {
  apply(event: DomainEvent): void;
  getAccount(id: string): AccountSummary | undefined;
  getAllAccounts(): AccountSummary[];
  getOpenAccounts(): AccountSummary[];
  getTotalBalance(): number;
}

function createAccountProjection(): AccountProjection {
  const accounts = new Map<string, AccountSummary>();

  return {
    apply(event: DomainEvent) {
      switch (event.type) {
        case 'AccountOpened': {
          accounts.set(event.streamId, {
            id: event.streamId,
            owner: event.data.owner as string,
            balance: event.data.initialBalance as number,
            isOpen: true,
          });
          break;
        }
        case 'MoneyDeposited': {
          const acc = accounts.get(event.streamId);
          if (acc) acc.balance += event.data.amount as number;
          break;
        }
        case 'MoneyWithdrawn': {
          const acc = accounts.get(event.streamId);
          if (acc) acc.balance -= event.data.amount as number;
          break;
        }
        case 'AccountClosed': {
          const acc = accounts.get(event.streamId);
          if (acc) acc.isOpen = false;
          break;
        }
      }
    },
    getAccount(id: string) {
      return accounts.get(id);
    },
    getAllAccounts() {
      return Array.from(accounts.values());
    },
    getOpenAccounts() {
      return Array.from(accounts.values()).filter(a => a.isOpen);
    },
    getTotalBalance() {
      let total = 0;
      for (const acc of accounts.values()) {
        total += acc.balance;
      }
      return total;
    },
  };
}

// =============================================================================
// Exercice 5 : Snapshot
// =============================================================================

interface Snapshot<T> {
  streamId: string;
  state: T;
  version: number;
  timestamp: number;
}

interface SnapshotStore<T> {
  save(streamId: string, state: T, version: number): void;
  load(streamId: string): Snapshot<T> | undefined;
}

function createSnapshotStore<T>(): SnapshotStore<T> {
  const snapshots = new Map<string, Snapshot<T>>();

  return {
    save(streamId, state, version) {
      snapshots.set(streamId, {
        streamId,
        state: JSON.parse(JSON.stringify(state)),
        version,
        timestamp: Date.now(),
      });
    },
    load(streamId) {
      return snapshots.get(streamId);
    },
  };
}

function loadBankAccountWithSnapshot(
  events: DomainEvent[],
  snapshotStore: SnapshotStore<BankAccountState>,
  streamId: string
): { state: BankAccountState; eventsReplayed: number } {
  const snapshot = snapshotStore.load(streamId);

  if (snapshot) {
    const remainingEvents = events.filter(e => e.version > snapshot.version);
    const state = remainingEvents.reduce((s, event) => {
      switch (event.type) {
        case 'MoneyDeposited':
          return { ...s, balance: s.balance + (event.data.amount as number), version: event.version };
        case 'MoneyWithdrawn':
          return { ...s, balance: s.balance - (event.data.amount as number), version: event.version };
        case 'AccountClosed':
          return { ...s, isOpen: false, version: event.version };
        default:
          return { ...s, version: event.version };
      }
    }, { ...snapshot.state });

    return { state, eventsReplayed: remainingEvents.length };
  }

  const state = replayBankAccount(events);
  return { state, eventsReplayed: events.length };
}

// =============================================================================
// Exercice 6 : Temporal Query
// =============================================================================

function getStateAtVersion(events: DomainEvent[], version: number): BankAccountState {
  const filtered = events.filter(e => e.version <= version);
  return replayBankAccount(filtered);
}

function getStateAtTimestamp(events: DomainEvent[], timestamp: number): BankAccountState {
  const filtered = events.filter(e => e.timestamp <= timestamp);
  return replayBankAccount(filtered);
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 13 — CQRS & Event Sourcing\n');

  // --- Exercice 1 : Event Store ---
  await test('Ex1: append ajoute des evenements au stream', () => {
    const store = createEventStore();
    const appended = store.append('account-1', [
      { streamId: 'account-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 } },
    ]);
    assertEqual(appended.length, 1);
    assertEqual(appended[0].version, 1);
    assertEqual(appended[0].streamId, 'account-1');
    assert(appended[0].id.length > 0, 'Should have an id');
    assert(appended[0].timestamp > 0, 'Should have a timestamp');
  });

  await test('Ex1: getEvents retourne les evenements du stream', () => {
    const store = createEventStore();
    store.append('account-1', [
      { streamId: 'account-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 } },
    ]);
    store.append('account-1', [
      { streamId: 'account-1', type: 'MoneyDeposited', data: { amount: 50 } },
    ]);
    store.append('account-2', [
      { streamId: 'account-2', type: 'AccountOpened', data: { owner: 'Bob', initialBalance: 200 } },
    ]);
    const events = store.getEvents('account-1');
    assertEqual(events.length, 2);
    assertEqual(events[0].version, 1);
    assertEqual(events[1].version, 2);
    assertEqual(store.getAllEvents().length, 3);
  });

  // --- Exercice 2 : Aggregate from events ---
  await test('Ex2: replayBankAccount reconstruit l etat correctement', () => {
    const events: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 2000, version: 2 },
      { id: 'e3', streamId: 'acc-1', type: 'MoneyWithdrawn', data: { amount: 30 }, timestamp: 3000, version: 3 },
    ];
    const state = replayBankAccount(events);
    assertEqual(state.owner, 'Alice');
    assertEqual(state.balance, 120);
    assertEqual(state.isOpen, true);
    assertEqual(state.version, 3);
  });

  await test('Ex2: replayBankAccount gere la fermeture de compte', () => {
    const events: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-2', type: 'AccountOpened', data: { owner: 'Bob', initialBalance: 50 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-2', type: 'AccountClosed', data: {}, timestamp: 2000, version: 2 },
    ];
    const state = replayBankAccount(events);
    assertEqual(state.owner, 'Bob');
    assertEqual(state.balance, 50);
    assertEqual(state.isOpen, false);
  });

  // --- Exercice 3 : Command Handler ---
  await test('Ex3: handleCommand produit un evenement AccountOpened', () => {
    const events = handleCommand(
      { type: 'OpenAccount', streamId: 'acc-1', data: { owner: 'Alice', initialBalance: 100 } },
      []
    );
    assertEqual(events.length, 1);
    assertEqual(events[0].type, 'AccountOpened');
    assertEqual(events[0].data.owner, 'Alice');
  });

  await test('Ex3: handleCommand valide les commandes', () => {
    const existingEvents: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
    ];
    // Cannot withdraw more than balance
    try {
      handleCommand({ type: 'Withdraw', streamId: 'acc-1', data: { amount: 200 } }, existingEvents);
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.includes('Insufficient'), 'Should mention insufficient funds');
    }
    // Cannot open already opened account
    try {
      handleCommand({ type: 'OpenAccount', streamId: 'acc-1', data: { owner: 'Bob', initialBalance: 50 } }, existingEvents);
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.length > 0, 'Should have error message');
    }
  });

  // --- Exercice 4 : Projection ---
  await test('Ex4: projection maintient la vue materialisee', () => {
    const projection = createAccountProjection();
    projection.apply({ id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 });
    projection.apply({ id: 'e2', streamId: 'acc-2', type: 'AccountOpened', data: { owner: 'Bob', initialBalance: 200 }, timestamp: 2000, version: 1 });
    projection.apply({ id: 'e3', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 3000, version: 2 });

    const alice = projection.getAccount('acc-1');
    assert(alice !== undefined, 'Alice account should exist');
    assertEqual(alice!.balance, 150);
    assertEqual(alice!.owner, 'Alice');
    assertEqual(projection.getAllAccounts().length, 2);
    assertEqual(projection.getTotalBalance(), 350);
  });

  await test('Ex4: projection filtre les comptes ouverts', () => {
    const projection = createAccountProjection();
    projection.apply({ id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 });
    projection.apply({ id: 'e2', streamId: 'acc-2', type: 'AccountOpened', data: { owner: 'Bob', initialBalance: 200 }, timestamp: 2000, version: 1 });
    projection.apply({ id: 'e3', streamId: 'acc-2', type: 'AccountClosed', data: {}, timestamp: 3000, version: 2 });

    assertEqual(projection.getOpenAccounts().length, 1);
    assertEqual(projection.getOpenAccounts()[0].owner, 'Alice');
  });

  // --- Exercice 5 : Snapshot ---
  await test('Ex5: snapshot accelere le chargement', () => {
    const snapshotStore = createSnapshotStore<BankAccountState>();
    const savedState: BankAccountState = { id: 'acc-1', owner: 'Alice', balance: 150, isOpen: true, version: 3 };
    snapshotStore.save('acc-1', savedState, 3);

    const allEvents: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 2000, version: 2 },
      { id: 'e3', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 0 }, timestamp: 3000, version: 3 },
      { id: 'e4', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 25 }, timestamp: 4000, version: 4 },
    ];

    const { state, eventsReplayed } = loadBankAccountWithSnapshot(allEvents, snapshotStore, 'acc-1');
    assertEqual(state.balance, 175);
    assertEqual(eventsReplayed, 1);
  });

  await test('Ex5: sans snapshot rejoue tous les evenements', () => {
    const snapshotStore = createSnapshotStore<BankAccountState>();
    const allEvents: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 2000, version: 2 },
    ];
    const { state, eventsReplayed } = loadBankAccountWithSnapshot(allEvents, snapshotStore, 'acc-1');
    assertEqual(state.balance, 150);
    assertEqual(eventsReplayed, 2);
  });

  // --- Exercice 6 : Temporal Query ---
  await test('Ex6: getStateAtVersion retourne l etat a une version donnee', () => {
    const events: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 2000, version: 2 },
      { id: 'e3', streamId: 'acc-1', type: 'MoneyWithdrawn', data: { amount: 30 }, timestamp: 3000, version: 3 },
    ];
    const stateV1 = getStateAtVersion(events, 1);
    assertEqual(stateV1.balance, 100);
    const stateV2 = getStateAtVersion(events, 2);
    assertEqual(stateV2.balance, 150);
    const stateV3 = getStateAtVersion(events, 3);
    assertEqual(stateV3.balance, 120);
  });

  await test('Ex6: getStateAtTimestamp retourne l etat a un instant donne', () => {
    const events: DomainEvent[] = [
      { id: 'e1', streamId: 'acc-1', type: 'AccountOpened', data: { owner: 'Alice', initialBalance: 100 }, timestamp: 1000, version: 1 },
      { id: 'e2', streamId: 'acc-1', type: 'MoneyDeposited', data: { amount: 50 }, timestamp: 2000, version: 2 },
      { id: 'e3', streamId: 'acc-1', type: 'MoneyWithdrawn', data: { amount: 30 }, timestamp: 3000, version: 3 },
    ];
    const stateAt1500 = getStateAtTimestamp(events, 1500);
    assertEqual(stateAt1500.balance, 100);
    const stateAt2500 = getStateAtTimestamp(events, 2500);
    assertEqual(stateAt2500.balance, 150);
  });

  summary();
}

main();
