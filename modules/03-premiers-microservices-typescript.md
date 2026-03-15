# 03 — Premiers microservices en TypeScript (2 services Express)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 2/5        | 90 min        | [Lab 03](../labs/lab-03-microservices-express/) | [Quiz 03](../quizzes/quiz-03-microservices.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Définir ce qu'est un microservice et ses principes fondamentaux
- Comparer architecture monolithique et microservices avec des criteres objectifs
- Créer un service HTTP avec Express et TypeScript
- Implementer la communication service-a-service via HTTP
- Mettre en place du logging structure avec Pino
- Implementer des health checks (liveness et readiness)
- Dockeriser un microservice Node.js
- Identifier les erreurs courantes des débutants en microservices

---

## Qu'est-ce qu'un microservice ?

:::tip Definition
Un **microservice** est un service autonome qui implemente une seule capacité metier (single responsibility), deployable independamment, communiquant avec d'autres services via des APIs bien definies.
:::

### Principes fondamentaux

```
┌─────────────────────────────────────────────────────────────┐
│                  PRINCIPES MICROSERVICES                     │
│                                                             │
│  1. Responsabilite unique                                   │
│     → Un service = une capacite metier                      │
│                                                             │
│  2. Autonomie                                               │
│     → Base de donnees propre, deploiement independant       │
│                                                             │
│  3. Decouplage                                              │
│     → Communication via APIs, pas de memoire partagee       │
│                                                             │
│  4. Resilience                                              │
│     → La panne d'un service ne casse pas les autres         │
│                                                             │
│  5. Observabilite                                           │
│     → Logs structures, metriques, traces                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Monolithe vs Microservices

### Architecture monolithique

```
┌──────────────────────────────────────────┐
│              MONOLITHE                   │
│                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐│
│  │  Users   │ │  Orders  │ │Inventory ││
│  │  Module  │ │  Module  │ │  Module  ││
│  └────┬─────┘ └────┬─────┘ └────┬─────┘│
│       │            │            │       │
│  ┌────┴────────────┴────────────┴─────┐ │
│  │       Base de donnees unique       │ │
│  └────────────────────────────────────┘ │
│                                          │
│  UN seul processus, UN seul deploiement  │
└──────────────────────────────────────────┘
```

### Architecture microservices

```
┌──────────────────────────────────────────────────────────┐
│                    MICROSERVICES                          │
│                                                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐       │
│  │User Service│   │Order Serv. │   │Inventory S.│       │
│  │  :3001     │   │  :3002     │   │  :3003     │       │
│  │ ┌────────┐ │   │ ┌────────┐ │   │ ┌────────┐ │       │
│  │ │  DB 1  │ │   │ │  DB 2  │ │   │ │  DB 3  │ │       │
│  │ └────────┘ │   │ └────────┘ │   │ └────────┘ │       │
│  └────────────┘   └────────────┘   └────────────┘       │
│       ▲                ▲ │              ▲                │
│       │     HTTP       │ │   HTTP       │                │
│       └────────────────┘ └──────────────┘                │
│                                                          │
│  Processus INDEPENDANTS, deploiements INDEPENDANTS       │
└──────────────────────────────────────────────────────────┘
```

### Comparaison

| Critere | Monolithe | Microservices |
|---------|-----------|---------------|
| **Déploiement** | Tout ou rien | Service par service |
| **Scaling** | Tout le monolithe | Service par service |
| **Technologie** | Une seule stack | Polyglotte possible |
| **Complexite code** | Faible | Faible par service |
| **Complexite ops** | Faible | Elevee |
| **Communication** | Appels de fonctions | Réseau (HTTP, gRPC, events) |
| **Transactions** | ACID simple | Sagas, eventual consistency |
| **Debugging** | Stack trace unique | Traces distribuees |
| **Équipe** | 1 équipe | 1 équipe par service |

---

## Créer un service Express avec TypeScript

### Structure du projet

```
order-service/
├── src/
│   ├── index.ts          # Point d'entree
│   ├── routes/
│   │   ├── orders.ts     # Routes pour les commandes
│   │   └── health.ts     # Routes de health check
│   ├── services/
│   │   └── inventory-client.ts  # Client vers Inventory Service
│   └── middleware/
│       └── logging.ts    # Middleware de logging
├── package.json
├── tsconfig.json
└── Dockerfile
```

### Service 1 : Inventory Service (port 3001)

```typescript
// inventory-service/src/index.ts
import express from 'express';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
});

const app = express();
app.use(express.json());

// Base de donnees en memoire (pour la demo)
const inventory = new Map<string, { productId: string; name: string; stock: number }>([
  ['prod-001', { productId: 'prod-001', name: 'Clavier mecanique', stock: 50 }],
  ['prod-002', { productId: 'prod-002', name: 'Souris ergonomique', stock: 30 }],
  ['prod-003', { productId: 'prod-003', name: 'Ecran 27 pouces', stock: 10 }],
]);

// ── Routes metier ──────────────────────────────────
app.get('/products', (req, res) => {
  logger.info('Listing all products');
  res.json(Array.from(inventory.values()));
});

app.get('/products/:id', (req, res) => {
  const product = inventory.get(req.params.id);
  if (!product) {
    logger.warn({ productId: req.params.id }, 'Product not found');
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

app.post('/products/:id/reserve', (req, res) => {
  const { quantity } = req.body;
  const product = inventory.get(req.params.id);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  if (product.stock < quantity) {
    logger.warn({ productId: req.params.id, requested: quantity, available: product.stock },
      'Insufficient stock');
    return res.status(409).json({ error: 'Insufficient stock' });
  }

  product.stock -= quantity;
  logger.info({ productId: req.params.id, quantity, remainingStock: product.stock },
    'Stock reserved');
  res.json({ reserved: true, remainingStock: product.stock });
});

// ── Health checks ──────────────────────────────────
app.get('/health/live', (_req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', (_req, res) => {
  // Verifier que la "base de donnees" est accessible
  const isReady = inventory.size > 0;
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not ready',
    checks: { database: isReady ? 'ok' : 'unavailable' },
  });
});

// ── Demarrage ──────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001');
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Inventory Service started');
});
```

### Service 2 : Order Service (port 3002)

```typescript
// order-service/src/index.ts
import express from 'express';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty' }
    : undefined,
});

const app = express();
app.use(express.json());

// ── Configuration ──────────────────────────────────
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';

// Base de donnees en memoire
const orders = new Map<string, {
  id: string;
  productId: string;
  quantity: number;
  status: string;
  createdAt: string;
}>();

// ── Client vers Inventory Service ──────────────────
async function checkAndReserveStock(productId: string, quantity: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    // 1. Verifier le stock
    const checkResponse = await fetch(
      `${INVENTORY_SERVICE_URL}/products/${productId}`,
      { signal: controller.signal }
    );

    if (!checkResponse.ok) {
      return { success: false, error: 'Product not found in inventory' };
    }

    const product = await checkResponse.json() as { stock: number };
    if (product.stock < quantity) {
      return { success: false, error: `Insufficient stock: ${product.stock} available` };
    }

    // 2. Reserver le stock
    const reserveResponse = await fetch(
      `${INVENTORY_SERVICE_URL}/products/${productId}/reserve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
        signal: controller.signal,
      }
    );

    if (!reserveResponse.ok) {
      const error = await reserveResponse.json() as { error: string };
      return { success: false, error: error.error };
    }

    return { success: true };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: 'Inventory service timeout' };
    }
    return { success: false, error: `Inventory service error: ${err}` };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Routes metier ──────────────────────────────────
app.post('/orders', async (req, res) => {
  const { productId, quantity } = req.body;

  if (!productId || !quantity) {
    return res.status(400).json({ error: 'productId and quantity are required' });
  }

  logger.info({ productId, quantity }, 'Creating order');

  // Appel inter-service vers Inventory
  const reserveResult = await checkAndReserveStock(productId, quantity);

  if (!reserveResult.success) {
    logger.warn({ productId, quantity, error: reserveResult.error }, 'Order creation failed');
    return res.status(409).json({ error: reserveResult.error });
  }

  // Creer la commande
  const order = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId,
    quantity,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };

  orders.set(order.id, order);
  logger.info({ orderId: order.id }, 'Order created successfully');

  res.status(201).json(order);
});

app.get('/orders', (_req, res) => {
  res.json(Array.from(orders.values()));
});

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

// ── Health checks ──────────────────────────────────
app.get('/health/live', (_req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  // Verifier la connectivite avec Inventory Service
  try {
    const inventoryHealth = await fetch(`${INVENTORY_SERVICE_URL}/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    const isReady = inventoryHealth.ok;
    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'degraded',
      checks: {
        self: 'ok',
        inventoryService: isReady ? 'ok' : 'unavailable',
      },
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      checks: { self: 'ok', inventoryService: 'unavailable' },
    });
  }
});

// ── Demarrage ──────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3002');
app.listen(PORT, () => {
  logger.info({ port: PORT, inventoryServiceUrl: INVENTORY_SERVICE_URL }, 'Order Service started');
});
```

---

## Logging structure avec Pino

### Pourquoi le logging structure ?

```typescript
// ❌ Logs non structures — difficiles a parser et analyser
console.log('Order created for user 123, product ABC, quantity 5');
console.log('Error: connection refused to inventory service');

// ✅ Logs structures — JSON parsable, filtrable, aggregable
logger.info({
  event: 'order_created',
  userId: '123',
  productId: 'ABC',
  quantity: 5,
  orderId: 'order-789',
}, 'Order created');

// Sortie JSON :
// {"level":30,"time":1700000000000,"event":"order_created",
//  "userId":"123","productId":"ABC","quantity":5,
//  "orderId":"order-789","msg":"Order created"}
```

### Configuration Pino

```typescript
import pino from 'pino';

// Logger avec contexte de service
const logger = pino({
  name: 'order-service',
  level: process.env.LOG_LEVEL || 'info',
  // Ajouter des champs a chaque log
  base: {
    service: 'order-service',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  },
  // Serialiseurs personnalises
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

// Logger enfant avec contexte de requete
function createRequestLogger(requestId: string) {
  return logger.child({ requestId });
}

// Middleware Express pour le logging
function loggingMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const requestId = req.headers['x-request-id'] as string || crypto.randomUUID();
  const reqLogger = createRequestLogger(requestId);

  // Attacher le logger a la requete
  (req as any).log = reqLogger;
  res.setHeader('X-Request-ID', requestId);

  const start = performance.now();

  res.on('finish', () => {
    const duration = performance.now() - start;
    reqLogger.info({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: Math.round(duration * 100) / 100,
    }, 'Request completed');
  });

  next();
}
```

:::tip Niveaux de log
- **fatal** : L'application va s'arreter
- **error** : Erreur qui nécessité une intervention
- **warn** : Situation anormale mais gérée
- **info** : Événement metier important (création, suppression)
- **debug** : Information de debogage detaillee
- **trace** : Information très detaillee (contenu des requêtes)
:::

---

## Health Checks

### Liveness vs Readiness

```
┌─────────────────────────────────────────────────────────┐
│                   HEALTH CHECKS                         │
│                                                         │
│  /health/live (Liveness)                                │
│  → "Est-ce que le processus est vivant ?"               │
│  → Si NON : redemarrer le container                     │
│  → Verification : le serveur HTTP repond                │
│                                                         │
│  /health/ready (Readiness)                              │
│  → "Est-ce que le service peut traiter des requetes ?"  │
│  → Si NON : retirer du load balancer                    │
│  → Verification : DB connectee, dependances OK          │
└─────────────────────────────────────────────────────────┘
```

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: 'ok' | 'warning' | 'critical';
    latencyMs?: number;
    message?: string;
  }>;
  uptime: number;
  version: string;
}

async function performHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {};

  // Check 1 : Base de donnees
  const dbStart = performance.now();
  try {
    // await db.query('SELECT 1');
    checks.database = { status: 'ok', latencyMs: performance.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'critical', message: String(err) };
  }

  // Check 2 : Service dependant
  const depStart = performance.now();
  try {
    const res = await fetch('http://inventory-service:3001/health/live', {
      signal: AbortSignal.timeout(2000),
    });
    checks.inventoryService = {
      status: res.ok ? 'ok' : 'warning',
      latencyMs: performance.now() - depStart,
    };
  } catch {
    checks.inventoryService = { status: 'warning', message: 'Unreachable' };
  }

  // Statut global
  const allStatuses = Object.values(checks).map(c => c.status);
  const status = allStatuses.includes('critical') ? 'unhealthy'
    : allStatuses.includes('warning') ? 'degraded'
    : 'healthy';

  return {
    status,
    checks,
    uptime: process.uptime(),
    version: '1.0.0',
  };
}
```

---

## Dockeriser un microservice

### Dockerfile optimise

```dockerfile
# ── Build stage ──────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Installer les dependances d'abord (cache Docker)
COPY package*.json ./
RUN npm ci --only=production

# Copier le code source
COPY tsconfig.json ./
COPY src/ ./src/

# Compiler TypeScript
RUN npx tsc

# ── Production stage ─────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Utilisateur non-root pour la securite
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health/live || exit 1

CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  inventory-service:
    build:
      context: ./inventory-service
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - PORT=3001
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health/live"]
      interval: 10s
      timeout: 3s
      retries: 3

  order-service:
    build:
      context: ./order-service
      dockerfile: Dockerfile
    ports:
      - "3002:3002"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
      - PORT=3002
      - INVENTORY_SERVICE_URL=http://inventory-service:3001
    depends_on:
      inventory-service:
        condition: service_healthy
```

---

## Erreurs courantes des débutants

### 1. Distributed monolith

```typescript
// ❌ Le "distributed monolith" — tous les inconvenients, aucun avantage
// Services fortement couples qui partagent une base de donnees
class OrderService {
  async createOrder(data: any) {
    // Accede directement a la table users (couplage!)
    const user = await sharedDb.query('SELECT * FROM users WHERE id = $1', [data.userId]);
    // Accede directement a la table inventory (couplage!)
    await sharedDb.query('UPDATE inventory SET stock = stock - $1', [data.quantity]);
    // ...
  }
}
```

:::warning Piege du monolithe distribue
Si vos services partagent une base de donnees ou doivent etre déployés ensemble, vous avez un monolithe distribue — la pire des architectures.
:::

### 2. Communication synchrone en cascade

```typescript
// ❌ Chaine d'appels synchrones — fragile
// Order → Inventory → Pricing → Tax → Payment → Notification
// Si UN service est lent, TOUTE la chaine est lente

// ✅ Preferer la communication asynchrone pour les operations non critiques
// Order → Inventory (sync, critique)
// Order → Event Bus → [Notification, Analytics, Audit] (async)
```

### 3. Pas de timeouts

```typescript
// ❌ JAMAIS sans timeout
const response = await fetch('http://other-service/api/data');

// ✅ TOUJOURS avec timeout
const response = await fetch('http://other-service/api/data', {
  signal: AbortSignal.timeout(5000),
});
```

### 4. Ignorer les pannes partielles

```typescript
// ❌ Presumer que le service repond toujours
async function getOrderDetails(orderId: string) {
  const order = await fetch(`http://order-service/orders/${orderId}`).then(r => r.json());
  const user = await fetch(`http://user-service/users/${order.userId}`).then(r => r.json());
  return { ...order, user };
}

// ✅ Gerer la degradation gracieuse
async function getOrderDetailsSafe(orderId: string) {
  const order = await fetch(`http://order-service/orders/${orderId}`, {
    signal: AbortSignal.timeout(5000),
  }).then(r => r.json());

  let user = null;
  try {
    user = await fetch(`http://user-service/users/${order.userId}`, {
      signal: AbortSignal.timeout(3000),
    }).then(r => r.json());
  } catch {
    // Le service utilisateur est indisponible — on continue sans
    user = { id: order.userId, name: 'Unknown (service unavailable)' };
  }

  return { ...order, user };
}
```

---

## Récapitulatif

```
┌─────────────────────────────────────────────────────────┐
│               CE QU'IL FAUT RETENIR                     │
│                                                         │
│  1. Un microservice = une responsabilite                │
│  2. Communication via API, pas de DB partagee           │
│  3. Logs structures (Pino) = indispensables             │
│  4. Health checks (liveness + readiness)                │
│  5. Timeouts sur CHAQUE appel inter-service             │
│  6. Docker = deploiement reproductible                  │
│  7. Commencer simple, distribuer quand necessaire       │
└─────────────────────────────────────────────────────────┘
```

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [02 - Communication réseau fondamentale](./02-communication-reseau-fondamentale.md) | [04 - Serialisation & Contrats d'API](./04-serialisation-et-contrats-api.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 03 microservices](../screencasts/screencast-03-microservices.md)
2. **Lab** : [lab-03-microservices-express](../labs/lab-03-microservices-express/README)
3. **Quiz** : [quiz 03 microservices](../quizzes/quiz-03-microservices.html)
:::
