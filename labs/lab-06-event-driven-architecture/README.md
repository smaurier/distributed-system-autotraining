# Lab 06 — Event-driven architecture (pub/sub, fan-out, causalité)

> **Outcome :** à la fin, tu sais concevoir et implémenter un flux event-driven TribuZen — un producteur émet **un** événement `sortie.created`, trois consommateurs indépendants y réagissent par **fan-out** (pub/sub), tu choisis **thin vs fat** par consommateur, tu propages la **causalité** (`correlationId`/`causationId`), et tu prouves le **découplage** en ajoutant un 4ᵉ consommateur sans toucher au producteur.
> **Vrai outil :** RabbitMQ (image officielle via `docker-compose`) + TypeScript (`amqplib`). Pas de harnais simulé — tu observes le fan-out réel dans la console RabbitMQ management (`http://localhost:15672`).
> **Feedback :** le coach valide en session avec la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Énoncé

Dans TribuZen, un parent crée une sortie. Cette action doit déclencher **trois réactions indépendantes** — et bientôt une quatrième — **sans** que le service `Sorties` connaisse aucune d'elles :

1. **Calendar** — exporte la sortie (a besoin du **détail complet** : titre, date, lieu → doit être **résilient** si `Sorties` est down).
2. **Push** — notifie la famille (n'a besoin que de `familyId` + `sortieId`).
3. **Audit** — écrit une ligne dans le journal (juste le type d'événement + `correlationId` + horodatage).

**Ta mission :**

- Modéliser `sortie.created` comme un **événement** (fait passé), pas une commande.
- Publier en **pub/sub** sur un exchange `fanout` (ou `topic`) RabbitMQ → chaque consommateur a **sa propre queue** (fan-out).
- Trancher **thin vs fat** pour chaque consommateur et le justifier (Calendar = fat/state transfer ; Push & Audit = thin).
- Mettre `correlationId` (constant sur toute la chaîne) et `causationId` (parent direct) dans chaque événement ; Calendar **ré-émet** `calendar.exported` en propageant la causalité.
- **Preuve du découplage** : ajouter un 4ᵉ consommateur `Search` **sans modifier une seule ligne du producteur**.

**Pas de gap-fill** — tu écris le producteur et les consommateurs à partir du starter minimal.

### Infra fournie (`docker-compose.yml`)

```yaml
# docker-compose.yml — RabbitMQ avec l'UI de management
services:
  rabbitmq:
    image: rabbitmq:3.13-management
    ports:
      - "5672:5672"     # AMQP (les workers)
      - "15672:15672"   # UI management (http://localhost:15672, guest/guest)
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Démarre l'infra : `docker compose up -d`. Installe le client : `npm i amqplib && npm i -D @types/amqplib tsx`.

### Schéma d'événement (contrat de départ, à copier)

```ts
// events.ts
export interface DomainEvent<T> {
  eventId: string;        // UUID unique — clé d'idempotence
  type: string;           // nom AU PASSÉ + version : "sortie.created.v1"
  occurredAt: string;     // ISO 8601
  correlationId: string;  // constant sur TOUTE la chaîne d'une action user
  causationId: string;    // eventId de l'événement parent (ou requestId à la racine)
  payload: T;
}

export interface SortieCreatedThin {
  sortieId: string;
  familyId: string;
}
```

### Starter minimal

```ts
// producer.ts — le service Sorties (starter)
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';

const EXCHANGE = 'tribuzen.events';

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // TODO : construire l'événement sortie.created (thin) et le publier
  //        avec routingKey 'sortie.created'. Le producteur ne connaît AUCUN consommateur.

  await ch.close();
  await conn.close();
}
main();
```

```ts
// consumer-calendar.ts — un consommateur (starter, à dupliquer pour push/audit/search)
import amqp from 'amqplib';

const EXCHANGE = 'tribuzen.events';

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // TODO : créer SA PROPRE queue durable, la bind sur 'sortie.created',
  //        consommer, traiter, ack APRÈS traitement (module 05).
}
main();
```

---

## Étapes (en friction)

1. **Producteur** — dans `producer.ts`, construis un `DomainEvent<SortieCreatedThin>` (`type: 'sortie.created.v1'`, `correlationId` = un UUID de « requête », `causationId` = ce même requestId), publie-le sur l'exchange avec la routing key `sortie.created`. Le producteur **ne référence aucun** consommateur.
2. **Fan-out** — écris `consumer-calendar.ts`, `consumer-push.ts`, `consumer-audit.ts`. **Chacun** déclare **sa propre queue durable nommée** (`q.calendar`, `q.push`, `q.audit`) bindée sur `sortie.created`. Lance les trois : dans l'UI management, vérifie que **les trois queues** reçoivent **chacune** une copie à chaque publication (c'est le fan-out).
3. **Thin vs fat** — Calendar a besoin du détail complet. Deux options : (a) rester thin et faire un `GET /sorties/{id}` (simulé par une fonction locale) ; (b) passer le producteur en **fat** (`sortie.created.v2` avec `titre/date/lieu`). Implémente **(a)** d'abord, puis bascule Calendar en **(b)** et **justifie** dans un commentaire pourquoi Calendar mérite le fat (résilience) mais pas Push.
4. **Causalité** — Calendar, après export, **ré-émet** `calendar.exported` avec le **même** `correlationId` et `causationId = evt.eventId`. Push et Audit logguent `correlationId`. Vérifie qu'en filtrant les logs sur **un** `correlationId`, tu reconstruis **toute** la chaîne.
5. **Idempotence** — publie **deux fois** le même événement (même `eventId`). Vérifie que chaque consommateur détecte le doublon (`Set` d'`eventId` traités) et **n'agit qu'une fois** (rappel module 05 : fan-out + at-least-once = doublons possibles).
6. **Preuve du découplage** — ajoute `consumer-search.ts` (queue `q.search`, bind `sortie.created`). Lance-le. Il reçoit les événements **sans que tu aies touché `producer.ts`**. C'est le livrable clé du lab.
7. **Ordre ≠ causalité** — observe que Push et Audit peuvent logguer dans n'importe quel ordre alors qu'ils ont le **même** `causationId` : l'ordre d'arrivée ne dit rien de la causalité.

---

## Corrigé complet commenté

```ts
// events.ts — le contrat partagé
import { randomUUID } from 'node:crypto';

export interface DomainEvent<T> {
  eventId: string;
  type: string;
  occurredAt: string;
  correlationId: string;
  causationId: string;
  payload: T;
}

export const EXCHANGE = 'tribuzen.events';

// fabrique : garantit un schéma cohérent + propage la causalité
export function makeEvent<T>(
  type: string,
  payload: T,
  parent: { correlationId: string; causationId: string },
): DomainEvent<T> {
  return {
    eventId: randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    correlationId: parent.correlationId, // constant sur toute la chaîne
    causationId: parent.causationId,     // parent direct
    payload,
  };
}
```

```ts
// producer.ts — le service Sorties : émet UN fait, ne commande personne
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { EXCHANGE, makeEvent } from './events';

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // Une "requête utilisateur" : sa racine de causalité.
  const requestId = randomUUID();

  // On imagine la sortie déjà sauvée en base ; on émet le FAIT.
  // THIN (event notification) : juste des ids — les consommateurs rappellent la source s'il faut.
  const evt = makeEvent(
    'sortie.created.v1',
    { sortieId: 's-42', familyId: 'fam-7' },
    { correlationId: requestId, causationId: requestId }, // racine : causation = la requête elle-même
  );

  // publish(exchange, routingKey, buffer). Le producteur ignore QUI écoute.
  ch.publish(EXCHANGE, 'sortie.created', Buffer.from(JSON.stringify(evt)), {
    persistent: true, // survit à un redémarrage du broker
    messageId: evt.eventId,
  });
  console.log(`[Sorties] published ${evt.type} corr=${evt.correlationId} id=${evt.eventId}`);

  await ch.close();
  await conn.close();
}
main();
```

```ts
// consumer-calendar.ts — FAT/state-transfer + ré-émission causale
import amqp from 'amqplib';
import { EXCHANGE, makeEvent, DomainEvent } from './events';

const seen = new Set<string>(); // idempotence : eventId déjà traités (en prod : table)

// Simule GET /sorties/{id} (utile en variante thin ; ici Calendar recevra du fat)
async function fetchSortieDetail(id: string) {
  return { sortieId: id, titre: 'Pique-nique', date: '2026-07-20', lieu: 'Parc' };
}

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

  // SA PROPRE queue durable → le fan-out livre une copie ICI, indépendante des autres subs.
  await ch.assertQueue('q.calendar', { durable: true });
  await ch.bindQueue('q.calendar', EXCHANGE, 'sortie.created');
  await ch.prefetch(1); // backpressure (module 05)

  await ch.consume('q.calendar', async (msg) => {
    if (!msg) return;
    const evt = JSON.parse(msg.content.toString()) as DomainEvent<{ sortieId: string; familyId: string }>;

    // Idempotence : fan-out + at-least-once ⇒ doublons possibles.
    if (seen.has(evt.eventId)) { ch.ack(msg); return; }

    // Ici on rappelle la source (variante thin). Pour passer en FAT, le producteur
    // mettrait titre/date/lieu dans le payload et on lirait evt.payload directement.
    const detail = await fetchSortieDetail(evt.payload.sortieId);
    console.log(`[Calendar] export ${detail.titre} corr=${evt.correlationId}`);

    // Ré-émet un FAIT en propageant la causalité : MÊME correlationId, causationId = cet eventId.
    const exported = makeEvent(
      'calendar.exported.v1',
      { sortieId: evt.payload.sortieId },
      { correlationId: evt.correlationId, causationId: evt.eventId },
    );
    ch.publish(EXCHANGE, 'calendar.exported', Buffer.from(JSON.stringify(exported)), { persistent: true });

    seen.add(evt.eventId);
    ch.ack(msg); // ack APRÈS traitement (module 05 : at-least-once choisi)
  });
  console.log('[Calendar] en écoute sur q.calendar');
}
main();
```

```ts
// consumer-push.ts — THIN : n'a besoin que des ids, pas de callback
import amqp from 'amqplib';
import { EXCHANGE, DomainEvent } from './events';

const seen = new Set<string>();

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue('q.push', { durable: true });
  await ch.bindQueue('q.push', EXCHANGE, 'sortie.created');
  await ch.prefetch(1);

  await ch.consume('q.push', (msg) => {
    if (!msg) return;
    const evt = JSON.parse(msg.content.toString()) as DomainEvent<{ sortieId: string; familyId: string }>;
    if (seen.has(evt.eventId)) { ch.ack(msg); return; }

    // Push se suffit de familyId + sortieId : thin justifié, aucun appel à la source.
    console.log(`[Push] notifie famille ${evt.payload.familyId} corr=${evt.correlationId}`);

    seen.add(evt.eventId);
    ch.ack(msg);
  });
  console.log('[Push] en écoute sur q.push');
}
main();
```

```ts
// consumer-audit.ts — THIN : trace le fait dans le journal
import amqp from 'amqplib';
import { EXCHANGE, DomainEvent } from './events';

const seen = new Set<string>();

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue('q.audit', { durable: true });
  await ch.bindQueue('q.audit', EXCHANGE, 'sortie.created');
  await ch.prefetch(1);

  await ch.consume('q.audit', (msg) => {
    if (!msg) return;
    const evt = JSON.parse(msg.content.toString()) as DomainEvent<unknown>;
    if (seen.has(evt.eventId)) { ch.ack(msg); return; }

    console.log(`[Audit] ${evt.type} at ${evt.occurredAt} corr=${evt.correlationId} cause=${evt.causationId}`);

    seen.add(evt.eventId);
    ch.ack(msg);
  });
  console.log('[Audit] en écoute sur q.audit');
}
main();
```

```ts
// consumer-search.ts — LA PREUVE DU DÉCOUPLAGE : ajouté sans TOUCHER au producteur
import amqp from 'amqplib';
import { EXCHANGE, DomainEvent } from './events';

const seen = new Set<string>();

async function main() {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672');
  const ch = await conn.createChannel();
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertQueue('q.search', { durable: true });     // nouvelle subscription
  await ch.bindQueue('q.search', EXCHANGE, 'sortie.created'); // même topic
  await ch.prefetch(1);

  await ch.consume('q.search', (msg) => {
    if (!msg) return;
    const evt = JSON.parse(msg.content.toString()) as DomainEvent<{ sortieId: string }>;
    if (seen.has(evt.eventId)) { ch.ack(msg); return; }
    console.log(`[Search] indexe ${evt.payload.sortieId} corr=${evt.correlationId}`);
    seen.add(evt.eventId);
    ch.ack(msg);
  });
  console.log('[Search] en écoute sur q.search — producteur JAMAIS modifié');
}
main();
```

**Pourquoi ce corrigé est correct :**
- Le **producteur émet un fait** (`sortie.created` au passé) et ne référence **aucun** consommateur : c'est un vrai événement, pas une commande. Supprime tous les consommateurs, `producer.ts` reste correct.
- **Fan-out réel** : chaque consommateur déclare **sa propre queue durable** bindée sur `sortie.created`. RabbitMQ livre **une copie par queue** → les trois (puis quatre) réagissent indépendamment. Un consommateur down ? Sa queue accumule, les autres ne sont pas touchés.
- **Thin par défaut, fat justifié** : Push et Audit se suffisent des ids (thin) ; Calendar montre la variante fat/callback et son intérêt (résilience). Le choix est **par consommateur**, pas global.
- **Causalité propagée** : `correlationId` constant du premier au dernier événement, `causationId` = eventId du parent. Filtrer les logs sur un `correlationId` reconstruit toute la chaîne — indispensable car le flux n'est écrit nulle part.
- **Idempotence** : `Set` d'`eventId` → publier deux fois le même événement n'agit qu'une fois (fan-out + at-least-once du module 05 ⇒ doublons attendus).
- **Découplage prouvé** : `consumer-search.ts` s'ajoute sans **une seule** modification de `producer.ts`.

Lance dans quatre terminaux (`npx tsx consumer-*.ts`), puis `npx tsx producer.ts`, et observe le fan-out dans `http://localhost:15672` (onglet Queues : `q.calendar`, `q.push`, `q.audit`, `q.search`).

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 30 minutes, sans rouvrir ce corrigé ni le module 06 :**

1. Passe le producteur en **event-carried state transfer** (`sortie.created.v2` : payload avec `titre`, `date`, `lieu`, `participants`) **tout en gardant `.v1` publié en parallèle** (deux routing keys, ou un champ `type` versionné) — les anciens consommateurs `.v1` ne doivent **pas** casser.
2. Adapte **Calendar** pour consommer le `.v2` **sans callback** (il lit tout dans le payload) et prouve sa **résilience** : coupe la fonction `fetchSortieDetail` — Calendar doit continuer à fonctionner.
3. Ajoute une **DLQ** sur `q.push` (module 05) : simule un échec permanent d'un événement et montre qu'après N tentatives il part en `q.push.dlq` sans bloquer les suivants.

**Critère de réussite :** les consommateurs `.v1` et `.v2` coexistent, Calendar fonctionne sans la source, et le poison de Push est isolé — le tout sans avoir modifié la logique de causalité.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette topologie vit ici :

```
tribuzen/
  packages/
    events/          # events.ts — schémas partagés (DomainEvent, makeEvent, versions)
    sorties/         # producer : émet sortie.created, ne connaît aucun consommateur
    calendar/        # consumer : q.calendar (state transfer, ré-émet calendar.exported)
    notifications/   # consumer : q.push (thin)
    audit/           # consumer : q.audit (journal, stream ordonné par familyId)
```

**Différences par rapport au lab :**

- Le broker sera **managé** (Amazon SNS→SQS pour le fan-out, ou un RabbitMQ managé) plutôt qu'un conteneur local — la config IAM/topics = **cours 12**.
- L'idempotence utilisera une **table `processed_events`** (pas un `Set` en mémoire qui se vide au restart).
- L'événement sera publié **de façon fiable** via le **pattern outbox** (module 13) : on n'appelle pas `publish` en dehors de la transaction DB (risque de dual-write).
- `correlationId`/`causationId` seront injectés par le **middleware de traçage** (module 16), pas construits à la main dans chaque service.

**Commit cible :**
```
feat(events): sortie.created en pub/sub — fan-out calendar/push/audit, causalité corr/causation
```
