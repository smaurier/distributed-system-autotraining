// =============================================================================
// Lab 13 — CQRS & Event Sourcing (Exercice)
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
// Implementer un store append-only pour les evenements.
// - append(streamId, events) ajoute des evenements au stream
// - getEvents(streamId) retourne tous les evenements d'un stream
// - getAllEvents() retourne tous les evenements de tous les streams
// - Chaque evenement recoit un version auto-incremente par stream
// =============================================================================

interface EventStore {
  append(streamId: string, events: Omit<DomainEvent, 'id' | 'version' | 'timestamp'>[]): DomainEvent[];
  getEvents(streamId: string): DomainEvent[];
  getAllEvents(): DomainEvent[];
}

function createEventStore(): EventStore {
  // TODO: Implementer le store append-only
  // - Stocker les evenements par streamId
  // - Auto-incrementer la version par stream (commence a 1)
  // - Generer un id unique pour chaque evenement (ex: `evt-${counter}`)
  // - Ajouter un timestamp (Date.now())
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Aggregate from events
// Reconstruire l'etat d'un agregat BankAccount en rejouant les evenements.
// Types d'evenements :
// - AccountOpened: { owner: string, initialBalance: number }
// - MoneyDeposited: { amount: number }
// - MoneyWithdrawn: { amount: number }
// - AccountClosed: {}
// =============================================================================

interface BankAccountState {
  id: string;
  owner: string;
  balance: number;
  isOpen: boolean;
  version: number;
}

function replayBankAccount(events: DomainEvent[]): BankAccountState {
  // TODO: Reconstruire l'etat du compte en rejouant les evenements
  // - Partir d'un etat initial vide
  // - Appliquer chaque evenement dans l'ordre
  // - Retourner l'etat final
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Command Handler
// Implementer un handler qui recoit des commandes, les valide,
// et produit des evenements.
// Commandes :
// - OpenAccount: { owner: string, initialBalance: number }
// - Deposit: { amount: number }
// - Withdraw: { amount: number }
// - CloseAccount: {}
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
  // TODO: Implementer le command handler
  // - Reconstruire l'etat courant avec replayBankAccount
  // - Valider la commande selon l'etat courant
  //   * OpenAccount: le compte ne doit pas deja etre ouvert (pas d'evenements existants)
  //   * Deposit: le compte doit etre ouvert, amount > 0
  //   * Withdraw: le compte doit etre ouvert, amount > 0, balance suffisante
  //   * CloseAccount: le compte doit etre ouvert
  // - Retourner les evenements produits
  // - Throw si la commande est invalide
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Projection
// Implementer une projection read-model qui ecoute les evenements
// et maintient une vue materialisee (liste de tous les comptes avec solde).
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
  // TODO: Implementer la projection
  // - Maintenir un Map<string, AccountSummary>
  // - apply() met a jour la vue selon le type d'evenement
  // - getAccount() retourne un compte par id
  // - getAllAccounts() retourne tous les comptes
  // - getOpenAccounts() retourne les comptes ouverts
  // - getTotalBalance() retourne la somme de tous les soldes
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Snapshot
// Implementer des snapshots pour accelerer le chargement des agregats.
// Au lieu de rejouer tous les evenements depuis le debut, on sauvegarde
// un snapshot periodiquement et on ne rejoue que les evenements suivants.
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
  // TODO: Implementer le snapshot store
  // - save() sauvegarde un snapshot pour un stream
  // - load() charge le dernier snapshot pour un stream
  throw new Error('Not implemented');
}

function loadBankAccountWithSnapshot(
  events: DomainEvent[],
  snapshotStore: SnapshotStore<BankAccountState>,
  streamId: string
): { state: BankAccountState; eventsReplayed: number } {
  // TODO: Charger l'agregat en utilisant le snapshot si disponible
  // - Charger le snapshot s'il existe
  // - Ne rejouer que les evenements apres la version du snapshot
  // - Retourner l'etat final et le nombre d'evenements rejoues
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Temporal Query
// Implementer des requetes temporelles : obtenir l'etat d'un agregat
// a un point dans le temps ou a une version specifique.
// =============================================================================

function getStateAtVersion(events: DomainEvent[], version: number): BankAccountState {
  // TODO: Retourner l'etat de l'agregat a la version donnee
  // - Ne rejouer que les evenements jusqu'a la version specifiee (incluse)
  throw new Error('Not implemented');
}

function getStateAtTimestamp(events: DomainEvent[], timestamp: number): BankAccountState {
  // TODO: Retourner l'etat de l'agregat au timestamp donne
  // - Ne rejouer que les evenements dont le timestamp <= timestamp donne
  throw new Error('Not implemented');
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
