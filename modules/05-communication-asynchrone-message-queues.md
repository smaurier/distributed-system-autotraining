---
titre: Communication asynchrone & message queues
cours: 17-distributed-systems
notions: ["message queue", "stream (log append-only)", "queue vs stream", "message broker", "RabbitMQ", "Amazon SQS", "Apache Kafka (survol)", "ack / nack", "at-most-once", "at-least-once", "exactly-once (= at-least-once + idempotence)", "dead letter queue (DLQ)", "poison message", "redelivery / requeue", "prefetch / backpressure", "ordre des messages (par partition)", "consumer group", "offset / cursor"]
outcomes:
  - "sait distinguer une queue (consommer = retirer) d'un stream (log append-only relu par offset) et choisir selon le besoin de relecture"
  - "sait expliquer le cycle ack / nack et ce qu'il se passe quand un consommateur meurt sans acquitter"
  - "sait nommer les trois garanties de livraison et démontrer qu'exactly-once de bout en bout = at-least-once + consommateur idempotent"
  - "sait concevoir une dead letter queue avec un compteur de tentatives pour isoler un poison message"
  - "sait dire où l'ordre des messages est (ou n'est pas) garanti et pourquoi un consumer group le limite"
  - "sait raisonner sur le prefetch / backpressure pour empêcher un consommateur lent d'être noyé"
prerequis: ["Module 00 — pourquoi le distribué, fallacies", "Module 01 — réseau, latence, partial failure", "Module 02 — microservices en TypeScript", "Module 03 — sérialisation et contrats d'API", "Module 04 — communication synchrone (REST/gRPC, deadlines)"]
next: 06-event-driven-architecture
libs: []
tribuzen: "backend TribuZen — file de messages export.calendar : quand une sortie est créée, un message part sur une queue durable consommée par un worker Sync (retries + DLQ) sans bloquer la requête HTTP du parent"
last-reviewed: 2026-07
---

# Communication asynchrone & message queues

> **Outcomes — tu sauras FAIRE :** distinguer queue et stream et choisir, expliquer le cycle ack/nack et la mort d'un consommateur, démontrer qu'exactly-once = at-least-once + idempotence, concevoir une DLQ avec compteur de tentatives, situer l'ordre garanti et son coût, régler le prefetch/backpressure.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes** du messaging asynchrone — comment un **broker** transporte un message, comment on l'**acquitte** (ack/nack), quelles **garanties de livraison** on obtient réellement, comment on **isole un poison** (DLQ), où l'**ordre** est garanti, et comment un **consumer group** répartit la charge. On survole trois brokers (RabbitMQ, SQS, Kafka) pour leurs **modèles**. On **ne** couvre **pas** ici : la **décision d'architecture** événementielle (événement vs commande, choreography vs orchestration, fan-out) → **module 06 (next)** ; le **stream processing** profond (windowing, exactly-once en streaming, jointures) → **module 20** ; l'**outbox**/dual-write pour publier de façon fiable → **module 13** ; les **retries/backoff/idempotency key** génériques → **module 08**. Ici : le tuyau et ses garanties.

## 1. Cas concret d'abord

Tu reprends le backend de TribuZen. Un parent crée une **sortie**. Le handler HTTP doit, entre autres, **exporter cette sortie vers Google Calendar** — une API externe, lente (200 ms – 2 s), et parfois **indisponible**. Aujourd'hui c'est fait dans la requête :

```ts
// sorties.controller.ts — AVANT (export synchrone, dans la requête)
async createSortie(input: CreateSortieInput): Promise<Sortie> {
  const sortie = await this.repo.save(Sortie.create(input));
  await this.googleCalendar.export(sortie); // ← appel réseau externe, lent, faillible
  return sortie; // le parent attend TOUT ça avant son 201
}
```

Trois problèmes, tous dus au **couplage temporel** (le parent attend un travail qui n'a rien à voir avec « la sortie est enregistrée ») :

1. **Latence.** Le parent attend Google Calendar pour obtenir son `201`. Si l'API met 2 s, la création met 2 s.
2. **Fragilité.** Si `export` throw (Google down, quota dépassé), la création **entière** échoue — alors que la sortie est **déjà en base**. Un détail secondaire fait planter l'action principale.
3. **Perte du travail.** Si le process crash pile après le `save` et avant l'`export`, l'export est **perdu sans trace** : personne ne le rejouera.

On veut **découpler dans le temps** : le handler enregistre la sortie, **dépose un message** « il faut exporter cette sortie » dans une **file durable**, et rend la main **immédiatement**. Un **worker** séparé consomme la file à son rythme, retente si Google est down, et si un message échoue 5 fois, l'**isole** au lieu de boucler. C'est une **message queue**. Ce module te donne les mécanismes exacts : comment le message est **acquitté**, quelle **garantie** tu obtiens vraiment (spoiler : *at-least-once*, donc prépare-toi aux doublons), et comment isoler un **poison message** en **DLQ**.

---

## 2. Théorie complète, concise

### 2.1 Le broker et ses trois acteurs

Un **message broker** est un intermédiaire qui **reçoit, stocke durablement, et distribue** des messages. Trois rôles :

```
┌────────────┐   publish   ┌─────────────────────┐   deliver   ┌──────────────┐
│ Producer   │────────────▶│      Broker         │────────────▶│ Consumer     │
│ (dépose)   │             │  stocke durablement │             │ (traite+ack) │
└────────────┘             │  [ m1 m2 m3 m4 ]    │◀────────────└──────────────┘
                           └─────────────────────┘     ack
```

Le broker **découple dans le temps** : le producer n'attend pas le consumer, et si le consumer est down, le message **attend** sur le broker (persisté sur disque). C'est exactement ce que le §1 réclame. Le producer ne fait **pas** confiance au réseau pour « garder » le message : il le confie à un composant fait pour ça.

### 2.2 Queue vs stream — la distinction structurante

Il y a **deux modèles** de broker, souvent confondus, et le choix change tout :

**Queue (file) — consommer, c'est retirer.** Un message est une **tâche à faire une fois**. Quand un consommateur l'acquitte, le broker le **supprime**. La file **rétrécit** au fur et à mesure. Modèle de RabbitMQ, d'Amazon SQS.

```
QUEUE : le message est CONSOMMÉ (retiré) après ack
[ m1 m2 m3 ] --deliver m1--> worker --ack--> [ m2 m3 ]   (m1 disparaît)
```

**Stream (log append-only) — consommer, c'est avancer un curseur.** Les messages sont **ajoutés en fin d'un log immuable** et **conservés** (rétention par temps ou par taille), **même après lecture**. Chaque consommateur mémorise sa **position** (l'**offset**). Lire n'efface rien : un autre consommateur peut relire depuis le début, et on peut **rejouer** l'historique. Modèle d'Apache Kafka, de Redis Streams.

```
STREAM : le log GRANDIT, on avance un offset, rien n'est retiré
log:  [ m1  m2  m3  m4  m5 ... ]   (append only, conservé)
              ▲consumerA offset=2        ▲consumerB offset=4   (indépendants, peuvent relire)
```

| | **Queue** | **Stream (log)** |
|---|---|---|
| Consommer | **retire** le message | **avance un offset**, ne retire rien |
| Rétention | jusqu'au ack | par durée/taille (indépendant de la lecture) |
| Relecture / replay | impossible (parti) | **possible** (revenir en arrière) |
| Plusieurs lecteurs indépendants | non (un message = un consommateur) | **oui** (chacun son offset) |
| Modèle mental | boîte aux lettres / to-do | journal / bande magnétique |
| Exemples | RabbitMQ, SQS | Kafka, Redis Streams |

Règle : besoin d'une **tâche traitée une fois puis oubliée** (envoyer l'email, exporter la sortie) → **queue**. Besoin de **rejouer l'historique**, de **plusieurs consommateurs indépendants** sur le même flux, ou d'un **audit** → **stream**. Le §1 (une tâche d'export) est un cas de **queue**.

### 2.3 L'accusé de réception : ack / nack

C'est le mécanisme qui rend la livraison **fiable**. Après avoir **traité** un message, le consommateur envoie un **ack** (acknowledgement) : le broker comprend que le message est traité et peut le **supprimer** (queue) ou considérer l'offset comme validé (stream).

> RabbitMQ le dit littéralement : *« An ack(nowledgement) is sent back by the consumer to tell RabbitMQ that a particular message had been received, processed and that RabbitMQ is free to delete it. »*

Le point **crucial** — ce qui fait la garantie — est **quand** on acquitte, et ce qui se passe si on **ne** le fait pas :

- **Le consommateur meurt sans ack** (crash, connexion perdue). Le broker n'a **jamais** reçu la confirmation → il **redélivre** le message (à ce consommateur au retour, ou à un autre). RabbitMQ : *« If a consumer dies … without sending an ack, RabbitMQ will understand that a message wasn't processed fully and will re-queue it. »* **→ Le message n'est jamais perdu, mais il peut être traité deux fois.** Retiens ça : c'est la racine du *at-least-once*.
- **nack (negative ack) / reject.** Le consommateur dit explicitement « je n'ai **pas** réussi ». Il peut demander un **requeue** (retenter plus tard) ou un **rejet définitif** (→ vers la DLQ, §2.5).

**Ordre des opérations qui compte :** on acquitte **après** avoir traité, jamais avant. Acquitter **avant** de traiter = si on crashe pendant le traitement, le message est déjà supprimé → **perte** (c'est *at-most-once*, §2.4). Traiter **puis** acquitter = si on crashe avant l'ack, redélivrance → **doublon** (*at-least-once*). Tu **choisis** ta garantie par ce simple ordre.

### 2.4 Les trois garanties de livraison

Un réseau perd des paquets ; un consommateur crashe entre « traiter » et « acquitter ». D'où **trois** garanties, à choisir **consciemment** (définitions Confluent) :

- **At-most-once (au plus une fois)** — *« messages are delivered once, and if there is a system failure, messages may be lost and are not redelivered. »* Jamais de doublon, **perte possible**. On l'obtient en **acquittant avant** de traiter (ou sans ack du tout : fire-and-forget). Usage : signaux jetables — une métrique, un log best-effort.
- **At-least-once (au moins une fois)** — *« messages are delivered one or more times. If there is a system failure, messages are never lost, but they may be delivered more than once. »* Jamais perdu, **doublons possibles**. On l'obtient en **acquittant après** avoir traité. **C'est le défaut de la quasi-totalité des brokers**, et le cas à gérer par défaut.
- **Exactly-once (exactement une fois)** — chaque message a un effet une et une seule fois. Idéal… mais **coûteux et souvent illusoire de bout en bout** dès qu'un système externe entre en jeu (ton export Google Calendar ne participe à aucune transaction Kafka).

**Le point le plus important du module : exactly-once « de bout en bout » = at-least-once + consommateur idempotent.** Comme le broker peut toujours redélivrer, on ne cherche **pas** à empêcher le doublon au transport ; on rend le **traitement** insensible au doublon.

Un consommateur **idempotent** traite deux fois le **même** message avec le **même effet** qu'une fois. Deux recettes :
- **Déduplication par identifiant** : chaque message porte un `messageId` unique ; le consommateur **stocke les IDs déjà traités** (table `processed_messages`) et **ignore** un ID déjà vu.
- **Opération naturellement idempotente** : `SET statut = exporté` (rejouable à l'infini) plutôt que `compteur += 1` (double si rejoué).

> **Nuance survol Kafka.** Kafka propose un *exactly-once* **natif** — mais **à l'intérieur de Kafka**. Le **producteur idempotent** (depuis 0.11) reçoit un ID de producteur (PID) et numérote ses messages (*sequence number*) : le broker **déduplique** les renvois. *« The idempotent delivery option guarantees that resending a message will not result in duplicate entries in the log. »* Les **transactions** Kafka permettent une écriture atomique multi-partitions (lire→traiter→écrire dans Kafka en un tout). **Mais** dès qu'un **effet externe** (envoyer un email, appeler Google) sort de Kafka, la transaction ne le couvre pas : tu **retombes** sur at-least-once + idempotence côté effet. Le *stream processing* exactly-once profond = **module 20**.

### 2.5 Dead letter queue (DLQ) & poison message

Un **poison message** est un message qui échoue **à chaque** tentative : payload corrompu, bug de parsing, dépendance définitivement cassée. Sans garde-fou, en *at-least-once*, le broker le **redélivre en boucle** : il monopolise le worker, bloque les messages sains derrière lui, et remplit les logs d'erreurs. C'est le *poison message loop*.

La parade : après **N tentatives**, on **cesse** de retenter ce message et on le déplace dans une **dead letter queue** — une file **de côté**, non consommée automatiquement, inspectée par un humain ou une alerte.

```
       ┌── traité OK ──▶ ack ──▶ supprimé
msg ──▶│
       └── échec ──▶ retry 1 ──▶ échec ──▶ retry 2 ──▶ … ──▶ retry N ──▶ ÉCHEC
                                                                          │
                                                                          ▼
                                                            ┌──────────────────────┐
                                                            │  DEAD LETTER QUEUE    │
                                                            │  (inspection humaine) │
                                                            └──────────────────────┘
```

Deux façons d'implémenter le compteur N :
- **Native au broker.** RabbitMQ a les *dead letter exchanges* (une queue est configurée pour router vers une DLQ après rejet/expiration) ; SQS a un *maxReceiveCount* + *redrive policy* (après N réceptions sans suppression, SQS déplace le message dans la DLQ configurée).
- **Applicative.** Tu portes un compteur `attempts` dans le message (ou une table), tu l'incrémentes à chaque échec, et **au-delà de N tu publies toi-même** vers la queue DLQ puis tu acquittes l'original (pour le sortir du flux).

> Une DLQ qui se remplit est un **signal d'alarme**, pas une poubelle. Mets une **alerte sur la taille de la DLQ** et un processus de re-traitement/correction. Un message en DLQ = du travail non fait, pas un incident résolu.

### 2.6 Ordre des messages — garanti où, exactement ?

Intuition dangereuse : « une queue est FIFO, donc l'ordre est garanti ». En distribué, **presque jamais globalement**. Là où l'ordre tient :

- **Un seul consommateur, une seule file, sans retry** → ordre préservé. Dès que tu ajoutes un **second consommateur** (pour aller plus vite), ils tirent des messages **en parallèle** et finissent dans un **ordre non déterministe**. Le débit s'achète au prix de l'ordre.
- **Redélivrance casse l'ordre** : un message retenté plus tard passe **après** ses successeurs.
- **Kafka : l'ordre est garanti par partition, pas globalement.** Un topic est découpé en **partitions** ; l'ordre est total **à l'intérieur d'une partition**, aucune garantie **entre** partitions. Pour que des messages liés restent ordonnés, on les envoie sur la **même partition** via une **clé de partition** (ex. `familyId`) — tous les messages d'une même famille vont dans la même partition, donc ordonnés entre eux.

Règle : ne suppose l'ordre **que** dans une partition/file à consommateur unique, et **conçois** pour que l'ordre ne soit requis **que** là où tu peux le garantir (clé de partition). Si ton traitement exige l'ordre global, tu perds le parallélisme — pèse-le.

### 2.7 Consumer group, offset, et scaling

Un **consumer group** est un ensemble de consommateurs qui **se partagent** le travail d'un même flux, comme une équipe qui vide une file commune : **chaque message n'est traité que par un seul membre** du groupe. C'est le levier de **scaling horizontal** : ajouter un worker au groupe **répartit** la charge automatiquement.

Sur un **stream** (Kafka), le mécanisme est le **partitionnement** : le groupe **assigne chaque partition à exactement un consommateur** du groupe. Conséquences directes :
- Le **parallélisme maximal** d'un groupe = **le nombre de partitions**. 3 partitions → au plus 3 consommateurs actifs ; un 4ᵉ resterait **inactif** (aucune partition à lui donner).
- Chaque consommateur avance l'**offset** de ses partitions ; on **commit** l'offset **après** traitement (at-least-once) ou **avant** (at-most-once) — même arbitrage qu'en §2.3, appliqué à l'offset.

Sur une **queue** (RabbitMQ/SQS), le même effet s'obtient avec **plusieurs consommateurs sur la même queue** (*competing consumers*) : le broker distribue les messages entre eux. Attention : distribution ≠ équité par défaut.

### 2.8 Prefetch & backpressure

Le **backpressure** survient quand les messages arrivent **plus vite** que le consommateur ne traite. Si le broker **pousse** sans limite, il **noie** un consommateur lent (mémoire qui explose, latence qui grimpe). La parade côté consommateur est le **prefetch** : plafonner le nombre de messages **non acquittés** qu'on accepte à la fois.

> RabbitMQ, *fair dispatch* : par défaut le broker distribue en round-robin *« It doesn't look at the number of unacknowledged messages for a consumer. »* Avec `basic_qos(prefetch_count=1)`, il *« not give more than one message to a worker at a time »* jusqu'à l'ack — un worker lent ne reçoit alors pas plus qu'il ne peut traiter, et le travail va au worker libre.

Autres leviers : **limiter la taille** du stream/file (Redis `MAXLEN`, rétention Kafka), **load shedding** (jeter le non-critique sous charge), et **scaling** des consommateurs (§2.7). Le détail des algos (token/leaky bucket) et du backpressure de flux = **module 15**.

---

## 3. Worked examples

### Exemple 1 — Concevoir la file d'export du §1, de bout en bout

But : sortir l'export Google Calendar de la requête HTTP, sans jamais perdre un export, en gérant les doublons et les poisons.

**Étape 1 — queue ou stream ?** C'est une **tâche à faire une fois puis oublier**. Aucun besoin de relire l'historique ni d'avoir plusieurs consommateurs indépendants. → **Queue**.

**Étape 2 — le producteur rend la main tout de suite** (couplage temporel supprimé) :

```ts
// sorties.controller.ts — APRÈS
async createSortie(input: CreateSortieInput): Promise<Sortie> {
  const sortie = await this.repo.save(Sortie.create(input));

  // On dépose une TÂCHE dans une file durable et on rend la main.
  await this.queue.publish('export.calendar', {
    messageId: randomUUID(),      // ← clé d'idempotence (Étape 4)
    sortieId: sortie.id,
    attempts: 0,                  // ← compteur pour la DLQ (Étape 5)
  });

  return sortie; // 201 immédiat : le parent n'attend PAS Google
}
```

**Étape 3 — le worker acquitte APRÈS avoir réussi** (⇒ at-least-once, choisi exprès : on préfère un doublon à une perte) :

```ts
// export.worker.ts
async onMessage(msg: ExportTask): Promise<void> {
  await this.googleCalendar.export(msg.sortieId); // si ça throw → PAS d'ack → redélivré
  await this.broker.ack(msg);                      // ack seulement en cas de succès
}
```

**Étape 4 — rendre le worker idempotent** (car at-least-once = doublons garantis un jour) :

```ts
async onMessage(msg: ExportTask): Promise<void> {
  // Déjà exporté cette tâche ? On acquitte sans refaire l'appel (idempotence par dédup).
  if (await this.processed.has(msg.messageId)) { await this.broker.ack(msg); return; }

  await this.googleCalendar.export(msg.sortieId);
  await this.processed.add(msg.messageId); // marque comme traité
  await this.broker.ack(msg);
}
```

**Étape 5 — DLQ pour le poison** (une sortie dont l'export échoue toujours ne doit pas boucler) :

```ts
const MAX_ATTEMPTS = 5;

async onMessage(msg: ExportTask): Promise<void> {
  if (await this.processed.has(msg.messageId)) { await this.broker.ack(msg); return; }
  try {
    await this.googleCalendar.export(msg.sortieId);
    await this.processed.add(msg.messageId);
    await this.broker.ack(msg);
  } catch (err) {
    if (msg.attempts + 1 >= MAX_ATTEMPTS) {
      await this.queue.publish('export.calendar.dlq', { ...msg, lastError: String(err) });
      await this.broker.ack(msg); // sort le poison du flux principal
    } else {
      // nack + requeue : le broker (ou un republish avec attempts+1) retentera plus tard
      await this.broker.nack(msg, { requeue: true });
    }
  }
}
```

**Ce que ce design achète :** `201` immédiat (latence découplée) ; aucun export perdu (persisté dans la file, retenté si Google down) ; pas de double événement calendrier (idempotence) ; un poison isolé en DLQ après 5 essais au lieu de bloquer les exports sains. **Reste à assumer :** l'export est en **cohérence différée** (quelques secondes après le `201`) — acceptable ici.

### Exemple 2 — Quatre besoins TribuZen : queue, stream, garantie, ordre

Pour chaque besoin, tranche le modèle et la garantie, et dis si l'ordre compte.

1. **« Envoyer l'email de rappel du soir. »** Tâche unique, oubliable. → **Queue**, **at-least-once** + dédup sur `messageId` (ne pas doubler l'email). Ordre : indifférent.
2. **« Journal d'audit : toute action famille, relisible et rejouable pour reconstruire un état. »** Besoin de **conserver** et **rejouer**. → **Stream (log)**, at-least-once. Ordre : **oui, par famille** → clé de partition `familyId` pour que les actions d'une même famille restent ordonnées.
3. **« Métrique “sortie vue” pour un dashboard, best-effort. »** Perdre un point est sans conséquence. → **At-most-once** assumé (ack avant traitement / fire-and-forget), inutile de payer l'idempotence.
4. **« Export Calendar (API externe lente, faillible). »** Tâche unique, faillible. → **Queue** dédiée, at-least-once, **retries + DLQ** après N échecs, idempotence côté effet (clé `sortieId`).

Fil conducteur : **tâche jetable → queue** ; **historique relisible/ordonné → stream + clé de partition** ; **jetable → at-most-once** ; **critique et faillible → at-least-once + idempotence + DLQ**.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que le broker garantit exactly-once « de bout en bout »

Le mythe le plus tenace. La quasi-totalité des brokers offrent **at-least-once** : si l'ack se perd ou si le consommateur crashe avant, ils **redélivrent** → **doublons**. Même l'EOS **natif** de Kafka (producteur idempotent + transactions) ne couvre que **l'intérieur de Kafka** : dès qu'un effet **externe** (email, appel HTTP) est en jeu, tu retombes sur at-least-once. La vraie parade n'est pas d'exiger l'exactly-once du transport, c'est de rendre **le consommateur idempotent**. Conçois **toujours** pour le doublon.

### PIÈGE #2 — Acquitter avant d'avoir traité

« J'acquitte à la réception, comme ça le broker est content. » Non : si tu crashes **pendant** le traitement, le message est **déjà supprimé** → **perte silencieuse** (tu viens de choisir *at-most-once* sans le vouloir). Sauf signal jetable, on acquitte **après** un traitement réussi. L'ordre `traiter → ack` **est** la garantie at-least-once.

### PIÈGE #3 — Confondre queue et stream

« C'est pareil, ça transporte des messages. » Non. Sur une **queue**, consommer **retire** le message : impossible de relire, un message = un consommateur. Sur un **stream**, consommer **avance un offset** : le log est conservé, plusieurs consommateurs indépendants relisent, on peut **rejouer**. Choisir une queue quand tu voulais rejouer l'historique = données perdues ; choisir un stream pour une simple to-do = complexité et rétention à gérer pour rien.

### PIÈGE #4 — Supposer l'ordre global des messages

« Ma file est FIFO, donc mes messages arrivent dans l'ordre. » Faux dès qu'il y a **plus d'un consommateur** (ils tirent en parallèle) ou une **redélivrance** (le retenté repasse après). Kafka lui-même ne garantit l'ordre **que par partition**, pas entre partitions. Ne dépends de l'ordre **que** dans une partition/file à consommateur unique, et route par **clé de partition** ce qui doit rester ordonné (ex. `familyId`).

### PIÈGE #5 — Oublier l'idempotence « parce que le doublon est rare »

En at-least-once le doublon n'est **pas** exceptionnel : un simple redéploiement pendant un ack, un timeout réseau, et le message repart. Sans dédup (`messageId` + table) ou opération naturellement idempotente (`SET` plutôt que `+= 1`), tu obtiens un email doublé, un compteur faussé, un double événement calendrier. L'idempotence n'est pas une option, c'est le socle du at-least-once.

### PIÈGE #6 — Retenter un poison à l'infini (pas de DLQ)

Un message qui échoue **toujours** (payload corrompu, bug) et qu'on remet en file **boucle** : il monopolise le worker et **bloque** les messages sains derrière lui. Il faut un **compteur de tentatives** et une **DLQ** au-delà de N : on isole le poison pour inspection au lieu de saturer le système. Et on **alerte** sur la taille de la DLQ — un message en DLQ = du travail non fait.

### PIÈGE #7 — Scaler les consommateurs sans penser au partitionnement

« J'ajoute des workers, ça ira plus vite. » Sur Kafka, le parallélisme d'un consumer group est **plafonné par le nombre de partitions** : 3 partitions → un 4ᵉ consommateur reste **inactif**. Sur une queue, plusieurs consommateurs se **volent** l'ordre. Le scaling horizontal se **conçoit** (nombre de partitions, clé de partition, tolérance au désordre), il ne s'improvise pas en ajoutant des process.

---

## 5. Ancrage TribuZen

TribuZen a un cœur transactionnel (créer une sortie, compléter une routine) et des **effets de bord lents ou faillibles** (export calendrier, envoi d'emails, notifications push, indexation). Le pont entre les deux est une **couche de messagerie asynchrone**.

**La file `export.calendar` (le cas du §1), de bout en bout :**

```
POST /sorties ──▶ [ save sortie ] ──▶ publish { messageId, sortieId, attempts:0 }
                                              │
                                      ┌───────▼────────── QUEUE "export.calendar" (durable)
                                      │        │  competing consumers (scaling)
                                      ▼        ▼
                                  worker-1  worker-2
                                      │  traite → ack (at-least-once)
                                      │  dédup sur messageId (idempotent)
                                      │  échec ×5 ──▶ QUEUE "export.calendar.dlq" ──▶ alerte
                                      ▼
                               Google Calendar API
```

Décisions concrètes pour TribuZen :

- **Modèle : queues** pour les tâches (export, email, push) — traitées une fois puis oubliées. Un **stream** (log) est réservé au **journal d'audit** des actions famille, seul cas où l'on veut **rejouer** et conserver.
- **Garantie assumée : at-least-once + idempotence.** Chaque tâche porte un `messageId` ; les workers dédupent. Concret : une notif de sortie n'est **jamais** envoyée deux fois même si le message est rejoué (spammer un parent = bug produit visible).
- **DLQ systématique** sur les tâches à effet externe, avec **alerte sur la taille**. Un export qui échoue 5× part en `export.calendar.dlq`, il ne bloque pas les exports des autres familles.
- **Ordre** : les tâches d'export sont **indépendantes** → l'ordre n'importe pas, on scale librement. Le **journal d'audit**, lui, est partitionné par `familyId` pour garder l'ordre **au sein d'une famille**.

> **Défère :** le **choix** d'émettre un événement vs une commande, le fan-out pub/sub et l'archi événementielle = **module 06 (next)** ; publier de façon fiable depuis la transaction DB (dual-write, **outbox**) = **module 13** ; retries/backoff/idempotency key génériques = **module 08** ; stream processing profond (windowing, EOS streaming) = **module 20** ; le broker managé concret (SQS/SNS, config, IAM) = **cours 12**. Ici on a posé **le tuyau et ses garanties**.

---

## 6. Points clés

1. **Broker** = intermédiaire qui stocke durablement et distribue ; il **découple dans le temps** (le producteur rend la main, le message attend si le consommateur est down).
2. **Queue vs stream** : consommer une **queue retire** le message (une tâche, un consommateur, pas de replay) ; consommer un **stream avance un offset** (log conservé, plusieurs lecteurs indépendants, replay possible).
3. **ack/nack** : on acquitte **après** traitement. Consommateur mort sans ack → **redélivrance** (jamais perdu, mais doublon possible). L'**ordre** `traiter → ack` **est** la garantie.
4. **Trois garanties** : at-most-once (perte possible, ack avant), **at-least-once** (doublons possibles, ack après — **le défaut**), exactly-once (idéal, illusoire de bout en bout).
5. **Exactly-once de bout en bout = at-least-once + consommateur idempotent** (dédup par `messageId` ou opération rejouable). L'EOS natif Kafka (producteur idempotent + transactions) ne vaut qu'**à l'intérieur** de Kafka.
6. **DLQ** : après N tentatives, un **poison message** est isolé dans une file de côté (au lieu de boucler et bloquer les sains) ; on **alerte** sur sa taille.
7. **Ordre garanti seulement par partition/file à consommateur unique** ; plusieurs consommateurs ou une redélivrance le cassent. **Consumer group** = partage du travail (un message → un membre), plafonné par le nombre de partitions. **Prefetch** = borne les messages non acquittés pour gérer le backpressure.

---

## 7. Seeds Anki

```
Quelle est la différence fondamentale entre une queue et un stream (log) ?|Sur une QUEUE, consommer RETIRE le message (une tâche traitée une fois par un seul consommateur, pas de replay — RabbitMQ, SQS). Sur un STREAM, consommer AVANCE un offset : le log append-only est conservé indépendamment de la lecture, plusieurs consommateurs relisent indépendamment et on peut rejouer l'historique (Kafka, Redis Streams).
Que se passe-t-il si un consommateur meurt sans acquitter (ack) son message ?|Le broker n'a jamais reçu la confirmation : il redélivre le message (au consommateur au retour ou à un autre). Conséquence : le message n'est jamais perdu, mais il peut être traité deux fois. C'est la racine de la garantie at-least-once.
Pourquoi acquitter APRÈS le traitement et pas avant ?|Ack après traitement = si crash avant l'ack, redélivrance → doublon = at-least-once (jamais perdu). Ack avant traitement = si crash pendant, message déjà supprimé → perte = at-most-once. L'ordre traiter→ack EST le choix de la garantie.
Quelles sont les trois garanties de livraison et laquelle est le défaut ?|At-most-once (perte possible, jamais de doublon), at-least-once (jamais perdu, doublons possibles — c'est le DÉFAUT de la plupart des brokers), exactly-once (idéal mais coûteux et illusoire de bout en bout dès qu'un effet externe entre en jeu).
Comment obtient-on l'exactly-once « de bout en bout » en pratique ?|On ne l'exige PAS du transport (il redélivre toujours). On combine at-least-once + un consommateur IDEMPOTENT : déduplication par messageId (table des IDs traités) ou opération naturellement idempotente (SET plutôt que compteur += 1). L'EOS natif Kafka (producteur idempotent + transactions) ne couvre que l'intérieur de Kafka.
À quoi sert une dead letter queue (DLQ) et qu'est-ce qu'un poison message ?|Un poison message échoue à chaque tentative (payload corrompu, bug). Sans garde-fou il est redélivré en boucle et bloque les messages sains. La DLQ l'isole : après N tentatives (maxReceiveCount SQS, dead letter exchange RabbitMQ, ou compteur applicatif) on le déplace dans une file de côté pour inspection humaine + alerte.
Où l'ordre des messages est-il garanti, et où ne l'est-il pas ?|Garanti seulement dans une partition (Kafka) ou une file à consommateur unique sans retry. Cassé dès qu'il y a plusieurs consommateurs (parallélisme) ou une redélivrance (le retenté repasse après). Pour garder l'ordre de messages liés, on les route sur la même partition via une clé (ex. familyId).
Qu'est-ce qu'un consumer group et par quoi son parallélisme est-il plafonné ?|Un ensemble de consommateurs qui se partagent un flux : chaque message n'est traité que par UN membre (scaling horizontal). Sur Kafka, chaque partition est assignée à exactement un consommateur du groupe → le parallélisme est plafonné par le nombre de partitions (3 partitions → un 4e consommateur reste inactif).
À quoi sert le prefetch et le backpressure ?|Le backpressure survient quand les messages arrivent plus vite qu'ils ne sont traités. Le prefetch borne le nombre de messages non acquittés qu'un consommateur accepte à la fois (RabbitMQ basic_qos prefetch_count), empêchant un broker de noyer un consommateur lent et envoyant le travail au worker libre.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-05-communication-asynchrone-message-queues/README.md`. Mettre en place une vraie file de messages TribuZen avec RabbitMQ (docker-compose fourni) : publier une tâche d'export, la consommer avec ack après traitement, provoquer un échec pour observer la redélivrance, rendre le consommateur idempotent, et router un poison message vers une DLQ. Exercice pratique évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
