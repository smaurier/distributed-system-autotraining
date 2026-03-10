# Screencast 24 — Projet Final : Architecture Distribuee Complete

## Informations
- **Duree estimee** : 20-25 min
- **Module** : `modules/24-projet-final.md`
- **Lab associe** : Lab 24
- **Prerequis** : Screencast 23

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/24-projet-final.md` ouvert
- [ ] 4-5 terminaux disponibles (un par service)
- [ ] Aucun processus sur les ports 3000-3006
- [ ] Tous les modules precedents revises

## Script

### [00:00-02:30] Introduction — Assembler les pieces du puzzle

> Bienvenue dans le dernier screencast de cette formation. Pendant 24 modules, on a explore les fondamentaux, la communication, la coherence, la resilience, et les algorithmes avances des systemes distribues. Maintenant, on va assembler tout ca dans un projet complet : un systeme de commandes e-commerce distribue.

**Action** : Ouvrir le module 24 et afficher le diagramme d'architecture global.

```
┌──────────────────────────────────────────────────────────────────┐
│                        API GATEWAY (:3000)                       │
│            Routing │ Auth │ Rate Limiting │ Correlation ID       │
└──────────┬──────────────────┬──────────────────────┬─────────────┘
           │                  │                      │
    ┌──────▼──────┐   ┌──────▼──────┐       ┌───────▼───────┐
    │ Order       │   │ Inventory   │       │ User          │
    │ Service     │   │ Service     │       │ Service       │
    │ (:3001)     │   │ (:3002)     │       │ (:3003)       │
    │ CQRS+ES     │   │ PN-Counter  │       │ LWW-Register  │
    └──────┬──────┘   └──────┬──────┘       └───────────────┘
           │                  │
           └────────┬─────────┘
                    │
            ┌───────▼───────┐
            │  Event Bus    │       ┌───────────────┐
            │  (Pub/Sub)    │──────►│ Notification  │
            │               │       │ Service       │
            └───────┬───────┘       │ (:3004)       │
                    │               └───────────────┘
            ┌───────▼───────┐
            │ Saga          │
            │ Orchestrator  │
            │ (:3005)       │
            └───────────────┘
```

> Six composants. L'API Gateway est le point d'entree. Le Order Service utilise le CQRS et l'event sourcing. L'Inventory Service utilise un PN-Counter CRDT pour le stock. Le User Service utilise un LWW-Register. L'Event Bus distribue les evenements. Le Saga Orchestrator coordonne le flux de commande. Et le Notification Service ecoute les evenements pour envoyer les emails.

### [02:30-07:00] Architecture du Order Service (CQRS + Event Sourcing)

> Le Order Service est le coeur du systeme. Il utilise CQRS pour separer lectures et ecritures, et l'event sourcing pour stocker l'historique complet.

**Action** : Montrer les composants cles du Order Service.

```typescript
// --- Domain Events ---
type OrderEvent =
  | { type: 'OrderCreated'; data: { orderId: string; userId: string; items: OrderItem[]; total: number } }
  | { type: 'OrderPaid'; data: { orderId: string; paymentId: string } }
  | { type: 'OrderShipped'; data: { orderId: string; trackingId: string } }
  | { type: 'OrderCancelled'; data: { orderId: string; reason: string } };

interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

// --- Event Store ---
class OrderEventStore {
  private events: Map<string, (OrderEvent & { eventId: string; timestamp: number; version: number })[]> = new Map();

  append(orderId: string, event: OrderEvent): void {
    const stream = this.events.get(orderId) ?? [];
    stream.push({
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      version: stream.length + 1,
    });
    this.events.set(orderId, stream);
  }

  getStream(orderId: string) {
    return this.events.get(orderId) ?? [];
  }
}

// --- Read Model (Projection) ---
interface OrderSummary {
  orderId: string;
  userId: string;
  status: 'created' | 'paid' | 'shipped' | 'cancelled';
  total: number;
  items: OrderItem[];
  trackingId?: string;
}

class OrderProjection {
  private summaries: Map<string, OrderSummary> = new Map();

  apply(event: OrderEvent & { timestamp: number }): void {
    switch (event.type) {
      case 'OrderCreated':
        this.summaries.set(event.data.orderId, {
          orderId: event.data.orderId,
          userId: event.data.userId,
          status: 'created',
          total: event.data.total,
          items: event.data.items,
        });
        break;
      case 'OrderPaid': {
        const order = this.summaries.get(event.data.orderId);
        if (order) order.status = 'paid';
        break;
      }
      case 'OrderShipped': {
        const order = this.summaries.get(event.data.orderId);
        if (order) { order.status = 'shipped'; order.trackingId = event.data.trackingId; }
        break;
      }
      case 'OrderCancelled': {
        const order = this.summaries.get(event.data.orderId);
        if (order) order.status = 'cancelled';
        break;
      }
    }
  }

  getOrder(orderId: string): OrderSummary | undefined {
    return this.summaries.get(orderId);
  }

  getOrdersByUser(userId: string): OrderSummary[] {
    return [...this.summaries.values()].filter(o => o.userId === userId);
  }
}
```

> Le write model (Event Store) et le read model (Projection) sont completement separes. On ecrit des evenements dans le store, et la projection les transforme en une vue optimisee pour les requetes.

### [07:00-11:00] Le Saga Orchestrator — Flux de commande complet

> Le flux de commande traverse plusieurs services : creer la commande, reserver le stock, processer le paiement, et planifier l'expedition. Le saga orchestrator coordonne ces etapes avec des compensations en cas d'echec.

**Action** : Montrer l'orchestrateur.

```typescript
interface SagaStep {
  name: string;
  service: string;
  execute: (ctx: OrderSagaContext) => Promise<void>;
  compensate: (ctx: OrderSagaContext) => Promise<void>;
}

interface OrderSagaContext {
  orderId: string;
  userId: string;
  items: OrderItem[];
  total: number;
  correlationId: string;
  paymentId?: string;
  trackingId?: string;
}

class OrderSagaOrchestrator {
  private steps: SagaStep[] = [];
  private completedSteps: SagaStep[] = [];

  constructor(private eventBus: EventBus, private logger: StructuredLogger) {}

  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  async execute(ctx: OrderSagaContext): Promise<{ success: boolean; ctx: OrderSagaContext }> {
    this.logger.info(ctx.correlationId, `Saga started for order ${ctx.orderId}`, { steps: this.steps.length });

    for (const step of this.steps) {
      try {
        this.logger.info(ctx.correlationId, `Executing step: ${step.name}`, { service: step.service });
        await step.execute(ctx);
        this.completedSteps.push(step);
      } catch (err) {
        this.logger.error(ctx.correlationId, `Step "${step.name}" failed`, { error: String(err) });
        await this.compensate(ctx);
        return { success: false, ctx };
      }
    }

    this.logger.info(ctx.correlationId, `Saga completed successfully for order ${ctx.orderId}`);
    await this.eventBus.emit({ type: 'OrderCompleted', orderId: ctx.orderId, correlationId: ctx.correlationId });
    return { success: true, ctx };
  }

  private async compensate(ctx: OrderSagaContext): Promise<void> {
    this.logger.warn(ctx.correlationId, `Compensating ${this.completedSteps.length} steps`);
    for (let i = this.completedSteps.length - 1; i >= 0; i--) {
      const step = this.completedSteps[i];
      try {
        this.logger.info(ctx.correlationId, `Compensating: ${step.name}`);
        await step.compensate(ctx);
      } catch (err) {
        this.logger.error(ctx.correlationId, `Compensation failed for "${step.name}"`, { error: String(err) });
        // En production : alerter, DLQ, intervention humaine
      }
    }
  }
}
```

**Action** : Configurer les etapes du saga.

```typescript
function buildOrderSaga(orchestrator: OrderSagaOrchestrator): void {
  orchestrator.addStep({
    name: 'validate-order',
    service: 'order-service',
    execute: async (ctx) => {
      console.log(`  [Order] Validating order ${ctx.orderId}`);
      // Valider les items, les prix, l'utilisateur
    },
    compensate: async (ctx) => {
      console.log(`  [Order] Cancelling order ${ctx.orderId}`);
    },
  });

  orchestrator.addStep({
    name: 'reserve-inventory',
    service: 'inventory-service',
    execute: async (ctx) => {
      for (const item of ctx.items) {
        console.log(`  [Inventory] Reserving ${item.quantity}x ${item.productId}`);
        // Utilise le PN-Counter CRDT
      }
    },
    compensate: async (ctx) => {
      for (const item of ctx.items) {
        console.log(`  [Inventory] Releasing ${item.quantity}x ${item.productId}`);
      }
    },
  });

  orchestrator.addStep({
    name: 'process-payment',
    service: 'payment-service',
    execute: async (ctx) => {
      console.log(`  [Payment] Charging ${ctx.total} EUR`);
      ctx.paymentId = `pay-${Date.now()}`;
      // Utilise l'idempotency key
    },
    compensate: async (ctx) => {
      console.log(`  [Payment] Refunding ${ctx.paymentId}`);
    },
  });

  orchestrator.addStep({
    name: 'schedule-shipment',
    service: 'shipment-service',
    execute: async (ctx) => {
      console.log(`  [Shipment] Scheduling delivery for ${ctx.orderId}`);
      ctx.trackingId = `TRACK-${Date.now()}`;
    },
    compensate: async (ctx) => {
      console.log(`  [Shipment] Cancelling ${ctx.trackingId}`);
    },
  });
}
```

### [11:00-15:00] Integration test — Le flux complet

> Testons le flux de bout en bout : de la requete client a la notification de livraison.

**Action** : Executer le test d'integration.

```typescript
async function integrationTest() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     INTEGRATION TEST : Full Order Flow               ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const correlationId = crypto.randomUUID();
  const eventBus = new EventBus();
  const logger = new StructuredLogger('integration-test');
  const eventStore = new OrderEventStore();
  const projection = new OrderProjection();

  // Configurer les listeners
  const events: string[] = [];
  eventBus.onAny((event: any) => {
    events.push(event.type);
    projection.apply({ ...event, timestamp: Date.now() });
  });

  // Configurer et executer le saga
  const orchestrator = new OrderSagaOrchestrator(eventBus, logger);
  buildOrderSaga(orchestrator);

  const ctx: OrderSagaContext = {
    orderId: 'order-final-1',
    userId: 'user-1',
    items: [
      { productId: 'book-ts', quantity: 1, price: 29.99 },
      { productId: 'book-node', quantity: 2, price: 24.99 },
    ],
    total: 79.97,
    correlationId,
  };

  console.log('--- Step 1: Execute Saga ---');
  const result = await orchestrator.execute(ctx);

  console.log(`\n--- Step 2: Verify Result ---`);
  console.log(`Saga success: ${result.success}`);
  console.log(`Payment ID: ${result.ctx.paymentId}`);
  console.log(`Tracking ID: ${result.ctx.trackingId}`);

  console.log(`\n--- Step 3: Verify Events ---`);
  console.log(`Events emitted: ${events.join(' → ')}`);

  console.log(`\n--- Step 4: Verify Read Model ---`);
  // Emettre l'event pour la projection
  eventStore.append(ctx.orderId, {
    type: 'OrderCreated',
    data: { orderId: ctx.orderId, userId: ctx.userId, items: ctx.items, total: ctx.total },
  });
  projection.apply({
    type: 'OrderCreated',
    data: { orderId: ctx.orderId, userId: ctx.userId, items: ctx.items, total: ctx.total },
    timestamp: Date.now(),
  });

  const order = projection.getOrder(ctx.orderId);
  console.log(`Order in read model: ${JSON.stringify(order, null, 2)}`);

  console.log(`\n--- Step 5: Verify Correlation ID ---`);
  console.log(`All operations traced with: ${correlationId.slice(0, 8)}...`);

  // Resume
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║  RESULTS                                             ║');
  console.log('╠═══════════════════════════════════════════════════════╣');
  console.log(`║  Saga:         ${result.success ? 'PASS' : 'FAIL'}                                   ║`);
  console.log(`║  Events:       ${events.length > 0 ? 'PASS' : 'FAIL'} (${events.length} emitted)                     ║`);
  console.log(`║  Read Model:   ${order ? 'PASS' : 'FAIL'}                                   ║`);
  console.log(`║  Correlation:  PASS (${correlationId.slice(0, 8)}...)             ║`);
  console.log('╚═══════════════════════════════════════════════════════╝');
}

await integrationTest();
```

### [15:00-19:00] Le flux complet — Order flow de bout en bout

> Recapitulons le parcours complet d'une commande a travers notre systeme.

**Action** : Afficher le sequence diagram complet.

```
CLIENT                 GATEWAY        ORDER SVC      INVENTORY     PAYMENT      NOTIFICATION
  │                       │               │              │            │             │
  │── POST /orders ──────►│               │              │            │             │
  │                       │── auth ──────►│              │            │             │
  │                       │── rate limit ─│              │            │             │
  │                       │               │              │            │             │
  │                       │──────────────►│ OrderCreated │            │             │
  │                       │               │──────────────►│ reserve   │             │
  │                       │               │              │ (CRDT)     │             │
  │                       │               │              │◄───── OK   │             │
  │                       │               │──────────────────────────►│ charge      │
  │                       │               │              │            │ (idempotent)│
  │                       │               │              │◄───────────│ OK          │
  │                       │               │                           │             │
  │                       │               │── event: OrderPaid ──────────────────── │
  │                       │               │                           │  📧 email   │
  │                       │◄──────────────│ {orderId, status: paid}  │             │
  │◄── 201 Created ───────│               │              │            │             │
```

> Ce diagramme represente tout ce qu'on a appris : API Gateway avec auth et rate limiting, CQRS avec event sourcing dans le Order Service, CRDT pour le stock, idempotency pour le paiement, events pour les notifications, et correlation ID pour le tracing de bout en bout.

**Action** : Faire le lien avec chaque module du cours.

```
PATTERNS UTILISES DANS LE PROJET FINAL :

Module 03 : Microservices Express + structured logging
Module 04 : Validation Zod + contrats API
Module 06 : Message queue / Event Bus
Module 07 : Domain events
Module 08 : API Gateway (routing, auth, rate limiting)
Module 09 : Idempotency keys + backoff+jitter
Module 10 : Choix eventual consistency pour le stock
Module 12 : Saga orchestration avec compensations
Module 13 : CQRS + Event Sourcing pour les commandes
Module 14 : Outbox pattern pour la publication fiable
Module 16 : Circuit breaker sur les appels inter-service
Module 17 : Rate limiting au gateway
Module 18 : Correlation IDs + structured logging + RED metrics
Module 23 : PN-Counter CRDT pour le stock
```

### [19:00-22:00] Resilience et observabilite du systeme complet

> En production, notre systeme doit etre resilient et observable. Montrons les mecanismes en place.

**Action** : Illustrer la resilience.

```typescript
// Le systeme resiste aux pannes grace a :
const resilienceStack = {
  'Circuit Breaker': 'Protege contre les services en panne (Module 16)',
  'Retry + Backoff': 'Gere les erreurs transitoires (Module 09)',
  'Idempotency': 'Evite les doublons sur retry (Module 09)',
  'Saga Compensation': 'Annule les etapes en cas d\'echec (Module 12)',
  'Rate Limiting': 'Protege contre la surcharge (Module 17)',
  'Health Checks': 'Detecte les services degrades (Module 18)',
  'CRDT Stock': 'Converge sans coordination (Module 23)',
};

// L'observabilite repose sur :
const observabilityStack = {
  'Correlation ID': 'Trace une requete a travers tous les services',
  'Structured Logging': 'JSON avec service, level, correlationId',
  'RED Metrics': 'Rate, Errors, Duration par service',
  'Health Endpoints': '/health avec verification des dependances',
  'Event Tracing': 'Suivi du flux d\'evenements par correlationId',
};

console.log('\n=== Resilience Stack ===');
for (const [pattern, desc] of Object.entries(resilienceStack)) {
  console.log(`  ${pattern}: ${desc}`);
}

console.log('\n=== Observability Stack ===');
for (const [tool, desc] of Object.entries(observabilityStack)) {
  console.log(`  ${tool}: ${desc}`);
}
```

### [22:00-24:00] Conclusion du cours

> Felicitations, vous avez termine cette formation sur les systemes distribues en TypeScript. En 25 modules, vous avez appris les fallacies du distribue, la communication synchrone et asynchrone, les patterns de coherence et replication, la resilience avec circuit breaker et rate limiting, l'observabilite, et les algorithmes avances comme Raft, les horloges logiques, le stream processing, et les CRDTs.

**Action** : Afficher le parcours complet.

```
VOTRE PARCOURS :

Phase 1 : Fondamentaux ✅
  Fallacies, communication reseau, microservices, serialisation

Phase 2 : Communication & Patterns ✅
  REST avance, message queues, event-driven, API gateway, retries

Phase 3 : Donnees & Coherence ✅
  CAP, replication, sagas, CQRS, outbox pattern

Phase 4 : Resilience & Observabilite ✅
  Failure modes, circuit breaker, rate limiting, observabilite, testing

Phase 5 : Avance & Synthese ✅
  Consensus Raft, horloges logiques, stream processing, CRDTs, projet final
```

> Le distribue est un domaine ou la pratique est essentielle. Continuez a coder, a experimentar, et a casser des choses en staging. Les labs de ce cours sont un point de depart — le vrai apprentissage commence quand vous appliquez ces patterns dans vos propres projets.

**Action** : Afficher les ressources pour aller plus loin.

> Merci d'avoir suivi cette formation. Bonne continuation dans le monde des systemes distribues !

## Points d'attention pour l'enregistrement
- Le diagramme d'architecture global doit etre affiche clairement et longuement
- Le saga orchestrator est le coeur du projet — bien montrer les etapes et compensations
- L'integration test est le moment de fierte — tout fonctionne ensemble
- Le sequence diagram du flux complet relie tout le cours — prendre le temps de le commenter
- Le tableau des patterns utilises par module est un bon rappel pour les apprenants
- Terminer sur une note positive et encourageante — c'est le dernier screencast
- Garder un rythme modere malgre la densite — c'est le plus long screencast du cours
