---
titre: Projet final — TribuZen en système distribué résilient de bout en bout
cours: 17-distributed-systems
notions:
  - "assemblage des 22 modules en un seul système"
  - "découpage en services (Sorties, Réservation, Budget, Notifications, Feed)"
  - "communication synchrone (REST/gRPC, deadlines) vs asynchrone (broker, événements)"
  - "saga orchestrée createSortie (compensatable / pivot / retriable)"
  - "outbox pattern pour le dual-write fiable"
  - "cohérence choisie par domaine (CAP/PACELC : CP pour le budget, AP pour le feed)"
  - "résilience empilée : retries+jitter, timeout budget, circuit breaker, bulkhead, rate limiting"
  - "observabilité distribuée : traceId propagé, corrélation trace→logs"
  - "test distribué : contract testing + fault injection + test de partition"
  - "budget de latence de bout en bout"
  - "idempotence à chaque frontière at-least-once"
  - "production readiness d'un système distribué"
outcomes:
  - "sait concevoir un découpage en services TribuZen avec une frontière de cohérence explicite par domaine"
  - "sait câbler communication synchrone et asynchrone au bon endroit et justifier chaque choix"
  - "sait implémenter une saga orchestrée avec outbox, semantic lock et idempotence de bout en bout"
  - "sait empiler les garde-fous de résilience (retry+jitter, timeout, circuit breaker, bulkhead, rate limit) sans les confondre"
  - "sait tracer une requête à travers les services et provoquer une panne/partition pour prouver la résilience"
  - "sait dérouler une checklist de production readiness sur un système distribué"
prerequis: ["ensemble des modules 00 à 21 du cours 17-distributed-systems"]
next: fin-parcours-17-distributed-systems
libs: []
tribuzen: "TribuZen entier en système distribué — API Gateway/BFF, services Sorties/Réservation/Budget/Notifications/Feed, saga createSortie + outbox, cohérence choisie par domaine, résilience empilée, traçage distribué, testé"
last-reviewed: 2026-07
---

# Projet final — TribuZen en système distribué résilient de bout en bout

> **Outcomes — tu sauras FAIRE :** concevoir le découpage en services avec une frontière de cohérence explicite par domaine, câbler sync et async au bon endroit, implémenter une saga orchestrée avec outbox + semantic lock + idempotence, empiler les garde-fous de résilience sans les confondre, tracer une requête de bout en bout et provoquer une panne/partition pour prouver la résilience, dérouler une checklist de production readiness.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le **capstone** du cours. Il **n'introduit aucune notion neuve** — il **assemble** ce que les modules 00 à 21 ont posé brique par brique. Si un mécanisme ci-dessous te semble flou (saga, outbox, quorum, circuit breaker, backpressure, vector clock, CRDT, budget d'error), c'est le signal de **rouvrir le module source avant** de concevoir, pas de deviner. La **décision d'architecture** de haut niveau (« faut-il vraiment distribuer, quel style d'archi ? ») relève du **cours 13-architecture** ; ici on est au niveau **système et implémentation** : mécanismes, garanties, résilience, test.

## 1. Cas concret d'abord

TribuZen a grossi. Le monolithe NestJS + PostgreSQL du module 00 a été découpé (module 02) en **cinq services**, chacun avec **sa** base :

- **Sorties** — les sorties familiales (créer, annuler, lister).
- **Réservation** — les places d'une sortie payante (poser, confirmer, libérer).
- **Budget** — le budget commun de la famille (débiter, recréditer, consulter).
- **Notifications** — prévenir les parents (email, push).
- **Feed** — le fil d'activité de la famille (agrégé, en lecture).

Un **API Gateway / BFF** (module 07) reçoit le trafic mobile, applique auth + rate limiting, corrèle un `traceId` et route vers les services. Un **broker** (module 05) transporte les événements entre services.

Le geste central de l'app — **un parent crée une sortie payante à places limitées** (« Accrobranche samedi, 12 places, 8 €/enfant ») — n'est **pas** local : il traverse **Sorties + Réservation + Budget + Notifications**, quatre bases sans `BEGIN … COMMIT` commun (module 11). Et le vendredi soir, quand tout le monde organise son week-end en même temps, ce système doit tenir : le service Notifications peut être lent, le broker peut redélivrer un message, deux parents peuvent débiter le même budget en parallèle, une instance peut tomber.

Ce module te fait **concevoir et implémenter ce système entier**, de bout en bout, en réutilisant **chaque** brique du cours :

- **découper** proprement et choisir, **par domaine**, une frontière de cohérence (le budget ne tolère pas un double débit → plutôt **CP** ; le feed tolère 2 s de retard → **AP éventuel**, modules 09-10) ;
- **câbler** la communication : synchrone là où l'utilisateur attend une réponse (module 04), asynchrone/événementielle pour découpler (modules 05-06) ;
- **garantir** la cohérence multi-services : **saga orchestrée** `createSortie` (module 11) + **outbox** pour publier `SortieCréée` de façon fiable (module 13) + **idempotence** à chaque frontière at-least-once (module 08) ;
- **survivre aux pannes** : retries+jitter et timeout budget (module 08), **circuit breaker** + bulkhead sur les appels sortants (module 14), **rate limiting** et backpressure à la gateway (module 15) ;
- **voir** ce qui se passe : `traceId` propagé partout, corrélation trace → logs (module 16) ;
- **prouver** que ça tient : contract testing + fault injection + un test de **partition** (module 17).

Rien de neuf. Tout a été vu, isolément. Le capstone est l'épreuve où ces briques doivent **fonctionner ensemble** — et c'est là que les erreurs d'**assemblage** (celles du §4) apparaissent.

---

## 2. Théorie complète, concise

Aucune notion nouvelle : une **carte de montage**. Elle relie chaque module à sa place dans le système TribuZen, et surtout aux **jointures** qui font qu'un ensemble de services devient un système *résilient et cohérent*.

### 2.1 La carte de montage — chaque module à sa place

| Couche du système | Mécanisme | Module | Rôle dans TribuZen |
|---|---|---|---|
| Fondations | fallacies, partial failure | 00-01 | le réseau n'est ni fiable ni instantané : tout appel peut échouer/traîner |
| Découpage | database-per-service | 02 | 5 services, 5 bases, aucune connexion partagée |
| Contrats | schéma + versioning | 03 | contrat `SortieCréée v1`, compatibilité ascendante |
| Sync | REST/gRPC + deadline | 04 | Gateway → Réservation (l'UI attend « places dispo ? ») |
| Async | broker, garanties de livraison | 05 | commandes de saga, événements, DLQ |
| Événements | pub/sub, découplage | 06 | `SortieCréée` → Feed + Notifications réagissent |
| Bordure | API Gateway / BFF | 07 | auth, agrégation, cross-cutting, traceId |
| Fiabilité d'appel | retry+jitter, timeout, idempotency key | 08 | tout appel sortant est borné et rejouable sans doublon |
| Cohérence | CAP / PACELC, modèles | 09 | **choix par domaine** (budget CP / feed AP) |
| Données | réplication, sharding, quorum | 10 | Budget répliqué (quorum), Feed shardé par famille |
| Transaction | **saga** orchestrée + compensation | 11 | `createSortie` : 4 étapes compensatable/pivot/retriable |
| Écriture/lecture | CQRS / event sourcing | 12 | Feed = read model projeté depuis les événements |
| Dual-write | **outbox** + CDC | 13 | publier `SortieCréée` de façon fiable depuis la transaction DB |
| Résilience | circuit breaker, bulkhead, timeout budget | 14 | isoler un service lent, éviter la cascade |
| Débit | rate limiting, backpressure, load shedding | 15 | protéger la gateway du pic du vendredi soir |
| Observabilité | traçage distribué, corrélation | 16 | une trace par requête, logs corrélés par traceId |
| Test | contract testing, fault injection, partition | 17 | prouver que la résilience marche vraiment |
| Coordination | leader election, Raft, quorum | 18 | une **seule** instance de l'orchestrateur de saga active |
| Ordre | horloges logiques, vector clocks | 19 | ordonner causalement les événements du Feed |
| Streaming | event streaming, windowing | 20 | analytics « sorties/heure » sans bloquer le chemin critique |
| Conflits | CRDTs, LWW, merge | 21 | compteur de vues du Feed sans coordination |

Le capstone **n'ajoute rien** à cette table : il la **branche**. Un flou dans une ligne = rouvrir le module, pas improviser.

### 2.2 La première décision structurante : la frontière de cohérence, **par domaine**

L'erreur de débutant est de choisir **une** cohérence pour tout le système. En réalité, **chaque domaine** a son point sur le spectre CAP/PACELC (module 09) :

| Domaine TribuZen | Choix | Pourquoi | Prix accepté |
|---|---|---|---|
| **Budget** (argent) | **CP** — cohérence forte | un double débit est inacceptable | indisponibilité brève sous partition |
| **Réservation** (places) | **CP** — via saga + semantic lock | survendre 12 places coûte cher | fenêtre `PENDING` visible |
| **Feed** (fil d'activité) | **AP** — cohérence éventuelle | un post à 2 s de retard est OK | lecture parfois stale |
| **Compteur de vues** | **AP** — CRDT | la précision exacte n'importe pas | convergence différée |

C'est **la** leçon d'assemblage : on ne demande pas « ce système est-il CP ou AP ? » mais « **quelle frontière de cohérence pour CE domaine ?** ». Le budget et le feed vivent dans le **même** produit avec des garanties **opposées**. Le module 09 donne le cadre (PACELC : même **hors** partition, on arbitre latence vs cohérence) ; ici on **place** chaque domaine.

### 2.3 Câbler sync et async : deux modèles, un critère

- **Synchrone** (REST/gRPC, module 04) — l'appelant **attend** la réponse, avec une **deadline**. Pour TribuZen : la Gateway demande à Réservation « reste-t-il des places ? » car l'utilisateur regarde l'écran. Couplage temporel fort : les deux doivent être up **en même temps**.
- **Asynchrone / événementiel** (broker + pub/sub, modules 05-06) — l'appelant **n'attend pas**. Pour TribuZen : `SortieCréée` est **publié** ; Feed et Notifications réagissent **à leur rythme**. Découplage, mais **cohérence éventuelle** et livraison **at-least-once** (donc idempotence obligatoire).

Le critère : **l'utilisateur attend-il ce résultat maintenant ?** Oui → sync avec timeout. Non → async, fire-and-forget avec garantie de livraison. Confondre les deux (attendre synchroniquement une notification email) recouple tout et fait retomber la latence du chemin critique sur le service le plus lent.

### 2.4 Le cœur transactionnel : saga + outbox + idempotence, ensemble

`createSortie` est le nœud où **trois** modules se rejoignent, et ils ne valent **que** combinés :

1. **Saga orchestrée** (module 11) — séquence de transactions locales, structure **compensatable → pivot → retriable**. Pour TribuZen : créer sortie (`PENDING`, compensatable) → réserver places (`RESERVE_PENDING`, compensatable, **semantic lock**) → **débiter budget (pivot)** → confirmer + notifier (retriable, retry-forward). Échec avant le pivot → compensation en ordre inverse ; après → on retente.
2. **Outbox** (module 13) — chaque étape qui doit **publier un événement** (`SortieCréée`, `PlacesRéservées`) l'écrit dans une **table outbox dans la même transaction locale** que la donnée métier, puis un poller le publie sur le broker. Sans outbox, le **dual-write** casse : la DB commite mais le broker rate → événement perdu, ou l'inverse.
3. **Idempotence** (module 08) — le broker est **at-least-once** : chaque commande, chaque événement, chaque compensation **peut être rejoué**. Toute étape pose un **état** (`libéré`, `CONFIRMED`), n'incrémente jamais un compteur, et dédup par `sagaId`+étape.

Le triangle : la saga **décide** quoi faire, l'outbox **publie fiablement** ce qui doit l'être, l'idempotence **absorbe** les rejeux. Retirer un côté = le système fuit (états orphelins, événements perdus, doubles débits).

### 2.5 La résilience s'**empile** — cinq garde-fous, cinq rôles distincts

La faute d'assemblage la plus fréquente est de **confondre** les patterns de résilience. Ils ne se remplacent pas, ils se **superposent**, chacun contre une panne différente :

| Garde-fou | Contre quoi | Où dans TribuZen | Module |
|---|---|---|---|
| **Timeout** | un appel qui ne revient jamais | chaque appel sortant Gateway→service | 08 |
| **Retry + backoff + jitter** | erreur **transitoire** (503, blip réseau) | appels idempotents uniquement | 08 |
| **Idempotency key** | un retry qui **duplique** (paiement) | débit budget, confirmation | 08 |
| **Circuit breaker** | un service **durablement** en panne | Gateway→Notifications, →Budget | 14 |
| **Bulkhead** | un service lent qui **épuise** le pool | pool de connexions isolé par dépendance | 14 |
| **Rate limiting** | un **pic** ou un abus | entrée de la Gateway (token bucket) | 15 |
| **Backpressure / load shedding** | la file qui **grandit sans fin** | consumer broker, gateway saturée | 15 |

Le **timeout budget** (module 14) est la jointure : la Gateway a, disons, 800 ms pour répondre ; elle **répartit** ce budget entre ses appels (Réservation 300, Budget 300, marge 200). Un appel qui dépasse sa part est coupé **avant** de faire exploser le budget global. Retry **sans** timeout = attente infinie ; circuit breaker **sans** fallback = erreur brute ; rate limit **sans** backpressure = file qui gonfle en mémoire. Chacun couvre un trou que les autres laissent.

### 2.6 La couture d'observabilité : le `traceId` propagé

Un système distribué sans traçage est un **debug à l'aveugle**. La couture (module 16) : la Gateway génère un `traceId` (W3C `traceparent`), le **propage** dans chaque appel sync (header) et chaque message async (attribut), et **chaque log** de **chaque** service le porte (`logger.child({ traceId })`). Résultat : une requête `createSortie` lente se debug en suivant **une** trace à travers 4 services, puis en filtrant les logs sur son `traceId`. Sans propagation, tu as 5 tas de logs isolés et aucune vue du parcours (deep dashboards/SLO → cours 16, ici = la **corrélation** qui rend le système lisible).

### 2.7 La coordination cachée : une seule instance active

Si tu déploies **deux** instances du service qui héberge l'orchestrateur de saga, **les deux** peuvent piloter la même `createSortie` → double débit. La parade (module 18) : **leader election** (Raft/etcd/ZooKeeper, ou un lock distribué) pour qu'**une seule** instance soit active à la fois, les autres en veille prêtes à reprendre. C'est le rappel que « scaler horizontalement » un composant **stateful/coordinateur** demande un **consensus**, pas un simple `replicas: 2`.

### 2.8 Prouver la résilience : le test **est** une exigence, pas un bonus

Un système « résilient » non testé est un système **supposé** résilient (module 17). Trois niveaux, tous requis au capstone :

- **Contract testing** — Sorties publie `SortieCréée v1` ; Feed le consomme. Un test de contrat (consumer-driven) casse **au CI** si l'un dévie du schéma (module 03). Empêche « j'ai changé le champ, l'autre service ne le sait pas ».
- **Fault injection** — on **injecte** une panne (Notifications renvoie 500, le broker ralentit) et on **vérifie** que le circuit breaker ouvre, que le fallback répond, que le budget de latence tient. Toxiproxy/middleware de chaos.
- **Test de partition** — on **coupe** le réseau entre deux services et on **vérifie** le comportement **choisi** : le domaine CP (budget) **refuse** proprement, le domaine AP (feed) **répond stale**. C'est la seule preuve que ton choix CAP §2.2 est réel et pas décoratif.

### 2.9 Production readiness d'un système distribué — la checklist de sortie

Avant de dire « TribuZen distribué est prêt », on **coche** (rappel du cours) :

- chaque service : health checks (`/live`, `/ready`), timeouts, graceful shutdown ;
- chaque frontière async : idempotence + DLQ + monitoring de la DLQ (module 05) ;
- chaque appel sortant : timeout + retry borné + circuit breaker (modules 08, 14) ;
- la Gateway : rate limit + backpressure (module 15) ;
- cohérence : frontière **documentée par domaine** + test de partition qui la prouve (modules 09, 17) ;
- observabilité : `traceId` propagé, une trace complète par requête (module 16) ;
- l'orchestrateur : état de saga **persisté** (reprend après crash) + leader unique (module 18) ;
- contrats versionnés + tests de contrat au CI (modules 03, 17).

---

## 3. Worked examples

Deux exemples end-to-end. Le premier **conçoit** le système et le câble. Le second **provoque une panne et une partition** et prouve que les choix tiennent.

### Exemple 1 — concevoir et câbler `createSortie` de bout en bout

Objectif : partir du geste métier du §1 et produire l'**architecture cible** — services, frontières de cohérence, sync/async, saga+outbox+idempotence, résilience — puis en écrire le squelette d'orchestration.

**Étape 1 — placer chaque domaine sur le spectre de cohérence** (§2.2).

```
Budget       → CP  (double débit interdit)      : saga + update commutatif + idempotence
Réservation  → CP  (survente interdite)         : semantic lock RESERVE_PENDING
Sorties      → CP  (source de vérité de l'objet): saga, statut PENDING→CONFIRMED/CANCELLED
Feed         → AP  (2s de retard tolérées)      : read model projeté depuis événements
Notifications→ async, at-least-once             : retriable, jamais dans le chemin sync
```

**Étape 2 — câbler sync vs async** (§2.3). Chemin critique (l'utilisateur attend) = **sync avec deadline** ; le reste = **événements**.

```
Mobile ──POST /sorties──▶ API Gateway (auth, rate limit, traceId)
   Gateway ──gRPC (deadline 300ms)──▶ Réservation.checkDisponibilité   [SYNC : l'UI attend]
   Gateway ──lance la saga createSortie──▶ Orchestrateur                [SYNC : renvoie l'id]
Orchestrateur (saga) : Sorties → Réservation → Budget(pivot) → confirmer
   chaque étape écrit son événement en OUTBOX (même tx locale)
Outbox poller ──publie──▶ broker
   broker ──SortieCréée──▶ Feed.project     [ASYNC : cohérence éventuelle, AP]
   broker ──SortieCréée──▶ Notifications    [ASYNC : at-least-once, idempotent]
```

**Étape 3 — la saga, avec outbox et idempotence** (§2.4). L'orchestrateur du module 11, enrichi : chaque `execute` écrit **aussi** son événement dans l'outbox **dans la même transaction locale**, et chaque étape est **idempotente**.

```ts
// createSortie.saga.ts — orchestration + outbox + idempotence (assemble modules 08, 11, 13)
const steps: SagaStep[] = [
  {
    name: 'creerSortie',                       // compensatable
    execute: async (ctx) => {
      await sortiesRepo.tx(async (t) => {      // UNE transaction locale…
        const s = await sortiesRepo.create(t, { ...ctx.data, statut: 'PENDING' });
        ctx.data.sortieId = s.id;
        await outbox.add(t, 'SortieCréée', { sortieId: s.id, familyId: ctx.data.familyId });
      });                                       // …DB + outbox commitées ensemble (pas de dual-write)
    },
    compensate: async (ctx) =>
      sortiesRepo.markCancelled(ctx.data.sortieId as string),   // idempotent : pose un état
  },
  {
    name: 'reserverPlaces',                    // compensatable, SEMANTIC LOCK
    execute: async (ctx) =>
      reservationRepo.hold({                   // RESERVE_PENDING : l'UI NE compte PAS ces places
        sortieId: ctx.data.sortieId as string, places: 4,
        idempotencyKey: `${ctx.sagaId}:reserve`,             // dédup si rejeu (at-least-once)
      }),
    compensate: async (ctx) =>
      reservationRepo.release(ctx.data.sortieId as string),   // idempotent : LIBRE, pas -4
  },
  {
    name: 'debiterBudget',                     // ← PIVOT (argent engagé, CP)
    execute: async (ctx) =>
      budgetRepo.debit({                       // update COMMUTATIF (relatif), pas SET solde=X
        familyId: ctx.data.familyId as string, amount: 32,
        idempotencyKey: `${ctx.sagaId}:debit`,               // pas de double débit sur rejeu
      }),
    compensate: async (ctx) =>
      budgetRepo.credit({ familyId: ctx.data.familyId as string, amount: 32,
        idempotencyKey: `${ctx.sagaId}:credit` }),
  },
  {
    name: 'confirmerEtNotifier',               // ← RETRIABLE (après pivot : on retente)
    execute: async (ctx) => {
      await reservationRepo.confirm(ctx.data.sortieId as string);   // PENDING → CONFIRMED
      await sortiesRepo.markConfirmed(ctx.data.sortieId as string);
      // notification : événement async idempotent, JAMAIS un appel sync bloquant
      await outbox.add(null, 'SortieConfirmée', { sortieId: ctx.data.sortieId });
    },
    // pas de compensate : retry-forward via la queue
  },
];
```

**Étape 4 — empiler la résilience sur les appels de la Gateway** (§2.5). Le `checkDisponibilité` sync est enveloppé : timeout **dans** le budget, retry (idempotent), circuit breaker, fallback.

```ts
// gateway/reservationClient.ts — résilience empilée (modules 08 + 14)
const breaker = new CircuitBreaker({ failureThreshold: 5, recoveryTimeoutMs: 10_000, halfOpenMaxAttempts: 2 });

async function checkDisponibilite(sortieId: string, traceId: string): Promise<Dispo> {
  return breaker.execute(() =>                              // 4) circuit breaker : coupe si Réservation est down
    retryWithJitter(                                        // 2) retry (appel idempotent : lecture)
      () => reservationRpc.check(sortieId, {
        deadlineMs: 300,                                    // 1) timeout, part du budget global (800ms)
        metadata: { traceparent: traceId },                //    propage le traceId (module 16)
      }),
      { retries: 2, baseMs: 50 },
    ),
  ).catch(() => ({ dispo: 'unknown', degraded: true }));    // fallback : dégradation gracieuse, pas de crash
}
```

**Ce que ce design achète :** plus de sortie « fantôme » (saga + compensation) ; pas d'événement perdu (outbox) ; pas de double débit ni de double notification (idempotence) ; la lenteur de Notifications **ne touche pas** le chemin critique (async) ; un Réservation en panne ne fait pas tomber la Gateway (circuit breaker + fallback) ; et chaque requête est **traçable** de bout en bout. **Reste assumé :** une fenêtre de cohérence éventuelle sur le Feed (AP), et le budget de latence à respecter sous le pic (§2.5).

### Exemple 2 — provoquer une panne, puis une partition, et prouver le comportement choisi

On ne **déclare** pas la résilience, on la **prouve** (module 17). Deux scénarios.

**a) Panne d'un service non-critique (Notifications down).** On injecte : Notifications renvoie 500. Attendu, et **observé** :

```
1. createSortie s'exécute normalement (saga OK, budget débité, sortie CONFIRMED)
2. l'événement SortieConfirmée part en outbox → broker → Notifications
3. Notifications échoue (500) → le message est REDÉLIVRÉ (at-least-once)
4. après N échecs → DLQ (module 05), alerte sur la DLQ
5. la RÉPONSE utilisateur est déjà partie : la sortie est créée, la notif suivra
   → dégradation gracieuse : le cœur métier n'est PAS bloqué par un service périphérique
```

La preuve : la sortie est bien créée **malgré** Notifications HS, parce que la notif est **async et retriable**, pas dans le chemin sync. Si tu l'avais câblée en sync (piège §4), l'utilisateur aurait vu une erreur pour un email en retard.

**b) Partition réseau entre la Gateway et le Budget.** On **coupe** le lien (Toxiproxy). Le budget est **CP** (§2.2). Attendu, et **observé** :

```
1. createSortie atteint le pivot debiterBudget → appel Budget → TIMEOUT (partition)
2. retry (2×) → toujours timeout → circuit breaker vers Budget passe OPEN
3. la saga ÉCHOUE au pivot → compensation en ordre inverse :
     release places (RESERVE_PENDING → LIBRE), markCancelled la sortie
4. l'utilisateur reçoit : « création impossible, réessaie » (refus PROPRE)
5. AUCUN état orphelin dans les bases ; AUCUN double débit
```

Comparaison qui prouve le choix CAP : le **Feed** (AP), pendant la **même** partition, **continue** de répondre — avec des données potentiellement stale (« sortie pas encore visible »). **Même partition, deux comportements opposés, tous deux choisis :** budget refuse (préserve la cohérence), feed répond (préserve la disponibilité). C'est exactement le §2.2 rendu **vérifiable**. Un système où la partition produit un double débit **ou** un feed HS n'a pas *choisi* sa cohérence — il l'a subie.

---

## 4. Pièges & misconceptions

Ces pièges n'apparaissent **qu'à l'assemblage** — chaque brique marchait seule.

### PIÈGE #1 — choisir **une** cohérence pour tout le système

« TribuZen sera fortement cohérent » (ou « éventuellement cohérent »). Faux découpage : le **budget** exige CP, le **feed** vit très bien en AP. Forcer CP partout tue la disponibilité du feed sous partition ; forcer AP partout autorise un double débit. La bonne granularité est **le domaine** (§2.2), et chaque frontière doit être **prouvée** par un test de partition (§2.8).

### PIÈGE #2 — mettre la notification (ou tout périphérique) dans le chemin **synchrone**

```ts
// ❌ l'utilisateur attend l'envoi de l'email pour recevoir sa réponse
await notificationsRpc.sendConfirmation(sortieId);   // couple la latence du chemin critique
return res.json({ ok: true });                       // à celle du service le plus lent/fragile

// ✅ publier un événement ; Notifications réagit à son rythme (async, at-least-once, idempotent)
await outbox.add(null, 'SortieConfirmée', { sortieId });
return res.json({ ok: true });                       // la notif suivra, HS de Notifications ≠ échec métier
```

Le critère (§2.3) : l'utilisateur attend-il **ce** résultat maintenant ? Un email, non.

### PIÈGE #3 — le dual-write sans outbox

Écrire la DB **puis** publier sur le broker en deux étapes séparées : si le process meurt entre les deux, ou si le broker rate, tu as une sortie **sans** événement (Feed jamais à jour) ou un événement **sans** sortie. La seule parade fiable est l'**outbox** (module 13) : DB **et** ligne outbox dans **la même transaction locale**, un poller publie ensuite. « Je publierai juste après le commit » est la définition même du bug de dual-write.

### PIÈGE #4 — confondre les patterns de résilience (les empiler « au hasard »)

Retry **sans** timeout = un appel bloqué se retente sur une attente infinie. Circuit breaker **sans** fallback = tu transformes une lenteur en erreur brute côté client. Rate limit **sans** backpressure = la file interne gonfle en mémoire jusqu'au crash. Retry sur un appel **non-idempotent** (débit) = double débit. Chaque garde-fou couvre **un** trou précis (§2.5) ; les empiler exige de savoir **lequel contre quoi**, pas d'en coller trois par réflexe.

### PIÈGE #5 — oublier l'idempotence à **une** frontière at-least-once

Il suffit d'**une** étape non-idempotente pour casser tout le système sous rejeu. Le broker **redélivre** (module 05) : si `debiterBudget` débite à chaque livraison au lieu de dédupliquer par `idempotencyKey`, une seule double-livraison = budget faux. Règle : **chaque** consommateur, **chaque** compensation, **chaque** commande de saga pose un **état** (jamais un `+=`) et **dédup** par clé. « Ça marche en test » = il n'y a pas eu de rejeu en test.

### PIÈGE #6 — scaler l'orchestrateur en `replicas: 2` sans coordination

Deux instances actives de l'orchestrateur = deux sagas concurrentes sur la même commande = double effet. Un composant **coordinateur/stateful** ne se réplique pas comme un service stateless : il faut une **leader election** (module 18) pour n'avoir **qu'une** instance active, plus un **état de saga persisté** pour qu'une reprise après crash **continue** au lieu de recommencer. Répliquer sans consensus, c'est fabriquer la panne qu'on croyait éviter.

### PIÈGE #7 — traiter le test de résilience comme un bonus

« La résilience marche, je l'ai codée. » Non testée, elle est **supposée**. Le circuit breaker ne s'ouvre peut-être jamais (mauvais seuil) ; le fallback renvoie peut-être `undefined` ; la partition provoque peut-être un double débit. Seuls le **fault injection** et le **test de partition** (§2.8) prouvent le comportement. Au capstone, le test n'est pas la dernière case : c'est la **preuve** que les six pièges ci-dessus ont été évités.

### PIÈGE #8 — ne pas propager le `traceId` dans les messages **async**

On propage le `traceId` dans les headers HTTP sync et on oublie les **messages du broker**. Résultat : la trace s'**arrête** à la frontière async ; impossible de suivre `createSortie` jusqu'au Feed. Le `traceId` doit voyager **aussi** comme attribut de message (module 16). Une trace qui casse à chaque `publish` ne trace rien d'utile dans un système événementiel.

---

## 5. Ancrage TribuZen

Ce module **est** l'ancrage : TribuZen entier, en système distribué, tel qu'il vivrait dans `smaurier/tribuzen`. Emplacement cible dans le repo :

```
tribuzen/
  gateway/
    index.ts                 ← auth, rate limit (module 15), traceId (module 16), routing
    reservationClient.ts     ← timeout + retry + circuit breaker + fallback (modules 08, 14)
  services/
    sorties/                 ← DB propre ; statut PENDING→CONFIRMED/CANCELLED ; outbox
    reservation/             ← DB propre ; semantic lock RESERVE_PENDING (module 11)
    budget/                  ← DB propre ; débit commutatif + idempotency key (CP)
    notifications/           ← consumer at-least-once, idempotent, DLQ (module 05)
    feed/                    ← read model AP projeté depuis les événements (modules 12, 21)
  sagas/
    createSortie/
      orchestrator.ts        ← saga (module 11) + état persisté + leader unique (module 18)
      steps.ts               ← creer/reserver/debiter(pivot)/confirmer + outbox (module 13)
  shared/
    outbox.ts                ← table outbox + poller (module 13)
    tracing.ts               ← propagation W3C sync + async (module 16)
    contracts/               ← schémas versionnés + tests de contrat (modules 03, 17)
  test/
    partition.spec.ts        ← Toxiproxy : coupe budget → refus CP ; feed → répond AP (module 17)
    faultinjection.spec.ts   ← Notifications 500 → DLQ, cœur métier non bloqué
```

Grille récapitulative — chaque décision TribuZen, sa justification, son module :

| Décision TribuZen | Choix | Module |
|---|---|---|
| Budget vs Feed | **CP** vs **AP** (par domaine) | 09-10 |
| `checkDisponibilité` | **sync** gRPC + deadline (l'UI attend) | 04 |
| `SortieCréée` | **async** événement (découplage) | 05-06 |
| `createSortie` multi-services | **saga orchestrée** + pivot = débit | 11 |
| publier depuis la transaction | **outbox** (pas de dual-write) | 13 |
| chaque frontière at-least-once | **idempotence** (état + clé) | 08, 05 |
| appels sortants Gateway | timeout + retry + **circuit breaker** + fallback | 08, 14 |
| entrée Gateway | **rate limit** + backpressure | 15 |
| debug d'une requête | **traceId** propagé sync **et** async | 16 |
| orchestrateur répliqué | **leader election** + état persisté | 18 |
| preuve de la résilience | **fault injection** + **test de partition** | 17 |

Le lab associé te fait **monter et casser** ce système via un `docker-compose` fourni.

---

## 6. Points clés

1. Le capstone **assemble**, il n'ajoute rien : chaque brique vient d'un module 00-21 ; un flou = rouvrir le module source, pas deviner.
2. La frontière de cohérence se choisit **par domaine**, pas pour tout le système : Budget **CP**, Feed **AP**, dans le **même** produit.
3. Sync **avec deadline** quand l'utilisateur attend ; **async/événementiel** pour découpler — jamais un périphérique (notif) dans le chemin synchrone.
4. Le cœur transactionnel = **saga + outbox + idempotence** ensemble : décider / publier fiablement / absorber les rejeux. Retirer un côté fait fuir le système.
5. La résilience s'**empile** : timeout, retry+jitter, idempotency key, circuit breaker, bulkhead, rate limit, backpressure — chacun contre **une** panne distincte, coordonnés par le **timeout budget**.
6. Le `traceId` est la **couture** d'observabilité : propagé en sync **et** en async, il rend une requête traçable à travers tous les services.
7. Un orchestrateur/coordinateur ne se réplique pas comme un stateless : **leader election** + **état de saga persisté**, sinon double effet.
8. La résilience non **testée** est **supposée** : contract testing + fault injection + **test de partition** prouvent le comportement CAP choisi.
9. La production readiness d'un système distribué se **coche** : health checks, DLQ monitorée, garde-fous par appel, frontière de cohérence documentée et prouvée, traçage, contrats versionnés.

---

## 7. Seeds Anki

```
Dans un système distribué, à quelle granularité choisit-on la cohérence (CAP) ?|Par DOMAINE, pas pour tout le système. Dans TribuZen : Budget = CP (double débit interdit), Réservation = CP (survente interdite), Feed = AP (2s de retard OK), compteur de vues = AP/CRDT. Le même produit héberge des garanties opposées. Un test de partition doit PROUVER chaque frontière.
Quel critère décide entre communication synchrone et asynchrone ?|L'utilisateur attend-il CE résultat maintenant ? Oui → sync avec deadline/timeout (ex. checkDisponibilité, l'UI attend). Non → async/événementiel, at-least-once, idempotent (ex. SortieCréée → Feed, Notifications). Mettre un périphérique (email) en sync recouple la latence critique au service le plus lent.
Pourquoi saga, outbox et idempotence vont-ils ensemble et pas séparément ?|La saga DÉCIDE quoi faire (transactions locales + compensations, structure compensatable/pivot/retriable). L'outbox PUBLIE fiablement les événements (DB + ligne outbox dans la même transaction locale → pas de dual-write). L'idempotence ABSORBE les rejeux du broker at-least-once. Retirer un côté = états orphelins, événements perdus, ou doubles débits.
Qu'est-ce que le dual-write et comment l'outbox le corrige ?|Dual-write = écrire la DB puis publier sur le broker en deux étapes séparées : si le process meurt entre les deux (ou le broker rate), on a une donnée sans événement (ou l'inverse). L'outbox écrit la donnée métier ET l'événement dans la MÊME transaction locale, puis un poller publie depuis la table outbox. Atomicité restaurée.
Comment s'empilent les patterns de résilience, et quel est le rôle du timeout budget ?|Ils se superposent, chacun contre une panne distincte : timeout (appel infini), retry+jitter (erreur transitoire, idempotent only), idempotency key (retry qui duplique), circuit breaker (service durablement down), bulkhead (pool épuisé), rate limit (pic), backpressure (file qui gonfle). Le timeout budget répartit un budget global (ex. 800ms) entre les appels et coupe celui qui dépasse sa part.
Pourquoi ne peut-on pas scaler un orchestrateur de saga en replicas:2 ?|Deux instances actives piloteraient la même saga → double effet (double débit). Un composant coordinateur/stateful exige une LEADER ELECTION (Raft/etcd, module 18) pour n'avoir qu'une instance active, plus un ÉTAT DE SAGA PERSISTÉ pour qu'une reprise après crash continue au lieu de recommencer. Stateless se réplique librement, coordinateur non.
Comment prouve-t-on qu'un choix CAP (CP/AP) est réel et pas décoratif ?|Par un TEST DE PARTITION (module 17, ex. Toxiproxy) : on coupe le réseau et on vérifie le comportement CHOISI. Domaine CP (budget) : refuse proprement (la saga échoue au pivot, compense, aucun double débit). Domaine AP (feed) : répond stale. Même partition, deux comportements opposés, tous deux voulus. Sans ce test, la cohérence est subie, pas choisie.
Pourquoi faut-il propager le traceId dans les messages async aussi ?|Parce que sinon la trace s'ARRÊTE à la frontière événementielle : on trace createSortie en sync mais on perd le fil dès le publish vers le Feed/Notifications. Le traceId (W3C traceparent) doit voyager dans les headers HTTP (sync) ET comme attribut de message (async). C'est la couture qui rend une requête traçable à travers tous les services.
Cite trois lignes cochables d'une checklist de production readiness d'un système distribué.|(1) Chaque frontière async : idempotence + DLQ monitorée ; (2) chaque appel sortant : timeout + retry borné + circuit breaker + fallback ; (3) frontière de cohérence documentée par domaine ET prouvée par un test de partition. Plus : health checks + graceful shutdown, traceId propagé, orchestrateur à leader unique + état persisté, contrats versionnés testés au CI.
```

---

## Pour aller plus loin (références intégrées)

Une fois le système monté, ces ressources approfondissent chaque couche. Classées par ce qu'elles apportent **concrètement**.

**Le livre à lire si tu n'en lis qu'un :**
- **Designing Data-Intensive Applications** — Martin Kleppmann (O'Reilly, 2017 ; draft gratuit https://dataintensive.net/). LE texte de référence. Ch. 5 (Replication) → module 10, Ch. 7 (Transactions) → modules 11-12, Ch. 8 (Trouble with Distributed Systems) → modules 00-01, Ch. 9 (Consistency and Consensus) → modules 09, 18-19.

**Les guides pratiques :**
- **Microservices Patterns** — Chris Richardson (Manning, 2018 ; https://microservices.io/). Saga, CQRS, Event Sourcing, Transactional Outbox, API Gateway, Circuit Breaker : la source directe des modules 07, 11-14.
- **Building Microservices, 2e éd.** — Sam Newman (O'Reilly, 2021). Communication (ch. 4-5) → modules 04-06 ; Résilience (ch. 12) → modules 14-15.
- **Release It!, 2e éd.** — Michael Nygard (Pragmatic, 2018). La bible des patterns de résilience en production (circuit breaker, bulkhead, timeout) → module 14 ; études de cas de pannes réelles.
- **Enterprise Integration Patterns** — Hohpe & Woolf (Addison-Wesley, 2003 ; https://www.enterpriseintegrationpatterns.com/). Correlation Identifier, Idempotent Receiver, Dead Letter Channel → modules 05-08.

**Les papiers fondateurs (courts et lisibles) :**
- **Time, Clocks, and the Ordering of Events** — Lamport (1978, ~10 pages) → module 19. https://lamport.azurewebsites.net/pubs/time-clocks.pdf
- **In Search of an Understandable Consensus Algorithm (Raft)** — Ongaro & Ousterhout (2014) → module 18, avec la visualisation https://raft.github.io/
- **Dynamo: Amazon's Highly Available Key-value Store** — DeCandia et al. (2007) → modules 10, 21 (consistent hashing, quorums, vector clocks). https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf
- **Life beyond Distributed Transactions** — Pat Helland (2007) → le « pourquoi » derrière saga et outbox (modules 11, 13).

**À garder ouvert, et pour continuer :**
- **Jepsen** (https://jepsen.io/) — analyses rigoureuses de la cohérence des bases distribuées ; le meilleur antidote au « ma base est cohérente, je l'ai lu dans la doc ».
- **Marc Brooker's Blog** (https://brooker.co.za/blog/) et **Martin Kleppmann's lectures** (Cambridge, YouTube) — pour approfondir consensus, temps et cohérence.

---

## Pont vers le lab

> Lab associé : `labs/lab-22-projet-final/README.md`. **Capstone** : concevoir et implémenter le système TribuZen distribué de bout en bout via le `docker-compose` fourni (5 services + bases + broker + gateway) — découpage et frontière de cohérence par domaine, sync/async câblés, saga `createSortie` + outbox + idempotence, résilience empilée, `traceId` propagé, puis **provoquer une panne et une partition** pour prouver le comportement CP/AP choisi. Cahier des charges, jalons, grille exigeante, coach en session, variante J+30 (extension). Zéro harnais simulé.

---

> **Note :** ce module est le **dernier du parcours 17-distributed-systems**. Le `next` pointe vers `fin-parcours-17-distributed-systems` — tu as couvert l'intégralité du curriculum Systèmes distribués, de la première fallacy du réseau (module 00) jusqu'à un système TribuZen entier, distribué, résilient, cohérent par domaine, observable et **testé sous partition**.

← [Module 21 — CRDTs & résolution de conflits](21-crdts-et-resolution-de-conflits.md)
