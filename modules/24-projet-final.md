# 24 — Projet Final : Plateforme E-Commerce Distribuee Resiliente

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 480 min (8h+) | [Lab 24](../labs/lab-24-projet-final/) | [Quiz 24](../quizzes/quiz-24-projet-final.html) |

## Objectifs pedagogiques

A la fin de ce projet, vous serez capable de :

- Concevoir et implementer une architecture microservices complete en TypeScript
- Appliquer le pattern Saga pour les transactions distribuees inter-services
- Implementer l'event sourcing pour reconstruire l'historique des commandes
- Utiliser le pattern Outbox pour garantir la coherence entre base de donnees et message broker
- Intégrer un circuit breaker sur les appels externes
- Implementer du rate limiting sur une API gateway
- Propager des correlation IDs a travers toute la chaine de services
- Mettre en place des health checks sur chaque service
- Garantir l'idempotence du traitement des paiements
- Implementer une degradation gracieuse quand des services sont indisponibles

---

## Vue d'ensemble du projet

Vous allez construire une **plateforme e-commerce distribuee** composee de 4 microservices coordonnes par une API gateway. Ce projet synthetise les concepts des modules 0 a 23.

```
┌──────────────────────────────────────────────────────────────────┐
│                   ARCHITECTURE GLOBALE                             │
│                                                                  │
│                        ┌─────────────┐                           │
│             ┌─────────►│   API       │◄──────────┐               │
│             │          │  Gateway    │           │               │
│   Clients   │          │ (rate limit,│           │               │
│   HTTP      │          │  auth,      │           │               │
│             │          │  corr. ID)  │           │               │
│             │          └──────┬──────┘           │               │
│             │                 │                  │               │
│             │    ┌────────────┼────────────┐     │               │
│             │    │            │            │     │               │
│             │    ▼            ▼            ▼     │               │
│         ┌───────────┐ ┌───────────┐ ┌───────────┐               │
│         │  Order    │ │  Payment  │ │ Inventory │               │
│         │  Service  │ │  Service  │ │  Service  │               │
│         │           │ │           │ │           │               │
│         │ • Saga    │ │ • Idemp.  │ │ • Stock   │               │
│         │ • Event   │ │ • Circuit │ │ • Reserve │               │
│         │   Source  │ │   Breaker │ │ • Release │               │
│         │ • Outbox  │ │           │ │           │               │
│         └─────┬─────┘ └─────┬─────┘ └─────┬─────┘               │
│               │             │             │                      │
│               └──────┬──────┴──────┬──────┘                      │
│                      │             │                             │
│                      ▼             ▼                             │
│               ┌───────────┐ ┌───────────┐                       │
│               │  Message  │ │Notification│                       │
│               │  Broker   │ │  Service   │                       │
│               │ (events)  │ │ (email,    │                       │
│               │           │ │  webhook)  │                       │
│               └───────────┘ └───────────┘                       │
│                                                                  │
│  Communication :                                                 │
│  ─── HTTP sync (requete/reponse)                                │
│  ═══ Async events (message broker)                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Les 10 exigences

Ce projet couvre 10 exigences techniques, chacune liee à un ou plusieurs modules du cours.

### Exigence 1 : Communication service (sync + async)

**Modules associes** : 03, 04, 14

Les services communiquent par HTTP synchrone (pour les requêtes directes) et par événements asynchrones (pour la notification et le decoupling).

```typescript
// service-communication.ts — Interfaces de communication

interface SyncCall {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeout: number;
}

interface AsyncEvent {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  correlationId: string;
  payload: unknown;
}

// Client HTTP avec correlation ID et timeout
class ServiceClient {
  constructor(
    private baseUrl: string,
    private timeout: number = 5000,
  ) {}

  async call<T>(
    method: string,
    path: string,
    correlationId: string,
    body?: unknown,
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: message };
    }
  }
}

// Event bus simplifie (en memoire pour la simulation)
class EventBus {
  private handlers: Map<string, Array<(event: AsyncEvent) => Promise<void>>> = new Map();

  subscribe(eventType: string, handler: (event: AsyncEvent) => Promise<void>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  async publish(event: AsyncEvent): Promise<void> {
    console.log(`[EventBus] Publishing ${event.type} (corr: ${event.correlationId})`);
    const handlers = this.handlers.get(event.type) || [];
    await Promise.all(handlers.map(h => h(event)));
  }
}
```

### Exigence 2 : Saga pattern pour la création de commande

**Module associe** : 14

Le flux de commande est orchestre par une Saga qui coordonne les étapes entre services.

```
┌──────────────────────────────────────────────────────────────┐
│              SAGA : CREATION DE COMMANDE                      │
│                                                              │
│  Etape 1 : Reserver le stock (Inventory Service)              │
│       │                                                      │
│       ▼  OK                                                  │
│  Etape 2 : Effectuer le paiement (Payment Service)            │
│       │                                                      │
│       ▼  OK                                                  │
│  Etape 3 : Confirmer la commande (Order Service)              │
│       │                                                      │
│       ▼  OK                                                  │
│  Etape 4 : Notifier le client (Notification Service)          │
│                                                              │
│  COMPENSATION (si echec a l'etape 2) :                        │
│  ← Liberer le stock reserve (Inventory Service)              │
│  ← Marquer la commande comme echouee (Order Service)         │
│                                                              │
│  Etats de la Saga :                                           │
│  STARTED → STOCK_RESERVED → PAYMENT_DONE → CONFIRMED         │
│  STARTED → STOCK_RESERVED → PAYMENT_FAILED → COMPENSATING    │
│  → COMPENSATED                                                │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// order-saga.ts — Orchestrateur de Saga

type SagaStatus =
  | 'STARTED'
  | 'STOCK_RESERVED'
  | 'PAYMENT_DONE'
  | 'CONFIRMED'
  | 'PAYMENT_FAILED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'FAILED';

interface SagaState {
  orderId: string;
  correlationId: string;
  status: SagaStatus;
  steps: Array<{ step: string; status: string; timestamp: number }>;
}

class OrderSaga {
  private state: SagaState;

  constructor(orderId: string, correlationId: string) {
    this.state = {
      orderId,
      correlationId,
      status: 'STARTED',
      steps: [],
    };
  }

  private log(step: string, status: string): void {
    this.state.steps.push({ step, status, timestamp: Date.now() });
    console.log(
      `[Saga ${this.state.orderId}] ${step}: ${status} ` +
      `(corr: ${this.state.correlationId})`
    );
  }

  async execute(
    inventoryService: { reserve(orderId: string, items: string[]): Promise<boolean> },
    paymentService: { charge(orderId: string, amount: number): Promise<boolean> },
    notificationService: { notify(orderId: string, message: string): Promise<void> },
  ): Promise<SagaState> {
    // Etape 1 : Reserver le stock
    this.log('reserve_stock', 'attempting');
    const reserved = await inventoryService.reserve(this.state.orderId, ['item-1']);

    if (!reserved) {
      this.state.status = 'FAILED';
      this.log('reserve_stock', 'failed — no stock');
      return this.state;
    }

    this.state.status = 'STOCK_RESERVED';
    this.log('reserve_stock', 'success');

    // Etape 2 : Paiement
    this.log('payment', 'attempting');
    const paid = await paymentService.charge(this.state.orderId, 99.99);

    if (!paid) {
      this.state.status = 'PAYMENT_FAILED';
      this.log('payment', 'failed');

      // Compensation : liberer le stock
      this.state.status = 'COMPENSATING';
      this.log('compensate_stock', 'releasing');
      // inventoryService.release(this.state.orderId);
      this.state.status = 'COMPENSATED';
      this.log('compensate_stock', 'released');
      return this.state;
    }

    this.state.status = 'PAYMENT_DONE';
    this.log('payment', 'success');

    // Etape 3 : Confirmer
    this.state.status = 'CONFIRMED';
    this.log('confirm', 'order confirmed');

    // Etape 4 : Notifier
    await notificationService.notify(
      this.state.orderId,
      'Votre commande est confirmee!',
    );
    this.log('notification', 'sent');

    return this.state;
  }

  get currentState(): SagaState {
    return { ...this.state };
  }
}
```

### Exigence 3 : Event Sourcing pour l'historique des commandes

**Module associe** : 13

```typescript
// event-sourcing.ts — Event Sourcing pour les commandes

interface OrderEvent {
  eventId: string;
  orderId: string;
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

interface OrderProjection {
  orderId: string;
  status: string;
  items: string[];
  totalAmount: number;
  createdAt: number;
  updatedAt: number;
  history: string[];
}

class OrderEventStore {
  private events: OrderEvent[] = [];

  append(event: OrderEvent): void {
    this.events.push(event);
    console.log(`[EventStore] Appended: ${event.type} for ${event.orderId}`);
  }

  getEventsForOrder(orderId: string): OrderEvent[] {
    return this.events.filter(e => e.orderId === orderId);
  }

  // Reconstruire l'etat courant a partir des evenements
  project(orderId: string): OrderProjection {
    const events = this.getEventsForOrder(orderId);
    const state: OrderProjection = {
      orderId,
      status: 'unknown',
      items: [],
      totalAmount: 0,
      createdAt: 0,
      updatedAt: 0,
      history: [],
    };

    for (const event of events) {
      state.updatedAt = event.timestamp;
      state.history.push(`${event.type} at ${event.timestamp}`);

      switch (event.type) {
        case 'OrderCreated':
          state.status = 'created';
          state.items = event.data.items as string[];
          state.totalAmount = event.data.amount as number;
          state.createdAt = event.timestamp;
          break;
        case 'StockReserved':
          state.status = 'stock_reserved';
          break;
        case 'PaymentProcessed':
          state.status = 'paid';
          break;
        case 'OrderConfirmed':
          state.status = 'confirmed';
          break;
        case 'OrderShipped':
          state.status = 'shipped';
          break;
        case 'OrderDelivered':
          state.status = 'delivered';
          break;
        case 'OrderCancelled':
          state.status = 'cancelled';
          break;
      }
    }

    return state;
  }

  // Rejouer les evenements jusqu'a un certain point dans le temps
  projectAt(orderId: string, atTimestamp: number): OrderProjection {
    const events = this.getEventsForOrder(orderId)
      .filter(e => e.timestamp <= atTimestamp);
    // Reutiliser la meme logique avec les evenements filtres
    const store = new OrderEventStore();
    for (const e of events) store.append(e);
    return store.project(orderId);
  }
}
```

### Exigence 4 : Outbox Pattern pour la messagerie fiable

**Module associe** : 14

```
┌──────────────────────────────────────────────────────────────┐
│              OUTBOX PATTERN                                    │
│                                                              │
│  Probleme : comment garantir que la base ET le message        │
│  broker sont mis a jour de maniere atomique ?                 │
│                                                              │
│  Solution : ecrire l'evenement dans une table "outbox"        │
│  dans la MEME transaction que les donnees metier.             │
│                                                              │
│  ┌──────────────────────────────────┐                        │
│  │  BEGIN TRANSACTION               │                        │
│  │    INSERT INTO orders (...)      │                        │
│  │    INSERT INTO outbox (event...) │                        │
│  │  COMMIT                          │                        │
│  └──────────────────────────────────┘                        │
│                    │                                          │
│                    ▼                                          │
│  ┌──────────────────────────────────┐                        │
│  │  Outbox Poller (async)           │                        │
│  │  SELECT * FROM outbox            │                        │
│  │  WHERE published = false         │                        │
│  │  → publish to message broker     │                        │
│  │  → UPDATE outbox SET published=T │                        │
│  └──────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// outbox.ts — Implementation du pattern Outbox

interface OutboxEntry {
  id: string;
  eventType: string;
  payload: string;
  createdAt: number;
  published: boolean;
  publishedAt: number | null;
  retryCount: number;
}

class OutboxStore {
  private entries: OutboxEntry[] = [];

  // Ajouter une entree (dans la meme "transaction" que l'ecriture metier)
  add(eventType: string, payload: unknown): string {
    const id = `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.entries.push({
      id,
      eventType,
      payload: JSON.stringify(payload),
      createdAt: Date.now(),
      published: false,
      publishedAt: null,
      retryCount: 0,
    });
    return id;
  }

  // Recuperer les entrees non publiees
  getUnpublished(limit: number = 10): OutboxEntry[] {
    return this.entries
      .filter(e => !e.published)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  // Marquer comme publiee
  markPublished(id: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (entry) {
      entry.published = true;
      entry.publishedAt = Date.now();
    }
  }

  // Incrementer le compteur de retry
  incrementRetry(id: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (entry) entry.retryCount++;
  }
}

class OutboxPoller {
  constructor(
    private store: OutboxStore,
    private eventBus: EventBus,
    private pollIntervalMs: number = 1000,
  ) {}

  async poll(): Promise<number> {
    const entries = this.store.getUnpublished(10);
    let published = 0;

    for (const entry of entries) {
      try {
        await this.eventBus.publish({
          id: entry.id,
          type: entry.eventType,
          source: 'outbox-poller',
          timestamp: entry.createdAt,
          correlationId: entry.id,
          payload: JSON.parse(entry.payload),
        });
        this.store.markPublished(entry.id);
        published++;
        console.log(`[Outbox] Published: ${entry.id} (${entry.eventType})`);
      } catch (error) {
        this.store.incrementRetry(entry.id);
        console.log(`[Outbox] Failed to publish: ${entry.id}, retry #${entry.retryCount + 1}`);
      }
    }

    return published;
  }
}
```

### Exigence 5 : Circuit Breaker sur les appels externes

**Module associe** : 06

```typescript
// circuit-breaker.ts — Circuit Breaker pour le Payment Service

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private readonly halfOpenMaxAttempts: number;

  constructor(options: {
    failureThreshold: number;
    recoveryTimeoutMs: number;
    halfOpenMaxAttempts: number;
  }) {
    this.failureThreshold = options.failureThreshold;
    this.recoveryTimeout = options.recoveryTimeoutMs;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('[CircuitBreaker] OPEN → HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN — request rejected');
      }
    }

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
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        console.log('[CircuitBreaker] HALF_OPEN → CLOSED');
      }
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.log('[CircuitBreaker] HALF_OPEN → OPEN');
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log('[CircuitBreaker] CLOSED → OPEN');
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }
}
```

### Exigence 6 : Rate Limiting sur l'API Gateway

**Module associe** : 19

```typescript
// rate-limiter.ts — Token Bucket Rate Limiter

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRatePerSecond: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRatePerSecond,
    );
    this.lastRefill = now;
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  get availableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
```

### Exigence 7 : Correlation IDs

**Module associe** : 17

```typescript
// correlation.ts — Propagation de Correlation IDs

import { randomUUID } from 'node:crypto';

class CorrelationContext {
  private static current: Map<string, string> = new Map();

  static generate(): string {
    return randomUUID();
  }

  static set(correlationId: string): void {
    this.current.set('correlationId', correlationId);
  }

  static get(): string {
    return this.current.get('correlationId') || this.generate();
  }

  // Middleware Express simplifie
  static middleware(req: any, _res: any, next: () => void): void {
    const correlationId =
      req.headers['x-correlation-id'] || CorrelationContext.generate();
    req.correlationId = correlationId;
    CorrelationContext.set(correlationId);
    console.log(`[Correlation] Request ${req.method} ${req.url} → ${correlationId}`);
    next();
  }
}
```

#### AsyncLocalStorage pour la propagation de contexte

AsyncLocalStorage permet de propager un contexte (requestId, traceId, userId) a travers toute la chaine d'appels asynchrones sans passer explicitement l'objet request. C'est le pattern standard pour le distributed tracing et le logging structure dans les architectures microservices Node.js.

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  requestId: string;
  userId?: string;
  traceId: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// Middleware Express/Fastify
app.use((req, res, next) => {
  const ctx: RequestContext = {
    requestId: req.headers['x-request-id'] as string ?? randomUUID(),
    traceId: req.headers['x-trace-id'] as string ?? randomUUID(),
    userId: req.user?.id,
  };
  asyncLocalStorage.run(ctx, next);
});

// N'importe ou dans le code, sans passer req en parametre
function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}
```

:::tip
Combinez `AsyncLocalStorage` avec le `CorrelationContext` ci-dessus : le middleware injecte le correlation ID dans l'`AsyncLocalStorage`, et chaque service, logger ou appel HTTP downstream peut le récupérer via `getRequestContext()` sans jamais recevoir l'objet `req` en paramètre. C'est la base du structured logging et du distributed tracing dans Node.js.
:::

### Exigence 8 : Health Checks

**Module associe** : 09

```typescript
// health-check.ts — Health Checks pour chaque service

interface HealthStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  checks: Record<string, { status: string; latencyMs?: number; error?: string }>;
  uptime: number;
}

class HealthChecker {
  private startTime: number = Date.now();

  constructor(
    private serviceName: string,
    private checks: Map<string, () => Promise<boolean>>,
  ) {}

  async check(): Promise<HealthStatus> {
    const results: HealthStatus['checks'] = {};
    let allHealthy = true;
    let anyHealthy = false;

    for (const [name, checkFn] of this.checks) {
      const start = Date.now();
      try {
        const ok = await checkFn();
        results[name] = {
          status: ok ? 'pass' : 'fail',
          latencyMs: Date.now() - start,
        };
        if (ok) anyHealthy = true;
        else allHealthy = false;
      } catch (error) {
        allHealthy = false;
        results[name] = {
          status: 'fail',
          latencyMs: Date.now() - start,
          error: error instanceof Error ? error.message : 'Unknown',
        };
      }
    }

    return {
      service: this.serviceName,
      status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
      timestamp: Date.now(),
      checks: results,
      uptime: Date.now() - this.startTime,
    };
  }
}
```

### Exigence 9 : Paiement idempotent

**Module associe** : 07

```typescript
// idempotent-payment.ts — Traitement de paiement idempotent

interface PaymentRecord {
  idempotencyKey: string;
  orderId: string;
  amount: number;
  status: 'processing' | 'completed' | 'failed';
  result: unknown;
  createdAt: number;
}

class IdempotentPaymentService {
  private payments: Map<string, PaymentRecord> = new Map();

  async processPayment(
    idempotencyKey: string,
    orderId: string,
    amount: number,
  ): Promise<{ status: string; alreadyProcessed: boolean }> {
    // Verifier si ce paiement a deja ete traite
    const existing = this.payments.get(idempotencyKey);

    if (existing) {
      console.log(
        `[Payment] Idempotent hit: key=${idempotencyKey}, ` +
        `status=${existing.status}`
      );
      return { status: existing.status, alreadyProcessed: true };
    }

    // Marquer comme en cours de traitement
    const record: PaymentRecord = {
      idempotencyKey,
      orderId,
      amount,
      status: 'processing',
      result: null,
      createdAt: Date.now(),
    };
    this.payments.set(idempotencyKey, record);

    try {
      // Simuler l'appel au provider de paiement
      const success = Math.random() > 0.2; // 80% de succes
      record.status = success ? 'completed' : 'failed';
      record.result = success
        ? { transactionId: `txn-${Date.now()}` }
        : { error: 'Payment declined' };

      console.log(
        `[Payment] Processed: key=${idempotencyKey}, ` +
        `order=${orderId}, amount=${amount}, status=${record.status}`
      );
      return { status: record.status, alreadyProcessed: false };
    } catch (error) {
      record.status = 'failed';
      throw error;
    }
  }
}
```

### Exigence 10 : Degradation gracieuse

**Module associe** : 06, 09

```typescript
// graceful-degradation.ts — Degradation gracieuse

interface ServiceResponse<T> {
  data: T;
  source: 'live' | 'cache' | 'fallback';
  degraded: boolean;
}

class ResilientServiceCaller<T> {
  private cache: Map<string, { data: T; cachedAt: number }> = new Map();
  private cacheTTL: number;

  constructor(
    private serviceName: string,
    private fallbackValue: T,
    cacheTTLMs: number = 30000,
  ) {
    this.cacheTTL = cacheTTLMs;
  }

  async call(
    key: string,
    operation: () => Promise<T>,
  ): Promise<ServiceResponse<T>> {
    // Essayer l'appel principal
    try {
      const data = await operation();
      this.cache.set(key, { data, cachedAt: Date.now() });
      return { data, source: 'live', degraded: false };
    } catch (error) {
      console.log(
        `[${this.serviceName}] Appel echoue, tentative degradation gracieuse`
      );
    }

    // Essayer le cache
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.cacheTTL) {
      console.log(`[${this.serviceName}] Utilisation du cache (age: ${Date.now() - cached.cachedAt}ms)`);
      return { data: cached.data, source: 'cache', degraded: true };
    }

    // Valeur de repli
    console.log(`[${this.serviceName}] Utilisation de la valeur de repli`);
    return { data: this.fallbackValue, source: 'fallback', degraded: true };
  }
}
```

---

## Guide d'implementation phase par phase

### Phase 1 : Fondations (2h)

```
┌─────────────────────────────────────────────────────┐
│  Phase 1 : FONDATIONS                                │
│                                                     │
│  □ Creer la structure du projet                      │
│    ├── src/                                          │
│    │   ├── gateway/        API Gateway               │
│    │   ├── order-service/  Service Commandes         │
│    │   ├── payment-service/ Service Paiements        │
│    │   ├── inventory-service/ Service Inventaire     │
│    │   ├── notification-service/ Notifications       │
│    │   └── shared/         Code partage              │
│    │       ├── event-bus.ts                          │
│    │       ├── correlation.ts                        │
│    │       └── health.ts                             │
│    └── tests/                                        │
│                                                     │
│  □ Implementer l'EventBus (in-memory)                │
│  □ Implementer le CorrelationContext                  │
│  □ Implementer le HealthChecker                      │
│  □ Ecrire les types/interfaces partages              │
└─────────────────────────────────────────────────────┘
```

### Phase 2 : Services metier (2h)

```
┌─────────────────────────────────────────────────────┐
│  Phase 2 : SERVICES METIER                           │
│                                                     │
│  □ Inventory Service                                 │
│    - reserve(orderId, items) → boolean               │
│    - release(orderId) → void                         │
│    - getStock(productId) → number                    │
│                                                     │
│  □ Payment Service                                   │
│    - processPayment(key, orderId, amount) → result   │
│    - Circuit breaker sur le provider externe          │
│    - Idempotence via idempotency key                  │
│                                                     │
│  □ Notification Service                              │
│    - Ecoute les evenements OrderConfirmed             │
│    - Envoie des notifications (simule par console)    │
│                                                     │
│  □ Order Service                                     │
│    - createOrder() avec Event Sourcing                │
│    - Outbox pattern pour les evenements               │
│    - Saga orchestrator                                │
└─────────────────────────────────────────────────────┘
```

### Phase 3 : Intégration et résilience (2h)

```
┌─────────────────────────────────────────────────────┐
│  Phase 3 : INTEGRATION & RESILIENCE                  │
│                                                     │
│  □ API Gateway                                       │
│    - Rate limiting (token bucket)                    │
│    - Routing vers les services                       │
│    - Injection du correlation ID                     │
│    - Health check aggrege                            │
│                                                     │
│  □ Circuit Breaker sur Payment Service               │
│    - Seuil de 3 echecs                               │
│    - Recovery timeout de 10s                         │
│    - Half-open avec 2 tentatives                     │
│                                                     │
│  □ Degradation gracieuse                             │
│    - Cache sur Inventory queries                     │
│    - Fallback quand Notification est down            │
│    - Outbox replay si EventBus est down              │
│                                                     │
│  □ Wiring de la Saga complete                        │
│    - createOrder → reserve → pay → confirm → notify  │
│    - Compensation en cas d'echec                     │
└─────────────────────────────────────────────────────┘
```

### Phase 4 : Tests et validation (2h)

```
┌─────────────────────────────────────────────────────┐
│  Phase 4 : TESTS & VALIDATION                        │
│                                                     │
│  □ Tests unitaires                                   │
│    - Circuit breaker : transitions d'etat            │
│    - Rate limiter : respect du seuil                 │
│    - Event sourcing : projection correcte            │
│    - Idempotence : meme resultat pour meme cle       │
│                                                     │
│  □ Tests d'integration                               │
│    - Saga happy path                                 │
│    - Saga compensation path                          │
│    - Outbox polling et publication                   │
│    - Correlation ID bout en bout                     │
│                                                     │
│  □ Tests de resilience                               │
│    - Service en panne → degradation                  │
│    - Circuit breaker → rejet des requetes            │
│    - Rate limit depasse → 429 Too Many Requests      │
│    - Paiement duplique → idempotent                  │
│                                                     │
│  □ Validation des health checks                      │
│    - Tous les services healthy                       │
│    - Un service down → status degraded               │
└─────────────────────────────────────────────────────┘
```

---

## Stratégie de tests

```typescript
// test-scenario.ts — Scenario de test complet

async function testHappyPath(): Promise<void> {
  console.log('=== Test: Happy Path ===\n');

  // 1. Client envoie POST /orders
  // 2. API Gateway verifie le rate limit → OK
  // 3. API Gateway ajoute correlation ID
  // 4. Order Service cree la commande (event sourcing)
  // 5. Saga demarre: reserve stock → OK
  // 6. Saga: processus paiement (idempotent) → OK
  // 7. Saga: confirme commande
  // 8. Outbox: publie OrderConfirmed
  // 9. Notification Service recoit et notifie
  // 10. Health checks: tous les services healthy
  console.log('  1. POST /orders → API Gateway');
  console.log('  2. Rate limit check → PASS');
  console.log('  3. Correlation ID: abc-123');
  console.log('  4. Event: OrderCreated');
  console.log('  5. Saga step 1: StockReserved');
  console.log('  6. Saga step 2: PaymentProcessed (idempotent key: pay-abc-123)');
  console.log('  7. Saga step 3: OrderConfirmed');
  console.log('  8. Outbox → EventBus: OrderConfirmed');
  console.log('  9. Notification sent');
  console.log('  10. All health checks: healthy');
  console.log('\n  → Test PASSED');
}

async function testPaymentFailure(): Promise<void> {
  console.log('\n=== Test: Payment Failure + Compensation ===\n');

  console.log('  1. POST /orders → API Gateway');
  console.log('  2. Event: OrderCreated');
  console.log('  3. Saga step 1: StockReserved');
  console.log('  4. Saga step 2: PaymentFailed');
  console.log('  5. COMPENSATION: StockReleased');
  console.log('  6. Event: OrderCancelled');
  console.log('  7. Notification: order failed');
  console.log('\n  → Test PASSED (compensation correcte)');
}

async function testCircuitBreaker(): Promise<void> {
  console.log('\n=== Test: Circuit Breaker ===\n');

  console.log('  1. Payment call 1 → FAIL');
  console.log('  2. Payment call 2 → FAIL');
  console.log('  3. Payment call 3 → FAIL → Circuit OPEN');
  console.log('  4. Payment call 4 → REJECTED (circuit open)');
  console.log('  5. Wait recovery timeout...');
  console.log('  6. Payment call 5 → HALF_OPEN → SUCCESS');
  console.log('  7. Payment call 6 → SUCCESS → Circuit CLOSED');
  console.log('\n  → Test PASSED');
}

async function testIdempotency(): Promise<void> {
  console.log('\n=== Test: Idempotent Payment ===\n');

  console.log('  1. Process payment (key=pay-001) → completed');
  console.log('  2. Process payment (key=pay-001) → completed (already processed)');
  console.log('  3. Same result, no double charge');
  console.log('\n  → Test PASSED');
}
```

---

## Criteres d'évaluation

| Critere | Points | Description |
|---------|:------:|-------------|
| **Architecture** | /15 | Services bien decomposes, responsabilites claires |
| **Saga** | /15 | Orchestration et compensation fonctionnelles |
| **Event Sourcing** | /10 | Reconstruction de l'état à partir des événements |
| **Outbox Pattern** | /10 | Coherence base + events garantie |
| **Circuit Breaker** | /10 | Transitions d'état correctes |
| **Rate Limiting** | /5 | Token bucket fonctionnel |
| **Correlation IDs** | /5 | Tracabilite bout en bout |
| **Health Checks** | /5 | Status correct pour chaque service |
| **Idempotence** | /10 | Pas de double traitement |
| **Degradation** | /10 | Cache, fallback, résilience |
| **Tests** | /5 | Couverture des scenarios nominaux et d'erreur |
| **Total** | **/100** | |

:::tip Bonus
Les points bonus sont accordes pour les extensions (voir section suivante) et pour la qualite du code (typage strict, nommage clair, documentation inline).
:::

---

## Extensions (bonus)

Pour aller plus loin, vous pouvez intégrer des concepts des modules avances :

### Extension 1 : CRDTs pour l'inventaire (Module 23)

Utiliser un PN-Counter CRDT pour gérer l'inventaire de manière decentralisee, permettant aux repliques de fonctionner pendant une partition réseau.

### Extension 2 : Raft pour l'election de leader (Module 20)

Implementer une election de leader entre les instances du Order Service pour déterminer quelle instance orchestre les Sagas.

### Extension 3 : Stream processing pour les analytics (Module 22)

Ajouter un service d'analytics qui consomme les événements en stream, avec des fenetres temporelles pour calculer des metriques en temps réel (commandes par minute, revenu par heure).

### Extension 4 : Vector clocks pour le tracking (Module 21)

Utiliser des horloges vectorielles pour ordonner causalement les événements entre services et détecter les anomalies.

### Extension 5 : Chaos testing

Ajouter un module de chaos testing qui injecte aleatoirement des pannes (latence, erreurs, partitions) pour valider la résilience du système.

---

## Résumé

```
┌──────────────────────────────────────────────────────────┐
│         PROJET FINAL : CE QU'IL FAUT RETENIR              │
│                                                          │
│  Ce projet synthetise 24 modules en un seul systeme :     │
│                                                          │
│  Communication  → HTTP sync + event bus async             │
│  Transactions   → Saga (pas de 2PC distribue)             │
│  Historique     → Event sourcing (append-only log)        │
│  Coherence      → Outbox pattern (DB + events atomiques)  │
│  Resilience     → Circuit breaker + degradation           │
│  Protection     → Rate limiting (token bucket)            │
│  Tracabilite    → Correlation IDs bout en bout            │
│  Observabilite  → Health checks sur chaque service        │
│  Fiabilite      → Paiement idempotent                     │
│  Disponibilite  → Degradation gracieuse avec cache        │
│                                                          │
│  Architecture = compromis. Chaque pattern a un cout.      │
│  Choisissez les patterns adaptes a vos contraintes.       │
└──────────────────────────────────────────────────────────┘
```

---

## Ressources complementaires

- [Designing Data-Intensive Applications](https://dataintensive.net/) — Martin Kleppmann
- [Building Microservices, 2nd Edition](https://www.oreilly.com/library/view/building-microservices-2nd/9781492034018/) — Sam Newman
- [Microservices Patterns](https://microservices.io/patterns/) — Chris Richardson
- [Release It!, 2nd Edition](https://pragprog.com/titles/mnee2/release-it-second-edition/) — Michael Nygard

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [23 - CRDTs & Resolution de Conflits](./23-crdts-resolution-conflits.md) | -- (Fin du cours) |

| Lab | Quiz |
|:---:|:----:|
| [Lab 24](../labs/lab-24-projet-final/) | [Quiz 24](../quizzes/quiz-24-projet-final.html) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 24 projet final](../screencasts/screencast-24-projet-final.md)
2. **Lab** : [lab-24-projet-final](../labs/lab-24-projet-final/README)
3. **Quiz** : [quiz 24 projet final](../quizzes/quiz-24-projet-final.html)
:::

---

<!-- navigation-inter-cours -->

::: info Cours suivant
Bravo, tu as termine le cours **Systèmes Distribues** ! 
Le prochain cours du curriculum est **Observabilité & SRE**.

[Commencer Observabilité & SRE →](../../12-observability-sre/modules/00-prerequis-et-introduction.md)
:::
