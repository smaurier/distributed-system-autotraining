# 08 — API Gateway & BFF (routing, aggregation, auth propagation)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5        | 60 min        | [Lab 08](../labs/lab-08-api-gateway/exercise.ts) | [Quiz 08](../quizzes/quiz-08-api-gateway.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer le role d'une API Gateway et quand l'introduire dans une architecture
- Enumerer les responsabilites d'une gateway : routing, auth, rate limiting, aggregation, protocol translation
- Définir le pattern BFF (Backend for Frontend) et ses avantages
- Implementer une gateway avec Express et TypeScript (routing, reverse proxy)
- Agreger les réponses de plusieurs services en un seul appel
- Propager l'authentification a travers la gateway (JWT forwarding, token exchange)
- Injecter un correlation ID pour le tracing distribue
- Identifier les anti-patterns : logique metier dans la gateway, couplage excessif
- Intégrer un circuit breaker au niveau de la gateway

---

## 1. Le pattern API Gateway

### 1.1 Pourquoi une gateway ?

Sans gateway, chaque client doit connaître l'adresse de chaque microservice. Avec N services et M types de clients, on a N x M connexions a gérer.

```
SANS GATEWAY :                           AVEC GATEWAY :
===============                          ================

┌─────────┐ ┌─────────┐ ┌─────────┐    ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Web App │ │ Mobile  │ │  IoT    │    │ Web App │ │ Mobile  │ │  IoT    │
└────┬────┘ └────┬────┘ └────┬────┘    └────┬────┘ └────┬────┘ └────┬────┘
     │           │           │              │           │           │
     │    N x M connexions   │              └───────────┼───────────┘
     │           │           │                          │
┌────┴──┐ ┌─────┴──┐ ┌─────┴──┐                ┌──────┴──────┐
│ User  │ │ Order  │ │ Stock  │                │ API Gateway │
│Service│ │Service │ │Service │                └──────┬──────┘
└───────┘ └────────┘ └────────┘                       │
                                            ┌─────────┼─────────┐
                                            ▼         ▼         ▼
                                        ┌───────┐ ┌───────┐ ┌───────┐
                                        │ User  │ │ Order │ │ Stock │
                                        │Service│ │Service│ │Service│
                                        └───────┘ └───────┘ └───────┘

Problemes sans gateway :                 Avantages avec gateway :
• N x M connexions                      • Point d'entree unique
• Auth dupliquee dans chaque service    • Auth centralisee
• CORS a configurer partout             • CORS en un seul endroit
• Pas de rate limiting uniforme         • Rate limiting global
• Le client connait l'infra interne     • Abstraction de l'infra
```

### 1.2 Responsabilites de la gateway

```
┌───────────────────────────────────────────────────┐
│                   API GATEWAY                      │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │   Routing   │  │    Auth     │  │  Rate    │  │
│  │  /users →   │  │  JWT check  │  │ Limiting │  │
│  │  user-svc   │  │  token      │  │ 100 r/m  │  │
│  └─────────────┘  │  exchange   │  └──────────┘  │
│                   └─────────────┘                 │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │ Aggregation │  │  Protocol   │  │ Logging  │  │
│  │ combine     │  │ Translation │  │ Tracing  │  │
│  │ responses   │  │ REST→gRPC   │  │ Metrics  │  │
│  └─────────────┘  └─────────────┘  └──────────┘  │
│                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │
│  │ Correlation │  │   Circuit   │  │  Cache   │  │
│  │ ID inject   │  │  Breaker    │  │ Response │  │
│  └─────────────┘  └─────────────┘  └──────────┘  │
└───────────────────────────────────────────────────┘
```

---

## 2. BFF — Backend for Frontend

Le pattern BFF (Backend for Frontend) consiste a créer une gateway dediee à chaque type de client. Chaque BFF connait les besoins spécifiques de son client.

```
GATEWAY UNIQUE :                         PATTERN BFF :
=================                        ==============

Tous les clients passent               Chaque client a sa propre gateway
par la meme gateway
                                        ┌─────────┐    ┌───────────┐
┌─────────┐                             │ Web App │───►│ Web BFF   │──┐
│ Web App │──┐                          └─────────┘    └───────────┘  │
└─────────┘  │   ┌───────────┐                                        │
             ├──►│  Gateway  │──►       ┌─────────┐    ┌───────────┐  │
┌─────────┐  │   └───────────┘          │ Mobile  │───►│Mobile BFF │──┼──► Services
│ Mobile  │──┘                          └─────────┘    └───────────┘  │
└─────────┘                                                           │
                                        ┌─────────┐    ┌───────────┐  │
Probleme : la gateway doit              │  IoT    │───►│ IoT BFF   │──┘
satisfaire TOUS les clients             └─────────┘    └───────────┘

                                        Chaque BFF :
                                        • Adapte le format de reponse
                                        • Agrege differemment selon le client
                                        • Peut avoir son propre cache
```

```typescript
// Exemple : le Web BFF retourne plus de details que le Mobile BFF

// Web BFF : page produit complete
// GET /products/42
// → Appelle product-service, review-service, recommendation-service
// → Reponse : { product, reviews: [...], recommendations: [...] }

// Mobile BFF : version allegee
// GET /products/42
// → Appelle product-service uniquement
// → Reponse : { product: { name, price, imageUrl } }
// (pas de reviews ni recommendations pour economiser la bande passante)
```

:::tip Quand utiliser le BFF ?
Utilisez le BFF quand vos clients ont des besoins très différents (web riche vs mobile leger vs IoT minimal). Si tous les clients consomment les memes donnees, une seule gateway suffit.
:::

---

## 3. Implementation d'une gateway Express

### 3.1 Routing et reverse proxy

```typescript
// gateway.ts — API Gateway avec Express

import express, { type Request, type Response, type NextFunction } from 'express';

const app = express();
app.use(express.json());

// Configuration des services backend
interface ServiceConfig {
  name: string;
  baseUrl: string;
  healthPath: string;
}

const services: Record<string, ServiceConfig> = {
  users: { name: 'user-service', baseUrl: 'http://localhost:3001', healthPath: '/health' },
  orders: { name: 'order-service', baseUrl: 'http://localhost:3002', healthPath: '/health' },
  products: { name: 'product-service', baseUrl: 'http://localhost:3003', healthPath: '/health' },
};

// Middleware : Correlation ID
function correlationId(req: Request, _res: Response, next: NextFunction): void {
  const id = req.headers['x-correlation-id'] as string || crypto.randomUUID();
  req.headers['x-correlation-id'] = id;
  console.log(`[GATEWAY] ${req.method} ${req.path} | correlationId=${id}`);
  next();
}

app.use(correlationId);

// Reverse proxy generique
async function proxyRequest(
  serviceKey: string,
  path: string,
  req: Request,
  res: Response,
): Promise<void> {
  const service = services[serviceKey];
  if (!service) {
    res.status(502).json({ error: `Unknown service: ${serviceKey}` });
    return;
  }

  const targetUrl = `${service.baseUrl}${path}`;
  const correlationHeader = req.headers['x-correlation-id'] as string;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationHeader,
        'Authorization': req.headers.authorization || '',
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? JSON.stringify(req.body)
        : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      res.status(504).json({ error: 'Gateway timeout', service: serviceKey });
    } else {
      res.status(502).json({ error: 'Service unavailable', service: serviceKey });
    }
  }
}

// Routes : router vers les services backend
app.all('/api/users/*', (req, res) => {
  const path = req.path.replace('/api/users', '/users');
  proxyRequest('users', path, req, res);
});

app.all('/api/orders/*', (req, res) => {
  const path = req.path.replace('/api/orders', '/orders');
  proxyRequest('orders', path, req, res);
});

app.all('/api/products/*', (req, res) => {
  const path = req.path.replace('/api/products', '/products');
  proxyRequest('products', path, req, res);
});
```

### 3.2 Response aggregation

```typescript
// aggregation.ts — Agreger les reponses de plusieurs services

interface AggregatedOrderDetails {
  order: Record<string, unknown>;
  user: Record<string, unknown>;
  products: Record<string, unknown>[];
}

app.get('/api/order-details/:orderId', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const correlationId = req.headers['x-correlation-id'] as string;
  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
    'Authorization': req.headers.authorization || '',
  };

  try {
    // Etape 1 : Recuperer la commande
    const orderRes = await fetch(`${services.orders.baseUrl}/orders/${orderId}`, { headers });
    if (!orderRes.ok) {
      return res.status(orderRes.status).json({ error: 'Order not found' });
    }
    const order = await orderRes.json() as { userId: string; productIds: string[] };

    // Etape 2 : En parallele — user + produits
    const [userRes, ...productResults] = await Promise.all([
      fetch(`${services.users.baseUrl}/users/${order.userId}`, { headers }),
      ...order.productIds.map((pid: string) =>
        fetch(`${services.products.baseUrl}/products/${pid}`, { headers })
      ),
    ]);

    const user = userRes.ok ? await userRes.json() : { error: 'User unavailable' };
    const products = await Promise.all(
      productResults.map(async (r) => r.ok ? r.json() : { error: 'Product unavailable' }),
    );

    // Etape 3 : Combiner les resultats
    const result: AggregatedOrderDetails = { order, user, products };
    res.json(result);
  } catch {
    res.status(502).json({ error: 'Aggregation failed' });
  }
});
```

```
FLOW D'AGGREGATION :
=====================

Client ── GET /api/order-details/42 ──► Gateway
                                           │
                              1. GET /orders/42
                                           │
                                           ▼
                                     Order Service
                                     { userId: "u1", productIds: ["p1","p2"] }
                                           │
                              2. En parallele :
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         User Service  Product Svc  Product Svc
                         GET /users/u1 GET /prod/p1 GET /prod/p2
                              │            │            │
                              └────────────┼────────────┘
                                           │
                              3. Combiner les resultats
                                           │
Client ◄── { order, user, products } ──── Gateway
```

---

## 4. Auth propagation

### 4.1 JWT Forwarding

```typescript
// auth-middleware.ts — Verification et propagation du JWT

interface JwtPayload {
  sub: string;       // userId
  email: string;
  roles: string[];
  exp: number;       // expiration timestamp
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // Enlever "Bearer "

  try {
    // En production : verifier la signature avec la cle publique
    const payload = decodeJwt(token);

    if (payload.exp < Date.now() / 1000) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    // Attacher les infos user a la requete
    (req as any).user = payload;

    // Le header Authorization est PROPAGE tel quel aux services backend
    // Les services backend font confiance a la gateway pour la verification
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function decodeJwt(token: string): JwtPayload {
  // Simplifie — en production : utiliser jsonwebtoken ou jose
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  return payload;
}

// Appliquer le middleware aux routes protegees
app.use('/api/orders', authMiddleware);
app.use('/api/users', authMiddleware);
// Les routes publiques (ex: /api/products) ne passent pas par le middleware
```

```
AUTH FLOW A TRAVERS LA GATEWAY :
=================================

Client                   Gateway                   Service
  │                         │                         │
  │ GET /api/orders         │                         │
  │ Authorization: Bearer   │                         │
  │ eyJhbGc...              │                         │
  │────────────────────────►│                         │
  │                         │ 1. Verifier le JWT      │
  │                         │    (signature, expiry)  │
  │                         │                         │
  │                         │ 2. Extraire user info   │
  │                         │    {sub: "u42", ...}    │
  │                         │                         │
  │                         │ GET /orders             │
  │                         │ Authorization: Bearer   │
  │                         │ eyJhbGc...              │
  │                         │ X-User-Id: u42          │
  │                         │────────────────────────►│
  │                         │                         │
  │                         │◄────────────────────────│
  │◄────────────────────────│                         │
  │  200 OK [orders...]     │                         │
```

### 4.2 Correlation ID injection

```typescript
// correlation-id.ts — Tracer une requete a travers tous les services

function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generer ou propager le correlation ID
  const id = (req.headers['x-correlation-id'] as string) || crypto.randomUUID();
  req.headers['x-correlation-id'] = id;

  // L'inclure dans la reponse pour le debug cote client
  res.setHeader('X-Correlation-Id', id);

  // Timestamp d'entree pour mesurer la latence totale
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[TRACE] ${id} | ${req.method} ${req.path} | ${res.statusCode} | ${duration}ms`);
  });

  next();
}

// Resultat dans les logs :
// [TRACE] abc-123 | GET /api/order-details/42 | 200 | 145ms
// Service logs :
// [order-service] abc-123 | GET /orders/42 | 200 | 12ms
// [user-service]  abc-123 | GET /users/u1  | 200 | 8ms
// [product-svc]   abc-123 | GET /products/p1 | 200 | 5ms
```

---

## 5. Circuit breaker au niveau gateway

```typescript
// gateway-circuit-breaker.ts — Proteger la gateway contre les services defaillants

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuits = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30_000;

function getCircuit(serviceName: string): CircuitState {
  if (!circuits.has(serviceName)) {
    circuits.set(serviceName, { failures: 0, lastFailure: 0, state: 'closed' });
  }
  return circuits.get(serviceName)!;
}

async function proxyWithCircuitBreaker(
  serviceKey: string,
  path: string,
  req: Request,
  res: Response,
): Promise<void> {
  const circuit = getCircuit(serviceKey);

  // Circuit ouvert : rejeter immediatement
  if (circuit.state === 'open') {
    if (Date.now() - circuit.lastFailure > RESET_TIMEOUT_MS) {
      circuit.state = 'half-open';
      console.log(`[CIRCUIT] ${serviceKey}: open → half-open (tentative)`);
    } else {
      res.status(503).json({
        error: 'Service temporarily unavailable',
        service: serviceKey,
        retryAfter: Math.ceil((RESET_TIMEOUT_MS - (Date.now() - circuit.lastFailure)) / 1000),
      });
      return;
    }
  }

  try {
    await proxyRequest(serviceKey, path, req, res);

    // Succes : reset le circuit
    if (circuit.state === 'half-open') {
      console.log(`[CIRCUIT] ${serviceKey}: half-open → closed (retabli)`);
    }
    circuit.failures = 0;
    circuit.state = 'closed';
  } catch {
    circuit.failures++;
    circuit.lastFailure = Date.now();

    if (circuit.failures >= FAILURE_THRESHOLD) {
      circuit.state = 'open';
      console.log(`[CIRCUIT] ${serviceKey}: closed → open (${circuit.failures} echecs)`);
    }

    res.status(502).json({ error: 'Service error', service: serviceKey });
  }
}
```

---

## 6. Anti-patterns

:::warning Anti-pattern : logique metier dans la gateway
La gateway doit rester un **passe-plat intelligent**. Elle route, authentifie, agrege, mais ne prend jamais de decisions metier. Si vous calculez des prix ou validez des regles commerciales dans la gateway, vous creez un monolithe deguise.
:::

```
CE QUE LA GATEWAY DOIT FAIRE :          CE QUE LA GATEWAY NE DOIT PAS FAIRE :
===================================      ======================================

✓ Router vers le bon service            ✗ Calculer des prix ou des remises
✓ Verifier l'authentification           ✗ Valider des regles metier
✓ Rate limiting                         ✗ Acceder directement a la base de donnees
✓ Agreger des reponses                  ✗ Transformer la structure des donnees metier
✓ Injecter des headers (correlation)    ✗ Gerer des workflows (saga, compensation)
✓ Circuit breaker / retry               ✗ Stocker de l'etat metier
✓ Logger / tracer                       ✗ Contenir du code specifique a un domaine
```

---

## Points clés

1. **L'API Gateway** est le point d'entree unique pour tous les clients. Elle centralise le routing, l'auth, le rate limiting et l'observabilité.
2. **Le pattern BFF** créé une gateway par type de client (web, mobile, IoT) pour adapter les réponses aux besoins spécifiques de chacun.
3. **L'aggregation** combine les réponses de plusieurs services en un seul appel client, reduisant le nombre de requêtes réseau.
4. **L'auth propagation** (JWT forwarding) permet aux services backend de connaître l'identite de l'utilisateur sans re-authentifier.
5. **Le Correlation ID** est injecte par la gateway et propage a tous les services pour tracer une requête de bout en bout.
6. **Le circuit breaker** au niveau gateway protege le système quand un service backend est defaillant.
7. **La gateway ne doit contenir aucune logique metier** — elle reste un intermédiaire technique entre les clients et les services.

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [07 - Event-Driven Architecture](./07-event-driven-architecture.md) | [09 - Retries, Timeouts & Idempotency](./09-retries-timeouts-idempotency.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 08 api gateway](../screencasts/screencast-08-api-gateway.md)
2. **Lab** : [lab-08-api-gateway](../labs/lab-08-api-gateway/README)
3. **Quiz** : [quiz 08 api gateway](../quizzes/quiz-08-api-gateway.html)
:::
