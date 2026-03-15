# 05 — Communication synchrone avancee (REST maturity, gRPC, service discovery)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5        | 60 min        | [Lab 05](../labs/lab-05-communication-synchrone/exercise.ts) | [Quiz 05](../quizzes/quiz-05-communication-synchrone.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Decrire les 4 niveaux du modèle de maturite REST de Richardson (0 a 3)
- Implementer une API REST de niveau 2 avec Express et TypeScript
- Expliquer HATEOAS et son role dans une API auto-descriptive
- Comprendre le fonctionnement de gRPC, Protocol Buffers et les 4 types de streaming
- Modeliser des services et messages gRPC en TypeScript
- Comparer les patterns de service discovery : client-side, server-side, DNS, registry
- Implementer un registre de services simple en TypeScript
- Choisir une stratégie de load balancing adaptee a votre contexte
- Intégrer des health checks dans un système de service discovery

---

## 1. Modèle de maturite REST — Richardson

Leonard Richardson a propose un modèle a 4 niveaux pour évaluer la maturite d'une API REST. La plupart des APIs "REST" en production sont en realite au niveau 1 ou 2.

```
MODELE DE MATURITE DE RICHARDSON
====================================

Niveau 3 : Controles hypermedia (HATEOAS)
  ┌──────────────────────────────────────────────┐
  │ Liens dans les reponses pour guider le client │
  │ GET /orders/42 → { ..., _links: { pay: ... }}│
  └──────────────────────────────────────────────┘
         ▲
Niveau 2 : Verbes HTTP + codes de statut
  ┌──────────────────────────────────────────────┐
  │ GET pour lire, POST pour creer, 201/404/409  │
  │ DELETE /orders/42 → 204 No Content           │
  └──────────────────────────────────────────────┘
         ▲
Niveau 1 : Ressources individuelles
  ┌──────────────────────────────────────────────┐
  │ URIs distincts : /orders, /orders/42, /users │
  │ Mais tout passe par POST                     │
  └──────────────────────────────────────────────┘
         ▲
Niveau 0 : Le marais du POX (Plain Old XML/JSON)
  ┌──────────────────────────────────────────────┐
  │ Un seul endpoint : POST /api                 │
  │ Action encodee dans le body                  │
  └──────────────────────────────────────────────┘
```

### 1.1 Niveau 0 — Un seul endpoint

```typescript
// Niveau 0 : Tout passe par un seul endpoint
// Le serveur ne distingue pas les ressources
import express from 'express';

const app = express();
app.use(express.json());

// UN SEUL endpoint pour tout faire
app.post('/api', (req, res) => {
  const { action, payload } = req.body;

  switch (action) {
    case 'getOrder':
      // Chercher la commande...
      return res.json({ order: { id: payload.id, status: 'pending' } });
    case 'createOrder':
      // Creer la commande...
      return res.json({ order: { id: '123', status: 'created' } });
    case 'deleteOrder':
      // Supprimer la commande...
      return res.json({ success: true });
    default:
      return res.json({ error: 'Unknown action' });
  }
});
```

:::warning Problème du niveau 0
L'action est cachee dans le body. Impossible d'utiliser le caching HTTP, les proxies, ou les CDN. Aucun contrat standardise entre client et serveur.
:::

### 1.2 Niveau 1 — Ressources distinctes

```typescript
// Niveau 1 : URIs distincts, mais tout en POST
app.post('/orders', (req, res) => {
  // Creer une commande
  res.json({ id: '123', status: 'created' });
});

app.post('/orders/123', (req, res) => {
  // Lire la commande (mais c'est un POST...)
  res.json({ id: '123', status: 'pending' });
});

app.post('/orders/123/delete', (req, res) => {
  // Supprimer (l'action est dans l'URL au lieu du body)
  res.json({ success: true });
});
```

### 1.3 Niveau 2 — Verbes HTTP et codes de statut

```typescript
// Niveau 2 : Utilisation correcte des verbes et statuts HTTP
interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  status: 'pending' | 'confirmed' | 'shipped';
  total: number;
}

const orders = new Map<string, Order>();

// GET = lire, POST = creer, PUT = remplacer, DELETE = supprimer
app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' }); // 404
  }
  res.json(order); // 200 implicite
});

app.post('/orders', (req, res) => {
  const id = crypto.randomUUID();
  const order: Order = { id, ...req.body, status: 'pending' };
  orders.set(id, order);
  res
    .status(201) // 201 Created
    .location(`/orders/${id}`) // Header Location
    .json(order);
});

app.delete('/orders/:id', (req, res) => {
  if (!orders.has(req.params.id)) {
    return res.status(404).json({ error: 'Order not found' });
  }
  orders.delete(req.params.id);
  res.status(204).end(); // 204 No Content
});
```

:::tip Niveau 2 est le standard de l'industrie
La grande majorite des APIs modernes se situent au niveau 2. C'est un bon compromis entre simplicite et respect des standards HTTP.
:::

### 1.4 Niveau 3 — HATEOAS

HATEOAS (Hypermedia As The Engine Of Application State) : chaque réponse contient des liens vers les actions possibles. Le client n'a pas besoin de connaître la structure de l'API a l'avance.

```typescript
// Niveau 3 : Reponses avec liens hypermedia
interface HateoasLink {
  href: string;
  method: string;
  rel: string;
}

interface HateoasOrder extends Order {
  _links: HateoasLink[];
}

function addLinks(order: Order): HateoasOrder {
  const links: HateoasLink[] = [
    { rel: 'self', method: 'GET', href: `/orders/${order.id}` },
  ];

  // Liens conditionnels selon l'etat de la commande
  if (order.status === 'pending') {
    links.push({ rel: 'confirm', method: 'POST', href: `/orders/${order.id}/confirm` });
    links.push({ rel: 'cancel', method: 'DELETE', href: `/orders/${order.id}` });
  }
  if (order.status === 'confirmed') {
    links.push({ rel: 'ship', method: 'POST', href: `/orders/${order.id}/ship` });
  }

  return { ...order, _links: links };
}

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(addLinks(order));
});

// Reponse exemple :
// {
//   "id": "abc-123",
//   "status": "pending",
//   "total": 59.99,
//   "_links": [
//     { "rel": "self",    "method": "GET",    "href": "/orders/abc-123" },
//     { "rel": "confirm", "method": "POST",   "href": "/orders/abc-123/confirm" },
//     { "rel": "cancel",  "method": "DELETE", "href": "/orders/abc-123" }
//   ]
// }
```

---

## 2. gRPC — Communication haute performance

gRPC est un framework RPC (Remote Procedure Call) développé par Google. Il utilise HTTP/2 et Protocol Buffers pour offrir des performances superieures a REST/JSON.

```
COMPARAISON REST vs gRPC
============================

REST/JSON :                          gRPC/Protobuf :
┌──────────┐  HTTP/1.1 + JSON  ┌──────────┐    ┌──────────┐  HTTP/2 + binaire  ┌──────────┐
│ Client   │ ──────────────► │ Serveur  │    │ Client   │ ────────────────► │ Serveur  │
│          │  texte, verbose   │          │    │          │  compact, type    │          │
└──────────┘  ~500 octets      └──────────┘    └──────────┘  ~120 octets      └──────────┘

Avantages gRPC :                     Avantages REST :
• Serialisation binaire rapide       • Universalite (navigateurs)
• Contrat fort (schema .proto)       • Simplicite (curl, Postman)
• Streaming bidirectionnel           • Cache HTTP natif
• Generation de code automatique     • Lisibilite humaine
```

### 2.1 Protocol Buffers — Definitions de messages

```typescript
// Representation TypeScript d'un schema .proto
// En vrai gRPC on ecrit un fichier .proto puis on genere le code.
// Ici on montre la correspondance conceptuelle.

// order.proto (schema conceptuel) :
// message OrderItem {
//   string product_id = 1;
//   int32 quantity = 2;
//   double unit_price = 3;
// }
//
// message CreateOrderRequest {
//   string user_id = 1;
//   repeated OrderItem items = 2;
// }
//
// message OrderResponse {
//   string order_id = 1;
//   string status = 2;
//   double total = 3;
// }

// Equivalent TypeScript genere :
interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

interface CreateOrderRequest {
  userId: string;
  items: OrderItem[];
}

interface OrderResponse {
  orderId: string;
  status: string;
  total: number;
}
```

### 2.2 Les 4 types de streaming gRPC

```
1. UNARY (requete-reponse classique)
   Client ──── Request ────► Serveur
   Client ◄─── Response ──── Serveur

2. SERVER STREAMING (le serveur envoie un flux)
   Client ──── Request ────► Serveur
   Client ◄─── Response 1 ── Serveur
   Client ◄─── Response 2 ── Serveur
   Client ◄─── Response N ── Serveur

3. CLIENT STREAMING (le client envoie un flux)
   Client ──── Request 1 ──► Serveur
   Client ──── Request 2 ──► Serveur
   Client ──── Request N ──► Serveur
   Client ◄─── Response ──── Serveur

4. BIDIRECTIONAL STREAMING (flux dans les deux sens)
   Client ──── Request 1 ──► Serveur
   Client ◄─── Response 1 ── Serveur
   Client ──── Request 2 ──► Serveur
   Client ◄─── Response 2 ── Serveur
   (independants, pas forcement en alternance)
```

```typescript
// Modelisation TypeScript des 4 types de service gRPC
// (conceptuel — en production, le code est genere depuis le .proto)

interface OrderService {
  // Unary : une requete, une reponse
  getOrder(request: { orderId: string }): Promise<OrderResponse>;

  // Server streaming : une requete, flux de reponses
  watchOrderStatus(request: { orderId: string }): AsyncIterable<OrderResponse>;

  // Client streaming : flux de requetes, une reponse
  batchCreateOrders(requests: AsyncIterable<CreateOrderRequest>): Promise<{ count: number }>;

  // Bidirectional streaming : flux dans les deux sens
  liveOrderUpdates(
    requests: AsyncIterable<{ orderId: string }>
  ): AsyncIterable<OrderResponse>;
}
```

---

## 3. Service Discovery

Dans un système distribue, les services doivent se trouver les uns les autres. Les adresses IP et ports peuvent changer dynamiquement (scaling, deploiements, pannes).

```
SANS SERVICE DISCOVERY :                 AVEC SERVICE DISCOVERY :
=========================                ===========================

┌──────────┐                             ┌──────────┐
│ Client   │ ── hardcoded ──►            │ Client   │
│          │    192.168.1.10:3000         │          │
└──────────┘                             └────┬─────┘
                                              │ "ou est order-service ?"
Si le serveur change d'IP :                   ▼
  → Le client est casse !              ┌──────────────┐
                                       │  Registre    │
                                       │  de services │
                                       └──────┬───────┘
                                              │ "192.168.1.10:3000"
                                              ▼
                                       ┌──────────┐
                                       │ Service  │
                                       └──────────┘
```

### 3.1 Client-side vs Server-side discovery

```
CLIENT-SIDE DISCOVERY :                  SERVER-SIDE DISCOVERY :
========================                 =========================

┌────────┐    ┌──────────┐              ┌────────┐    ┌───────────┐
│ Client │───►│ Registry │              │ Client │───►│ Load      │
│        │    └──────────┘              │        │    │ Balancer  │
│        │         │                    └────────┘    └─────┬─────┘
│        │ liste d'instances                                │
│        │◄────────┘                          ┌─────────────┼──────────┐
│        │                                    ▼             ▼          ▼
│        │──► choix + appel direct      ┌─────────┐  ┌─────────┐ ┌─────────┐
└────────┘                              │ Inst. 1 │  │ Inst. 2 │ │ Inst. 3 │
                                        └─────────┘  └─────────┘ └─────────┘

Le CLIENT choisit l'instance.           Le LOAD BALANCER choisit l'instance.
+ Pas de SPOF (load balancer)           + Client simple (ne connait qu'un URL)
- Logique de LB dans chaque client      - SPOF potentiel (load balancer)
```

### 3.2 Implementer un registre de services

```typescript
// service-registry.ts — Registre de services simple

interface ServiceInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  metadata: Record<string, string>;
  registeredAt: number;
  lastHeartbeat: number;
}

class ServiceRegistry {
  private services = new Map<string, Map<string, ServiceInstance>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
    // Nettoyage periodique des instances mortes
    setInterval(() => this.evictStaleInstances(), this.ttlMs / 2);
  }

  register(name: string, host: string, port: number, metadata: Record<string, string> = {}): string {
    const id = `${name}-${host}-${port}`;
    const instance: ServiceInstance = {
      id, name, host, port, metadata,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    if (!this.services.has(name)) {
      this.services.set(name, new Map());
    }
    this.services.get(name)!.set(id, instance);
    console.log(`[REGISTER] ${id}`);
    return id;
  }

  heartbeat(instanceId: string): boolean {
    for (const instances of this.services.values()) {
      const instance = instances.get(instanceId);
      if (instance) {
        instance.lastHeartbeat = Date.now();
        return true;
      }
    }
    return false;
  }

  deregister(instanceId: string): void {
    for (const instances of this.services.values()) {
      instances.delete(instanceId);
    }
    console.log(`[DEREGISTER] ${instanceId}`);
  }

  getInstances(name: string): ServiceInstance[] {
    const instances = this.services.get(name);
    if (!instances) return [];
    return Array.from(instances.values());
  }

  private evictStaleInstances(): void {
    const now = Date.now();
    for (const [name, instances] of this.services) {
      for (const [id, instance] of instances) {
        if (now - instance.lastHeartbeat > this.ttlMs) {
          instances.delete(id);
          console.log(`[EVICT] ${id} (no heartbeat for ${this.ttlMs}ms)`);
        }
      }
    }
  }
}
```

---

## 4. Load Balancing

### 4.1 Stratégies de repartition

```typescript
// load-balancer.ts — Strategies de load balancing

type LoadBalancerStrategy = (instances: ServiceInstance[]) => ServiceInstance;

// Round-robin : chaque instance a son tour
function roundRobin(): LoadBalancerStrategy {
  let index = 0;
  return (instances: ServiceInstance[]) => {
    const instance = instances[index % instances.length];
    index++;
    return instance;
  };
}

// Least connections : l'instance la moins chargee
function leastConnections(): LoadBalancerStrategy {
  const connectionCount = new Map<string, number>();

  return (instances: ServiceInstance[]) => {
    let minConns = Infinity;
    let selected = instances[0];
    for (const inst of instances) {
      const conns = connectionCount.get(inst.id) || 0;
      if (conns < minConns) {
        minConns = conns;
        selected = inst;
      }
    }
    connectionCount.set(selected.id, (connectionCount.get(selected.id) || 0) + 1);
    return selected;
  };
}

// Consistent hashing : meme cle → meme instance (utile pour le cache)
function consistentHash(key: string, instances: ServiceInstance[]): ServiceInstance {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % instances.length;
  return instances[index];
}
```

### 4.2 Health checks

```typescript
// health-check.ts — Verification de sante des services

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  lastCheck: number;
}

async function checkHealth(host: string, port: number): Promise<HealthStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://${host}:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (response.ok) {
      return { status: latencyMs > 2000 ? 'degraded' : 'healthy', latencyMs, lastCheck: Date.now() };
    }
    return { status: 'unhealthy', latencyMs, lastCheck: Date.now() };
  } catch {
    return { status: 'unhealthy', latencyMs: Date.now() - start, lastCheck: Date.now() };
  }
}
```

:::tip Health checks actifs vs passifs
Les health checks **actifs** (le registre interroge periodiquement les services) detectent les pannes proactivement. Les health checks **passifs** (on observe les erreurs sur les requêtes reelles) sont moins couteux mais detectent les problèmes plus tard.
:::

---

## 5. Assembler le tout

```
CLIENT ─── requete ───► API GATEWAY
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             Service Registry    Load Balancer
                    │                   │
           liste d'instances           choix
                    │                   │
                    └─────────┬─────────┘
                              ▼
                    ┌───────────────────┐
                    │  Instance saine   │
                    │  du service cible │
                    └───────────────────┘

Flow complet :
1. Le service s'enregistre au demarrage (register)
2. Il envoie des heartbeats periodiques
3. Le client (ou gateway) demande la liste d'instances
4. Le load balancer choisit une instance
5. Le health check retire les instances mortes
```

---

## Points clés

1. **Le modèle de Richardson** mesure la maturite d'une API REST en 4 niveaux. Le niveau 2 (verbes HTTP + codes de statut) est le standard courant.
2. **HATEOAS** (niveau 3) rend l'API auto-descriptive mais ajoute de la complexite. Il est rarement implemente complètement en pratique.
3. **gRPC** offre des performances superieures a REST pour la communication inter-services grâce à HTTP/2 et Protocol Buffers.
4. **Les 4 types de streaming gRPC** (unary, server, client, bidirectionnel) couvrent tous les patterns de communication.
5. **Le service discovery** resout le problème du routage dynamique : les services s'enregistrent et se decouvrent via un registre.
6. **Le load balancing** repartit la charge entre les instances (round-robin, least connections, consistent hashing).
7. **Les health checks** permettent de retirer automatiquement les instances defaillantes du registre.

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [04 - Serialisation & Contrats d'API](./04-serialisation-et-contrats-api.md) | [06 - Message Queues](./06-communication-asynchrone-message-queues.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 05 communication synchrone](../screencasts/screencast-05-communication-synchrone.md)
2. **Lab** : [lab-05-communication-synchrone](../labs/lab-05-communication-synchrone/README)
3. **Quiz** : [quiz 05 communication synchrone](../quizzes/quiz-05-communication-synchrone.html)
:::
