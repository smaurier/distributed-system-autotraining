# Lab 20 — Stream processing

> **Outcome :** à la fin, tu sais consommer un **log partitionné** réel (Redpanda, API Kafka), agréger le flux d'activité TribuZen en **fenêtres event-time** avec **watermark** et **allowed lateness**, gérer les **late events** et rendre le comptage **effectively-once** (dédup par `eventId`) — puis observer ce qui casse au **restart** faute d'état persistant.
> **Vrai outil :** Redpanda (mono-broker, Kafka-compatible) via le **docker-compose fourni** + Node.js/TypeScript + `kafkajs`. Pas de framework de streaming (ni Flink, ni Kafka Streams) : tu écris l'agrégateur à la main pour **voir** les mécanismes.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Contexte

TribuZen veut un signal temps réel : **« cette sortie décolle »** — au moins 12 inscriptions (`RSVP`) dans une **fenêtre de 10 minutes**, pour notifier l'organisateur. Chaque action d'un parent est un événement du flux `tribuzen.activity`, partitionné par `familyId`. Trois difficultés du monde réel, à traiter :

1. les RSVP arrivent **en retard et en désordre** (téléphone hors ligne dans le métro) → il faut fenêtrer sur l'**event time**, pas sur l'heure d'arrivée ;
2. le broker est **at-least-once** → un RSVP peut être **rejoué** → dédup par `eventId` ;
3. l'état (compteurs) vit en mémoire → un **restart**/rebalance le perd → tu dois le **constater** puis proposer la parade (replay / checkpoint).

## Environnement fourni (docker-compose)

Un `docker-compose.yml` t'est fourni (ne le modifie pas). Redpanda expose l'API Kafka sur `localhost:19092` et une console web sur `http://localhost:8080`.

```yaml
# docker-compose.yml (fourni) — Redpanda mono-broker + Console
name: lab20-redpanda
networks:
  redpanda: { driver: bridge }
volumes:
  redpanda-0: null
services:
  redpanda-0:
    image: docker.redpanda.com/redpandadata/redpanda:v26.1.12
    container_name: redpanda-0
    command:
      - redpanda
      - start
      - --kafka-addr internal://0.0.0.0:9092,external://0.0.0.0:19092
      - --advertise-kafka-addr internal://redpanda-0:9092,external://localhost:19092
      - --schema-registry-addr internal://0.0.0.0:8081,external://0.0.0.0:18081
      - --rpc-addr redpanda-0:33145
      - --advertise-rpc-addr redpanda-0:33145
      - --mode dev-container
      - --smp 1
    ports: ["19092:19092", "18081:18081", "19644:9644"]
    volumes: [ "redpanda-0:/var/lib/redpanda/data" ]
    networks: [ redpanda ]
  console:
    image: docker.redpanda.com/redpandadata/console:v3.8.0
    container_name: redpanda-console
    depends_on: [ redpanda-0 ]
    environment:
      KAFKA_BROKERS: redpanda-0:9092
    ports: ["8080:8080"]
    networks: [ redpanda ]
```

```bash
docker compose up -d                 # démarre Redpanda + Console
pnpm install                         # kafkajs, tsx

# crée le topic AVEC 3 partitions (le parallélisme se joue ici, pas au nb de consumers)
docker exec -it redpanda-0 rpk topic create tribuzen.activity -p 3

pnpm run produce                     # rejoue un jeu d'événements (fourni, voir plus bas)
pnpm run window                      # démarre ton agrégateur event-time
```

**Jeu d'événements fourni** (`data/activity.jsonl`, un `ActivityEvent` par ligne). Il contient **volontairement** : un RSVP **en retard** (event time dans une fenêtre déjà passée à l'arrivée), un RSVP **dupliqué** (même `eventId`, livré deux fois), et un RSVP **très en retard** (au-delà de l'allowed lateness → doit finir en side-output).

```ts
// src/types.ts (fourni)
export interface ActivityEvent {
  eventId: string;   // idempotence applicative
  familyId: string;  // clé de partition
  sortieId: string;
  type: 'RSVP' | 'MESSAGE' | 'PLACE_RESERVED' | 'SORTIE_VIEWED';
  eventTime: number; // ms epoch — QUAND l'action a eu lieu (pas l'arrivée)
}
```

**Starter fourni** (`src/window.ts`) — squelette **incomplet**, à toi de le remplir. **Pas de gap-fill** : tu écris l'agrégateur entier.

```ts
// src/window.ts — STARTER (à compléter)
import { Kafka } from 'kafkajs';
import type { ActivityEvent } from './types';

const WINDOW_MS = 10 * 60_000;
const ALLOWED_LATENESS_MS = 5 * 60_000;
const WATERMARK_DELAY_MS = 2 * 60_000;

// TODO: état par (sortieId, windowStart) : count + eventIds vus (dédup) + emitted
// TODO: onEvent(e) — event-time bucketing, dédup, drop/side-output si trop tardif
// TODO: advanceWatermark() — watermark = max(eventTime) - délai ; émettre les fenêtres complètes
// TODO: consumer kafkajs (groupId), subscribe tribuzen.activity, fromBeginning: true

async function main() {
  throw new Error('à implémenter');
}
main();
```

---

## Énoncé

### Partie A — Le log partitionné (observer avant de coder)

1. Produis le flux (`pnpm run produce`), puis dans la **Console** (`localhost:8080`) ou en CLI, **observe** la répartition des messages sur les 3 partitions.
   ```bash
   docker exec -it redpanda-0 rpk topic describe tribuzen.activity
   docker exec -it redpanda-0 rpk topic consume tribuzen.activity -o start -n 5 -f '%p %k %v\n'
   ```
2. **Réponds (grille A) :** pourquoi tous les événements d'une même `familyId` atterrissent-ils dans la **même** partition ? Qu'est-ce que ça garantit sur leur **ordre** ? Que se passerait-il pour l'ordre si tu partitionnais par `eventId` à la place ?

### Partie B — Agrégateur event-time avec fenêtres tumbling

1. Complète `onEvent` : bucketise sur `eventTime` (fenêtre tumbling 10 min = `floor(eventTime / WINDOW_MS) * WINDOW_MS`), et incrémente le compteur du couple `(sortieId, windowStart)` **uniquement** pour les `RSVP`.
2. Complète `advanceWatermark` : `watermark = max(eventTime observé) − WATERMARK_DELAY_MS` ; à chaque avance, **émets** (log + éventuelle notif au seuil 12) les fenêtres dont la fin `≤ watermark` et pas encore émises.
3. Branche le consumer `kafkajs` (un `groupId`, `subscribe`, `fromBeginning: true`) : pour chaque message, `onEvent` **puis** `advanceWatermark`.

### Partie C — Late events : watermark + allowed lateness + side-output

1. Le jeu de données contient un RSVP **en retard mais dans la marge** : montre qu'il **met à jour** (ré-émet) le compteur de sa fenêtre déjà émise (marque `(MàJ tardive)`).
2. Le RSVP **très en retard** (au-delà de `fin + ALLOWED_LATENESS`) : montre qu'il **n'est pas** compté dans la fenêtre scellée mais **routé vers un side-output** (`sideOutputLate(e)` → log/topic `tribuzen.activity.late`), jamais perdu silencieusement.
3. **Expérimente l'arbitrage :** passe `WATERMARK_DELAY_MS` à `0`, relance → observe des fenêtres émises **trop tôt** qui **droppent** des retardataires valides. Remets une valeur saine. **Réponds (grille C) :** latence vs exhaustivité, comment tu choisis le délai.

### Partie D — Exactly-once (effectively-once) par dédup

1. Le jeu contient un RSVP **dupliqué** (même `eventId`). Sans dédup, montre le **double comptage** (13 pour 12 réels).
2. Ajoute le `Set<eventId>` dans l'état de fenêtre : un `eventId` déjà vu n'est **pas** recompté. Re-teste : compteur juste malgré le doublon.
3. **Réponds (grille D) :** pourquoi la dédup applicative suffit ici alors qu'on ne configure ni producteur idempotent ni transaction ? Dans quel cas faudrait-il une **transaction read-process-write** à la place ?

### Partie E — Perte d'état au restart (constater le manque)

1. Laisse l'agrégateur consommer la moitié du flux, **tue-le** (`Ctrl-C`), relance-le **sans** `fromBeginning` (donc depuis l'offset committé). Montre que les **compteurs en mémoire sont repartis de zéro** alors que les offsets, eux, ont avancé → **résultats faux**.
2. **Réponds (grille E) :** cite les **deux** parades vues au module (replay depuis l'offset 0 pour recalculer ; état adossé à un **changelog** + **checkpoint** de l'état **avec** les offsets). Tu n'as **pas** à implémenter le checkpoint — juste à savoir pourquoi il est nécessaire et ce qu'il capture.

---

## Grille d'évaluation (le coach coche)

- [ ] **A** — Explique clé de partition → même `familyId` = même partition = ordre garanti ; comprend que partitionner par `eventId` **casse** l'ordre par famille.
- [ ] **B1** — Fenêtrage sur `eventTime` (pas `Date.now()`), tumbling 10 min correct, comptage `RSVP` seulement.
- [ ] **B2** — `watermark = max(eventTime) − délai` ; émission des fenêtres dont `fin ≤ watermark`, une seule fois.
- [ ] **C1** — Late event dans la marge → **ré-émission** du résultat corrigé (allowed lateness).
- [ ] **C2** — Late event hors marge → **side-output**, jamais compté dans une fenêtre scellée ni perdu.
- [ ] **C3** — Sait expliquer l'arbitrage watermark agressif (drop) vs conservateur (latence) après l'avoir **observé** (`delay=0`).
- [ ] **D** — Doublon reproduit **puis** corrigé par dédup `eventId` (effectively-once) ; sait quand une transaction serait requise.
- [ ] **E** — Constate la perte d'état au restart ; cite replay et checkpoint(état + offsets) comme parades.
- [ ] **Transverse** — Topic à 3 partitions ; comprend que le parallélisme est plafonné par le nombre de partitions, pas par le nombre de consumers.

**Pièges guettés par le coach :** fenêtrer sur l'heure d'arrivée ; croire à un ordre global sur le topic ; ajouter des consumers en pensant scaler au-delà des partitions ; perdre les late events au lieu de les side-outputer ; prendre le watermark pour une garantie dure ; croire que la dédup en mémoire survit au restart.

---

## Coaching (relances si tu bloques)

- **« Par où je commence ? »** → Partie A **sans coder** : décris la partition et l'ordre. Tant que tu n'as pas compris pourquoi `familyId` fixe la partition, l'agrégateur n'a pas de sens.
- **« Mes compteurs sont dans la mauvaise tranche. »** → Tu bucketises sûrement sur `Date.now()` (processing time). Regarde `eventTime` : c'est l'heure de l'**action**, embarquée dans l'événement. Fenêtre sur **ça**.
- **« Ma fenêtre ne se ferme jamais / se ferme tout de suite. »** → Ton watermark ne bouge pas (ou saute) : il doit être `max(eventTime observé) − délai`, mis à jour **à chaque** événement. Émets quand `fin_fenêtre ≤ watermark`.
- **« Le retardataire disparaît. »** → Sans allowed lateness il tombe hors de toute fenêtre ouverte. Garde la fenêtre corrigeable jusqu'à `fin + ALLOWED_LATENESS` ; au-delà → side-output, pas `drop` muet.
- **« Je ne vois pas de doublon. »** → Vérifie que le jeu contient bien le RSVP dupliqué (même `eventId`) et que tu comptes **avant** la dédup pour le voir, puis ajoute le `Set`.
- **« Après restart, mes chiffres sont absurdes. »** → C'est **le** point de la Partie E : l'offset a avancé (committé) mais l'état en mémoire est reparti à zéro. Ne le « corrige » pas en code — explique **pourquoi** il faut un checkpoint qui lie état **et** offsets.

---

## Variante J+30 (fading)

Reprends l'agrégateur **de mémoire, en 45 minutes**, avec **une contrainte ajoutée** :

- Remplace la fenêtre **tumbling** par une fenêtre **session** (gap d'inactivité **15 min**) **par `familyId`** : mesure une « rafale de planification » (une session = suite d'événements séparés de moins de 15 min ; un trou plus long ouvre une nouvelle session). Émets `(familyId, début, fin, nbÉvénements)` quand le watermark dépasse `fin_session + gap`.
- **Bonus concurrence :** lance **deux** instances de l'agrégateur avec le **même** `groupId` et observe le **rebalance** — chaque partition n'est traitée que par **une** instance. Puis lance une **3ᵉ** instance sur un topic à 2 partitions et montre qu'elle **reste inactive** (plafond de parallélisme).

**Critère de réussite :** les sessions sont correctement délimitées par le gap (pas par une horloge fixe) ; le rebalance répartit les partitions sans double-traitement ; l'instance excédentaire est bien inactive.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, le pipeline de streaming vit côté backend :

```
tribuzen/
  services/
    streaming/
      producers/activity.ts      ← publie tribuzen.activity (eventId + eventTime, clé familyId)
      windower/
        window.ts                ← agrégateur event-time (tumbling "sortie qui décolle")
        session.ts               ← fenêtre session (rafale de planification)
        state.ts                 ← état + changelog (checkpoint avec offsets)
```

**Différences par rapport au lab :**

- L'état des fenêtres sera **checkpointé** (topic changelog compacté + offsets) pour survivre au crash/rebalance — dans le lab, l'état vit en mémoire et on **constate** le manque (Partie E).
- Le producteur sera configuré **idempotent**, et le pipeline « trending » (lecture → agrégat → réécriture `tribuzen.trending`) utilisera une **transaction read-process-write** pour l'exactly-once de bout en bout — dans le lab, on se contente de la dédup applicative par `eventId`.
- Le broker de prod (Redpanda managé ou Kafka) aura un **replication factor ≥ 3** ; le lab tourne en mono-broker (`--mode dev-container`).

**Commit cible :**

```
feat(streaming): windower "sortie qui décolle" — tumbling event-time + watermark + dédup eventId
```
