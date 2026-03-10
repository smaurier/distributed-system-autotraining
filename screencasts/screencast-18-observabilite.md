# Screencast 18 — Observabilite Distribuee

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/18-observabilite-distribuee.md`
- **Lab associe** : Lab 18
- **Prerequis** : Screencast 17

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/18-observabilite-distribuee.md` ouvert
- [ ] Trois terminaux (trois microservices)
- [ ] Aucun processus sur les ports 3001-3003

## Script

### [00:00-01:30] Introduction — Logs, Metrics, Traces

> En distribue, le debugging change radicalement. Un monolithe a un seul processus, un seul log, un seul stack trace. Avec 10 microservices, un bug peut traverser 5 services, 3 queues, et 2 bases de donnees. L'observabilite repose sur trois piliers : les logs (que s'est-il passe ?), les metriques (quelle est la sante du systeme ?), et les traces (quel chemin a pris cette requete ?).

**Action** : Ouvrir le module 18 et afficher le schema des trois piliers.

```
             OBSERVABILITE
         ┌───────┼───────┐
         │       │       │
       LOGS   METRICS  TRACES
    Que s'est  Combien?  Ou est passee
    -il passe? Quelle    cette requete?
               sante?
    Texte/JSON  Chiffres  Graphe de spans
    ELK Stack   Prom/     Jaeger/Zipkin
    Loki        Grafana
```

### [01:30-05:00] Correlation IDs — Tracer un flux de bout en bout

> Le correlation ID est l'identifiant unique qui relie tous les logs, metriques et traces d'une meme requete a travers tous les services. Sans lui, debugger en distribue est comme chercher une aiguille dans une botte de foin.

**Action** : Creer un fichier `observability.ts`.

```typescript
import { randomUUID } from 'node:crypto';

// --- Structured Logger avec correlation ---
interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  service: string;
  correlationId: string;
  message: string;
  [key: string]: unknown;
}

class StructuredLogger {
  constructor(private service: string) {}

  private log(level: LogEntry['level'], correlationId: string, message: string, meta: Record<string, unknown> = {}): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      correlationId,
      message,
      ...meta,
    };
    console.log(JSON.stringify(entry));
  }

  info(correlationId: string, message: string, meta?: Record<string, unknown>): void {
    this.log('info', correlationId, message, meta);
  }

  warn(correlationId: string, message: string, meta?: Record<string, unknown>): void {
    this.log('warn', correlationId, message, meta);
  }

  error(correlationId: string, message: string, meta?: Record<string, unknown>): void {
    this.log('error', correlationId, message, meta);
  }
}

// --- Middleware Express pour propager le correlation ID ---
function correlationMiddleware(serviceName: string) {
  const logger = new StructuredLogger(serviceName);

  return (req: any, res: any, next: any) => {
    // Recuperer ou generer le correlation ID
    const correlationId = req.headers['x-correlation-id'] ?? randomUUID();

    // Attacher au contexte de la requete
    req.correlationId = correlationId;
    req.logger = logger;

    // Propager dans la reponse
    res.set('X-Correlation-Id', correlationId);

    // Logger le debut de la requete
    const start = performance.now();
    logger.info(correlationId, 'Request started', {
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });

    // Logger la fin de la requete
    res.on('finish', () => {
      const duration = performance.now() - start;
      logger.info(correlationId, 'Request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(duration),
      });
    });

    next();
  };
}
```

**Action** : Montrer la propagation du correlation ID entre deux services.

```typescript
// Service A appelle Service B en propageant le correlation ID
async function callServiceB(correlationId: string, path: string): Promise<unknown> {
  const response = await fetch(`http://localhost:3002${path}`, {
    headers: {
      'X-Correlation-Id': correlationId,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(3000),
  });
  return response.json();
}
```

> Le correlation ID est genere a l'entree du systeme (API Gateway ou premier service contacte) et propage a travers chaque appel HTTP et chaque message queue. En production, tous les logs pour une meme requete sont retrouvables avec une recherche sur ce ID.

### [05:00-09:00] Health checks avances

> Au screencast 03, on a vu les health checks basiques. Implementons maintenant des health checks avances qui verifient les dependances en profondeur.

**Action** : Creer un health check composite.

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: string;
    latencyMs: number;
    message?: string;
  }>;
  uptime: number;
  version: string;
}

class HealthChecker {
  private checks: Map<string, () => Promise<{ healthy: boolean; message?: string }>> = new Map();

  register(name: string, check: () => Promise<{ healthy: boolean; message?: string }>): void {
    this.checks.set(name, check);
  }

  async run(): Promise<HealthCheckResult> {
    const results: HealthCheckResult['checks'] = {};
    let allHealthy = true;
    let anyHealthy = false;

    for (const [name, check] of this.checks) {
      const start = performance.now();
      try {
        const result = await check();
        const latency = performance.now() - start;
        results[name] = {
          status: result.healthy ? 'healthy' : 'unhealthy',
          latencyMs: Math.round(latency),
          message: result.message,
        };
        if (result.healthy) anyHealthy = true;
        else allHealthy = false;
      } catch (err) {
        results[name] = {
          status: 'unhealthy',
          latencyMs: Math.round(performance.now() - start),
          message: String(err),
        };
        allHealthy = false;
      }
    }

    return {
      status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
      checks: results,
      uptime: process.uptime(),
      version: '1.0.0',
    };
  }
}

// Utilisation
const healthChecker = new HealthChecker();

healthChecker.register('database', async () => {
  // Simuler un ping DB
  await new Promise(r => setTimeout(r, 5));
  return { healthy: true };
});

healthChecker.register('user-service', async () => {
  try {
    const resp = await fetch('http://localhost:3002/health', { signal: AbortSignal.timeout(2000) });
    return { healthy: resp.ok };
  } catch {
    return { healthy: false, message: 'Service unreachable' };
  }
});

healthChecker.register('message-broker', async () => {
  // Simuler un check du broker
  return { healthy: true, message: 'Connected, 0 messages pending' };
});
```

> Le health check retourne trois etats : healthy (tout va bien), degraded (certaines dependances sont down mais le service fonctionne partiellement), et unhealthy (le service ne peut pas fonctionner). Kubernetes utilise ces informations pour le routing et le redemarrage automatique.

### [09:00-13:00] RED Metrics — Rate, Errors, Duration

> Les RED metrics sont le minimum vital pour monitorer un microservice. Rate : combien de requetes par seconde. Errors : quel pourcentage d'erreurs. Duration : combien de temps durent les requetes.

**Action** : Implementer un collecteur de metriques RED.

```typescript
class REDMetrics {
  private requests: { timestamp: number; statusCode: number; durationMs: number }[] = [];
  private windowMs = 60_000; // Fenetre de 1 minute

  record(statusCode: number, durationMs: number): void {
    this.requests.push({ timestamp: Date.now(), statusCode, durationMs });
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    this.requests = this.requests.filter(r => r.timestamp > cutoff);
  }

  getMetrics(): {
    rate: number;
    errorRate: number;
    duration: { p50: number; p95: number; p99: number; avg: number };
    total: number;
    errors: number;
  } {
    this.cleanup();
    const total = this.requests.length;
    if (total === 0) return { rate: 0, errorRate: 0, duration: { p50: 0, p95: 0, p99: 0, avg: 0 }, total: 0, errors: 0 };

    const errors = this.requests.filter(r => r.statusCode >= 500).length;
    const durations = this.requests.map(r => r.durationMs).sort((a, b) => a - b);

    const percentile = (p: number) => durations[Math.floor(durations.length * p / 100)] ?? 0;

    return {
      rate: total / (this.windowMs / 1000),  // req/s
      errorRate: (errors / total) * 100,
      duration: {
        p50: percentile(50),
        p95: percentile(95),
        p99: percentile(99),
        avg: Math.round(durations.reduce((a, b) => a + b, 0) / total),
      },
      total,
      errors,
    };
  }

  printDashboard(): void {
    const m = this.getMetrics();
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║         RED METRICS DASHBOARD        ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║ Rate:       ${m.rate.toFixed(1).padStart(8)} req/s       ║`);
    console.log(`║ Errors:     ${m.errorRate.toFixed(1).padStart(8)}%           ║`);
    console.log(`║ Duration:                            ║`);
    console.log(`║   P50:      ${String(m.duration.p50).padStart(8)}ms          ║`);
    console.log(`║   P95:      ${String(m.duration.p95).padStart(8)}ms          ║`);
    console.log(`║   P99:      ${String(m.duration.p99).padStart(8)}ms          ║`);
    console.log(`║   Avg:      ${String(m.duration.avg).padStart(8)}ms          ║`);
    console.log(`║ Total:      ${String(m.total).padStart(8)} requests    ║`);
    console.log('╚══════════════════════════════════════╝');
  }
}
```

**Action** : Generer du trafic et afficher le dashboard.

```typescript
const metrics = new REDMetrics();

// Simuler du trafic
for (let i = 0; i < 200; i++) {
  const statusCode = Math.random() < 0.05 ? 500 : 200; // 5% d'erreurs
  const durationMs = Math.round(10 + Math.random() * 90 + (Math.random() < 0.1 ? 500 : 0)); // P99 spike
  metrics.record(statusCode, durationMs);
}

metrics.printDashboard();
```

> Les RED metrics sont l'equivalent du tableau de bord de votre voiture. Le rate est la vitesse, le error rate est le temoin de panne, et la duration est le temps de reaction. Si l'un des trois devie de la norme, il y a un probleme.

### [13:00-16:00] Integrer les trois piliers dans Express

> Assemblons logging structure, health checks, et metriques dans un middleware Express complet.

**Action** : Montrer l'integration.

```typescript
import express from 'express';

const app = express();
const logger = new StructuredLogger('order-service');
const health = new HealthChecker();
const metrics = new REDMetrics();

// Middleware d'observabilite
app.use((req: any, res, next) => {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  req.correlationId = correlationId;
  res.set('X-Correlation-Id', correlationId);

  const start = performance.now();

  res.on('finish', () => {
    const duration = performance.now() - start;
    metrics.record(res.statusCode, Math.round(duration));
    logger.info(correlationId, 'Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(duration),
    });
  });

  next();
});

// Endpoints
app.get('/health', async (_req, res) => {
  const result = await health.run();
  res.status(result.status === 'unhealthy' ? 503 : 200).json(result);
});

app.get('/metrics', (_req, res) => {
  res.json(metrics.getMetrics());
});

app.get('/api/orders', (req: any, res) => {
  logger.info(req.correlationId, 'Fetching orders');
  res.json([{ id: 'order-1', total: 49.99 }]);
});
```

### [16:00-17:30] Recapitulatif

> Recapitulons. Le correlation ID relie les logs de tous les services pour une meme requete. Le structured logging en JSON permet la recherche et l'analyse. Les health checks composites detectent les degradations. Et les RED metrics donnent la sante du service en temps reel.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Correlation ID = propage dans headers HTTP et messages queue
2. Structured logging = JSON avec service, level, correlationId, timestamp
3. Health checks = healthy / degraded / unhealthy avec verification des dependances
4. RED Metrics = Rate (req/s) + Errors (%) + Duration (percentiles)
5. Les trois piliers ensemble = observabilite complete

PROCHAINE ETAPE :
→ Screencast 19 : Testing distribue
```

> Au prochain screencast, on va parler de testing en distribue : contract tests, chaos middleware, et property-based testing. A bientot !

## Points d'attention pour l'enregistrement
- Le correlation ID qui traverse les services est le concept cle — bien montrer la propagation
- Les logs JSON doivent etre lisibles dans le terminal — utiliser jq si disponible
- Le health check composite avec statut "degraded" est un detail important
- Le dashboard RED est visuellement impactant — le montrer avec des donnees realistes
- La distinction liveness/readiness doit etre mentionnee pour Kubernetes
- Garder le code lisible — ne pas surcharger les middlewares
