# 09 — Retries, Timeouts & Idempotency (backoff, jitter, idempotency keys, delivery semantics)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5        | 60 min        | [Lab 09](../labs/lab-09-retries-idempotency/exercise.ts) | [Quiz 09](../quizzes/quiz-09-retries-idempotency.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer pourquoi les retries sont indispensables dans un système distribue
- Implementer 4 stratégies de retry : immediat, delai fixe, exponential backoff, backoff + jitter
- Définir un retry budget pour limiter la charge sur un système en difficulte
- Distinguer les 3 types de timeouts : connect, read, total
- Implementer des timeouts en TypeScript avec AbortController et Promise.race
- Définir l'idempotence et expliquer pourquoi elle est cruciale avec les retries
- Générer, stocker et vérifier des idempotency keys
- Rendre une operation POST idempotente avec des clés d'idempotence
- Comparer les semantiques de livraison : at-most-once, at-least-once, exactly-once

---

## 1. Pourquoi les retries sont essentiels

Dans un système distribue, les pannes transitoires sont la norme : timeout réseau, surcharge temporaire, redemarrage d'un pod, partition réseau fugace. Sans retries, chaque micro-incident devient une erreur visible pour l'utilisateur.

```
SANS RETRIES :                           AVEC RETRIES :
==============                           ================

Client → Service                         Client → Service
  │         │                              │         │
  │ ──req──►│                              │ ──req──►│
  │         │ (timeout reseau)             │         │ (timeout reseau)
  │ ◄─ 500 ─│                              │         │
  │         │                              │ ──req──►│  ← retry automatique
  │ ERREUR ! │                              │ ◄─ 200 ─│
  │ L'user   │                              │         │
  │ voit une │                              │ SUCCES ! │
  │ erreur   │                              │ L'user ne│
                                           │ remarque │
                                           │ rien     │
```

:::warning Ne pas tout reessayer aveuglement
Seules les erreurs **transitoires** meritent un retry : timeouts, 503, 429, erreurs réseau. Les erreurs permanentes (400, 401, 404, 422) ne seront pas resolues par un retry. Reessayer une erreur 400 est du gaspillage.
:::

---

## 2. Stratégies de retry

### 2.1 Les 4 stratégies principales

```
1. IMMEDIATE RETRY (dangereux)
   ───────────────────────────────────────►
   req  req  req  req  req  (avalanche !)
   └┘   └┘   └┘   └┘   └┘

2. FIXED DELAY (mieux)
   ──────────────────────────────────────────►
   req    req    req    req
   └┘  1s └┘  1s └┘  1s └┘

3. EXPONENTIAL BACKOFF (recommande)
   ──────────────────────────────────────────────────►
   req      req          req                  req
   └┘  1s   └┘   2s      └┘       4s          └┘

4. EXPONENTIAL BACKOFF + JITTER (optimal)
   ──────────────────────────────────────────────────►
   req       req           req                req
   └┘ 0.8s   └┘   2.3s     └┘      3.7s       └┘
       ↑           ↑              ↑
   delai aleatoire pour eviter la "thundering herd"
```

### 2.2 Implementation en TypeScript

```typescript
// retry-strategies.ts — Les 4 strategies implementees

type RetryableFunction<T> = () => Promise<T>;

interface RetryOptions {
  maxAttempts: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

// Determiner si une erreur est retryable
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Erreurs reseau
    if (error.message.includes('ECONNREFUSED')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.includes('fetch failed')) return true;
  }
  // Erreurs HTTP retryables
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    return [408, 429, 500, 502, 503, 504].includes(status);
  }
  return false;
}

// Strategie 1 : Immediate retry (deconseille en production)
async function retryImmediate<T>(
  fn: RetryableFunction<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxAttempts, shouldRetry = isRetryableError, onRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      onRetry?.(attempt, error, 0);
    }
  }
  throw new Error('Unreachable');
}

// Strategie 2 : Fixed delay
async function retryFixedDelay<T>(
  fn: RetryableFunction<T>,
  options: RetryOptions & { delayMs: number },
): Promise<T> {
  const { maxAttempts, delayMs, shouldRetry = isRetryableError, onRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }
  throw new Error('Unreachable');
}

// Strategie 3 : Exponential backoff
async function retryExponentialBackoff<T>(
  fn: RetryableFunction<T>,
  options: RetryOptions & { baseDelayMs: number; maxDelayMs: number },
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, shouldRetry = isRetryableError, onRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      onRetry?.(attempt, error, delay);
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}

// Strategie 4 : Exponential backoff + jitter (RECOMMANDEE)
async function retryWithBackoffAndJitter<T>(
  fn: RetryableFunction<T>,
  options: RetryOptions & { baseDelayMs: number; maxDelayMs: number },
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, shouldRetry = isRetryableError, onRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts || !shouldRetry(error)) throw error;

      // Exponential backoff
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
      // Full jitter : delai aleatoire entre 0 et exponentialDelay
      const jitteredDelay = Math.min(Math.random() * exponentialDelay, maxDelayMs);
      onRetry?.(attempt, error, jitteredDelay);
      await sleep(jitteredDelay);
    }
  }
  throw new Error('Unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

:::tip Pourquoi le jitter est essentiel
Sans jitter, quand un service redemarre, tous les clients reessayent exactement au même moment (1s, 2s, 4s...). C'est le **thundering herd** : le service est immediatement re-surcharge. Le jitter repartit les retries dans le temps.
:::

---

## 3. Retry budgets

Un retry budget limite le nombre total de retries dans un système, empechant l'amplification de charge.

```
SANS RETRY BUDGET :                      AVEC RETRY BUDGET :
====================                     =====================

100 clients x 3 retries chacun          100 clients, budget = 20% de retries
= 300 requetes supplementaires          = max 20 retries supplementaires

Service deja en difficulte              Service a le temps de recuperer
  → encore plus de charge                 → charge maitrisee
  → cascade de pannes                     → retablissement progressif
```

```typescript
// retry-budget.ts — Limiter les retries a l'echelle du systeme

class RetryBudget {
  private requestCount = 0;
  private retryCount = 0;
  private readonly windowMs: number;
  private readonly maxRetryRatio: number;

  constructor(windowMs = 10_000, maxRetryRatio = 0.2) {
    this.windowMs = windowMs;
    this.maxRetryRatio = maxRetryRatio;

    // Reset periodique de la fenetre
    setInterval(() => {
      this.requestCount = 0;
      this.retryCount = 0;
    }, this.windowMs);
  }

  recordRequest(): void {
    this.requestCount++;
  }

  canRetry(): boolean {
    if (this.requestCount === 0) return true;
    const currentRatio = this.retryCount / this.requestCount;
    return currentRatio < this.maxRetryRatio;
  }

  recordRetry(): void {
    this.retryCount++;
  }

  get stats() {
    return {
      requests: this.requestCount,
      retries: this.retryCount,
      ratio: this.requestCount > 0 ? this.retryCount / this.requestCount : 0,
    };
  }
}

// Usage : verifier le budget avant chaque retry
const budget = new RetryBudget(10_000, 0.2); // 20% max de retries sur 10s

async function fetchWithBudget<T>(fn: RetryableFunction<T>, maxAttempts = 3): Promise<T> {
  budget.recordRequest();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      if (!budget.canRetry()) {
        console.log(`[BUDGET] Retry budget epuise (${(budget.stats.ratio * 100).toFixed(1)}%)`);
        throw error; // Pas de retry, budget epuise
      }
      budget.recordRetry();
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10_000) * Math.random();
      await sleep(delay);
    }
  }
  throw new Error('Unreachable');
}
```

---

## 4. Timeouts

### 4.1 Les 3 types de timeouts

```
TYPES DE TIMEOUTS :
====================

1. CONNECT TIMEOUT (etablissement de connexion)
   Client ──── SYN ────► Serveur
   Client     attend...    (pas de reponse)
   Client ──── TIMEOUT ── apres 3s

2. READ TIMEOUT (attente de la reponse)
   Client ──── requete ──► Serveur
   Client ◄── connexion OK Serveur
   Client     attend...    (traitement long)
   Client ──── TIMEOUT ── apres 10s

3. TOTAL TIMEOUT (duree totale de l'operation)
   connect + envoi + traitement + reception
   ├────── total timeout : 30s ──────────────────┤
   │                                              │
   connect   envoi   traitement serveur   lecture │
   ├──3s──┤ ├──2s──┤ ├────── 15s ──────┤ ├──5s──┤│
                                                  │
   Si la somme depasse 30s → TIMEOUT              │
```

### 4.2 Cascading timeouts

```
PROBLEME : CASCADING TIMEOUTS
================================

Gateway (timeout: 30s)
  └──► Service A (timeout: 30s)
         └──► Service B (timeout: 30s)
                └──► Service C (timeout: 30s)

Si C prend 25s, B attend 25s, A attend 25s + son propre traitement...
Gateway timeout a 30s ! Mais le traitement total peut depasser 30s.

SOLUTION : DECREASING TIMEOUTS
=================================

Gateway (timeout: 10s)
  └──► Service A (timeout: 8s)
         └──► Service B (timeout: 5s)
                └──► Service C (timeout: 3s)

Chaque couche a un timeout inferieur a la couche precedente.
Le timeout se propage correctement.
```

### 4.3 Implementation en TypeScript

```typescript
// timeouts.ts — Implementer des timeouts proprement

// Methode 1 : AbortController (recommande pour fetch)
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Methode 2 : Promise.race (generique, fonctionne avec n'importe quelle Promise)
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out',
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`${message} after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

// Usage :
// const user = await withTimeout(
//   fetchUser('user-42'),
//   3000,
//   'Fetching user timed out'
// );
```

---

## 5. Idempotency

### 5.1 Definition et importance

```
IDEMPOTENT : Appliquer l'operation 1 fois ou N fois produit le meme resultat.

Exemples mathematiques :
  abs(abs(abs(-5))) = abs(-5) = 5            ← idempotent
  x + 1 + 1 + 1 = x + 3                    ← PAS idempotent

Methodes HTTP :
  GET    /orders/42     → idempotent (lire ne modifie rien)
  PUT    /orders/42     → idempotent (remplacer par le meme etat)
  DELETE /orders/42     → idempotent (supprimer un truc deja supprime = OK)
  POST   /orders        → PAS idempotent (creer deux fois = deux commandes !)

POURQUOI C'EST CRUCIAL AVEC LES RETRIES :
==========================================

Client ──── POST /orders ──── ► Serveur
                                  │ cree order-1
Client ◄─── (timeout reseau) ─── │ reponse perdue !
                                  │
Client ──── POST /orders ──── ► Serveur  (retry automatique)
                                  │ cree order-2 ← DOUBLON !

AVEC IDEMPOTENCY KEY :

Client ──── POST /orders ──── ► Serveur
             Idempotency-Key:     │ cree order-1
             "key-abc"            │ stocke key-abc → order-1
Client ◄─── (timeout reseau) ─── │ reponse perdue !
                                  │
Client ──── POST /orders ──── ► Serveur  (retry)
             Idempotency-Key:     │ key-abc deja connue !
             "key-abc"            │ retourne order-1 (pas de doublon)
```

### 5.2 Implementation des idempotency keys

```typescript
// idempotency.ts — Middleware d'idempotence pour Express

interface StoredResponse {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

class IdempotencyStore {
  private store = new Map<string, StoredResponse>();
  private readonly ttlMs: number;

  constructor(ttlMs = 24 * 60 * 60 * 1000) { // 24h par defaut
    this.ttlMs = ttlMs;
    // Nettoyage periodique
    setInterval(() => this.cleanup(), this.ttlMs / 4);
  }

  get(key: string): StoredResponse | undefined {
    const stored = this.store.get(key);
    if (stored && Date.now() - stored.createdAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return stored;
  }

  set(key: string, response: StoredResponse): void {
    this.store.set(key, response);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.store) {
      if (now - value.createdAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}

// Middleware Express
import type { Request, Response, NextFunction } from 'express';

const idempotencyStore = new IdempotencyStore();

function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  // L'idempotence ne concerne que les operations non-idempotentes (POST)
  if (req.method !== 'POST') {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    // Pas de cle = pas de protection (on laisse passer)
    return next();
  }

  // Verifier si on a deja traite cette requete
  const cached = idempotencyStore.get(idempotencyKey);
  if (cached) {
    console.log(`[IDEMPOTENT] Returning cached response for key "${idempotencyKey}"`);
    res.status(cached.statusCode).json(cached.body);
    return;
  }

  // Intercepter la reponse pour la stocker
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    idempotencyStore.set(idempotencyKey, {
      statusCode: res.statusCode,
      body,
      createdAt: Date.now(),
    });
    return originalJson(body);
  };

  next();
}

// Usage dans Express :
// app.use(idempotencyMiddleware);
// app.post('/orders', (req, res) => {
//   const order = createOrder(req.body);
//   res.status(201).json(order);
//   // Si le client reenvoie la meme requete avec la meme Idempotency-Key,
//   // il recoit la meme reponse sans creer un second order.
// });
```

---

## 6. Delivery semantics

```
SEMANTIQUES DE LIVRAISON :
============================

AT-MOST-ONCE (au plus une fois) :
  ┌──────────┐         ┌──────────┐
  │ Emetteur │──msg──►│ Recepteur│
  │          │         │          │
  │ "J'envoie│         │ "Je     │
  │  et      │         │  recois  │
  │  j'oublie│         │  ou pas" │
  └──────────┘         └──────────┘
  Implementation : envoyer sans ACK, pas de retry
  Risque : perte de messages
  Usage : metriques, logs, telemetrie

AT-LEAST-ONCE (au moins une fois) :
  ┌──────────┐         ┌──────────┐
  │ Emetteur │──msg──►│ Recepteur│
  │          │         │   ACK?   │
  │          │◄──────── │          │
  │ "Pas de  │  timeout │          │
  │  ACK →   │         │          │
  │  retry!" │──msg──►│ "Double!"│
  └──────────┘         └──────────┘
  Implementation : retry jusqu'a ACK
  Risque : messages dupliques
  Usage : la majorite des cas (avec idempotence !)

EXACTLY-ONCE (exactement une fois) :
  ┌──────────┐         ┌──────────┐
  │ Emetteur │──msg──►│ Recepteur│
  │          │         │ dedup +  │
  │          │         │ ACK      │
  └──────────┘         └──────────┘
  Implementation : at-least-once + deduplication cote recepteur
  En realite : at-least-once + idempotence = "effectively once"
```

:::warning Exactly-once est un "mensonge"
En théorie de la distribution, exactly-once delivery est impossible dans le cas général (Two Generals Problem). En pratique, on obtient l'**effet** d'exactly-once en combinant at-least-once delivery avec des handlers idempotents. C'est suffisant pour la plupart des systèmes.
:::

---

## 7. Assembler le tout

```typescript
// resilient-client.ts — Client HTTP resilient complet

class ResilientHttpClient {
  private retryBudget = new RetryBudget(10_000, 0.2);

  async request<T>(
    url: string,
    options: RequestInit & {
      timeoutMs?: number;
      maxRetries?: number;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const {
      timeoutMs = 5000,
      maxRetries = 3,
      idempotencyKey,
      ...fetchOptions
    } = options;

    // Ajouter l'idempotency key si fournie
    const headers = new Headers(fetchOptions.headers);
    if (idempotencyKey) {
      headers.set('Idempotency-Key', idempotencyKey);
    }

    this.retryBudget.recordRequest();

    return retryWithBackoffAndJitter(
      async () => {
        const response = await fetchWithTimeout(
          url,
          { ...fetchOptions, headers },
          timeoutMs,
        );

        if (!response.ok) {
          const error = Object.assign(new Error(`HTTP ${response.status}`), {
            status: response.status,
          });
          throw error;
        }

        return response.json() as Promise<T>;
      },
      {
        maxAttempts: maxRetries,
        baseDelayMs: 1000,
        maxDelayMs: 15_000,
        shouldRetry: (error) => {
          if (!this.retryBudget.canRetry()) return false;
          this.retryBudget.recordRetry();
          return isRetryableError(error);
        },
        onRetry: (attempt, error, delay) => {
          console.log(`[RETRY] Attempt ${attempt}, delay ${delay.toFixed(0)}ms, error: ${error}`);
        },
      },
    );
  }
}

// Usage :
// const client = new ResilientHttpClient();
//
// const order = await client.request<Order>('http://order-service/orders', {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({ userId: 'u42', items: [...] }),
//   timeoutMs: 5000,
//   maxRetries: 3,
//   idempotencyKey: crypto.randomUUID(), // Generer une seule fois cote client
// });
```

---

## Points clés

1. **Les retries** compensent les pannes transitoires. Sans retries, chaque micro-incident réseau devient une erreur visible.
2. **Exponential backoff + jitter** est la stratégie optimale : elle evite le thundering herd et laisse le temps au service de récupérer.
3. **Le retry budget** empeche l'amplification de charge : pas plus de 20% de retries par fenêtre de temps.
4. **Les timeouts** doivent etre decroissants à chaque couche (gateway > service A > service B) pour éviter les cascading timeouts.
5. **L'idempotence** est la condition prealable aux retries : sans idempotence, un retry peut créer des doublons.
6. **Les idempotency keys** rendent les operations POST idempotentes en stockant la réponse associee à chaque clé unique.
7. **Exactly-once** n'existe pas en pratique. On utilise at-least-once + idempotence pour obtenir l'**effet** d'exactly-once.

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [08 - API Gateway & BFF](./08-api-gateway-et-bff.md) | [10 - Coherence & CAP](./10-coherence-et-theoreme-cap.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 09 retries idempotency](../screencasts/screencast-09-retries-idempotency.md)
2. **Lab** : [lab-09-retries-idempotency](../labs/lab-09-retries-idempotency/README)
3. **Quiz** : [quiz 09 retries idempotency](../quizzes/quiz-09-retries-idempotency.html)
:::
