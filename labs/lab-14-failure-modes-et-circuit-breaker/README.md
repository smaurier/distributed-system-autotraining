# Lab 14 — Modes de panne & circuit breaker

> **Outcome :** à la fin, tu sais **provoquer une panne en cascade** sur l'API-gateway TribuZen (le service `Notifications` devient lent → le pool sature → toute la page d'accueil tombe), puis la **couper** avec un **circuit breaker** (closed/open/half-open) + un **timeout budget** + un **bulkhead** + un **fallback** — la page d'accueil reste debout, en dégradé, alors que Notifications est mort.
> **Vrai outil :** Node 20 + TypeScript (Fastify + `undici`), le tout dans un `docker-compose` fourni (gateway + service `sorties` sain + service `notifications` qu'on peut ralentir à la volée). Pas de framework de test auto-correcteur : on injecte la lenteur pour de vrai et on lit les métriques du gateway.
> **Feedback :** le coach valide en session — on déclenche la cascade ensemble, on regarde le pool saturer, puis on regarde le breaker s'ouvrir et la page se dégrader proprement.

---

## Objectif

Tu tiens l'**API-gateway** de TribuZen. Sa route `GET /home/:familyId` agrège trois appels amont pour la page d'accueil famille : **Sorties** (critique), **Budget** (critique — simulé dans le même service `sorties`), **Notifications** (le badge « 3 notifs », **non critique**). Aujourd'hui l'agrégation est le code **naïf** du module (§1) : `Promise.all`, **aucun** timeout, **aucune** isolation, **aucun** breaker.

Ta mission, en trois temps :

1. **Provoquer la cascade.** Ralentis `Notifications` (25 s) et observe : le pool de connexions du gateway sature, les requêtes qui ne veulent **que** les Sorties timeoutent elles aussi. Un service **non critique** fait tomber **tout** le produit.
2. **Couper la cascade** avec les protections **côté appelant** : `timeout budget` propagé, `circuit breaker` (3 états), `bulkhead` (sémaphore dédié), et un `fallback` pour la dépendance non critique.
3. **Prouver** que Notifications malade **n'affecte plus** ni Sorties ni Budget : la page d'accueil s'affiche vite, **sans** le badge, breaker ouvert.

> Ce que tu **ne** fais **pas** ici : les retries/backoff+jitter eux-mêmes (module 08, acquis — tu les *composes* seulement) ; protéger `Notifications` de la surcharge entrante (rate limiting/backpressure → module 15). Ici : la survie de l'**appelant**.

---

## Prérequis

- **Module 14** lu (`../../modules/14-failure-modes-et-circuit-breaker.md`) — surtout §2.4 (bulkhead), §2.5 (circuit breaker 3 états), §2.7 (ordre des couches).
- **Module 08** (acquis) — timeout via `AbortController`, retry, deadline. On les réutilise sans les réexpliquer.
- **Module 04/07** — appels synchrones, deadlines, rôle de l'API-gateway.
- Docker + Docker Compose installés, Node 20, `pnpm` (ou `npm`).

---

## Mise en place

Crée le dossier de travail et colle le `docker-compose.yml` **fourni** ci-dessous. Trois services : deux services TribuZen (`gateway`, `sorties`) + un service qu'on peut ralentir (`notifications`).

```yaml
# docker-compose.yml — FOURNI (à copier tel quel)
services:
  gateway:
    build: ./gateway            # l'API-gateway TribuZen : c'est LUI que tu vas durcir
    ports: ["3000:3000"]
    environment:
      SORTIES_URL: http://sorties:3001
      NOTIFS_URL: http://notifications:3002
      # Pool de connexions volontairement PETIT pour voir la cascade vite :
      POOL_MAX_CONNECTIONS: "20"
    depends_on: [sorties, notifications]

  sorties:                      # service TribuZen SAIN (Sorties + Budget), toujours rapide (~40 ms)
    build: ./sorties
    ports: ["3001:3001"]

  notifications:                # service TribuZen qu'on peut RALENTIR à la volée
    build: ./notifications
    ports: ["3002:3002"]
    environment:
      SLOW_MS: "0"              # 0 = sain ; on le montera à 25000 pour provoquer la panne
```

Les services `sorties` et `notifications` sont des Fastify minimalistes (fournis). Le seul qui t'intéresse est **`notifications`** : il lit `SLOW_MS` **à chaque requête** via un endpoint de contrôle, pour qu'on injecte la lenteur **sans redéployer**.

```ts
// notifications/server.ts — FOURNI (le service qu'on ralentit)
import Fastify from 'fastify';

const app = Fastify();
let slowMs = Number(process.env.SLOW_MS ?? 0);

// Endpoint de CHAOS : règle la lenteur à chaud (pas de redéploiement).
app.post('/_chaos/slow', async (req) => {
  slowMs = Number((req.body as { ms: number }).ms);
  return { slowMs };
});

// L'appel métier réel : il répond TOUJOURS 200, juste (très) tard = timing failure.
app.get('/count/:familyId', async () => {
  if (slowMs > 0) await new Promise((r) => setTimeout(r, slowMs));
  return { unread: 3 };
});

app.listen({ port: 3002, host: '0.0.0.0' });
```

```ts
// gateway/homePage.ts — POINT DE DÉPART NAÏF (c'est CE fichier que tu vas durcir)
import { request } from 'undici';

const SORTIES = process.env.SORTIES_URL!;
const NOTIFS = process.env.NOTIFS_URL!;

export async function buildHomePage(familyId: string) {
  // 3 appels réseau. AUCUN timeout, AUCUNE isolation, AUCUN breaker. (§1 du module)
  const [sorties, budget, notifs] = await Promise.all([
    request(`${SORTIES}/list/${familyId}`).then((r) => r.body.json()),
    request(`${SORTIES}/budget/${familyId}`).then((r) => r.body.json()),
    request(`${NOTIFS}/count/${familyId}`).then((r) => r.body.json()), // ← LENT ce soir
  ]);
  return { sorties, budget, notifs };
}
```

Démarrage :

```bash
docker compose up -d --build
curl localhost:3000/home/fam-42     # sain : { sorties, budget, notifs:{ unread:3 } } en ~50 ms
```

> **Note templating :** ce README est servi par VitePress (Vue). Les doubles accolades littérales `{ { ... } }` seraient interprétées ; on n'en utilise **aucune** ici — si tu ajoutes un exemple d'interpolation, échappe-le avec `v-pre`.

---

## Étapes guidées (en friction)

### Étape 1 — Provoquer la cascade (avant de protéger, la voir tomber)

Injecte 25 s de lenteur sur Notifications, puis martèle le gateway et observe des requêtes **qui ne demandent que Sorties** timeouter aussi.

```bash
# 1. rendre Notifications lent SANS toucher au reste
curl -X POST localhost:3002/_chaos/slow -H 'content-type: application/json' -d '{"ms":25000}'

# 2. envoyer 60 requêtes home en parallèle (au-delà des 20 connexions du pool)
seq 60 | xargs -P 60 -I{} curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" localhost:3000/home/fam-42
```

**À constater et à nommer** (le coach te le demandera) :

- Chaque `home` reste **bloqué ~25 s** (la connexion Notifications reste ouverte tout ce temps).
- Le **pool (20)** est épuisé → les requêtes suivantes n'obtiennent **aucune** connexion et échouent, **même** celles vers Sorties (sain).
- C'est une **panne en cascade** : un service **non critique** a saturé une **ressource partagée bornée** et fait tomber des composants **sains**. Le bug n'est pas dans Notifications — il est dans l'**absence de protection de l'appelant**.

Repasse Notifications en sain pour la suite : `curl -X POST localhost:3002/_chaos/slow -d '{"ms":0}' -H 'content-type: application/json'`.

### Étape 2 — Poser le timeout budget (borner l'attente, fail-fast)

Aucun appel réseau sans timeout. Mieux : une **deadline propagée**. Le gateway a un budget global (ex. 1500 ms) pour répondre ; chaque appel amont reçoit le **temps restant**, pas 1500 ms chacun.

- Écris `withDeadline(deadlineEpochMs)` : à chaque appel, calcule `remaining = deadline - Date.now()` ; si `remaining <= 0`, **coupe en fail-fast** (ne fais pas l'appel réseau) ; sinon lance `request(..., { signal: AbortSignal.timeout(remaining) })`.
- Vérifie : avec Notifications à 25 s et un budget de 1500 ms, l'appel Notifications **abandonne à ~1500 ms** au lieu de 25 s. Le pool sature **plus lentement** — mais il sature encore (piège #2 : le timeout **réduit** la fenêtre, il ne **cloisonne** pas).

### Étape 3 — Implémenter le circuit breaker (arrêter d'appeler un service mort)

Écris la machine à **trois états** du module (§2.5), à partir de ce squelette — pas de gap-fill, tu écris `execute` et les transitions.

```ts
// gateway/circuit-breaker.ts — À COMPLÉTER
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export class CircuitBreakerOpenError extends Error {}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private openedAt = 0;
  constructor(private cfg: { failureThreshold: number; resetTimeoutMs: number }) {}

  async execute<T>(op: () => Promise<T>): Promise<T> {
    // TODO 1 — OPEN : si reset timeout écoulé → passer HALF_OPEN ; sinon throw CircuitBreakerOpenError (fail-fast).
    // TODO 2 — HALF_OPEN/CLOSED : tenter op(). Succès → onSuccess() ; échec → onFailure() puis rethrow.
  }
  // TODO 3 — onSuccess : reset compteur + state=CLOSED (referme même depuis HALF_OPEN).
  // TODO 4 — onFailure : si HALF_OPEN → trip() (ré-ouvre, timeout REPART). Sinon compter ; au seuil → trip().
  // TODO 5 — trip : state=OPEN, openedAt=Date.now().
  get currentState() { return this.state; }
}
```

- Un **timeout compte comme un échec** (piège #4 : la lenteur est pire que le crash).
- Un breaker **par dépendance** (pas global) : `notifsBreaker`, `sortiesBreaker`… La lenteur de Notifications ne doit pas ouvrir le breaker de Sorties.

### Étape 4 — Observer la coupure

Réinjecte la lenteur (`slow 25000`) et martèle. Attendu :

- Les **5 premiers** appels Notifications échouent (timeout) → le breaker **s'ouvre**.
- Les **suivants** sont rejetés en **fail-fast** (aucune connexion tenue) → le pool **ne sature plus**.
- Toutes les 10 s, **une** requête d'essai (half-open) teste si Notifications est revenu.

Expose l'état pour le coach : `GET /_metrics` → `{ notifsBreaker: "OPEN", poolInUse: 3, ... }`.

### Étape 5 — Isoler via bulkhead (borner le blast radius tout de suite)

Même **avant** que le breaker n'ouvre (les 5 premiers échecs), il faut plafonner la concurrence Notifications. Écris le **sémaphore** du module (§2.4).

```ts
// gateway/bulkhead.ts — À COMPLÉTER
export class BulkheadFullError extends Error {}
export class Bulkhead {
  private permits: number;
  constructor(private name: string, max: number) { this.permits = max; }
  async execute<T>(op: () => Promise<T>): Promise<T> {
    // TODO — si permits<=0 → throw BulkheadFullError (fail-fast, PAS de file d'attente).
    //        sinon permits-- ; try { return await op() } finally { permits++ }  ← rendre TOUJOURS le permis.
  }
}
```

- `notifsBulkhead = new Bulkhead('notifications', 5)`, `sortiesBulkhead = new Bulkhead('sorties', 12)`.
- Le `finally` est **non négociable** (piège #8 : un permis fuité vide le bulkhead à mort).

### Étape 6 — Composer dans le bon ordre + fallback

Assemble les couches dans l'ordre du module (§2.7) : **timeout → bulkhead → circuit breaker → (retry module 08) → appel**. Puis classe les dépendances et branche le **fallback** sur la non critique.

```ts
// gateway/homePage.ts — CIBLE (assemblage)
async function callNotifs(familyId: string, deadline: number) {
  try {
    return await notifsBulkhead.execute(() =>          // borne la concurrence (blast radius)
      notifsBreaker.execute(() =>                       // coupe si déjà mort (fail-fast)
        withDeadline(deadline, `${NOTIFS}/count/${familyId}`)));
  } catch (err) {
    // NON CRITIQUE → fallback : la page s'affiche SANS le badge (dégradation gracieuse).
    if (err instanceof BulkheadFullError || err instanceof CircuitBreakerOpenError) return null;
    return null; // toute panne Notifications → même fallback
  }
}

export async function buildHomePage(familyId: string) {
  const deadline = Date.now() + 1500;                   // budget global propagé
  const [sorties, budget, notifs] = await Promise.all([
    callSorties(familyId, deadline),                    // CRITIQUE : son échec fait échouer la page
    callBudget(familyId, deadline),                     // CRITIQUE
    callNotifs(familyId, deadline),                     // NON CRITIQUE : fallback null
  ]);
  return { sorties, budget, notifs };                   // notifs peut être null → front n'affiche pas le badge
}
```

**Prouve-le** (le coach fait ça avec toi) :

```bash
curl -X POST localhost:3002/_chaos/slow -d '{"ms":25000}' -H 'content-type: application/json'
seq 60 | xargs -P 60 -I{} curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" localhost:3000/home/fam-42
# Attendu : toutes ~200 en < 1.6 s, notifs:null, poolInUse bas, notifsBreaker=OPEN
curl localhost:3000/_metrics
# Remets Notifications sain → au bout d'un reset timeout, 1 essai half-open réussit → breaker CLOSED, badge revient
curl -X POST localhost:3002/_chaos/slow -d '{"ms":0}' -H 'content-type: application/json'
```

---

## Grille d'évaluation

| # | Critère | Attendu | ✅ / ❌ |
|---|---------|---------|--------|
| 1 | **Cascade reproduite** | Étape 1 : requêtes Sorties (saines) timeoutent à cause de Notifications ; l'apprenant nomme *pool exhaustion* + *ressource partagée bornée* | |
| 2 | **Timeout budget propagé** | `remaining = deadline - now` transmis à chaque appel ; fail-fast si `remaining <= 0` (pas d'appel fantôme) — pas « 1500 ms par maillon » | |
| 3 | **Breaker 3 états corrects** | CLOSED compte + ouvre au seuil ; OPEN fail-fast pendant reset timeout ; HALF_OPEN = **une** requête d'essai (succès→CLOSED, échec→OPEN + timeout **repart**) | |
| 4 | **Timeout = échec** | le breaker s'ouvre sur des **timeouts** (pas seulement des 5xx) | |
| 5 | **Bulkhead sémaphore** | permis dédié par dépendance ; fail-fast quand plein ; permis rendu dans un **`finally`** (test : provoquer un throw, vérifier que `available` remonte) | |
| 6 | **Ordre des couches** | timeout ⊃ bulkhead ⊃ breaker ⊃ (retry) ⊃ appel ; le retry (s'il est ajouté) est **sous** le breaker | |
| 7 | **Critique vs non critique** | Sorties/Budget critiques (échec → page échoue) ; Notifications non critique → **fallback `null`** ; la page s'affiche sans le badge | |
| 8 | **Coupure prouvée** | après protection : 60 req parallèles avec Notifications à 25 s → toutes < 1.6 s, pool non saturé, `notifsBreaker=OPEN` | |
| 9 | **Rétablissement** | Notifications repassé sain → half-open → CLOSED → le badge revient sans intervention | |

**Seuil de validation :** 1, 3, 5, 7, 8 obligatoires (le cœur : voir la cascade, la couper, la contenir). 2, 4, 6, 9 pour la maîtrise complète.

---

## Coach — relances (le coach drive, ne subit pas)

> Le coach ne se contente pas de « ça marche ». Il **provoque** et **interroge**. Au moins ces relances, à sortir même si l'apprenant ne bloque pas :

1. **« Montre-moi la cascade AVANT de la corriger. »** Tant que l'apprenant n'a pas vu une requête *Sorties* (saine) timeouter à cause de *Notifications*, il n'a pas compris le problème. Exiger la démonstration Étape 1, pas juste « je sais que ça sature ».
2. **« Ton timeout suffit ? »** Après l'étape 2, faire remarquer que le pool sature **encore**, juste plus lentement. Faire dire *pourquoi* : le timeout réduit la fenêtre, il ne cloisonne pas (piège #2). C'est ce qui **justifie** le bulkhead — sinon l'apprenant croit avoir fini à l'étape 2.
3. **« Enlève le `finally` du bulkhead et relance. »** Provoquer la fuite de permis en direct : quelques throws et le bulkhead se bloque à zéro — une panne **pire** que celle qu'on corrigeait (piège #8). Ancre viscéralement le `finally`.
4. **« Le breaker Sorties s'est-il ouvert pendant la panne Notifications ? »** S'il s'est ouvert → l'apprenant a un breaker **global**, pas par dépendance : la panne d'un non-critique a coupé un critique. Faire corriger vers un breaker **par dépendance**.
5. **« Half-open : combien de requêtes tu laisses passer ? »** Si la réponse est « tout le trafic qui arrive », c'est le thundering herd (piège #6). Exiger **une** requête d'essai, et vérifier que l'échec de l'essai **réarme** le reset timeout.
6. **« Pourquoi le retry doit-il être DEDANS le breaker, pas au-dessus ? »** (si l'apprenant ajoute le retry module 08). Faire nommer la **retry storm** : un retry au-dessus rearme des appels sous circuit ouvert → il annule le breaker et **rallume** la cascade.

> Si l'apprenant reste silencieux ou dit « c'est bon » : relancer avec « ok, alors prédis ce que `/_metrics` va afficher avant que je le lance » — la prédiction révèle les modèles mentaux faux.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 45 minutes, sans rouvrir ce corrigé ni le module :**

1. **Deadline propagée bout-en-bout.** Le client envoie un header `X-Request-Deadline` (epoch ms). Le gateway le lit, s'aligne dessus (au lieu de `now + 1500`), et **transmet** la deadline restante à `sorties`/`notifications` via le même header. Chaque service **abandonne** si sa deadline est déjà passée, sans travailler.
2. **Half-open à une seule requête, sous concurrence.** Garantis qu'en HALF_OPEN, **une seule** requête d'essai part même si 50 arrivent en même temps (les 49 autres restent en fail-fast). Indice : un flag `trialInFlight` posé atomiquement à l'entrée de l'essai.
3. **Le breaker alimente l'observabilité.** Une transition `CLOSED→OPEN` émet un **événement** (`console.warn('breaker.open notifications')`) — pas juste un compteur. C'est le pont vers le cours 16.

**Critère de réussite :** avec Notifications à 25 s, 60 requêtes parallèles portant une deadline serrée → toutes répondent avant leur deadline, `notifs:null`, un **seul** `breaker.open` loggé, et une **seule** requête d'essai visible dans les logs Notifications par fenêtre de reset.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces protections vivent côté gateway et deviennent transverses :

```
tribuzen/
  apps/
    gateway/
      src/
        home/
          home.controller.ts         ← buildHomePage : Promise.all + fallback notifs=null
        resilience/
          circuit-breaker.ts          ← machine 3 états, un instance par dépendance
          bulkhead.ts                 ← sémaphore dédié par dépendance
          deadline.ts                 ← timeout budget propagé (X-Request-Deadline)
          resilient-call.ts           ← compose timeout → bulkhead → breaker → retry (module 08)
  packages/
    contracts/                        ← types partagés Sorties/Budget/Notifications
```

**Différences par rapport au lab :**

- `notifications` n'est plus ralenti par un endpoint `/_chaos` mais devient le **vrai** service Notifications ; la lenteur, on la teste en pré-prod via le **cours 16 (chaos engineering)**, pas via un flag manuel.
- Le breaker n'expose plus `/_metrics` bricolé : ses transitions deviennent des **spans/événements OpenTelemetry** (module 16) — `CLOSED→OPEN` = alerte « Notifications dégradé ».
- Le fallback `notifs = null` peut devenir un **fallback plus riche** : dernière valeur connue en **cache stale** (le badge affiche le dernier compte connu plutôt que rien).
- La `resilient-call` devient un **wrapper partagé** appliqué à **tout** appel backend-to-backend faillible, chaque dépendance déclarée **critique** ou **non critique** dans sa config.

**Commit cible :**
```
feat(gateway): résilience home — timeout budget + circuit breaker + bulkhead par dépendance, fallback notifs non critique
```
