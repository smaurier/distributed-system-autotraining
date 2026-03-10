# Screencast 03 — Premiers microservices en TypeScript

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/03-premiers-microservices-typescript.md`
- **Lab associe** : Lab 03
- **Prerequis** : Screencast 02

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Deux terminaux supplementaires pour lancer les microservices
- [ ] Aucun processus sur les ports 3001-3002
- [ ] Fichier `modules/03-premiers-microservices-typescript.md` ouvert

## Script

### [00:00-01:30] Introduction — Du monolithe aux microservices

> Dans les deux premiers screencasts, on a vu pourquoi les systemes distribues existent et comment fonctionne la communication reseau. Maintenant, on va construire nos deux premiers microservices avec Express et TypeScript. On va aussi poser les bases de tout systeme distribue serieux : le logging structure et les health checks.

**Action** : Ouvrir le module 03 et afficher le diagramme d'architecture cible.

```
┌──────────────┐         ┌──────────────┐
│ Order Service│────────►│ User Service │
│  :3001       │  HTTP   │  :3002       │
└──────────────┘         └──────────────┘
     │                        │
     ▼                        ▼
 /health                  /health
 /orders                  /users/:id
```

> On va creer un service de commandes et un service d'utilisateurs. Le service de commandes appellera le service d'utilisateurs pour valider qu'un client existe avant de creer une commande. C'est le pattern le plus basique en microservices.

### [01:30-05:00] Construire le User Service

> Commencons par le User Service. C'est un service Express minimal avec un endpoint REST et un health check.

**Action** : Creer le fichier `user-service.ts` et taper le code.

```typescript
import express from 'express';

// --- Structured logging ---
function log(level: string, message: string, meta: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'user-service',
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

// --- Donnees en memoire ---
const users = new Map<string, { id: string; name: string; email: string }>([
  ['user-1', { id: 'user-1', name: 'Alice Dupont', email: 'alice@example.com' }],
  ['user-2', { id: 'user-2', name: 'Bob Martin', email: 'bob@example.com' }],
]);

const app = express();
app.use(express.json());

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'user-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// --- GET /users/:id ---
app.get('/users/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) {
    log('warn', 'User not found', { userId: req.params.id });
    return res.status(404).json({ error: 'User not found' });
  }
  log('info', 'User fetched', { userId: user.id });
  res.json(user);
});

app.listen(3002, () => {
  log('info', 'User Service started', { port: 3002 });
});
```

> Trois choses a remarquer. D'abord, le logging structure : chaque log est un objet JSON avec un timestamp, un niveau, et le nom du service. En production, ca permet de filtrer et chercher dans des outils comme Elasticsearch ou Loki. Ensuite, le health check : un endpoint `/health` qui retourne le statut du service. Enfin, le endpoint REST classique avec gestion du 404.

**Action** : Lancer le User Service dans le premier terminal.

```bash
npx tsx user-service.ts
```

**Action** : Tester avec curl dans un autre terminal.

```bash
curl http://localhost:3002/health
curl http://localhost:3002/users/user-1
curl http://localhost:3002/users/user-999
```

### [05:00-09:30] Construire le Order Service avec appel inter-service

> Maintenant, le Order Service. Il va appeler le User Service pour valider l'utilisateur avant de creer une commande. C'est la premiere communication inter-service du cours.

**Action** : Creer le fichier `order-service.ts`.

```typescript
import express from 'express';

function log(level: string, message: string, meta: Record<string, unknown> = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'order-service',
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
}

const orders = new Map<string, { id: string; userId: string; product: string; total: number }>();

// --- Client HTTP pour appeler le User Service ---
async function getUser(userId: string): Promise<{ id: string; name: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`http://localhost:3002/users/${userId}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      log('warn', 'User service returned error', { userId, status: response.status });
      return null;
    }
    return response.json();
  } catch (err) {
    clearTimeout(timeout);
    log('error', 'User service call failed', { userId, error: String(err) });
    return null;
  }
}

const app = express();
app.use(express.json());

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'order-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// --- POST /orders ---
app.post('/orders', async (req, res) => {
  const { userId, product, total } = req.body;

  // Valider l'utilisateur via le User Service
  const user = await getUser(userId);
  if (!user) {
    log('warn', 'Order rejected: user not found', { userId });
    return res.status(400).json({ error: 'Invalid user' });
  }

  const order = {
    id: `order-${Date.now()}`,
    userId,
    product,
    total,
  };
  orders.set(order.id, order);

  log('info', 'Order created', { orderId: order.id, userId, total });
  res.status(201).json(order);
});

// --- GET /orders/:id ---
app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

app.listen(3001, () => {
  log('info', 'Order Service started', { port: 3001 });
});
```

> L'appel inter-service est dans la fonction `getUser`. Remarquez les precautions : un timeout de 3 secondes avec AbortController, la gestion du cas ou le service repond une erreur, et la gestion du cas ou le service ne repond pas du tout. C'est exactement ce qu'on a appris au screencast 02.

**Action** : Lancer le Order Service dans le deuxieme terminal.

```bash
npx tsx order-service.ts
```

**Action** : Tester la creation d'une commande.

```bash
# Commande valide
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1", "product": "TypeScript Book", "total": 29.99}'

# Commande avec utilisateur invalide
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-999", "product": "Ghost Book", "total": 0}'
```

### [09:30-12:30] Observer le logging structure

> Regardons maintenant les logs des deux services. Grace au format JSON, chaque ligne contient toute l'information necessaire pour le debugging.

**Action** : Montrer les logs dans les deux terminaux side-by-side.

```typescript
// Ce que vous voyez dans le terminal du User Service :
{"timestamp":"2025-01-15T10:00:01.234Z","level":"info","service":"user-service","message":"User fetched","userId":"user-1"}

// Et dans le terminal du Order Service :
{"timestamp":"2025-01-15T10:00:01.230Z","level":"info","service":"order-service","message":"Order created","orderId":"order-1705312801234","userId":"user-1","total":29.99}
```

> En production, ces logs JSON sont envoyes a un collecteur central. On peut alors chercher "tous les logs pour user-1 sur les 5 dernieres minutes" a travers tous les services. Sans logging structure, c'est quasiment impossible.

**Action** : Arreter le User Service et retenter une commande pour montrer la gestion d'erreur.

```bash
# Arreter le User Service (Ctrl+C dans son terminal)

# Tenter une commande — le Order Service gere l'erreur
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-1", "product": "Book", "total": 19.99}'
```

> Voyez : le Order Service ne crashe pas quand le User Service est down. Il retourne une erreur propre. C'est la resilience de base.

### [12:30-15:30] Health checks et monitoring

> Les health checks sont le minimum vital pour operer des microservices. Kubernetes, Docker Compose, et les load balancers utilisent ces endpoints pour savoir si un service est vivant.

**Action** : Ameliorer le health check avec des verifications de dependances.

```typescript
// Health check avance avec verification des dependances
app.get('/health', async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number }> = {};

  // Verifier le User Service
  const start = performance.now();
  try {
    const response = await fetch('http://localhost:3002/health', {
      signal: AbortSignal.timeout(2000),
    });
    checks['user-service'] = {
      status: response.ok ? 'healthy' : 'degraded',
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    checks['user-service'] = {
      status: 'unhealthy',
      latencyMs: Math.round(performance.now() - start),
    };
  }

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    service: 'order-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    dependencies: checks,
  });
});
```

> Trois niveaux de health check. Le liveness probe : "est-ce que le processus repond ?" — un simple 200 suffit. Le readiness probe : "est-ce que le service est pret a recevoir du trafic ?" — il verifie les dependances. Et le startup probe : "est-ce que le service a fini de demarrer ?" — utile pour les services lents a initialiser.

**Action** : Tester le health check avance avec et sans le User Service.

### [15:30-17:30] Recapitulatif

> Recapitulons ce qu'on a construit. Deux microservices Express en TypeScript, avec du logging structure JSON, des health checks, et un appel inter-service avec timeout. C'est une base solide et realiste.

**Action** : Afficher le schema recapitulatif.

```
CE QU'ON A CONSTRUIT :
1. User Service (:3002) — donnees utilisateur, health check
2. Order Service (:3001) — creation de commandes, appel inter-service
3. Logging structure — JSON avec timestamp, service, niveau
4. Health checks — liveness + readiness avec verification de dependances
5. Resilience de base — timeout, gestion d'erreur sur appels inter-service

PROCHAINE ETAPE :
→ Screencast 04 : Serialisation, validation avec Zod, et contrats API
```

> Dans le prochain screencast, on va s'attaquer a un probleme insidieux : la serialisation. JSON a l'air simple, mais il cache des pieges qui causent des bugs en production. On verra comment Zod nous protege. A bientot !

## Points d'attention pour l'enregistrement
- Lancer le User Service AVANT le Order Service pour que l'appel inter-service fonctionne
- Montrer clairement les deux terminaux side-by-side pour les logs
- Prendre le temps de commenter la fonction `getUser` et ses protections
- Bien montrer le comportement quand le User Service est arrete (resilience)
- Les health checks sont visuellement simples mais conceptuellement importants — ne pas les survoler
- Verifier que les ports 3001 et 3002 sont libres avant de demarrer
