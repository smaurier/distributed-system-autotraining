# Lab 13 — Outbox pattern & reliable messaging

> **Outcome :** à la fin, tu sais rendre fiable la publication de l'événement `SortieCréée` de TribuZen malgré le **dual-write** : écrire l'événement dans une table `outbox` **dans la même transaction** que la donnée métier, publier via un **relay en polling**, provoquer un crash du relay **avant** le marquage `published_at` pour **voir** un doublon at-least-once, puis absorber ce doublon avec un **inbox** côté consumer (dédup transactionnelle par `message_id`).
> **Vrai outil :** Node.js + TypeScript, un **PostgreSQL** (données + tables `outbox`/`inbox`) et un broker **RabbitMQ**, lancés via le **docker-compose fourni**. Client Postgres réel (`pg`), client AMQP réel (`amqplib`). Aucun framework d'outbox, aucun harnais auto-correcteur : tu écris le relay et le consumer toi-même.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner qui coche à ta place.

---

## Objectif

Au module 11, la saga `createSortie` faisait « commiter localement **puis** publier un événement ». Ce lab attaque le maillon manquant : cette double écriture (base **+** broker) **n'est pas atomique**. Un crash entre les deux perd l'événement ; un retry le duplique. Tu vas :

1. reproduire le **dual-write problem** (écriture métier OK, publish perdu → `SortieCréée` jamais reçu) ;
2. le corriger avec un **transactional outbox** (métier + outbox dans une transaction locale) ;
3. écrire un **relay en polling** (`FOR UPDATE SKIP LOCKED`, clé = `aggregate_id`) ;
4. démontrer que l'outbox est **at-least-once** (crash du relay avant `published_at` → republication) ;
5. rendre le consumer **idempotent** avec un **inbox** (dédup transactionnelle, `message_id` en clé primaire).

Garantie visée de bout en bout : **aucun événement perdu** (outbox) **et aucun doublon appliqué** (inbox).

## Prérequis

- **Module 17-13** (Outbox pattern & reliable messaging) lu — dual-write, garantie « sent if and only if the transaction commits », polling vs CDC, at-least-once, inbox.
- **Module 17-11** (transactions distribuées & saga) : c'est la saga `createSortie` qu'on fiabilise ici.
- **Module 17-08** (retries, timeouts, idempotency) : at-least-once et idempotence côté consumer.
- **Module 17-05** (communication asynchrone) : garanties de livraison du broker, ordre par clé de partition.
- Docker + Docker Compose installés ; `pnpm` ; notions de transactions SQL (`BEGIN`/`COMMIT`, contrainte d'unicité).

## Mise en place

Crée le dossier de travail, dépose le `docker-compose.yml` **fourni ci-dessous** (ne le modifie pas), puis initialise le schéma.

```yaml
# docker-compose.yml (fourni — ne pas modifier)
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: tribuzen
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: tribuzen
    ports: ["5440:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tribuzen"]
      interval: 2s
      timeout: 3s
      retries: 15

  broker:
    image: rabbitmq:3-management
    ports: ["5672:5672", "15672:15672"]   # 15672 = console web (guest/guest)
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 3s
      timeout: 5s
      retries: 15
```

```sql
-- schema.sql (fourni) — une base, trois tables
CREATE TABLE sorties (
  id         UUID PRIMARY KEY,
  family_id  UUID NOT NULL,
  statut     TEXT NOT NULL DEFAULT 'PENDING'
);

-- OUTBOX : écrite dans la MÊME transaction que la donnée métier
CREATE TABLE outbox (
  id             UUID PRIMARY KEY,          -- = message_id (réutilisé pour la dédup inbox)
  aggregate_type TEXT NOT NULL,             -- 'Sortie'
  aggregate_id   UUID NOT NULL,             -- sortie.id → clé de partition (ordre par agrégat)
  event_type     TEXT NOT NULL,             -- 'SortieCréée'
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ                -- NULL = pas encore publié par le relay
);
CREATE INDEX outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;

-- INBOX : côté consumer — message_id déjà traités
CREATE TABLE inbox (
  message_id   UUID PRIMARY KEY,            -- PK → la 2e insertion viole l'unicité
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table métier côté consumer (Budget) — pour prouver "réservé une seule fois"
CREATE TABLE budget_reservations (
  sortie_id UUID PRIMARY KEY,               -- PK métier : un seul débit par sortie
  family_id UUID NOT NULL,
  amount    INTEGER NOT NULL
);
```

```bash
docker compose up -d
# attends les healthchecks : docker compose ps  → db + broker "healthy"
pnpm init && pnpm add pg amqplib uuid && pnpm add -D typescript tsx @types/pg @types/node
psql postgresql://tribuzen:dev@localhost:5440/tribuzen -f schema.sql
```

**Starter fourni** — un producteur, un relay et un consumer, tous **incomplets** :

```ts
// src/db.ts (fourni) — vrai pool Postgres, pas de mock
import { Pool } from 'pg';
export const pool = new Pool({
  connectionString: 'postgresql://tribuzen:dev@localhost:5440/tribuzen',
});

// src/broker.ts (fourni) — vraie connexion RabbitMQ
import amqp from 'amqplib';
export async function connectBroker() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertQueue('sortie.events', { durable: true });
  return ch;
}
```

```ts
// src/producer.ts — STARTER (à compléter)
import { pool } from './db';
import { randomUUID } from 'node:crypto';

export async function creerSortie(familyId: string): Promise<string> {
  // TODO Étape 1 : ouvrir UNE transaction ; insérer la sortie ET la ligne outbox ;
  // committer les deux ensemble. AUCUN publish() ici.
  throw new Error('à implémenter');
}
```

```ts
// src/relay.ts — STARTER (à compléter)
import { pool } from './db';
import { connectBroker } from './broker';

export async function relayTick(crashBeforeMark = false): Promise<void> {
  // TODO Étape 2 : SELECT ... WHERE published_at IS NULL ORDER BY created_at
  //               FOR UPDATE SKIP LOCKED ; publier chaque ligne ; marquer published_at.
  // Le flag crashBeforeMark sert l'Étape 3 (simuler le crash AVANT le marquage).
  throw new Error('à implémenter');
}
```

```ts
// src/consumer.ts — STARTER (à compléter)
import { pool } from './db';
import { connectBroker } from './broker';

export async function startBudgetConsumer(): Promise<void> {
  // TODO Étape 4 : consommer 'sortie.events' ; dédupliquer via inbox
  //               (message_id en PK) DANS la même transaction que le débit budget.
  throw new Error('à implémenter');
}
```

**Pas de gap-fill** : tu écris le producteur, le relay et le consumer en entier à partir de ces squelettes.

---

## Étapes guidées

### Étape 0 — Voir le dual-write casser (avant de le corriger)

Écris une **première version naïve** de `creerSortie` qui `INSERT` la sortie **puis** `ch.sendToQueue('sortie.events', ...)` sur deux lignes séparées. Coupe le broker (`docker compose stop broker`) juste après l'insert, ou `throw` entre les deux lignes. Constat : la sortie existe en base, **aucun** message n'arrive. `SortieCréée` est **perdu à jamais** — la saga est cassée en silence. Tu as reproduit le dual-write. Rallume le broker (`docker compose start broker`).

### Étape 1 — Transaction atomique : état + outbox

Réécris `creerSortie` : **une seule** transaction locale insère la sortie **et** la ligne `outbox`. Aucun `publish` dans le code métier.

- `BEGIN` → `INSERT INTO sorties` → `INSERT INTO outbox` → `COMMIT`.
- Le `outbox.id` est un UUID = le **message_id** (il servira à la dédup inbox).
- `aggregate_id = sortie.id`, `payload = { sortieId, familyId }`, `published_at = NULL`.
- En cas d'erreur : `ROLLBACK` — ni la sortie ni l'événement n'existent (atomicité ACID locale).

Vérifie : après un crash **juste après** le `COMMIT`, la ligne outbox est **là** (elle sera publiée par le relay). Tu as remplacé « base + broker » (2 systèmes) par « table métier + table outbox » (**1** système, 1 transaction).

### Étape 2 — Relay en polling

Écris `relayTick` : il lit les lignes non publiées et les envoie au broker.

- `SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED` — le `SKIP LOCKED` permet de lancer **deux** relays sans double-prise.
- Pour chaque ligne : `ch.sendToQueue('sortie.events', Buffer.from(payload), { messageId: row.id, persistent: true })`. La clé de partition logique est `aggregate_id` (ordre **par sortie**).
- **Après** confirmation du broker (publisher confirms ou send synchrone), `UPDATE outbox SET published_at = now() WHERE id = $1`.
- Boucle : `setInterval(() => relayTick(), 200)` avec backoff quand le batch est vide.

Lance producteur + relay + consumer minimal : `SortieCréée` arrive, `published_at` se renseigne. Le pipeline fiable est en place.

### Étape 3 — Prouver l'at-least-once (crash avant `published_at`)

Utilise le flag `crashBeforeMark` : le relay **publie** la ligne sur le broker, puis **throw AVANT** le `UPDATE ... published_at`. Au tick suivant, la ligne est toujours `published_at IS NULL` → le relay la **republie**. Le consumer reçoit `SortieCréée` **deux fois**.

- Observe le doublon (log côté consumer, ou `budget_reservations` débité 2× **si** l'inbox n'est pas encore branché).
- Conclusion à écrire : l'outbox **ne perd jamais** mais **peut dupliquer**. Ce n'est **pas** de l'exactly-once. Piège associé : **ne jamais** marquer `published_at` *avant* d'avoir publié — sinon on **perd** le message (dual-write à l'envers). On préfère toujours le doublon (rattrapable) à la perte (irrémédiable).

### Étape 4 — Idempotence côté consumer (inbox)

Rends `startBudgetConsumer` idempotent pour absorber le doublon de l'étape 3.

- À réception : `msg.properties.messageId` porte le `message_id`.
- Dans **une** transaction : `INSERT INTO inbox (message_id) VALUES ($1)` **puis** l'effet métier `INSERT INTO budget_reservations ...`.
- `message_id` est **PRIMARY KEY** de `inbox` : à la 2ᵉ livraison, l'`INSERT` inbox **viole l'unicité** → `ROLLBACK` de toute la transaction → le budget **n'est pas** débité une 2ᵉ fois. On `ack` quand même (doublon = traité).
- La dédup est **transactionnelle** (contrainte d'unicité), **pas** un `if (inbox.has(id))` applicatif racé.

Re-joue l'étape 3 avec l'inbox branché : le doublon arrive toujours, mais `budget_reservations` ne contient **qu'une** ligne. Effet net = **exactly-once**, obtenu par at-least-once delivery **+** consumer idempotent.

### Étape 5 (bonus) — Ordre & rétention

- **Ordre :** lance deux relays en parallèle. Sans `FOR UPDATE SKIP LOCKED`, ils republient et désordonnent ; avec, chaque ligne n'est prise qu'une fois. La clé `aggregate_id` garantit l'ordre **par sortie** (pas d'ordre total).
- **Rétention :** écris deux purges — `DELETE FROM outbox WHERE published_at < now() - interval '7 days'` et `DELETE FROM inbox WHERE processed_at < now() - interval '30 days'` (aligné sur la fenêtre de redélivrance du broker ; pas plus tôt, sinon un vieux doublon rouvre la porte).

---

## Grille d'évaluation (le coach coche)

- [ ] **Étape 0** — Dual-write reproduit : sortie en base **sans** message reçu (broker coupé ou throw entre les deux écritures).
- [ ] **Étape 1** — Sortie **et** ligne outbox dans **une seule** transaction ; `ROLLBACK` prouvé (erreur → ni sortie ni outbox) ; **aucun** `publish` dans le code métier.
- [ ] **Étape 2** — Relay : `WHERE published_at IS NULL ORDER BY created_at`, `FOR UPDATE SKIP LOCKED`, clé = `aggregate_id`, `published_at` marqué **après** publication.
- [ ] **Étape 3** — At-least-once démontré : crash avant marquage → **republication** observée ; explication « pas d'exactly-once au transport » écrite.
- [ ] **Étape 4** — Inbox : `message_id` en **PRIMARY KEY** ; insert inbox + effet métier dans **une** transaction ; doublon absorbé → `budget_reservations` a **une** seule ligne.
- [ ] **Transverse** — La dédup repose sur une **contrainte d'unicité transactionnelle**, jamais sur un `if` hors transaction ; `published_at` n'est **jamais** marqué avant la publication.

**Pièges guettés par le coach :** un `try/catch` autour de « write + publish » présenté comme solution (ne couvre pas le crash entre les deux) ; publier d'abord puis écrire (message fantôme) ; marquer `published_at` avant publication (perte) ; `if (inbox.has(id))` hors transaction (racé) ; croire que l'outbox seul donne l'exactly-once ; oublier la clé `aggregate_id` (désordre entre événements d'une même sortie).

---

## Coaching (relances si tu bloques)

- **« Par où commencer ? »** → Fais l'**Étape 0** en premier. Tant que tu n'as pas **vu** l'événement se perdre, l'outbox ressemble à de la complexité gratuite. Casse le dual-write, puis répare-le.
- **« Un `try/catch` autour du publish, ça suffit non ? »** → Non. Un **crash** entre l'insert et le publish n'exécute **aucun** `catch` (le process est mort), et un ACK broker perdu crée un doublon qu'aucun `catch` ne voit. La seule parade : ramener les deux écritures dans **une** transaction locale.
- **« Je publie directement dans `creerSortie`, c'est plus simple. »** → C'est exactement le dual-write. Le domaine ne doit connaître **que** la base. Le `publish` est le job d'un **processus séparé** (le relay) qui lit l'outbox.
- **« Je ne vois pas de doublon. »** → Tu testes le chemin heureux. Force le crash **avant** `published_at` (flag `crashBeforeMark`). Le doublon n'apparaît qu'à la republication de la ligne restée `NULL`.
- **« Ma dédup laisse passer un doublon en concurrence. »** → Ton `if (déjà vu)` est **hors** transaction : deux livraisons franchissent le test avant que l'une marque. Mets `message_id` en **clé primaire** et insère-le **dans la même transaction** que l'effet — la 2ᵉ échoue sur violation d'unicité.
- **« Dois-je marquer `published_at` avant ou après le publish ? »** → **Après**, et seulement après confirmation du broker. Avant = crash entre marquage et publish → message **perdu** (marqué publié mais jamais parti). Le doublon (crash après publish, avant marquage) est rattrapable par l'inbox ; la perte, non.

---

## Variante J+30 (fading)

Reprends le pipeline **de mémoire, en 40 minutes**, **sans rouvrir ce corrigé ni le module**, avec **une contrainte ajoutée** :

- Ajoute un **second consumer** `NotificationConsumer` sur la même queue (ou un fanout), avec **sa propre** logique inbox. Prouve que le crash-avant-marquage du relay envoie le doublon aux **deux** consumers, et que **chacun** l'absorbe (une seule notification, un seul débit).
- **Bonus rétention :** ajoute la purge outbox/inbox et montre qu'après purge d'un `message_id` **encore redélivrable**, un doublon serait re-traité — puis corrige le TTL pour qu'il soit **supérieur** à la fenêtre de redélivrance du broker.

**Critère de réussite :** crash relay avant marquage → doublon émis ; les deux consumers restent idempotents (1 réservation, 1 notification) ; la purge inbox ne casse la dédup que si elle est trop agressive.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, l'outbox est le **socle de fiabilité** de l'event-driven backend :

```
tribuzen/
  services/
    sorties/
      creerSortie.ts        ← insert métier + insert outbox (1 transaction)
      outbox.ts             ← schéma + repo outbox
      relay.ts              ← polling publisher (FOR UPDATE SKIP LOCKED, clé = sortieId)
    budget/
      consumer.ts           ← inbox (message_id PK) + débit, 1 transaction
```

**Différences par rapport au lab :**

- **Une table `outbox` par service** producteur (Sorties, Budget, Réservation) — jamais un `broker.publish()` direct dans le code de domaine.
- **Relay en polling au départ** (assez pour le volume beta) ; **bascule CDC/Debezium** planifiée quand la latence < 200 ms deviendra un besoin (rappels de sortie proches) — le contrat consumer (`message_id`, clé) ne change pas.
- **Clé de partition = l'id d'agrégat** (`sortieId`, `familyId`) → ordre garanti là où il compte, parallélisme entre sorties différentes.
- **Inbox systématique** sur chaque consumer : Budget ne débite jamais deux fois, Notifications n'envoie jamais deux mails pour la même sortie.
- L'outbox est ce qui rend la **saga du module 11 réellement fiable** : chaque étape écrit son événement dans **sa** transaction locale ; les compensations, elles aussi at-least-once, sont dédupliquées par l'inbox du service compensé.

**Commit cible :**

```
feat(sorties): outbox transactionnel + relay polling ; inbox idempotent côté budget
```
