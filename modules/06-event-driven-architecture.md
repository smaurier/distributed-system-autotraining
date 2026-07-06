---
titre: Event-driven architecture — événements, pub/sub, découplage
cours: 17-distributed-systems
notions: ["événement (fait passé)", "commande (intention)", "message (enveloppe de transport)", "event notification", "event-carried state transfer", "event sourcing (survol)", "pub/sub (publish-subscribe)", "topic / subscription", "fan-out", "découplage producteur-consommateur", "ordre des événements", "causalité (happens-before)", "correlationId / causationId", "schéma d'événement", "événement au passé", "thin vs fat event", "renvoi source (callback)"]
outcomes:
  - "sait distinguer un événement (fait passé, sans destinataire) d'une commande (intention adressée) et d'un message (l'enveloppe de transport des deux)"
  - "sait choisir entre event notification (signal maigre + callback), event-carried state transfer (événement gras autoportant) et event sourcing (le log est la source de vérité, survol)"
  - "sait mettre en place un pub/sub avec fan-out : un producteur émet sur un topic, plusieurs consommateurs indépendants réagissent sans que l'émetteur les connaisse"
  - "sait expliquer pourquoi le découplage rend le flux métier invisible et comment tracer la causalité avec correlationId / causationId"
  - "sait dessiner un schéma d'événement versionné (nom au passé, id, occurredAt, payload) et dire ce qu'un thin vs fat event met dedans"
prerequis: ["Module 00 — pourquoi le distribué, fallacies", "Module 01 — réseau, latence, partial failure", "Module 02 — microservices en TypeScript", "Module 03 — sérialisation et contrats d'API", "Module 04 — communication synchrone (REST/gRPC, deadlines)", "Module 05 — communication asynchrone, message queues (broker, ack, garanties)"]
next: 07-api-gateway-et-bff
libs: []
tribuzen: "backend TribuZen — quand une sortie est créée, le domaine émet l'événement SortieCreated sur un topic ; les consommateurs Calendar, Notifications et Audit y réagissent indépendamment, sans que le service Sorties les connaisse"
last-reviewed: 2026-07
---

# Event-driven architecture — événements, pub/sub, découplage

> **Outcomes — tu sauras FAIRE :** distinguer événement / commande / message, choisir entre event notification, event-carried state transfer et event sourcing (survol), mettre en place un pub/sub avec fan-out, tracer la causalité d'un flux découplé, dessiner un schéma d'événement versionné.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module est le niveau **système / implémentation** de l'architecture événementielle — quelle est la **nature** de ce qu'on émet (événement vs commande vs message), quels **styles** d'EDA existent (notification, state transfer, sourcing en survol), comment le **pub/sub** distribue un événement à N consommateurs (**fan-out**), ce que le **découplage** coûte en lisibilité du flux, et comment **tracer la causalité**. Le module 05 (précédent) a posé le **tuyau** (broker, ack, garanties de livraison) ; ici on pose ce qui **circule dedans** et **pourquoi**. On **ne** couvre **pas** : l'**event sourcing détaillé** (projections, replay, snapshots, impl profonde) → **module 12** ; la **décision d'architecture** « faut-il partir sur de l'événementiel, event vs command à l'échelle du design » → **cours 13-architecture** ; la **saga** (orchestration vs chorégraphie d'un processus métier) → **module 11** ; l'**outbox** pour publier de façon fiable depuis la transaction → **module 13**. Ici : la sémantique des événements, le pub/sub, le découplage et ses pièges.

## 1. Cas concret d'abord

Tu reprends le backend de TribuZen. Au module 05, tu as sorti l'export Calendar de la requête HTTP en déposant une **tâche** sur une queue. Le mois suivant, le produit ajoute deux besoins liés à la **même action** « un parent crée une sortie » :

- envoyer une **notification push** aux autres membres de la famille ;
- écrire une ligne dans le **journal d'audit**.

Le réflexe naïf : brancher tout ça dans le service `Sorties`, à la suite.

```ts
// sorties.service.ts — AVANT (le service Sorties orchestre tout le monde)
async createSortie(input: CreateSortieInput): Promise<Sortie> {
  const sortie = await this.repo.save(Sortie.create(input));

  await this.calendarQueue.publish('export.calendar', { sortieId: sortie.id }); // module 05
  await this.pushService.notifyFamily(sortie.familyId, sortie);   // ← nouveau
  await this.auditService.log('sortie.created', sortie);          // ← nouveau
  return sortie;
}
```

Le problème n'est pas technique, il est **architectural** : le service `Sorties` **connaît** maintenant Calendar, Push et Audit. Chaque nouveau besoin (« indexer la sortie pour la recherche », « incrémenter un compteur de gamification ») rouvre `createSortie` et rallonge la liste. `Sorties` devient un **carrefour couplé** à toute la plateforme, et un plantage de `pushService` peut faire échouer la création alors que la sortie est **déjà en base**.

Le renversement event-driven : `Sorties` ne **commande** personne. Il **constate un fait** — « une sortie a été créée » — et l'**émet** au monde sous forme d'**événement** `SortieCreated`. Ceux que ça intéresse (Calendar, Push, Audit, et les futurs) **s'abonnent** eux-mêmes. `Sorties` **ne les connaît pas** et n'a plus jamais à être modifié quand un nouveau consommateur apparaît. C'est le **découplage** par le fait passé — et c'est exactement ce que ce module outille : quelle est la nature de `SortieCreated` (un **événement**, pas une **commande**), combien de données il transporte, comment le **pub/sub** le livre à N abonnés, et comment tu retrouveras **qui a déclenché quoi** une fois que tout est découplé.

---

## 2. Théorie complète, concise

### 2.1 Événement vs commande vs message — trois mots qu'on confond

Ce sont **trois niveaux différents**, pas trois synonymes.

**Une commande** est une **intention** : « fais ceci ». Elle est **adressée** à **un** destinataire précis, l'émetteur **attend** que ce soit fait, et le destinataire **peut refuser** (validation, règle métier). Nommée à l'**impératif** : `ExportSortie`, `SendPushNotification`, `ReserveSlot`.

**Un événement** est un **fait passé** : « ceci s'est produit ». Il n'a **pas de destinataire** — l'émetteur ne sait pas qui écoute, ni même si quelqu'un écoute. Il **ne peut pas être refusé** : c'est un fait accompli, il est déjà vrai. Nommé au **passé** : `SortieCreated`, `PushSent`, `SlotReserved`.

**Un message** n'est ni l'un ni l'autre : c'est l'**enveloppe de transport**. Commandes **et** événements voyagent *dans* des messages sur le broker du module 05. « Message » décrit le **comment ça circule** (ack, DLQ, garanties), « événement » et « commande » décrivent le **quoi et le pourquoi**.

```
        INTENTION                         FAIT ACCOMPLI
   ┌──────────────────┐              ┌──────────────────────┐
   │    COMMANDE       │              │      ÉVÉNEMENT        │
   │  "fais ceci"      │              │  "ceci s'est passé"  │
   │  impératif        │              │  passé               │
   │  1 destinataire   │              │  0..N abonnés        │
   │  peut être refusée│              │  ne peut être refusé │
   │  couplage émett.→ │              │  découplage : émett. │
   │  connaît la cible │              │  ignore les abonnés  │
   └──────────────────┘              └──────────────────────┘
            \                               /
             \        voyagent dans        /
              ▼                           ▼
            ┌───────────────────────────────┐
            │           MESSAGE             │  (enveloppe : broker, ack, DLQ — module 05)
            └───────────────────────────────┘
```

Le test de discrimination : **peut-il être refusé / y a-t-il UN destinataire attendu ?** Oui → commande. Non, c'est déjà arrivé et n'importe qui peut écouter → événement. `ExportSortie` (« exporte, j'attends que ce soit fait ») est une **commande** ; `SortieCreated` (« une sortie existe, débrouillez-vous ») est un **événement**. Le §1 transforme une orchestration de commandes en émission d'**un** événement.

> **Piège de vocabulaire (Fowler).** Un événement qui, en vrai, *exige* une action précise d'un destinataire précis est une **commande déguisée** (« passive-aggressive command »). Si en écrivant `SortieCreated` tu penses « et là Calendar **doit** exporter », interroge-toi : est-ce vraiment un fait diffusé, ou un ordre maquillé ? Le nom au passé ne suffit pas à faire un vrai événement.

### 2.2 Trois styles d'event-driven (Fowler : « the many meanings »)

« Event-driven » recouvre des architectures **très différentes**. Fowler en distingue quatre ; on en retient **trois** ici (la 4ᵉ, CQRS, relève du module 12 et du cours 13).

**1) Event notification — le signal maigre.** Le producteur émet un événement **minimal** pour *notifier* qu'un fait a eu lieu, sans se soucier des réactions. Fowler : l'événement porte *« often just some id information and a link back to the sender »*. Le consommateur qui veut plus **rappelle la source** (callback : `GET /sorties/{id}`).

```
SortieCreated { sortieId, familyId, occurredAt }   ← thin event : juste de quoi rappeler
   → Calendar reçoit, puis GET /sorties/{sortieId} pour les détails complets
```

Avantage : couplage **très faible**, payload stable. Coût : le consommateur doit **rappeler** (latence + charge sur la source), et la source doit **rester joignable**.

**2) Event-carried state transfer — l'événement gras autoportant.** L'événement transporte **tout l'état nécessaire** pour que le consommateur agisse **sans jamais rappeler** la source.

```
SortieCreated { sortieId, familyId, titre, date, lieu, participants[], occurredAt }
   → Calendar a TOUT : il crée l'entrée sans appeler Sorties
```

Fowler : le consommateur maintient sa **propre copie** des données dont il a besoin. Avantages : **résilience** (le consommateur fonctionne même si la source est down), **latence** (pas d'appel distant), **charge** réduite sur la source. Coûts : **plus de données** transportées et **dupliquées** (chaque consommateur stocke sa copie → cohérence éventuelle entre copies), et l'événement expose plus de champs (contrat plus large à versionner).

**3) Event sourcing — le log EST la source de vérité (survol).** On ne stocke plus l'*état courant* comme donnée principale : on stocke la **suite ordonnée de tous les événements**, et l'état se **reconstruit en rejouant** le log. `SortieCreated`, puis `SortieRenamed`, puis `SortieCancelled` → l'état « sortie annulée » est **dérivé** du replay. Bénéfices : **audit total** (l'historique EST la donnée), possibilité de reconstruire un état passé. Coûts : complexité (schéma des événements qui évoluent, interaction avec systèmes externes).

> **Renvoi.** Ici event sourcing est un **survol de positionnement** — savoir que le log peut *être* la vérité, et le distinguer des deux autres styles. Les **projections**, le **replay**, les **snapshots**, l'**implémentation** concrète = **module 12 (cqrs-event-sourcing)**. La **décision** « TribuZen doit-il faire de l'event sourcing / de l'événementiel tout court ? » = **cours 13-architecture**. Ne confonds pas les trois styles : Fowler prévient qu'en **mélanger** plusieurs sans le savoir *« compounds complexity unnecessarily »*.

| Style | L'événement porte… | Le consommateur rappelle la source ? | Sert surtout à |
|---|---|---|---|
| **Event notification** | un id + un lien (thin) | **oui** (callback) | notifier sans coupler |
| **Event-carried state transfer** | tout l'état utile (fat) | **non** | résilience, latence, découplage fort |
| **Event sourcing** | chaque changement, conservé | non (rejoue le log) | audit, reconstruction, source de vérité |

### 2.3 Pub/sub et fan-out — comment un événement atteint N consommateurs

Le module 05 a montré la **queue** (competing consumers : *un* message → *un* membre du groupe). Un événement, lui, doit atteindre **tous les intéressés**, chacun **indépendamment**. C'est le **publish-subscribe** :

- le producteur **publie** sur un **topic** (un nom logique : `sortie.created`) ;
- chaque consommateur intéressé crée une **subscription** au topic ;
- le broker fait le **fan-out** : il livre une **copie** de l'événement à **chaque** subscription.

```
                          topic "sortie.created"
                                   │  fan-out (une copie par subscription)
   Sorties ──publish──▶ [ broker ] ├──────────▶ subscription Calendar   ──▶ worker Calendar
                                   ├──────────▶ subscription Push       ──▶ worker Push
                                   └──────────▶ subscription Audit      ──▶ worker Audit
```

Différence clé avec la queue simple : en **pub/sub**, ajouter le consommateur Audit = **créer une subscription**, **sans toucher** au producteur. Chaque subscription est elle-même une queue durable (le worker Push peut être down : sa copie l'attend, ack/DLQ du module 05 s'appliquent **par subscription**). Concrètement : RabbitMQ = un **exchange** de type `fanout`/`topic` qui route vers plusieurs queues ; SNS→SQS = un topic SNS qui **fan-out** vers plusieurs queues SQS ; Kafka = **plusieurs consumer groups** lisant le même topic (chaque groupe a ses offsets → chaque groupe reçoit tout).

### 2.4 Le découplage a un prix : le flux devient invisible

C'est le **cœur** de l'EDA et sa **contrepartie** la plus dangereuse. En découplant, tu gagnes l'autonomie (le §1). Tu **perds** la lisibilité : le flux métier n'est **écrit nulle part**.

> Fowler, mot pour mot : avec l'event notification *« it can be hard to see such a flow as it's not explicit in any program text »*. Le danger : construire des systèmes découplés en **perdant de vue les flux à plus grande échelle**.

Dans le §1 version couplée, tu **lis** le flux dans `createSortie` : save → calendar → push → audit. Dans la version événementielle, `createSortie` émet **un** événement, point. Pour savoir *ce qui se passe ensuite*, il faut inspecter **toutes les subscriptions** dispersées dans le code (voire dans d'autres services). Aucun fichier ne dit « SortieCreated déclenche ces 3 réactions ». Le flux n'existe qu'**à l'exécution**.

Deux garde-fous concrets :
- **documenter** la carte des événements (qui émet quoi, qui écoute quoi) — un event catalog ;
- **tracer** la causalité (§2.5) pour reconstruire *a posteriori* qui a déclenché quoi.

Et une règle de conception : quand un processus métier a un **flux critique et ordonné** (paiement → réservation → confirmation), une cascade d'événements « chorégraphiés » devient vite illisible ; on lui préfère une **orchestration explicite** (une saga qui *pilote* le flux avec des commandes). Ce choix chorégraphie-vs-orchestration = **module 11**.

### 2.5 Ordre, causalité, et comment retracer un flux découplé

En distribué, l'**ordre** des événements n'est **pas** garanti globalement (module 05 : garanti seulement par partition / file à consommateur unique). Deux notions à ne pas confondre :

- **Ordre** = « lequel est arrivé avant l'autre dans le temps ». Fragile, dépend du réseau et du parallélisme.
- **Causalité (happens-before)** = « lequel a **causé** l'autre ». `SortieCreated` **cause** `PushSent` : c'est vrai indépendamment de l'ordre d'arrivée réseau. La causalité se **transporte explicitement** ; on ne la déduit pas de l'horloge.

On matérialise la causalité avec deux identifiants dans **chaque** événement :
- **`correlationId`** — l'identifiant de **toute la chaîne** issue d'une action utilisateur. Constant du premier événement au dernier : `SortieCreated`, `PushSent`, `AuditLogged` partagent le **même** `correlationId`. Il répond à « montre-moi **tout** ce qu'a déclenché cette création ».
- **`causationId`** — l'identifiant de l'événement **qui a directement causé** celui-ci (le parent immédiat). `PushSent.causationId = SortieCreated.eventId`. Il reconstruit l'**arbre** de causalité.

```
correlationId = C-42  (toute la chaîne partage cet id)

SortieCreated   eventId=E1  causationId=(action user)
   ├─▶ PushSent      eventId=E2  causationId=E1
   └─▶ AuditLogged   eventId=E3  causationId=E1
```

Avec ces deux champs, même sans flux écrit dans le code (§2.4), tu **reconstruis** l'arbre a posteriori depuis les logs/traces. C'est la fondation du **traçage distribué** — approfondi au **module 16**. Les **horloges logiques** (Lamport, vector clocks) qui *ordonnent* rigoureusement les événements causaux = **module 19**.

### 2.6 Schéma d'événement — le contrat de ce que tu émets

Un événement publié est un **contrat** consommé par des services que tu **ne contrôles pas** (c'est le principe du découplage). Son schéma se conçoit comme une API. Ossature minimale :

```ts
interface DomainEvent<T> {
  eventId: string;        // UUID unique — clé d'idempotence côté consommateur (module 05)
  type: string;           // nom AU PASSÉ + version : "sortie.created.v1"
  occurredAt: string;     // ISO 8601 — QUAND le fait a eu lieu (≠ quand reçu)
  correlationId: string;  // chaîne (§2.5)
  causationId: string;    // parent causal (§2.5)
  payload: T;             // les données du fait
}
```

Règles de conception :
- **Nommer au passé** (`sortie.created`, jamais `create.sortie`) : un événement est un fait accompli. Un nom impératif trahit une **commande** (§2.1).
- **Versionner le type** (`.v1`) : les consommateurs sont hors de ton contrôle. Faire évoluer un événement = **ajouter des champs optionnels** (compatible) ou **publier `.v2`** en gardant `.v1` le temps que tout le monde migre — jamais casser un champ existant. (Détail sérialisation/compat = module 03.)
- **Thin vs fat = le choix du §2.2** matérialisé dans `payload` : thin (notification) = juste des ids ; fat (state transfer) = tout l'état. Plus le payload est gras, plus le contrat est large à maintenir — mets **ce dont les consommateurs ont besoin**, pas tout le modèle interne (n'expose pas tes détails d'implémentation privés).

---

## 3. Worked examples

### Exemple 1 — Transformer le §1 en flux event-driven (pub/sub + fan-out)

But : `Sorties` émet **un** événement ; Calendar, Push et Audit réagissent seuls ; on peut ajouter un 4ᵉ consommateur sans toucher à `Sorties`.

**Étape 1 — le producteur émet un fait, ne commande personne :**

```ts
// sorties.service.ts — APRÈS
async createSortie(input: CreateSortieInput): Promise<Sortie> {
  const sortie = await this.repo.save(Sortie.create(input));

  await this.bus.publish('sortie.created', {
    eventId: randomUUID(),
    type: 'sortie.created.v1',
    occurredAt: new Date().toISOString(),
    correlationId: input.correlationId,       // vient de la requête HTTP entrante
    causationId: input.requestId,             // l'action user qui a tout déclenché
    payload: { sortieId: sortie.id, familyId: sortie.familyId }, // ← thin : juste des ids
  });

  return sortie; // Sorties ne connaît NI Calendar NI Push NI Audit
}
```

Choix assumé : **event notification** (thin). `Sorties` ne veut pas exposer tout le modèle sortie à trois consommateurs ; chacun rappellera `GET /sorties/{id}` s'il a besoin des détails.

**Étape 2 — chaque consommateur s'abonne, indépendamment :**

```ts
// calendar.consumer.ts
bus.subscribe('sortie.created', async (evt) => {
  const sortie = await sortiesApi.get(evt.payload.sortieId); // callback : notification = thin
  await googleCalendar.export(sortie);
  // ré-émet un fait, en propageant la causalité
  await bus.publish('calendar.exported', {
    eventId: randomUUID(), type: 'calendar.exported.v1', occurredAt: new Date().toISOString(),
    correlationId: evt.correlationId,      // MÊME chaîne
    causationId: evt.eventId,              // causé par sortie.created
    payload: { sortieId: evt.payload.sortieId },
  });
});

// push.consumer.ts — n'a besoin que des ids : pas de callback
bus.subscribe('sortie.created', async (evt) => {
  await pushService.notifyFamily(evt.payload.familyId, evt.payload.sortieId);
});

// audit.consumer.ts — écrit la ligne d'audit
bus.subscribe('sortie.created', async (evt) => {
  await auditRepo.append({ event: evt.type, correlationId: evt.correlationId, at: evt.occurredAt });
});
```

**Étape 3 — le fan-out garantit que chacun reçoit sa copie.** Le broker crée **une subscription = une queue durable par consommateur**. Push down 2 min ? Sa copie **attend** dans sa subscription ; Calendar et Audit ne sont pas affectés. Les garanties du module 05 (ack après traitement, at-least-once, idempotence sur `eventId`, DLQ) s'appliquent **par subscription**.

**Étape 4 — ajouter « indexer pour la recherche » = ajouter une subscription, zéro modif de `Sorties` :**

```ts
// search.consumer.ts — NOUVEAU, et c'est tout
bus.subscribe('sortie.created', async (evt) => {
  const sortie = await sortiesApi.get(evt.payload.sortieId);
  await searchIndex.upsert(sortie);
});
```

**Ce que ce design achète :** `Sorties` est **découplé** de toute la plateforme (extensibilité gratuite), aucune réaction ne peut faire échouer la création, chaque consommateur a sa résilience propre. **Ce qu'il coûte :** le flux « une création → 4 réactions » n'est écrit **nulle part** (§2.4) — d'où le `correlationId` partagé, qui permet de retrouver toute la chaîne dans les logs.

### Exemple 2 — Notification vs state transfer : trancher un cas TribuZen

Le consommateur Calendar rappelle `GET /sorties/{id}` à **chaque** événement (Étape 2). En pic de création, ça martèle le service `Sorties`, et si `Sorties` est momentanément down, Calendar **échoue**. Question : passer en **event-carried state transfer** ?

**Analyse.** Calendar a besoin de `titre`, `date`, `lieu`, `participants` — **tout ça existe déjà** au moment où `Sorties` émet l'événement. Le faire rappeler pour des données que le producteur avait sous la main est un aller-retour gratuit. On **grossit** l'événement :

```ts
// sorties.service.ts — variante FAT (event-carried state transfer)
await this.bus.publish('sortie.created', {
  eventId: randomUUID(), type: 'sortie.created.v2', occurredAt: new Date().toISOString(),
  correlationId: input.correlationId, causationId: input.requestId,
  payload: {                                   // ← FAT : tout l'état utile aux consommateurs
    sortieId: sortie.id, familyId: sortie.familyId,
    titre: sortie.titre, date: sortie.date, lieu: sortie.lieu,
    participants: sortie.participants,
  },
});
```

Calendar n'appelle **plus** `Sorties` : il a tout dans l'événement (résilient même si `Sorties` est down, plus rapide, moins de charge sur la source). **Prix payé :** l'événement expose plus de champs (contrat `.v2` plus large à versionner — d'où le bump de version), et chaque consommateur qui stocke ces données en garde une **copie** (cohérence éventuelle entre copies).

**Verdict.** Pour Push, qui n'a besoin que de `familyId` + `sortieId`, la **notification (thin)** suffit. Pour Calendar, qui reconstruit une entrée complète et doit rester résilient, le **state transfer (fat)** est justifié. Règle : **thin par défaut** (contrat minimal), **fat quand la résilience/latence/charge le justifie** et que la donnée est disponible à l'émission. Rien n'oblige un même topic à être uniformément thin ou fat, mais mélanger les deux styles **sans le savoir** est exactement ce contre quoi Fowler met en garde.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Émettre une commande déguisée en événement

Tu nommes `SortieCreated` mais, en l'écrivant, tu penses « et Calendar **doit** exporter, sinon bug ». C'est une **commande** (`ExportSortie`) maquillée en événement — Fowler l'appelle *passive-aggressive command*. Le symptôme : l'émetteur **dépend** d'un consommateur précis pour réagir d'une façon précise → le découplage est une illusion, tu as juste caché le couplage. Vrai test : si tu supprimes **tous** les consommateurs, l'émetteur est-il toujours correct ? Oui = vrai événement. Non = c'était une commande.

### PIÈGE #2 — Confondre événement, commande et message

« C'est pareil, ça circule sur le broker. » Non : le **message** est l'**enveloppe** (transport, ack, DLQ — module 05) ; **commande** et **événement** sont des **contenus** de sens opposés (intention adressée refusable vs fait diffusé accompli). Confondre mène à traiter un fait comme un ordre (couplage) ou un ordre comme un fait (personne ne l'exécute, ou plusieurs l'exécutent). Nomme à l'**impératif** les commandes, au **passé** les événements.

### PIÈGE #3 — Croire que « event-driven » désigne une seule chose

Notification, state transfer et event sourcing sont **trois architectures distinctes** aux propriétés opposées (thin+callback vs fat+autonome vs log-source-de-vérité). Dire « on fait de l'event-driven » sans préciser le style, c'est ne rien dire. Pire, les **mélanger sans le savoir** *« compounds complexity unnecessarily »* (Fowler) : un consommateur qui parfois rappelle la source, parfois lit le payload, parfois rejoue un log, est ingérable. Choisis le style **consciemment**, par topic.

### PIÈGE #4 — Oublier que le découplage rend le flux invisible

« C'est propre, tout est découplé. » Oui, et **personne ne sait plus** ce qu'une création de sortie déclenche : le flux n'est *« explicit in any program text »* nulle part. Sans **event catalog** (qui émet/écoute quoi) ni **correlationId** pour tracer, un bug « la notif n'est pas partie » devient une enquête à l'aveugle. Le découplage n'est pas gratuit : il se **paie en observabilité** (§2.5, module 16).

### PIÈGE #5 — Supposer l'ordre d'arrivée = l'ordre causal

« PushSent est arrivé avant AuditLogged, donc Push a causé Audit. » Faux : l'**ordre d'arrivée réseau** ne dit **rien** de la **causalité**. Les deux ont été causés par `SortieCreated` (même `causationId`), pas l'un par l'autre, et ils peuvent arriver dans n'importe quel ordre. La causalité se **transporte** (`causationId`), elle ne se **déduit pas** de l'horloge d'arrivée. (Ordonner rigoureusement les événements causaux = horloges logiques, module 19.)

### PIÈGE #6 — Mettre tout le modèle interne dans le payload

« Je balance l'entité complète, comme ça les consommateurs ont tout. » Deux dégâts : tu **exposes tes détails d'implémentation privés** (colonnes internes, champs techniques) que des services externes vont se mettre à dépendre → tu ne peux plus les changer ; et tu **gonfles** le contrat à versionner. Mets dans le payload **ce dont les consommateurs ont besoin** (thin par défaut, fat justifié), pas ta table telle quelle.

### PIÈGE #7 — Chorégraphier un processus critique par cascade d'événements

`OrderCreated → InventoryReserved → PaymentRequested → PaymentProcessed → ShippingScheduled…` : chaque étape émet un événement qui déclenche la suivante. Le flux métier devient **invisible et non pilotable** — si le paiement échoue au milieu, aucun endroit ne « sait » où on en est ni comment compenser. Pour un processus **critique, ordonné, avec compensation**, préfère une **orchestration explicite** (une saga qui pilote avec des commandes). Événements pour **notifier**, saga pour **piloter** — le détail est au **module 11**.

---

## 5. Ancrage TribuZen

TribuZen a un **cœur d'actions** (créer une sortie, compléter une routine, rejoindre une famille) et une **constellation de réactions** (calendrier, notifications, audit, recherche, gamification) qui grossit à chaque sprint. Câbler chaque réaction dans le service d'action fait de ce service un **carrefour couplé** ingérable (le §1). La colonne vertébrale event-driven de TribuZen renverse ça : **chaque action émet un fait ; les réactions s'abonnent**.

**La topologie d'événements de TribuZen :**

```
POST /sorties ─▶ [ Sorties : save ] ─▶ publish "sortie.created" (thin: sortieId, familyId)
                                                │  topic + fan-out (pub/sub)
                    ┌───────────────────────────┼───────────────────────────┐
                    ▼                           ▼                           ▼
             sub Calendar                 sub Notifications             sub Audit
        (state transfer si down-résilient)   (thin, push famille)   (append au journal)
                    │  ré-émet "calendar.exported"                        │
                    ▼  (correlationId propagé)                            ▼
              Google Calendar                                    journal d'audit (stream, module 05)
```

Décisions concrètes pour TribuZen :

- **Fait, pas commande.** `Sorties`, `Routines`, `Family` émettent des événements au **passé** (`sortie.created`, `routine.completed`, `member.joined`) et **ne connaissent aucun** consommateur. Ajouter une réaction (gamification, recherche) = **une subscription de plus**, zéro modif du producteur.
- **Style par topic.** `sortie.created` reste **thin** (notification) par défaut — les consommateurs rappellent `GET /sorties/{id}` s'ils veulent le détail. On passe **fat** (state transfer) **seulement** là où la résilience/latence l'exige (ex. Calendar doit fonctionner même si `Sorties` est momentanément down).
- **Audit = event sourcing léger.** Le journal d'audit **conserve** tous les événements famille (le **stream** du module 05, ordonné par `familyId`) : il *est* la source de vérité de « qui a fait quoi quand », rejouable. L'event sourcing **complet** du modèle métier (projections, replay comme état principal) n'est **pas** adopté ici → module 12 pour la mécanique, cours 13 pour la décision.
- **Causalité systématique.** Chaque événement porte `correlationId` (constant sur toute la chaîne d'une action user) + `causationId` (parent direct). Un bug « la notif de la sortie X n'est pas partie » se trace en filtrant les logs sur **un** `correlationId` — indispensable puisque le flux n'est écrit nulle part.
- **Schéma versionné.** Type au passé + `.vN` ; évolution par ajout de champ optionnel ou nouveau `.v2` coexistant. Les consommateurs sont hors du contrôle de l'équipe émettrice : on ne casse jamais un champ publié.

> **Défère :** l'**event sourcing détaillé** (projections, replay, snapshots) = **module 12** ; la **décision d'architecture événementielle** (faut-il partir événementiel, event vs command au niveau design) = **cours 13-architecture** ; **orchestration vs chorégraphie** d'un processus (saga, compensation) = **module 11** ; publier l'événement **de façon fiable** depuis la transaction DB (dual-write, **outbox**) = **module 13** ; le **traçage distribué** de la causalité = **module 16** ; l'**ordre causal rigoureux** (horloges logiques) = **module 19**. Ici on a posé **la sémantique des événements, le pub/sub et le découplage**.

---

## 6. Points clés

1. **Événement ≠ commande ≠ message** : la **commande** est une intention adressée à un destinataire, refusable (impératif) ; l'**événement** est un fait passé diffusé à 0..N abonnés, non refusable (passé) ; le **message** est l'enveloppe de transport dans laquelle les deux voyagent.
2. **Trois styles d'EDA (Fowler)** : **event notification** (thin, id + callback vers la source), **event-carried state transfer** (fat, autoportant, résilient), **event sourcing** (le log conservé *est* la source de vérité — survol, détail module 12). Les mélanger sans le savoir « compounds complexity ».
3. **Pub/sub + fan-out** : le producteur publie sur un **topic**, chaque consommateur crée une **subscription**, le broker livre **une copie par subscription**. Ajouter un consommateur = ajouter une subscription, **sans toucher au producteur**.
4. **Le découplage rend le flux invisible** : le flux métier n'est *« explicit in any program text »* nulle part. Contrepartie obligatoire : **event catalog** (doc) + **traçage** (§5).
5. **Ordre ≠ causalité** : l'ordre d'arrivée ne prouve rien ; la causalité (happens-before) se **transporte** via **`correlationId`** (toute la chaîne) et **`causationId`** (parent direct), elle ne se déduit pas de l'horloge.
6. **Schéma d'événement = contrat** : nom **au passé** + version (`sortie.created.v1`), `eventId` (idempotence), `occurredAt`, `correlationId`/`causationId`, `payload` **thin ou fat** selon le style. On n'expose pas le modèle interne ; on ne casse jamais un champ publié.
7. **Événement pour notifier, saga pour piloter** : une cascade d'événements chorégraphiés pour un processus critique/ordonné devient invisible et non pilotable → orchestration explicite (module 11).

---

## 7. Seeds Anki

```
Quelle est la différence entre un événement, une commande et un message ?|Une COMMANDE est une intention ("fais ceci"), impérative, adressée à UN destinataire, refusable, l'émetteur connaît la cible (couplage). Un ÉVÉNEMENT est un fait passé ("ceci s'est produit"), au passé, diffusé à 0..N abonnés, non refusable, l'émetteur ignore qui écoute (découplage). Un MESSAGE est l'enveloppe de transport (broker, ack, DLQ) dans laquelle commandes ET événements circulent.
Comment tester si quelque chose est un événement ou une commande déguisée ?|Si tu supprimes TOUS les consommateurs, l'émetteur est-il toujours correct ? Oui = vrai événement (fait diffusé). Non, l'émetteur dépend d'un consommateur précis pour une action précise = commande déguisée ("passive-aggressive command", Fowler) : le découplage est illusoire.
Quels sont les trois styles d'event-driven de Fowler et leur différence ?|Event notification : événement THIN (id + lien), le consommateur rappelle la source (callback) — couplage faible. Event-carried state transfer : événement FAT autoportant, le consommateur n'appelle jamais la source (résilience, latence, moins de charge, mais données dupliquées). Event sourcing : le log conservé de tous les événements EST la source de vérité, l'état se reconstruit par replay (audit total).
Qu'est-ce que le pub/sub et le fan-out ?|Le producteur publie sur un TOPIC (nom logique) ; chaque consommateur intéressé crée une SUBSCRIPTION ; le broker fait le FAN-OUT en livrant une COPIE de l'événement à CHAQUE subscription (chacune = une queue durable indépendante). Ajouter un consommateur = ajouter une subscription, sans toucher au producteur. (RabbitMQ fanout/topic exchange, SNS→SQS, plusieurs consumer groups Kafka.)
Quel est le principal inconvénient du découplage event-driven ?|Le flux métier devient INVISIBLE : il n'est "explicit in any program text" nulle part (Fowler). Pour savoir ce qu'une action déclenche, il faut inspecter toutes les subscriptions dispersées. Garde-fous : un event catalog (qui émet/écoute quoi) + le traçage par correlationId.
Différence entre ordre et causalité des événements, et comment tracer la causalité ?|L'ORDRE = lequel est arrivé avant (fragile, dépend du réseau/parallélisme). La CAUSALITÉ (happens-before) = lequel a CAUSÉ l'autre (vrai indépendamment de l'ordre d'arrivée). On la transporte explicitement : correlationId = id constant de toute la chaîne d'une action user ; causationId = id de l'événement parent qui a directement causé celui-ci. On ne déduit jamais la causalité de l'horloge d'arrivée.
Que doit contenir un schéma d'événement et quelles sont les règles de nommage/versioning ?|eventId (UUID, idempotence), type au PASSÉ + version ("sortie.created.v1"), occurredAt (ISO), correlationId + causationId, payload. Nom impératif = commande (à proscrire). Évolution : ajouter un champ optionnel (compatible) ou publier .v2 en gardant .v1 — jamais casser un champ publié (les consommateurs sont hors de ton contrôle). Ne pas exposer le modèle interne.
Thin event vs fat event : lequel choisir ?|Thin (notification) = juste des ids + callback : contrat minimal, mais le consommateur rappelle la source et celle-ci doit rester joignable. Fat (state transfer) = tout l'état utile : le consommateur est résilient (marche même si la source est down), plus rapide, moins de charge sur la source, mais plus de données dupliquées et un contrat plus large. Règle : thin par défaut, fat quand résilience/latence/charge le justifient et que la donnée est disponible à l'émission.
Pourquoi préférer une saga à une cascade d'événements pour un processus critique ?|Une chorégraphie par cascade (OrderCreated → InventoryReserved → PaymentRequested → ...) rend le flux invisible et non pilotable : si une étape échoue, aucun endroit ne sait où on en est ni comment compenser. Pour un processus critique/ordonné avec compensation, on préfère une orchestration explicite (saga qui pilote avec des commandes). Événements pour notifier, saga pour piloter (module 11).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-06-event-driven-architecture/README.md`. Concevoir et implémenter un flux event-driven TribuZen avec un vrai broker (docker-compose fourni) : émettre `sortie.created` en pub/sub, brancher trois consommateurs indépendants (Calendar, Push, Audit) via fan-out, choisir thin vs fat par consommateur, propager `correlationId`/`causationId`, et ajouter un 4ᵉ consommateur sans toucher au producteur pour prouver le découplage. Exercice pratique évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
