# Screencast 13 — CQRS & Event Sourcing

## Informations
- **Duree estimee** : 18-20 min
- **Module** : `modules/13-cqrs-event-sourcing.md`
- **Lab associe** : Lab 13
- **Prerequis** : Screencast 12

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `labs/lab-13-cqrs-event-sourcing/` pret
- [ ] Aucun processus sur les ports 3000-3002
- [ ] Diagramme CQRS affiche en split-screen (optionnel)

## Script

### [00:00-02:00] Introduction — Pourquoi separer lectures et ecritures

> Jusqu'ici, nos services utilisent un modele CRUD unique : le meme schema sert a ecrire et a lire les donnees. Ca fonctionne bien pour des cas simples, mais en distribue, les besoins de lecture (jointures, aggregations, recherche full-text) et d'ecriture (validation, regles metier) sont souvent tres differents. CQRS propose de les separer explicitement.

**Action** : Ouvrir le fichier du module 13 et montrer le diagramme CRUD vs CQRS.

> Avec l'event sourcing, on va aller encore plus loin : au lieu de stocker l'etat courant, on stocke chaque evenement qui a mene a cet etat. C'est comme un journal comptable : on ne modifie jamais une ligne, on ajoute toujours.

### [02:00-05:30] Construire un Event Store from scratch

> Commencons par l'event store. C'est une structure append-only qui stocke des evenements types et immuables.

**Action** : Creer un nouveau fichier `event-store.ts`.

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

**Action** : Implementer le store lui-meme.

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

> Remarquez trois choses : chaque evenement a un version incrementale, un timestamp, et un identifiant unique. Le stream est append-only — on n'edite et on ne supprime jamais.

**Action** : Executer un test rapide dans le terminal pour montrer l'ajout d'evenements.

### [05:30-09:00] Reconstruire l'etat avec une fonction fold

> L'event sourcing stocke l'historique, pas l'etat. Pour obtenir l'etat courant, on "rejoue" les evenements avec une fonction fold — exactement comme un Array.reduce en JavaScript.

**Action** : Implementer la reconstruction d'etat.

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

> La beaute de cette approche : l'etat a n'importe quel moment est deterministe. On peut rejouer les memes evenements et obtenir toujours le meme resultat.

**Action** : Ajouter plusieurs evenements, puis appeler `rebuildAccount` pour montrer que l'etat correspond.

### [09:00-12:30] Implementer les projections (Read Models)

> En CQRS, le cote lecture utilise des projections — des vues materialisees construites a partir des evenements. Chaque projection est optimisee pour un besoin de lecture specifique.

**Action** : Creer une projection pour un tableau de bord.

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

> On peut avoir autant de projections qu'on veut : une pour le dashboard, une pour la recherche, une pour les rapports. Si on a besoin d'une nouvelle vue, on cree une nouvelle projection et on rejoue tous les evenements.

**Action** : Creer une deuxieme projection (top depositors) pour illustrer qu'on peut multiplier les read models sans toucher au write model.

### [12:30-15:30] Optimisation par snapshots

> Rejouer 10 evenements c'est rapide. Rejouer 10 millions d'evenements a chaque requete, c'est un probleme. La solution : les snapshots.

**Action** : Implementer le mecanisme de snapshot.

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

> Typiquement, on cree un snapshot tous les N evenements — par exemple toutes les 100 ou 1000 ecritures. Au lieu de rejouer 10 000 evenements, on charge le dernier snapshot et on ne rejoue que les 50 evenements suivants.

**Action** : Montrer la difference de performance avec un `console.time` / `console.timeEnd` avant et apres l'introduction du snapshot.

### [15:30-18:00] Requetes temporelles — Time Travel

> Le dernier super-pouvoir de l'event sourcing : le voyage dans le temps. Puisqu'on stocke tout l'historique, on peut reconstruire l'etat a n'importe quel instant T.

**Action** : Implementer la requete temporelle.

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

> Ca permet le debugging en production — "quel etait l'etat du compte juste avant cette transaction suspecte ?". Ca permet aussi l'audit reglementaire et la correction retroactive.

**Action** : Montrer l'etat du compte a differents moments dans le temps en appelant `getStateAtVersion` avec les versions 1, 3, et 5.

### [18:00-19:30] Recapitulatif et lien avec le Lab 13

> Recapitulons. CQRS separe les modeles de lecture et d'ecriture pour les optimiser independamment. L'event sourcing stocke les faits plutot que l'etat, ce qui donne l'audit complet, les requetes temporelles, et la possibilite d'ajouter de nouvelles projections a posteriori. Les snapshots resolvent le probleme de performance de la reconstruction.

**Action** : Montrer le diagramme recapitulatif complet du module 13.

> Le trade-off : la complexite. L'eventual consistency entre le write model et les projections est un defi. On verra au module 14 comment l'outbox pattern resout le probleme de la publication fiable des evenements.

**Action** : Ouvrir le README du Lab 13 et montrer les exercices.

> Dans le lab, vous allez implementer tout ca de bout en bout avec des tests. Mettez la video en pause et lancez-vous !

## Points d'attention pour l'enregistrement
- Typer le code lentement pour l'event store, c'est le concept central
- Bien insister sur l'immutabilite : append-only, jamais de modification
- Montrer visuellement le "replay" des evenements avec des console.log
- Pour le snapshot, comparer explicitement les temps avec et sans
- Garder un ton enthousiaste sur le "time travel" — c'est le moment wow
- Verifier que tous les snippets compilent avant l'enregistrement
