# 16 — Circuit Breaker, Bulkhead & Backpressure

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 90 min        | [Lab 16](../labs/lab-16-circuit-breaker/) | [Quiz 16](../quizzes/quiz-16-circuit-breaker.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer le fonctionnement du circuit breaker comme machine a états (Closed, Open, Half-Open)
- Implementer un circuit breaker complet en TypeScript avec seuils de detection et de récupération
- Appliquer le pattern bulkhead pour isoler les ressources par dépendance
- Implementer un bulkhead a base de semaphore limitant la concurrence
- Définir ce qu'est la backpressure et pourquoi elle est nécessaire
- Implementer une bounded queue avec stratégies de backpressure (buffer, drop, signal)
- Concevoir une degradation gracieuse avec des réponses par defaut et feature flags
- Combiner circuit breaker, bulkhead et timeout pour une résilience en profondeur

---

## Circuit Breaker : le disjoncteur logiciel

:::tip Analogie
Le circuit breaker logiciel fonctionne comme un disjoncteur electrique : quand trop d'erreurs se produisent, il "ouvre le circuit" pour empecher d'envoyer des requêtes à un service defaillant, evitant ainsi de surcharger un système déjà en difficulte.
:::

### Machine a états

```
┌──────────────────────────────────────────────────────────────┐
│              CIRCUIT BREAKER — MACHINE A ETATS               │
│                                                              │
│                    Succes                                     │
│               ┌──────────────┐                               │
│               │              │                               │
│               ▼              │                               │
│  ┌──────────────────┐   ┌───┴──────────────┐                │
│  │                  │   │                  │                │
│  │     CLOSED       │   │    HALF-OPEN     │                │
│  │                  │   │                  │                │
│  │ Les requetes     │   │ Laisser passer   │                │
│  │ passent           │   │ quelques requetes│                │
│  │ normalement      │   │ pour tester      │                │
│  │                  │   │                  │                │
│  └────────┬─────────┘   └───┬──────────────┘                │
│           │                 ▲         │                       │
│           │ Seuil d'erreurs │         │ Echec                │
│           │ atteint         │         │                       │
│           ▼                 │         ▼                       │
│  ┌──────────────────────────┴───────────────┐                │
│  │                                          │                │
│  │               OPEN                        │                │
│  │                                          │                │
│  │  Toutes les requetes sont rejetees        │                │
│  │  immediatement (fail-fast)               │                │
│  │  Attente du timeout avant half-open      │                │
│  │                                          │                │
│  └──────────────────────────────────────────┘                │
│                                                              │
│  CLOSED → OPEN : quand le taux d'erreur depasse le seuil    │
│  OPEN → HALF-OPEN : apres le timeout de recuperation         │
│  HALF-OPEN → CLOSED : si les requetes de test reussissent    │
│  HALF-OPEN → OPEN : si les requetes de test echouent         │
└──────────────────────────────────────────────────────────────┘
```

### Implementation complete

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;     // Nombre d'echecs avant ouverture
  successThreshold: number;     // Nombre de succes en half-open pour fermer
  timeoutMs: number;            // Duree en etat ouvert avant half-open
  monitorWindowMs: number;      // Fenetre de temps pour compter les echecs
  halfOpenMaxRequests: number;  // Requetes autorisees en half-open
}

interface CircuitBreakerMetrics {
  state: CircuitState;
  failures: number;
  successes: number;
  consecutiveSuccesses: number;
  lastFailureTime: number | null;
  lastStateChange: number;
  totalRequests: number;
  totalRejected: number;
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number[] = [];       // timestamps des echecs
  private halfOpenSuccesses = 0;
  private halfOpenRequests = 0;
  private lastStateChange = Date.now();
  private totalRequests = 0;
  private totalRejected = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly listeners: Array<
    (from: CircuitState, to: CircuitState) => void
  > = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 3,
      timeoutMs: config.timeoutMs ?? 30_000,
      monitorWindowMs: config.monitorWindowMs ?? 60_000,
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
    };
  }

  onStateChange(listener: (from: CircuitState, to: CircuitState) => void): void {
    this.listeners.push(listener);
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    // Verifier l'etat actuel
    if (this.state === 'OPEN') {
      // Verifier si le timeout est ecoule → passer en HALF_OPEN
      if (Date.now() - this.lastStateChange >= this.config.timeoutMs) {
        this.transitionTo('HALF_OPEN');
      } else {
        this.totalRejected++;
        throw new CircuitBreakerOpenError(
          `Circuit ouvert — requete rejetee. Reessayez dans ${Math.ceil(
            (this.config.timeoutMs - (Date.now() - this.lastStateChange)) / 1000
          )}s`
        );
      }
    }

    if (this.state === 'HALF_OPEN') {
      // Limiter le nombre de requetes en half-open
      if (this.halfOpenRequests >= this.config.halfOpenMaxRequests) {
        this.totalRejected++;
        throw new CircuitBreakerOpenError(
          'Circuit en half-open — limite de requetes test atteinte'
        );
      }
      this.halfOpenRequests++;
    }

    // Executer l'operation
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.transitionTo('CLOSED');
      }
    }
    // En etat CLOSED, un succes ne change rien
  }

  private onFailure(): void {
    const now = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Un echec en half-open → retour en OPEN
      this.transitionTo('OPEN');
      return;
    }

    if (this.state === 'CLOSED') {
      this.failures.push(now);
      // Nettoyer les anciens echecs hors de la fenetre
      this.failures = this.failures.filter(
        (t) => now - t < this.config.monitorWindowMs
      );

      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'HALF_OPEN') {
      this.halfOpenSuccesses = 0;
      this.halfOpenRequests = 0;
    }

    if (newState === 'CLOSED') {
      this.failures = [];
      this.halfOpenSuccesses = 0;
      this.halfOpenRequests = 0;
    }

    // Notifier les listeners
    for (const listener of this.listeners) {
      listener(oldState, newState);
    }
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failures: this.failures.length,
      successes: this.halfOpenSuccesses,
      consecutiveSuccesses: this.halfOpenSuccesses,
      lastFailureTime:
        this.failures.length > 0
          ? this.failures[this.failures.length - 1]
          : null,
      lastStateChange: this.lastStateChange,
      totalRequests: this.totalRequests,
      totalRejected: this.totalRejected,
    };
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
```

### Monitoring du circuit breaker

```typescript
// Surveillance et logging des transitions
class CircuitBreakerMonitor {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private history: Array<{
    service: string;
    from: CircuitState;
    to: CircuitState;
    timestamp: number;
  }> = [];

  register(serviceName: string, breaker: CircuitBreaker): void {
    this.breakers.set(serviceName, breaker);

    breaker.onStateChange((from, to) => {
      const entry = {
        service: serviceName,
        from,
        to,
        timestamp: Date.now(),
      };
      this.history.push(entry);

      // Log structuree
      console.log(JSON.stringify({
        level: to === 'OPEN' ? 'error' : 'info',
        event: 'circuit_breaker_transition',
        service: serviceName,
        from,
        to,
        timestamp: new Date().toISOString(),
      }));
    });
  }

  getDashboard(): Record<
    string,
    { state: CircuitState; totalRequests: number; totalRejected: number }
  > {
    const dashboard: Record<string, any> = {};
    for (const [name, breaker] of this.breakers) {
      const metrics = breaker.getMetrics();
      dashboard[name] = {
        state: metrics.state,
        totalRequests: metrics.totalRequests,
        totalRejected: metrics.totalRejected,
      };
    }
    return dashboard;
  }

  getRecentTransitions(lastNMinutes: number = 60): typeof this.history {
    const cutoff = Date.now() - lastNMinutes * 60 * 1000;
    return this.history.filter((h) => h.timestamp > cutoff);
  }
}

// Utilisation
const monitor = new CircuitBreakerMonitor();

const paymentBreaker = new CircuitBreaker({
  failureThreshold: 3,
  successThreshold: 2,
  timeoutMs: 15_000,
});
monitor.register('payment-service', paymentBreaker);

const inventoryBreaker = new CircuitBreaker({
  failureThreshold: 5,
  successThreshold: 3,
  timeoutMs: 30_000,
});
monitor.register('inventory-service', inventoryBreaker);
```

---

## Bulkhead : isolation des ressources

:::tip Analogie
Le bulkhead (cloison etanche) est inspire des cloisons dans les coques de navire : si une section est inondee, les cloisons empechent l'eau de se repandre dans les autres compartiments. De la même façon, on isole les pools de ressources par dépendance.
:::

```
┌──────────────────────────────────────────────────────────────┐
│           BULKHEAD — ISOLATION PAR DEPENDANCE                │
│                                                              │
│  SANS bulkhead :                                             │
│  ┌──────────────────────────────────────────────┐            │
│  │          Pool de threads partage (20)        │            │
│  │  Service A ████████████████████  (bloque)    │            │
│  │  Service B                       (bloque)    │            │
│  │  Service C                       (bloque)    │            │
│  └──────────────────────────────────────────────┘            │
│  → A est lent et consomme TOUS les threads                   │
│  → B et C sont bloques alors qu'ils sont sains               │
│                                                              │
│  AVEC bulkhead :                                             │
│  ┌──────────────────┐                                        │
│  │ Pool A (8 max)   │  ████████ (plein, A est lent)         │
│  └──────────────────┘                                        │
│  ┌──────────────────┐                                        │
│  │ Pool B (6 max)   │  ██░░░░   (fonctionne normalement)   │
│  └──────────────────┘                                        │
│  ┌──────────────────┐                                        │
│  │ Pool C (6 max)   │  ███░░░   (fonctionne normalement)   │
│  └──────────────────┘                                        │
│  → A est isole, B et C ne sont pas impactes                  │
└──────────────────────────────────────────────────────────────┘
```

### Implementation : semaphore-based bulkhead

```typescript
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(maxPermits: number) {
    this.permits = maxPermits;
  }

  async acquire(timeoutMs: number = 5000): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    // Attendre qu'un permit soit libere, avec timeout
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(onRelease);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        reject(new BulkheadFullError(
          `Bulkhead plein — timeout apres ${timeoutMs}ms`
        ));
      }, timeoutMs);

      const onRelease = () => {
        clearTimeout(timer);
        resolve();
      };

      this.waiting.push(onRelease);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    } else {
      this.permits++;
    }
  }

  get availablePermits(): number {
    return this.permits;
  }

  get queueLength(): number {
    return this.waiting.length;
  }
}

class BulkheadFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkheadFullError';
  }
}

class Bulkhead {
  private readonly name: string;
  private readonly semaphore: Semaphore;
  private readonly maxWaitMs: number;
  private activeCount = 0;
  private totalRejected = 0;
  private totalExecuted = 0;

  constructor(name: string, maxConcurrent: number, maxWaitMs: number = 5000) {
    this.name = name;
    this.semaphore = new Semaphore(maxConcurrent);
    this.maxWaitMs = maxWaitMs;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.semaphore.acquire(this.maxWaitMs);
    } catch {
      this.totalRejected++;
      throw new BulkheadFullError(
        `Bulkhead "${this.name}" plein (${this.activeCount} actifs, ${this.semaphore.queueLength} en attente)`
      );
    }

    this.activeCount++;
    this.totalExecuted++;

    try {
      return await operation();
    } finally {
      this.activeCount--;
      this.semaphore.release();
    }
  }

  getMetrics(): {
    name: string;
    active: number;
    available: number;
    queued: number;
    totalExecuted: number;
    totalRejected: number;
  } {
    return {
      name: this.name,
      active: this.activeCount,
      available: this.semaphore.availablePermits,
      queued: this.semaphore.queueLength,
      totalExecuted: this.totalExecuted,
      totalRejected: this.totalRejected,
    };
  }
}

// Utilisation : isoler les dependances
class ResilientService {
  private paymentBulkhead = new Bulkhead('payment', 10, 3000);
  private inventoryBulkhead = new Bulkhead('inventory', 15, 2000);
  private notificationBulkhead = new Bulkhead('notification', 5, 1000);

  async processOrder(orderId: string): Promise<void> {
    // Chaque dependance a son propre pool isole
    const payment = this.paymentBulkhead.execute(() =>
      this.callPaymentService(orderId)
    );

    const inventory = this.inventoryBulkhead.execute(() =>
      this.callInventoryService(orderId)
    );

    // Si le paiement est lent, le bulkhead payment se remplit
    // mais le bulkhead inventory n'est pas affecte
    await Promise.all([payment, inventory]);

    // La notification est non critique — si le bulkhead est plein, on continue
    try {
      await this.notificationBulkhead.execute(() =>
        this.sendNotification(orderId)
      );
    } catch (error) {
      if (error instanceof BulkheadFullError) {
        console.warn(`Notification skipped for ${orderId}: bulkhead full`);
      }
    }
  }

  private async callPaymentService(_orderId: string): Promise<void> {
    /* ... */
  }
  private async callInventoryService(_orderId: string): Promise<void> {
    /* ... */
  }
  private async sendNotification(_orderId: string): Promise<void> {
    /* ... */
  }
}
```

---

## Backpressure : gérer la surcharge

La backpressure est un mécanisme de controle de flux qui permet à un consommateur lent de signaler au producteur de ralentir.

```
┌──────────────────────────────────────────────────────────────┐
│              BACKPRESSURE — LE PROBLEME                       │
│                                                              │
│  Producteur (rapide)        Consommateur (lent)              │
│  ┌────────┐                 ┌────────┐                       │
│  │ 1000   │  ──────────►    │  100   │  requetes/sec         │
│  │ req/s  │                 │ req/s  │                       │
│  └────────┘                 └────────┘                       │
│                                                              │
│  Sans backpressure :                                         │
│  → La queue grandit indefiniment                             │
│  → La memoire explose                                        │
│  → La latence augmente (items attendent dans la queue)       │
│  → OOM kill                                                  │
│                                                              │
│  STRATEGIES :                                                │
│                                                              │
│  1. Buffer (bounded)  : garder N elements, rejeter le reste  │
│  2. Drop              : jeter les elements en surplus         │
│  3. Signal            : dire au producteur de ralentir       │
│  4. Sample            : ne traiter que 1 element sur N       │
└──────────────────────────────────────────────────────────────┘
```

### Implementation : bounded queue avec backpressure

```typescript
type BackpressureStrategy = 'drop-newest' | 'drop-oldest' | 'reject' | 'block';

interface BackpressureMetrics {
  enqueued: number;
  dequeued: number;
  dropped: number;
  rejected: number;
  currentSize: number;
  maxSize: number;
  utilizationPercent: number;
}

class BoundedQueue<T> {
  private queue: T[] = [];
  private readonly maxSize: number;
  private readonly strategy: BackpressureStrategy;
  private waitingProducers: Array<(accepted: boolean) => void> = [];
  private waitingConsumers: Array<(item: T) => void> = [];
  private metrics: BackpressureMetrics;

  constructor(maxSize: number, strategy: BackpressureStrategy = 'reject') {
    this.maxSize = maxSize;
    this.strategy = strategy;
    this.metrics = {
      enqueued: 0,
      dequeued: 0,
      dropped: 0,
      rejected: 0,
      currentSize: 0,
      maxSize,
      utilizationPercent: 0,
    };
  }

  async enqueue(item: T): Promise<boolean> {
    // Si un consommateur attend, livrer directement
    if (this.waitingConsumers.length > 0) {
      const consumer = this.waitingConsumers.shift()!;
      consumer(item);
      this.metrics.enqueued++;
      return true;
    }

    // Si la queue n'est pas pleine, ajouter
    if (this.queue.length < this.maxSize) {
      this.queue.push(item);
      this.metrics.enqueued++;
      this.updateUtilization();
      return true;
    }

    // Queue pleine — appliquer la strategie
    switch (this.strategy) {
      case 'drop-newest':
        // Jeter le nouvel element
        this.metrics.dropped++;
        return false;

      case 'drop-oldest':
        // Jeter le plus ancien, ajouter le nouveau
        this.queue.shift();
        this.queue.push(item);
        this.metrics.dropped++;
        this.metrics.enqueued++;
        return true;

      case 'reject':
        // Rejeter avec une erreur
        this.metrics.rejected++;
        throw new BackpressureError(
          `Queue pleine (${this.maxSize} elements). Strategie: reject.`
        );

      case 'block':
        // Bloquer le producteur jusqu'a ce qu'il y ait de la place
        return new Promise<boolean>((resolve) => {
          this.waitingProducers.push((accepted) => {
            if (accepted) {
              this.queue.push(item);
              this.metrics.enqueued++;
              this.updateUtilization();
            }
            resolve(accepted);
          });
        });

      default:
        return false;
    }
  }

  async dequeue(): Promise<T> {
    // Si des elements sont disponibles
    if (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.metrics.dequeued++;
      this.updateUtilization();

      // Debloquer un producteur en attente
      if (this.waitingProducers.length > 0) {
        const producer = this.waitingProducers.shift()!;
        producer(true);
      }

      return item;
    }

    // Queue vide — attendre un element
    return new Promise<T>((resolve) => {
      this.waitingConsumers.push(resolve);
    });
  }

  getMetrics(): BackpressureMetrics {
    return { ...this.metrics, currentSize: this.queue.length };
  }

  private updateUtilization(): void {
    this.metrics.currentSize = this.queue.length;
    this.metrics.utilizationPercent = Math.round(
      (this.queue.length / this.maxSize) * 100
    );
  }
}

class BackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackpressureError';
  }
}

// Demonstration avec un producteur rapide et un consommateur lent
async function backpressureDemo(): Promise<void> {
  const queue = new BoundedQueue<string>(5, 'drop-oldest');

  // Producteur : 10 msg/sec
  let produced = 0;
  const producerInterval = setInterval(() => {
    const msg = `msg-${produced++}`;
    queue.enqueue(msg).then((accepted) => {
      if (!accepted) console.log(`DROPPED: ${msg}`);
    });
  }, 100);

  // Consommateur : 2 msg/sec
  const consumerInterval = setInterval(async () => {
    const item = await queue.dequeue();
    console.log(`Consumed: ${item}`, queue.getMetrics());
  }, 500);

  // Arreter apres 5 secondes
  setTimeout(() => {
    clearInterval(producerInterval);
    clearInterval(consumerInterval);
    console.log('Final metrics:', queue.getMetrics());
  }, 5000);
}
```

---

## Degradation gracieuse

Quand un service est en panne, au lieu de retourner une erreur, on peut retourner une réponse degradee mais utile.

```typescript
interface ProductInfo {
  id: string;
  name: string;
  price: number;
  reviews: Array<{ score: number; text: string }>;
  recommendations: string[];
  realTimeStock: number;
}

class GracefulDegradationService {
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private featureFlags: Map<string, boolean> = new Map([
    ['reviews_enabled', true],
    ['recommendations_enabled', true],
    ['realtime_stock_enabled', true],
  ]);

  async getProductPage(productId: string): Promise<Partial<ProductInfo>> {
    // Le produit de base est critique — pas de degradation possible
    const product = await this.getProduct(productId);

    const result: Partial<ProductInfo> = {
      id: product.id,
      name: product.name,
      price: product.price,
    };

    // Reviews : non critique, degradation possible
    if (this.featureFlags.get('reviews_enabled')) {
      try {
        result.reviews = await this.withFallback(
          () => this.fetchReviews(productId),
          () => this.getCachedReviews(productId),
          []  // dernier recours : liste vide
        );
      } catch {
        result.reviews = [];
      }
    }

    // Recommendations : non critique, degradation possible
    if (this.featureFlags.get('recommendations_enabled')) {
      try {
        result.recommendations = await this.withFallback(
          () => this.fetchRecommendations(productId),
          () => this.getCachedRecommendations(productId),
          ['best-seller-1', 'best-seller-2'] // fallback statique
        );
      } catch {
        result.recommendations = [];
      }
    }

    // Stock en temps reel : degradation vers "En stock"
    if (this.featureFlags.get('realtime_stock_enabled')) {
      try {
        result.realTimeStock = await this.withTimeout(
          this.fetchStock(productId),
          2000
        );
      } catch {
        // En cas d'echec, on ne montre pas le stock exact
        result.realTimeStock = -1; // -1 = "Verifier la disponibilite"
      }
    }

    return result;
  }

  private async withFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    defaultValue: T
  ): Promise<T> {
    try {
      return await primary();
    } catch {
      try {
        return await fallback();
      } catch {
        return defaultValue;
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout apres ${ms}ms`)), ms)
      ),
    ]);
  }

  // Feature flag pour activer/desactiver dynamiquement des fonctionnalites
  setFeatureFlag(flag: string, enabled: boolean): void {
    this.featureFlags.set(flag, enabled);
    console.log(
      JSON.stringify({
        event: 'feature_flag_changed',
        flag,
        enabled,
        timestamp: new Date().toISOString(),
      })
    );
  }

  private async getProduct(
    _id: string
  ): Promise<{ id: string; name: string; price: number }> {
    return { id: _id, name: 'Produit exemple', price: 29.99 };
  }
  private async fetchReviews(
    _id: string
  ): Promise<Array<{ score: number; text: string }>> {
    throw new Error('Review service unavailable');
  }
  private async getCachedReviews(
    _id: string
  ): Promise<Array<{ score: number; text: string }>> {
    const cached = this.cache.get(`reviews:${_id}`);
    if (cached) return cached.data as Array<{ score: number; text: string }>;
    throw new Error('No cached reviews');
  }
  private async fetchRecommendations(_id: string): Promise<string[]> {
    throw new Error('Recommendation service unavailable');
  }
  private async getCachedRecommendations(_id: string): Promise<string[]> {
    return ['cached-rec-1', 'cached-rec-2'];
  }
  private async fetchStock(_id: string): Promise<number> {
    return 42;
  }
}
```

:::warning Regles de degradation
- **Définir a l'avance** quelles fonctionnalites sont critiques vs non critiques
- **Tester la degradation** regulierement — ne pas attendre une vraie panne pour découvrir les bugs du mode degrade
- **Monitorer les degradations** — une degradation prolongee est un signal d'alerte
- **Communiquer avec l'utilisateur** — afficher un message du type "certaines fonctionnalites sont temporairement indisponibles"
:::

---

## Combiner les patterns : defense en profondeur

```
┌──────────────────────────────────────────────────────────────┐
│       DEFENSE EN PROFONDEUR — PATTERNS COMBINES              │
│                                                              │
│  Requete entrante                                            │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐                                             │
│  │   TIMEOUT   │  → Limite le temps d'attente                │
│  │   (5 sec)   │                                             │
│  └──────┬──────┘                                             │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  BULKHEAD   │  → Isole les ressources par dependance      │
│  │  (10 slots) │                                             │
│  └──────┬──────┘                                             │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  CIRCUIT    │  → Coupe le flux si trop d'erreurs          │
│  │  BREAKER    │                                             │
│  └──────┬──────┘                                             │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   RETRY     │  → Reessaye en cas d'erreur transitoire     │
│  │  (3 max)    │                                             │
│  └──────┬──────┘                                             │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  SERVICE    │  → Appel reel au service distant             │
│  │  DISTANT    │                                             │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Composition de patterns de resilience
class ResilientClient {
  private circuitBreaker: CircuitBreaker;
  private bulkhead: Bulkhead;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config: {
    serviceName: string;
    maxConcurrent: number;
    timeoutMs: number;
    maxRetries: number;
    failureThreshold: number;
    circuitTimeoutMs: number;
  }) {
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: config.failureThreshold,
      timeoutMs: config.circuitTimeoutMs,
    });

    this.bulkhead = new Bulkhead(
      config.serviceName,
      config.maxConcurrent,
      config.timeoutMs
    );

    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
  }

  async call<T>(operation: () => Promise<T>, fallback?: () => T): Promise<T> {
    // Couche 1 : Timeout global
    return this.withTimeout(
      // Couche 2 : Bulkhead (isolation)
      this.bulkhead.execute(() =>
        // Couche 3 : Circuit breaker
        this.circuitBreaker.execute(() =>
          // Couche 4 : Retry
          this.withRetry(operation)
        )
      ),
      this.timeoutMs,
      fallback
    );
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= this.maxRetries) throw error;
      // Backoff exponentiel
      const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.withRetry(operation, attempt + 1);
    }
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    fallback?: () => T
  ): Promise<T> {
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), ms)
        ),
      ]);
    } catch (error) {
      if (fallback) return fallback();
      throw error;
    }
  }
}

// Utilisation
const client = new ResilientClient({
  serviceName: 'payment-api',
  maxConcurrent: 10,
  timeoutMs: 5000,
  maxRetries: 2,
  failureThreshold: 5,
  circuitTimeoutMs: 30_000,
});

// Appel resilient avec fallback
// const result = await client.call(
//   () => fetch('http://payment-api/charge').then((r) => r.json()),
//   () => ({ status: 'pending', message: 'Payment will be processed later' })
// );
```

---

## Résumé

| Pattern | Objectif | Mécanisme |
|---------|----------|-----------|
| **Circuit Breaker** | Éviter d'appeler un service en panne | Machine a états (Closed/Open/Half-Open) |
| **Bulkhead** | Isoler les ressources par dépendance | Semaphore limitant la concurrence |
| **Backpressure** | Gérer la surcharge producteur/consommateur | Bounded queue avec stratégies |
| **Degradation gracieuse** | Fournir une réponse utile même degradee | Fallbacks, cache, feature flags |
| **Defense en profondeur** | Combiner plusieurs patterns | Timeout + Bulkhead + CB + Retry |

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [15 - Failure Modes](./15-failure-modes.md) | [17 - Rate Limiting & Load Shedding](./17-rate-limiting.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 16 circuit breaker](../screencasts/screencast-16-circuit-breaker.md)
2. **Lab** : [lab-16-circuit-breaker](../labs/lab-16-circuit-breaker/README)
3. **Visualisation** : [Circuit Breaker](../visualizations/circuit-breaker.html)
4. **Quiz** : [quiz 16 circuit breaker](../quizzes/quiz-16-circuit-breaker.html)
:::
