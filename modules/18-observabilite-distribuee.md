# 18 — Observabilité des systèmes distribues

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 90 min        | [Lab 18](../labs/lab-18-observabilite-distribuee/) | [Quiz 18](../quizzes/quiz-18-observabilite.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer pourquoi l'observabilité est plus difficile dans un système distribue que dans un monolithe
- Générer et propager des correlation IDs a travers plusieurs services
- Implementer un middleware de correlation ID en TypeScript
- Structurer les logs pour les systèmes distribues (service name, correlation ID, trace ID)
- Implementer des health checks (liveness, readiness, startup) avec vérification des dépendances
- Appliquer la méthode RED (Rate, Errors, Duration) par service
- Concevoir un workflow de debugging pour les systèmes distribues
- Comprendre les concepts de distributed tracing (spans, traces, context propagation)

---

## Pourquoi l'observabilité est difficile en distribue

:::tip Observabilité vs Monitoring
- **Monitoring** : savoir quand quelque chose ne va pas (alertes predefinies)
- **Observabilité** : pouvoir comprendre **pourquoi** quelque chose ne va pas, même pour des problèmes jamais vus auparavant

L'observabilité repose sur 3 piliers : **logs**, **metriques** et **traces**.
:::

```
┌──────────────────────────────────────────────────────────────┐
│       OBSERVABILITE : MONOLITHE vs DISTRIBUE                 │
│                                                              │
│  Monolithe :                                                 │
│  ┌─────────────────────────────────────────────┐             │
│  │  1 processus, 1 fichier de log              │             │
│  │  Stack trace complete                        │             │
│  │  Ordre chronologique garanti                 │             │
│  │  Pas de latence reseau                       │             │
│  │  grep "ERROR" app.log → probleme trouve     │             │
│  └─────────────────────────────────────────────┘             │
│                                                              │
│  Distribue :                                                 │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐         │
│  │Log A │  │Log B │  │Log C │  │Log D │  │Log E │         │
│  │      │  │      │  │      │  │      │  │      │         │
│  │ t=1  │  │ t=3  │  │ t=2  │  │ t=5  │  │ t=4  │         │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘         │
│                                                              │
│  Problemes :                                                 │
│  • 5 fichiers de logs sur 5 machines differentes             │
│  • Pas d'ordre chronologique global (horloges desynchronisees)│
│  • Stack trace fragmentee entre les services                 │
│  • La cause peut etre dans un service, l'effet dans un autre │
│  • Pannes intermittentes (gray failures)                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Correlation IDs

Un correlation ID est un identifiant unique qui suit une requête a travers tous les services qu'elle traverse. C'est le fil d'Ariane du debugging distribue.

```
┌──────────────────────────────────────────────────────────────┐
│              CORRELATION ID — PROPAGATION                     │
│                                                              │
│  Client                                                      │
│    │                                                         │
│    │  X-Correlation-ID: abc-123-def                          │
│    ▼                                                         │
│  ┌──────────┐  X-Correlation-ID: abc-123-def  ┌──────────┐ │
│  │ API      │ ──────────────────────────────► │ Order    │ │
│  │ Gateway  │                                  │ Service  │ │
│  └──────────┘                                  └────┬─────┘ │
│                                                      │       │
│                    X-Correlation-ID: abc-123-def      │       │
│                                                      ▼       │
│                                               ┌──────────┐  │
│                                               │ Payment  │  │
│                                               │ Service  │  │
│                                               └────┬─────┘  │
│                                                    │         │
│                    X-Correlation-ID: abc-123-def    │         │
│                                                    ▼         │
│                                               ┌──────────┐  │
│                                               │ Email    │  │
│                                               │ Service  │  │
│                                               └──────────┘  │
│                                                              │
│  Chaque log de chaque service contient "abc-123-def"         │
│  → On peut reconstruire le parcours complet                  │
└──────────────────────────────────────────────────────────────┘
```

### Implementation avec middleware

```typescript
import { randomUUID } from 'node:crypto';

// Context de requete distribue
interface RequestContext {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  serviceName: string;
  startTime: number;
}

// Storage local au contexte de la requete (AsyncLocalStorage)
// En production, on utilise AsyncLocalStorage de Node.js
class ContextStore {
  private static storage: Map<string, RequestContext> = new Map();
  private static currentContextId: string | null = null;

  static set(context: RequestContext): void {
    this.storage.set(context.correlationId, context);
    this.currentContextId = context.correlationId;
  }

  static get(): RequestContext | null {
    if (!this.currentContextId) return null;
    return this.storage.get(this.currentContextId) || null;
  }

  static clear(): void {
    if (this.currentContextId) {
      this.storage.delete(this.currentContextId);
      this.currentContextId = null;
    }
  }
}

// Middleware qui extrait ou genere le correlation ID
function correlationIdMiddleware(serviceName: string) {
  return (
    req: { headers: Record<string, string | undefined> },
    res: { setHeader: (name: string, value: string) => void },
    next: () => void
  ) => {
    // Extraire ou generer le correlation ID
    const correlationId =
      req.headers['x-correlation-id'] || randomUUID();

    // Extraire ou generer le trace ID
    const traceId = req.headers['x-trace-id'] || randomUUID();

    // Generer un nouveau span ID pour ce service
    const spanId = randomUUID().slice(0, 16);

    // Le parent span est le span ID du service appelant
    const parentSpanId = req.headers['x-span-id'];

    const context: RequestContext = {
      correlationId,
      traceId,
      spanId,
      parentSpanId,
      serviceName,
      startTime: Date.now(),
    };

    ContextStore.set(context);

    // Ajouter les headers a la reponse
    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('X-Trace-ID', traceId);

    next();
  };
}

// Propagation du contexte lors d'appels inter-services
function getOutboundHeaders(): Record<string, string> {
  const context = ContextStore.get();
  if (!context) return {};

  return {
    'X-Correlation-ID': context.correlationId,
    'X-Trace-ID': context.traceId,
    'X-Span-ID': context.spanId, // Devient le parentSpanId du service appele
  };
}

// Appel inter-service avec propagation automatique
async function callService(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const propagatedHeaders = getOutboundHeaders();

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...propagatedHeaders,
    },
  });
}
```

---

## Structured logging

Les logs dans un système distribue doivent etre **structures** (JSON) et contenir les identifiants de contexte.

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

class DistributedLogger {
  private readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const context = ContextStore.get();

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.serviceName,
      correlationId: context?.correlationId,
      traceId: context?.traceId,
      spanId: context?.spanId,
      metadata: meta,
    };

    // En production : envoyer vers un aggregateur (ELK, Datadog, etc.)
    // Ici : ecrire en JSON sur stdout
    const output = JSON.stringify(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, error?: Error, meta?: Record<string, unknown>): void {
    this.log('error', message, {
      ...meta,
      error: error
        ? { name: error.name, message: error.message, stack: error.stack }
        : undefined,
    });
  }

  // Logger un appel inter-service avec la duree
  async logServiceCall<T>(
    targetService: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    this.info(`Appel sortant vers ${targetService}`, { operation });

    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`Reponse de ${targetService}`, {
        operation,
        duration,
        success: true,
      });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(
        `Echec de l'appel vers ${targetService}`,
        error as Error,
        { operation, duration, success: false }
      );
      throw error;
    }
  }
}

// Utilisation
const logger = new DistributedLogger('order-service');

// Log structuree dans le contexte d'une requete
// → {"timestamp":"2026-03-09T10:30:00.000Z","level":"info",
//    "message":"Commande creee","service":"order-service",
//    "correlationId":"abc-123","traceId":"trace-456",
//    "metadata":{"orderId":"order-789","amount":99.99}}
```

### Exemple de logs correles entre services

```
┌──────────────────────────────────────────────────────────────────────┐
│  LOGS CORRELES (filtres par correlationId = "abc-123")               │
│                                                                      │
│  10:30:00.001  api-gateway    INFO   Requete recue POST /orders      │
│  10:30:00.005  api-gateway    INFO   Routage vers order-service      │
│  10:30:00.012  order-service  INFO   Validation commande             │
│  10:30:00.015  order-service  INFO   Appel vers payment-service      │
│  10:30:00.045  payment-serv.  INFO   Paiement initie (99.99 EUR)     │
│  10:30:00.234  payment-serv.  INFO   Paiement confirme               │
│  10:30:00.236  order-service  INFO   Paiement recu, creation order   │
│  10:30:00.240  order-service  INFO   Appel vers email-service        │
│  10:30:00.300  email-service  INFO   Email de confirmation envoye    │
│  10:30:00.305  order-service  INFO   Commande finalisee              │
│  10:30:00.310  api-gateway    INFO   Reponse 201 (309ms)             │
│                                                                      │
│  → L'ensemble du flux est visible, dans l'ordre, grace au           │
│    correlation ID commun                                             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Distributed tracing

Le tracing distribue permet de visualiser le chemin complet d'une requête sous forme d'arbre de spans.

```
┌──────────────────────────────────────────────────────────────┐
│              TRACE — ARBRE DE SPANS                           │
│                                                              │
│  Trace ID: trace-456                                         │
│                                                              │
│  ┌─ api-gateway (span-001) ─────────────────────────── 309ms│
│  │                                                           │
│  │  ┌─ order-service (span-002) ──────────────────── 298ms  │
│  │  │                                                        │
│  │  │  ┌─ payment-service (span-003) ────────── 219ms       │
│  │  │  │                                                     │
│  │  │  │  ┌─ stripe-api (span-004) ──────── 189ms           │
│  │  │  │  └──────────────────────────────────────            │
│  │  │  └─────────────────────────────────────────            │
│  │  │                                                        │
│  │  │  ┌─ email-service (span-005) ──────── 60ms            │
│  │  │  │                                                     │
│  │  │  │  ┌─ smtp-server (span-006) ─── 55ms                │
│  │  │  │  └──────────────────────────────                    │
│  │  │  └─────────────────────────────────────                │
│  │  └────────────────────────────────────────────            │
│  └───────────────────────────────────────────────────        │
│                                                              │
│  On voit que 189ms sont passes dans l'API Stripe             │
│  → C'est le goulot d'etranglement                            │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Modele simplifie de span pour le tracing
interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error';
  tags: Record<string, string>;
  logs: Array<{ timestamp: number; message: string }>;
}

class SpanBuilder {
  private span: Span;

  constructor(
    operationName: string,
    serviceName: string,
    traceId?: string,
    parentSpanId?: string
  ) {
    this.span = {
      traceId: traceId || randomUUID(),
      spanId: randomUUID().slice(0, 16),
      parentSpanId,
      operationName,
      serviceName,
      startTime: Date.now(),
      status: 'ok',
      tags: {},
      logs: [],
    };
  }

  setTag(key: string, value: string): SpanBuilder {
    this.span.tags[key] = value;
    return this;
  }

  log(message: string): SpanBuilder {
    this.span.logs.push({ timestamp: Date.now(), message });
    return this;
  }

  setError(error: Error): SpanBuilder {
    this.span.status = 'error';
    this.span.tags['error.type'] = error.name;
    this.span.tags['error.message'] = error.message;
    return this;
  }

  finish(): Span {
    this.span.endTime = Date.now();
    this.span.duration = this.span.endTime - this.span.startTime;
    return this.span;
  }
}

// Collecteur de traces (en production : Jaeger, Zipkin, Datadog APM)
class TraceCollector {
  private spans: Span[] = [];

  report(span: Span): void {
    this.spans.push(span);
  }

  getTrace(traceId: string): Span[] {
    return this.spans
      .filter((s) => s.traceId === traceId)
      .sort((a, b) => a.startTime - b.startTime);
  }

  getSlowTraces(thresholdMs: number): Span[] {
    // Trouver les root spans (pas de parent) qui depassent le seuil
    return this.spans.filter(
      (s) => !s.parentSpanId && (s.duration || 0) > thresholdMs
    );
  }
}
```

---

## Health checks

### Liveness, readiness et startup

```
┌──────────────────────────────────────────────────────────────┐
│              TYPES DE HEALTH CHECKS                          │
│                                                              │
│  /health/live (Liveness)                                     │
│  "Le processus est-il vivant ?"                              │
│  → Si NON : redemarrer le container                          │
│  → Verification : le serveur HTTP repond                     │
│                                                              │
│  /health/ready (Readiness)                                   │
│  "Le service est-il pret a recevoir du trafic ?"             │
│  → Si NON : retirer du load balancer (pas de trafic)         │
│  → Verification : DB connectee, cache chaud, etc.            │
│                                                              │
│  /health/startup (Startup)                                   │
│  "Le service a-t-il fini de demarrer ?"                      │
│  → Si NON : attendre (ne pas redemarrer trop tot)            │
│  → Verification : migrations DB, chargement config           │
└──────────────────────────────────────────────────────────────┘
```

```typescript
type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface DependencyHealth {
  name: string;
  status: HealthStatus;
  latencyMs: number;
  details?: string;
}

interface HealthCheckResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  dependencies: DependencyHealth[];
}

class HealthChecker {
  private readonly serviceName: string;
  private readonly version: string;
  private readonly startTime: number;
  private startupComplete = false;
  private readonly dependencyChecks: Map<
    string,
    () => Promise<DependencyHealth>
  > = new Map();

  constructor(serviceName: string, version: string) {
    this.serviceName = serviceName;
    this.version = version;
    this.startTime = Date.now();
  }

  registerDependency(
    name: string,
    check: () => Promise<DependencyHealth>
  ): void {
    this.dependencyChecks.set(name, check);
  }

  markStartupComplete(): void {
    this.startupComplete = true;
  }

  // Liveness : le processus est-il vivant ?
  async liveness(): Promise<{ status: HealthStatus }> {
    // Simple — si cette fonction s'execute, le processus est vivant
    return { status: 'healthy' };
  }

  // Startup : le service a-t-il fini de demarrer ?
  async startup(): Promise<{ status: HealthStatus; details?: string }> {
    if (!this.startupComplete) {
      return {
        status: 'unhealthy',
        details: 'Service encore en cours de demarrage',
      };
    }
    return { status: 'healthy' };
  }

  // Readiness : le service est-il pret a recevoir du trafic ?
  // Inclut la verification des dependances (deep health check)
  async readiness(): Promise<HealthCheckResponse> {
    const dependencies: DependencyHealth[] = [];

    for (const [name, check] of this.dependencyChecks) {
      try {
        const start = Date.now();
        const result = await Promise.race([
          check(),
          new Promise<DependencyHealth>((_, reject) =>
            setTimeout(
              () => reject(new Error('Health check timeout')),
              5000
            )
          ),
        ]);
        dependencies.push(result);
      } catch (error) {
        dependencies.push({
          name,
          status: 'unhealthy',
          latencyMs: -1,
          details: (error as Error).message,
        });
      }
    }

    // Statut global : le pire statut parmi les dependances
    let overallStatus: HealthStatus = 'healthy';
    for (const dep of dependencies) {
      if (dep.status === 'unhealthy') {
        overallStatus = 'unhealthy';
        break;
      }
      if (dep.status === 'degraded') {
        overallStatus = 'degraded';
      }
    }

    return {
      status: overallStatus,
      service: this.serviceName,
      version: this.version,
      uptime: Date.now() - this.startTime,
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}

// Configuration des health checks
function setupHealthChecks(): HealthChecker {
  const checker = new HealthChecker('order-service', '2.1.0');

  // Verifier la connexion a la base de donnees
  checker.registerDependency('postgresql', async () => {
    const start = Date.now();
    try {
      // Simuler une requete de test
      // await db.query('SELECT 1');
      return {
        name: 'postgresql',
        status: 'healthy' as HealthStatus,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'postgresql',
        status: 'unhealthy' as HealthStatus,
        latencyMs: Date.now() - start,
        details: (error as Error).message,
      };
    }
  });

  // Verifier le cache Redis
  checker.registerDependency('redis', async () => {
    const start = Date.now();
    try {
      // await redis.ping();
      return {
        name: 'redis',
        status: 'healthy' as HealthStatus,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      // Redis est non critique → degraded au lieu de unhealthy
      return {
        name: 'redis',
        status: 'degraded' as HealthStatus,
        latencyMs: Date.now() - start,
        details: (error as Error).message,
      };
    }
  });

  // Verifier un service dependant
  checker.registerDependency('payment-service', async () => {
    const start = Date.now();
    try {
      const response = await fetch('http://payment-service:3000/health/live');
      return {
        name: 'payment-service',
        status: response.ok ? 'healthy' as HealthStatus : 'unhealthy' as HealthStatus,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        name: 'payment-service',
        status: 'unhealthy' as HealthStatus,
        latencyMs: Date.now() - start,
        details: (error as Error).message,
      };
    }
  });

  return checker;
}
```

:::warning Deep health checks : attention aux cascades
Un health check qui vérifié les dépendances peut lui-même echouer si une dépendance est lente. Regles :
- **Liveness** : JAMAIS de vérification de dépendance (sinon, un service sain est redemarre a cause d'une DB lente)
- **Readiness** : vérifier les dépendances critiques avec timeout court
- **Ne pas chainer** : le health check de A ne doit pas appeler le health check complet de B qui appelle C...
:::

---

## Méthode RED par service

La méthode RED donne 3 metriques essentielles pour chaque service :

```
┌──────────────────────────────────────────────────────────────┐
│              METHODE RED                                      │
│                                                              │
│  R — Rate     : nombre de requetes par seconde               │
│  E — Errors   : nombre d'erreurs par seconde                 │
│  D — Duration : distribution de la latence (P50, P95, P99)   │
│                                                              │
│  ┌──────────────────────────────────────────┐                │
│  │  order-service                           │                │
│  │  Rate:     150 req/s                     │                │
│  │  Errors:   2 err/s (1.3%)                │                │
│  │  Duration: P50=12ms P95=45ms P99=120ms   │                │
│  └──────────────────────────────────────────┘                │
│  ┌──────────────────────────────────────────┐                │
│  │  payment-service                         │                │
│  │  Rate:     80 req/s                      │                │
│  │  Errors:   0.5 err/s (0.6%)              │                │
│  │  Duration: P50=45ms P95=200ms P99=800ms  │                │
│  └──────────────────────────────────────────┘                │
│  ┌──────────────────────────────────────────┐                │
│  │  email-service                           │                │
│  │  Rate:     30 req/s                      │                │
│  │  Errors:   5 err/s (16.7%)  ← ALERTE    │                │
│  │  Duration: P50=100ms P95=2s P99=5s       │                │
│  └──────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

```typescript
class REDMetrics {
  private requests: number[] = [];    // timestamps des requetes
  private errors: number[] = [];      // timestamps des erreurs
  private durations: number[] = [];   // durees en ms
  private readonly windowMs = 60_000; // fenetre d'1 minute

  recordRequest(durationMs: number, isError: boolean): void {
    const now = Date.now();
    this.requests.push(now);
    this.durations.push(durationMs);
    if (isError) {
      this.errors.push(now);
    }
    this.pruneOld(now);
  }

  getMetrics(): {
    rate: number;         // req/sec
    errorRate: number;    // err/sec
    errorPercent: number; // pourcentage
    p50: number;
    p95: number;
    p99: number;
  } {
    this.pruneOld(Date.now());
    const windowSec = this.windowMs / 1000;

    const rate = this.requests.length / windowSec;
    const errorRate = this.errors.length / windowSec;
    const errorPercent =
      this.requests.length > 0
        ? (this.errors.length / this.requests.length) * 100
        : 0;

    const sorted = [...this.durations].sort((a, b) => a - b);
    const percentile = (p: number) => {
      if (sorted.length === 0) return 0;
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      rate: Math.round(rate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      errorPercent: Math.round(errorPercent * 10) / 10,
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99),
    };
  }

  private pruneOld(now: number): void {
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((t) => t > cutoff);
    this.errors = this.errors.filter((t) => t > cutoff);
    // Les durations sont alignees avec les requests
    while (this.durations.length > this.requests.length) {
      this.durations.shift();
    }
  }
}
```

---

## Debugging des systèmes distribues

```
┌──────────────────────────────────────────────────────────────┐
│       WORKFLOW D'INVESTIGATION DISTRIBUE                     │
│                                                              │
│  1. ALERTE : "Error rate > 5% sur order-service"             │
│     │                                                        │
│     ▼                                                        │
│  2. DASHBOARD : verifier RED metrics de order-service         │
│     → Rate normal, Errors en hausse, Duration P99 = 5s       │
│     │                                                        │
│     ▼                                                        │
│  3. LOGS : filtrer par level=error dans order-service         │
│     → "Timeout calling payment-service" (correlationId=xyz)  │
│     │                                                        │
│     ▼                                                        │
│  4. TRACE : chercher le correlationId xyz                    │
│     → payment-service repond en 10s (timeout a 5s)           │
│     │                                                        │
│     ▼                                                        │
│  5. METRIQUES : verifier RED de payment-service              │
│     → P99 = 12s ! CPU a 95%                                  │
│     │                                                        │
│     ▼                                                        │
│  6. CAUSE : deploiement recent de payment-service v2.3       │
│     → Regression de performance dans le nouveau code          │
│     │                                                        │
│     ▼                                                        │
│  7. ACTION : rollback de payment-service v2.3 → v2.2         │
│     → Metriques reviennent a la normale                      │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Outil de debugging distribue
class DistributedDebugger {
  private logger: DistributedLogger;
  private metrics: Map<string, REDMetrics>;

  constructor(serviceName: string) {
    this.logger = new DistributedLogger(serviceName);
    this.metrics = new Map();
  }

  // Wrapper pour capturer automatiquement les metriques et le contexte
  async wrapRequest<T>(
    operationName: string,
    handler: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();

    if (!this.metrics.has(operationName)) {
      this.metrics.set(operationName, new REDMetrics());
    }
    const red = this.metrics.get(operationName)!;

    this.logger.info(`Debut ${operationName}`);

    try {
      const result = await handler();
      const duration = Date.now() - start;

      red.recordRequest(duration, false);
      this.logger.info(`Fin ${operationName}`, { duration, success: true });

      return result;
    } catch (error) {
      const duration = Date.now() - start;

      red.recordRequest(duration, true);
      this.logger.error(`Echec ${operationName}`, error as Error, {
        duration,
        success: false,
      });

      throw error;
    }
  }

  getOperationMetrics(
    operationName: string
  ): ReturnType<REDMetrics['getMetrics']> | null {
    const red = this.metrics.get(operationName);
    return red ? red.getMetrics() : null;
  }

  getAllMetrics(): Record<string, ReturnType<REDMetrics['getMetrics']>> {
    const result: Record<string, ReturnType<REDMetrics['getMetrics']>> = {};
    for (const [name, red] of this.metrics) {
      result[name] = red.getMetrics();
    }
    return result;
  }
}
```

---

## Alerting sur les pannes distribuees

```typescript
interface AlertRule {
  name: string;
  condition: (metrics: ReturnType<REDMetrics['getMetrics']>) => boolean;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  cooldownMs: number; // ne pas re-alerter pendant ce delai
}

class AlertManager {
  private rules: AlertRule[] = [];
  private lastAlert: Map<string, number> = new Map();

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  evaluate(
    serviceName: string,
    metrics: ReturnType<REDMetrics['getMetrics']>
  ): Array<{ rule: string; severity: string; message: string }> {
    const alerts: Array<{ rule: string; severity: string; message: string }> = [];
    const now = Date.now();

    for (const rule of this.rules) {
      const key = `${serviceName}:${rule.name}`;
      const lastTime = this.lastAlert.get(key) || 0;

      if (now - lastTime < rule.cooldownMs) continue;

      if (rule.condition(metrics)) {
        this.lastAlert.set(key, now);
        alerts.push({
          rule: rule.name,
          severity: rule.severity,
          message: rule.message.replace('{service}', serviceName),
        });
      }
    }

    return alerts;
  }
}

// Regles d'alerte classiques
const alertManager = new AlertManager();

alertManager.addRule({
  name: 'high_error_rate',
  condition: (m) => m.errorPercent > 5,
  severity: 'critical',
  message: '{service}: taux d\'erreur superieur a 5%',
  cooldownMs: 300_000, // 5 minutes
});

alertManager.addRule({
  name: 'high_latency_p99',
  condition: (m) => m.p99 > 2000,
  severity: 'warning',
  message: '{service}: P99 latence superieure a 2s',
  cooldownMs: 600_000, // 10 minutes
});

alertManager.addRule({
  name: 'traffic_spike',
  condition: (m) => m.rate > 500,
  severity: 'info',
  message: '{service}: pic de trafic detecte (>500 req/s)',
  cooldownMs: 900_000, // 15 minutes
});
```

---

## Résumé

| Concept | Description | Outil |
|---------|------------|-------|
| **Correlation ID** | Identifiant unique propageant a travers les services | Header HTTP, middleware |
| **Structured logging** | Logs en JSON avec contexte distribue | Logger custom, ELK, Datadog |
| **Distributed tracing** | Arbre de spans visualisant le parcours d'une requête | Jaeger, Zipkin, Datadog APM |
| **Health checks** | Vérification de la sante du service et de ses dépendances | Endpoints HTTP, Kubernetes probes |
| **RED metrics** | Rate, Errors, Duration par service | Prometheus, Grafana |
| **Alerting** | Detection automatique des anomalies | PagerDuty, Opsgenie |

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [17 - Rate Limiting & Load Shedding](./17-rate-limiting.md) | [19 - Testing des systèmes distribues](./19-testing-distribue.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 18 observabilité](../screencasts/screencast-18-observabilite.md)
2. **Lab** : [lab-18-observabilité-distribuee](../labs/lab-18-observabilite-distribuee/README)
3. **Quiz** : [quiz 18 observabilité](../quizzes/quiz-18-observabilite.html)
:::
