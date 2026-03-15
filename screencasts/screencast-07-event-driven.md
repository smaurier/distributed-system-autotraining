# Screencast 07 — Event-Driven Architecture

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/07-event-driven-architecture.md`
- **Lab associe** : Lab 07
- **Prérequis** : Screencast 06

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/07-event-driven-architecture.md` ouvert
- [ ] Terminal supplementaire pour les demos
- [ ] Aucun processus sur les ports 3001-3003

## Script

### [00:00-02:00] Introduction — Events vs Commands

> Au screencast précédent, on a construit un message broker. Mais tous les messages ne sont pas egaux. Il y à une distinction fondamentale entre un événement et une commande. Un événement dit "quelque chose s'est passe" — `OrderCreated`, `PaymentReceived`. Une commande dit "fais quelque chose" — `CreateOrder`, `ProcessPayment`. Cette distinction change la façon dont on conçoit toute l'architecture.

**Action** : Ouvrir le module 07 et afficher la comparaison.

```
EVENEMENTS :                          COMMANDES :
─────────────────────────────         ──────────────────────────────
"OrderCreated"                        "CreateOrder"
→ Quelque chose S'EST passe           → Demande qu'on FASSE quelque chose
→ Immutable, fait accompli            → Peut etre rejetee
→ Le producteur ne sait pas           → Le producteur attend un resultat
  qui ecoute                            du destinataire
→ 0 a N consommateurs                 → Exactement 1 destinataire
→ Passe compose                       → Imperatif
```

> Les événements creent un couplage faible : le producteur ne connait pas les consommateurs. Les commandes creent un couplage plus fort : on s'adresse à un service spécifique. Les deux ont leur place, mais l'event-driven architecture favorise les événements.

### [02:00-06:00] Implementer un Event Bus type

> Construisons un event bus ou chaque événement à une structure forte et des types TypeScript.

**Action** : Créer un fichier `event-bus.ts`.

```typescript
// --- Definir les evenements du domaine ---
interface OrderCreated {
  type: 'OrderCreated';
  data: { orderId: string; userId: string; items: { productId: string; qty: number }[]; total: number };
  metadata: EventMetadata;
}

interface PaymentProcessed {
  type: 'PaymentProcessed';
  data: { orderId: string; amount: number; method: string };
  metadata: EventMetadata;
}

interface InventoryReserved {
  type: 'InventoryReserved';
  data: { orderId: string; items: { productId: string; qty: number }[] };
  metadata: EventMetadata;
}

interface ShipmentScheduled {
  type: 'ShipmentScheduled';
  data: { orderId: string; trackingId: string; estimatedDelivery: string };
  metadata: EventMetadata;
}

interface EventMetadata {
  eventId: string;
  timestamp: number;
  correlationId: string;
  causationId: string;
}

type DomainEvent = OrderCreated | PaymentProcessed | InventoryReserved | ShipmentScheduled;

// --- Event Bus type-safe ---
type EventHandler<T extends DomainEvent> = (event: T) => Promise<void>;

class TypedEventBus {
  private handlers: Map<string, EventHandler<any>[]> = new Map();

  on<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
    console.log(`[EventBus] Handler registered for "${type}"`);
  }

  async emit(event: DomainEvent): Promise<void> {
    console.log(`[EventBus] Emitting "${event.type}" (${event.metadata.eventId})`);
    const handlers = this.handlers.get(event.type) ?? [];

    if (handlers.length === 0) {
      console.log(`[EventBus] No handlers for "${event.type}"`);
      return;
    }

    // Executer tous les handlers en parallele
    const results = await Promise.allSettled(
      handlers.map(h => h(event))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[EventBus] Handler failed: ${result.reason}`);
      }
    }
  }
}
```

> Trois choses importantes. D'abord, les événements sont des types TypeScript discrimines par le champ `type` — le compilateur vérifié l'exhaustivite. Ensuite, la metadata contient un `correlationId` (pour tracer un flux de bout en bout) et un `causationId` (pour savoir quel événement a declenche celui-ci). Enfin, les handlers sont executes avec `Promise.allSettled` — un handler en echec ne bloque pas les autres.

### [06:00-10:00] Domain events — Modeliser un flux metier

> Utilisons l'event bus pour modeliser le flux complet d'une commande e-commerce : création, paiement, reservation de stock, et expedition.

**Action** : Construire le workflow.

```typescript
const bus = new TypedEventBus();

function createMetadata(correlationId: string, causationId?: string): EventMetadata {
  return {
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    correlationId,
    causationId: causationId ?? correlationId,
  };
}

// --- Service de paiement ecoute OrderCreated ---
bus.on<OrderCreated>('OrderCreated', async (event) => {
  console.log(`  [PaymentService] Charging ${event.data.total} EUR for ${event.data.orderId}`);
  // Simuler le traitement du paiement
  await new Promise(r => setTimeout(r, 100));

  // Emettre un nouvel evenement
  await bus.emit({
    type: 'PaymentProcessed',
    data: { orderId: event.data.orderId, amount: event.data.total, method: 'card' },
    metadata: createMetadata(event.metadata.correlationId, event.metadata.eventId),
  });
});

// --- Service d'inventaire ecoute PaymentProcessed ---
bus.on<PaymentProcessed>('PaymentProcessed', async (event) => {
  console.log(`  [InventoryService] Reserving stock for ${event.data.orderId}`);
  await new Promise(r => setTimeout(r, 50));

  await bus.emit({
    type: 'InventoryReserved',
    data: { orderId: event.data.orderId, items: [{ productId: 'p-1', qty: 2 }] },
    metadata: createMetadata(event.metadata.correlationId, event.metadata.eventId),
  });
});

// --- Service d'expedition ecoute InventoryReserved ---
bus.on<InventoryReserved>('InventoryReserved', async (event) => {
  console.log(`  [ShipmentService] Scheduling shipment for ${event.data.orderId}`);

  await bus.emit({
    type: 'ShipmentScheduled',
    data: {
      orderId: event.data.orderId,
      trackingId: `TRACK-${Date.now()}`,
      estimatedDelivery: '2025-01-20',
    },
    metadata: createMetadata(event.metadata.correlationId, event.metadata.eventId),
  });
});

// --- Service de notification ecoute tout ---
bus.on<OrderCreated>('OrderCreated', async (event) => {
  console.log(`  [NotificationService] Email: "Commande ${event.data.orderId} recue"`);
});

bus.on<ShipmentScheduled>('ShipmentScheduled', async (event) => {
  console.log(`  [NotificationService] Email: "Colis ${event.data.trackingId} en route"`);
});
```

**Action** : Declencher le flux en emettant un seul événement.

```typescript
// Un seul evenement declenche toute la chaine
const correlationId = crypto.randomUUID();
await bus.emit({
  type: 'OrderCreated',
  data: {
    orderId: 'order-42',
    userId: 'user-1',
    items: [{ productId: 'p-1', qty: 2 }],
    total: 79.99,
  },
  metadata: createMetadata(correlationId),
});
```

> Regardez la chaine : OrderCreated → PaymentProcessed → InventoryReserved → ShipmentScheduled. Le service de notification ecoute le premier et le dernier. Aucun service ne connait les autres — ils reagissent uniquement aux événements. C'est le couplage faible par excellence.

### [10:00-13:30] Tracing du flux — correlationId en action

> Le `correlationId` permet de reconstruire tout le flux à partir des logs.

**Action** : Montrer le tracing.

```typescript
class EventTracer {
  private events: DomainEvent[] = [];

  record(event: DomainEvent): void {
    this.events.push(event);
  }

  getFlowForCorrelation(correlationId: string): DomainEvent[] {
    return this.events
      .filter(e => e.metadata.correlationId === correlationId)
      .sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);
  }

  printFlow(correlationId: string): void {
    const flow = this.getFlowForCorrelation(correlationId);
    console.log(`\n=== Flow for correlation ${correlationId.slice(0, 8)}... ===`);
    for (const event of flow) {
      const time = new Date(event.metadata.timestamp).toISOString();
      console.log(`  ${time} | ${event.type}`);
      console.log(`    eventId:     ${event.metadata.eventId.slice(0, 8)}...`);
      console.log(`    causationId: ${event.metadata.causationId.slice(0, 8)}...`);
    }
  }
}
```

> En production, ces événements sont dans un système de tracing comme Jaeger ou Zipkin. Le correlationId est propage dans les headers HTTP et les messages queue. On peut reconstruire le parcours complet d'une requête a travers 10 services.

### [13:30-16:00] Anti-patterns et pieges

> L'event-driven architecture a ses pieges. Voyons les deux plus courants.

**Action** : Montrer les anti-patterns dans le code.

```typescript
// Anti-pattern 1 : Evenements trop gros (contiennent tout)
// ❌ L'evenement transporte toutes les donnees
const fatEvent = {
  type: 'OrderCreated',
  data: {
    orderId: 'order-1',
    user: { id: 'u-1', name: 'Alice', address: '...', history: '...' }, // Trop de donnees
    products: [/* liste complete avec images, descriptions... */],
    warehouse: { /* details complets */ },
  },
};

// ✅ L'evenement contient l'essentiel + des references
const leanEvent = {
  type: 'OrderCreated',
  data: {
    orderId: 'order-1',
    userId: 'u-1',        // Reference, pas les donnees completes
    items: [{ productId: 'p-1', qty: 2 }], // References
    total: 79.99,
  },
};

// Anti-pattern 2 : Chaine d'evenements synchrone deguisee
// ❌ Si chaque service attend le resultat du suivant, on a reinvente le RPC
// La chaine doit etre asynchrone et tolerante aux delais
```

> Regle d'or : un événement doit contenir les informations suffisantes pour que le consommateur puisse travailler, mais pas plus. Si un consommateur a besoin de plus, il interroge le service source directement.

### [16:00-17:30] Récapitulatif

> Recapitulons. Les événements disent "quelque chose s'est passe", les commandes disent "fais quelque chose". Un event bus type-safe garantit la coherence à la compilation. Le correlationId et le causationId permettent de tracer les flux. Et les domain events modelisent les processus metier de façon decouplante.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Events = faits passes, Commands = demandes imperatives
2. Event bus type-safe avec TypeScript discriminated unions
3. Metadata = correlationId + causationId + timestamp
4. Domain events declenchent des chaines reactives decouplees
5. Evenements maigres > evenements gras (references > donnees completes)

PROCHAINE ETAPE :
→ Screencast 08 : API Gateway et BFF — le point d'entree unique
```

> Au prochain screencast, on va construire un API Gateway qui orchestre les appels vers nos microservices. C'est le point d'entree unique de notre système. A bientot !

## Points d'attention pour l'enregistrement
- La distinction events vs commands est le concept clé — y passer assez de temps
- Le flux OrderCreated → PaymentProcessed → InventoryReserved → ShipmentScheduled doit etre visualise étape par étape
- Montrer le correlationId qui relie tous les événements — c'est un "aha moment"
- Les anti-patterns sont souvent les erreurs des débutants — les montrer clairement
- Promise.allSettled est un detail important : un handler en echec ne bloque pas les autres
- Garder le code lisible — ne pas tout taper d'un coup, construire incrementalement
