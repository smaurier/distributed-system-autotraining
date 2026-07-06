---
titre: Stream processing
cours: 17-distributed-systems
notions: ["event streaming vs messaging (queue)", "log rejouable append-only", "offset détenu par le consumer", "log partitionné (Kafka-like)", "partition = unité d'ordre et de parallélisme", "clé de partition", "consumer group", "une partition par consumer dans un group", "rebalance", "commit d'offset", "replication factor", "event time vs processing time", "événements en désordre / en retard (late events)", "windowing", "fenêtre tumbling", "fenêtre sliding / hopping", "fenêtre session (gap d'inactivité)", "watermark", "allowed lateness", "side-output des late events", "stateful stream processing", "état local + changelog (dualité stream-table)", "checkpoint / reprise d'état", "exactly-once vs effectively-once", "producer idempotent (dedup par séquence)", "transaction read-process-write", "idempotence applicative par eventId"]
outcomes:
  - "sait distinguer un log de streaming rejouable (offset côté consumer, non destructif) d'une message queue simple, et savoir renvoyer au module 05 pour le messaging de base"
  - "sait décrire un log partitionné Kafka-like : partition comme unité d'ordre ET de parallélisme, offset, consumer group avec une partition par consumer, rebalance"
  - "sait expliquer pourquoi l'ordre n'est garanti qu'au sein d'une partition et choisir une clé de partition en conséquence"
  - "sait distinguer event time et processing time et expliquer pourquoi bucketiser sur le processing time fausse les agrégats quand les événements arrivent en retard"
  - "sait implémenter les fenêtres tumbling, sliding/hopping et session et choisir la bonne pour un besoin"
  - "sait poser un watermark comme heuristique de complétude, gérer allowed lateness et les late events, et arbitrer entre latence et exhaustivité"
  - "sait rendre un traitement stateful (état local + changelog) survivable au crash et au rebalance via checkpoint"
  - "sait expliquer pourquoi exactly-once est en réalité effectively-once et l'obtenir par producer idempotent, transaction read-process-write ou dédup applicative par eventId"
prerequis:
  - "Modules 00-19 de ce cours, en particulier le module 05 — communication asynchrone & message queues (brokers, garanties de livraison at-least-once, DLQ)"
  - "Module 06 — event-driven architecture (événement vs commande, pub/sub)"
  - "Module 08 — retries, timeouts, idempotency key, exactly-once semantics"
  - "Module 09 — cohérence & théorème CAP"
  - "Module 10 — réplication & partitionnement (sharding, hashing par clé, quorums)"
  - "Module 19 — temps, ordre & horloges (event time, désordre, happens-before)"
next: 21-crdts-et-resolution-de-conflits
libs: []
tribuzen: "backend TribuZen — le flux d'activité des familles (RSVP, messages, réservations) est un log partitionné rejouable ; on l'agrège en fenêtres event-time pour détecter en temps réel une sortie qui décolle, malgré des événements mobiles en retard"
last-reviewed: 2026-07
---

# Stream processing

> **Outcomes — tu sauras FAIRE :** distinguer un log de streaming rejouable d'une queue simple, décrire un log partitionné Kafka-like (partitions, offsets, consumer groups), choisir une clé de partition, séparer event time et processing time, implémenter les fenêtres tumbling/sliding/session, poser un watermark et gérer les late events, rendre un traitement stateful survivable, et obtenir de l'effectively-once.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes** du traitement d'un **flux infini** d'événements. On va **plus profond** que le module 05 : là on posait une **queue** (un message livré, ACKé, retiré). Ici le transport est un **log partitionné rejouable** (Kafka/Redpanda-like) et on **calcule sur le flux** : fenêtres, temps de l'événement, watermarks, état, exactly-once en streaming. On **ne** ré-explique **pas** le messaging de base (broker, at-least-once, DLQ, idempotency key générique → **module 05** et **module 08**) ni la **décision d'archi** event-driven « quand introduire un bus d'événements » (→ **cours 13-architecture**). Ici : comment un log partitionné garantit l'ordre et le parallélisme, et comment agréger correctement un flux dont les événements arrivent **en désordre et en retard**.

## 1. Cas concret d'abord

TribuZen veut un signal **temps réel** : « cette sortie **décolle** — 12 inscriptions dans les 10 dernières minutes », pour prévenir l'organisateur et mettre la sortie en avant. Chaque action d'un parent (RSVP à une sortie, message, réservation de place) est publiée comme un **événement** dans un flux `tribuzen.activity`.

Première version, naïve : un compteur qu'on incrémente **quand l'événement arrive** au serveur.

```ts
// ❌ compteur naïf — bucketise sur l'heure d'ARRIVÉE (processing time)
const compteurs = new Map<string, number>(); // clé = `${sortieId}:${fenêtre10min}`

function onEvent(e: ActivityEvent): void {
  if (e.type !== 'RSVP') return;
  const now = Date.now();                       // ← quand LE SERVEUR traite, pas quand l'action a eu lieu
  const fenetre = Math.floor(now / 600_000);
  const key = `${e.sortieId}:${fenetre}`;
  compteurs.set(key, (compteurs.get(key) ?? 0) + 1);
}
```

Trois bugs surgissent, invisibles en test mono-utilisateur :

1. **Le téléphone était hors ligne.** Un parent RSVP dans le métro à 12h03 ; son téléphone bufferise et n'envoie qu'à 12h11. Le compteur le range dans la fenêtre **12h10–12h20** alors que l'action a eu lieu dans **12h00–12h10**. L'agrégat « inscriptions par fenêtre » est **faux** : on mélange l'heure de l'action et l'heure d'arrivée.
2. **Le message est rejoué.** Le broker qui transporte l'événement est **at-least-once** (module 05) : sur un ACK perdu, l'événement `RSVP` de ce parent est **relivré**. Le compteur passe de 11 à 13 → on annonce « ça décolle » sur un doublon.
3. **On ne peut pas rejouer l'histoire.** Le compteur vit en mémoire ; au **crash** du processus, ou quand un autre nœud reprend la partition (**rebalance**), l'état est perdu et on ne peut pas **recalculer** depuis le début.

Ces trois bugs sont exactement les trois piliers du module : il faut compter sur le **temps de l'événement** (event time) et non sur celui du traitement, savoir **quand** une fenêtre est complète malgré les retards (**watermark**), et compter **exactement une fois** malgré les rejeux (**exactly-once**) — le tout sur un transport qui est un **log partitionné rejouable**, pas une queue jetable. On va reconstruire ce compteur proprement.

---

## 2. Théorie complète, concise

### 2.1 Event streaming ≠ message queue simple (le log rejouable)

Le module 05 a posé la **message queue** : un producteur envoie un message, un consommateur le lit, l'**ACK**, et le message est **retiré**. Un événement, un consommateur, puis oubli.

Le **streaming** change le transport : au lieu d'une queue jetable, un **log append-only ordonné et persistant**. Différence de référence : *« a traditional message queue deletes messages after consumption, while Kafka retains messages for a configured retention period regardless of consumer state »*. Conséquences directes :

- **Lecture non destructive.** Consommer **ne supprime pas** l'événement. *« events remain in the stream even after being consumed »* → **plusieurs** consommateurs indépendants lisent le **même** flux, chacun à son rythme.
- **L'offset est détenu par le consommateur.** Le broker ne « pousse » pas en retirant ; le consommateur garde **sa position** (l'offset) et peut la **rembobiner**. *« consumers can replay messages or start reading from any point in time »* → replay pour rejouer l'histoire, reconstruire un état, déboguer.
- **Rétention par temps/taille**, pas par consommation. Le log garde les événements X jours quel que soit qui a lu.

> **Quand rester en queue (module 05)** : une commande à traiter **une fois** par **un** worker (envoyer un email, lancer un job), sans besoin de replay ni de multi-consommateurs. **Quand passer au streaming** : un **flux** d'événements que **plusieurs** consommateurs agrègent, qu'il faut **rejouer**, ou sur lequel on calcule des **fenêtres**. Le choix d'archi entre les deux relève du **cours 13** ; ici on prend le streaming comme donné et on apprend à calculer dessus.

### 2.2 Le log partitionné (Kafka / Redpanda-like)

Un flux (**topic**) n'est pas **un** log mais **N partitions**, chacune un log append-only indépendant. La partition est l'unité de **deux** choses à la fois : l'**ordre** et le **parallélisme**.

- **Topic** — le flux nommé (`tribuzen.activity`).
- **Partition** — un sous-log ordonné. *« a given partition is always assigned to a single consumer, and the events in that partition are always read by the consumer in offset order »*. **L'ordre n'est garanti qu'À L'INTÉRIEUR d'une partition**, jamais entre partitions.
- **Offset** — *« a unique identifier, an integer, which marks the next record that should be read by the consumer in a partition »*. C'est la **position** du consommateur, séquentielle (0, 1, 2, …). Le consommateur *« only needs to keep track of the last offset it has consumed for each partition »*.
- **Clé de partition** — le producteur choisit une clé ; le broker mappe `hash(clé) % N` → une partition. **Même clé ⇒ même partition ⇒ ordre préservé** pour cette clé. Chez TribuZen : clé = `familyId` (ou `sortieId`) → tous les événements d'une même famille sont **ordonnés** entre eux.

```
topic tribuzen.activity, 3 partitions
P0: [o0][o1][o2][o3]        ← ordonné en interne (offsets croissants)
P1: [o0][o1]                ← ordonné en interne
P2: [o0][o1][o2]            ← ordonné en interne
   ↑ AUCUN ordre garanti ENTRE P0, P1, P2
```

**Consumer group.** Plusieurs consommateurs partageant un `group.id` se **répartissent** les partitions : *« each partition is consumed by exactly one consumer in the group »* — ce qui garantit lecture ordonnée **et** parallélisme. Règle dure du parallélisme : *« a partition can only be processed by one consumer »* mais un consommateur peut tenir plusieurs partitions. Donc **le parallélisme est plafonné par le nombre de partitions** : *« we can effectively use up to four consumers […] we could add a fifth but it would sit idle since partitions cannot be shared »*.

- **Rebalance** — quand un consommateur rejoint/quitte/crashe, le group **redistribue** les partitions. Le consommateur qui reprend une partition *« resumes reading from the last committed offset »*.
- **Commit d'offset** — le consommateur **valide** périodiquement sa position auprès du coordinateur ; au redémarrage il repart de là. **Où** placer ce commit (avant ou après avoir traité) détermine at-least-once vs at-most-once (§2.7).
- **Replication factor** — chaque partition est **répliquée** sur R brokers (module 10) : une réplique **leader**, des **followers**. Le leader tombe → un follower prend le relais. C'est ce qui rend le log **durable** malgré une panne de broker.

### 2.3 Event time vs processing time

Deux horloges, à ne jamais confondre (le bug #1 du §1) :

- **Event time** — *« the time that each individual event occurred on its producing device […] typically embedded within the records before they enter »* le système. C'est **quand l'action a eu lieu** (le RSVP à 12h03 sur le téléphone).
- **Processing time** — *« the system time of the machine that is executing the respective operation »*. C'est **quand le serveur traite** l'événement (12h11, après la reconnexion).

Le processing time est plus simple (aucune coordination, latence minimale) mais **ment** dès qu'il y a du réseau : les événements arrivent **en désordre** et **en retard**. Un parent hors ligne, un mobile qui bufferise, une partition réseau → un événement d'event time 12h03 débarque **après** un event time 12h05. Pour un agrégat **correct** (« combien d'inscriptions **se sont produites** entre 12h00 et 12h10 »), il faut fenêtrer sur l'**event time**, pas sur l'heure d'arrivée. Prix à payer : on ne sait plus **quand** une fenêtre est complète → d'où les watermarks (§2.5).

### 2.4 Windowing — découper un flux infini en fenêtres finies

Un flux est **infini** ; on ne peut pas « attendre la fin » pour agréger. Le **fenêtrage** regroupe les événements en tranches finies sur lesquelles on calcule (somme, count, moyenne). Trois familles :

- **Tumbling (fixe, sans chevauchement)** — fenêtres contiguës de taille fixe ; chaque événement tombe dans **exactement une** fenêtre. *Ex :* inscriptions par tranche de 10 min : `[12:00–12:10)`, `[12:10–12:20)`, …
- **Sliding / hopping (fixe, avec chevauchement)** — fenêtres de taille fixe qui **avancent** d'un pas plus petit que leur taille ; un événement appartient à **plusieurs** fenêtres. *Ex :* « inscriptions sur les 10 dernières minutes, recalculé toutes les 2 min » → taille 10 min, pas 2 min. Utile pour une moyenne glissante réactive. *(Terminologie : « sliding » = fenêtres qui se recouvrent ; certains systèmes réservent « hopping » au pas fixe et « sliding » au recalcul déclenché par chaque événement — l'idée du chevauchement est la même.)*
- **Session (gap d'inactivité)** — fenêtres de taille **variable**, délimitées non par l'horloge mais par un **trou d'inactivité** : *« punctuated by a gap of inactivity »*. Tant que les événements se suivent à moins de `gap`, ils forment **une** session ; un trou > `gap` en ouvre une nouvelle. *Ex TribuZen :* une **session de planification** d'un parent (rafale de consultations/RSVP séparées par des pauses) — parfaite pour mesurer un « effort de planification » sans borne temporelle fixe.

```
TUMBLING   |__W1__|__W2__|__W3__|          chaque event → 1 fenêtre
SLIDING    |__W1__|                         event → plusieurs fenêtres
              |__W2__|
                 |__W3__|
SESSION    |e e e|   gap   |e e|  gap  |e e e e|   frontières = inactivité
```

### 2.5 Watermarks & late events

Sur l'event time, une fenêtre `[12:00–12:10)` ne peut pas se fermer « à 12:10 sur l'horloge murale » : un événement d'event time 12:07 peut encore arriver à 12:13. **Quand décider que la fenêtre est complète ?** Réponse : le **watermark**.

Un watermark `W(t)` est une **assertion de complétude** : *« event time has reached time t in that stream, meaning that there should be no more elements from the stream with a timestamp t' ≤ t »*. Quand le watermark dépasse la fin d'une fenêtre, on considère la fenêtre **complète** et on **émet** son résultat.

- **Comment on le calcule** — typiquement `watermark = max(event time vu) − délai_de_retard_toléré`. C'est une **heuristique**, pas une vérité : on **parie** que tout ce qui devait arriver avant `t` est arrivé.
- **Late event (événement tardif)** — *« elements arriving after the system's event time clock has passed their timestamp »*. Un événement dont l'event time est **derrière** le watermark : sa fenêtre est déjà considérée close.
- **Allowed lateness (tolérance au retard)** — on peut garder une fenêtre **ouverte** un peu après le watermark pour absorber les retardataires : la fenêtre est fermée à l'émission, mais **conservée** jusqu'à `fin + allowed_lateness` ; un late event dans cette marge **met à jour** le résultat. Au-delà, l'événement part dans un **side-output** (log des tardifs) plutôt que d'être compté dans une fenêtre déjà scellée.

**L'arbitrage central :** watermark **agressif** (petit délai) = résultats **tôt** mais on **drop** des événements valides encore en vol ; watermark **conservateur** (grand délai) = résultats **complets** mais **en retard**. C'est le compromis latence ↔ exhaustivité du stream processing.

### 2.6 Stateful stream processing

Compter, dédupliquer, détecter une session : tout ça demande de **garder un état** entre les événements (le bug #3 du §1). Un état de streaming **n'est pas** juste une variable en mémoire — sinon il disparaît au crash ou au rebalance.

- **État local** — chaque instance tient l'état des **partitions qu'elle possède** (les compteurs par fenêtre, les eventIds déjà vus). Colocaliser l'état avec la partition évite un aller-retour réseau par événement.
- **Changelog & dualité stream-table** — l'état est adossé à un **log de changements** : *« un stream est le changelog d'une table ; une table est la matérialisation d'un stream »*. Chaque mutation de l'état est écrite dans un topic changelog compacté. Au crash/rebalance, la nouvelle instance **rejoue** le changelog et **reconstruit** l'état exact — d'où l'importance d'un log **rejouable** (§2.1).
- **Checkpoint / reprise** — périodiquement, l'état et les **offsets** correspondants sont **capturés** ensemble. À la reprise, on restaure l'état **et** on repart des offsets de ce checkpoint : l'état et la position du log restent **cohérents**. C'est la brique qui rend l'exactly-once possible (§2.7) — dans un système comme Flink, *« "Exactly Once" semantics are ensured by the Checkpoint mechanism »*.

### 2.7 Exactly-once en streaming (en réalité *effectively-once*)

Le broker qui porte le flux est **at-least-once** : *« messages are delivered one or more times […] they may be delivered more than once »* (module 05). Un rejeu double le compteur (bug #2). L'objectif **exactly-once** — *« each message is delivered once and only once […] even if some part of the system fails »* — s'obtient par trois leviers, souvent combinés :

1. **Producer idempotent** — côté production, *« the broker assigns each producer an ID and deduplicates messages using a sequence number »* : un renvoi du **même** message n'ajoute **pas** de doublon dans le log. Élimine les doublons **d'écriture** dus au retry du producteur.
2. **Transaction read-process-write** — pour un consommateur qui lit, transforme et **réécrit** (le cas Kafka Streams), le **commit d'offset** de lecture et l'**écriture** du résultat sont enveloppés dans **une transaction atomique** : soit les deux, soit aucun. *« Kafka leverages transactional producer capabilities […] to achieve exactly once semantics »* — pas de résultat écrit sans offset avancé, ni l'inverse.
3. **Idempotence applicative (dédup par `eventId`)** — quand le sink n'est pas transactionnel (une base, un compteur), on porte un **identifiant métier** stable dans l'événement et on **déduplique dans l'état** : « ce `eventId` a-t-il déjà été compté ? ». C'est la contre-mesure du bug #2.

> **La nuance qui compte : exactly-once = effectively-once.** Il n'existe pas de magie « livré une seule fois » de bout en bout. On combine **at-least-once + idempotence/transactions** pour obtenir le **même résultat** qu'un traitement unique. Et la garantie n'est **de bout en bout** que si **tous** les maillons participent : producteur (idempotent), broker (transactions), état (checkpoint atomique avec les offsets), et **sink** (transactionnel ou idempotent). Un seul maillon at-least-once non idempoté et le doublon revient. Détail d'ordonnancement critique : **commiter l'offset APRÈS** avoir traité/écrit (sinon un crash entre commit et traitement = **perte** = at-most-once) ; comme le commit-après crée du at-least-once, la dédup/transaction reste indispensable.

---

## 3. Worked examples

### Exemple 1 — Le compteur « sortie qui décolle », en event-time avec watermark

But : reconstruire le compteur du §1 **correctement**. On consomme le vrai log partitionné (via `kafkajs`, connecté à Redpanda du lab), on fenêtre en **tumbling event-time** de 10 min, on gère les **late events** avec `allowed lateness`, et on **déduplique** par `eventId` (effectively-once).

```ts
// activity-windower.ts — agrège tribuzen.activity en fenêtres event-time
import { Kafka } from 'kafkajs';

interface ActivityEvent {
  eventId: string;   // idempotence applicative (dédup)
  familyId: string;  // clé de partition → ordre par famille
  sortieId: string;
  type: 'RSVP' | 'MESSAGE' | 'PLACE_RESERVED';
  eventTime: number; // ms — QUAND l'action a eu lieu sur le téléphone (pas l'arrivée)
}

const WINDOW_MS = 10 * 60_000;          // fenêtres tumbling de 10 min
const ALLOWED_LATENESS_MS = 5 * 60_000; // on garde une fenêtre 5 min après sa fin
const WATERMARK_DELAY_MS = 2 * 60_000;  // on parie : rien de plus vieux que (max - 2 min)

const windowStart = (t: number) => Math.floor(t / WINDOW_MS) * WINDOW_MS;

// état stateful : par (sortieId, fenêtre) → compteur + eventIds vus (dédup) + émis ?
interface WindowState { count: number; seen: Set<string>; emitted: boolean; }
const windows = new Map<string, WindowState>(); // clé = `${sortieId}:${windowStart}`
let watermark = 0;
let maxEventTime = 0;

function onEvent(e: ActivityEvent): void {
  maxEventTime = Math.max(maxEventTime, e.eventTime);

  const ws = windowStart(e.eventTime);
  const we = ws + WINDOW_MS;

  // late event au-delà de la tolérance : la fenêtre est scellée → side-output, PAS compté
  if (we + ALLOWED_LATENESS_MS < watermark) {
    sideOutputLate(e);        // log des tardifs (audit), jamais dans une fenêtre close
    return;
  }

  const key = `${e.sortieId}:${ws}`;
  const w = windows.get(key) ?? { count: 0, seen: new Set<string>(), emitted: false };

  // exactly-once applicatif : un eventId déjà vu n'est PAS recompté (rejeu at-least-once)
  if (e.type === 'RSVP' && !w.seen.has(e.eventId)) {
    w.seen.add(e.eventId);
    w.count += 1;
    // si la fenêtre était déjà émise (late event dans la marge) → on ré-émet la MàJ
    if (w.emitted) emit(e.sortieId, ws, we, w.count, /*late*/ true);
  }
  windows.set(key, w);
}

// le watermark n'avance QUE via l'event time observé, jamais l'horloge murale
function advanceWatermark(): void {
  const wm = maxEventTime - WATERMARK_DELAY_MS;
  if (wm <= watermark) return;
  watermark = wm;
  for (const [key, w] of windows) {
    const we = Number(key.split(':')[1]) + WINDOW_MS;
    if (we <= watermark && !w.emitted) {      // fenêtre complète → on émet
      w.emitted = true;
      const [sortieId, wsStr] = key.split(':');
      emit(sortieId, Number(wsStr), we, w.count, /*late*/ false);
    }
  }
}

function emit(sortieId: string, ws: number, we: number, count: number, late: boolean) {
  console.log(`[${new Date(ws).toISOString()}..${new Date(we).toISOString()}) `
    + `sortie=${sortieId} inscriptions=${count}${late ? ' (MàJ tardive)' : ''}`);
  if (count >= 12) notifyOrganizer(sortieId, count); // "ta sortie décolle"
}

// --- consommation du log partitionné (kafkajs → Redpanda) ---
async function main() {
  const kafka = new Kafka({ clientId: 'activity-windower', brokers: ['localhost:19092'] });
  const consumer = kafka.consumer({ groupId: 'activity-windower' }); // consumer group
  await consumer.connect();
  await consumer.subscribe({ topic: 'tribuzen.activity', fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const e: ActivityEvent = JSON.parse(message.value!.toString());
      onEvent(e);        // 1) traiter
      advanceWatermark(); // 2) faire progresser le temps de l'événement
      // kafkajs commit l'offset APRÈS eachMessage (auto) → at-least-once → d'où la dédup
    },
  });
}
main();
```

**Ce que ce design corrige, point par point :**
- **Event time** — on bucketise sur `e.eventTime` (l'action), jamais sur `Date.now()`. Le RSVP hors ligne d'event time 12:03 retombe dans `[12:00–12:10)` même arrivé à 12:11.
- **Watermark + allowed lateness** — la fenêtre `[12:00–12:10)` n'est émise que quand `maxEventTime − 2 min ≥ 12:10`, et reste corrigeable 5 min de plus ; un retardataire dans la marge **ré-émet** un résultat corrigé ; au-delà → side-output (pas de comptage dans une fenêtre scellée).
- **Effectively-once** — `seen: Set<eventId>` : un RSVP rejoué par le broker at-least-once n'incrémente **pas** deux fois. Le compteur reste juste.
- **Partitionné** — clé = `familyId` : les événements d'une famille restent **ordonnés** ; le `groupId` permet de scaler à plusieurs instances, plafonné par le nombre de partitions.

**Ce qu'il reste à assumer :** l'état (`windows`) vit en mémoire — en prod, il faut le **checkpointer** avec les offsets (§2.6) pour survivre au crash/rebalance ; ici c'est le point que le lab pousse plus loin.

### Exemple 2 — Pourquoi le naïf double-compte, et les trois façons de le réparer

Reprenons le bug #2 en isolé. Séquence at-least-once :

```
t0  producteur envoie RSVP(eventId=r-42)          → écrit au log offset 137
t1  consumer lit offset 137, compteur 11 → 12
t2  consumer traite, mais CRASH avant de commiter l'offset 137
t3  rebalance : une autre instance reprend, repart de l'offset committé 137
t4  elle relit RSVP(eventId=r-42), compteur 12 → 13   ← DOUBLON
```

Le compteur affiche 13 pour 12 inscriptions réelles. Trois réparations, du plus local au plus global :

```ts
// A) Idempotence applicative (ce que fait l'exemple 1) — dédup par eventId dans l'état
if (!w.seen.has(e.eventId)) { w.seen.add(e.eventId); w.count += 1; }
// r-42 rejoué → déjà dans `seen` → ignoré. Correct même si le broker relivre 10 fois.

// B) Producer idempotent — supprime les doublons d'ÉCRITURE (retry du producteur)
const producer = kafka.producer({ idempotent: true }); // seq number + dedup broker
// si le producteur renvoie RSVP(r-42) sur un ACK perdu, le log ne le stocke qu'UNE fois.

// C) Transaction read-process-write — pour lire→agréger→réécrire atomiquement
const producer2 = kafka.producer({ transactionalId: 'windower-tx', idempotent: true });
const tx = await producer2.transaction();
try {
  await tx.send({ topic: 'tribuzen.trending', messages: [{ value: result }] }); // écriture
  await tx.sendOffsets({ consumerGroupId: 'activity-windower', topics: [/* offsets lus */] });
  await tx.commit();   // écriture + avancement d'offset = ATOMIQUE (tout ou rien)
} catch { await tx.abort(); } // crash → rien n'est écrit ni committé → pas de doublon
```

**Lequel choisir ?** **A** partout où le sink est une base/un compteur (le cas TribuZen le plus courant) : simple, robuste, marche même si le producteur n'est pas idempotent. **B** en complément, pour ne pas polluer le log de doublons à la source. **C** quand on est dans un pipeline **Kafka→calcul→Kafka** et qu'on veut l'exactly-once **de bout en bout** — au prix d'un débit plus faible (transactions). Aucun des trois n'est « magique » : chacun transforme de l'at-least-once **plus** de l'idempotence/atomicité en **effectively-once**.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Traiter le log comme une queue jetable

« Le consommateur lit le message, donc il est consommé/supprimé. » Faux pour un log de streaming : la lecture est **non destructive**, l'offset est **côté consommateur**, et le log est **rejouable**. Deux services peuvent lire le **même** flux ; on peut **rembobiner** pour recalculer. Concevoir comme une queue (un lecteur, puis oubli) prive du replay et du multi-consommateur qui font tout l'intérêt du streaming. Si tu n'as **besoin** ni de l'un ni de l'autre → reste sur une queue (module 05), ne sors pas l'artillerie.

### PIÈGE #2 — Croire à un ordre global sur le topic

« Kafka garantit l'ordre. » Seulement **au sein d'une partition**. Entre partitions, aucun ordre. Deux événements d'un même `sortieId` peuvent être traités dans le désordre s'ils sont partitionnés par autre chose. **Correct :** partitionne par la clé dont tu veux l'ordre (`familyId`/`sortieId`) → même clé, même partition, ordre préservé. L'ordre total sur tout le topic n'existe que si `N = 1` partition — au prix du parallélisme.

### PIÈGE #3 — Ajouter des consommateurs pour scaler au-delà des partitions

« Plus de consommateurs = plus vite. » Plafonné : une partition n'est lue que par **un** consommateur du group. 4 partitions ⇒ 4 consommateurs utiles ; le 5ᵉ **reste inactif**. Pour scaler, il faut **plus de partitions** (choisi à la création du topic), pas juste plus de consommateurs.

### PIÈGE #4 — Fenêtrer sur le processing time

Bucketiser sur l'heure d'arrivée (`Date.now()`) donne des agrégats **faux** dès qu'il y a du retard/désordre : un événement d'event time 12:03 arrivé à 12:11 est compté dans la mauvaise tranche. **Correct :** fenêtre sur l'**event time** embarqué dans l'événement. Le processing time n'est acceptable que si tu te fiches de la précision temporelle (ex. un débit brut « messages/sec traités »).

### PIÈGE #5 — Prendre le watermark pour une vérité

« Après le watermark, plus rien n'arrivera. » C'est une **heuristique** (`max − délai`), pas une garantie. Trop **agressif** → tu **drops** des événements valides encore en vol ; trop **conservateur** → tes résultats sortent **en retard**. **Correct :** dimensionne le délai sur le retard réel observé, et ajoute une `allowed lateness` + un **side-output** pour les tardifs, au lieu de les perdre silencieusement.

### PIÈGE #6 — Croire à un exactly-once « natif » et magique

« J'active exactly-once, fini les doublons. » L'exactly-once **de bout en bout** est en réalité **effectively-once** : at-least-once **+** idempotence/transactions, et il faut que **tous** les maillons participent (producteur, broker, état+offset, sink). Un seul sink at-least-once non idempoté → le doublon revient. **Correct :** porte un `eventId` stable et déduplique dans l'état, ou utilise des transactions read-process-write si le pipeline est Kafka→Kafka.

### PIÈGE #7 — Un état de streaming = une variable en mémoire

« Mon compteur est dans une `Map`, ça suffit. » Au **crash** ou au **rebalance**, l'état en mémoire disparaît et le résultat est faux. **Correct :** adosse l'état à un **changelog** rejouable et **checkpointe** l'état **avec** les offsets, pour restaurer un état **cohérent** avec la position de lecture. Sinon tu recomptes ou tu perds.

---

## 5. Ancrage TribuZen

TribuZen produit un **flux d'activité** naturel : chaque interaction d'un parent est un événement. On le traite comme un **log partitionné rejouable**, pas comme une suite d'appels REST.

**Topic `tribuzen.activity`** — clé de partition = `familyId` (ordre garanti par famille, parallélisme entre familles). Événements : `RSVP`, `MESSAGE`, `PLACE_RESERVED`, `SORTIE_VIEWED`, chacun avec `eventId` (dédup) et `eventTime` (horodaté sur le device).

Cas d'usage streaming concrets :

- **« Sortie qui décolle »** (worked example 1) — fenêtre **tumbling** event-time 10 min par `sortieId`, comptant les `RSVP` ; seuil atteint → notifier l'organisateur. Robuste aux RSVP mobiles **en retard** (watermark + allowed lateness) et aux **rejeux** (dédup `eventId`).
- **Fenêtre glissante « tendance »** — **sliding** 30 min / pas 5 min sur les vues+RSVP → une jauge de popularité qui réagit vite sans à-coups de frontière de fenêtre.
- **Session de planification** — fenêtre **session** (gap 15 min) sur l'activité d'un parent → mesurer une « rafale de planification » (il consulte 6 sorties puis s'arrête) pour, plus tard, adapter les relances.
- **Replay** — rejouer `tribuzen.activity` depuis l'offset 0 pour **reconstruire** un tableau de bord de stats ou **corriger** un bug d'agrégation sans redemander la donnée aux clients.

> **Défère :** la **décision d'archi** « faut-il un bus d'événements / event-driven ici ? » → **cours 13-architecture** ; le **messaging simple** (commande à un worker, DLQ, at-least-once de base) → **module 05** ; l'**idempotency key** générique d'une requête → **module 08** ; la **sémantique event time / désordre / happens-before** au niveau horloges → **module 19**. Ici on a posé le **calcul sur le flux** : log partitionné, fenêtres, watermarks, état, effectively-once.

---

## 6. Points clés

1. **Streaming ≠ queue** : log **append-only rejouable**, lecture **non destructive**, **offset côté consommateur**, rétention par temps → replay et multi-consommateurs. La queue simple reste au **module 05**.
2. **Log partitionné** : le **topic** = N **partitions** ; la partition est l'unité d'**ordre** ET de **parallélisme**. L'**offset** est la position du consommateur.
3. **Ordre garanti seulement dans une partition** → choisis la **clé de partition** selon l'ordre voulu (`familyId`/`sortieId`).
4. **Consumer group** : une **partition par consommateur** dans le group → parallélisme **plafonné** par le nombre de partitions ; **rebalance** au départ/arrivée ; **commit d'offset** = point de reprise.
5. **Event time ≠ processing time** : fenêtrer sur l'**event time** (l'action), jamais sur l'heure d'arrivée, sinon agrégats faux en cas de retard/désordre.
6. **Windowing** : **tumbling** (fixe, disjoint), **sliding/hopping** (fixe, chevauchant), **session** (gap d'inactivité, taille variable).
7. **Watermark** = **heuristique** de complétude (`max − délai`) qui déclenche l'émission ; **allowed lateness** + **side-output** gèrent les **late events** ; arbitrage **latence ↔ exhaustivité**.
8. **Stateful** : l'état doit être adossé à un **changelog** (dualité stream-table) et **checkpointé avec les offsets** pour survivre crash/rebalance.
9. **Exactly-once = effectively-once** : at-least-once **+** producteur idempotent / transaction read-process-write / **dédup applicative par `eventId`**, avec **tous** les maillons participants.

---

## 7. Seeds Anki

```
En quoi un log de streaming (Kafka-like) diffère-t-il d'une message queue simple ?|La queue supprime le message après consommation (un lecteur, puis oubli). Le log de streaming est append-only, persistant et REJOUABLE : la lecture est non destructive, l'offset est détenu par le consommateur (rembobinable), la rétention se fait par temps/taille indépendamment des consommateurs. Résultat : plusieurs consommateurs indépendants et replay possible. La queue simple reste le sujet du module 05.
Qu'est-ce qu'une partition Kafka et que garantit-elle sur l'ordre ?|Un topic est divisé en N partitions, chacune un log append-only ordonné. La partition est l'unité d'ordre ET de parallélisme. L'ordre n'est garanti qu'AU SEIN d'une partition (offsets croissants), jamais entre partitions. Pour préserver l'ordre d'une entité, on la partitionne par une clé stable (familyId) : même clé → même partition → ordre préservé.
Qu'est-ce qu'un offset et qui le détient ?|L'offset est la position séquentielle (0,1,2,…) d'un message dans une partition ; il marque le prochain enregistrement à lire. C'est le CONSOMMATEUR qui détient sa position : il ne suit que le dernier offset consommé par partition, peut le rembobiner (replay), et au redémarrage repart du dernier offset committé.
Comment un consumer group répartit-il les partitions, et quel est le plafond de parallélisme ?|Chaque partition est assignée à EXACTEMENT UN consommateur du group (lecture ordonnée + parallélisme). Un consommateur peut tenir plusieurs partitions, mais une partition n'est jamais partagée. Donc le parallélisme est plafonné par le nombre de partitions : 4 partitions → 4 consommateurs utiles, le 5e reste inactif. Un rebalance redistribue quand un membre part/arrive.
Event time vs processing time : pourquoi la distinction est-elle critique ?|Event time = quand l'action a eu lieu (embarqué dans l'événement, ex. RSVP à 12h03 sur le téléphone). Processing time = quand le serveur traite (ex. 12h11 après reconnexion). Comme les événements arrivent en désordre et en retard (mobile hors ligne, réseau), fenêtrer sur le processing time range l'événement dans la mauvaise tranche → agrégats faux. Il faut fenêtrer sur l'event time.
Quelles sont les trois familles de fenêtres et à quoi servent-elles ?|Tumbling : fenêtres fixes disjointes, chaque événement dans exactement une (ex. count par 10 min). Sliding/hopping : fenêtres fixes qui se chevauchent (taille > pas), un événement dans plusieurs (ex. moyenne glissante 10 min recalculée toutes les 2 min). Session : taille variable délimitée par un gap d'inactivité (ex. rafale de planification d'un parent).
Qu'est-ce qu'un watermark et quel arbitrage impose-t-il ?|Un watermark W(t) est une assertion heuristique de complétude : "l'event time a atteint t, plus aucun élément de timestamp ≤ t ne devrait arriver". Quand il dépasse la fin d'une fenêtre, on émet le résultat. Calculé typiquement max(event time) − délai toléré. Arbitrage : agressif = résultats tôt mais on drop des retardataires valides ; conservateur = résultats complets mais en retard. Latence vs exhaustivité.
Comment gère-t-on un late event (événement en retard) ?|Un late event a un event time derrière le watermark : sa fenêtre est déjà considérée close. Avec allowed lateness, on garde la fenêtre corrigeable un temps après sa fin : un retardataire dans la marge met à jour (ré-émet) le résultat. Au-delà de la marge, l'événement part dans un side-output (log des tardifs pour audit) au lieu d'être compté dans une fenêtre scellée ou perdu silencieusement.
Pourquoi dit-on que l'exactly-once est en réalité effectively-once, et comment l'obtenir ?|Il n'existe pas de livraison "une seule fois" magique : le broker est at-least-once. On obtient le MÊME résultat qu'un traitement unique en combinant at-least-once + idempotence/atomicité : producteur idempotent (dedup par numéro de séquence côté broker), transaction read-process-write (écriture + commit d'offset atomiques), ou dédup applicative par eventId dans l'état. La garantie n'est de bout en bout que si TOUS les maillons participent (producteur, broker, état+offset, sink).
Pourquoi un état de streaming ne peut-il pas être une simple variable en mémoire ?|Parce qu'au crash du processus ou au rebalance (une autre instance reprend la partition), l'état en mémoire disparaît → résultat faux. Il faut adosser l'état à un changelog rejouable (dualité stream-table) et le checkpointer AVEC les offsets, pour restaurer un état cohérent avec la position de lecture. C'est aussi la brique qui rend l'exactly-once possible.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-20-stream-processing/README.md`. Monter un **Redpanda** mono-broker via le docker-compose fourni, produire le flux `tribuzen.activity` (avec `eventId` et `eventTime`), puis écrire en `kafkajs` un **agrégateur event-time** : fenêtres **tumbling** 10 min par `sortieId`, **watermark** + **allowed lateness**, **dédup par eventId** (effectively-once). Provoquer les trois bugs du §1 (event en retard, rejeu, perte d'état au restart) et les corriger. Évalué par grille + coach, variante J+30 — zéro harnais auto-correcteur.
