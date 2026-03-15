# Screencast 05 — Communication synchrone avancee

## Informations
- **Duree estimee** : 12-15 min
- **Module** : `modules/05-communication-synchrone-avancee.md`
- **Lab associe** : Lab 05
- **Prérequis** : Screencast 04

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/05-communication-synchrone-avancee.md` ouvert
- [ ] Trois terminaux disponibles (deux services + client)
- [ ] Aucun processus sur les ports 3001-3003

## Script

### [00:00-01:30] Introduction — Au-dela du CRUD basique

> On sait déjà faire des appels HTTP entre services. Mais en production, ça ne suffit pas. Comment un service trouve-t-il l'adresse d'un autre service ? Comment repartir la charge entre plusieurs instances ? Quel niveau de maturite REST adopter ? Ce screencast repond a ces trois questions.

**Action** : Ouvrir le module 05 et afficher le modèle de maturite Richardson.

```
MODELE DE MATURITE RICHARDSON :

Niveau 0 : The Swamp of POX
  → Un seul endpoint, tout passe par POST
  → POST /api { "action": "getUser", "id": "user-1" }

Niveau 1 : Resources
  → Des URLs distinctes par ressource
  → GET /users/user-1, POST /orders

Niveau 2 : HTTP Verbs
  → Utilisation correcte de GET, POST, PUT, DELETE, PATCH
  → Codes de retour semantiques (201, 404, 409...)

Niveau 3 : Hypermedia Controls (HATEOAS)
  → Les reponses contiennent des liens vers les actions possibles
  → { "id": "order-1", "_links": { "cancel": "/orders/order-1/cancel" } }
```

> En microservices, le niveau 2 est le minimum. Le niveau 3 (HATEOAS) est rarement utilise en pratique dans les architectures internes, mais il est utile pour les API publiques.

### [01:30-05:00] Service discovery — Trouver les autres services

> Premiere question fondamentale : comment un service sait-il ou se trouve un autre service ? Coder l'adresse en dur est fragile. Le service discovery resout ce problème.

**Action** : Créer un fichier `service-registry.ts`.

```typescript
interface ServiceInstance {
  id: string;
  name: string;
  host: string;
  port: number;
  healthy: boolean;
  registeredAt: number;
  lastHeartbeat: number;
}

class ServiceRegistry {
  private instances: Map<string, ServiceInstance[]> = new Map();
  private readonly heartbeatTimeout = 10_000; // 10 secondes

  register(name: string, host: string, port: number): string {
    const id = `${name}-${host}:${port}`;
    const instance: ServiceInstance = {
      id, name, host, port,
      healthy: true,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    const instances = this.instances.get(name) ?? [];
    instances.push(instance);
    this.instances.set(name, instances);

    console.log(`[Registry] Registered ${id}`);
    return id;
  }

  heartbeat(instanceId: string): void {
    for (const instances of this.instances.values()) {
      const inst = instances.find(i => i.id === instanceId);
      if (inst) {
        inst.lastHeartbeat = Date.now();
        inst.healthy = true;
      }
    }
  }

  resolve(name: string): ServiceInstance[] {
    const instances = this.instances.get(name) ?? [];
    const now = Date.now();

    // Marquer les instances sans heartbeat comme unhealthy
    for (const inst of instances) {
      if (now - inst.lastHeartbeat > this.heartbeatTimeout) {
        inst.healthy = false;
      }
    }

    return instances.filter(i => i.healthy);
  }

  deregister(instanceId: string): void {
    for (const [name, instances] of this.instances) {
      this.instances.set(name, instances.filter(i => i.id !== instanceId));
    }
    console.log(`[Registry] Deregistered ${instanceId}`);
  }
}
```

> Le registre stocke les instances par nom de service. Chaque instance envoie un heartbeat periodique. Si le heartbeat s'arrete, l'instance est marquee unhealthy et n'est plus retournee par `resolve`. C'est le principe de Consul, Eureka, ou du DNS interne de Kubernetes.

**Action** : Tester le registre avec plusieurs instances.

```typescript
const registry = new ServiceRegistry();

// Enregistrer 3 instances du User Service
registry.register('user-service', 'host-1', 3002);
registry.register('user-service', 'host-2', 3002);
registry.register('user-service', 'host-3', 3002);

console.log('Healthy instances:', registry.resolve('user-service').length); // 3
```

### [05:00-09:00] Load balancing — Repartir la charge

> Maintenant qu'on sait trouver plusieurs instances, comment choisir laquelle appeler ? C'est le role du load balancer. Implementons trois stratégies classiques.

**Action** : Créer un fichier `load-balancer.ts`.

```typescript
interface LoadBalancerStrategy {
  select<T>(instances: T[]): T;
}

// Strategie 1 : Round Robin
class RoundRobinStrategy implements LoadBalancerStrategy {
  private index = 0;

  select<T>(instances: T[]): T {
    const instance = instances[this.index % instances.length];
    this.index++;
    return instance;
  }
}

// Strategie 2 : Random
class RandomStrategy implements LoadBalancerStrategy {
  select<T>(instances: T[]): T {
    return instances[Math.floor(Math.random() * instances.length)];
  }
}

// Strategie 3 : Least Connections (basee sur le poids)
class WeightedStrategy implements LoadBalancerStrategy {
  private weights: Map<number, number> = new Map();

  select<T>(instances: T[]): T {
    let minWeight = Infinity;
    let selected = 0;

    for (let i = 0; i < instances.length; i++) {
      const weight = this.weights.get(i) ?? 0;
      if (weight < minWeight) {
        minWeight = weight;
        selected = i;
      }
    }

    this.weights.set(selected, (this.weights.get(selected) ?? 0) + 1);
    return instances[selected];
  }

  release(index: number): void {
    const current = this.weights.get(index) ?? 1;
    this.weights.set(index, Math.max(0, current - 1));
  }
}

// Client HTTP avec load balancing integre
class LoadBalancedClient {
  constructor(
    private registry: ServiceRegistry,
    private strategy: LoadBalancerStrategy
  ) {}

  async call(serviceName: string, path: string): Promise<Response> {
    const instances = this.registry.resolve(serviceName);
    if (instances.length === 0) {
      throw new Error(`No healthy instances for ${serviceName}`);
    }

    const instance = this.strategy.select(instances);
    const url = `http://${instance.host}:${instance.port}${path}`;
    console.log(`[LB] Routing to ${instance.id} — ${url}`);

    return fetch(url, { signal: AbortSignal.timeout(5000) });
  }
}
```

**Action** : Demontrer les trois stratégies avec un compteur d'appels.

```typescript
const strategy = new RoundRobinStrategy();
const instances = ['instance-A', 'instance-B', 'instance-C'];

for (let i = 0; i < 9; i++) {
  console.log(`Request ${i + 1} → ${strategy.select(instances)}`);
}
// A, B, C, A, B, C, A, B, C — distribution parfaitement equilibree
```

> Round Robin est le plus simple et souvent suffisant. Random est bon quand les instances ont des capacites egales. Weighted/Least Connections est ideal quand certaines requêtes sont plus lourdes que d'autres. Nginx, HAProxy, et les service meshes implementent ces stratégies et bien d'autres.

### [09:00-11:30] Assembler le tout — Client resilient

> Combinons le service discovery et le load balancing avec les timeouts et retries qu'on connait déjà.

**Action** : Montrer le client complet.

```typescript
class ResilientServiceClient {
  private registry: ServiceRegistry;
  private strategy: LoadBalancerStrategy;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
    this.strategy = new RoundRobinStrategy();
  }

  async call(serviceName: string, path: string, retries = 2): Promise<unknown> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const instances = this.registry.resolve(serviceName);
      if (instances.length === 0) {
        throw new Error(`No healthy instances for ${serviceName}`);
      }

      const instance = this.strategy.select(instances);
      const url = `http://${instance.host}:${instance.port}${path}`;

      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (response.ok) return response.json();
        if (response.status < 500) throw new Error(`Client error: ${response.status}`);
        // 5xx → retry sur une autre instance
        console.log(`[Retry] ${instance.id} returned ${response.status}, trying another instance`);
      } catch (err) {
        console.log(`[Retry] ${instance.id} failed: ${err}, attempt ${attempt + 1}/${retries + 1}`);
        if (attempt === retries) throw err;
      }
    }
    throw new Error('All retries exhausted');
  }
}
```

> Le client combine tout : il découvre les instances, choisit via round robin, applique un timeout, et en cas d'erreur serveur il retente sur une instance différente. C'est le type de client qu'on trouve dans les SDKs de service mesh comme Istio ou Linkerd.

### [11:30-13:30] Récapitulatif

> Recapitulons les trois concepts clés de la communication synchrone avancee.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. REST niveau 2 minimum — verbes HTTP + codes de retour semantiques
2. Service discovery — ne jamais coder d'adresse en dur, registre + heartbeat
3. Load balancing — Round Robin, Random, Weighted selon le contexte
4. Client resilient = discovery + LB + timeout + retry sur autre instance

PROCHAINE ETAPE :
→ Screencast 06 : Communication asynchrone avec les message queues
```

> Jusqu'ici, toute notre communication est synchrone : le client attend la réponse. Au prochain screencast, on va découvrir la communication asynchrone avec les message queues. C'est un changement de paradigme complet. A bientot !

## Points d'attention pour l'enregistrement
- Le modèle Richardson est théorique — ne pas y passer trop de temps, montrer les exemples concrets
- Pour le service registry, bien montrer le cycle register → heartbeat → resolve → deregister
- Demontrer visuellement le round robin avec les console.log pour que l'alternance soit evidente
- Le client resilient est l'aboutissement du screencast — prendre le temps de commenter chaque étape
- Vérifier que les exemples de code compilent et s'executent avant l'enregistrement
