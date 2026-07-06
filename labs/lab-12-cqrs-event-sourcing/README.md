# Lab 12 — CQRS & Event Sourcing

> **Outcome :** à la fin, tu sais implémenter un **event store append-only** sur PostgreSQL pour le budget TribuZen, reconstruire un solde par **replay** (`état = fold(événements)`), protéger les écritures concurrentes par **concurrence optimiste** (`expectedVersion`), matérialiser une **projection** de solde et la **reconstruire from scratch**, ajouter un **snapshot** sans en faire une vérité, puis provoquer et assumer le **read-your-writes**.
> **Vrai outil :** Node.js + TypeScript + PostgreSQL 16 (lancé via le **docker-compose fourni dans ce README**), driver `pg`. Pas de framework d'event sourcing : tu écris le store, l'agrégat, la projection et le replay toi-même.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — **pas de test-runner auto-correcteur**. Tu écris du vrai code qui tape une vraie base.

---

## Objectif

Reprendre le budget commun de la famille TribuZen — le domaine du module, celui où le CRUD « écrase le solde » perd l'historique — et le rendre **event-sourced**. Concrètement, tu vas :

1. modéliser les événements du budget (`BUDGET_OUVERT`, `ARGENT_DEPOSE`, `BUDGET_DEBITE`) ;
2. écrire un **event store append-only** sur PostgreSQL, avec `append(streamId, events, expectedVersion)` et `readStream(streamId)` ;
3. reconstruire le solde d'un budget par **replay** (l'état n'est **jamais** stocké comme vérité) ;
4. faire respecter la **concurrence optimiste** (deux parents qui débitent en parallèle → un seul gagne) ;
5. brancher une **projection** de solde (read model matérialisé) et la **reconstruire** en rejouant tout le log ;
6. ajouter un **snapshot** comme optimisation du replay, sans en faire une source de vérité ;
7. faire un **replay temporel** (« quel était le solde au 1er du mois ? ») ;
8. provoquer volontairement le **read-your-writes** en concurrence et l'assumer.

C'est le lab de mécanisme : on **ne** décide **pas** ici « faut-il de l'ES pour ce contexte ? » (cours 13-architecture, module 18), on **construit** le mécanisme et on éprouve ses garanties réelles.

---

## Prérequis

- Docker + Docker Compose installés (`docker compose version` répond).
- Node.js 20+ et pnpm.
- Avoir lu le module `17-distributed-systems/modules/12-cqrs-event-sourcing.md` — en particulier §2.4 (event store), §2.5 (concurrence optimiste), §2.6 (replay), §2.7 (projection), §2.8 (cohérence éventuelle), §2.10 (snapshot).
- À l'aise avec un `reduce`/`fold` sur un tableau, et avec `async/await`.

---

## Mise en place

### 1. Le docker-compose (Postgres) — copie-le tel quel

Crée un dossier de travail, et dedans un fichier `docker-compose.yml` avec **exactement** ce contenu :

```yaml
# docker-compose.yml — Postgres seul, pour l'event store du budget TribuZen
services:
  eventstore-db:
    image: postgres:16
    environment:
      POSTGRES_USER: tribuzen
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: budget
    ports:
      - "5455:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tribuzen -d budget"]
      interval: 2s
      timeout: 3s
      retries: 15
```

Lance la base :

```bash
docker compose up -d
docker compose ps          # eventstore-db doit être "healthy"
```

### 2. Le projet Node

```bash
pnpm init
pnpm add pg
pnpm add -D typescript tsx @types/pg @types/node
```

Chaîne de connexion à réutiliser dans ton code :

```
postgresql://tribuzen:dev@localhost:5455/budget
```

### 3. Le schéma de l'event store — le cœur de l'append-only

Crée `schema.sql` et applique-le (`docker compose exec -T eventstore-db psql -U tribuzen -d budget < schema.sql`). **C'est la contrainte d'unicité `(stream_id, version)` qui fait vivre la concurrence optimiste au niveau base** (§2.4) :

```sql
-- schema.sql — un log append-only, un stream par agrégat (budget = family_id)
CREATE TABLE IF NOT EXISTS events (
  stream_id      TEXT        NOT NULL,
  version        INT         NOT NULL,   -- position dans LE stream de l'agrégat (1,2,3…)
  event_id       UUID        NOT NULL,
  type           TEXT        NOT NULL,   -- 'BUDGET_DEBITE'
  schema_version INT         NOT NULL DEFAULT 1,
  occurred_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB       NOT NULL,
  metadata       JSONB,
  -- interdit de réécrire une version déjà écrite : c'est L'ARBITRE de la concurrence optimiste
  PRIMARY KEY (stream_id, version)
);

-- table snapshot (étape 4) — un cache DÉRIVABLE, jamais une vérité
CREATE TABLE IF NOT EXISTS snapshots (
  stream_id      TEXT PRIMARY KEY,
  version        INT  NOT NULL,          -- jusqu'à quelle version l'état est capturé
  state_schema   INT  NOT NULL,          -- forme de l'état capturé (à régénérer si elle change)
  state          JSONB NOT NULL
);
```

> Note : il n'y a **aucune** table `budgets(solde)`. C'est volontaire — le solde n'est **pas** stocké comme vérité. Si tu ajoutes une telle colonne « pour aller plus vite », relis le PIÈGE #2 du module.

---

## Étapes d'implémentation guidées

Tu écris tout le code toi-même dans un fichier `budget.ts` (ou plusieurs, comme tu préfères). Il n'y a **pas** de harnais qui coche des cases : à chaque étape, tu écris un petit `main()` qui exécute le scénario et tu **lis la sortie / la base** pour vérifier. Le coach valide ensuite avec la grille.

### Étape 0 — Le type d'événement

Définis l'interface `DomainEvent` (voir §2.3) : `eventId`, `aggregateId`, `type`, `version`, `schemaVersion`, `occurredAt` (ISO), `payload`, `metadata?`. Rappelle-toi la distinction : `version` = **position** dans le stream (concurrence), `schemaVersion` = **forme** du payload (versioning).

### Étape 1 — Event store append-only (`append` + `readStream`)

Écris une classe `PgEventStore` branchée sur `pg`.

- `readStream(streamId): Promise<DomainEvent[]>` → `SELECT … WHERE stream_id = $1 ORDER BY version ASC`.
- `append(streamId, newEvents, expectedVersion): Promise<void>` :
  1. dans une transaction (`BEGIN … COMMIT`),
  2. **numérote** les événements `expectedVersion + 1, +2, …`,
  3. `INSERT` chacun.
  4. Si l'INSERT viole la clé primaire `(stream_id, version)` (code Postgres `23505`), **traduis** l'erreur en une `ConcurrencyError` explicite et `ROLLBACK`.

**Vérifie** : appende 3 événements sur `budget:famille-42`, puis `readStream` → tu revois tes 3 événements, versions 1-2-3, dans l'ordre. Relance ton `main` : un second append avec `expectedVersion` faux doit **échouer**.

> Ne fais **jamais** d'`UPDATE` ni de `DELETE` sur `events`. Un événement est immuable (PIÈGE #3). Pour « corriger », on **ajoute** un `BUDGET_AJUSTE`.

### Étape 2 — Agrégat + replay (`état = fold(événements)`)

Écris `BudgetAggregate` avec :

- `apply(e)` — une transition **pure** `(état, événement) -> nouvel état`, **zéro side-effect** (pas de log réseau, pas d'email — PIÈGE #4). `BUDGET_OUVERT` → solde 0 ; `ARGENT_DEPOSE` → `+montant` ; `BUDGET_DEBITE` → `-montant`.
- `loadFromHistory(events)` — repart d'un état vide et applique chaque événement : c'est le **replay** (`fold`).
- Les commandes `ouvrir()`, `deposer(montant)`, `debiter(montant)` — elles **valident l'invariant** (pour `debiter` : solde suffisant) puis **retournent** un/des événement(s), sans muter l'état directement.

Écris ensuite un `BudgetService.debiter(budgetId, montant)` qui enchaîne le **cycle complet d'une commande** (§2.6) :

```
readStream → loadFromHistory (replay) → agg.debiter() (valide + produit l'événement)
           → append(streamId, events, state.version)
```

**Vérifie** : sur un stream `OUVERT → DEPOSE 200 → DEBITE 32 → DEBITE 156`, ton replay donne **solde 12** — sans qu'aucune colonne `solde` n'existe. Tente `debiter(999)` sur un solde de 12 → l'invariant `solde insuffisant` doit rejeter la commande **avant** tout append.

### Étape 3 — Concurrence optimiste (deux parents en parallèle)

Simule deux commandes concurrentes sur **le même** budget : les deux lisent le stream à la version N, décident, puis tentent d'`append` avec `expectedVersion = N`.

- Lance-les avec `Promise.allSettled([serviceA.debiter(...), serviceB.debiter(...)])` (mêmes conditions de départ).
- **Attendu** : un `append` réussit (stream → N+1), l'autre lève `ConcurrencyError` car la version N est déjà prise.
- Implémente la **parade** : sur `ConcurrencyError`, la commande perdante **relit** le stream (nouvel état) et **rejoue** sa décision (ou abandonne si l'invariant n'est plus tenable). Re-teste : les deux débits légitimes finissent par passer, **sans lost update** (le solde final reflète les deux).

### Étape 4 — Projection (read model) + reconstruction from scratch

Écris `SoldeProjection` : un read model `Map<budgetId, number>` (ou une table `read_soldes` si tu veux aller au bout, mais la Map suffit pour le lab).

- `handle(e)` — met à jour le solde selon le type d'événement.
- `rebuild(allEvents)` — **vide** la projection puis rejoue **tout** le log : une projection est **jetable et reconstructible** (§2.7).

Ajoute une méthode `readAll()` à ton store (`SELECT … ORDER BY stream_id, version`).

**Vérifie** : peuple deux budgets via des commandes, construis la projection par `rebuild(store.readAll())`, lis les soldes. Puis **détruis** la projection (`new SoldeProjection()`), `rebuild` à nouveau → **soldes identiques**. C'est la preuve que la vue dérive du log et rien d'autre.

> Bonus « vue a posteriori » (comme l'Exemple 2 du module) : ajoute une `RapportMensuelProjection` (totaux déposé/débité par mois via `occurredAt.slice(0,7)`) **après coup**, et peuple-la en rejouant l'historique existant. Aucune migration : le passé intact suffit.

### Étape 5 — Snapshot (optimisation, PAS une vérité)

Ajoute au chargement d'agrégat une optimisation :

- avant le replay, `loadSnapshot(streamId)` → s'il existe et que `state_schema` correspond à la forme courante, **pars du snapshot** et ne rejoue **que** les événements de version `> snapshot.version`.
- après N événements appliqués (ex : tous les 50), écris/rafraîchis le snapshot (`INSERT … ON CONFLICT (stream_id) DO UPDATE`).

**Deux invariants à démontrer** (§2.10) :

1. **Supprime la table `snapshots`** (`DELETE FROM snapshots`) → tout se reconstruit **quand même** par replay complet. Le snapshot est un cache dérivable, pas la vérité.
2. Fais évoluer la forme de l'état (bump `state_schema`) → les vieux snapshots deviennent **invalides** et sont **ignorés/régénérés** par replay, jamais lus tels quels.

### Étape 6 — Replay temporel (« solde au 1er du mois »)

Ajoute `readStreamUntil(streamId, instantISO)` (filtre `occurred_at <= $2`) et rejoue **jusqu'à cet instant** : tu obtiens l'**état à l'instant T** (§2.6). **Vérifie** que le solde « au 1er du mois » diffère du solde courant, et correspond exactement à la somme des événements antérieurs à cette date.

### Étape 7 — Provoquer et assumer le read-your-writes

Fais tourner la projection **en asynchrone** (par ex. la `handle` est déclenchée par un `setTimeout`/une boucle qui draine le log, pas dans la transaction d'`append`).

1. Débite (commande OK, événement commité), puis **relis immédiatement** le solde **via la projection** → tu lis **l'ancien** solde : la projection n'a pas rattrapé. C'est le **read-your-writes** (§2.8, PIÈGE #5). Reproduis-le, ne le masque pas.
2. Choisis **une** parade et implémente-la :
   - **attendre la version** : la commande renvoie la `version` produite ; la lecture attend que la projection l'ait **atteinte** (expose la position de la projection) ;
   - **ou** lire le **write model** (replay de l'agrégat) juste après sa propre écriture ;
   - **ou** afficher l'**intention** optimiste côté appelant.
3. Re-teste : plus de « débit fantôme ».

---

## Grille d'évaluation (le coach coche)

- [ ] **E1 — Append-only** : `append`/`readStream` fonctionnent ; **aucun** `UPDATE`/`DELETE` sur `events` ; violation de `(stream_id, version)` traduite en `ConcurrencyError`.
- [ ] **E2 — Replay pur** : le solde est **dérivé** par `fold` ; **aucune** colonne `solde` comme vérité ; `apply` est **pure** (aucun side-effect) ; l'invariant `debiter` rejette avant append.
- [ ] **E3 — Concurrence optimiste** : deux commandes concurrentes → une seule gagne, l'autre `ConcurrencyError` **puis relit+rejoue** ; **pas de lost update** dans le solde final.
- [ ] **E4 — Projection** : read model correct **et** `rebuild` from scratch redonne les mêmes soldes après destruction ; (bonus) vue a posteriori peuplée par rejeu.
- [ ] **E5 — Snapshot** : accélère le replay **et** reste jetable (supprimé → tout se reconstruit) ; snapshot de format périmé **régénéré**, jamais lu tel quel.
- [ ] **E6 — Replay temporel** : « solde à l'instant T » correct et distinct du solde courant.
- [ ] **E7 — Read-your-writes** : anomalie **reproduite** (pas cachée) **puis** traitée par une parade explicite.
- [ ] **Transverse** : événements immuables au participe passé ; distinction `version` (position) vs `schemaVersion` (forme) claire dans le code.

**Pièges guettés par le coach** : stocker un `solde` lu comme vérité (CRUD déguisé) ; muter/supprimer un événement pour « corriger » ; mettre un side-effect dans `apply` (un `rebuild` renverrait tout) ; croire le read model instantané ; faire du snapshot une source de vérité irremplaçable ; confondre `version` et `schemaVersion`.

---

## Coaching (relances si tu bloques)

- **« Par où je commence ? »** → Par l'**event store** (Étape 1) et le schéma SQL. Tant que `append`/`readStream` ne tournent pas contre la vraie base, le reste n'a pas de sol. Écris 3 événements en dur, relis-les, c'est ton premier feu vert.
- **« Où je stocke le solde ? »** → **Nulle part** comme vérité. Le solde est le résultat de `loadFromHistory` sur le stream. Si tu cherches une colonne à `UPDATE`, tu es reparti en CRUD (PIÈGE #2) : le log est la seule vérité.
- **« Ma concurrence ne casse jamais, tout passe. »** → Tu testes en **séquentiel**. Lance les deux commandes avec `Promise.allSettled` **sans** `await` entre les deux, à partir du **même** `expectedVersion` lu. Le `ConcurrencyError` n'apparaît qu'en vrai parallélisme sur le même stream.
- **« Mon `rebuild` donne un solde différent à chaque fois. »** → Ton `apply` a probablement un **side-effect** ou dépend d'un état extérieur. `apply` doit être une transition **pure** : mêmes événements → même état, toujours. Rejoue mentalement `0 → +200 → −32 → −156 = 12`.
- **« Le read model est faux juste après un débit. »** → Il n'est pas faux, il est **en retard** (cohérence éventuelle, §2.8). C'est le read-your-writes attendu à l'Étape 7. Ne le « corrige » pas en rendant la projection synchrone dans l'append — assume la fenêtre et ajoute une **parade** (attendre la version, ou lire le write model).
- **« À quoi sert le snapshot si je dois pouvoir le supprimer ? »** → Justement à **rien de vital** : c'est une optimisation. Il doit accélérer le replay **et** être jetable. Le jour où tu ne peux plus reconstruire sans lui, tu as perdu l'event sourcing (PIÈGE #7).

---

## Variante J+30 (fading)

Reprends le budget event-sourced **de mémoire, en 45 minutes**, sans rouvrir ce README ni le module, avec **une contrainte ajoutée** :

- **Versioning d'événement** : `BUDGET_DEBITE` gagne un champ `categorie`. Les événements déjà écrits (schemaVersion 1) ne l'ont pas. Ajoute un **upcasting en lecture** (`readStream → map(upcast) → apply`) qui matérialise `categorie: 'non-catégorisé'` pour les vieux événements — **sans réécrire** une seule ligne en base (§2.9, PIÈGE #6). Prouve que le replay des vieux **et** des nouveaux événements produit un état cohérent.
- **Bonus** : ajoute la `RapportMensuelProjection` qui doit compter par `categorie` — et montre qu'elle fonctionne rétroactivement grâce à l'upcast, pour des mois où la catégorie n'existait pas encore.

**Critère de réussite** : les vieux événements sont rejoués sans planter, l'upcast se fait **en mémoire à la lecture** (aucun `UPDATE events`), et la nouvelle projection catégorisée se peuple par rejeu de l'historique.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, le budget event-sourced vit côté backend :

```
tribuzen/
  services/
    budget/
      eventStore.ts        ← PgEventStore : append (concurrence optimiste) / readStream / readAll
      budgetAggregate.ts   ← apply (pur) + loadFromHistory (replay) + commandes
      projections/
        soldeProjection.ts       ← read model solde courant
        rapportMensuel.ts        ← vue a posteriori, reconstructible
      upcasters.ts         ← versioning des événements en lecture
```

**Différences par rapport au lab :**

- La projection sera **persistée** (table `read_soldes`) et alimentée par un **consumer** qui suit le log, pas une `Map` en mémoire — et exposera sa **position** pour gérer proprement le read-your-writes.
- La publication de `BudgetDébité` vers les autres services (réservation, notifications) passera par un **outbox** fiable malgré le dual-write → **module 13 (next)**, pas ici.
- La **décision** « le budget mérite-t-il l'ES, et pas le reste de TribuZen ? » est déjà tranchée dans le module (§5) et cadrée au **cours 13-architecture, module 18**. Le reste (profil, préférences, tags) reste du **CRUD** banal.

**Commit cible :**

```
feat(budget): event store append-only + replay + projection solde (CQRS/ES)
```
