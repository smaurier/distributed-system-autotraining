# Screencast 13 — CQRS & Event Sourcing

## Informations
- **Duree estimee** : 18-20 min
- **Module** : `modules/13-cqrs-event-sourcing.md`
- **Lab associe** : Lab 13
- **Prérequis** : Screencast 12

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `labs/lab-13-cqrs-event-sourcing/` pret
- [ ] Aucun processus sur les ports 3000-3002
- [ ] Diagramme CQRS affiche en split-screen (optionnel)

## Script

### [00:00-02:00] Introduction — Pourquoi separer lectures et ecritures

> Jusqu'ici, nos services utilisent un modèle CRUD unique : le même schema sert à écrire et a lire les donnees. Ça fonctionne bien pour des cas simples, mais en distribue, les besoins de lecture (jointures, aggregations, recherche full-text) et d'écriture (validation, regles metier) sont souvent très différents. CQRS propose de les separer explicitement.

**Action** : Ouvrir le fichier du module 13 et montrer le diagramme CRUD vs CQRS.

> Avec l'event sourcing, on va aller encore plus loin : au lieu de stocker l'état courant, on stocke chaque événement qui a mene a cet état. C'est comme un journal comptable : on ne modifie jamais une ligne, on ajoute toujours.

### [02:00-05:30] Construire un Event Store from scratch

> Commencons par l'event store. C'est une structure append-only qui stocke des événements types et immuables.

**Action** : Créer un nouveau fichier `event-store.ts`.

```typescript
// Types d'evenements pour un domaine "Compte bancaire"
interface DomainEvent {
  eventId: string;
  aggregateId: string;
  type: string;
  data: unknown;
  timestamp: number;
  version: number;
}

interface AccountCreated {
  type: 'AccountCreated';
  data: { owner: string; initialBalance: number };
}

interface MoneyDeposited {
  type: 'MoneyDeposited';
  data: { amount: number };
}

interface MoneyWithdrawn {
  type: 'MoneyWithdrawn';
  data: { amount: number };
}

type AccountEvent = AccountCreated | MoneyDeposited | MoneyWithdrawn;
```

**Action** : Implementer le store lui-même.

```typescript
class EventStore {
  private events: Map<string, DomainEvent[]> = new Map();

  append(aggregateId: string, event: Omit<DomainEvent, 'eventId' | 'timestamp' | 'version'>): DomainEvent {
    const stream = this.events.get(aggregateId) ?? [];
    const domainEvent: DomainEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      version: stream.length + 1,
    };
    stream.push(domainEvent);
    this.events.set(aggregateId, stream);
    return domainEvent;
  }

  getStream(aggregateId: string): DomainEvent[] {
    return this.events.get(aggregateId) ?? [];
  }

  getAllEvents(): DomainEvent[] {
    return [...this.events.values()].flat().sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

> Remarquez trois choses : chaque événement à un version incrementale, un timestamp, et un identifiant unique. Le stream est append-only — on n'edite et on ne supprime jamais.

**Action** : Exécuter un test rapide dans le terminal pour montrer l'ajout d'événements.

### [05:30-09:00] Reconstruire l'état avec une fonction fold

> L'event sourcing stocke l'historique, pas l'état. Pour obtenir l'état courant, on "rejoue" les événements avec une fonction fold — exactement comme un Array.reduce en JavaScript.

**Action** : Implementer la reconstruction d'état.

```typescript
interface AccountState {
  id: string;
  owner: string;
  balance: number;
  isOpen: boolean;
}

function rebuildAccount(events: DomainEvent[]): AccountState {
  const initial: AccountState = { id: '', owner: '', balance: 0, isOpen: false };

  return events.reduce((state, event) => {
    switch (event.type) {
      case 'AccountCreated':
        return {
          ...state,
          id: event.aggregateId,
          owner: (event.data as any).owner,
          balance: (event.data as any).initialBalance,
          isOpen: true,
        };
      case 'MoneyDeposited':
        return { ...state, balance: state.balance + (event.data as any).amount };
      case 'MoneyWithdrawn':
        return { ...state, balance: state.balance - (event.data as any).amount };
      default:
        return state;
    }
  }, initial);
}
```

> La beaute de cette approche : l'état a n'importe quel moment est déterministe. On peut rejouer les memes événements et obtenir toujours le même résultat.

**Action** : Ajouter plusieurs événements, puis appeler `rebuildAccount` pour montrer que l'état correspond.

### [09:00-12:30] Implementer les projections (Read Models)

> En CQRS, le cote lecture utilise des projections — des vues materialisees construites à partir des événements. Chaque projection est optimisee pour un besoin de lecture spécifique.

**Action** : Créer une projection pour un tableau de bord.

```typescript
class AccountSummaryProjection {
  private summaries: Map<string, { owner: string; balance: number; txCount: number }> = new Map();

  apply(event: DomainEvent): void {
    switch (event.type) {
      case 'AccountCreated': {
        const data = event.data as any;
        this.summaries.set(event.aggregateId, {
          owner: data.owner,
          balance: data.initialBalance,
          txCount: 0,
        });
        break;
      }
      case 'MoneyDeposited': {
        const summary = this.summaries.get(event.aggregateId)!;
        summary.balance += (event.data as any).amount;
        summary.txCount++;
        break;
      }
      case 'MoneyWithdrawn': {
        const summary = this.summaries.get(event.aggregateId)!;
        summary.balance -= (event.data as any).amount;
        summary.txCount++;
        break;
      }
    }
  }

  getAll() {
    return [...this.summaries.entries()];
  }
}
```

> On peut avoir autant de projections qu'on veut : une pour le dashboard, une pour la recherche, une pour les rapports. Si on a besoin d'une nouvelle vue, on créé une nouvelle projection et on rejoue tous les événements.

**Action** : Créer une deuxieme projection (top depositors) pour illustrer qu'on peut multiplier les read models sans toucher au write model.

### [12:30-15:30] Optimisation par snapshots

> Rejouer 10 événements c'est rapide. Rejouer 10 millions d'événements à chaque requête, c'est un problème. La solution : les snapshots.

**Action** : Implementer le mécanisme de snapshot.

```typescript
interface Snapshot<T> {
  aggregateId: string;
  state: T;
  version: number;
  createdAt: number;
}

class SnapshotStore<T> {
  private snapshots: Map<string, Snapshot<T>> = new Map();

  save(aggregateId: string, state: T, version: number): void {
    this.snapshots.set(aggregateId, {
      aggregateId,
      state,
      version,
      createdAt: Date.now(),
    });
  }

  get(aggregateId: string): Snapshot<T> | undefined {
    return this.snapshots.get(aggregateId);
  }
}

function rebuildWithSnapshot(
  eventStore: EventStore,
  snapshotStore: SnapshotStore<AccountState>,
  aggregateId: string
): AccountState {
  const snapshot = snapshotStore.get(aggregateId);
  const allEvents = eventStore.getStream(aggregateId);

  if (snapshot) {
    // Ne rejouer que les evenements apres le snapshot
    const newEvents = allEvents.filter(e => e.version > snapshot.version);
    console.log(`Replaying ${newEvents.length} events (skipped ${snapshot.version} via snapshot)`);
    return newEvents.reduce((state, event) => applyEvent(state, event), snapshot.state);
  }

  return rebuildAccount(allEvents);
}
```

> Typiquement, on créé un snapshot tous les N événements — par exemple toutes les 100 ou 1000 ecritures. Au lieu de rejouer 10 000 événements, on charge le dernier snapshot et on ne rejoue que les 50 événements suivants.

**Action** : Montrer la différence de performance avec un `console.time` / `console.timeEnd` avant et après l'introduction du snapshot.

### [15:30-18:00] Requetes temporelles — Time Travel

> Le dernier super-pouvoir de l'event sourcing : le voyage dans le temps. Puisqu'on stocke tout l'historique, on peut reconstruire l'état a n'importe quel instant T.

**Action** : Implementer la requête temporelle.

```typescript
function getStateAtTime(events: DomainEvent[], targetTime: number): AccountState {
  const eventsBeforeTarget = events.filter(e => e.timestamp <= targetTime);
  console.log(`Rebuilding state from ${eventsBeforeTarget.length} events (up to ${new Date(targetTime).toISOString()})`);
  return rebuildAccount(eventsBeforeTarget);
}

function getStateAtVersion(events: DomainEvent[], targetVersion: number): AccountState {
  const eventsUpToVersion = events.filter(e => e.version <= targetVersion);
  return rebuildAccount(eventsUpToVersion);
}
```

> Ça permet le debugging en production — "quel etait l'état du compte juste avant cette transaction suspecte ?". Ça permet aussi l'audit reglementaire et la correction retroactive.

**Action** : Montrer l'état du compte a différents moments dans le temps en appelant `getStateAtVersion` avec les versions 1, 3, et 5.

### [18:00-19:30] Récapitulatif et lien avec le Lab 13

> Recapitulons. CQRS separe les modèles de lecture et d'écriture pour les optimiser independamment. L'event sourcing stocke les faits plutot que l'état, ce qui donne l'audit complet, les requêtes temporelles, et la possibilite d'ajouter de nouvelles projections a posteriori. Les snapshots resolvent le problème de performance de la reconstruction.

**Action** : Montrer le diagramme récapitulatif complet du module 13.

> Le trade-off : la complexite. L'eventual consistency entre le write model et les projections est un defi. On verra au module 14 comment l'outbox pattern resout le problème de la publication fiable des événements.

**Action** : Ouvrir le README du Lab 13 et montrer les exercices.

> Dans le lab, vous allez implementer tout ça de bout en bout avec des tests. Mettez la video en pause et lancez-vous !

## Points d'attention pour l'enregistrement
- Typer le code lentement pour l'event store, c'est le concept central
- Bien insister sur l'immutabilite : append-only, jamais de modification
- Montrer visuellement le "replay" des événements avec des console.log
- Pour le snapshot, comparer explicitement les temps avec et sans
- Garder un ton enthousiaste sur le "time travel" — c'est le moment wow
- Vérifier que tous les snippets compilent avant l'enregistrement
