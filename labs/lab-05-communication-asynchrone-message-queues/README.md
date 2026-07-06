# Lab 05 — Communication asynchrone & message queues

> **Outcome :** à la fin, tu sais **monter une vraie file de messages** pour TribuZen — publier une tâche, la consommer avec **ack après traitement**, observer une **redélivrance** après crash, rendre le consommateur **idempotent**, et router un **poison message** vers une **DLQ** — puis **expliquer** la garantie que tu obtiens.
> **Vrai outil :** **RabbitMQ** (via `docker-compose` fourni) + un petit script Node/TypeScript avec la lib `amqplib`. Broker réel, ack réels, DLQ réelle. **Aucun harnais simulé, aucun auto-correcteur.**
> **Feedback :** le coach valide en session à la grille ci-dessous.

---

## Énoncé

Tu implémentes la file **`export.calendar`** du module (§1) : quand une sortie est créée, une **tâche d'export** part sur une queue durable, consommée par un **worker** qui « exporte » (on **simule** l'appel Google Calendar par une fonction qui échoue parfois — c'est l'effet externe faillible, pas un harnais de test).

Tu dois obtenir, sur un **vrai broker**, les comportements suivants et **savoir les provoquer** :

1. Le producteur **rend la main** sans attendre le worker.
2. Le worker **acquitte après** un export réussi → **at-least-once**.
3. Si le worker **crashe avant l'ack**, RabbitMQ **redélivre** le message (tu le déclenches et tu l'observes).
4. Le worker est **idempotent** : le même `messageId` traité deux fois n'exporte qu'une fois.
5. Un message qui échoue **N fois** part en **DLQ** au lieu de boucler.

> Pas de gap-fill : tu écris le producteur et le consommateur à partir de la page blanche. Le corrigé plus bas est une **référence de débrief**, pas un modèle à recopier.

### Setup — `docker-compose.yml` fourni

Crée ce fichier à la racine de ton dossier de lab et lance `docker compose up -d`. Console de gestion sur http://localhost:15672 (guest/guest).

```yaml
# docker-compose.yml — RabbitMQ avec console de management
services:
  rabbitmq:
    image: rabbitmq:3.13-management
    ports:
      - "5672:5672"     # AMQP (les workers se connectent ici)
      - "15672:15672"   # console web (observer queues, DLQ, redélivrances)
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
```

```bash
docker compose up -d
npm init -y && npm i amqplib && npm i -D typescript tsx @types/amqplib
```

### Livrables attendus

1. **`producer.ts`** : publie une tâche `{ messageId, sortieId }` sur la queue `export.calendar` (queue **durable**, message **persistant**) et rend la main.
2. **`worker.ts`** : consomme avec **prefetch=1**, exporte (fonction simulée faillible), **ack** en cas de succès, gère les échecs vers la **DLQ** au-delà de N tentatives, et **déduplique** sur `messageId`.
3. **Une DLQ `export.calendar.dlq`** réellement alimentée (visible dans la console à http://localhost:15672).
4. **Un court `NOTES.md`** (5-10 lignes) : quelle garantie tu as obtenue, où, et comment tu l'as **prouvée** (capture ou description de l'observation console).

---

## Étapes (en friction)

Fais-le **dans cet ordre**, sans lire le corrigé, en **écrivant** le code et en **observant** la console RabbitMQ à chaque étape :

1. **Publie et rends la main.** Écris `producer.ts` : déclare la queue `export.calendar` en **durable**, publie 3 messages `{ messageId: uuid, sortieId }` en **persistant**. Vérifie dans la console que les 3 messages sont **en attente** (aucun worker encore).
2. **Consomme avec ack après traitement.** Écris `worker.ts` avec `prefetch(1)`. Dans le handler : appelle `fakeExport(sortieId)`, puis `channel.ack(msg)` **seulement si** ça réussit. Lance-le : les 3 messages se traitent, la queue se vide.
3. **Provoque une redélivrance.** Fais échouer `fakeExport` (throw) OU tue le worker (`Ctrl-C`) **avant l'ack** sur un message. Relance : le message **réapparaît** et est **retraité**. Note dans `NOTES.md` : *pourquoi* il a été redélivré (pas d'ack reçu).
4. **Rends le worker idempotent.** Ajoute un `Set<string>` (ou une Map) des `messageId` déjà traités. Avant d'exporter : si l'ID est connu, **ack sans réexporter**. Prouve-le : republie **le même** `messageId` deux fois → un seul export effectif.
5. **Route le poison en DLQ.** Fais échouer **toujours** un message précis. Après **N=3** tentatives (compteur via header `x-retry` ou via une queue configurée avec `x-dead-letter-exchange`), publie-le sur `export.calendar.dlq` et **ack** l'original. Vérifie dans la console que la DLQ contient **1** message et que la queue principale n'est **plus bloquée**.
6. **Explique ta garantie.** Dans `NOTES.md`, réponds : « J'ai obtenu **at-least-once** parce que … » et « mon worker est idempotent parce que … ». Si tu ne peux pas l'écrire clairement, reviens à l'étape 2.

---

## Grille d'évaluation (coach)

Le coach coche. Objectif : **autonomie page blanche**, pas la beauté du code.

| # | Critère | Vert | Rouge |
|---|---------|------|-------|
| 1 | **Découplage temporel** | Le producteur publie et rend la main sans attendre le worker ; queue **durable** + message **persistant** | Le producteur attend le traitement, ou queue non durable (messages perdus au restart broker) |
| 2 | **ack après traitement** | `ack` appelé **uniquement** après un export réussi ; prefetch=1 | ack avant traitement (perte possible), ou autoAck activé |
| 3 | **Redélivrance observée** | Sait provoquer un crash/échec avant ack et **montrer** le message retraité dans la console | « Ça marche » sans avoir jamais observé une redélivrance réelle |
| 4 | **Idempotence prouvée** | Même `messageId` publié 2× → **un seul** export effectif, dédup explicite | Pas de dédup, ou « ça n'arrivera pas » |
| 5 | **DLQ réelle** | Un poison part en DLQ après N tentatives ; la DLQ est **visible et non vide** dans la console ; la queue principale n'est pas bloquée | Retries infinis, ou poison qui bloque la queue, ou DLQ « prévue » mais jamais alimentée |
| 6 | **Verbalisation de la garantie** | Sait dire « at-least-once parce que ack après traitement + redélivrance » et pourquoi l'idempotence est obligatoire | Confond at-least-once et exactly-once, ou croit que le broker garantit exactly-once |

**Seuil de réussite :** 5/6 critères au vert, dont **obligatoirement** #2 (ack après traitement) et #4 (idempotence) — les deux qui font (ou défont) la fiabilité en prod.

---

## Débrief coach — seeds de relance

Le coach ne laisse pas passer un lab « qui a l'air de marcher ». Il **sonde** (au fil, pas en rafale) :

- « Tu tues le worker pile après l'export mais avant le `ack`. Le message est où ? Qui va le retraiter, et l'export sera fait combien de fois ? »
- « Montre-moi la ligne qui empêche le double export quand le même message revient. Enlève-la : que se passe-t-il ? »
- « C'est de l'at-least-once ou de l'exactly-once ? Prouve-le avec l'ordre exact de tes deux lignes `export` et `ack`. »
- « Ton `fakeExport` échoue toujours sur un message. Sans DLQ, dessine ce qu'il arrive aux 200 messages sains derrière lui. »
- « Regarde la console : combien de messages “Unacked” quand ton worker tourne ? Pourquoi prefetch=1 change ce chiffre ? »
- « Si je te demande de traiter les exports d'une même famille **dans l'ordre**, ton design tient-il avec 3 workers ? Qu'est-ce qui casse ? »

---

## Corrigé de référence (pour le débrief — ne pas ouvrir avant d'avoir produit ton code)

**`producer.ts`** — publie et rend la main :

```ts
// producer.ts
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

const QUEUE = 'export.calendar';

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  // durable: la queue survit au redémarrage du broker
  await ch.assertQueue(QUEUE, { durable: true });

  for (let i = 0; i < 3; i++) {
    const task = { messageId: randomUUID(), sortieId: `sortie-${i}` };
    // persistent: le message est écrit sur disque, pas seulement en RAM
    ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(task)), { persistent: true });
    console.log('[PUBLISH]', task.messageId, task.sortieId);
  }

  await ch.close();
  await conn.close(); // le producteur a rendu la main : aucun worker attendu
}
main();
```

**`worker.ts`** — ack après traitement, idempotence, DLQ :

```ts
// worker.ts
import amqp from 'amqplib';

const QUEUE = 'export.calendar';
const DLQ = 'export.calendar.dlq';
const MAX_ATTEMPTS = 3;

// Dédup en mémoire pour le lab (en prod : table processed_messages).
const processed = new Set<string>();

// Simule l'appel Google Calendar : échoue de façon DÉTERMINISTE (pas de hasard, tu dois
// pouvoir reproduire l'observation). `sortie-poison` échoue toujours (→ DLQ). Les autres
// échouent UNE fois (1er passage) puis réussissent : tu vois la redélivrance, à coup sûr.
const failedOnce = new Set<string>();
async function fakeExport(sortieId: string): Promise<void> {
  if (sortieId === 'sortie-poison') throw new Error('export impossible (poison)');
  if (!failedOnce.has(sortieId)) {
    failedOnce.add(sortieId);
    throw new Error('Google Calendar timeout (échec transitoire, 1er passage)');
  }
  console.log('  [EXPORT OK]', sortieId);
}

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertQueue(QUEUE, { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.prefetch(1); // backpressure : un seul message non acquitté à la fois

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const task = JSON.parse(msg.content.toString());
    const attempts = (msg.properties.headers?.['x-retry'] ?? 0) as number;

    // 1) Idempotence : déjà traité → ack sans réexporter.
    if (processed.has(task.messageId)) {
      console.log('[DEDUP] déjà traité', task.messageId);
      ch.ack(msg);
      return;
    }

    try {
      await fakeExport(task.sortieId);   // 2) traiter…
      processed.add(task.messageId);
      ch.ack(msg);                        // …puis ack SEULEMENT si succès → at-least-once
    } catch (err) {
      if (attempts + 1 >= MAX_ATTEMPTS) {
        // 3) poison : on l'isole en DLQ et on ack l'original pour le sortir du flux
        ch.sendToQueue(DLQ, msg.content, {
          persistent: true,
          headers: { 'x-retry': attempts + 1, 'x-last-error': String(err) },
        });
        ch.ack(msg);
        console.log('[DLQ]', task.messageId, 'après', attempts + 1, 'tentatives');
      } else {
        // republish avec compteur incrémenté, puis ack l'original (retry contrôlé)
        ch.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          headers: { 'x-retry': attempts + 1 },
        });
        ch.ack(msg);
        console.log('[RETRY]', task.messageId, 'tentative', attempts + 1);
      }
    }
  });

  console.log('[WORKER] en écoute sur', QUEUE);
}
main();
```

**Pourquoi c'est correct :**
- **at-least-once** : `ch.ack(msg)` est appelé **après** `fakeExport`. Si le worker meurt avant l'ack, RabbitMQ n'a pas reçu la confirmation et **redélivre** — jamais de perte, mais doublon possible (d'où l'idempotence).
- **idempotence** : `processed.has(messageId)` court-circuite un réexport. C'est l'approximation d'exactly-once de bout en bout : le transport peut redélivrer, l'effet ne se produit qu'une fois.
- **DLQ** : après `MAX_ATTEMPTS`, le message part sur `export.calendar.dlq` et l'original est acquitté → le poison ne boucle plus et ne bloque plus la queue. Il est **visible** dans la console pour inspection.
- **prefetch(1)** : un seul message « Unacked » à la fois → un worker lent n'est pas noyé, le travail va au worker libre (backpressure).

> Le retry « republish + compteur en header » est volontairement simple pour le lab. En prod, on préfère un **dead-letter exchange** natif (`x-dead-letter-exchange` + `x-message-ttl`) ou le *maxReceiveCount* de SQS, qui gèrent le compteur côté broker.

---

## Variante J+30 (fading)

**Même exercice, contrainte ajoutée — de mémoire, en 30 minutes, sans rouvrir le module ni ce corrigé :**

TribuZen exige désormais que **les exports d'une même famille soient traités dans l'ordre de création** (sinon un « déplacé » peut écraser un « créé » plus récent). Reconçois pour CE besoin. Attendu :

1. Tu détectes que **plusieurs workers concurrents sur une queue cassent l'ordre**.
2. Tu bascules sur un modèle où l'ordre est garanti **par famille** : soit une **queue par famille**, soit un **stream partitionné par `familyId`** (clé de partition) — et tu **nommes** le mécanisme (ordre garanti **par partition**, pas globalement).
3. Tu expliques le **coût** : tu perds du parallélisme intra-famille (une famille = un consommateur à la fois), tu le gardes **entre** familles.

**Critère de réussite :** tu justifies le choix **par la contrainte d'ordre** (pas par préférence), et tu situes **exactement** où l'ordre est garanti et où il ne l'est pas.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette file se matérialise dans le backend :

```
tribuzen/
  apps/api/
    src/sorties/sorties.controller.ts   ← publish 'export.calendar' après save
    src/messaging/export.worker.ts       ← consommateur idempotent + DLQ
    src/messaging/broker.ts              ← connexion amqplib (ou SQS SDK selon l'env)
  docker-compose.yml                     ← rabbitmq pour le dev local
```

**Ce qui sera ensuite branché (hors de ce lab) :**
- Le **broker managé** en prod (Amazon SQS + DLQ via *redrive policy*) → config = **cours 12**.
- La dédup réelle : table `processed_messages(message_id, consumer, processed_at)` en Postgres, pas un `Set` en mémoire.
- La **publication fiable** depuis la transaction DB (éviter le dual-write save+publish) via **outbox** → **module 13**.

**Commit cible :**
```
feat(messaging): file export.calendar asynchrone (ack après traitement, idempotence messageId, DLQ après 3 essais)
```
