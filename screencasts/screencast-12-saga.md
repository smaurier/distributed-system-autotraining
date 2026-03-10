# Screencast 12 — Transactions Distribuees & Saga Pattern

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/12-transactions-distribuees-saga.md`
- **Lab associe** : Lab 12
- **Prerequis** : Screencast 11

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/12-transactions-distribuees-saga.md` ouvert
- [ ] Navigateur pret pour la visualisation `saga-pattern.html` (si disponible)
- [ ] Terminal supplementaire pour les demos

## Script

### [00:00-02:00] Introduction — Pourquoi le 2PC ne suffit pas

> Dans un monolithe, une transaction SQL classique garantit l'atomicite : soit tout reussit, soit tout est annule. En microservices, chaque service a sa propre base de donnees — pas de transaction globale. Le Two-Phase Commit (2PC) existe, mais il a des problemes majeurs : il est lent, il bloque les participants, et un coordinateur en panne peut bloquer tout le systeme.

**Action** : Ouvrir le module 12 et afficher le diagramme du 2PC et ses problemes.

```
TWO-PHASE COMMIT (2PC) :

Coordinateur ──prepare──► Service A     PROBLEMES :
             ──prepare──► Service B     1. Si le coordinateur crashe apres
             ──prepare──► Service C        le prepare, les services sont
                                          bloques indefiniment
Les 3 repondent "OK"                   2. Latence = somme de toutes les
                                          latences (pas parallelisable)
Coordinateur ──commit───► Service A     3. Verrou sur les ressources
             ──commit───► Service B        pendant toute la transaction
             ──commit───► Service C     4. Point de defaillance unique
```

> Le saga pattern est l'alternative pragmatique : au lieu d'une grosse transaction, on execute une sequence de transactions locales, chacune avec une compensation en cas d'echec.

### [02:00-06:30] Saga par choreographie

> Il y a deux variantes du saga pattern. La choreographie : chaque service ecoute les evenements et reagit. Pas de coordinateur central.

**Action** : Creer un fichier `saga-choreography.ts`.

```typescript
type SagaEventType =
  | 'OrderCreated' | 'OrderCancelled'
  | 'PaymentCharged' | 'PaymentRefunded'
  | 'StockReserved' | 'StockReleased'
  | 'ShipmentScheduled' | 'ShipmentCancelled';

interface SagaEvent {
  type: SagaEventType;
  orderId: string;
  data: Record<string, unknown>;
  timestamp: number;
}

type SagaHandler = (event: SagaEvent) => Promise<void>;

class SagaEventBus {
  private handlers: Map<string, SagaHandler[]> = new Map();
  private eventLog: SagaEvent[] = [];

  on(type: SagaEventType, handler: SagaHandler): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler);
    this.handlers.set(type, existing);
  }

  async emit(event: SagaEvent): Promise<void> {
    this.eventLog.push(event);
    console.log(`[Saga] Event: ${event.type} (order: ${event.orderId})`);
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      await handler(event);
    }
  }
}

const bus = new SagaEventBus();

// --- Order Service ---
async function createOrder(orderId: string, userId: string, total: number) {
  console.log(`  [OrderService] Creating order ${orderId}`);
  await bus.emit({
    type: 'OrderCreated',
    orderId,
    data: { userId, total },
    timestamp: Date.now(),
  });
}

// --- Payment Service ---
bus.on('OrderCreated', async (event) => {
  const total = event.data.total as number;
  console.log(`  [PaymentService] Charging ${total} EUR for ${event.orderId}`);

  // Simuler un echec aleatoire
  if (total > 500) {
    console.log(`  [PaymentService] DECLINED — insufficient funds`);
    await bus.emit({ type: 'PaymentRefunded', orderId: event.orderId, data: { reason: 'declined' }, timestamp: Date.now() });
    return;
  }

  await bus.emit({ type: 'PaymentCharged', orderId: event.orderId, data: { amount: total }, timestamp: Date.now() });
});

// --- Stock Service ---
bus.on('PaymentCharged', async (event) => {
  console.log(`  [StockService] Reserving stock for ${event.orderId}`);
  await bus.emit({ type: 'StockReserved', orderId: event.orderId, data: {}, timestamp: Date.now() });
});

// --- Compensation : annuler la commande si le paiement echoue ---
bus.on('PaymentRefunded', async (event) => {
  console.log(`  [OrderService] COMPENSATING: cancelling order ${event.orderId}`);
  await bus.emit({ type: 'OrderCancelled', orderId: event.orderId, data: { reason: event.data.reason }, timestamp: Date.now() });
});

// Stock compensation si necessaire
bus.on('OrderCancelled', async (event) => {
  console.log(`  [StockService] COMPENSATING: releasing stock for ${event.orderId}`);
});
```

**Action** : Executer le happy path puis le sad path.

```typescript
console.log('\n=== Happy Path (total: 99 EUR) ===');
await createOrder('order-1', 'user-1', 99);

console.log('\n=== Sad Path (total: 999 EUR — declined) ===');
await createOrder('order-2', 'user-1', 999);
```

> Dans le happy path : OrderCreated → PaymentCharged → StockReserved. Dans le sad path : OrderCreated → PaymentRefunded → OrderCancelled → stock release. Chaque service reagit aux evenements sans coordinateur central.

### [06:30-11:00] Saga par orchestration

> La deuxieme variante : l'orchestration. Un coordinateur central (l'orchestrateur) pilote les etapes et gere les compensations.

**Action** : Implementer l'orchestrateur.

```typescript
interface SagaStep {
  name: string;
  execute: (context: Record<string, unknown>) => Promise<void>;
  compensate: (context: Record<string, unknown>) => Promise<void>;
}

class SagaOrchestrator {
  private steps: SagaStep[] = [];
  private executedSteps: SagaStep[] = [];

  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  async execute(context: Record<string, unknown>): Promise<{ success: boolean; context: Record<string, unknown> }> {
    console.log(`[Orchestrator] Starting saga with ${this.steps.length} steps`);

    for (const step of this.steps) {
      try {
        console.log(`[Orchestrator] Executing step: ${step.name}`);
        await step.execute(context);
        this.executedSteps.push(step);
      } catch (err) {
        console.log(`[Orchestrator] Step "${step.name}" FAILED: ${err}`);
        console.log(`[Orchestrator] Starting compensation (${this.executedSteps.length} steps to undo)...`);
        await this.compensate(context);
        return { success: false, context };
      }
    }

    console.log(`[Orchestrator] Saga completed successfully`);
    return { success: true, context };
  }

  private async compensate(context: Record<string, unknown>): Promise<void> {
    // Compenser dans l'ordre inverse
    for (let i = this.executedSteps.length - 1; i >= 0; i--) {
      const step = this.executedSteps[i];
      try {
        console.log(`[Orchestrator] Compensating: ${step.name}`);
        await step.compensate(context);
      } catch (err) {
        console.error(`[Orchestrator] Compensation failed for "${step.name}": ${err}`);
        // En production : alerter, mettre en DLQ, intervention humaine
      }
    }
    console.log(`[Orchestrator] All compensations completed`);
  }
}
```

**Action** : Construire un saga de commande e-commerce.

```typescript
const saga = new SagaOrchestrator();

saga.addStep({
  name: 'validate-order',
  execute: async (ctx) => {
    console.log(`  Validating order ${ctx.orderId}`);
    ctx.validated = true;
  },
  compensate: async (ctx) => {
    console.log(`  Cancelling order ${ctx.orderId}`);
    ctx.validated = false;
  },
});

saga.addStep({
  name: 'charge-payment',
  execute: async (ctx) => {
    const amount = ctx.total as number;
    if (amount > 500) throw new Error('Payment declined');
    console.log(`  Charged ${amount} EUR`);
    ctx.paymentId = `pay-${Date.now()}`;
  },
  compensate: async (ctx) => {
    console.log(`  Refunding payment ${ctx.paymentId}`);
    ctx.paymentId = undefined;
  },
});

saga.addStep({
  name: 'reserve-stock',
  execute: async (ctx) => {
    console.log(`  Reserving stock for order ${ctx.orderId}`);
    ctx.stockReserved = true;
  },
  compensate: async (ctx) => {
    console.log(`  Releasing stock for order ${ctx.orderId}`);
    ctx.stockReserved = false;
  },
});

saga.addStep({
  name: 'schedule-shipment',
  execute: async (ctx) => {
    console.log(`  Scheduling shipment for order ${ctx.orderId}`);
    ctx.trackingId = `TRACK-${Date.now()}`;
  },
  compensate: async (ctx) => {
    console.log(`  Cancelling shipment ${ctx.trackingId}`);
    ctx.trackingId = undefined;
  },
});

// Happy path
console.log('=== Happy Path ===');
await saga.execute({ orderId: 'order-1', total: 99 });

// Sad path — paiement refuse
console.log('\n=== Sad Path (payment failure) ===');
const saga2 = new SagaOrchestrator();
// ... (meme steps)
await saga2.execute({ orderId: 'order-2', total: 999 });
```

> L'orchestrateur est plus facile a comprendre et a debugger que la choreographie. On voit clairement l'ordre des etapes et les compensations. Mais c'est un point de couplage central — si l'orchestrateur crashe, la saga est bloquee.

### [11:00-14:00] Compensating transactions — Les subtilites

> Les compensations ne sont pas simplement "annuler". Certaines actions ne peuvent pas etre inversees — un email envoye ne peut pas etre "des-envoye". Il faut penser les compensations des le design.

**Action** : Montrer les types de compensation.

```typescript
interface CompensationStrategy {
  type: 'undo' | 'counter-action' | 'no-op';
  description: string;
  example: string;
}

const strategies: CompensationStrategy[] = [
  {
    type: 'undo',
    description: 'Annuler directement l\'action',
    example: 'Refund payment: annuler la charge sur la carte',
  },
  {
    type: 'counter-action',
    description: 'Executer une action inverse',
    example: 'Email envoye → envoyer un email d\'annulation',
  },
  {
    type: 'no-op',
    description: 'Rien a compenser (action sans effet de bord)',
    example: 'Validation de donnees → pas de compensation necessaire',
  },
];

for (const s of strategies) {
  console.log(`${s.type.toUpperCase()}: ${s.description}`);
  console.log(`  Exemple: ${s.example}\n`);
}
```

> En pratique, les sagas doivent aussi gerer les compensations qui echouent. Si le refund echoue, il faut un mecanisme de retry avec alerting. C'est pourquoi en production, les orchestrateurs de saga sont souvent combines avec des queues persistantes.

### [14:00-16:00] Choreographie vs Orchestration — Quand choisir quoi

**Action** : Afficher le tableau comparatif.

```
                 CHOREOGRAPHIE              ORCHESTRATION
────────────────────────────────────────────────────────────────
Couplage       | Faible (evenements)      | Fort (orchestrateur)
Visibilite     | Flux distribue (dur a    | Flux centralise (facile
               |   suivre)                |   a suivre)
Scalabilite    | Bonne (pas de bottleneck)| Orchestrateur = bottleneck
Complexite     | Croit vite avec le       | Lineaire avec le nombre
               |   nombre de services     |   d'etapes
Debug          | Difficile (tracer les    | Facile (un seul endroit)
               |   evenements)            |
Cas d'usage    | 2-4 services, flux       | 4+ services, flux complexes,
               |   simples                |   compensations complexes
```

### [16:00-17:30] Recapitulatif

> Recapitulons. Le 2PC est lent et fragile — a eviter en microservices. Le saga pattern decompose une transaction distribuee en etapes locales avec compensations. La choreographie est decouplante mais difficile a debugger. L'orchestration est centralisee mais lisible. Et les compensating transactions doivent etre pensees des le design.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. 2PC = lent, bloquant, point de defaillance unique
2. Saga = sequence de transactions locales + compensations
3. Choreographie = decouplage par evenements, 2-4 services
4. Orchestration = coordinateur central, flux complexes
5. Compensations ≠ "annuler" — penser undo, counter-action, no-op

PROCHAINE ETAPE :
→ Screencast 13 : CQRS & Event Sourcing
```

> Au prochain screencast, on va decouvrir CQRS et l'event sourcing — deux patterns qui changent radicalement la facon de penser les donnees en distribue. A bientot !

## Points d'attention pour l'enregistrement
- Le diagramme du 2PC et ses problemes doit etre montre clairement en intro
- Executer le happy path ET le sad path de la choreographie — les deux sont importants
- L'orchestrateur est plus visuel : les logs montrent clairement l'ordre et les compensations
- Bien insister sur les compensations qui ne sont pas de simples "undo"
- Le tableau choreographie vs orchestration est un aide-memoire precieux — le laisser visible
- Si la visualisation saga existe, la montrer pour le workflow complet
