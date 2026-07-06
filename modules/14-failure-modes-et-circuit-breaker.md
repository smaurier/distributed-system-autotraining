---
titre: Modes de panne & circuit breaker
cours: 17-distributed-systems
notions: ["modes de panne : crash / omission / timing / byzantine", "panne partielle (partial failure)", "crash-stop vs crash-recovery", "fautes byzantines (survol)", "panne en cascade (cascading failure)", "retry storm (tempête de retries)", "épuisement du pool (thread / connection pool exhaustion)", "circuit breaker (Nygard, Release It!)", "états closed / open / half-open", "seuil d'échec (failure threshold)", "reset timeout", "requête d'essai (trial call) en half-open", "fail-fast", "bulkhead (cloisonnement)", "isolation par sémaphore / pool dédié", "timeout budget (deadline propagée)", "graceful degradation (dégradation gracieuse)", "fallback (réponse de repli)", "blast radius (rayon d'impact)"]
outcomes:
  - "sait classer une panne réelle selon le modèle crash / omission / timing / byzantine et expliquer pourquoi la panne partielle est le défi propre au distribué"
  - "sait décrire l'anatomie d'une panne en cascade (service lent → pool saturé → retry storm → effondrement) et nommer le mécanisme d'amplification"
  - "sait implémenter un circuit breaker en TypeScript avec ses trois états closed / open / half-open, un seuil d'échec, un reset timeout et une requête d'essai"
  - "sait implémenter un bulkhead à base de sémaphore pour isoler un appel lent et borner son blast radius"
  - "sait poser un timeout budget qui se propage le long d'une chaîne d'appels et couper en fail-fast"
  - "sait concevoir une dégradation gracieuse avec fallback (cache stale, valeur par défaut) sur une dépendance non critique"
prerequis: ["Modules 00-13 du cours 17-distributed-systems", "Module 08 — retries, backoff+jitter, timeouts, idempotency key (acquis, réutilisé ici)", "Module 05 — communication asynchrone, garanties de livraison, DLQ", "Module 04 — communication synchrone, deadlines"]
next: 15-rate-limiting-et-backpressure
libs: []
tribuzen: "backend TribuZen — le service Notifications devient lent ; sans protection il sature le pool de connexions de l'API-gateway et fait tomber tout TribuZen. Un circuit breaker + un bulkhead isolent la panne et gardent le reste du produit debout"
last-reviewed: 2026-07
---

# Modes de panne & circuit breaker

> **Outcomes — tu sauras FAIRE :** classer une panne (crash / omission / timing / byzantine), décrire une panne en cascade et sa tempête de retries, implémenter un circuit breaker (closed / open / half-open) et un bulkhead à base de sémaphore, poser un timeout budget propagé, concevoir une dégradation gracieuse avec fallback.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module est le niveau **résilience côté appelant** : comment un service qui **appelle** une dépendance défaillante **survit** au lieu de tomber avec elle. On classe d'abord les **modes de panne**, puis on montre le scénario qui tue un système distribué — la **panne en cascade** amplifiée par une **retry storm** — et on pose les trois protections de l'appelant : **circuit breaker**, **bulkhead**, **timeout budget**, plus la **dégradation gracieuse**. On **ne** couvre **pas** ici : les **retries / backoff+jitter / idempotency key** eux-mêmes → **module 08** (acquis, on les *combine* ici) ; le **rate limiting**, la **backpressure** et le **load shedding** (protéger le service *appelé* de la surcharge entrante) → **module 15 (next)** ; les **garanties de livraison** et la **DLQ** du broker → **module 05** ; la **décision d'architecture** (cell-based, multi-région) → **cours 13-architecture**. Ici : le mécanisme de protection de l'appelant et ses garanties.

## 1. Cas concret d'abord

Dans TribuZen, l'**API-gateway** (module 07) agrège plusieurs services pour construire la page d'accueil d'une famille : `Sorties`, `Budget`, et `Notifications` (badges « 3 nouvelles notifs »). Chaque requête entrante ouvre une connexion HTTP vers chacun.

Un mardi soir, le service **Notifications** part en **timing failure** : sa base ralentit, ses réponses passent de 40 ms à 25 s (sans **crasher** — il répond toujours « 200 OK », juste très tard). Voici le code de l'agrégation, tel qu'un collègue l'a écrit :

```ts
// gateway/homePage.ts — CE QUI VA FAIRE TOMBER TOUT TRIBUZEN
async function buildHomePage(familyId: string): Promise<HomePage> {
  // Trois appels réseau. AUCUN timeout, AUCUNE isolation, AUCUN circuit breaker.
  const [sorties, budget, notifs] = await Promise.all([
    sortiesClient.list(familyId),        // rapide (40 ms)
    budgetClient.summary(familyId),      // rapide (40 ms)
    notificationsClient.count(familyId), // ← LENT : 25 s ce soir
  ]);
  return { sorties, budget, notifs };
}
```

Ce qui se passe minute par minute :

1. Chaque requête `buildHomePage` **reste bloquée 25 s** en attendant `Notifications`. La connexion HTTP vers Notifications reste **ouverte** tout ce temps.
2. Les requêtes des familles **s'accumulent** : à 40 req/s, en 25 s il y a **1000 requêtes** en vol, donc **1000 connexions** ouvertes vers Notifications.
3. Le **pool de connexions** de la gateway (mettons 200) est **épuisé**. Les nouvelles requêtes — même celles qui ne veulent **que** les Sorties — n'obtiennent plus de connexion et **timeout** à leur tour.
4. Le front, voyant les requêtes échouer, **retente** automatiquement. Chaque retry ouvre une **nouvelle** requête vers la gateway déjà saturée : c'est la **retry storm**. Elle **ajoute** de la charge à un système déjà à genoux.
5. En quelques minutes, **tout TribuZen est down** — la page d'accueil, les Sorties, le Budget — alors qu'**un seul** service (Notifications, non critique) était en cause.

C'est une **panne en cascade** : la lenteur d'un composant **non critique** a saturé une ressource partagée (le pool) et fait tomber des composants **sains**. Le bug n'est pas dans Notifications — il est dans l'**absence de protection de l'appelant**. Ce module te donne les quatre défenses qui auraient coupé la cascade : un **timeout** (ne pas attendre 25 s), un **bulkhead** (Notifications ne peut pas voler *toutes* les connexions), un **circuit breaker** (arrêter d'appeler un service qu'on sait mort), et une **dégradation gracieuse** (afficher la page sans le badge notifs plutôt que rien).

---

## 2. Théorie complète, concise

### 2.1 Les modes de panne — une taxonomie

Pour se protéger d'une panne, il faut d'abord savoir **de quelle panne** on parle. La taxonomie classique (des plus faciles aux plus dures à traiter) :

- **Crash (fail-stop)** — le nœud **s'arrête net** et ne répond plus (OOM kill, process tué, machine éteinte). C'est la panne la **plus simple** : « pas de réponse » est un signal clair. Deux variantes : **crash-stop** (il ne revient jamais) et **crash-recovery** (il redémarre plus tard, éventuellement avec un état à réconcilier).
- **Omission** — le nœud **oublie** un message : il perd une requête entrante (*receive omission*) ou une réponse sortante (*send omission*). Difficile à distinguer d'un crash ou d'une lenteur : de l'extérieur, tu vois juste « pas de réponse ».
- **Timing** — le nœud répond, mais **trop tard** (GC pause, base lente, réseau congestionné). **C'est le cas du §1** et le plus **traître** : le service semble **vivant** (il finit par répondre 200), mais sa lenteur suffit à saturer l'appelant. Un service qui répond en 25 s est souvent **pire** qu'un service crashé, car un crash est détecté tout de suite.
- **Byzantine (survol)** — le nœud se comporte de façon **arbitraire ou malveillante** : réponses corrompues, incohérentes, contradictoires selon l'interlocuteur. C'est le mode le **plus coûteux** à tolérer (il faut du vote, de la redondance, de la crypto — cf. consensus byzantin, **module 18**). Dans un système **de confiance** (tes propres services, même datacenter), on **suppose généralement l'absence de fautes byzantines** et on se protège surtout du crash/omission/timing. On les mentionne pour savoir qu'elles existent (blockchains, systèmes multi-organisations).

> **Panne partielle (partial failure) — le défi propre au distribué.** Dans un monolithe, soit **tout** marche, soit **rien**. En distribué, **une partie** tombe pendant que le reste continue : A a envoyé un message à B, B est mort — A **ne sait pas** si B l'a reçu, traité, ou rien. Cette **incertitude** est la source de la plupart des bugs distribués (et la raison de l'idempotence du module 08 : on **retente** sans savoir si le premier essai a « pris »).

### 2.2 La panne en cascade — le mécanisme d'amplification

Une **panne en cascade** est une réaction en chaîne : la défaillance d'un composant **surcharge** les autres, qui tombent à leur tour. Le moteur est toujours une **ressource partagée et bornée** qui se fait siphonner :

- **Épuisement du pool (pool exhaustion)** — un service lent monopolise les **connexions** ou les **threads** de l'appelant (le §1). Les requêtes vers des services **sains** ne trouvent plus de ressource.
- **Retry storm (tempête de retries)** — quand les appels échouent, retries **naïfs** (sans backoff+jitter — module 08) **multiplient** la charge sur un service déjà en difficulté. Un service qui vacille reçoit alors **3× à 10×** son trafic normal et meurt pour de bon. Le retry, censé aider, **aggrave** la panne.
- **Effet thundering herd** — au moment où un service revient, **tous** les clients qui attendaient se ruent en même temps et le **re-tuent** aussitôt.

```
ANATOMIE D'UNE CASCADE (le §1)

Notifications lent (25 s)
   │
   ▼
requêtes gateway bloquées 25 s ─▶ pool de connexions saturé (200/200)
   │                                    │
   ▼                                    ▼
requêtes vers Sorties/Budget (SAINS) ─▶ plus de connexion ─▶ timeout
   │
   ▼
le front retente ─▶ RETRY STORM ─▶ +charge sur un système déjà mort
   │
   ▼
TribuZen entièrement down (à cause d'UN service non critique)
```

La leçon : **la lenteur se propage plus vite que le crash.** Il faut donc **borner l'attente** (timeout), **cloisonner** la ressource partagée (bulkhead), et **arrêter d'appeler** un service qu'on sait mort (circuit breaker).

### 2.3 Le timeout — la première défense (et sa dette)

Un **timeout** borne le temps qu'on accepte d'attendre une réponse. Sans lui, une **timing failure** devient un **blocage infini** — c'est la faute racine du §1. Règle de base : **aucun appel réseau sans timeout**. Un appel sans timeout, c'est un `await` qui peut durer 25 s.

Mais un timeout **naïf** a deux dettes :

- **Timeout budget (deadline propagée).** Si la gateway a 3 s pour répondre au front, et qu'elle appelle A (qui appelle B qui appelle C), on ne peut pas donner 3 s **à chaque** maillon — sinon la chaîne peut durer 9 s. On **propage une deadline** : la gateway démarre un budget de 3 s, en consomme, et transmet le **temps restant** à chaque appel aval. Quand le budget est **épuisé**, on **coupe** immédiatement (fail-fast) — inutile d'appeler C si on a déjà dépassé la deadline du front.
- **Un timeout seul ne protège pas du pool exhaustion.** Même avec un timeout de 3 s, si Notifications reste lent, **chaque** requête tient une connexion 3 s — le pool sature juste un peu moins vite. Le timeout **réduit** la fenêtre, il ne **cloisonne** pas. D'où le bulkhead (§2.4) et le circuit breaker (§2.5).

### 2.4 Le bulkhead — cloisonner pour borner le blast radius

Le **bulkhead** (« cloison étanche » d'une coque de navire) **isole les ressources par dépendance** : si un compartiment est inondé, les cloisons empêchent l'eau de gagner les autres. En logiciel : **chaque dépendance reçoit son propre pool** (de connexions, de threads, ou un **sémaphore** limitant la concurrence).

```
SANS bulkhead : pool partagé (200)          AVEC bulkhead : pools dédiés
Notifications lent ████████ (200/200)        Notifs   [ 30 max ] ████ plein → isolé
Sorties  ░ bloqué (0 dispo)                  Sorties  [ 85 max ] ██░░ OK
Budget   ░ bloqué (0 dispo)                  Budget   [ 85 max ] █░░░ OK
→ un lent tue tout le monde                  → le lent sature SON pool, pas les autres
```

Effet : Notifications ne peut plus consommer que **ses** 30 permis. Une fois ces 30 pris, tout nouvel appel à Notifications **échoue immédiatement** (`BulkheadFullError`, fail-fast) — mais Sorties et Budget gardent **leurs** 85 permis intacts. On a **borné le blast radius** (le rayon d'impact) de la panne Notifications à… Notifications. C'est le même principe que le *cell-based* au niveau infra, ici au niveau **appelant**.

### 2.5 Le circuit breaker — arrêter d'appeler un service mort

Le **circuit breaker** (Michael Nygard, *Release It!*, 2007) est un **disjoncteur logiciel**. Quand une dépendance échoue trop, il **« ouvre le circuit »** et **cesse d'appeler** — les requêtes échouent **immédiatement** au lieu d'attendre un timeout à chaque fois. Il évite deux gaspillages : attendre 3 s pour un service qu'on **sait** mort, et **matraquer** de retries un service qui a besoin de souffler pour se rétablir.

C'est une **machine à trois états** (Fowler, d'après Nygard) :

- **CLOSED (fermé)** — état nominal. *« You wrap a protected function call in a circuit breaker object, which monitors for failures. »* Les appels passent normalement. Un compteur d'échecs s'incrémente à chaque échec/timeout et se **remet à zéro** au succès. Quand il atteint le **seuil d'échec (failure threshold)**, on **ouvre**.
- **OPEN (ouvert)** — *« Once the failures reach a certain threshold, the circuit breaker trips, and all further calls to the circuit breaker return with an error, without the protected call being made at all. »* On **fail-fast** : rejet immédiat, aucun appel réseau. On reste ouvert pendant un **reset timeout** (le temps de laisser le service se rétablir).
- **HALF-OPEN (demi-ouvert)** — après le reset timeout, *« the circuit is ready to make a real call as trial to see if the problem is fixed »*. On laisse passer **une requête d'essai (trial call)**. Si elle **réussit** → retour en **CLOSED** (le service est revenu). Si elle **échoue** → retour en **OPEN**, et le reset timeout **repart** (on lui redonne du temps).

```
                    seuil d'échec atteint
      ┌────────────────────────────────────────▶  ┌────────┐
┌────────┐                                          │  OPEN  │
│ CLOSED │◀── essai OK ──┐                          │fail-fast│
│ appels │               │                          └───┬────┘
│ passent│           ┌───┴──────┐   essai KO           │ reset timeout écoulé
└────────┘           │HALF-OPEN │◀─────────────────────┘
                     │1 essai   │──── essai KO ──▶ (retour OPEN, timeout repart)
                     └──────────┘
```

Le circuit breaker transforme une **timing/omission failure répétée** en **fail-fast propre** : au lieu de 1000 requêtes qui attendent 3 s chacune, tu as 1000 rejets **instantanés** — le pool ne sature pas, et le front reçoit tout de suite un signal exploitable (afficher un fallback, §2.6).

### 2.6 Fail-fast, dégradation gracieuse & fallback

Ces trois notions répondent à : **une fois qu'on a coupé (timeout / bulkhead / breaker), on fait quoi ?**

- **Fail-fast** — détecter l'échec **au plus tôt** et le **signaler tout de suite**, au lieu de continuer dans un état incertain. Rejeter en 5 ms (breaker ouvert, bulkhead plein) plutôt que d'attendre 3 s. C'est un **principe** partagé par les trois patterns.
- **Graceful degradation (dégradation gracieuse)** — au lieu de renvoyer **une erreur pour toute la page**, on renvoie une **version dégradée mais utile**. Distinguer **critique** (le cœur de la page — pas de dégradation possible) et **non critique** (des enrichissements — dégradables). Le badge « 3 notifs » est **non critique** : mieux vaut la page d'accueil **sans** le badge que **pas de page du tout**.
- **Fallback (réponse de repli)** — la **valeur** qu'on renvoie quand la dépendance est coupée : une donnée **stale** du cache, une **valeur par défaut** (`notifs = 0`, « — »), une liste vide. Le fallback **matérialise** la dégradation gracieuse.

La combinaison gagnante du §1 : `Promise.all` → chaque appel a un **timeout court**, passe par un **bulkhead** et un **circuit breaker** ; Sorties/Budget sont **critiques** (leur échec fait échouer la page) ; Notifications est **non critique** → son échec (ou son breaker ouvert) déclenche un **fallback** `notifs = null`, et la page s'affiche **sans** le badge. La panne est **contenue** et **invisible** pour l'essentiel du produit.

### 2.7 Défense en profondeur — l'ordre des couches

Les patterns se **composent** ; l'ordre compte. De l'extérieur vers l'appel réel :

```
requête ─▶ [ TIMEOUT / deadline ]   borne l'attente globale
        ─▶ [ BULKHEAD ]             borne la concurrence (blast radius)
        ─▶ [ CIRCUIT BREAKER ]      coupe si le service est déjà mort (fail-fast)
        ─▶ [ RETRY + backoff+jitter ]  (module 08) réessaie une erreur transitoire
        ─▶ [ appel réseau réel ]
   (échec final) ─▶ FALLBACK        réponse de repli (dégradation gracieuse)
```

Pourquoi cet ordre : le **circuit breaker** doit englober le **retry**, sinon des retries continueraient sous un circuit ouvert (contradiction). Le **bulkhead** est au-dessus du breaker pour que même les appels qui *vont* échouer ne monopolisent pas les ressources. Le **timeout** chapeaute tout pour garantir la deadline. Et le **retry** doit rester **dedans** le breaker : un retry naïf **sans** breaker au-dessus, c'est exactement le carburant d'une **retry storm** (§2.2). C'est la synthèse qui relie ce module au module 08 : **retries oui, mais sous circuit breaker.**

---

## 3. Worked examples

### Exemple 1 — Un circuit breaker complet, en TypeScript

But : implémenter la machine à trois états et l'appliquer à l'appel `Notifications` du §1.

```ts
// circuit-breaker.ts
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number; // échecs consécutifs avant d'ouvrir (Nygard : ex. 5)
  resetTimeoutMs: number;   // durée en OPEN avant de tenter un essai
}

class CircuitBreakerOpenError extends Error {
  constructor() {
    super('Circuit ouvert — appel rejeté en fail-fast');
    this.name = 'CircuitBreakerOpenError';
  }
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;         // compteur d'échecs (état CLOSED)
  private openedAt = 0;             // horodatage du passage en OPEN
  private readonly cfg: CircuitBreakerConfig;

  constructor(cfg: CircuitBreakerConfig) {
    this.cfg = cfg;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // 1. OPEN : rejeter tout de suite, SAUF si le reset timeout est écoulé.
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cfg.resetTimeoutMs) {
        this.state = 'HALF_OPEN'; // prêt à tenter UNE requête d'essai
      } else {
        throw new CircuitBreakerOpenError(); // fail-fast, aucun appel réseau
      }
    }

    // 2. HALF_OPEN et CLOSED : on tente l'appel réel.
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    // Un succès en HALF_OPEN = le service est revenu → on referme.
    // Un succès en CLOSED = on réinitialise le compteur d'échecs.
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    if (this.state === 'HALF_OPEN') {
      // L'essai a échoué → on ré-ouvre, et le reset timeout REPART.
      this.trip();
      return;
    }
    // CLOSED : on compte, et on ouvre au seuil.
    this.failureCount++;
    if (this.failureCount >= this.cfg.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
  }

  get currentState(): CircuitState {
    return this.state;
  }
}

// Application au §1 : un breaker par dépendance.
const notifsBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 10_000 });

async function countNotifs(familyId: string): Promise<number | null> {
  try {
    return await notifsBreaker.execute(() => notificationsClient.count(familyId));
  } catch {
    // Breaker ouvert OU appel échoué → FALLBACK (dégradation gracieuse).
    return null; // la page s'affichera sans le badge notifs
  }
}
```

**Ce que ça achète :** après 5 échecs, le breaker s'ouvre ; les **995 requêtes suivantes** sont rejetées en **fail-fast** (aucune connexion tenue 25 s) → le pool ne sature plus. Toutes les 10 s, **une** requête d'essai teste si Notifications est revenu. Notifications malade **n'affecte plus** Sorties ni Budget.

### Exemple 2 — Un bulkhead à base de sémaphore

But : garantir que Notifications ne peut jamais monopoliser plus de N appels simultanés, même breaker fermé.

```ts
// bulkhead.ts
class BulkheadFullError extends Error {
  constructor(name: string) {
    super(`Bulkhead "${name}" plein — appel rejeté en fail-fast`);
    this.name = 'BulkheadFullError';
  }
}

class Bulkhead {
  private permits: number;                       // permis disponibles
  private readonly name: string;

  constructor(name: string, maxConcurrent: number) {
    this.name = name;
    this.permits = maxConcurrent;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Pas de file d'attente ici : si plein, on rejette TOUT DE SUITE (fail-fast).
    // (une variante bornée avec petite file d'attente + timeout est possible)
    if (this.permits <= 0) {
      throw new BulkheadFullError(this.name);
    }
    this.permits--;                              // on prend un permis
    try {
      return await operation();
    } finally {
      this.permits++;                            // TOUJOURS rendre le permis
    }
  }

  get available(): number {
    return this.permits;
  }
}

// Un pool dédié par dépendance → une dépendance lente ne vole pas les autres.
const notifsBulkhead = new Bulkhead('notifications', 30);

async function countNotifsIsolated(familyId: string): Promise<number | null> {
  try {
    // Composition : bulkhead AU-DESSUS du circuit breaker (cf. §2.7).
    return await notifsBulkhead.execute(() =>
      notifsBreaker.execute(() => notificationsClient.count(familyId)),
    );
  } catch (err) {
    if (err instanceof BulkheadFullError || err instanceof CircuitBreakerOpenError) {
      return null; // fallback : dégradation gracieuse
    }
    return null;   // toute autre panne de Notifications → même fallback (non critique)
  }
}
```

**Pourquoi c'est correct :** même **avant** que le breaker n'ouvre (les 5 premiers échecs), le bulkhead **plafonne** à 30 le nombre de requêtes Notifications en vol. Les 31ᵉ, 32ᵉ… sont rejetées **instantanément** — elles ne prennent **aucune** connexion du pool partagé. Le `finally` rend le permis **quoi qu'il arrive** (succès **ou** exception) : sans lui, un seul throw fuirait un permis et le bulkhead se viderait à mort. Bulkhead et breaker sont **complémentaires** : le bulkhead borne la **concurrence** (blast radius) tout de suite, le breaker coupe la dépendance **dans la durée**.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Un appel réseau sans timeout

« L'appel finira bien par répondre. » En **timing failure**, il répond en 25 s — ou jamais. Chaque `await` sans timeout est une **connexion tenue indéfiniment** : c'est la faute racine du §1. Règle absolue : **aucun appel réseau sans timeout**, et pour une chaîne, un **timeout budget** propagé (deadline restante), pas 3 s par maillon.

### PIÈGE #2 — Croire qu'un timeout seul suffit

Un timeout **réduit** la fenêtre de blocage, il ne **cloisonne** rien. Avec un timeout de 3 s et un service lent, **chaque** requête tient une connexion 3 s : le pool sature juste plus lentement. Le timeout est **nécessaire** mais **pas suffisant** — il faut **bulkhead** (borner la concurrence) et **circuit breaker** (arrêter d'appeler).

### PIÈGE #3 — Retenter sans circuit breaker (retry storm)

Le retry (module 08) est bon pour une erreur **transitoire**. Mais retenter un service **déjà mort** **multiplie** la charge et **empêche** son rétablissement : c'est la **retry storm**. Le retry doit **toujours** être **sous** un circuit breaker et avec **backoff+jitter** — jamais un `while (!ok) retry()` nu. Le circuit breaker est précisément ce qui **arrête** les retries quand le service est down.

### PIÈGE #4 — Un service lent est « moins grave » qu'un service crashé

Faux, et c'est contre-intuitif. Un **crash** est **détecté immédiatement** (connexion refusée → fail-fast gratuit). Un service **lent** (timing failure) répond « 200 OK » : il paraît **sain**, aucun signal d'alerte, et pourtant il **saine** l'appelant en tenant ses ressources. **La lenteur se propage plus vite que le crash** — c'est pour ça que le circuit breaker traite un **timeout** comme un **échec**.

### PIÈGE #5 — Mettre le circuit breaker au mauvais endroit dans la pile

Placer le **retry au-dessus** du breaker (retry qui ré-arme des appels sous circuit ouvert) annule le breaker. Placer le **breaker au-dessus** du bulkhead laisse les appels condamnés monopoliser les ressources. Ordre correct (§2.7) : **timeout → bulkhead → circuit breaker → retry → appel**. Le breaker **englobe** le retry ; le bulkhead **englobe** le breaker.

### PIÈGE #6 — Oublier l'état HALF-OPEN (ou y laisser passer tout le trafic)

Un breaker qui passe de OPEN directement à CLOSED sans **requête d'essai** risque de rouvrir les vannes sur un service encore malade (thundering herd). Le HALF-OPEN existe pour tester avec **une seule** requête : succès → CLOSED, échec → OPEN et le reset timeout **repart**. Laisser passer **tout** le trafic en half-open revient à ne pas avoir de half-open du tout.

### PIÈGE #7 — Traiter une dépendance non critique comme critique

Si l'échec du badge « notifs » fait échouer **toute** la page d'accueil, tu as transformé une panne **mineure** en panne **majeure**. Classe **explicitement** chaque dépendance : **critique** (échec → échec de la page) vs **non critique** (échec → **fallback** + dégradation gracieuse). Le fallback (`notifs = null`, cache stale, liste vide) est ce qui **contient** le blast radius côté produit.

### PIÈGE #8 — Un bulkhead qui ne rend pas ses permis

Prendre un permis puis oublier de le rendre sur le chemin d'erreur **vide** le bulkhead permis par permis, jusqu'au blocage total — une panne pire que celle qu'on voulait éviter. Le rendu du permis va **toujours** dans un `finally`, jamais après l'`await` (qui peut throw).

---

## 5. Ancrage TribuZen

TribuZen est un ensemble de services qui s'appellent en synchrone via l'**API-gateway** — le terrain exact des pannes en cascade.

**Le scénario du §1, protégé** — la page d'accueil famille agrège Sorties + Budget + Notifications :

```
buildHomePage(familyId)  [deadline 3 s propagée depuis le front]
  Sorties       CRITIQUE      timeout 800 ms + bulkhead(85) + breaker   échec → page échoue
  Budget        CRITIQUE      timeout 800 ms + bulkhead(85) + breaker   échec → page échoue
  Notifications NON CRITIQUE  timeout 500 ms + bulkhead(30) + breaker   échec → fallback notifs=null
```

Décisions concrètes pour TribuZen :

- **Un circuit breaker et un bulkhead par dépendance** (pas un pool global) : la lenteur de Notifications ne peut **pas** voler les connexions de Sorties/Budget. Blast radius borné à Notifications.
- **Notifications = non critique** → `fallback notifs = null` : la page s'affiche **sans** le badge plutôt que de tomber. Sorties et Budget sont **critiques** (une page d'accueil sans les sorties n'a pas de sens) → leur échec propage l'erreur.
- **Timeout budget propagé depuis le front** (3 s) : la gateway répartit son budget et **coupe en fail-fast** si un maillon dépasse — inutile d'attendre Notifications si on a déjà dépassé.
- **Retries (module 08) uniquement sous breaker** : les appels Sorties/Budget retentent une erreur transitoire **avec backoff+jitter**, mais **jamais** sous circuit ouvert → pas de retry storm.
- **Le breaker Notifications alimente l'observabilité** (cours 16) : une transition CLOSED→OPEN est un **événement d'alerte** (« Notifications dégradé »), pas juste un log.

> **Défère :** protéger le service Notifications **lui-même** de la surcharge entrante (rate limiting, backpressure, load shedding) = **module 15 (next)** ; le **retry/backoff/idempotency** générique des appels = **module 08** (acquis) ; la **DLQ** des notifications asynchrones = **module 05** ; la **décision** cell-based / multi-région pour borner le blast radius au niveau infra = **cours 13-architecture**. Ici on a posé les protections **côté appelant** et leurs garanties.

---

## 6. Points clés

1. **Modes de panne** : **crash** (fail-stop, simple), **omission** (message perdu), **timing** (trop lent — le plus traître), **byzantine** (arbitraire, coûteux, souvent supposé absent entre services de confiance). La **panne partielle** (incertitude sur l'état d'un pair) est le défi propre au distribué.
2. **La lenteur se propage plus vite que le crash** : un service lent paraît sain (200 OK) mais tient les ressources de l'appelant.
3. **Panne en cascade** : un composant lent **sature une ressource partagée bornée** (pool de connexions/threads) et fait tomber des composants sains. Amplifiée par la **retry storm** (retries naïfs sur un service mort).
4. **Timeout** = première défense (aucun appel réseau sans timeout) ; en chaîne, **timeout budget** = deadline propagée, coupée en fail-fast. Nécessaire mais **pas suffisant** (ne cloisonne pas).
5. **Bulkhead** = un **pool/sémaphore dédié par dépendance** : une dépendance lente sature **son** pool, pas les autres → **blast radius** borné. Fail-fast quand plein ; rendre le permis **toujours** (`finally`).
6. **Circuit breaker** (Nygard) = machine à 3 états : **CLOSED** (appels passent, compte les échecs, ouvre au **seuil**) → **OPEN** (fail-fast, aucun appel, pendant le **reset timeout**) → **HALF-OPEN** (une **requête d'essai** : succès → CLOSED, échec → OPEN et le timeout repart).
7. **Fail-fast** = échouer vite et signaler tout de suite (breaker ouvert, bulkhead plein) au lieu d'attendre.
8. **Dégradation gracieuse + fallback** : classer **critique** vs **non critique** ; sur non critique, renvoyer un **fallback** (cache stale, valeur par défaut) → contenir le blast radius côté produit.
9. **Défense en profondeur**, ordre : **timeout → bulkhead → circuit breaker → retry (module 08) → appel** ; fallback en dernier recours. Le retry doit **toujours** être **sous** le breaker.

---

## 7. Seeds Anki

```
Quels sont les quatre modes de panne classiques, du plus simple au plus dur à tolérer ?|Crash (fail-stop) : le nœud s'arrête net, facile à détecter. Omission : le nœud perd un message (entrant ou sortant). Timing : le nœud répond trop tard (le plus traître : il paraît vivant mais sature l'appelant). Byzantine : comportement arbitraire/malveillant, le plus coûteux (vote, redondance, crypto), souvent supposé absent entre services de confiance.
Qu'est-ce qu'une panne partielle et pourquoi est-ce le défi propre au distribué ?|Dans un monolithe, soit tout marche soit rien. En distribué, une partie tombe pendant que le reste continue : A a envoyé un message à B, B est mort — A ne sait pas si B l'a reçu/traité/rien. Cette incertitude est la source de la plupart des bugs distribués, et la raison de l'idempotence (on retente sans savoir si le 1er essai a pris).
Comment se déroule une panne en cascade ?|Un composant lent monopolise une ressource partagée et bornée (pool de connexions/threads) de l'appelant. Les requêtes vers des services SAINS ne trouvent plus de ressource et échouent à leur tour. Les retries naïfs (retry storm) ajoutent de la charge à un système déjà mort. Résultat : tout tombe à cause d'un seul composant, souvent non critique.
Pourquoi un service lent est-il souvent pire qu'un service crashé ?|Un crash est détecté immédiatement (connexion refusée → fail-fast gratuit). Un service lent (timing failure) répond "200 OK" : il paraît sain, aucun signal, mais il tient les ressources de l'appelant (connexions, threads) jusqu'à saturation. La lenteur se propage plus vite que le crash — d'où le fait que le circuit breaker traite un timeout comme un échec.
Quels sont les trois états d'un circuit breaker et leurs transitions ?|CLOSED : les appels passent, on compte les échecs ; au seuil d'échec (failure threshold) on ouvre. OPEN : fail-fast, tous les appels sont rejetés sans appel réseau, pendant le reset timeout. HALF-OPEN (après le reset timeout) : on laisse passer UNE requête d'essai ; succès → CLOSED (service revenu), échec → OPEN et le reset timeout repart.
À quoi sert un bulkhead et comment l'implémente-t-on ?|Le bulkhead (cloison étanche) isole les ressources par dépendance : chaque dépendance a son propre pool/sémaphore. Une dépendance lente sature SON pool (fail-fast quand plein) sans voler les ressources des autres → blast radius borné. Implémentation : un sémaphore de N permis, on prend un permis avant l'appel et on le rend TOUJOURS dans un finally.
Quelle est la différence entre bulkhead et circuit breaker ?|Le bulkhead borne la CONCURRENCE (nombre d'appels simultanés) d'une dépendance → il limite le blast radius tout de suite, même breaker fermé. Le circuit breaker coupe la dépendance DANS LA DURÉE quand elle échoue trop (arrête d'appeler un service mort). Ils sont complémentaires : bulkhead au-dessus du breaker dans la pile.
Dans quel ordre composer les patterns de résilience côté appelant ?|Timeout (deadline) → Bulkhead (borne la concurrence) → Circuit breaker (fail-fast si service mort) → Retry+backoff+jitter (module 08, erreur transitoire) → appel réseau réel ; fallback en dernier recours. Le retry doit TOUJOURS être sous le circuit breaker, sinon les retries continuent sous circuit ouvert = retry storm.
Qu'est-ce que la dégradation gracieuse et un fallback ?|Dégradation gracieuse : au lieu d'échouer toute la page, renvoyer une version dégradée mais utile en distinguant dépendances critiques (échec → échec) et non critiques (échec → repli). Fallback : la valeur de repli renvoyée quand la dépendance est coupée (cache stale, valeur par défaut, liste vide). Ex TribuZen : Notifications non critique → notifs=null, la page s'affiche sans le badge.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-14-failure-modes-et-circuit-breaker/README.md`. Sur un docker-compose fourni (une API-gateway TribuZen + un service `Notifications` dont on peut injecter une lenteur), implémenter un **circuit breaker** (closed/open/half-open) et un **bulkhead** sur l'appel `Notifications`, **provoquer une panne en cascade** en ralentissant Notifications, puis la **couper** (observer le pool ne plus saturer, le breaker s'ouvrir, la page s'afficher en dégradé via fallback). Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
