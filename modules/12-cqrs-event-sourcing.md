---
titre: CQRS & Event Sourcing
cours: 17-distributed-systems
notions: ["CQRS (Command Query Responsibility Segregation)", "séparer modèle d'écriture / modèle de lecture", "commande vs requête", "un modèle read, un modèle write", "Event Sourcing (l'événement = source de vérité)", "état dérivé des événements (state = fold(events))", "event store append-only", "événement immuable", "stream par agrégat (aggregateId)", "concurrence optimiste (expectedVersion)", "replay (reconstruction par rejeu)", "projection / read model matérialisé", "cohérence éventuelle du read model", "read-your-writes / staleness", "snapshot (optimisation du replay)", "snapshot n'est pas la source de vérité", "versioning d'événements", "upcasting", "weak schema / tolerant reader", "rejouer des side-effects vers un système externe", "CQRS sans Event Sourcing", "requête temporelle (état à l'instant T)"]
outcomes:
  - "sait séparer un modèle d'écriture (commandes) d'un modèle de lecture (requêtes) et expliquer pourquoi CQRS n'implique pas deux bases"
  - "sait implémenter un event store append-only avec stream par agrégat et concurrence optimiste par expectedVersion"
  - "sait reconstruire l'état d'un agrégat par replay (fold des événements) et reconnaître que l'état est dérivé, jamais stocké comme vérité"
  - "sait construire une projection (read model) à partir du flux d'événements et la reconstruire from scratch"
  - "sait raisonner sur la cohérence éventuelle du read model et le problème read-your-writes"
  - "sait ajouter des snapshots comme optimisation du replay sans en faire une source de vérité"
  - "sait faire évoluer le schéma d'un événement (versioning) par upcasting ou weak schema sans casser le replay"
  - "sait distinguer CQRS seul, Event Sourcing seul, et la combinaison des deux"
prerequis: ["Module 02 — microservices & database-per-service", "Module 03 — sérialisation & versioning de contrat", "Module 05 — communication asynchrone & garanties de livraison", "Module 06 — event-driven architecture (événement vs commande)", "Module 08 — retries, timeouts, idempotency", "Module 09 — cohérence & théorème CAP (cohérence forte→éventuelle)", "Module 10 — réplication & partitionnement", "Module 11 — transactions distribuées & saga"]
next: 13-outbox-pattern-reliable-messaging
libs: []
tribuzen: "backend TribuZen — le budget commun de la famille en event sourcing : chaque débit/crédit est un événement immuable (source de vérité), le solde est dérivé par replay, des projections servent le relevé et le rapport mensuel, et une requête temporelle répond « quel était le budget le 1er du mois »"
last-reviewed: 2026-07
---

# CQRS & Event Sourcing

> **Outcomes — tu sauras FAIRE :** séparer un modèle write d'un modèle read (CQRS), implémenter un event store append-only avec concurrence optimiste, reconstruire un état par replay, construire et reconstruire une projection, raisonner sur la cohérence éventuelle du read model, ajouter des snapshots sans en faire une vérité, faire évoluer le schéma d'un événement par upcasting.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes & implémentation** de CQRS et de l'Event Sourcing : comment un **event store** stocke un log append-only, comment on **reconstruit** un état par **replay**, comment une **projection** matérialise un read model, comment on gère sa **cohérence éventuelle**, comment les **snapshots** accélèrent le replay, et comment on **versionne** les événements sans casser le rejeu. On **ne** traite **pas** ici la **décision d'architecture** « faut-il CQRS/ES pour ce bounded context ? » ni le cadrage design — c'est le **cours 13-architecture, module 18** (renvoi explicite au §2.10). On ne traite pas non plus : la **publication fiable** d'un événement depuis une transaction DB (dual-write, **outbox**) → **module 13 (ce cours, next)** ; la **saga** et la compensation → **module 11** ; les **garanties de livraison** du broker qui transporte les événements vers d'autres services → **module 05**. Ici : le mécanisme de stockage-par-événements et ses garanties réelles.

## 1. Cas concret d'abord

Dans TribuZen, chaque famille a un **budget commun** : les parents y déposent de l'argent, et chaque sortie payante le débite. Le premier réflexe est de stocker **le solde** dans une ligne :

```ts
// budget — modèle CRUD classique : on stocke L'ÉTAT
// table budgets(family_id, solde)
async function debiter(familyId: string, montant: number): Promise<void> {
  const b = await db.budgets.findOne({ familyId });
  await db.budgets.update({ familyId }, { solde: b.solde - montant }); // ← on ÉCRASE
}
```

Trois semaines plus tard, un parent réclame : « Le budget affiche 12 €, mais on avait mis 200 € en janvier. **Où est passé l'argent ? Qui a dépensé quoi ?** » Tu ouvres la base : il n'y a qu'**une** ligne, `solde = 12`. **L'historique n'existe pas** — chaque `update` a **écrasé** le précédent. Tu ne peux ni répondre, ni recalculer, ni prouver. Pire : la semaine dernière un bug a fait un double débit ; impossible de savoir **quand** il a eu lieu ni de revenir à l'état d'avant.

Le CRUD répond à une seule question — « quel est l'état **maintenant** ? » — et **détruit** toutes les autres. Or un budget familial est exactement le genre de domaine où l'**historique**, l'**audit** (« qui, quoi, quand »), et les **questions temporelles** (« quel était le solde le 1er du mois ? ») comptent autant que le solde courant.

**L'Event Sourcing renverse le stockage** : au lieu de sauver le solde, on sauve **chaque opération** comme un **événement immuable** (`ArgentDéposé`, `BudgetDébité`), dans l'ordre. Le solde n'est plus stocké — il est **dérivé** en rejouant les événements. Rien ne s'écrase, tout se conserve. Et **CQRS** est le pattern qui accompagne ça : le côté **écriture** (valider une commande, produire un événement) et le côté **lecture** (afficher le solde, le relevé, un rapport) deviennent **deux modèles distincts**, chacun optimisé pour son usage. Ce module te donne les deux mécanismes, leur implémentation, et leurs pièges — dont le plus dur : le read model n'est **que cohérent éventuellement**.

---

## 2. Théorie complète, concise

### 2.1 CQRS — séparer le modèle d'écriture du modèle de lecture

**CQRS** (*Command Query Responsibility Segregation*) part d'un constat de Martin Fowler : *« you can use a different model to update information than the model you use to read information »*. Le changement qu'il introduit est de *« split that conceptual model into separate models for update and display, which it refers to as Command and Query respectively »*.

- **Commande** — une intention de **changer** l'état (`DébiterBudget`). Elle est validée par la logique métier, peut échouer, ne renvoie **pas** de données.
- **Requête** — une demande de **lire** l'état (`GetSolde`). Elle ne change **rien**, et sert un modèle **façonné pour l'affichage** (dénormalisé, agrégé, indexé).

L'intérêt : les besoins d'écriture (validation, invariants, cohérence forte d'un agrégat) et de lecture (jointures, agrégations, recherche, tri) sont **différents** et se **gênent** dans un modèle unique. En les séparant, chaque côté s'optimise seul — Fowler : *« CQRS allows you to separate the load from reads and writes allowing you to scale each independently »*.

**Point crucial (souvent mal compris) : CQRS ≠ deux bases.** La séparation est d'abord **logique** (deux modèles, deux chemins de code). Deux bases physiques (write = PostgreSQL normalisé, read = Elasticsearch dénormalisé) est une option **avancée**, pas une obligation. On peut faire du CQRS avec une seule base et deux jeux de tables.

### 2.2 Event Sourcing — l'événement est la source de vérité

L'**Event Sourcing** change la nature de ce qu'on stocke. Fowler : *« Capture all changes to an application state as a sequence of events »* ; *« every change to the state of an application is captured in an event object, and that these event objects are themselves stored in the sequence they were applied »*.

Conséquences directes :

- On ne stocke **pas** l'état courant. On stocke le **journal des événements** qui l'ont produit. L'état est **dérivé** : `état = fold(événements)` (on part d'un état vide et on applique les événements dans l'ordre).
- Le log est la **source de vérité** : *« we guarantee that all changes to the domain objects are initiated by the event objects »*. Tout changement passe par un événement, jamais par un `UPDATE` direct.
- Les événements sont **immuables**. On ne modifie **jamais**, on ne supprime **jamais** un événement. Pour « corriger » une erreur, on **ajoute** un événement correctif (`BudgetAjusté`), exactement comme une écriture comptable passe une contre-écriture au lieu de gommer.

Ce que ça débloque (et que le CRUD détruit) :
- **Audit natif** — le log EST l'historique complet, gratuit et non falsifiable.
- **Requêtes temporelles** — Fowler : *« we can discard the application state completely and rebuild it by re-running the events from the event log on an empty application »*. On rejoue jusqu'à un instant T → on obtient l'état **à cet instant**.
- **Debugging** — on **rejoue** la séquence exacte qui a mené à un bug.

### 2.3 L'événement — sa forme

Un événement décrit un **fait passé, révolu** : nom au **participe passé** (`BudgetDébité`, pas `DébiterBudget` qui serait une commande). Il porte le **delta**, pas l'état final.

```ts
interface DomainEvent {
  eventId: string;         // identité unique de l'événement (idempotence, dédup)
  aggregateId: string;     // à quel agrégat il appartient (ex: budgetId = familyId)
  type: string;            // 'BUDGET_DEBITE'
  version: number;         // numéro de séquence DANS le stream de l'agrégat (1,2,3…)
  schemaVersion: number;   // version du SCHÉMA de ce type d'événement (cf. §2.9)
  occurredAt: string;      // ISO — quand le fait a eu lieu
  payload: Record<string, unknown>;
  metadata?: { correlationId?: string; causationId?: string; userId?: string };
}
```

Deux « versions » à ne pas confondre : `version` = **position** de l'événement dans le stream (sert la concurrence optimiste, §2.5) ; `schemaVersion` = **forme** du payload (sert le versioning, §2.9).

### 2.4 L'event store — un log append-only par stream

L'**event store** est une base **append-only** : on **ajoute** des événements, on ne les modifie jamais. Il est organisé en **streams**, un par agrégat (`aggregateId`). Deux opérations suffisent : `append(streamId, events, expectedVersion)` et `readStream(streamId)`.

```ts
// event store minimal, illustratif (en prod : PostgreSQL table append-only, ou EventStoreDB)
class EventStore {
  private streams = new Map<string, DomainEvent[]>();

  append(streamId: string, newEvents: DomainEvent[], expectedVersion: number): void {
    const stream = this.streams.get(streamId) ?? [];
    // Concurrence optimiste (cf. §2.5) : le stream doit être à la version attendue.
    if (stream.length !== expectedVersion) {
      throw new ConcurrencyError(streamId, expectedVersion, stream.length);
    }
    newEvents.forEach((e, i) => stream.push({ ...e, version: expectedVersion + i + 1 }));
    this.streams.set(streamId, stream); // append-only : on ne réécrit jamais un événement passé
  }

  readStream(streamId: string): DomainEvent[] {
    return [...(this.streams.get(streamId) ?? [])];
  }
}
```

En production, l'append-only est **imposé** par le schéma : une table `events(stream_id, version, type, payload, …)` avec **contrainte d'unicité `(stream_id, version)`** — c'est elle qui fait respecter la concurrence optimiste au niveau base, et qui interdit de « refaire » une version déjà écrite.

### 2.5 Concurrence optimiste par `expectedVersion`

Deux commandes concurrentes sur le **même** agrégat (deux parents débitent le budget en même temps) ne doivent pas s'écraser. L'event store ne prend **pas** de verrou : il fait de l'**optimiste**. Chaque commande a lu le stream jusqu'à la version `N`, décide, puis tente d'`append` en disant *« j'attends que le stream soit encore à la version N »*. Si un autre a écrit entre-temps (stream à `N+1`), l'`append` **échoue** (`ConcurrencyError`) → la commande **relit** l'état à jour et **rejoue** sa décision (ou abandonne). C'est le pendant, côté event store, de l'*optimistic offline lock*. La contrainte d'unicité `(stream_id, version)` en base garantit qu'**une seule** des deux écritures gagne.

### 2.6 Reconstruire l'état — le replay (`fold`)

L'agrégat n'a pas d'état persisté : on le **reconstruit** en repartant d'un état vide et en **appliquant** (`apply`) chaque événement du stream. C'est un `fold` (reduce) sur la liste d'événements.

```ts
interface BudgetState { budgetId: string; solde: number; version: number; }

class BudgetAggregate {
  private state: BudgetState | null = null;

  // REPLAY : reconstruit l'état en rejouant l'historique
  loadFromHistory(events: DomainEvent[]): void {
    this.state = null;
    for (const e of events) this.apply(e);
  }

  // apply = fonction PURE de transition : (état, événement) -> nouvel état. Aucun side-effect.
  private apply(e: DomainEvent): void {
    switch (e.type) {
      case 'BUDGET_OUVERT':
        this.state = { budgetId: e.aggregateId, solde: 0, version: e.version };
        break;
      case 'ARGENT_DEPOSE':
        this.state!.solde += (e.payload as { montant: number }).montant;
        this.state!.version = e.version;
        break;
      case 'BUDGET_DEBITE':
        this.state!.solde -= (e.payload as { montant: number }).montant;
        this.state!.version = e.version;
        break;
    }
  }
}
```

La commande, elle, **valide** puis **produit** un nouvel événement (sans muter directement l'état) :

```ts
// dans BudgetAggregate — une commande valide l'invariant PUIS émet un événement
debiter(montant: number): DomainEvent[] {
  if (!this.state) throw new Error('budget inexistant');
  if (this.state.solde < montant) throw new Error('solde insuffisant'); // ← invariant métier
  return [{ /* … */ type: 'BUDGET_DEBITE', aggregateId: this.state.budgetId,
            payload: { montant }, /* version assignée à l'append */ } as DomainEvent];
}
```

Cycle complet d'une commande : **charger** le stream → `loadFromHistory` (replay) → appeler la méthode de commande (validation + événement) → `append(streamId, events, state.version)`.

### 2.7 Projections & read models — matérialiser la lecture

Rejouer tout un stream à **chaque** lecture serait absurde pour l'affichage. Une **projection** consomme le flux d'événements et **matérialise** un **read model** prêt à requêter. Un même flux alimente **plusieurs** projections, chacune façonnée pour une question.

```ts
// Projection "solde courant" — un read model KV simple
class SoldeProjection {
  private soldes = new Map<string, number>();

  handle(e: DomainEvent): void {
    switch (e.type) {
      case 'BUDGET_OUVERT': this.soldes.set(e.aggregateId, 0); break;
      case 'ARGENT_DEPOSE':
        this.soldes.set(e.aggregateId,
          (this.soldes.get(e.aggregateId) ?? 0) + (e.payload as any).montant); break;
      case 'BUDGET_DEBITE':
        this.soldes.set(e.aggregateId,
          (this.soldes.get(e.aggregateId) ?? 0) - (e.payload as any).montant); break;
    }
  }
  getSolde(id: string): number { return this.soldes.get(id) ?? 0; }

  // Une projection est TOUJOURS reconstructible from scratch depuis le log.
  rebuild(allEvents: DomainEvent[]): void {
    this.soldes.clear();
    for (const e of allEvents) this.handle(e);
  }
}
```

Propriété clé : **une projection est jetable**. Comme le log est la vérité, on peut **supprimer** un read model et le **reconstruire** en rejouant tout (`rebuild`). C'est ce qui permet d'**ajouter** une nouvelle vue (un rapport mensuel qu'on n'avait pas prévu) **a posteriori** : on la branche, on rejoue l'historique, elle est peuplée.

### 2.8 La cohérence éventuelle du read model (le vrai piège)

Dès que la projection tourne **après** l'écriture (en asynchrone, sur un abonnement au flux), le read model est **en retard** sur l'event store : il est **cohérent éventuellement** (module 09). Il existe une **fenêtre** entre « l'événement est commité dans le store » et « la projection l'a appliqué ».

Conséquence concrète — **read-your-writes** : un parent débite (commande OK, événement écrit), l'UI recharge le solde **immédiatement**… et lit **l'ancien** solde parce que la projection n'a pas encore rattrapé. Il croit que son débit a été perdu.

Parades (à choisir selon le besoin, pas toutes en même temps) :
- **Afficher l'intention** — l'UI applique optimistiquement le résultat de sa propre commande sans attendre la projection.
- **Attendre la version** — la commande renvoie la `version` produite ; la lecture attend que la projection ait **atteint** cette version avant de répondre (read model qui expose sa position).
- **Lire le write model** pour le cas « juste après ma propre écriture » (relire l'agrégat par replay), et le read model pour tout le reste.

Ce qu'il ne faut **jamais** faire : supposer que le read model est **immédiatement** à jour. Il ne l'est pas, par construction.

### 2.9 Versioning des événements — faire évoluer sans casser le replay

Les événements sont **immuables et éternels** : ceux écrits il y a un an seront **rejoués** demain. Mais le code, lui, évolue — un jour tu ajoutes un champ `devise` à `BUDGET_DEBITE`. Les **vieux** événements ne l'ont pas. Il faut les rejouer quand même. Trois stratégies (Greg Young, *Versioning in an Event-Sourced System*) :

- **Weak schema / tolerant reader** — le code de `apply` **tolère** l'absence d'un champ (valeur par défaut). `payload.devise ?? 'EUR'`. Suffit pour un **ajout** de champ optionnel. Simple, à privilégier tant que possible.
- **Upcasting** — à la lecture, une fonction `upcast` **transforme** un vieil événement (schemaVersion 1) vers la forme courante (schemaVersion 2) **avant** de le passer à `apply`. Le reste du code ne connaît **que** la forme courante. Idéal pour un **renommage** ou une **restructuration** de payload.
- **Nouveau type d'événement** — si le sens change vraiment, on crée `BUDGET_DEBITE_V2` et on garde `apply` pour les deux. Le log reste honnête (il raconte ce qui s'est vraiment passé, avec la forme de l'époque).

```ts
// UPCASTING : normaliser les vieux événements vers la forme courante, à la lecture
function upcast(e: DomainEvent): DomainEvent {
  if (e.type === 'BUDGET_DEBITE' && (e.schemaVersion ?? 1) < 2) {
    // v1 n'avait pas de devise → on la matérialise en EUR sans TOUCHER au log
    return { ...e, schemaVersion: 2, payload: { ...e.payload, devise: 'EUR' } };
  }
  return e;
}
// pipeline de replay : readStream -> map(upcast) -> apply
```

Règle d'or : **on ne réécrit jamais un vieil événement en base**. L'upcast se fait **en lecture**, en mémoire. Le log est immuable ; le versioning vit **au-dessus** de lui.

### 2.10 Snapshots — optimiser le replay, sans devenir la vérité

Un stream de 50 000 événements coûte cher à rejouer à chaque commande. Un **snapshot** sauvegarde périodiquement l'**état** dérivé à la version `N` ; au chargement, on part du snapshot et on ne rejoue **que** les événements après `N`.

```
Sans snapshot :  [E1][E2]…………………………………………[E50000]  → replay des 50 000
Avec snapshot @ 49000 : (snapshot) + [E49001]…[E50000]  → replay de 1 000 seulement
```

Deux invariants **non négociables** :
1. **Le snapshot n'est PAS la source de vérité** — c'est un **cache** dérivable. On doit pouvoir le **jeter** et tout reconstruire depuis le log. Si tu ne peux plus reconstruire sans le snapshot, tu as perdu la propriété fondamentale de l'ES.
2. **Un snapshot est lié à une `schemaVersion` de l'état.** Si la forme de l'état change, les vieux snapshots deviennent **invalides** → on les **régénère** par replay. Ne jamais faire confiance aveuglément à un snapshot d'un format périmé.

Le snapshot est une **optimisation tardive** : ne l'ajoute que quand le replay devient mesurablement lent, pas par défaut.

### 2.11 CQRS et ES : liés mais indépendants — et la décision d'archi

CQRS et Event Sourcing se marient bien (les commandes produisent les événements ; les projections servent les requêtes), mais ce sont **deux** patterns **séparables** :

- **CQRS sans ES** — deux modèles read/write sur un stockage **classique** (CRUD). Fréquent, et souvent le bon premier pas.
- **ES sans CQRS (théorique)** — possible mais bancal : rejouer le log à chaque lecture est intenable, donc l'ES **appelle** presque toujours des projections (donc du CQRS).
- **Les deux** — l'architecture complète : commande → agrégat → event store → projections → requêtes.

> **Défère :** **quand** faut-il CQRS/ES pour un bounded context (bon vs mauvais candidat, coût de complexité, cohérence éventuelle acceptable, maturité d'équipe) = **décision d'architecture**, traitée au **cours 13-architecture, module 18**. Fowler lui-même prévient : *« you should be very cautious about using CQRS »*, avec *« CQRS seen as a significant force for getting a software system into serious difficulties »* quand il est appliqué partout. Ici, on a le **mécanisme** et ses garanties pour **alimenter** cette décision — pas la décision elle-même.

---

## 3. Worked examples

### Exemple 1 — Le budget TribuZen en Event Sourcing, de la commande au replay

But : transformer le budget « CRUD qui écrase » du §1 en agrégat event-sourced, et prouver que le solde est **dérivé**.

**Étape 1 — modéliser les événements** (faits passés, immuables) :

| Commande (intention) | Événement produit (fait) | Effet sur l'état dérivé |
|---|---|---|
| `OuvrirBudget` | `BUDGET_OUVERT` | solde = 0 |
| `Déposer(montant)` | `ARGENT_DEPOSE` | solde += montant |
| `Débiter(montant)` | `BUDGET_DEBITE` | solde −= montant |
| `Ajuster(delta, motif)` | `BUDGET_AJUSTE` | solde += delta (correction, pas d'effacement) |

**Étape 2 — le cycle d'une commande** (charger → replay → valider → append) :

```ts
class BudgetService {
  constructor(private store: EventStore) {}

  async debiter(budgetId: string, montant: number): Promise<{ version: number }> {
    // 1. Charger le stream et RECONSTRUIRE l'état par replay
    const history = this.store.readStream(budgetId).map(upcast); // upcast en lecture (§2.9)
    const agg = new BudgetAggregate();
    agg.loadFromHistory(history);

    // 2. La commande valide l'invariant (solde suffisant) et PRODUIT un événement
    const newEvents = agg.debiter(montant); // throw si solde insuffisant

    // 3. Append avec concurrence optimiste : le stream doit être resté à cette version
    const expected = history.length;
    this.store.append(budgetId, newEvents, expected); // ConcurrencyError si qqn a écrit entre-temps
    return { version: expected + newEvents.length };
  }
}
```

**Étape 3 — prouver que le solde est dérivé.** On rejoue et on obtient le même solde qu'un `SET solde` aurait donné — mais **sans** avoir stocké le solde :

```
Stream budget "famille-42" :
  v1 BUDGET_OUVERT
  v2 ARGENT_DEPOSE   {montant: 200}
  v3 BUDGET_DEBITE   {montant: 32}
  v4 BUDGET_DEBITE   {montant: 156}
replay (fold) :  0 → +200 → −32 → −156  =  solde 12
```

Le « où est passé l'argent ? » du §1 a maintenant une réponse **complète** : le log liste chaque mouvement, daté, attribué (`metadata.userId`). Et la question « quel était le solde **avant** le débit de 156 € ? » se répond en rejouant **jusqu'à v3** (état à l'instant T, §2.6).

### Exemple 2 — Ajouter une projection « rapport mensuel » a posteriori, et la reconstruire

Trois mois après la mise en prod, le PO veut un **rapport mensuel** (total déposé / total débité par mois). On n'avait **pas** prévu cette vue. En CRUD, la donnée serait perdue. En ES, on **branche une nouvelle projection et on rejoue l'historique**.

```ts
interface MoisReport { mois: string; deposits: number; debits: number; }

class RapportMensuelProjection {
  private parMois = new Map<string, MoisReport>(); // clé "2026-01"

  handle(e: DomainEvent): void {
    if (e.type !== 'ARGENT_DEPOSE' && e.type !== 'BUDGET_DEBITE') return;
    const mois = e.occurredAt.slice(0, 7); // "2026-01"
    const r = this.parMois.get(mois) ?? { mois, deposits: 0, debits: 0 };
    const montant = (e.payload as { montant: number }).montant;
    if (e.type === 'ARGENT_DEPOSE') r.deposits += montant;
    else r.debits += montant;
    this.parMois.set(mois, r);
  }

  // Peupler la NOUVELLE vue depuis TOUT l'historique déjà accumulé
  rebuild(allEvents: DomainEvent[]): void {
    this.parMois.clear();
    for (const e of allEvents.map(upcast)) this.handle(e);
  }

  get(mois: string): MoisReport | undefined { return this.parMois.get(mois); }
}

// Mise en service : on rejoue TOUT le log une fois, la vue est peuplée rétroactivement.
const rapport = new RapportMensuelProjection();
rapport.rebuild(store.readAll()); // <-- l'historique de 3 mois se matérialise d'un coup
```

**Ce que ça prouve :** parce que les événements sont **conservés** et **rejouables**, une exigence de lecture **non anticipée** se satisfait **sans migration de données ni perte** — on dérive une vue neuve d'un passé intact. C'est exactement ce qu'un modèle « je stocke l'état courant » rend impossible.

**À assumer :** au moment du `rebuild`, la vue est peuplée en rejouant l'historique ; ensuite elle suit le flux en asynchrone → elle est **cohérente éventuellement** (§2.8), pas instantanée. Acceptable pour un rapport ; à cadrer pour un affichage critique.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre CQRS et Event Sourcing

Ce sont **deux** patterns distincts. **CQRS** = séparer modèle read / modèle write (utilisable sur du CRUD pur). **Event Sourcing** = stocker les événements plutôt que l'état. On peut faire du CQRS **sans** ES. Croire que « CQRS oblige à l'event sourcing » (ou l'inverse) mène à s'infliger la complexité des deux quand un seul suffisait — souvent CQRS sans ES est le bon premier pas.

### PIÈGE #2 — Stocker l'état « pour aller plus vite » et perdre la source de vérité

« Je garde le log **et** une colonne `solde` que je mets à jour à chaque événement, comme ça la lecture est directe. » Dès que cette colonne devient une **vérité** qu'on lit sans pouvoir la reconstruire, tu n'as **plus** d'event sourcing : tu as un CRUD avec un journal décoratif. Le solde dérivé peut exister (c'est une **projection** ou un **snapshot**), mais il doit rester **jetable et reconstructible** depuis le log. La vérité, c'est le log — toujours.

### PIÈGE #3 — Muter ou supprimer un événement

Un événement est **immuable**. « Je corrige le montant du mauvais débit directement dans la ligne » **casse** tout : le replay produira un autre état que celui vécu, et l'audit ment. Pour corriger, on **ajoute** un événement compensatoire (`BUDGET_AJUSTE`). Modifier un événement passé revient à falsifier un grand livre comptable.

### PIÈGE #4 — Rejouer des side-effects vers un système externe

C'est le piège que Fowler souligne : *« if these events cause update messages to be sent to external systems, then things will go wrong because those external systems don't know the difference between real processing and replays »*. Si ton `apply` **envoie un email** ou **appelle un paiement**, un `rebuild` va **renvoyer** l'email et **re-débiter** la carte. `apply` doit être une **transition d'état pure**, **sans effet de bord**. Les effets externes vivent **ailleurs** (un handler d'événements dédié, idempotent, qui ne tourne **pas** pendant le replay).

### PIÈGE #5 — Croire le read model immédiatement à jour

Le read model est **cohérent éventuellement** (§2.8). « Je débite puis je relis le solde, il n'a pas bougé, donc mon débit a échoué » → faux : la projection n'a **pas encore** rattrapé. Concevoir l'UI et les tests en supposant une lecture **instantanée** après écriture produit des bugs fantômes (read-your-writes). Prévois une parade explicite (afficher l'intention, attendre la version, ou lire le write model).

### PIÈGE #6 — Oublier le versioning des événements

Le jour où tu changes la forme d'un événement, **les millions déjà stockés gardent l'ancienne**. Sans **weak schema** ni **upcasting**, le replay des vieux événements **plante** (champ manquant) ou produit un état faux. Anticipe : `apply` tolérant (valeur par défaut) ou fonction `upcast` en lecture. Et **jamais** de réécriture des vieux événements en base pour « les mettre au nouveau format ».

### PIÈGE #7 — Faire du snapshot une source de vérité

Un snapshot est un **cache** du replay, pas une vérité. Deux fautes : (a) ne plus pouvoir reconstruire l'état sans le snapshot (tu as perdu l'ES) ; (b) garder un snapshot d'un **format d'état périmé** après avoir changé la structure → il faut les **régénérer** par replay. Le snapshot suit le log, jamais l'inverse.

---

## 5. Ancrage TribuZen

Le **budget commun de la famille** est le candidat naturel à l'Event Sourcing dans TribuZen : domaine où l'**historique**, l'**audit** (« qui a dépensé quoi ») et les **questions temporelles** (« budget au 1er du mois ») comptent autant que le solde courant.

```
Write model (event-sourced)                Read models (projections)
  Commandes                                  ┌─ SoldeProjection      → solde courant (UI)
   Déposer / Débiter / Ajuster               ├─ RelevéProjection     → liste des mouvements
        │ valide invariant (solde ≥ 0)       ├─ RapportMensuel       → totaux par mois
        ▼                                     └─ (nouvelle vue = rejeu du log)
  Event store  budget:famille-42
   v1 BUDGET_OUVERT
   v2 ARGENT_DEPOSE {200}   ── flux ──▶ projections (cohérence ÉVENTUELLE)
   v3 BUDGET_DEBITE {32}
```

Décisions concrètes pour TribuZen :

- **Un stream par budget de famille** (`aggregateId = familyId`). Les invariants (solde ≥ 0, plafond) sont vérifiés à l'**écriture**, sur l'agrégat reconstruit par replay.
- **Concurrence optimiste** sur le stream : deux parents qui débitent en parallèle → l'un des `append` échoue (`ConcurrencyError`), la commande **relit et rejoue**. Pas de solde écrasé (le lost update du CRUD du §1 disparaît).
- **Projections asynchrones** pour l'affichage (solde, relevé, rapport). L'UI gère le **read-your-writes** en affichant optimistiquement le débit du parent avant que la projection ne rattrape.
- **Upcasting** prévu dès le départ : le jour où `BUDGET_DEBITE` gagne un champ `categorie`, les vieux événements sont upcastés en lecture (`categorie: 'non-catégorisé'`), le log reste intact.
- **Snapshots** seulement si un budget très actif devient lent à rejouer — pas avant.

Le **reste** de TribuZen n'est **pas** event-sourced : un profil utilisateur, une préférence UI, une liste de tags = **CRUD** banal. L'ES est réservé au **cœur métier à fort enjeu historique** (le budget, et plus tard la comptabilité des remboursements de sorties).

> **Défère :** la **décision** « quels bounded contexts de TribuZen méritent CQRS/ES, et à quel coût ? » = **cours 13-architecture, module 18** ; **publier de façon fiable** l'événement `BudgetDébité` vers les autres services malgré le dual-write = **module 13 (ce cours, next — outbox)** ; la **saga** qui coordonne débit budget + réservation lors d'une sortie = **module 11** ; les **garanties de livraison** du flux d'événements vers un autre service = **module 05**. Ici on a posé **le mécanisme de stockage-par-événements et ses garanties**.

---

## 6. Points clés

1. **CQRS** = deux modèles séparés, **commande** (changer, valider, ne renvoie rien) vs **requête** (lire un modèle façonné pour l'affichage). Séparation d'abord **logique** — **pas** forcément deux bases.
2. **Event Sourcing** = stocker la **séquence d'événements**, pas l'état. Le **log est la source de vérité** ; l'état est **dérivé** : `état = fold(événements)`.
3. **Événement** = fait passé **immuable** (participe passé), avec `aggregateId`, `version` (position dans le stream) et `schemaVersion` (forme du payload). On n'en modifie ni n'en supprime jamais ; on corrige en **ajoutant** un événement.
4. **Event store** = log **append-only** par stream ; **concurrence optimiste** via `expectedVersion` (+ contrainte d'unicité `(stream_id, version)`) → pas de lost update entre commandes concurrentes.
5. **Replay** = reconstruire l'état en rejouant le stream (`apply` = transition **pure, sans side-effect**). Permet les **requêtes temporelles** (rejouer jusqu'à T).
6. **Projection / read model** = vue matérialisée dérivée du flux ; **jetable et reconstructible** (`rebuild`) → on peut ajouter une vue **a posteriori** en rejouant l'historique.
7. **Le read model est cohérent ÉVENTUELLEMENT** : fenêtre entre l'écriture et la projection → problème **read-your-writes**. Parades : afficher l'intention, attendre la version, ou lire le write model.
8. **Versioning d'événements** : **weak schema** (tolérer un champ absent), **upcasting** (transformer un vieil événement en lecture), ou **nouveau type**. Jamais de réécriture des vieux événements.
9. **Snapshot** = optimisation du replay ; **pas** une source de vérité, **reconstructible**, lié à une `schemaVersion` d'état (à régénérer si le format change). À ajouter **tard**, quand le replay est lent.
10. CQRS et ES sont **séparables** : CQRS sans ES est fréquent (bon premier pas) ; l'ES appelle presque toujours des projections. **Quand** les adopter = décision d'archi → cours 13, module 18.

---

## 7. Seeds Anki

```
Qu'est-ce que CQRS et implique-t-il deux bases de données ?|CQRS (Command Query Responsibility Segregation) sépare le modèle d'écriture (commandes : changer l'état, valider, ne renvoie rien) du modèle de lecture (requêtes : lire un modèle façonné pour l'affichage). Fowler : "you can use a different model to update information than the model you use to read information". La séparation est d'abord LOGIQUE — deux bases physiques est une option avancée, pas une obligation.
Qu'est-ce que l'Event Sourcing et où est la source de vérité ?|On stocke la SÉQUENCE d'événements immuables (les changements), pas l'état courant. Le LOG est la source de vérité ; l'état est DÉRIVÉ en rejouant les événements : état = fold(événements). Fowler : "Capture all changes to an application state as a sequence of events" ; on peut "rebuild it by re-running the events from the event log on an empty application".
Comment un event store gère-t-il deux commandes concurrentes sur le même agrégat ?|Par concurrence OPTIMISTE : append(streamId, events, expectedVersion). La commande a lu le stream jusqu'à la version N ; si un autre a écrit entre-temps (stream à N+1), l'append échoue (ConcurrencyError) → la commande relit l'état et rejoue sa décision. Une contrainte d'unicité (stream_id, version) en base garantit qu'une seule écriture gagne. Pas de lost update.
Qu'est-ce qu'un replay et pourquoi apply doit-il être pur ?|Le replay reconstruit l'état d'un agrégat en repartant d'un état vide et en appliquant (apply) chaque événement du stream dans l'ordre — un fold. apply doit être une transition d'état PURE, sans side-effect : sinon un rebuild renverrait des emails et re-débiterait des paiements ("external systems don't know the difference between real processing and replays" — Fowler).
Qu'est-ce qu'une projection et pourquoi est-elle jetable ?|Une projection consomme le flux d'événements et matérialise un read model prêt à requêter (solde, relevé, rapport). Comme le log est la vérité, la projection est JETABLE et reconstructible (rebuild) en rejouant tout l'historique. Conséquence : on peut ajouter une NOUVELLE vue a posteriori et la peupler rétroactivement en rejouant le passé — impossible en CRUD.
Pourquoi le read model est-il seulement cohérent éventuellement ?|Parce que la projection tourne APRÈS l'écriture (asynchrone) : il existe une fenêtre entre "événement commité dans le store" et "projection l'a appliqué". D'où le problème read-your-writes : on débite puis on relit et on voit l'ancien solde. Parades : afficher l'intention optimistiquement, attendre que la projection atteigne la version produite, ou lire le write model juste après sa propre écriture.
Comment faire évoluer le schéma d'un événement sans casser le replay ?|Les vieux événements sont immuables et seront rejoués. Trois stratégies : weak schema / tolerant reader (apply tolère un champ absent, valeur par défaut) ; upcasting (une fonction transforme le vieil événement vers la forme courante EN LECTURE, avant apply) ; nouveau type d'événement (V2) si le sens change. Règle d'or : JAMAIS réécrire un vieil événement en base.
À quoi sert un snapshot et quels invariants respecter ?|Un snapshot sauvegarde l'état dérivé à la version N pour n'avoir à rejouer QUE les événements après N (replay plus rapide sur un long stream). Invariants : (1) ce n'est PAS la source de vérité — il doit rester jetable et reconstructible depuis le log ; (2) il est lié à une schemaVersion de l'état — à régénérer par replay si le format change. À ajouter tard, quand le replay est mesurablement lent.
CQRS et Event Sourcing sont-ils le même pattern ?|Non, ils sont séparables. CQRS = séparer read/write (utilisable sur du CRUD pur, souvent bon premier pas). Event Sourcing = stocker les événements plutôt que l'état. On peut faire CQRS sans ES. L'ES, lui, appelle presque toujours des projections (donc du CQRS) car rejouer le log à chaque lecture est intenable. Le "quand les adopter" = décision d'archi, cours 13 module 18.
Pourquoi ne stocke-t-on jamais l'état courant comme vérité en Event Sourcing ?|Parce que la source de vérité est le LOG d'événements. Un solde dérivé peut exister (projection ou snapshot) mais doit rester jetable et reconstructible depuis le log. Dès qu'on lit une colonne d'état sans pouvoir la reconstruire, on n'a plus d'event sourcing : juste un CRUD avec un journal décoratif. On corrige une erreur en AJOUTANT un événement, jamais en mutant un événement passé.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-12-cqrs-event-sourcing/README.md`. Implémenter un mini **event store** append-only (PostgreSQL via docker-compose fourni) pour le budget TribuZen : modéliser les événements, écrire l'agrégat et son **replay**, ajouter la **concurrence optimiste**, brancher une **projection** de solde, puis **reconstruire** cette projection from scratch et faire un **replay** temporel (« solde au 1er du mois »). Enfin, provoquer le piège **read-your-writes** en concurrence et l'assumer. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
