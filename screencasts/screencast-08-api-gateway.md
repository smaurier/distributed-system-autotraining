# Screencast 08 — API Gateway et BFF

## Informations
- **Duree estimee** : 12-15 min
- **Module** : `modules/08-api-gateway-et-bff.md`
- **Lab associe** : Lab 08
- **Prerequis** : Screencast 07

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/08-api-gateway-et-bff.md` ouvert
- [ ] Trois terminaux (gateway + deux services backend)
- [ ] Aucun processus sur les ports 3000-3003

## Script

### [00:00-01:30] Introduction — Pourquoi un API Gateway ?

> Avec plusieurs microservices, les clients (web, mobile) doivent gerer de multiples URLs, de multiples formats de reponse, et de multiples mecanismes d'authentification. L'API Gateway centralise tout derriere un point d'entree unique. Il route les requetes, agregge les reponses, gere l'auth, et applique le rate limiting.

**Action** : Ouvrir le module 08 et afficher le diagramme.

```
                    ┌─────────────────┐
  Clients ─────────►│   API GATEWAY   │
  (web, mobile,     │    :3000        │
   partenaires)     ├─────────────────┤
                    │ • Routing       │
                    │ • Auth          │
                    │ • Rate limiting │
                    │ • Aggregation   │
                    └──┬──────┬───────┘
                       │      │
              ┌────────┘      └────────┐
              ▼                        ▼
       ┌────────────┐          ┌────────────┐
       │User Service│          │Order Service│
       │  :3001     │          │  :3002      │
       └────────────┘          └────────────┘
```

### [01:30-05:00] Construire le gateway — Routing et proxy

> Commencons par le routing. Le gateway regarde le path de la requete et la redirige vers le bon service backend.

**Action** : Creer un fichier `api-gateway.ts`.

```typescript
import express from 'express';

const app = express();
app.use(express.json());

// --- Configuration des routes ---
interface RouteConfig {
  prefix: string;
  target: string;
  stripPrefix: boolean;
}

const routes: RouteConfig[] = [
  { prefix: '/api/users', target: 'http://localhost:3001', stripPrefix: false },
  { prefix: '/api/orders', target: 'http://localhost:3002', stripPrefix: false },
];

// --- Middleware de logging ---
app.use((req, _res, next) => {
  const start = performance.now();
  console.log(`[Gateway] ${req.method} ${req.path}`);
  _res.on('finish', () => {
    const duration = (performance.now() - start).toFixed(1);
    console.log(`[Gateway] ${req.method} ${req.path} → ${_res.statusCode} (${duration}ms)`);
  });
  next();
});

// --- Proxy generique ---
async function proxyRequest(
  req: express.Request,
  res: express.Response,
  targetUrl: string
): Promise<void> {
  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': req.headers['x-request-id'] as string ?? crypto.randomUUID(),
        'X-Forwarded-For': req.ip ?? 'unknown',
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(5000),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error(`[Gateway] Proxy error: ${err}`);
    res.status(502).json({ error: 'Bad Gateway', message: 'Backend service unavailable' });
  }
}

// --- Enregistrer les routes dynamiquement ---
for (const route of routes) {
  app.all(`${route.prefix}/*`, (req, res) => {
    const path = route.stripPrefix ? req.path.replace(route.prefix, '') : req.path;
    proxyRequest(req, res, `${route.target}${path}`);
  });
}

app.listen(3000, () => {
  console.log('[Gateway] API Gateway started on port 3000');
});
```

**Action** : Lancer les deux services backend et le gateway, puis tester le routing.

```bash
# Terminal 1 : User Service (simplifie)
# Terminal 2 : Order Service (simplifie)
# Terminal 3 : API Gateway
npx tsx api-gateway.ts

# Tester depuis un 4eme terminal
curl http://localhost:3000/api/users/user-1
curl http://localhost:3000/api/orders/order-1
```

### [05:00-08:00] Aggregation — Combiner les reponses

> L'aggregation est un des superpouvoirs du gateway. Au lieu de forcer le client a faire 3 requetes, le gateway en fait une seule et combine les resultats.

**Action** : Ajouter un endpoint d'aggregation.

```typescript
// --- Aggregation : GET /api/dashboard/:userId ---
app.get('/api/dashboard/:userId', async (req, res) => {
  const { userId } = req.params;
  const requestId = crypto.randomUUID();

  console.log(`[Gateway] Aggregating dashboard for ${userId} (${requestId})`);

  // Appels paralleles a plusieurs services
  const [userResult, ordersResult] = await Promise.allSettled([
    fetch(`http://localhost:3001/api/users/${userId}`, {
      headers: { 'X-Request-Id': requestId },
      signal: AbortSignal.timeout(3000),
    }).then(r => r.json()),

    fetch(`http://localhost:3002/api/orders?userId=${userId}`, {
      headers: { 'X-Request-Id': requestId },
      signal: AbortSignal.timeout(3000),
    }).then(r => r.json()),
  ]);

  // Construire la reponse agrege avec degradation gracieuse
  const dashboard: Record<string, unknown> = { requestId };

  if (userResult.status === 'fulfilled') {
    dashboard.user = userResult.value;
  } else {
    dashboard.user = null;
    dashboard.userError = 'User service unavailable';
  }

  if (ordersResult.status === 'fulfilled') {
    dashboard.orders = ordersResult.value;
  } else {
    dashboard.orders = [];
    dashboard.ordersError = 'Order service unavailable';
  }

  res.json(dashboard);
});
```

> Remarquez la degradation gracieuse : si le User Service est down, on retourne quand meme les commandes avec un message d'erreur pour l'utilisateur. `Promise.allSettled` est essentiel ici — on ne veut pas qu'un service en echec bloque tout le dashboard.

### [08:00-10:30] Auth propagation

> Le gateway est l'endroit ideal pour gerer l'authentification. Il verifie le token une seule fois, puis propage l'identite aux services backend.

**Action** : Ajouter le middleware d'authentification.

```typescript
// --- Middleware d'authentification ---
interface AuthUser {
  userId: string;
  role: string;
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  // En production : verifier le JWT avec une librairie comme jose
  // Ici on simule la verification
  try {
    const decoded = decodeSimpleToken(token);
    // Propager l'identite aux services backend via headers
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-role'] = decoded.role;
    console.log(`[Gateway] Authenticated: ${decoded.userId} (${decoded.role})`);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function decodeSimpleToken(token: string): AuthUser {
  // Simulation — en prod, utiliser JWT
  const decoded = Buffer.from(token, 'base64').toString();
  const [userId, role] = decoded.split(':');
  if (!userId || !role) throw new Error('Invalid token');
  return { userId, role };
}

// Appliquer a toutes les routes sauf /health
app.use('/api/*', authMiddleware);
```

> Le gateway verifie le token et injecte les headers `x-user-id` et `x-user-role`. Les services backend n'ont pas besoin de connaitre le mecanisme d'auth — ils font confiance aux headers injectes par le gateway. C'est le pattern "trust the gateway".

### [10:30-12:30] Rate limiting au niveau du gateway

> Le rate limiting protege les services backend contre les abus. Le gateway est l'endroit logique pour l'implementer.

**Action** : Ajouter un rate limiter simple.

```typescript
// --- Rate Limiter simple (token bucket) ---
class SimpleRateLimiter {
  private tokens: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  isAllowed(clientId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const bucket = this.tokens.get(clientId);

    if (!bucket || now > bucket.resetAt) {
      this.tokens.set(clientId, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }

    if (bucket.count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count++;
    return { allowed: true, remaining: this.maxRequests - bucket.count, resetAt: bucket.resetAt };
  }
}

const limiter = new SimpleRateLimiter(100, 60_000); // 100 req/min

app.use((req, res, next) => {
  const clientId = req.headers['x-user-id'] as string ?? req.ip ?? 'anonymous';
  const result = limiter.isAllowed(clientId);

  res.set('X-RateLimit-Limit', '100');
  res.set('X-RateLimit-Remaining', String(result.remaining));
  res.set('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    return res.status(429).json({ error: 'Too Many Requests', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) });
  }
  next();
});
```

> Le rate limiter utilise un token bucket simple. Les headers `X-RateLimit-*` informent le client de son quota restant. En production, on utiliserait Redis pour partager l'etat entre plusieurs instances du gateway.

### [12:30-14:00] Recapitulatif

> Recapitulons. L'API Gateway est le point d'entree unique. Il fait le routing vers les services backend, l'aggregation de reponses avec degradation gracieuse, la verification d'auth avec propagation par headers, et le rate limiting pour proteger le systeme.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Gateway = point d'entree unique (routing, auth, rate limiting)
2. Aggregation + Promise.allSettled = degradation gracieuse
3. Auth propagation = verifier une fois, propager par headers
4. Rate limiting = proteger les services backend contre les abus
5. Timeout sur chaque appel backend (AbortSignal.timeout)

PROCHAINE ETAPE :
→ Screencast 09 : Retries, timeouts avances, et idempotency
```

> Au prochain screencast, on va approfondir les retries avec backoff et jitter, et decouvrir l'idempotency — un concept indispensable pour les systemes distribues fiables. A bientot !

## Points d'attention pour l'enregistrement
- Lancer les services backend AVANT le gateway pour que le proxy fonctionne
- Montrer clairement le flux : client → gateway → backend → gateway → client
- L'aggregation avec degradation gracieuse est le moment fort — bien montrer le cas d'erreur
- Pour l'auth, utiliser un token base64 simple pour la demo (pas de JWT complexe)
- Les headers X-RateLimit-* sont visibles dans curl avec -i — les montrer
- Garder le code du gateway lisible — ne pas ajouter trop de features en une fois
