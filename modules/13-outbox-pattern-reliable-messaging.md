---
titre: Outbox pattern & reliable messaging
cours: 17-distributed-systems
notions: ["dual-write problem", "impossibilité d'atomicité DB + broker", "transactional outbox", "table outbox dans la même transaction locale", "garantie « sent if and only if the transaction commits »", "message relay (processus séparé)", "polling publisher", "transaction log tailing (CDC)", "WAL / binlog / logical replication", "replication slot & LSN", "Debezium & outbox event router", "polling vs CDC (latence, charge DB, ordre)", "at-least-once delivery", "duplicates au relay", "inbox pattern (dédup consumer)", "idempotence naturelle vs déduplication", "message id & clé de déduplication", "ordre de publication", "partitionnement par aggregateId", "retention / purge outbox & inbox"]
outcomes:
  - "sait expliquer le dual-write problem et pourquoi ni un try/catch ni un retry ne le résolvent"
  - "sait implémenter un transactional outbox : écrire l'événement dans une table outbox DANS la même transaction que l'écriture métier"
  - "sait décrire un message relay et comparer polling publisher et transaction log tailing (CDC/Debezium) sur latence, charge DB et ordre"
  - "sait expliquer pourquoi l'outbox est at-least-once et implémenter un inbox pattern pour dédupliquer côté consumer"
  - "sait distinguer idempotence naturelle et déduplication par message id, et concevoir un consumer idempotent"
  - "sait préserver l'ordre des événements (publication ordonnée, partitionnement par aggregateId) et gérer la rétention des tables outbox/inbox"
prerequis: ["Modules 00-12 du cours 17", "Module 05 — communication asynchrone & garanties de livraison", "Module 06 — event-driven architecture", "Module 08 — retries, timeouts, idempotency key (at-least-once, exactly-once semantics)", "Module 11 — transactions distribuées & saga (publier fiablement l'événement d'une étape)"]
next: 14-failure-modes-et-circuit-breaker
libs: []
tribuzen: "backend TribuZen — quand une sortie est créée, l'événement SortieCréée doit atteindre Budget et Notifications SANS JAMAIS être perdu ni traité deux fois ; l'outbox garantit qu'il part si et seulement si la sortie est bien enregistrée, l'inbox garantit qu'il n'est appliqué qu'une fois"
last-reviewed: 2026-07
---

# Outbox pattern & reliable messaging

> **Outcomes — tu sauras FAIRE :** expliquer le dual-write problem, implémenter un transactional outbox (événement + métier dans une seule transaction locale), comparer polling publisher et CDC/transaction log tailing, expliquer l'at-least-once et implémenter un inbox pattern pour dédupliquer, concevoir un consumer idempotent, préserver l'ordre et gérer la rétention.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module traite **la publication fiable d'un événement depuis une transaction base de données** — le maillon qui manquait au module 11. La saga suppose que chaque étape « commite localement **et** publie un message » ; ce module montre pourquoi ces deux actions ne sont **pas** atomiques (**dual-write**) et comment l'**outbox** les rend fiables. On s'appuie sur l'**idempotence** et l'**at-least-once** du **module 08**, et sur les **garanties de livraison** du broker du **module 05**. On **ne** refait **pas** ici la théorie de l'idempotency key (module 08) ni le choix du broker (module 05) ; on **ne** traite **pas** la décision d'architecture event-driven → **cours 13-architecture, modules 16-17**. Ici : le **mécanisme** outbox/inbox et ses **garanties exactes**.

## 1. Cas concret d'abord

Au module 11, la saga `createSortie` de TribuZen faisait commiter chaque étape localement **puis** publier un événement pour déclencher la suivante. Regarde la première étape de plus près — le service **Sorties** enregistre la sortie **et** doit prévenir Budget et Notifications :

```ts
// createSortie (étape 1) — CE QU'ON ÉCRIT NAÏVEMENT, et qui est PIÉGÉ
async function creerSortie(input: CreateSortieInput): Promise<void> {
  // 1) écriture métier : commit LOCAL, définitif
  const sortie = await db.sorties.insert({ ...input, statut: 'PENDING' });

  // *** CRASH ICI, ou coupure réseau vers le broker → événement JAMAIS publié ***

  // 2) publication de l'événement sur le broker (Kafka/RabbitMQ)
  await broker.publish('sortie.events', {
    type: 'SortieCréée',
    sortieId: sortie.id,
    familyId: sortie.familyId,
  });
}
```

Deux systèmes **distincts** : la base (le `insert`) et le broker (le `publish`). Il n'y a **aucune** transaction commune entre eux (2PC exclu — module 11). Donc :

- **La base commite, le `publish` échoue** (crash du process, broker injoignable) : la sortie existe, mais **personne** ne réserve les places ni ne notifie. L'événement `SortieCréée` est **perdu à jamais**. La saga est **cassée en silence**.
- **On inverse l'ordre** (publier d'abord, puis écrire) : le `publish` réussit, l'`insert` échoue → un événement **fantôme** pour une sortie qui n'existe pas.
- **Le broker reçoit, mais l'ACK se perd** avant qu'on le lise : au retry, on **republie** le même événement → **doublon**.

Un `try/catch` **ne sauve rien** : un crash **entre** les deux lignes laisse le système incohérent, et aucun `catch` ne s'exécute sur un process mort. Un retry non plus : il crée des doublons sans garantir que l'événement parte. C'est le **dual-write problem**, et il est **fondamental** — il faut un pattern dédié. Ce module te donne l'**outbox** (garantir que l'événement part **si et seulement si** la sortie est enregistrée) et l'**inbox** (garantir qu'un consumer ne l'applique **qu'une fois**), pour qu'un événement TribuZen ne soit **jamais** perdu ni traité en double.

---

## 2. Théorie complète, concise

### 2.1 Le dual-write problem

Un **dual write** = deux écritures dans **deux systèmes de stockage différents** qu'on voudrait atomiques : la **base** métier et le **broker** de messages. Comme au module 11, il n'existe **pas** de transaction ACID qui englobe les deux (2PC est écarté : microservices.io note que *« 2PC is not an option. The database and/or the message broker might not support 2PC. »*).

La conséquence est **inévitable** dès qu'on écrit puis publie séparément :

| Ordre | Ce qui casse | Résultat |
|---|---|---|
| DB OK → publish échoue / crash | l'événement ne part pas | **message perdu** (état DB à jour, reste du système ignorant) |
| publish OK → DB échoue | événement pour rien | **message fantôme** (état incohérent) |
| DB OK, publish OK, **ACK perdu** | retry republie | **doublon** au consumer |

Point clé : **ni** try/catch **ni** retry ne le résolvent. Try/catch ne couvre pas un crash **entre** les deux opérations ; retry transforme la perte en doublon. Il faut ramener les **deux** écritures dans **une seule** transaction locale. C'est exactement ce que fait l'outbox.

### 2.2 Le transactional outbox

**Idée centrale :** ne **pas** publier directement sur le broker. À la place, écrire l'événement dans une **table `outbox`** située dans **la même base** que la donnée métier, **dans la même transaction locale**. microservices.io : *« [the service] first store the message in the database as part of the transaction that updates the business entities »*.

Comme les deux `insert` (métier + outbox) sont dans **une** transaction ACID locale, ils sont **atomiques** : soit les deux sont commités, soit aucun. La garantie devient : *« Messages are guaranteed to be sent if and only if the database transaction commits »*. Plus de dual write — on a remplacé « DB + broker » (deux systèmes) par « table métier + table outbox » (**un seul** système, une seule transaction).

```ts
// createSortie avec transactional outbox — les DEUX écritures dans UNE transaction
async function creerSortie(input: CreateSortieInput): Promise<void> {
  await db.transaction(async (tx) => {
    // 1) écriture métier
    const sortie = await tx.sorties.insert({ ...input, statut: 'PENDING' });

    // 2) écriture de l'événement dans la table outbox — MÊME transaction
    await tx.outbox.insert({
      id: randomUUID(),                 // = message id (servira à la dédup inbox)
      aggregateType: 'Sortie',
      aggregateId: sortie.id,
      eventType: 'SortieCréée',
      payload: JSON.stringify({ sortieId: sortie.id, familyId: sortie.familyId }),
      createdAt: Date.now(),
      publishedAt: null,                // null = pas encore publié par le relay
    });
  }); // COMMIT atomique : sortie + ligne outbox, tout ou rien
  // Aucun publish() ici. Un processus SÉPARÉ (le relay, §2.3) s'en charge.
}
```

La table `outbox` porte au minimum : un **id** (le message id, réutilisé pour la dédup), le type et l'id de l'agrégat, le type d'événement, le **payload** sérialisé, un `createdAt`, et un `publishedAt` (marqueur « déjà publié »).

### 2.3 Le message relay — polling vs transaction log tailing

L'outbox garantit que l'événement est **stocké** de façon fiable. Reste à le **publier** sur le broker. C'est le rôle d'un **message relay** : *« A separate process then sends the messages to the message broker. »* Deux implémentations.

**A. Polling publisher.** Un processus **interroge périodiquement** la table outbox (`SELECT ... WHERE published_at IS NULL ORDER BY created_at`), publie chaque ligne sur le broker, puis la **marque publiée**. microservices.io : *« Publish messages by polling the database's outbox table. »*

```ts
// Polling publisher — boucle simple
async function pollAndPublish(): Promise<void> {
  const rows = await db.outbox
    .find({ publishedAt: null })
    .orderBy('createdAt', 'asc')   // ordre de création
    .limit(BATCH_SIZE);

  for (const row of rows) {
    await broker.publish(`${row.aggregateType.toLowerCase()}.events`, {
      key: row.aggregateId,        // clé = aggregateId → ordre par agrégat (§2.6)
      value: row.payload,
    });
    await db.outbox.update(row.id, { publishedAt: Date.now() }); // marquer publié
  }
}
// setInterval(pollAndPublish, intervalMs) — avec backoff quand la table est vide
```

Avantages : **simple**, *« Works with any SQL database »*, aucune infra en plus. Défauts : **latence** = l'intervalle de polling ; **charge** de requêtes répétées sur la DB ; et *« Tricky to publish events in order »* (voir §2.6).

**B. Transaction log tailing (CDC).** Au lieu d'interroger la table, on **lit le journal de transactions** de la base (le WAL PostgreSQL, le binlog MySQL, les streams DynamoDB) et on publie chaque insertion dans `outbox`. microservices.io : *« Tail the database transaction log and publish each message/event inserted into the outbox to the message broker. »*

L'outil de référence est **Debezium**. Sur PostgreSQL, il faut `wal_level = logical` ; Debezium crée un **replication slot** qui suit la progression via un **LSN** (Log Sequence Number) — d'où la **reprise** exacte après redémarrage. Debezium **décode** le WAL (logical decoding) et voit chaque ligne insérée dans `outbox` **au moment du commit**, sans **aucune** requête sur tes tables ; son **outbox event router** route la ligne vers le bon topic/clé Kafka. Avantages : *« No 2PC »*, *« Guaranteed to be accurate »*, latence quasi temps réel, charge quasi nulle. Défauts : *« database specific solutions »*, infra à opérer (Kafka Connect + Debezium), et *« Tricky to avoid duplicate publishing »*.

| Critère | Polling publisher | Transaction log tailing (CDC) |
|---|---|---|
| Latence | intervalle de polling (100 ms – 1 s) | quasi temps réel (WAL streamé) |
| Charge DB | requêtes `SELECT` répétées | ~nulle (lit le journal, pas les tables) |
| Complexité / infra | simple, rien à installer | Debezium + Kafka Connect à opérer |
| Portabilité | tout SQL | spécifique à la base (WAL/binlog) |
| Ordre | délicat (§2.6) | ordre du log préservé |

Règle : **commence en polling** (simple, suffisant à faible volume). Migre vers **CDC** quand la latence du polling ou la charge des `SELECT` deviennent gênantes.

### 2.4 At-least-once : pourquoi l'outbox ne fait pas de l'exactly-once

L'outbox garantit qu'un événement **n'est jamais perdu** (au-moins-une-fois), **pas** qu'il part **exactement** une fois. microservices.io est explicite : *« The Message relay might publish a message more than once. »* Scénario : le relay publie sur le broker, le broker **reçoit et traite**, mais le relay **crashe avant** d'avoir marqué la ligne `publishedAt`. Au redémarrage, il **revoit** la ligne « non publiée » et **republie**. Idem côté broker at-least-once (module 05) : un ACK perdu → redélivrance.

Donc l'outbox est structurellement **at-least-once**. Comme au module 08, on n'essaie **pas** de rendre le transport exactly-once (coûteux, fragile) ; on rend le **traitement** idempotent côté consumer : effet **exactly-once** obtenu par **at-least-once delivery + consumer idempotent**. C'est l'objet de l'inbox.

### 2.5 L'inbox pattern — déduplication côté consumer

L'**inbox** est le **symétrique** de l'outbox, côté **récepteur**. Chaque événement porte un **message id** (celui généré dans la table outbox, §2.2). Le consumer tient une table **`inbox`** des ids **déjà traités**. À réception :

1. si le message id **existe** dans l'inbox → **doublon**, on **ignore** (déjà traité) ;
2. sinon → on traite **et** on insère l'id dans l'inbox, **dans la même transaction** que l'effet métier.

L'insertion de l'id métier **et** de l'effet dans **une** transaction locale est ce qui rend le tout fiable : soit le message est traité **et** marqué, soit rien (on le reverra et rejouera).

```ts
// Consumer idempotent avec inbox — dédup par message id
async function handleSortieCréée(msg: { messageId: string; payload: string }): Promise<void> {
  await db.transaction(async (tx) => {
    // 1) déjà vu ? → doublon, on sort sans rien refaire
    const seen = await tx.inbox.findById(msg.messageId);
    if (seen) return;               // idempotent : no-op sur redélivrance

    // 2) effet métier (réserver le budget, etc.)
    await tx.budget.reserveFor(JSON.parse(msg.payload));

    // 3) marquer le message traité — MÊME transaction que l'effet
    await tx.inbox.insert({ messageId: msg.messageId, processedAt: Date.now() });
  }); // COMMIT atomique : effet + trace inbox
}
```

Point subtil : l'unicité du `messageId` doit être garantie **par la base** (clé primaire / contrainte unique). Ainsi, deux livraisons concurrentes du même message → l'une des deux transactions **échoue** sur violation d'unicité et n'applique rien. La dédup ne repose **pas** sur un `if` applicatif racé, mais sur une **contrainte transactionnelle**.

### 2.6 Ordre des événements

Le broker ne garantit l'ordre que **par partition/clé** (module 05), pas globalement. Pour que Budget applique `SortieCréée` **avant** `PlacesRéservées` d'une **même** sortie :

- **publier dans l'ordre de création** (`ORDER BY created_at` / séquence outbox — le log tailing préserve l'ordre du WAL nativement) ;
- **partitionner par `aggregateId`** : utiliser l'`aggregateId` (ex. `sortieId`) comme **clé** de partition Kafka → tous les événements d'une même sortie tombent dans la **même** partition, donc **ordonnés** entre eux. Deux sorties différentes peuvent être traitées en parallèle sans contrainte d'ordre.

On ne cherche **pas** un ordre **total** global (coûteux, rarement utile) : on veut l'ordre **par agrégat**, ce que donne le partitionnement par `aggregateId`. Le polling doit trier explicitement ; c'est là qu'il est *« tricky to publish events in order »* (plusieurs instances de publisher peuvent se marcher dessus → verrou `FOR UPDATE SKIP LOCKED` ou publisher unique par partition).

### 2.7 Rétention : purger outbox et inbox

Les deux tables **grossissent indéfiniment** si on ne les purge pas.

- **Outbox** : une fois `publishedAt` renseigné, la ligne est inutile. Purge périodique (`DELETE WHERE published_at < now - 7j`). Garder une courte fenêtre aide le diagnostic.
- **Inbox** : un id ne sert à dédupliquer que tant que le même message peut être redélivré. TTL de rétention (`DELETE WHERE processed_at < now - 30j`), aligné sur la **fenêtre de redélivrance** max du broker. Purger trop tôt = risque de re-traiter un très vieux doublon ; jamais purger = table qui enfle.

### 2.8 Vue d'ensemble : reliable messaging de bout en bout

```
Producteur (Sorties)                          Consommateur (Budget)
┌───────────────────────┐                     ┌───────────────────────┐
│ tx { sorties + outbox}│  (1 transaction)    │ tx { budget + inbox } │  (1 transaction)
└──────────┬────────────┘                     └──────────▲────────────┘
           │ relay (polling OU CDC)                      │ dédup par message id
           ▼                                             │
        ┌────────────────── Message Broker ──────────────┘
        │      (at-least-once, ordre par aggregateId)     
        └─────────────────────────────────────────────────
Garanties : aucun événement perdu (outbox) + aucun doublon appliqué (inbox + idempotence)
            → cohérence éventuelle, convergence garantie.
```

Outbox (pas de perte) **+** inbox/idempotence (pas de doublon appliqué) = messagerie **fiable** dans les deux sens, en **cohérence éventuelle**.

---

## 3. Worked examples

### Exemple 1 — Rendre l'étape 1 de la saga `createSortie` fiable (outbox)

But : passer du code piégé du §1 à une publication fiable, **sans** changer la saga du module 11.

**Étape 1 — écrire métier + outbox dans une transaction.** (Code du §2.2.) La sortie et la ligne `outbox` sont commitées ensemble. Si le process crashe **après** le commit mais **avant** toute publication : aucun problème, la ligne outbox est **là**, le relay la publiera.

**Étape 2 — un relay en polling.**

```ts
// relay.ts — polling publisher avec verrou pour tolérer plusieurs instances
async function relayTick(): Promise<void> {
  await db.transaction(async (tx) => {
    // SKIP LOCKED : deux relays concurrents ne prennent pas les mêmes lignes
    const batch = await tx.raw(`
      SELECT * FROM outbox
      WHERE published_at IS NULL
      ORDER BY created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    for (const row of batch) {
      await broker.publish(`${row.aggregateType.toLowerCase()}.events`, {
        key: row.aggregateId,               // ordre garanti PAR sortie
        value: row.payload,
        headers: { messageId: row.id },     // l'inbox dédupliquera là-dessus
      });
      await tx.outbox.update(row.id, { publishedAt: Date.now() });
    }
  });
}
setInterval(relayTick, 200); // + backoff quand batch vide (non montré)
```

**Ce que ça achète :** l'événement `SortieCréée` part **si et seulement si** la sortie est enregistrée. Un crash à n'importe quel instant ne perd **rien** : au pire, la ligne est republiée (at-least-once) — géré par l'inbox de l'exemple 2. `FOR UPDATE SKIP LOCKED` permet de scaler le relay horizontalement sans double-publier depuis deux instances.

**Étape 3 (optionnelle) — migrer en CDC.** Le jour où la latence du polling gêne, on remplace `relay.ts` par **Debezium** + son **outbox event router** : `wal_level = logical`, un connecteur pointé sur la table `outbox`, routage vers `sortie.events` avec `aggregateId` en clé. **Zéro** ligne applicative de polling ; le WAL fait le travail. Le contrat côté consumer (message id, clé) est **identique** — l'inbox ne change pas.

### Exemple 2 — Consumer Budget idempotent (inbox) face à un doublon

**Le problème.** Le relay republie `SortieCréée` (il a crashé avant `publishedAt`). Sans inbox, Budget **réserve deux fois** le budget de la famille → montant faux.

**La correction.** (Code du §2.5, appliqué à Budget.) Le `messageId` est **clé primaire** de la table `inbox`.

```ts
// budget.consumer.ts
async function onSortieCréée(msg: { messageId: string; payload: string }): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // messageId est PRIMARY KEY de inbox : la 2ᵉ insertion lèvera une erreur d'unicité
      await tx.inbox.insert({ messageId: msg.messageId, processedAt: Date.now() });

      // effet métier — commité SEULEMENT si l'insert inbox a réussi (donc 1ʳᵉ fois)
      const { familyId } = JSON.parse(msg.payload);
      await tx.budget.reserve({ familyId, amount: 32 });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return; // doublon : déjà traité → no-op idempotent
    throw e;                          // vraie erreur → laisser le broker redélivrer
  }
}
```

**Pourquoi c'est correct :**
- **1ʳᵉ livraison** : l'`insert` inbox passe, le budget est réservé, tout commite ensemble.
- **2ᵉ livraison (doublon)** : l'`insert` inbox **viole l'unicité** → la transaction **rollback** en entier, le budget **n'est pas** réservé une 2ᵉ fois, on retourne `return` (traité comme succès). La dédup est **transactionnelle**, pas un `if` applicatif racé.
- **Effet net** : at-least-once **delivery** + consumer **idempotent** = effet **exactly-once** — sans jamais tenter l'exactly-once au niveau transport.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un try/catch autour de « write + publish » suffit

Le dual-write n'est **pas** un problème de gestion d'erreur. Un **crash** entre les deux lignes n'exécute **aucun** `catch` (le process est mort). Un broker qui reçoit mais dont l'ACK se perd crée un doublon qu'aucun try/catch ne voit. La **seule** parade est de ramener les deux écritures dans **une** transaction locale (outbox).

### PIÈGE #2 — Publier d'abord, écrire ensuite (« pour ne pas perdre le message »)

Inverser l'ordre ne résout rien : si le `publish` réussit et l'`insert` échoue, on a un **message fantôme** pour une entité qui n'existe pas. Le problème est **symétrique** — aucun ordre des deux systèmes ne le règle. Il faut **un seul** système transactionnel : la base, via l'outbox.

### PIÈGE #3 — Croire que l'outbox donne l'exactly-once

L'outbox donne l'**at-least-once**, pas l'exactly-once : *« The Message relay might publish a message more than once. »* (crash entre publish et `publishedAt`). Sans **inbox/idempotence** côté consumer, tu **appliques** des doublons. Outbox **seul** = pas de perte ; il faut **outbox + inbox** pour « pas de perte **et** pas de doublon appliqué ».

### PIÈGE #4 — Dédupliquer avec un `if (inbox.has(id))` hors transaction

`if (déjà vu) return; else { traiter; marquer; }` en dehors d'une transaction est **racé** : deux livraisons concurrentes passent le `if` **avant** que l'autre ait marqué → double traitement. La dédup doit être **transactionnelle** : `messageId` en **clé primaire**, insertion de l'id **dans la même transaction** que l'effet ; la 2ᵉ échoue sur violation d'unicité.

### PIÈGE #5 — Marquer `publishedAt` avant d'avoir publié

Si le relay met `publishedAt = now` **avant** que le broker ait confirmé, un crash entre les deux **perd** le message (ligne marquée publiée mais jamais partie) — on retombe dans le dual-write, à l'envers. Ordre correct : **publier**, obtenir l'ACK broker, **puis** marquer. Le risque restant (crash après ACK, avant marquage) est un **doublon** — acceptable, car l'inbox l'absorbe. On **préfère** toujours le doublon (rattrapable) à la perte (irrémédiable).

### PIÈGE #6 — Oublier l'ordre et le partitionnement

Publier sans clé de partition = Budget peut recevoir `PlacesRéservées` **avant** `SortieCréée` de la **même** sortie → il traite un événement dont le contexte n'existe pas encore. Utiliser l'`aggregateId` comme **clé** garantit l'ordre **par agrégat**. Avec plusieurs instances de polling, sans `FOR UPDATE SKIP LOCKED` (ou publisher unique par partition), deux relays **republient** et **désordonnent**.

### PIÈGE #7 — Ne jamais purger outbox/inbox

Les deux tables grossissent sans fin. Une outbox énorme ralentit le `SELECT ... WHERE published_at IS NULL` (même avec index). Purger l'outbox après publication (`published_at` ancien) et l'inbox après le TTL de redélivrance du broker. Mais **pas trop tôt** pour l'inbox : purger un id encore redélivrable rouvre la porte aux doublons.

---

## 5. Ancrage TribuZen

L'outbox est le **socle de fiabilité** de tout l'event-driven de TribuZen : chaque événement métier passe par une table outbox, chaque consumer par une inbox.

**`SortieCréée` (le cas du §1)** — c'est le worked example 1 :

```
Service Sorties                                Service Budget
  tx { sorties.insert + outbox.insert }          tx { inbox.insert + budget.reserve }
  relay (polling → puis Debezium/CDC)   ──▶ broker ──▶ consumer idempotent
  clé = sortieId (ordre par sortie)              dédup par messageId (PK inbox)
```

Décisions concrètes pour TribuZen :

- **Une table `outbox` par service** producteur (Sorties, Budget, Réservation). L'événement est écrit **dans la transaction métier** — jamais un `broker.publish()` direct dans le code de domaine.
- **Relay en polling au départ** (`FOR UPDATE SKIP LOCKED`, tri par `createdAt`), assez pour le volume beta. **Bascule CDC/Debezium** planifiée quand la latence < 200 ms deviendra un besoin (rappels de sortie proches).
- **Clé de partition = l'id d'agrégat** (`sortieId`, `familyId` pour le budget) → ordre garanti là où il compte (les événements d'une même sortie), parallélisme entre sorties différentes.
- **Inbox systématique** sur chaque consumer, `messageId` en **clé primaire** : Budget ne réserve **jamais** deux fois, Notifications n'envoie **jamais** deux mails pour la même sortie (doublon relay ou redélivrance broker absorbés).
- **Rétention** : purge outbox à 7 jours après publication, inbox à 30 jours (> fenêtre de redélivrance du broker).

**Lien avec la saga (module 11) :** l'outbox est ce qui rend la saga **réellement** fiable. Chaque étape (`creerSortie`, `reserverPlaces`, `debiterBudget`) écrit son événement **dans sa transaction locale** via outbox ; les compensations (`release`, `credit`) publient de même. C'est pourquoi les compensations doivent être **idempotentes** (module 11, piège #6) : elles arrivent **at-least-once** via ce pipeline, et l'inbox du service compensé les déduplique.

> **Défère :** la **décision** d'aller event-driven et le cadrage archi → **cours 13-architecture, modules 16-17** ; la théorie de l'**idempotency key** et de l'exactly-once **semantics** → **module 08** ; le **choix et la config du broker** (partitions, ACK, DLQ) → **module 05** ; les **modes de panne** du relay et du consumer (circuit breaker) → **module 14 (suivant)**. Ici on a posé le **mécanisme** outbox/inbox et ses garanties.

---

## 6. Points clés

1. **Dual-write problem** : écrire en base **et** publier sur un broker ne sont **pas** atomiques (pas de 2PC) → message perdu, fantôme ou doublon. Ni try/catch ni retry ne le résolvent.
2. **Transactional outbox** : écrire l'événement dans une **table outbox de la même base**, **dans la même transaction** que la donnée métier → *« sent if and only if the transaction commits »*. Deux systèmes ramenés à un seul.
3. **Message relay** : un **processus séparé** publie les lignes outbox sur le broker, puis les marque `publishedAt`. Deux implémentations.
4. **Polling publisher** : interroge la table (`WHERE published_at IS NULL ORDER BY created_at`) — simple, tout SQL, mais latence = intervalle, charge DB, ordre délicat.
5. **Transaction log tailing (CDC)** : lit le **WAL/binlog** (Debezium, replication slot + LSN, outbox event router) — temps réel, charge ~nulle, mais spécifique à la base et infra à opérer.
6. **At-least-once** : le relay *« might publish a message more than once »* (crash avant `publishedAt`) → l'outbox **ne perd pas**, mais **peut dupliquer**. Pas d'exactly-once au transport.
7. **Inbox pattern** : côté consumer, table des **message ids déjà traités** ; dédup **transactionnelle** (`messageId` en clé primaire, id + effet dans une transaction). At-least-once **delivery** + consumer **idempotent** = effet **exactly-once**.
8. **Ordre** : publier dans l'ordre de création + **partitionner par `aggregateId`** (clé) → ordre garanti **par agrégat**, pas d'ordre total coûteux. `FOR UPDATE SKIP LOCKED` pour scaler le relay sans désordre.
9. **Rétention** : purger l'outbox après publication (jours), l'inbox après le TTL de redélivrance (semaines) — ni fuite mémoire, ni purge trop tôt qui rouvre les doublons.

---

## 7. Seeds Anki

```
Qu'est-ce que le dual-write problem ?|Vouloir écrire en base ET publier sur un broker de façon atomique, alors que ce sont deux systèmes distincts sans transaction commune (2PC exclu). Selon l'ordre : message perdu (DB ok, publish échoue), message fantôme (publish ok, DB échoue) ou doublon (ACK perdu → retry). Ni try/catch (le crash entre les deux n'exécute aucun catch) ni retry ne le résolvent.
Comment le transactional outbox résout-il le dual-write ?|On n'écrit plus directement sur le broker : on insère l'événement dans une table outbox de la MÊME base, dans la MÊME transaction que l'écriture métier. Les deux insert sont atomiques (ACID local) → l'événement est stocké si et seulement si la transaction commite. On a remplacé "DB + broker" (2 systèmes) par "table métier + table outbox" (1 seul système transactionnel).
Qu'est-ce qu'un message relay et quelles sont ses deux formes ?|Un processus SÉPARÉ qui lit les lignes non publiées de la table outbox et les publie sur le broker, puis les marque publiées. Forme A : polling publisher (SELECT WHERE published_at IS NULL, simple, tout SQL, latence = intervalle). Forme B : transaction log tailing / CDC (lit le WAL/binlog via Debezium, temps réel, charge ~nulle, mais spécifique à la base).
Polling publisher vs CDC : quels compromis ?|Polling : simple, aucune infra, marche sur tout SQL ; mais latence = intervalle de polling, charge de SELECT répétés, ordre délicat. CDC (Debezium, WAL/binlog, replication slot + LSN) : latence quasi temps réel, charge ~nulle sur la DB, ordre du log préservé ; mais spécifique à la base et infra à opérer (Kafka Connect). Commencer en polling, migrer en CDC quand la latence/charge gêne.
Pourquoi l'outbox est-il at-least-once et pas exactly-once ?|Parce que le relay peut publier plus d'une fois : il publie sur le broker puis marque publishedAt ; s'il crashe entre les deux, il revoit la ligne "non publiée" et republie. Le broker at-least-once peut aussi redélivrer. L'outbox ne PERD jamais, mais peut DUPLIQUER. On n'essaie pas l'exactly-once au transport ; on rend le consumer idempotent (inbox).
Qu'est-ce que l'inbox pattern ?|Le symétrique de l'outbox côté consumer : une table des message ids déjà traités. À réception, si le messageId existe → doublon, on ignore ; sinon on traite ET on insère l'id dans l'inbox, dans la MÊME transaction que l'effet métier. Le messageId est clé primaire → une 2e livraison viole l'unicité et rollback tout. Dédup transactionnelle, pas un if applicatif racé.
Comment obtient-on un effet exactly-once sans exactly-once delivery ?|Par at-least-once delivery (outbox + broker) + consumer idempotent (inbox ou opération naturellement idempotente). Le message peut arriver plusieurs fois, mais l'effet n'est appliqué qu'une fois (dédup par message id en clé primaire, ou UPSERT / SET absolu au lieu d'INCREMENT). Effet net = exactly-once, sans jamais tenter l'exactly-once fragile au niveau transport.
Comment préserve-t-on l'ordre des événements avec un outbox ?|Publier dans l'ordre de création (ORDER BY created_at, ou l'ordre du WAL en CDC) ET partitionner par aggregateId : en utilisant l'aggregateId comme clé de partition Kafka, tous les événements d'un même agrégat tombent dans la même partition, donc ordonnés entre eux. On vise l'ordre par agrégat, pas l'ordre total (coûteux). Avec plusieurs relays : FOR UPDATE SKIP LOCKED ou un publisher unique par partition.
Faut-il marquer publishedAt avant ou après avoir publié, et pourquoi ?|APRÈS avoir publié et reçu l'ACK du broker. Marquer avant = si crash entre marquage et publish, le message est perdu (marqué publié mais jamais parti) → dual-write à l'envers. Marquer après = le risque restant est un doublon (crash après ACK, avant marquage), absorbé par l'inbox. On préfère toujours le doublon rattrapable à la perte irrémédiable.
Comment gère-t-on la rétention des tables outbox et inbox ?|Outbox : purger les lignes publiées après quelques jours (DELETE WHERE published_at ancien) — sinon la table enfle et ralentit le polling. Inbox : purger les ids après un TTL aligné sur la fenêtre de redélivrance max du broker (semaines) — pas trop tôt, sinon un vieux doublon redélivré serait re-traité.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-13-outbox-pattern-reliable-messaging/README.md`. Implémenter le **transactional outbox** de TribuZen pour l'événement `SortieCréée` : table `outbox` écrite dans la transaction métier, **relay en polling** vers le broker, puis **inbox** côté consumer pour dédupliquer. Via un docker-compose fourni (Postgres + broker), provoquer un crash du relay **avant** `publishedAt` pour observer la republication, et vérifier que l'inbox absorbe le doublon. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
