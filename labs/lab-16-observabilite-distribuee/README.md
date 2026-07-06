# Lab 16 — Observabilité distribuée : propager le contexte à travers sync + async

> **Outcome :** à la fin, tu sais faire voyager **un seul trace id** du clic jusqu'au timeout SMTP à travers **deux services HTTP** (sync) **et une queue** (async), corréler tous les spans d'une même requête dans **Jaeger**, relier le travail asynchrone par un **span link**, et propager la **décision de sampling** pour ne jamais produire de trace à trous.
> **Vrai outil :** OpenTelemetry SDK (`@opentelemetry/api` + `@opentelemetry/sdk-node`), RabbitMQ (broker réel, `amqplib`), Jaeger all-in-one (UI réelle sur `:16686`), le tout en Docker. **Aucun harnais simulé, aucun collecteur de spans maison** — tu émets de vrais spans OTLP vers un vrai Jaeger.
> **Feedback :** le coach valide **en session, dans l'UI Jaeger** (le graphe de la trace est la preuve) — pas de test-runner auto-correcteur.

---

## Objectif

Le module 16 t'a montré **pourquoi** corréler un distribué est dur (pas de stack trace globale, pas d'horloge commune) et **comment** le contexte se transporte : `traceparent` W3C en synchrone, injection dans les **métadonnées du message** en asynchrone, **span link** quand le parent est déjà fini, propagation du **sampled flag**.

Ici tu le **fais** sur le parcours canonique TribuZen « créer une sortie » :

```
[POST /sorties] ──▶ [service Sorties] ──(HTTP sync)──▶ [service Budget]
                          │
                          └──(publish)──▶ [ RabbitMQ ]──▶ [consumer Notifications]
```

Le **cœur du lab est le DÉFI de la propagation** : garder le fil intact quand la requête franchit le réseau **puis** la queue. Tu vas même le **casser volontairement** à la queue pour voir la trace se briser dans Jaeger, puis le **réparer**.

> **Hors périmètre (déféré au cours 16-observabilite) :** le **setup détaillé** de l'OpenTelemetry SDK, le choix/tuning d'un collector, les 3 piliers logs/métriques/traces, la méthode RED/USE, les **dashboards Grafana**, l'alerting. Le fichier `tracing.ts` fourni plus bas est une **boîte noire pré-câblée** — tu ne l'édites pas ; son détail est le sujet du cours 16. Ton travail à toi, c'est **la glue de propagation**, pas l'outillage.

---

## Prérequis

- **Module 16-observabilite-distribuee lu** (trace / span / span context, `traceparent`, span link, head vs tail sampling, consistent probability sampling).
- Modules **04** (communication synchrone, headers), **05** (async, métadonnées de message), **06** (événement vs commande) frais en tête.
- **Docker + Docker Compose** installés et démarrés.
- **Node 20+** et **pnpm** (ou npm) en local.
- Notions `AsyncLocalStorage` — ici c'est OTel qui porte le contexte implicite via son propre `context`, mais le mental model « thread-local de l'async » du module s'applique tel quel.

---

## Mise en place

### 1. Le `docker-compose.yml` (fourni — colle-le tel quel)

Trois services applicatifs + un broker + Jaeger. Les trois services Node partagent la même image (même `Dockerfile`), on ne change que la commande et le `OTEL_SERVICE_NAME`.

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports:
      - "16686:16686"   # UI Jaeger  ← c'est ICI que tu vérifies tes traces
      - "4317:4317"     # OTLP gRPC (les services y poussent leurs spans)
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  rabbitmq:
    image: rabbitmq:3.13-management
    ports:
      - "5672:5672"     # AMQP
      - "15672:15672"   # console d'admin (guest/guest)
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  sorties:
    build: .
    command: node dist/sorties.js
    environment:
      OTEL_SERVICE_NAME: sorties
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
      OTEL_TRACES_SAMPLER: parentbased_traceidratio
      OTEL_TRACES_SAMPLER_ARG: "1.0"      # 100% au départ ; tu baisseras à l'étape 4
      BUDGET_URL: http://budget:3000
      RABBIT_URL: amqp://guest:guest@rabbitmq:5672
    ports:
      - "3000:3000"     # POST /sorties  ← ton point d'entrée
    depends_on:
      rabbitmq:
        condition: service_healthy

  budget:
    build: .
    command: node dist/budget.js
    environment:
      OTEL_SERVICE_NAME: budget
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
      OTEL_TRACES_SAMPLER: parentbased_traceidratio
      OTEL_TRACES_SAMPLER_ARG: "1.0"
    depends_on:
      - jaeger

  notifications:
    build: .
    command: node dist/notifications.js
    environment:
      OTEL_SERVICE_NAME: notifications
      OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4317
      OTEL_TRACES_SAMPLER: parentbased_traceidratio
      OTEL_TRACES_SAMPLER_ARG: "1.0"
      RABBIT_URL: amqp://guest:guest@rabbitmq:5672
    depends_on:
      rabbitmq:
        condition: service_healthy
```

`Dockerfile` minimal (fourni) :

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install
COPY . .
RUN pnpm build || npx tsc
CMD ["node", "dist/sorties.js"]
```

### 2. Dépendances (les vrais paquets OTel — pas de maison)

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node \
         @opentelemetry/exporter-trace-otlp-grpc \
         @opentelemetry/resources @opentelemetry/semantic-conventions \
         amqplib
pnpm add -D typescript @types/node @types/amqplib
```

### 3. `tracing.ts` — **boîte noire, tu ne l'édites pas** (détails = cours 16)

Ce fichier est importé **en tout premier** (`node -r` / `import './tracing'` en tête) par chaque service. Il branche l'exporter OTLP vers Jaeger et installe le **propagator W3C `traceparent`** par défaut. C'est le **seul** morceau d'« outillage » du lab, et il est **donné**.

```ts
// tracing.ts — pré-câblé. Le POURQUOI de chaque ligne = cours 16-observabilite.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
// Le W3CTraceContextPropagator (traceparent) est le propagator par défaut du SDK :
// inject/extract HTTP sont donc déjà gérés par le format standard du module 16.
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(), // lit OTEL_EXPORTER_OTLP_ENDPOINT
  // Sampler & service name viennent des variables OTEL_* du compose.
});
sdk.start();
process.on('SIGTERM', () => sdk.shutdown());
```

### 4. Démarrer

```bash
docker compose up --build
# UI Jaeger : http://localhost:16686
# Console RabbitMQ : http://localhost:15672  (guest / guest)
```

Déclenche une requête :

```bash
curl -XPOST localhost:3000/sorties -H 'content-type: application/json' \
  -d '{"familyId":"f_12","amount":32}'
```

Puis, dans Jaeger : `Service = sorties` → **Find Traces**. Tu dois voir apparaître **une** trace. Ton boulot dans les étapes qui suivent : faire en sorte que **tous** les maillons y figurent, reliés, du POST au sendEmail.

---

## Étapes guidées

Tu écris **toi-même** la glue de propagation dans `sorties.ts`, `budget.ts`, `notifications.ts`. Le starter de chaque service ne fait qu'importer `./tracing`, ouvrir son serveur / sa connexion RabbitMQ, et laisser des **trous marqués `// À TOI`**. Pas de gap-fill à cocher : tu produis le code.

### Étape 1 — Propagation **synchrone** (`traceparent` sur HTTP)

**But :** une seule trace relie `sorties` → `budget`, avec Sorties comme parent de Budget.

Côté **Sorties**, à la réception du POST, ouvre un span racine puis appelle Budget **en injectant** le contexte courant dans les headers sortants :

```ts
// sorties.ts (extrait — À TOI d'écrire l'injection)
import { trace, context, propagation, SpanKind } from '@opentelemetry/api';
const tracer = trace.getTracer('sorties');

async function handlePostSortie(body: { familyId: string; amount: number }) {
  const span = tracer.startSpan('POST /sorties', { kind: SpanKind.SERVER });
  await context.with(trace.setSpan(context.active(), span), async () => {
    const sortieId = 's_' + Math.floor(Math.random() * 1000);

    // 1) INJECT : sérialiser le span context courant DANS les headers HTTP sortants.
    const headers: Record<string, string> = {};
    propagation.inject(context.active(), headers); // écrit 'traceparent' (et tracestate)

    await fetch(`${process.env.BUDGET_URL}/debit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ familyId: body.familyId, amount: body.amount }),
    });

    // (étape 2) publier l'événement SortieCréée ici…
    span.setAttribute('tribuzen.sortieId', sortieId);
    span.end();
    return sortieId;
  });
}
```

Côté **Budget**, à la réception, **extrait** le contexte des headers entrants et ouvre ton span **dans** ce contexte, pour qu'il devienne enfant :

```ts
// budget.ts (extrait — À TOI d'écrire l'extraction)
import { trace, context, propagation, SpanKind } from '@opentelemetry/api';
const tracer = trace.getTracer('budget');

function onDebit(reqHeaders: Record<string, string | string[] | undefined>) {
  // 2) EXTRACT : reconstruire le contexte parent depuis les headers HTTP entrants.
  const parentCtx = propagation.extract(context.active(), reqHeaders);
  const span = tracer.startSpan('debit', { kind: SpanKind.SERVER }, parentCtx);
  //                                                                 ^^^^^^^^^ le parent
  context.with(trace.setSpan(parentCtx, span), () => {
    span.setAttribute('tribuzen.amount', 32);
    span.end();
  });
}
```

**Vérifie dans Jaeger :** relance le `curl`, ouvre la trace `sorties`. Tu dois voir **deux** spans, `POST /sorties` **parent** de `debit`, **même trace id**. Si `debit` apparaît comme une trace **séparée** → tu as oublié de passer `parentCtx` à `startSpan` (piège #4 du module : nouveau trace id par service).

### Étape 2 — Propager **à travers la queue** (le passage dur) + span link

**But :** le consumer `notifications`, réveillé plus tard, rattache son travail à la **même** trace. C'est le pic de difficulté du lab.

D'abord **observe le trou**. Dans `sorties.ts`, publie l'événement **sans** propager (état de départ volontairement cassé) :

```ts
// sorties.ts — publication NAÏVE (cassée) : aucun contexte dans le message
channel.publish('tribuzen', 'sortie.creee', Buffer.from(JSON.stringify({ sortieId })));
```

Côté `notifications.ts`, consomme et ouvre un span **sans extraction** :

```ts
// notifications.ts — consumer NAÏF (cassé)
const span = tracer.startSpan('consume sortie.creee'); // ← trace NEUVE, orpheline
```

Relance le `curl`, va dans Jaeger : le span `consume sortie.creee` forme **sa propre trace**, **déconnectée** de `POST /sorties`. **C'est exactement le trou du §1 du module** : impossible de relier le futur timeout SMTP à `s_88`. Prends une capture mentale de ce graphe cassé — c'est le symptôme à reconnaître en prod.

Maintenant **répare-le**. Le carrier n'est plus HTTP : injecte le contexte dans les **métadonnées du message** (headers AMQP), et côté consumer relie par un **span link** (le parent est déjà fini) :

```ts
// sorties.ts — publication CORRIGÉE : le contexte voyage dans les headers du message
const msgHeaders: Record<string, string> = {};
propagation.inject(context.active(), msgHeaders); // même propagator W3C, autre carrier
channel.publish(
  'tribuzen', 'sortie.creee',
  Buffer.from(JSON.stringify({ sortieId })),
  { headers: msgHeaders }, // ← le fil est glissé DANS le message
);
```

```ts
// notifications.ts — consumer CORRIGÉ : extract + SPAN LINK (pas parent/enfant)
import { trace, context, propagation, SpanKind } from '@opentelemetry/api';
const tracer = trace.getTracer('notifications');

channel.consume('notifications.q', async (msg) => {
  if (!msg) return;
  // EXTRACT depuis les métadonnées du message (pas depuis une requête HTTP)
  const producerCtx = propagation.extract(context.active(), msg.properties.headers ?? {});
  const producerSpanCtx = trace.getSpanContext(producerCtx);

  // Le span producteur est DÉJÀ terminé → on ne fait pas parent/enfant "en cours".
  // On relie par un LINK vers son span context : causalité sans hiérarchie synchrone.
  const span = tracer.startSpan('consume sortie.creee', {
    kind: SpanKind.CONSUMER,
    links: producerSpanCtx ? [{ context: producerSpanCtx }] : [],
  });

  await context.with(trace.setSpan(context.active(), span), async () => {
    try {
      await sendEmail(); // simule le timeout SMTP possible du §1
    } catch (err) {
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
  channel.ack(msg);
});
```

**Vérifie dans Jaeger :** ouvre la trace `sorties`. Le span `consume sortie.creee` doit maintenant apparaître **relié** — via un **link** (Jaeger l'affiche comme référence `FOLLOWS_FROM`), pas comme un enfant synchrone. Le **même trace id** couvre désormais `POST /sorties`, `debit`, **et** le consumer, malgré le saut de machine et le délai. Tu as recollé le §1.

> **Question de contrôle (le coach te la posera) :** pourquoi un **link** et pas un `startSpan(..., producerCtx)` comme à l'étape 1 ? → parce qu'à l'étape 1 le parent HTTP est **en cours** (il attend la réponse) ; ici le producteur a **fini** depuis longtemps. Parent/enfant modéliserait un mensonge temporel.

### Étape 3 — Correlation id vs causation id

Le trace id porte la **corrélation technique**. Ajoute maintenant la dimension **métier**, distincte, pour ne pas confondre les deux notions du module (§2.3, pièges #1 et #2).

1. Ajoute `tribuzen.sortieId` en **attribut de span** dans chaque service (déjà amorcé à l'étape 1) → c'est ton **correlation id métier** : il regroupe par **entité business**, indépendamment de l'exécution technique. Dans Jaeger, tu peux filtrer `tribuzen.sortieId=s_88` sur **plusieurs traces** (ex. la création **puis** un rappel ultérieur de la même sortie).
2. Ajoute dans les headers du message un `x-causation-id` = l'id du message **immédiatement** en amont (ici l'id de l'événement `SortieCréée`). Côté consumer, si `notifications` republie (ex. `NotifEnvoyée`), son `x-causation-id` = l'id de `SortieCréée`.

**Formule à savoir restituer sans notes :**
- **trace id** → « quelle exécution globale ? » (le parcours, technique).
- **correlation id** (`sortieId`) → « quel flux métier regrouper ? » (le **groupe**).
- **causation id** → « quel message a **directement** causé celui-ci ? » (la **chaîne** un-à-un).

Vérifie que tu peux, dans Jaeger, répondre à deux questions **différentes** : « montre tout ce qui touche `s_88` » (correlation, plusieurs traces) vs « montre CETTE requête précise » (trace id, une trace).

### Étape 4 — Sampling **cohérent** (propager la décision)

**But :** prouver qu'une trace est gardée **entièrement** ou jetée **entièrement** — jamais à trous.

1. Passe `OTEL_TRACES_SAMPLER_ARG` de `"1.0"` à `"0.5"` **sur les trois services**, garde `parentbased_traceidratio`. Relance le compose. Envoie 10 requêtes.
2. Dans Jaeger, compte les traces : environ la moitié apparaissent, et **chaque** trace visible contient **bien ses trois maillons** (`sorties`, `budget`, `notifications`). Aucune trace « moitié là ». C'est le `sampled` flag du `traceparent` (et le lien AMQP) qui transporte la décision prise à la **racine** ; `parentbased` fait que Budget et Notifications **respectent** ce verdict au lieu de retirer aux dés.

3. **Casse-le** volontairement : mets `notifications` en `OTEL_TRACES_SAMPLER=always_on` (il ignore le parent). Relance, envoie 10 requêtes. Observe dans Jaeger : des spans `consume sortie.creee` **orphelins** apparaissent pour des traces que la racine avait **jetées** → pollution + traces à trous (pièges #6). Le consumer a « re-tiré » sa propre décision.

4. **Répare :** remets `parentbased_traceidratio` partout. La cohérence revient.

**Ce que tu dois pouvoir expliquer :** head sampling (décision précoce, déterministe sur le trace id → même verdict partout) vs tail sampling (décision différée, exige une infra à état, permet « toujours garder les erreurs »). Et **pourquoi** en distribué la décision doit **voyager** : sinon, trace trompeuse.

---

## Grille d'évaluation

| Critère | Insuffisant | Attendu | Solide |
|---|---|---|---|
| **Propagation HTTP** | `debit` est une trace séparée (trace id régénéré) | `POST /sorties` parent de `debit`, même trace id | Explique inject/extract + rôle du propagator W3C sans notes |
| **Passage de la queue** | Le consumer reste orphelin, ou contexte passé « à côté » du message | Contexte injecté dans les **headers AMQP**, extrait côté consumer, même trace id de bout en bout | Sait montrer le graphe **cassé** puis **réparé** et nommer la cause exacte |
| **Span link** | Consumer modélisé en parent/enfant synchrone | Relié par un **link** vers le span context producteur | Justifie « parent déjà fini » et distingue link vs parent/enfant à l'oral |
| **Correlation vs causation** | Confond trace id / correlation / causation | Distingue les trois et sait lequel répond à quelle question | Sait exhiber dans Jaeger « tout `s_88` » (corrélation, N traces) vs « cette requête » (1 trace) |
| **Sampling cohérent** | Chaque service tire indépendamment → traces à trous non expliquées | `parentbased` partout, décision propagée, aucune trace partielle | Sait provoquer la trace à trous (always_on sur le consumer) puis la corriger, et oppose head vs tail |
| **Périmètre** | Réimplémente de l'outillage OTel/collector « pour faire propre » | Se limite à la **glue de propagation**, laisse `tracing.ts` intact | Nomme précisément ce qui relève du cours 16 (SDK, collector, Grafana, alerting) |
| **Preuve** | « ça a marché » sans montrer Jaeger | Montre le graphe de trace dans l'UI comme preuve | Lit le waterfall (durées, gap async) et le commente |

**Seuil de passage :** colonne **Attendu** atteinte sur **les 6 premiers critères**, dont impérativement *Passage de la queue* et *Span link* (le cœur distribué du lab).

---

## Coach — relances (le coach drive, il n'attend pas que tu demandes)

Le coach n'observe pas passivement : il **relance** dès qu'il te voit patiner ou survoler. Au moins ces angles-là seront poussés.

1. **Si tu montres une trace « qui marche » à l'étape 1 sans la casser à l'étape 2 :** « Publie l'événement **sans** propager, maintenant. Va dans Jaeger. Où est passé le consumer ? Décris-moi le graphe cassé **avant** de le réparer — c'est ce symptôme précis que tu dois reconnaître en prod à 3h du matin. »

2. **Si tu relies le consumer par `startSpan(..., producerCtx)` (parent/enfant) au lieu d'un link :** « Regarde l'horloge : quand le consumer démarre, le span producteur est fini depuis combien de temps ? Un parent attend-il son enfant ici ? Alors pourquoi un parent/enfant ? Quelle primitive du module exprime la causalité **sans** hiérarchie synchrone ? »

3. **Si tu confonds trace id et correlation id métier :** « Filtre `tribuzen.sortieId=s_88` dans Jaeger. Combien de traces remontent quand la même sortie est créée puis rappelée le lendemain ? Et le trace id, combien ? Lequel répond à “tout ce qui touche cette sortie” vs “cette exécution-ci” ? »

4. **Si tu laisses le sampling à `1.0` en disant “tout marche” :** « Passe à `0.5`, puis mets `always_on` sur le seul consumer. Envoie 10 requêtes. Qu'est-ce que ces spans orphelins font dans Jaeger pour des traces que la racine a jetées ? Qui a re-tiré la décision, et pourquoi c'est pire qu'inutile ? »

5. **Si tu commences à ajouter un collector / des dashboards Grafana “pour bien faire” :** « Stop — c'est le cours 16. Qu'est-ce que ton lab garantit, exactement ? Que le **fil existe et ne se casse pas**. Le reste, tu le nommes mais tu ne le codes pas ici. »

---

## Variante J+30 (fading)

**Même parcours, contraintes ajoutées, sans rouvrir ce README ni le module 16 :**

1. En **30 minutes**, repars du `docker-compose.yml` **seul** (services vidés de leur glue) et rétablis la propagation **sync + async** de mémoire, span link compris.
2. **Ajoute un quatrième maillon asynchrone :** `notifications` publie un événement `NotifEnvoyée` consommé par un service `audit`. Fais voyager le **même** trace id **sur deux sauts de queue** consécutifs (double propagation async), chacun relié par son propre **span link**. Renseigne un `x-causation-id` correct à chaque republication.
3. **Contrainte sampling :** configure une racine à `0.25` et **prouve dans Jaeger**, sur 20 requêtes, qu'aucune trace n'est partielle **malgré les deux frontières async**.

**Critère de réussite :** dans Jaeger, une trace échantillonnée montre les **cinq** spans (`sorties`, `budget`, `notifications`, `audit`) reliés du POST à l'audit, les deux gaps async matérialisés par des links, et **zéro** trace à trous.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, la propagation vit dans un module transverse partagé par tous les services backend :

```
tribuzen/
  packages/
    observability/
      src/
        tracing.ts          # bootstrap OTel (boîte noire du lab) — détails cours 16
        propagation.ts      # helpers inject/extract HTTP + AMQP (ce que tu as écrit ici)
  services/
    sorties/  budget/  notifications/  audit/
```

**Différences par rapport au lab :**

- `tracing.ts` sera **enrichi au cours 16** (collector, ressource, sampler tail, corrélation logs↔traces) ; ici il reste minimal et **donné**.
- Les helpers `inject`/`extract` AMQP deviennent un **wrapper maison autour du publish/consume** du broker TribuZen, pour qu'aucun développeur n'oublie jamais l'injection sur la frontière async (le piège #3 du module, systématisé).
- Le `correlation id` métier sera un vrai `sortieId` / `familleId` typé, importé de `packages/domain`, et non un attribut ad hoc.

**Commit cible :**

```
feat(observability): propagation traceparent W3C sync + async (span link sur la queue)
```

---

> **Rappel de périmètre :** ce lab garantit que **le fil de contexte existe et ne se casse pas** à travers HTTP **et** la queue, avec preuve dans Jaeger. Brancher un collector, tracer des dashboards Grafana, corréler les 3 piliers, définir des alertes = **cours 16-observabilite**. Ne réinvente pas l'outillage ici : tu as fait le plus dur et le plus spécifiquement distribué — la **propagation**.
