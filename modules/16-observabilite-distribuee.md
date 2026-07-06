---
titre: Observabilité distribuée — traçage à travers services & queues
cours: 17-distributed-systems
notions:
  - "pourquoi tracer un système distribué est un défi (pas de stack trace globale, pas d'horloge commune)"
  - "trace = parcours complet d'une requête"
  - "span (unité de travail)"
  - "relation parent/enfant entre spans (parent_id = span_id du parent)"
  - "span context (trace id + span id + trace-flags + tracestate, immuable)"
  - "correlation id vs causation id vs trace id"
  - "propagation de contexte (context propagation)"
  - "propagator : inject / extract via un carrier"
  - "en-tête traceparent (W3C trace-context : version-trace-id-parent-id-trace-flags)"
  - "en-tête tracestate (données vendor-specific)"
  - "propagation en synchrone (headers HTTP)"
  - "propagation en asynchrone (injecter le contexte dans les métadonnées du message)"
  - "span links (relation causale entre traces, utile pour l'async)"
  - "sampled flag (bit de poids faible des trace-flags)"
  - "head sampling vs tail sampling"
  - "consistent probability sampling (décision déterministe basée sur le trace id)"
  - "propagation de la décision de sampling (traces sans trous)"
  - "AsyncLocalStorage (contexte implicite par requête)"
outcomes:
  - "sait expliquer pourquoi corréler les logs/traces d'un système distribué est un problème que le monolithe n'a pas"
  - "sait distinguer trace, span, span context, et la relation parent/enfant entre spans"
  - "sait distinguer correlation id, causation id et trace id, et dire lequel sert à quoi"
  - "sait propager un contexte de trace à travers une chaîne d'appels synchrones via l'en-tête traceparent (W3C trace-context)"
  - "sait propager ce même contexte à travers une frontière asynchrone (queue) en l'injectant dans les métadonnées du message, et l'extraire côté consumer"
  - "sait pourquoi un span traversant un gap async se relie par un span link plutôt que par une relation parent/enfant directe"
  - "sait pourquoi la décision de sampling doit être propagée (consistent probability sampling) pour éviter les traces à trous"
prerequis:
  - "Module 01 — communication réseau, échec partiel, latence"
  - "Module 04 — communication synchrone (REST/gRPC, headers)"
  - "Module 05 — communication asynchrone, brokers, métadonnées de message"
  - "Module 06 — event-driven architecture (événement vs commande)"
  - "Module 07 — API gateway & BFF (point d'entrée, cross-cutting)"
  - "Module 14 — failure modes (cascades, panne dans un service, effet dans un autre)"
next: 17-testing-distribue
libs: []
tribuzen: "backend TribuZen — suivre une seule requête « créer une sortie » à travers la gateway, le service Sorties, l'appel synchrone au Budget, puis la queue vers Notifications, avec un seul trace id qui traverse le sync ET l'async"
last-reviewed: 2026-07
---

# Observabilité distribuée — traçage à travers services & queues

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi corréler un système distribué est dur, distinguer trace/span/span context, distinguer correlation/causation/trace id, propager un contexte de trace en synchrone via `traceparent`, le propager à travers une queue en l'injectant dans les métadonnées du message, relier un span à travers un gap async par un span link, et propager la décision de sampling pour éviter les traces à trous.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module traite **le défi DISTRIBUÉ du traçage** : comment un **contexte** (le fil qui relie les morceaux d'une même requête) **traverse** des services, un réseau, et surtout une **queue** asynchrone. On va au cœur de la **propagation de contexte** : format `traceparent`, injection/extraction, span links pour l'async, cohérence du sampling. On **ne** couvre **pas** ici le **setup outillé de l'observabilité** — installer et configurer **OpenTelemetry SDK**, brancher un **collector**, stocker dans **Jaeger/Tempo**, tracer des dashboards **Prometheus/Grafana**, définir des alertes, les 3 piliers (logs/métriques/traces) en détail : tout ça est le sujet du **cours 16-observabilite**. Ici, on isole **le problème que le distribué ajoute** : sans propagation de contexte, aucun outil, aussi bon soit-il, ne pourra recoller une requête éclatée sur cinq services et deux queues.

## 1. Cas concret d'abord

Dans TribuZen, un parent crée une **sortie**. Une seule action utilisateur, mais côté backend la requête **traverse quatre étapes**, dont une **asynchrone** :

```
[Client] ──POST /sorties──▶ [API Gateway] ──▶ [Service Sorties]
                                                     │
                                     (sync) appel HTTP au [Service Budget]
                                                     │
                                     publie un événement dans une [Queue]
                                                     ▼
                                          (async) [Consumer Notifications]
```

À 14h03, un parent se plaint : « j'ai créé la sortie mais personne n'a reçu la notification ». Tu ouvres les logs. Chaque service écrit dans **son propre** flux :

```
# logs Gateway
14:03:01.102  POST /sorties  ->  routing sortie-service

# logs Sorties
14:03:01.140  sortie créée id=s_88   budget: appel...
14:03:01.201  budget OK, event SortieCréée publié

# logs Budget
14:03:01.180  débit 32€ famille f_12  OK

# logs Notifications (consumer)
14:03:07.400  ERROR  envoi notif échoué: SMTP timeout
```

**Le problème n'est pas d'avoir les logs — c'est de savoir qu'ils parlent de la MÊME requête.** Le monolithe n'avait pas ce souci : une requête = un thread = une stack trace = un fichier, dans l'ordre. Ici :

- **Rien ne relie** la ligne `14:03:07.400` du consumer à la sortie `s_88` créée 6 secondes plus tôt sur une **autre machine**.
- Il y a un **trou temporel** (le message a attendu dans la queue) : l'ordre chronologique brut ne suffit pas, et les horloges des machines ne sont **pas** parfaitement synchrones (module 19).
- La **cause** (SMTP down) est dans un service, l'**effet** perçu (« pas de notif ») chez le parent, l'**origine** (la requête) dans un troisième.

Tu voudrais poser **une** question — « montre-moi TOUT ce qui s'est passé pour la création de `s_88` » — et obtenir le fil complet, du clic au timeout SMTP, **à travers les quatre services et la queue**. C'est exactement ce qu'un **trace id propagé** permet. Ce module montre comment ce fil se **transporte** : facile en synchrone (un header HTTP), piégeux en asynchrone (il faut le glisser dans le message lui-même). Le **stockage** et la **visualisation** de ce fil, eux, sont l'affaire du cours 16 ; ici on s'assure que le fil **existe** et ne se **casse pas** sur la queue.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi tracer un distribué est un problème neuf

En monolithe, la corrélation est **gratuite** : un appel = une pile d'appels dans **un** processus, un `try/catch` remonte toute l'erreur, un `grep correlationId app.log` suffit. En distribué, trois choses cassent d'un coup :

- **Pas de stack trace globale** : l'appel se fragmente en N processus ; chacun ne voit que **sa** portion.
- **Pas d'horloge commune** : classer les événements par timestamp brut est faux (horloges désynchronisées → module 19).
- **Cause et effet dissociés** : la panne est dans un service, elle se **manifeste** dans un autre.

La réponse est de **transporter un identifiant partagé** d'un bout à l'autre de la requête : c'est la **propagation de contexte** (§2.4). Tout le reste (le stockage des traces, les métriques, les dashboards) se **construit dessus** — et relève du cours 16.

### 2.2 Trace, span, span context

Vocabulaire standard (OpenTelemetry / W3C), les briques du traçage :

- **Span** — *« a span represents a unit of work or operation »*. C'est **une** opération sur **un** service (traiter la requête HTTP, faire l'appel Budget, consommer le message). Un span porte un nom, des timestamps début/fin, un statut, des attributs.
- **Trace** — le **parcours complet** d'une requête à travers l'application, *« potentially spanning multiple processes, services, or data centers »*. Une trace est un **arbre de spans**.
- **Relation parent/enfant** — *« A child span's `parent_id` field matches its parent's `span_id`, and both share the same `trace_id` »*. C'est ce qui **structure** l'arbre : le span « appel Budget » est l'enfant du span « traiter POST /sorties ».
- **Span context** — *« an immutable object on every span »* qui contient *« the Trace ID […] the span's Span ID »* plus les **trace-flags** et le **trace state**. **C'est le span context — et lui seul — qu'on propage** d'un service à l'autre : c'est le strict nécessaire pour que le service suivant crée un span **enfant** dans la **même trace**.

```
trace_id = 4bf92f3577b34da6a3ce929d0e0e4736   (partagé par TOUS les spans)

span POST /sorties        span_id=00f0..  parent=∅       (root)
  └─ span appel Budget    span_id=a1b2..  parent=00f0..
  └─ span publie event    span_id=c3d4..  parent=00f0..
       ┆ (queue — gap async)
  span consume Notif      span_id=e5f6..  parent=∅  link→c3d4..
```

### 2.3 Correlation id, causation id, trace id — ne pas confondre

Trois identifiants qui voyagent souvent ensemble mais **ne servent pas à la même chose** :

| Id | Répond à la question | Portée |
|---|---|---|
| **trace id** | « quelle requête globale ? » | **tous** les spans d'un même parcours partagent le **même** trace id |
| **span id** | « quelle opération précise ? » | **unique par span** ; le parent d'un span référence le span id du span appelant |
| **correlation id** | « quel flux métier corréler ? » | souvent = le trace id (ou un id business propagé de bout en bout) pour **regrouper** les logs |
| **causation id** | « **qui** a directement causé CE message ? » | l'id du message/commande **immédiatement** en amont (chaînage causal, pas le flux entier) |

La distinction clé est **correlation vs causation** dans les systèmes à messages :
- **correlation id** = « tous ces événements appartiennent au même workflow » (l'équivalent applicatif du trace id).
- **causation id** = « ce message-ci a été produit **en réaction directe** à ce message-là ». Il forme la **chaîne de causalité** un-à-un, alors que le correlation id forme le **groupe** entier.

En pratique moderne, le **trace id** (W3C) porte la corrélation technique, et l'`parent-id`/span id porte la causalité span-à-span. Un correlation/causation id **métier** reste utile quand tu veux corréler par entité business (ex. `sortieId`) indépendamment du traçage technique.

### 2.4 Propagation de contexte en synchrone : `traceparent`

La **propagation de contexte** est *« the mechanism that moves context between services and processes. It serializes or deserializes the context object »*. Le **contexte** est *« an object that contains the information for the sending and receiving service […] to correlate one signal with another »* : quand A appelle B, A y met *« a trace ID and span ID so Service B can create a new span belonging to the same trace »*.

Le mécanisme s'appuie sur un **propagator** qui fait deux opérations symétriques sur un **carrier** (ici, les headers HTTP) :
- **inject** — sérialiser le span context courant DANS les headers sortants (côté appelant) ;
- **extract** — désérialiser le span context DEPUIS les headers entrants (côté appelé).

Le format standard est l'en-tête **`traceparent`** de la spec **W3C Trace Context**. Structure : `version-trace-id-parent-id-trace-flags`.

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                                │                │
   version ──┘  └── trace-id (16 octets,         └─ parent-id     └─ trace-flags
   (00)            32 hex, ≠ que des zéros)          (span appelant,   (8 bits ;
                                                     8 octets, 16 hex)  bit sampled)
```

Faits **W3C** (vérifiés) :
- **version** : *« 1 byte […] Version `ff` is invalid. […] `version` is set to `00` »*.
- **trace-id** : 16 octets = **32 caractères hex minuscules** ; *« all bytes as zero […] is considered an invalid value »*.
- **parent-id** : 8 octets = **16 hex** ; c'est le **span id de l'appelant** (qui deviendra le parent du span créé par l'appelé). Zéro = invalide.
- **trace-flags** : 8 bits, *« currently, only one bit is used »* → le **sampled flag** (§2.6).

Un second en-tête, **`tracestate`**, transporte des paires clé/valeur **vendor-specific** : *« to provide additional vendor-specific trace identification information across different distributed tracing systems »*. Tu le **relaies** tel quel sans le comprendre.

**En Node, on ne trimballe pas le contexte à la main partout** : on utilise **`AsyncLocalStorage`**, qui garde un contexte **implicite** attaché à la requête en cours (l'équivalent d'un « thread-local » pour l'async). On lit le contexte au moment d'`inject`, on le restaure au moment d'`extract`.

### 2.5 Le point dur : propager à travers une **queue** (async)

En synchrone, le carrier est évident : les **headers HTTP** partent avec l'appel. En asynchrone, **il n'y a pas d'appel HTTP** : le producteur **publie** un message, s'en va, et un consumer le traite **plus tard**, sur une **autre** machine. Deux difficultés :

**(a) Le carrier change.** Le span context ne peut plus voyager dans des headers HTTP ; il faut l'**injecter dans les métadonnées du message** (message headers / attributes selon le broker — module 05). Le producteur `inject` dans les headers du message ; le consumer `extract` depuis ces headers au lieu d'une requête HTTP. **Si tu oublies cette injection, la trace se casse net à la queue** : le consumer démarre une trace **neuve**, sans lien avec l'origine — exactement le trou du §1.

**(b) Le parent est déjà fini.** Quand le consumer traite le message, le span producteur est **terminé** (souvent depuis plusieurs secondes). Une relation parent/enfant « en cours » n'a plus de sens : le parent n'attend pas l'enfant. On utilise alors un **span link**. OTel : *« Links exist so that you can associate one span with one or more spans, implying a causal relationship »*, et ils sont *« particularly useful for asynchronous operations »*. Le span du consumer **pointe** (link) vers le span context du producteur : on garde la **causalité** (« ce traitement vient de cet envoi ») sans imposer une hiérarchie parent/enfant synchrone.

```
Producteur (t=1s)                     Consumer (t=7s)
span "publie event" ─┐                ┌─ span "consume Notif"
  inject span_ctx     │                │   extract span_ctx du message
  dans headers msg    │   [ Queue ]    │   crée un span avec LINK → span_ctx
                      └───────msg──────┘   (pas parent/enfant : le parent est fini)
```

Retiens : **synchrone → propager dans les headers HTTP, relation parent/enfant** ; **asynchrone → injecter dans les métadonnées du message, relation par span link**.

### 2.6 Sampling en distribué : la décision doit se propager

Tracer **100 %** du trafic coûte cher (stockage, réseau) : *« sampling is one of the most effective ways to reduce the costs of observability without losing visibility »*. Deux stratégies :

- **Head sampling** — la décision « je garde / je jette » est prise **tôt**, *« not made by inspecting the trace as a whole »*. L'approche standard est le **consistent probability sampling** (aka deterministic sampling), qui *« makes a sampling decision based on the trace ID and the desired percentage of traces to sample »*. Simple et efficace, mais **ne peut pas** décider sur des données qui n'existent pas encore (ex. tu ne peux **pas** garantir de capturer toutes les traces en erreur).
- **Tail sampling** — la décision est **différée** jusqu'à *« considering all or most of the spans within the trace »* : on peut alors « toujours garder les traces en erreur », ou celles au-dessus d'un seuil de latence. Plus riche, mais **exige une infra à état** (bufferiser tous les spans d'une trace avant de décider).

**Le piège spécifiquement distribué** : si **chaque service** décidait **indépendamment** de sampler ou non, une trace serait gardée par le service A, jetée par B, gardée par C → une trace **à trous**, inexploitable. La parade tient en un mot : **propager la décision**. Le **sampled flag** (le bit de poids faible des `trace-flags` du `traceparent`, valeur `01`) voyage **avec** le contexte ; chaque service **respecte** la décision déjà prise par la racine au lieu de rejouer un tirage. Le consistent probability sampling renforce ça : comme la décision dérive du **trace id** (partagé), tout service qui recalcule tombe sur **le même** verdict. Résultat : une trace est **entièrement** gardée ou **entièrement** jetée.

### 2.7 Ce que ce module NE fait PAS (défère au cours 16)

On a posé **le fil** (le contexte) et sa **propagation** à travers sync et async. On **défère explicitement** au **cours 16-observabilite** tout l'**outillage** qui exploite ce fil : installer l'**OpenTelemetry SDK** et l'auto-instrumentation, configurer un **collector**, choisir/opérer un backend de traces (**Jaeger**, **Tempo**, Datadog APM), les **3 piliers** logs/métriques/traces et leur corrélation, la **méthode RED/USE**, les **dashboards Grafana**, les **health checks** et l'**alerting**. Ici, la seule question était : *comment le contexte survit-il au voyage à travers un système distribué, queues comprises ?*

---

## 3. Worked examples

### Exemple 1 — Propager le contexte à travers la chaîne **synchrone** TribuZen

But : qu'un **seul** trace id relie Gateway → Sorties → Budget, via `traceparent`, avec `AsyncLocalStorage` pour ne pas passer le contexte à la main.

```ts
// context.ts — le contexte implicite par requête (thread-local de l'async)
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface SpanContext {
  traceId: string;   // 16 octets = 32 hex, partagé par toute la trace
  spanId: string;    // 8 octets = 16 hex, propre à CE span
  sampled: boolean;  // décision de sampling, propagée telle quelle
}
const als = new AsyncLocalStorage<SpanContext>();

const hex = (bytes: number) => randomBytes(bytes).toString('hex');
export const currentContext = () => als.getStore();
export const runWithContext = <T>(ctx: SpanContext, fn: () => T) => als.run(ctx, fn);
```

```ts
// w3c.ts — inject / extract au format W3C trace-context (le "propagator")
import type { SpanContext } from './context';

// EXTRACT : lire le span context depuis un header traceparent entrant
export function extractTraceparent(header: string | undefined): SpanContext | null {
  if (!header) return null;
  // version-traceId-parentId-flags  ->  ex: 00-4bf9...-00f0...-01
  const [version, traceId, parentId, flags] = header.split('-');
  if (version !== '00' || traceId?.length !== 32 || parentId?.length !== 16) return null;
  return {
    traceId,                              // on CONSERVE le trace id (même trace)
    spanId: parentId,                     // le span appelant devient notre parent
    sampled: (parseInt(flags, 16) & 0x01) === 1, // bit de poids faible = sampled
  };
}

// INJECT : sérialiser le contexte courant dans un header traceparent sortant
export function injectTraceparent(ctx: SpanContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}
```

```ts
// service-sorties.ts — reçoit la requête, appelle Budget en propageant
import { runWithContext, currentContext } from './context';
import { extractTraceparent, injectTraceparent } from './w3c';
import { randomBytes } from 'node:crypto';

async function handlePostSortie(req: { headers: Record<string, string | undefined> }) {
  // 1) EXTRACT : reprendre la trace ouverte par la Gateway (ou en démarrer une)
  const incoming = extractTraceparent(req.headers['traceparent']);
  const ctx = incoming ?? {
    traceId: randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    sampled: true,
  };

  // 2) Ce service crée SON span : nouveau spanId, MÊME traceId
  const mySpan = { ...ctx, spanId: randomBytes(8).toString('hex') };

  await runWithContext(mySpan, async () => {
    log('sortie créée', { sortieId: 's_88' });        // log corrélé (voir plus bas)
    await callBudget();                                // propage automatiquement
  });
}

async function callBudget() {
  const ctx = currentContext()!;
  // 3) INJECT : le span courant part dans le header vers Budget
  await fetch('http://budget:3000/debit', {
    method: 'POST',
    headers: { traceparent: injectTraceparent(ctx) }, // <- le fil traverse le réseau
    body: JSON.stringify({ familyId: 'f_12', amount: 32 }),
  });
}

// log qui joint AUTOMATIQUEMENT le trace id → tous les logs deviennent corrélables
function log(message: string, meta: Record<string, unknown> = {}) {
  const ctx = currentContext();
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'sorties',
    traceId: ctx?.traceId,   // <- LA clé : filtrer par ce champ = tout le parcours
    spanId: ctx?.spanId,
    message, ...meta,
  }));
}
```

**Ce que ça achète :** Budget reçoit `traceparent`, `extract` **conserve le trace id**, crée son propre span enfant → les logs de Sorties **et** de Budget portent le **même** `traceId`. La question du §1 (« montre-moi tout `s_88` ») devient un simple filtre `traceId = 4bf9…`. Le `sampled` traverse aussi : les deux services garderont ou jetteront la trace **ensemble** (§2.6).

### Exemple 2 — Faire traverser le contexte à la **queue** (le passage dur)

But : que le consumer Notifications, réveillé 6 s plus tard, rattache son travail à la **même** trace — via injection dans les **métadonnées du message** et un **span link**.

```ts
// producer (dans service Sorties) — publier l'événement SortieCréée
import { currentContext } from './context';
import { injectTraceparent } from './w3c';

async function publishSortieCreee(broker: Broker, sortieId: string) {
  const ctx = currentContext()!;
  await broker.publish('sortie.creee', {
    body: { sortieId },
    // CLÉ : le contexte NE part PAS dans un header HTTP (il n'y en a pas).
    // On l'injecte dans les MÉTADONNÉES du message.
    headers: { traceparent: injectTraceparent(ctx) },
  });
}
```

```ts
// consumer (service Notifications) — réveillé PLUS TARD, sur une AUTRE machine
import { runWithContext } from './context';
import { extractTraceparent } from './w3c';
import { randomBytes } from 'node:crypto';

async function onSortieCreee(msg: { body: { sortieId: string }; headers: Record<string, string> }) {
  // EXTRACT depuis les métadonnées du message (pas depuis une requête HTTP)
  const producerCtx = extractTraceparent(msg.headers['traceparent']);

  // Le span producteur est DÉJÀ terminé (message resté en queue) :
  // on ne fait pas un parent/enfant "en cours" -> on relie par un SPAN LINK.
  const mySpan = {
    traceId: producerCtx?.traceId ?? randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    sampled: producerCtx?.sampled ?? true,
    link: producerCtx ? { traceId: producerCtx.traceId, spanId: producerCtx.spanId } : undefined,
  };

  await runWithContext(mySpan, async () => {
    try {
      await sendEmail(msg.body.sortieId);
    } catch (err) {
      // Cette erreur est maintenant RELIÉE à s_88 par le trace id + le link
      log('envoi notif échoué', { error: (err as Error).message });
      throw err;
    }
  });
}
```

**Pourquoi c'est correct :** sans l'`injectTraceparent` côté producer, `msg.headers['traceparent']` serait vide, `extract` renverrait `null`, et le consumer démarrerait une **trace orpheline** → le trou du §1 revient. Avec l'injection, le consumer **conserve le trace id** et pose un **span link** vers le span producteur : on relie causalement le timeout SMTP à la création de `s_88`, **malgré** les 6 secondes et le changement de machine. La relation est un **link** (et non parent/enfant) précisément parce que le parent était **déjà fini** — le cas d'usage canonique du span link en asynchrone.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre correlation id (ou trace id) et span id

Le **trace id** identifie **toute la requête** (partagé par tous les spans) ; le **span id** identifie **une** opération (unique). Filtrer les logs par span id ne te montre qu'**un** service ; c'est le **trace id** qui recolle le parcours entier. Et un **correlation id métier** (ex. `sortieId`) n'est pas le trace id : il regroupe par **entité business**, pas par exécution technique.

### PIÈGE #2 — Confondre correlation et causation

Le **correlation id** dit « ces messages appartiennent au même workflow » (le **groupe**). Le **causation id** dit « ce message a été produit **en réaction directe** à cet autre » (la **chaîne** un-à-un). Utiliser l'un pour l'autre casse soit le regroupement, soit la reconstruction de la causalité fine.

### PIÈGE #3 — Oublier de propager le contexte sur la frontière **async**

C'est **le** piège du module. En synchrone, le `traceparent` part « tout seul » dans les headers HTTP. Sur une **queue**, il n'y a pas de header HTTP : si tu n'**injectes pas** le contexte dans les **métadonnées du message**, le consumer démarre une trace **neuve**. La trace se **casse net** à la queue — le symptôme exact du §1 (« impossible de relier le timeout SMTP à la sortie »).

### PIÈGE #4 — Générer un **nouveau** trace id à chaque service

« Chaque service crée son id au démarrage de la requête. » Faux pour le **trace id** : on l'**extrait** de l'amont et on le **conserve**. Ce qu'on crée de neuf à chaque étape, c'est le **span id** (l'opération locale). Régénérer le trace id = autant de traces isolées qu'il y a de services.

### PIÈGE #5 — Relier un span async par parent/enfant au lieu d'un span link

Quand le consumer traite un message, le span producteur est **déjà terminé**. Le modéliser en parent/enfant « en cours » est incorrect (le parent n'attend pas l'enfant, l'écart peut être de minutes). La bonne primitive est le **span link** : il exprime la **causalité** sans imposer une hiérarchie synchrone — c'est son cas d'usage désigné pour l'asynchrone.

### PIÈGE #6 — Laisser chaque service décider du sampling indépendamment

Si A garde, B jette, C garde, tu obtiens une trace **à trous** — pire qu'inexploitable, **trompeuse**. La décision de sampling se **propage** (le **sampled flag** dans `traceparent`) et/ou se **recalcule de façon déterministe** à partir du **trace id** (consistent probability sampling) : ainsi une trace est gardée **entièrement** ou jetée **entièrement**.

### PIÈGE #7 — Croire que ce module « fait de l'observabilité »

Propager un contexte ne **stocke**, n'**agrège** et ne **visualise** rien. Sans un backend (Jaeger/Tempo), un collector, des dashboards, tu as un fil mais pas de tableau de bord. Ce module garantit que le **fil existe et ne se casse pas** ; l'**outillage** qui l'exploite est le **cours 16** — ne réinvente pas l'OTel SDK ici.

---

## 5. Ancrage TribuZen

TribuZen enchaîne des requêtes qui **traversent** plusieurs services **et** au moins une queue — le terrain type de la propagation de contexte.

**Le parcours « créer une sortie » (le cas du §1), tracé de bout en bout :**

```
trace_id = 4bf9…  (UN seul, du clic au timeout SMTP)

span Gateway  POST /sorties               (root, sampled=01)
  └─ span Sorties  handlePostSortie        parent = Gateway
       ├─ span Budget  débit 32€           parent = Sorties   (sync, traceparent HTTP)
       └─ span Sorties  publie SortieCréée  parent = Sorties
            ┆ queue (métadonnées: traceparent injecté)
  span Notifications  consume + sendEmail   LINK → span "publie"  (async)
```

Décisions concrètes pour TribuZen :

- **Un `AsyncLocalStorage`** par service porte le span context de la requête courante → les logs joignent le `traceId` **sans** le passer en argument partout.
- **`traceparent` (W3C)** sur **tous** les appels HTTP internes (Gateway↔Sorties↔Budget) : format standard, compatible avec n'importe quel backend futur (cours 16), pas de header maison.
- **Injection du `traceparent` dans les métadonnées** de **chaque** message publié (`SortieCréée`, `RappelSortie`, `InvitationEnvoyée`) → la trace survit à la queue.
- **Span link** côté consumers (Notifications, Budget en mode événementiel) : le travail asynchrone se **rattache** à la requête d'origine sans parent/enfant synchrone.
- **Sampling cohérent** : la décision prise à la Gateway (le `sampled` flag) est **propagée** partout ; on ne re-tire pas par service.

> **Défère :** brancher l'**OpenTelemetry SDK** et l'auto-instrumentation sur ces services, envoyer les spans à un **collector**, les stocker/visualiser dans **Jaeger ou Tempo**, tracer les **dashboards Grafana**, corréler logs+métriques+traces (3 piliers), définir **health checks** et **alertes** = **cours 16-observabilite**. Ici, on a garanti que le **contexte se propage** correctement à travers le sync **et** l'async — la condition **préalable** sans laquelle aucun de ces outils ne servirait à rien.

---

## 6. Points clés

1. **Le défi est distribué, pas outillé** : le monolithe corrèle gratuitement (une stack, un log) ; le distribué n'a **ni stack globale, ni horloge commune, ni cause/effet colocalisés** → il faut **transporter un contexte partagé**.
2. **Trace** = parcours complet (arbre de spans) ; **span** = une opération sur un service ; **span context** (trace id + span id + flags + tracestate, **immuable**) = ce qu'on propage.
3. **Relation parent/enfant** : `parent_id` de l'enfant = `span_id` du parent, **même** `trace_id`.
4. **trace id** (le parcours) ≠ **span id** (l'opération) ≠ **correlation id** (le groupe métier) ≠ **causation id** (la chaîne un-à-un). Correlation = groupe, causation = lien direct.
5. **Propagation synchrone** : un **propagator** `inject`/`extract` le span context via l'en-tête **`traceparent`** W3C = `version-trace-id-parent-id-trace-flags` (trace-id 32 hex, parent-id 16 hex, flags 8 bits) ; `tracestate` relaie du vendor-specific.
6. On **conserve** le trace id d'un service à l'autre ; on ne génère de neuf que le **span id**. `AsyncLocalStorage` porte le contexte implicite.
7. **Propagation asynchrone (queue)** : le carrier n'est plus HTTP → **injecter le contexte dans les métadonnées du message** ; oublier ça **casse la trace** à la queue.
8. Le parent async étant **déjà terminé**, on relie par un **span link** (causalité sans hiérarchie synchrone), pas par parent/enfant.
9. **Sampling** : **head** (décision précoce, **consistent probability** basé sur le trace id) vs **tail** (décision globale, infra à état) ; la **décision se propage** (sampled flag) pour éviter les **traces à trous**.
10. Le **setup OTel/collector/Jaeger/Grafana/alerting** est **déféré au cours 16** : ce module garantit seulement que **le fil existe et ne se casse pas**.

---

## 7. Seeds Anki

```
Pourquoi tracer une requête est-il un problème neuf en distribué (vs monolithe) ?|Le monolithe corrèle gratuitement : une requête = un thread = une stack trace = un fichier, dans l'ordre. En distribué il n'y a plus de stack trace globale (la requête se fragmente en N processus), pas d'horloge commune (classer par timestamp brut est faux), et la cause est dans un service pendant que l'effet apparaît dans un autre. La parade est de transporter un contexte partagé (un trace id) de bout en bout.
Trace, span, span context : définitions ?|Span = une unité de travail/opération sur un service. Trace = le parcours complet d'une requête à travers l'application, soit un arbre de spans pouvant traverser plusieurs services/datacenters. Span context = objet immuable porté par chaque span, contenant trace id + span id + trace-flags + tracestate — c'est LUI qu'on propage entre services. Relation parent/enfant : le parent_id de l'enfant = le span_id du parent, avec le même trace_id.
Différence entre correlation id et causation id ?|Correlation id = "ces messages appartiennent au même workflow" (le GROUPE entier ; équivalent applicatif du trace id). Causation id = "ce message a été produit en réaction DIRECTE à cet autre message" (la CHAÎNE causale un-à-un). Correlation regroupe, causation chaîne. Le trace id porte la corrélation technique ; le span id / parent-id porte la causalité span-à-span.
Comment se propage un contexte de trace en synchrone (format W3C) ?|Via un propagator qui fait inject (sérialiser le span context dans les headers sortants) et extract (le lire dans les headers entrants). Le carrier est l'en-tête traceparent : version-trace-id-parent-id-trace-flags (ex. 00-4bf9...-00f0...-01). trace-id = 16 octets/32 hex (partagé par toute la trace), parent-id = 16 hex (span de l'appelant), trace-flags = 8 bits dont le sampled flag. On CONSERVE le trace id, on ne régénère que le span id.
Comment propager le contexte de trace à travers une QUEUE (async), et pourquoi un span link ?|Il n'y a plus de header HTTP : le producteur doit INJECTER le contexte dans les MÉTADONNÉES du message (message headers/attributes) ; le consumer l'EXTRAIT de là. Oublier ça casse la trace à la queue (trace orpheline). Comme le span producteur est DÉJÀ terminé quand le consumer traite le message, on ne fait pas parent/enfant (le parent n'attend pas l'enfant) : on relie par un SPAN LINK, qui exprime la causalité entre traces sans hiérarchie synchrone — son cas d'usage désigné pour l'asynchrone.
Head sampling vs tail sampling, et pourquoi propager la décision ?|Head sampling : décision prise tôt sans regarder toute la trace ; approche standard = consistent probability sampling (décision déterministe basée sur le trace id + un pourcentage cible). Tail sampling : décision différée après avoir vu tous/la plupart des spans (permet de toujours garder les erreurs), mais exige une infra à état. En distribué, si chaque service décidait seul on obtiendrait des traces à trous : on PROPAGE la décision via le sampled flag du traceparent, et le consistent sampling (basé sur le trace id partagé) garantit le même verdict partout → trace gardée ou jetée entièrement.
Qu'est-ce que ce module DÉFÈRE au cours 16-observabilite ?|Tout l'outillage qui EXPLOITE le contexte : installer l'OpenTelemetry SDK et l'auto-instrumentation, configurer un collector, stocker/visualiser dans Jaeger ou Tempo, tracer des dashboards Grafana/Prometheus, corréler les 3 piliers (logs/métriques/traces), health checks et alerting. Ce module 16 du cours 17 garantit seulement que le FIL (le contexte) existe et ne se casse pas à travers sync et async — condition préalable sans laquelle aucun outil ne recollerait la requête.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-16-observabilite-distribuee/README.md`. Propager un contexte de trace W3C à travers un flux TribuZen **sync + async** (Gateway → Sorties → Budget en HTTP, puis Sorties → Notifications via une queue) sur un docker-compose fourni : implémenter `inject`/`extract` du `traceparent`, porter le contexte via `AsyncLocalStorage`, l'injecter dans les métadonnées du message, poser un **span link** côté consumer, puis **casser** volontairement l'injection async pour observer la trace se briser à la queue et la réparer. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
