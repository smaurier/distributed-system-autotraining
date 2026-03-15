# 17 — Rate Limiting & Load Shedding

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 90 min        | [Lab 17](../labs/lab-17-rate-limiting/) | [Quiz 17](../quizzes/quiz-17-rate-limiting.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Distinguer rate limiting et load shedding et comprendre leurs objectifs respectifs
- Implementer les 5 algorithmes classiques de rate limiting en TypeScript
- Concevoir un rate limiter distribue avec Redis
- Utiliser les en-tetes HTTP standard pour communiquer les limites au client
- Implementer du load shedding avec admission control et priorite
- Comprendre le concept de CoDel (Controlled Delay) pour la gestion des queues
- Implementer un rate limiter cote client pour respecter les limites des API
- Choisir le bon algorithme selon le cas d'usage

---

## Rate limiting vs Load shedding

:::tip Distinction fondamentale
- **Rate limiting** : limiter le nombre de requêtes qu'un client peut envoyer dans un intervalle de temps. Protege contre l'abus et garantit l'equite entre clients.
- **Load shedding** : rejeter proactivement des requêtes quand le système est surcharge. Protege la stabilite du système entier.
:::

```
┌──────────────────────────────────────────────────────────────┐
│         RATE LIMITING vs LOAD SHEDDING                       │
│                                                              │
│  Rate Limiting :                                             │
│  "Client X, tu ne peux envoyer que 100 req/min"             │
│  → Par client, par API key, par IP                           │
│  → Toujours actif, meme si le systeme est sain               │
│                                                              │
│  Load Shedding :                                             │
│  "Le systeme est a 95% de capacite, je rejette les           │
│   requetes non prioritaires"                                 │
│  → Global, base sur la charge du systeme                     │
│  → Active uniquement en surcharge                            │
│                                                              │
│  ┌─────────────────┐      ┌─────────────────┐               │
│  │  Rate Limiter   │      │  Load Shedder   │               │
│  │                 │      │                 │               │
│  │  100 req/min    │      │  CPU > 80% ?    │               │
│  │  par client     │      │  Queue > 1000 ? │               │
│  │                 │      │  → Rejeter      │               │
│  └─────────────────┘      └─────────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

---

## Algorithmes de Rate Limiting

### 1. Fixed Window Counter

L'approche la plus simple : compter les requêtes dans des fenetres de temps fixes.

```typescript
class FixedWindowRateLimiter {
  private windows: Map<string, { count: number; windowStart: number }> =
    new Map();
  private readonly maxRequests: number;
  private readonly windowSizeMs: number;

  constructor(maxRequests: number, windowSizeMs: number) {
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeMs;
  }

  isAllowed(clientId: string): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
  } {
    const now = Date.now();
    const currentWindow = Math.floor(now / this.windowSizeMs);
    const key = `${clientId}:${currentWindow}`;

    let entry = this.windows.get(key);
    if (!entry || entry.windowStart !== currentWindow) {
      entry = { count: 0, windowStart: currentWindow };
      this.windows.set(key, entry);
    }

    const resetAt = (currentWindow + 1) * this.windowSizeMs;

    if (entry.count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetAt,
    };
  }
}

// Probleme : burst a la frontiere de deux fenetres
// |---fenetre 1---|---fenetre 2---|
// Si 100 requetes arrivent dans les dernieres ms de fenetre 1
// et 100 requetes dans les premieres ms de fenetre 2
// → 200 requetes en quelques ms, alors que la limite est 100/fenetre
```

:::warning Problème de frontiere
Le fixed window à un defaut connu : un client peut envoyer jusqu'a 2x le quota en concentrant les requêtes à la frontiere entre deux fenetres. Le sliding window corrige ce problème.
:::

### 2. Sliding Window Log

Stocke le timestamp de chaque requête et compte celles dans la fenêtre glissante.

```typescript
class SlidingWindowLog {
  private logs: Map<string, number[]> = new Map();
  private readonly maxRequests: number;
  private readonly windowSizeMs: number;

  constructor(maxRequests: number, windowSizeMs: number) {
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeMs;
  }

  isAllowed(clientId: string): {
    allowed: boolean;
    remaining: number;
  } {
    const now = Date.now();
    let timestamps = this.logs.get(clientId) || [];

    // Supprimer les entrees hors de la fenetre
    timestamps = timestamps.filter((t) => now - t < this.windowSizeMs);
    this.logs.set(clientId, timestamps);

    if (timestamps.length >= this.maxRequests) {
      return { allowed: false, remaining: 0 };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
    };
  }
}

// Avantage : pas de probleme de frontiere
// Inconvenient : memoire proportionnelle au nombre de requetes
// (stocke chaque timestamp individuellement)
```

### 3. Sliding Window Counter

Combine fixed window et sliding window pour un bon compromis mémoire/précision.

```typescript
class SlidingWindowCounter {
  private windows: Map<string, { current: number; previous: number; currentStart: number }> =
    new Map();
  private readonly maxRequests: number;
  private readonly windowSizeMs: number;

  constructor(maxRequests: number, windowSizeMs: number) {
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeMs;
  }

  isAllowed(clientId: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const currentWindow = Math.floor(now / this.windowSizeMs);

    let entry = this.windows.get(clientId);
    if (!entry) {
      entry = { current: 0, previous: 0, currentStart: currentWindow };
      this.windows.set(clientId, entry);
    }

    // Nouvelle fenetre ? Decaler
    if (entry.currentStart !== currentWindow) {
      if (currentWindow - entry.currentStart === 1) {
        entry.previous = entry.current;
      } else {
        entry.previous = 0; // fenetre trop ancienne
      }
      entry.current = 0;
      entry.currentStart = currentWindow;
    }

    // Poids de la fenetre precedente
    const elapsedInWindow = now - currentWindow * this.windowSizeMs;
    const previousWeight = 1 - elapsedInWindow / this.windowSizeMs;

    // Estimation du nombre de requetes dans la fenetre glissante
    const estimatedCount =
      entry.previous * previousWeight + entry.current;

    if (estimatedCount >= this.maxRequests) {
      return {
        allowed: false,
        remaining: Math.max(0, Math.floor(this.maxRequests - estimatedCount)),
      };
    }

    entry.current++;
    const newEstimate =
      entry.previous * previousWeight + entry.current;

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(this.maxRequests - newEstimate)),
    };
  }
}
```

### 4. Token Bucket

Le token bucket ajoute des tokens à un rythme constant. Chaque requête consomme un token. Permet des bursts controles.

```
┌──────────────────────────────────────────────────────────────┐
│                TOKEN BUCKET                                   │
│                                                              │
│  ┌───────────────────────────────────────┐                   │
│  │  Bucket (capacite max = 10)           │                   │
│  │                                       │                   │
│  │  [T] [T] [T] [T] [T] [T] [ ] [ ] [ ] │ ← Tokens         │
│  │                                       │                   │
│  └───────────────────┬───────────────────┘                   │
│           ▲          │                                        │
│           │          ▼                                        │
│  Remplissage     Requete consomme                            │
│  2 tokens/sec    1 token                                     │
│                                                              │
│  • Bucket plein → les nouveaux tokens sont perdus            │
│  • Bucket vide → les requetes sont rejetees                  │
│  • Permet des bursts : un bucket plein autorise              │
│    10 requetes d'un coup, puis 2/sec                         │
└──────────────────────────────────────────────────────────────┘
```

```typescript
class TokenBucket {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens par seconde
  private lastRefill: number;

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens; // Commence plein
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  consume(tokensRequired: number = 1): {
    allowed: boolean;
    tokensRemaining: number;
    retryAfterMs: number | null;
  } {
    this.refill();

    if (this.tokens >= tokensRequired) {
      this.tokens -= tokensRequired;
      return {
        allowed: true,
        tokensRemaining: Math.floor(this.tokens),
        retryAfterMs: null,
      };
    }

    // Pas assez de tokens — calculer quand il y en aura assez
    const deficit = tokensRequired - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillRate) * 1000);

    return {
      allowed: false,
      tokensRemaining: Math.floor(this.tokens),
      retryAfterMs: waitMs,
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  getStatus(): { tokens: number; maxTokens: number; refillRate: number } {
    this.refill();
    return {
      tokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
    };
  }
}
```

### 5. Leaky Bucket

Le leaky bucket traite les requêtes à un rythme constant, en mettant les surplus dans une file d'attente.

```typescript
class LeakyBucket {
  private queue: Array<{
    id: string;
    resolve: (allowed: boolean) => void;
    enqueuedAt: number;
  }> = [];
  private readonly maxQueueSize: number;
  private readonly leakRateMs: number; // intervalle entre les traitements
  private processing = false;
  private totalProcessed = 0;
  private totalDropped = 0;

  constructor(requestsPerSecond: number, maxQueueSize: number) {
    this.leakRateMs = 1000 / requestsPerSecond;
    this.maxQueueSize = maxQueueSize;
  }

  async submit(requestId: string): Promise<boolean> {
    if (this.queue.length >= this.maxQueueSize) {
      this.totalDropped++;
      return false; // Queue pleine, requete rejetee
    }

    return new Promise<boolean>((resolve) => {
      this.queue.push({
        id: requestId,
        resolve,
        enqueuedAt: Date.now(),
      });
      this.startProcessing();
    });
  }

  private startProcessing(): void {
    if (this.processing) return;
    this.processing = true;

    const processNext = () => {
      if (this.queue.length === 0) {
        this.processing = false;
        return;
      }

      const item = this.queue.shift()!;
      item.resolve(true);
      this.totalProcessed++;

      // Traiter le prochain element apres le delai fixe
      setTimeout(processNext, this.leakRateMs);
    };

    processNext();
  }

  getMetrics(): {
    queueSize: number;
    maxQueueSize: number;
    totalProcessed: number;
    totalDropped: number;
  } {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      totalProcessed: this.totalProcessed,
      totalDropped: this.totalDropped,
    };
  }
}
```

### Comparaison des algorithmes

```
┌────────────────────────────────────────────────────────────────────┐
│  Algorithme          │ Memoire │ Precision │ Burst │ Complexite    │
│──────────────────────┼─────────┼───────────┼───────┼───────────────│
│  Fixed Window        │  O(1)   │  Faible   │  2x   │  Tres simple  │
│  Sliding Window Log  │  O(n)   │  Exacte   │  Non  │  Simple       │
│  Sliding Window Cnt  │  O(1)   │  Bonne    │  ~Non │  Moyenne      │
│  Token Bucket        │  O(1)   │  Bonne    │  Oui  │  Simple       │
│  Leaky Bucket        │  O(n)   │  Exacte   │  Non  │  Moyenne      │
└────────────────────────────────────────────────────────────────────┘
```

---

## Rate limiting distribue

Dans un système avec plusieurs instances, le rate limiter doit etre partage. Redis est le choix classique.

```typescript
// Rate limiter distribue avec Redis (conceptuel)
interface RedisClient {
  eval(script: string, keys: string[], args: string[]): Promise<number>;
}

class DistributedRateLimiter {
  private redis: RedisClient;
  private readonly maxRequests: number;
  private readonly windowSizeMs: number;

  constructor(redis: RedisClient, maxRequests: number, windowSizeSec: number) {
    this.redis = redis;
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeSec * 1000;
  }

  async isAllowed(clientId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const now = Date.now();
    const windowKey = `ratelimit:${clientId}:${Math.floor(
      now / this.windowSizeMs
    )}`;

    // Script Lua atomique — s'execute entierement dans Redis
    const luaScript = `
      local current = redis.call('INCR', KEYS[1])
      if current == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      return current
    `;

    const count = await this.redis.eval(
      luaScript,
      [windowKey],
      [String(this.windowSizeMs)]
    );

    const currentWindow = Math.floor(now / this.windowSizeMs);
    const resetAt = (currentWindow + 1) * this.windowSizeMs;

    return {
      allowed: count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - count),
      resetAt,
    };
  }
}

// Middleware Express pour le rate limiting
function rateLimitMiddleware(
  limiter: DistributedRateLimiter
) {
  return async (
    req: { ip: string; headers: Record<string, string> },
    res: {
      status: (code: number) => { json: (body: unknown) => void };
      setHeader: (name: string, value: string) => void;
    },
    next: () => void
  ) => {
    const clientId = req.headers['x-api-key'] || req.ip;
    const result = await limiter.isAllowed(clientId);

    // En-tetes standard de rate limiting
    res.setHeader('X-RateLimit-Limit', String(100));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader(
      'X-RateLimit-Reset',
      String(Math.ceil(result.resetAt / 1000))
    );

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(
        (result.resetAt - Date.now()) / 1000
      );
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${retryAfterSec}s.`,
        retryAfter: retryAfterSec,
      });
      return;
    }

    next();
  };
}
```

### En-tetes HTTP de rate limiting

```
┌──────────────────────────────────────────────────────────────┐
│           EN-TETES DE RATE LIMITING                           │
│                                                              │
│  Reponse HTTP 200 OK :                                       │
│  ┌────────────────────────────────────────────────┐          │
│  │  X-RateLimit-Limit: 100                       │          │
│  │  X-RateLimit-Remaining: 73                    │          │
│  │  X-RateLimit-Reset: 1709337600                │          │
│  └────────────────────────────────────────────────┘          │
│                                                              │
│  Reponse HTTP 429 Too Many Requests :                        │
│  ┌────────────────────────────────────────────────┐          │
│  │  X-RateLimit-Limit: 100                       │          │
│  │  X-RateLimit-Remaining: 0                     │          │
│  │  X-RateLimit-Reset: 1709337600                │          │
│  │  Retry-After: 42                              │          │
│  └────────────────────────────────────────────────┘          │
│                                                              │
│  Draft IETF (RateLimit header fields) :                      │
│  ┌────────────────────────────────────────────────┐          │
│  │  RateLimit-Policy: 100;w=60                   │          │
│  │  RateLimit: limit=100, remaining=73, reset=42 │          │
│  └────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

---

## Load Shedding

Le load shedding est une technique de dernier recours : quand le système est surcharge, il rejette activement des requêtes pour proteger celles qu'il accepte.

### Admission control

```typescript
interface LoadMetrics {
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  activeRequests: number;
  queueDepth: number;
  avgLatencyMs: number;
  errorRate: number;
}

type RequestPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

interface IncomingRequest {
  id: string;
  priority: RequestPriority;
  timestamp: number;
  endpoint: string;
}

class AdmissionController {
  private maxActiveRequests: number;
  private activeRequests = 0;
  private readonly priorityOrder: RequestPriority[] = [
    'background',
    'low',
    'normal',
    'high',
    'critical',
  ];

  constructor(maxActiveRequests: number) {
    this.maxActiveRequests = maxActiveRequests;
  }

  shouldAdmit(
    request: IncomingRequest,
    metrics: LoadMetrics
  ): { admitted: boolean; reason?: string } {
    // Toujours admettre les requetes critiques (health checks, etc.)
    if (request.priority === 'critical') {
      return { admitted: true };
    }

    // Verifier la surcharge CPU
    if (metrics.cpuUsagePercent > 90) {
      const minPriority = this.getMinPriorityForLoad(metrics.cpuUsagePercent);
      if (this.priorityOrder.indexOf(request.priority) <
          this.priorityOrder.indexOf(minPriority)) {
        return {
          admitted: false,
          reason: `CPU a ${metrics.cpuUsagePercent}% — seules les requetes ${minPriority}+ sont admises`,
        };
      }
    }

    // Verifier le nombre de requetes actives
    if (this.activeRequests >= this.maxActiveRequests) {
      // Load shedding : rejeter les requetes basse priorite
      if (request.priority === 'low' || request.priority === 'background') {
        return {
          admitted: false,
          reason: `${this.activeRequests} requetes actives (max ${this.maxActiveRequests})`,
        };
      }
    }

    // Verifier la latence moyenne
    if (metrics.avgLatencyMs > 5000 && request.priority !== 'high') {
      return {
        admitted: false,
        reason: `Latence moyenne ${metrics.avgLatencyMs}ms — systeme sature`,
      };
    }

    return { admitted: true };
  }

  requestStarted(): void {
    this.activeRequests++;
  }

  requestCompleted(): void {
    this.activeRequests--;
  }

  private getMinPriorityForLoad(cpuPercent: number): RequestPriority {
    if (cpuPercent > 95) return 'critical';
    if (cpuPercent > 90) return 'high';
    if (cpuPercent > 80) return 'normal';
    if (cpuPercent > 70) return 'low';
    return 'background';
  }
}
```

### Priority-based load shedding

```typescript
class PriorityLoadShedder {
  private readonly maxConcurrent: number;
  private active = 0;
  private readonly shedRates: Map<RequestPriority, number> = new Map();

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
    // Taux de rejection par priorite quand le systeme est surcharge
    this.shedRates.set('background', 1.0);  // 100% rejete
    this.shedRates.set('low', 0.8);         // 80% rejete
    this.shedRates.set('normal', 0.5);      // 50% rejete
    this.shedRates.set('high', 0.2);        // 20% rejete
    this.shedRates.set('critical', 0);      // jamais rejete
  }

  shouldShed(priority: RequestPriority): boolean {
    const utilization = this.active / this.maxConcurrent;

    // Pas de load shedding sous 70% d'utilisation
    if (utilization < 0.7) return false;

    // Load shedding progressif entre 70% et 100%
    const overloadFactor = (utilization - 0.7) / 0.3; // 0 a 1
    const shedRate = (this.shedRates.get(priority) || 0) * overloadFactor;

    return Math.random() < shedRate;
  }

  async execute<T>(
    priority: RequestPriority,
    operation: () => Promise<T>
  ): Promise<T> {
    if (this.shouldShed(priority)) {
      throw new LoadSheddingError(
        `Requete ${priority} rejetee par load shedding ` +
        `(utilisation: ${Math.round((this.active / this.maxConcurrent) * 100)}%)`
      );
    }

    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
    }
  }
}

class LoadSheddingError extends Error {
  readonly statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'LoadSheddingError';
  }
}
```

### CoDel : Controlled Delay

CoDel est un algorithme de gestion de queue qui détecté le "bufferbloat" : quand les requêtes passent trop de temps dans la queue, c'est un signe de surcharge durable.

```typescript
// CoDel simplifie pour les requetes HTTP
class CoDelQueue<T> {
  private queue: Array<{ item: T; enqueuedAt: number }> = [];
  private readonly targetDelayMs: number;  // delai cible (ex: 5ms)
  private readonly intervalMs: number;      // intervalle de verification
  private droppingState = false;
  private dropNext = 0;
  private dropCount = 0;
  private totalDropped = 0;

  constructor(targetDelayMs: number = 5, intervalMs: number = 100) {
    this.targetDelayMs = targetDelayMs;
    this.intervalMs = intervalMs;
  }

  enqueue(item: T): void {
    this.queue.push({ item, enqueuedAt: Date.now() });
  }

  dequeue(): { item: T; wasDelayed: boolean } | null {
    if (this.queue.length === 0) return null;

    const entry = this.queue.shift()!;
    const sojournTime = Date.now() - entry.enqueuedAt;

    if (sojournTime < this.targetDelayMs) {
      // Le temps d'attente est acceptable
      this.droppingState = false;
      return { item: entry.item, wasDelayed: false };
    }

    // Le temps d'attente depasse la cible
    if (!this.droppingState) {
      // Premier depassement — entrer en mode dropping
      this.droppingState = true;
      this.dropCount = 1;
      this.dropNext = Date.now() + this.intervalMs;
      return { item: entry.item, wasDelayed: true };
    }

    // En mode dropping — verifier si on doit dropper
    const now = Date.now();
    if (now >= this.dropNext) {
      // Dropper cet element
      this.dropCount++;
      this.totalDropped++;
      // Intervalle decroissant : 1/sqrt(count)
      this.dropNext = now + this.intervalMs / Math.sqrt(this.dropCount);
      // Essayer le prochain
      return this.dequeue();
    }

    return { item: entry.item, wasDelayed: true };
  }

  getMetrics(): {
    queueSize: number;
    dropping: boolean;
    totalDropped: number;
  } {
    return {
      queueSize: this.queue.length,
      dropping: this.droppingState,
      totalDropped: this.totalDropped,
    };
  }
}
```

---

## Rate limiting cote client

:::tip Bonne pratique
Un client bien écrit respecte les limites de l'API qu'il appelle en implementant son propre rate limiter. Cela evite de gaspiller des requêtes qui seront de toute façon rejetees avec un 429.
:::

```typescript
class ClientRateLimiter {
  private tokenBucket: TokenBucket;
  private retryQueue: Array<{
    operation: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  private processing = false;

  constructor(requestsPerSecond: number, burstSize: number) {
    this.tokenBucket = new TokenBucket(burstSize, requestsPerSecond);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tokenBucket.consume();

    if (result.allowed) {
      return this.callWithRetryAfterHandling(operation);
    }

    // Attendre le temps necessaire
    if (result.retryAfterMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, result.retryAfterMs!)
      );
      return this.execute(operation);
    }

    throw new Error('Rate limit exceeded on client side');
  }

  private async callWithRetryAfterHandling<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      // Si le serveur renvoie un 429 avec Retry-After
      if (error.status === 429 && error.headers?.['retry-after']) {
        const retryAfterSec = parseInt(error.headers['retry-after'], 10);
        console.warn(
          `Rate limited by server. Waiting ${retryAfterSec}s before retry.`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, retryAfterSec * 1000)
        );
        return operation();
      }
      throw error;
    }
  }
}

// Utilisation
// const apiClient = new ClientRateLimiter(10, 20); // 10 req/s, burst de 20
// const data = await apiClient.execute(() =>
//   fetch('https://api.example.com/data').then((r) => r.json())
// );
```

---

## Choisir le bon algorithme

```
┌────────────────────────────────────────────────────────────────────┐
│              GUIDE DE CHOIX                                        │
│                                                                    │
│  "J'ai besoin de..."            → Algorithme recommande            │
│                                                                    │
│  Simplicite maximale            → Fixed Window Counter             │
│  Precision sans burst           → Sliding Window Log               │
│  Bon compromis memoire/prec.    → Sliding Window Counter           │
│  Autoriser les bursts            → Token Bucket                     │
│  Debit constant lisse           → Leaky Bucket                     │
│  Rate limiting distribue        → Token Bucket + Redis             │
│  Protection systeme globale     → Load Shedding + CoDel            │
│  API publique                   → Token Bucket + en-tetes HTTP     │
│  Microservices internes         → Sliding Window + Circuit Breaker │
└────────────────────────────────────────────────────────────────────┘
```

---

## Résumé

| Concept | Description | Cas d'usage |
|---------|------------|-------------|
| **Fixed Window** | Compteur par fenêtre de temps fixe | Simple, tolerant les bursts |
| **Sliding Window Log** | Timestamp de chaque requête | Precision maximale |
| **Sliding Window Counter** | Interpolation entre 2 fenetres | Bon compromis |
| **Token Bucket** | Tokens remplis a rythme constant | API avec burst autorise |
| **Leaky Bucket** | Traitement a debit constant | Lissage du trafic |
| **Load Shedding** | Rejection proactive en surcharge | Protection du système |
| **Admission Control** | Decision par priorite | Trafic heterogene |
| **CoDel** | Detection du bufferbloat | Gestion de queues |

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [16 - Circuit Breaker, Bulkhead & Backpressure](./16-circuit-breaker.md) | [18 - Observabilité des systèmes distribues](./18-observabilite-distribuee.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 17 rate limiting](../screencasts/screencast-17-rate-limiting.md)
2. **Lab** : [lab-17-rate-limiting](../labs/lab-17-rate-limiting/README)
3. **Quiz** : [quiz 17 rate limiting](../quizzes/quiz-17-rate-limiting.html)
:::
