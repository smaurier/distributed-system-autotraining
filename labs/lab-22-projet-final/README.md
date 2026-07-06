# Lab 22 — Projet final : TribuZen distribué, résilient, testé sous partition

> **Outcome :** à la fin, tu as **conçu et implémenté** un système TribuZen distribué de bout en bout — plusieurs services avec chacun sa base, communication sync + async, saga `createSortie` avec outbox + semantic lock + idempotence, cohérence **choisie par domaine** (CAP), résilience **empilée** (retry+jitter, timeout, circuit breaker, bulkhead, rate limit), `traceId` propagé — et tu **prouves** qu'il tient en **provoquant une panne et une partition réseau**.
> **Vrai outil :** Node.js + TypeScript ; 5 services + une gateway lancés via le **docker-compose fourni** (PostgreSQL ×3 + RabbitMQ + Jaeger + Toxiproxy). Pas de framework de saga ni de mesh magique : tu écris l'orchestrateur, l'outbox et le câblage toi-même.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — **pas** de test-runner auto-correcteur.

---

## Contexte

C'est le **capstone** du cours : il n'introduit **aucune** notion neuve, il te fait **assembler** les modules 00 à 21 en **un** système. Le geste métier central de TribuZen — **créer une sortie payante à places limitées** — traverse quatre services sans base commune :

- **sorties-svc** — la sortie (`PENDING` → `CONFIRMED` / `CANCELLED`).
- **reservation-svc** — les places (`RESERVE_PENDING` → `RESERVE_CONFIRMED` / libéré).
- **budget-svc** — le budget commun de la famille (débit / crédit).
- **notifications-svc** — prévient les parents (consumer async).
- **feed-svc** — le fil d'activité de la famille (**read model**, AP).

Une **gateway** reçoit le trafic, applique auth + rate limit, corrèle un `traceId`, route. Un **broker** transporte les événements. Tu vas **concevoir** les frontières, **implémenter** la saga + outbox + résilience, puis **casser** le système pour prouver qu'il se comporte comme tu l'as **décidé**.

> Si un mécanisme te bloque (saga → module 11, outbox → 13, circuit breaker → 14, CAP → 09, test de partition → 17), **rouvre le module** : le capstone suppose ces briques acquises.

## Environnement fourni (docker-compose de départ)

Un `docker-compose.yml` t'est fourni **tel quel** (ne le modifie pas — c'est le socle commun que le coach connaît) :

```yaml
# docker-compose.yml (fourni)
services:
  db-sorties:     { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5451:5432"] }
  db-reservation: { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5452:5432"] }
  db-budget:      { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5453:5432"] }
  broker:         { image: rabbitmq:3-management, ports: ["5672:5672", "15672:15672"] }
  jaeger:         { image: jaegertracing/all-in-one:1, ports: ["16686:16686", "4318:4318"] }
  toxiproxy:      { image: ghcr.io/shopify/toxiproxy:2, ports: ["8474:8474", "5461-5463:5461-5463"] }
```

```bash
docker compose up -d          # 3 bases + broker + Jaeger (traces) + Toxiproxy (fault injection)
pnpm install
pnpm run migrate              # crée les tables (sorties, reservations, budgets, outbox, saga_state)
pnpm run dev                  # démarre gateway + 5 services + le poller outbox
```

Chaque service expose un mini-repository TypeScript déjà branché sur **sa** base (`sortiesRepo`, `reservationRepo`, `budgetRepo`). **Tu ne partages jamais une connexion entre deux services.** Toxiproxy s'interpose devant chaque base/service pour te permettre de **couper** un lien à chaud (partition) ou d'**ajouter de la latence** (fault injection). Jaeger reçoit les traces en OTLP sur `:4318`.

**Starters fournis** (squelettes **incomplets**, à remplir — pas de gap-fill) :

```ts
// src/sagas/createSortie/orchestrator.ts — STARTER
export interface SagaStep {
  name: string;
  execute: (ctx: SagaContext) => Promise<void>;      // throw = échec
  compensate?: (ctx: SagaContext) => Promise<void>;  // absent = retriable
}
export interface SagaContext { sagaId: string; data: Record<string, unknown>; }

export class SagaOrchestrator {
  constructor(private readonly steps: SagaStep[]) {}
  async run(ctx: SagaContext): Promise<{ ok: boolean }> {
    // TODO : exécuter en ordre ; à la 1re erreur, compenser les étapes réussies
    //        en ORDRE INVERSE (sauter les retriables) ; persister l'état dans saga_state.
    throw new Error('à implémenter');
  }
}
```

```ts
// src/shared/outbox.ts — STARTER
export async function add(tx: Tx | null, type: string, payload: unknown): Promise<void> {
  // TODO : insérer (type, payload, published=false) DANS la transaction tx fournie
  //        (même transaction locale que la donnée métier → pas de dual-write).
  throw new Error('à implémenter');
}
export async function poll(): Promise<number> {
  // TODO : lire les non-publiés, publier sur le broker, marquer published=true.
  throw new Error('à implémenter');
}
```

---

## Cahier des charges (ce que le système doit faire)

### Exigence 1 — découpage + frontière de cohérence par domaine (modules 02, 09, 10)
Chaque service a **sa** base. Documente, dans un `ARCHITECTURE.md` d'une page, **pour chaque domaine** son choix CAP et sa justification : Budget = **CP**, Réservation = **CP** (semantic lock), Sorties = **CP**, Feed = **AP**. Le choix devra être **prouvé** par l'exigence 6.

### Exigence 2 — communication sync + async au bon endroit (modules 04, 05, 06)
`checkDisponibilité` (l'UI attend) = **sync avec deadline**. `SortieCréée` / `SortieConfirmée` (découplage) = **événements** via le broker. **Aucun** appel synchrone bloquant vers Notifications.

### Exigence 3 — saga `createSortie` + outbox + idempotence (modules 08, 11, 13)
Implémente l'orchestrateur et les 4 étapes : créer (`PENDING`, compensatable) → réserver (`RESERVE_PENDING`, semantic lock, compensatable) → **débiter budget (pivot)** → confirmer + notifier (retriable). Chaque `execute` qui publie un événement l'écrit en **outbox dans la même transaction locale**. Chaque `execute` **et** `compensate` sont **idempotents** (dédup par `sagaId`+étape). L'état de saga est **persisté** dans `saga_state`.

### Exigence 4 — résilience empilée sur les appels de la gateway (modules 08, 14, 15)
Enveloppe les appels sortants : **timeout** (part d'un budget global de 800 ms), **retry+jitter** (appels idempotents seulement), **circuit breaker** + **fallback** (dégradation gracieuse). La gateway applique un **rate limit** (token bucket) en entrée.

### Exigence 5 — observabilité distribuée (module 16)
La gateway génère un `traceId` (W3C `traceparent`), le **propage** dans chaque appel sync **et** chaque message async, et chaque log de chaque service le porte. Une trace `createSortie` complète doit être **visible dans Jaeger**, traversant les 4 services.

### Exigence 6 — prouver la résilience : fault injection + test de partition (module 17)
- **Fault injection :** Notifications renvoie 500 → l'événement part en **DLQ**, mais `createSortie` **réussit** quand même (le périphérique async ne bloque pas le cœur).
- **Test de partition (le livrable clé) :** coupe (Toxiproxy) le lien gateway↔budget → la saga **échoue au pivot**, **compense en ordre inverse**, l'utilisateur reçoit un **refus propre**, **aucun** état orphelin, **aucun** double débit. Pendant la **même** partition, le **Feed répond stale** (AP). Deux comportements opposés, tous deux **choisis**.

### Exigence 7 — production readiness (checklist)
Health checks (`/live`, `/ready`) par service, DLQ monitorée, contrats versionnés (`SortieCréée v1`), graceful shutdown. Coche-les dans `ARCHITECTURE.md`.

---

## Jalons (ordre imposé — chaque jalon est un point de contrôle coach)

1. **J1 — Conception (sur papier / `ARCHITECTURE.md`).** Découpage, table CAP par domaine, sync vs async, tableau saga compensatable/pivot/retriable avec compensations. **Aucun code avant J1 validé** — sans frontières posées, le code n'a pas de forme.
2. **J2 — Squelette qui tourne.** `docker compose up`, migrations, les 5 services + gateway répondent à `/ready`. Un `POST /sorties` traverse la gateway et logue un `traceId` visible dans Jaeger (même sans saga complète).
3. **J3 — Saga + outbox + idempotence (happy path).** `createSortie` va au bout : sortie `CONFIRMED`, places `RESERVE_CONFIRMED`, budget débité une fois, `SortieCréée` publié via outbox, Feed projeté.
4. **J4 — Résilience + échec au pivot.** Circuit breaker/timeout/retry câblés ; budget refuse (20 € < 32 €) → compensation en ordre inverse, aucun état orphelin.
5. **J5 — Preuve : fault injection + partition.** Notifications 500 → DLQ, cœur métier OK. Partition gateway↔budget → refus CP propre ; Feed répond AP. **C'est le jalon qui valide le capstone.**

---

## Grille d'évaluation (exigeante — le coach coche ; un item non prouvé par une démo = non acquis)

- [ ] **Conception (J1)** — `ARCHITECTURE.md` : CAP **par domaine** justifié ; tableau saga compensatable/pivot/retriable correct ; pivot = débit budget justifié comme point de non-retour.
- [ ] **Découpage** — 5 bases isolées ; **aucune** connexion partagée entre services (vérifiable dans le code).
- [ ] **Sync/async** — `checkDisponibilité` sync avec deadline ; `SortieCréée`/`SortieConfirmée` async ; **aucun** appel sync bloquant vers Notifications.
- [ ] **Saga** — compensation **en ordre inverse**, **saute** les retriables ; état persisté dans `saga_state`.
- [ ] **Outbox** — donnée métier **et** ligne outbox dans la **même** transaction locale (pas de dual-write) ; poller publie et marque `published`.
- [ ] **Idempotence** — `execute` **et** `compensate` idempotents ; une double-livraison ne **double aucun** effet (débit, réservation, notif).
- [ ] **Résilience empilée** — timeout **dans** un budget global ; retry sur appels **idempotents seulement** ; circuit breaker **avec** fallback ; rate limit en entrée. Le candidat sait dire **quel garde-fou contre quelle panne**.
- [ ] **Observabilité** — `traceId` propagé **sync ET async** ; trace `createSortie` complète visible dans Jaeger à travers 4 services.
- [ ] **Fault injection** — Notifications 500 → DLQ ; `createSortie` **réussit** malgré tout.
- [ ] **Test de partition (bloquant)** — coupure gateway↔budget → échec au pivot + compensation + **zéro** état orphelin + **zéro** double débit ; Feed répond **stale** pendant la même partition. Les **deux** comportements démontrés en live.
- [ ] **Readiness** — health checks, DLQ monitorée, contrat `SortieCréée v1` versionné, graceful shutdown.

**Pièges guettés par le coach :** une cohérence unique pour tout le système ; notif en sync ; dual-write sans outbox ; retry sans timeout / circuit breaker sans fallback ; **une** frontière at-least-once non idempotente ; orchestrateur répliqué sans leader/état persisté ; `traceId` perdu à la frontière async ; « la résilience marche » **sans** test de partition qui le prouve.

---

## Coaching (relances si tu bloques — le coach en garde d'autres)

- **« Par où commencer ? »** → **J1, `ARCHITECTURE.md`, avant tout code.** Tant que la table CAP par domaine et le tableau de saga ne sont pas posés, le code n'a pas de forme. Un capstone se **conçoit** d'abord.
- **« Je mets tout le système en CP, c'est plus sûr, non ? »** → Non : ça tue la disponibilité du Feed sous partition **sans** bénéfice (un post à 2 s de retard est acceptable). La cohérence se choisit **par domaine**. Argumente **chaque** ligne.
- **« Mon événement `SortieCréée` se perd parfois. »** → Tu fais un **dual-write** : DB commit **puis** publish séparé. Écris la donnée **et** la ligne outbox dans la **même** transaction ; un poller publie ensuite (module 13).
- **« Le budget est parfois débité deux fois. »** → Le broker est **at-least-once** : une commande/compensation est **rejouée**. Rends `debiterBudget` idempotent (dédup par `idempotencyKey`, update **commutatif** relatif, jamais `SET solde = X`).
- **« J'ai empilé retry + circuit breaker mais ça se comporte bizarrement. »** → Nomme **quel garde-fou contre quelle panne** (§2.5 du module). Retry **sans** timeout = attente infinie ; circuit breaker **sans** fallback = erreur brute ; retry sur un appel **non-idempotent** = double effet.
- **« Ma trace s'arrête après la gateway. »** → Tu propages le `traceId` en HTTP sync mais pas dans les **messages** du broker. Ajoute-le comme **attribut de message** (module 16), sinon la trace casse à chaque `publish`.
- **« La résilience marche, je l'ai codée. »** → Non prouvée = supposée. **Coupe** le lien budget avec Toxiproxy et **montre** le refus CP propre + zéro double débit. C'est l'exigence 6, bloquante.
- **« Je scale l'orchestrateur en replicas: 2 pour la charge. »** → Deux orchestrateurs = deux sagas sur la même commande = double débit. Il faut un **leader unique** (module 18) + état persisté. Un coordinateur ne se réplique pas comme un stateless.

---

## Variante J+30 (fading) — extension du système

Reprends le système **de mémoire** et **étends-le** avec **une** capacité distribuée supplémentaire au choix (30–45 min de conception + implémentation ciblée) :

- **Option A — CRDT pour le compteur de vues du Feed (module 21).** Ajoute un `views` par sortie géré en **PN-Counter / G-Counter** répliqué, qui **converge** sans coordination même quand deux répliques du Feed sont partitionnées. Prouve : incrémente sur deux répliques **pendant** une partition (Toxiproxy), rétablis, montre la **convergence** (aucune vue perdue).
- **Option B — leader election de l'orchestrateur (module 18).** Passe l'orchestrateur en **2 instances** avec un lock/leader (etcd ou lock Postgres advisory). Prouve : tue le leader **au milieu** d'une saga → la seconde instance **reprend** depuis `saga_state`, **sans** re-débiter (idempotence + état persisté).
- **Option C — analytics en stream (module 20).** Ajoute un `analytics-svc` qui **consomme** les événements et calcule « sorties/heure » en **fenêtre glissante**, **sans** toucher le chemin critique. Prouve : la charge sur `createSortie` reste stable pendant que l'analytics tourne.

**Critère de réussite :** l'extension respecte les frontières déjà posées (aucune connexion partagée, idempotence, traçage) **et** apporte sa propre **preuve** (convergence, reprise, ou isolation du chemin critique) — pas juste « ça compile ».

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ce système **est** l'architecture cible (voir §5 du module). Différences par rapport au lab :

- Le broker, Jaeger et les bases sont **managés** (cloud, cours 12) ; ici en local via docker-compose.
- L'orchestrateur tourne en **leader unique** avec état persisté et reprise après crash ; dans le lab, la reprise est l'option B du J+30.
- Les contrats (`SortieCréée v1`) sont vérifiés par des **tests de contrat au CI** (cours 15) ; ici on les versionne à la main.
- Les frontières de cohérence sont **documentées** et **retestées** à chaque release (test de partition en CI nocturne).

**Commit cible :**

```
feat(distributed): TribuZen distribué — saga createSortie + outbox + résilience empilée, cohérence par domaine, testé sous partition
```
