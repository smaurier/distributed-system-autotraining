# 07 — Event-Driven Architecture (events vs commands, event bus, domain events)

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 3/5        | 60 min        | [Lab 07](../labs/lab-07-event-driven/exercise.ts) | [Quiz 07](../quizzes/quiz-07-event-driven.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Distinguer un event d'une command et savoir quand utiliser chacun
- Classifier les types d'events : domain events, intégration events, notification events
- Implementer un event bus in-process en TypeScript avec typage fort
- Appliquer le pattern domain events pour emettre des événements depuis des aggregats
- Choisir entre des handlers synchrones et asynchrones selon le contexte
- Garantir l'idempotence et gérer l'ordering des événements
- Designer des événements : nommage, payload, versioning
- Identifier les anti-patterns courants (event chains, event-carried state transfer excessif)

---

## 1. Events vs Commands

La distinction entre events et commands est fondamentale en architecture event-driven. Confondre les deux mene à un couplage invisible entre services.

```
COMMAND (imperatif) :                    EVENT (fait passe) :
======================                   =====================

"Fais ceci !"                            "Ceci s'est passe."

┌──────────┐  CreateOrder   ┌──────────┐ ┌──────────┐  OrderCreated  ┌──────────┐
│ Emetteur │ ──────────────►│ Cible    │ │ Emetteur │ ──────────────►│ ??? │
│          │                │ unique   │ │          │                │ Abonnes  │
└──────────┘                └──────────┘ └──────────┘                └──────────┘

• Directif : on dit QUOI faire           • Declaratif : on dit CE QUI s'est passe
• Un seul destinataire                    • Zero, un ou plusieurs abonnes
• L'emetteur attend un resultat          • L'emetteur ne sait pas qui ecoute
• Couplage : l'emetteur connait la cible • Decouplage : l'emetteur est autonome
• Peut etre rejete                       • Fait accompli (ne peut pas etre rejete)

Exemples :                               Exemples :
  CreateOrder                              OrderCreated
  SendEmail                                EmailSent
  ReserveStock                             StockReserved
  CancelPayment                            PaymentCancelled
```

```typescript
// commands-vs-events.ts — Typage distinct

// COMMAND : imperatif, a un destinataire precis
interface Command {
  type: string;
  payload: unknown;
  metadata: {
    correlationId: string;
    issuedAt: string;
    issuedBy: string;
  };
}

interface CreateOrderCommand extends Command {
  type: 'CreateOrder';
  payload: {
    userId: string;
    items: Array<{ productId: string; quantity: number }>;
  };
}

// EVENT : fait passe, notification a qui veut l'entendre
interface DomainEvent {
  type: string;
  payload: unknown;
  metadata: {
    eventId: string;
    occurredAt: string;
    aggregateId: string;
    version: number;
  };
}

interface OrderCreatedEvent extends DomainEvent {
  type: 'OrderCreated';
  payload: {
    orderId: string;
    userId: string;
    items: Array<{ productId: string; quantity: number }>;
    total: number;
  };
}
```

:::tip Nommage des events
Les events sont toujours au **passe** : `OrderCreated`, `PaymentProcessed`, `UserRegistered`. Si vous ecrivez `CreateOrder` ou `ProcessPayment`, c'est une command, pas un event.
:::

---

## 2. Types d'events

### 2.1 Domain Events

Les domain events representent quelque chose d'important qui s'est passe dans le domaine metier. Ils sont emis par un aggregat.

```typescript
// Domain event : emis par l'aggregat Order
interface OrderShippedEvent extends DomainEvent {
  type: 'OrderShipped';
  payload: {
    orderId: string;
    trackingNumber: string;
    carrier: string;
    estimatedDelivery: string;
  };
}
```

### 2.2 Intégration Events

Les intégration events servent a communiquer entre bounded contexts (entre microservices). Ils sont souvent des versions simplifiees des domain events.

```typescript
// Integration event : publie sur un bus inter-services
interface OrderCompletedIntegrationEvent {
  type: 'ecommerce.order.completed.v1';
  payload: {
    orderId: string;
    customerId: string;
    totalAmount: number;
    currency: string;
  };
}
// Note : pas de details internes du domaine (pas les items individuels)
```

### 2.3 Notification Events

Les notification events ne portent que le minimum d'information. Le consommateur doit rappeler la source s'il veut les details.

```typescript
// Notification event : juste un signal
interface OrderUpdatedNotification {
  type: 'OrderUpdated';
  payload: {
    orderId: string;
    updatedAt: string;
    // Pas de details — le consommateur doit appeler GET /orders/{id}
  };
}
```

```
COMPARAISON DES TYPES D'EVENTS :
====================================

Domain Event :
  { type: "OrderShipped", payload: { orderId, trackingNumber, carrier,
    estimatedDelivery, items: [...], weight, warehouse } }
  → Riche en donnees, interne au domaine

Integration Event :
  { type: "ecommerce.order.completed.v1", payload: { orderId,
    customerId, totalAmount } }
  → Donnees essentielles, entre services

Notification Event :
  { type: "OrderUpdated", payload: { orderId, updatedAt } }
  → Signal minimal, necessite un callback pour les details
```

---

## 3. Event Bus — Implementation in-process

Un event bus decouple les emetteurs des recepteurs au sein d'un même processus. C'est la brique de base avant de passer à un bus distribue.

```typescript
// event-bus.ts — Event bus type-safe en TypeScript

// Definir les events possibles avec une map de types
interface EventMap {
  OrderCreated: { orderId: string; userId: string; total: number };
  OrderPaid: { orderId: string; amount: number; paymentMethod: string };
  OrderShipped: { orderId: string; trackingNumber: string };
  OrderCancelled: { orderId: string; reason: string };
  UserRegistered: { userId: string; email: string };
}

type EventName = keyof EventMap;
type EventHandler<E extends EventName> = (payload: EventMap[E]) => void | Promise<void>;

class EventBus {
  private handlers = new Map<EventName, Set<EventHandler<any>>>();

  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Retourner une fonction de desinscription
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  async emit<E extends EventName>(event: E, payload: EventMap[E]): Promise<void> {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers || eventHandlers.size === 0) {
      console.log(`[EVENT BUS] No handlers for "${event}"`);
      return;
    }

    console.log(`[EVENT BUS] Emitting "${event}" to ${eventHandlers.size} handler(s)`);

    const promises: Promise<void>[] = [];
    for (const handler of eventHandlers) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          promises.push(result);
        }
      } catch (error) {
        console.error(`[EVENT BUS] Handler error for "${event}":`, error);
      }
    }

    // Attendre tous les handlers async
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  listenerCount(event: EventName): number {
    return this.handlers.get(event)?.size || 0;
  }

  removeAllListeners(event?: EventName): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}
```

### 3.1 Utilisation de l'event bus

```typescript
// usage.ts — Brancher des handlers sur le bus

const bus = new EventBus();

// Handler 1 : Envoyer un email de confirmation
bus.on('OrderCreated', async (payload) => {
  console.log(`[EMAIL] Sending confirmation for order ${payload.orderId} to user ${payload.userId}`);
  // await emailService.send(...)
});

// Handler 2 : Mettre a jour les analytics
bus.on('OrderCreated', (payload) => {
  console.log(`[ANALYTICS] New order: ${payload.orderId}, total: ${payload.total}`);
  // analyticsService.track('order_created', payload)
});

// Handler 3 : Reserver le stock
bus.on('OrderCreated', async (payload) => {
  console.log(`[INVENTORY] Reserving stock for order ${payload.orderId}`);
  // await inventoryService.reserve(payload.orderId)
});

// Emettre un evenement — les 3 handlers s'executent
await bus.emit('OrderCreated', {
  orderId: 'ord-001',
  userId: 'usr-042',
  total: 129.99,
});
```

---

## 4. Domain Events Pattern

Les domain events sont emis par les aggregats (entites racine du domaine) quand quelque chose de significatif se produit.

```
┌─────────────────────────────────────────┐
│               Aggregat Order            │
│                                         │
│  confirm() {                            │
│    this.status = 'confirmed';           │
│    this.addEvent(OrderConfirmed);  ◄────── Enregistrer l'event
│  }                                      │
│                                         │
│  pendingEvents: [OrderConfirmed]   ◄────── Stocker jusqu'a la persistance
│                                         │
└───────────────────┬─────────────────────┘
                    │
                    ▼ apres sauvegarde en DB
             ┌─────────────┐
             │  Event Bus  │
             └──────┬──────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
     Email      Analytics   Inventory
     Service    Service     Service
```

```typescript
// domain-events-pattern.ts — Aggregat avec domain events

abstract class AggregateRoot {
  private _pendingEvents: DomainEvent[] = [];

  protected addEvent(event: DomainEvent): void {
    this._pendingEvents.push(event);
  }

  get pendingEvents(): ReadonlyArray<DomainEvent> {
    return this._pendingEvents;
  }

  clearEvents(): void {
    this._pendingEvents = [];
  }
}

class Order extends AggregateRoot {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    private _status: 'draft' | 'confirmed' | 'paid' | 'shipped' | 'cancelled',
    private _items: Array<{ productId: string; quantity: number; price: number }>,
  ) {
    super();
  }

  get status() { return this._status; }
  get total() { return this._items.reduce((sum, i) => sum + i.price * i.quantity, 0); }

  confirm(): void {
    if (this._status !== 'draft') {
      throw new Error(`Cannot confirm order in status "${this._status}"`);
    }
    this._status = 'confirmed';
    this.addEvent({
      type: 'OrderConfirmed',
      payload: { orderId: this.id, userId: this.userId, total: this.total },
      metadata: {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        aggregateId: this.id,
        version: 1,
      },
    });
  }

  cancel(reason: string): void {
    if (this._status === 'shipped') {
      throw new Error('Cannot cancel a shipped order');
    }
    this._status = 'cancelled';
    this.addEvent({
      type: 'OrderCancelled',
      payload: { orderId: this.id, reason },
      metadata: {
        eventId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        aggregateId: this.id,
        version: 2,
      },
    });
  }
}

// Service applicatif : persister puis publier
async function confirmOrder(orderId: string, bus: EventBus): Promise<void> {
  const order = await loadOrderFromDB(orderId);
  order.confirm();

  // 1. Sauvegarder l'etat en base
  await saveOrderToDB(order);

  // 2. Publier les events accumules
  for (const event of order.pendingEvents) {
    await bus.emit(event.type as EventName, event.payload as any);
  }
  order.clearEvents();
}

// Stubs pour l'exemple
async function loadOrderFromDB(_id: string): Promise<Order> {
  return new Order('ord-001', 'usr-042', 'draft', [
    { productId: 'p1', quantity: 2, price: 29.99 },
  ]);
}
async function saveOrderToDB(_order: Order): Promise<void> { /* ... */ }
```

---

## 5. Event Ordering et Idempotence

### 5.1 Ordering

```
PROBLEME D'ORDERING :
======================

Producteur envoie :           Consommateur recoit (desordre reseau) :
  1. OrderCreated               1. OrderCreated
  2. OrderPaid                  3. OrderShipped  ← avant OrderPaid !
  3. OrderShipped               2. OrderPaid

Solutions :
• Numero de sequence (version) dans chaque event
• Traitement dans l'ordre par partition (Kafka) ou stream (Redis)
• Accepter le desordre et rendre les handlers tolerants
```

### 5.2 Idempotence des handlers

```typescript
// idempotent-handler.ts — Handler qui ne traite pas deux fois le meme event

class IdempotentEventHandler {
  private processedEventIds = new Set<string>();

  async handle(event: DomainEvent, processor: (event: DomainEvent) => Promise<void>): Promise<void> {
    const eventId = event.metadata.eventId;

    // Verifier si deja traite
    if (this.processedEventIds.has(eventId)) {
      console.log(`[SKIP] Event ${eventId} deja traite`);
      return;
    }

    await processor(event);

    // Marquer comme traite
    this.processedEventIds.add(eventId);
    console.log(`[DONE] Event ${eventId} traite`);
  }
}

// En production : stocker les IDs en base, pas en memoire
// CREATE TABLE processed_events (event_id UUID PRIMARY KEY, processed_at TIMESTAMP)
```

---

## 6. Designer des events

### 6.1 Conventions de nommage

```
BON NOMMAGE :                           MAUVAIS NOMMAGE :
==============                          ==================
OrderCreated                            CreateOrder (c'est une command)
PaymentProcessed                        PaymentHandler (c'est un handler)
UserEmailVerified                       UpdateUser (trop vague)
InventoryThresholdReached               InventoryChanged (pas specifique)

Format recommande : <Aggregate><ActionPassee>
  Order + Created    = OrderCreated
  Payment + Failed   = PaymentFailed
  Stock + Depleted   = StockDepleted
```

### 6.2 Event versioning

```typescript
// event-versioning.ts — Gerer l'evolution des events

// Version 1 : l'event original
interface OrderCreatedV1 {
  type: 'OrderCreated';
  version: 1;
  payload: { orderId: string; userId: string; total: number };
}

// Version 2 : on ajoute la devise
interface OrderCreatedV2 {
  type: 'OrderCreated';
  version: 2;
  payload: { orderId: string; userId: string; total: number; currency: string };
}

// Upcaster : transformer V1 en V2 pour les anciens events
function upcastOrderCreated(event: OrderCreatedV1): OrderCreatedV2 {
  return {
    ...event,
    version: 2,
    payload: {
      ...event.payload,
      currency: 'EUR', // Valeur par defaut pour les anciens events
    },
  };
}
```

---

## 7. Anti-patterns

:::warning Anti-pattern : Event chains
Des events qui declenchent d'autres events qui declenchent d'autres events... creent un système impossible a debugger. Preferez des handlers qui appellent des commands explicitement plutot que des cascades d'events.
:::

```
ANTI-PATTERN : Event chain infernale
======================================

OrderCreated → InventoryReserved → PaymentRequested → PaymentProcessed
    → ShippingScheduled → WarehouseNotified → ...

Le flux est invisible. Si PaymentProcessed echoue,
il faut tracer toute la chaine pour comprendre le contexte.

MIEUX : Orchestration explicite (Saga)
========================================

OrderSaga :
  1. Recevoir OrderCreated
  2. Envoyer command ReserveInventory → attendre resultat
  3. Envoyer command ProcessPayment → attendre resultat
  4. Envoyer command ScheduleShipping → attendre resultat
  5. Emettre OrderCompleted

Le flux est visible et controlable.
```

---

## Points clés

1. **Commands** sont imperatives ("fais ceci") et adressees à un destinataire. **Events** sont declaratifs ("ceci s'est passe") et diffuses a qui veut.
2. **Domain events** sont riches et internes. **Intégration events** sont simplifies pour la communication inter-services. **Notification events** sont des signaux minimaux.
3. **L'event bus** decouple emetteurs et recepteurs. Il peut etre in-process (même application) ou distribue (Redis, Kafka).
4. **Les domain events** sont emis par les aggregats, accumules, puis publies après la persistance de l'état.
5. **L'idempotence** des handlers est cruciale : chaque handler doit gérer le cas où il recoit le même event deux fois.
6. **Le versioning** des events (V1, V2 + upcasters) permet de faire evoluer le schema sans casser les consommateurs existants.
7. **Les event chains** sont un anti-pattern. Preferez une orchestration explicite (sagas) pour les processus metier complexes.

---

## Navigation

| Précédent | Suivant |
|:---------:|:-------:|
| [06 - Message Queues](./06-communication-asynchrone-message-queues.md) | [08 - API Gateway & BFF](./08-api-gateway-et-bff.md) |

---

<!-- parcours-recommande -->

::: tip Parcours recommandé
1. **Screencast** : [screencast 07 event driven](../screencasts/screencast-07-event-driven.md)
2. **Lab** : [lab-07-event-driven](../labs/lab-07-event-driven/README)
3. **Quiz** : [quiz 07 event driven](../quizzes/quiz-07-event-driven.html)
:::
