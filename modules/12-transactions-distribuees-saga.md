# Module 12 : Saga Pattern

> **Difficulty** : 4/5 | **Duration estimee** : 4h | **Prerequis** : Modules 1-11

---

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

1. Expliquer pourquoi les transactions distribuees classiques (2PC) posent probleme a grande echelle
2. Decrire le protocole Two-Phase Commit et ses limitations
3. Implementer le pattern Saga en choreographie et en orchestration
4. Concevoir des transactions compensatoires (semantic rollback)
5. Gerer les erreurs dans les sagas (timeouts, retries, dead letter)
6. Choisir entre choreographie et orchestration selon le contexte

---

## 1. Le probleme : les transactions distribuees

Dans une architecture microservices, une operation metier traverse souvent **plusieurs services** avec chacun sa propre base de donnees. Comment garantir l'atomicite (tout ou rien) quand il n'y a pas de base de donnees commune ?

```
  Commande e-commerce :

  +----------+    +----------+    +----------+    +----------+
  | Service  |    | Service  |    | Service  |    | Service  |
  | Orders   |    | Payment  |    | Stock    |    | Shipping |
  | (DB 1)   |    | (DB 2)   |    | (DB 3)   |    | (DB 4)   |
  +----------+    +----------+    +----------+    +----------+

  Probleme : si le paiement reussit mais le stock est epuise,
  comment "annuler" le paiement ?
```

---

## 2. Two-Phase Commit (2PC)

Le 2PC est le protocole classique pour les transactions distribuees. Il utilise un **coordinateur** qui orchestre la decision de commit ou abort.

### 2.1 Le protocole

```
  Phase 1 : PREPARE (vote)
  ========================

  Coordinator                Participants
      |                     P1    P2    P3
      |--- PREPARE -------->|     |     |
      |--- PREPARE -------->|---->|     |
      |--- PREPARE -------->|---->|---->|
      |                     |     |     |
      |<--- VOTE YES -------|     |     |
      |<--- VOTE YES --------------|     |
      |<--- VOTE YES --------------------|
      |
  Si tous YES => Phase 2 COMMIT
  Si un seul NO => Phase 2 ABORT

  Phase 2 : COMMIT (ou ABORT)
  ============================

  Coordinator                Participants
      |                     P1    P2    P3
      |--- COMMIT --------->|     |     |
      |--- COMMIT --------->|---->|     |
      |--- COMMIT --------->|---->|---->|
      |                     |     |     |
      |<--- ACK ------------|     |     |
      |<--- ACK -------------------|     |
      |<--- ACK ------------------------|
```

```typescript
type Vote = 'YES' | 'NO';
type TxState = 'INIT' | 'PREPARING' | 'COMMITTING' | 'ABORTING' | 'DONE';

interface Participant {
  id: string;
  prepare(txId: string): Promise<Vote>;
  commit(txId: string): Promise<void>;
  abort(txId: string): Promise<void>;
}

class TwoPhaseCommitCoordinator {
  private participants: Participant[] = [];
  private state: TxState = 'INIT';
  private txLog: Array<{ txId: string; state: TxState; timestamp: number }> =
    [];

  addParticipant(participant: Participant): void {
    this.participants.push(participant);
  }

  async execute(txId: string): Promise<boolean> {
    this.state = 'PREPARING';
    this.log(txId, 'PREPARING');

    // Phase 1: Prepare
    const votes = await Promise.all(
      this.participants.map(async (p) => {
        try {
          return { id: p.id, vote: await p.prepare(txId) };
        } catch {
          return { id: p.id, vote: 'NO' as Vote };
        }
      })
    );

    const allYes = votes.every((v) => v.vote === 'YES');

    if (allYes) {
      // Phase 2: Commit
      this.state = 'COMMITTING';
      this.log(txId, 'COMMITTING');

      await Promise.all(
        this.participants.map((p) => p.commit(txId))
      );

      this.state = 'DONE';
      this.log(txId, 'DONE');
      return true;
    } else {
      // Phase 2: Abort
      this.state = 'ABORTING';
      this.log(txId, 'ABORTING');

      await Promise.all(
        this.participants.map((p) => p.abort(txId))
      );

      this.state = 'DONE';
      this.log(txId, 'DONE');
      return false;
    }
  }

  private log(txId: string, state: TxState): void {
    this.txLog.push({ txId, state, timestamp: Date.now() });
  }
}
```

### 2.2 Les problemes du 2PC

:::warning
Le 2PC a des limitations serieuses dans un systeme distribue a grande echelle :

1. **Blocking** : si le coordinateur tombe en panne entre les deux phases, tous les participants restent bloques (locks maintenus)
2. **Single Point of Failure** : le coordinateur est critique
3. **Latence** : au minimum 2 allers-retours reseau
4. **Scalabilite** : les locks sont maintenus pendant toute la duree du protocole
5. **Couplage fort** : tous les participants doivent etre disponibles simultanement
:::

```
  Scenario de blocage du 2PC :

  Coordinator                 P1          P2
      |--- PREPARE --------->|            |
      |--- PREPARE --------->|----------->|
      |<--- YES -------------|            |
      |<--- YES ----------------------------|
      |                                      |
      X (coordinateur crash!)                |
      |                                      |
      ???  P1 et P2 ont vote YES             |
           mais ne savent pas s'il faut      |
           COMMIT ou ABORT                   |
           => BLOQUES avec les locks !       |
```

---

## 3. Le pattern Saga

Le pattern Saga (Hector Garcia-Molina, 1987) decompose une transaction distribuee en une **sequence de transactions locales**, chacune avec une **transaction compensatoire** en cas d'echec.

```
  Transaction distribuee classique :
  [  T1 + T2 + T3 + T4  ] => COMMIT ou ABORT atomique

  Saga :
  T1 -> T2 -> T3 -> T4 => Succes !

  Si T3 echoue :
  T1 -> T2 -> T3(fail) -> C2 -> C1 => Compensation !

  Ci = compensation de Ti (annulation semantique)
```

:::tip
Contrairement au 2PC, les sagas ne maintiennent **aucun lock distribue**. Chaque etape est une transaction locale independante. L'isolation est sacrifiee au profit de la disponibilite et de la scalabilite.
:::

---

## 4. Choreographie vs Orchestration

Il existe deux facons d'implementer une saga :

### 4.1 Comparaison

```
  CHOREOGRAPHIE                    ORCHESTRATION
  ===============                  ==============

  Chaque service ecoute des        Un orchestrateur central
  evenements et reagit.            dirige chaque etape.

  +--------+  event  +--------+   +-------------+
  |Order   |-------->|Payment |   |   Saga      |
  |Service |         |Service |   | Orchestrator|
  +--------+         +--------+   +------+------+
      ^                  |               |
      |    event         |        cmd    |    cmd
      |                  v               v         v
  +--------+         +--------+   +--------+ +--------+
  |Shipping|<--------|Stock   |   |Order   | |Payment |
  |Service |  event  |Service |   |Service | |Service |
  +--------+         +--------+   +--------+ +--------+
                                       ^         |
  Decentralise, chaque service         |   cmd   |
  connait le service suivant.          v         v
                                  +--------+ +--------+
  Pas de point central de         |Stock   | |Shipping|
  defaillance.                    |Service | |Service |
                                  +--------+ +--------+
```

```
  +--------------------+-------------------------+-------------------------+
  | Critere            | Choreographie           | Orchestration           |
  +--------------------+-------------------------+-------------------------+
  | Couplage           | Faible (evenements)     | Moyen (orchestrateur)   |
  | Complexite         | Distribuee (dure a      | Centralisee (visible    |
  |                    | suivre)                 | dans l'orchestrateur)   |
  | Point de defail.   | Aucun point central     | L'orchestrateur         |
  | Visibilite         | Difficile a debugger    | Facile a debugger       |
  | Scalabilite        | Excellente              | Bonne                   |
  | Cas d'usage        | Sagas simples (2-3      | Sagas complexes (4+     |
  |                    | etapes)                 | etapes, branches)       |
  +--------------------+-------------------------+-------------------------+
```

---

## 5. Implementation : Saga par choreographie

```typescript
// Types de base
interface SagaEvent {
  type: string;
  payload: Record<string, unknown>;
  sagaId: string;
  timestamp: number;
}

type EventHandler = (event: SagaEvent) => Promise<SagaEvent | null>;

class EventBus {
  private handlers: Map<string, EventHandler[]> = new Map();
  private eventLog: SagaEvent[] = [];

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async publish(event: SagaEvent): Promise<void> {
    this.eventLog.push(event);
    console.log(`[EventBus] ${event.type} (saga: ${event.sagaId})`);

    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      const resultEvent = await handler(event);
      if (resultEvent) {
        await this.publish(resultEvent); // Chain events
      }
    }
  }

  getLog(): SagaEvent[] {
    return [...this.eventLog];
  }
}

// --- Order Service ---
class OrderService {
  private orders: Map<string, { status: string; amount: number }> = new Map();

  constructor(private bus: EventBus) {
    // React to compensation events
    bus.subscribe('PAYMENT_FAILED', async (event) => {
      return this.cancelOrder(event);
    });
    bus.subscribe('STOCK_RESERVATION_FAILED', async (event) => {
      return this.cancelOrder(event);
    });
  }

  async createOrder(
    sagaId: string,
    orderId: string,
    amount: number
  ): Promise<void> {
    this.orders.set(orderId, { status: 'PENDING', amount });

    await this.bus.publish({
      type: 'ORDER_CREATED',
      payload: { orderId, amount },
      sagaId,
      timestamp: Date.now(),
    });
  }

  private async cancelOrder(event: SagaEvent): Promise<SagaEvent | null> {
    const orderId = event.payload.orderId as string;
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'CANCELLED';
      console.log(`  [OrderService] Order ${orderId} cancelled`);
    }
    return {
      type: 'ORDER_CANCELLED',
      payload: { orderId },
      sagaId: event.sagaId,
      timestamp: Date.now(),
    };
  }
}

// --- Payment Service ---
class PaymentService {
  private payments: Map<string, { status: string }> = new Map();

  constructor(private bus: EventBus) {
    bus.subscribe('ORDER_CREATED', async (event) => {
      return this.processPayment(event);
    });

    // Compensation: refund if stock fails
    bus.subscribe('STOCK_RESERVATION_FAILED', async (event) => {
      return this.refundPayment(event);
    });
  }

  private async processPayment(event: SagaEvent): Promise<SagaEvent> {
    const { orderId, amount } = event.payload as {
      orderId: string;
      amount: number;
    };

    // Simulate payment (fail if amount > 1000 for demo)
    if (amount > 1000) {
      console.log(`  [PaymentService] Payment FAILED for ${orderId}`);
      return {
        type: 'PAYMENT_FAILED',
        payload: { orderId, reason: 'Insufficient funds' },
        sagaId: event.sagaId,
        timestamp: Date.now(),
      };
    }

    this.payments.set(orderId, { status: 'CHARGED' });
    console.log(`  [PaymentService] Payment OK for ${orderId}`);

    return {
      type: 'PAYMENT_COMPLETED',
      payload: { orderId, amount },
      sagaId: event.sagaId,
      timestamp: Date.now(),
    };
  }

  private async refundPayment(event: SagaEvent): Promise<SagaEvent> {
    const orderId = event.payload.orderId as string;
    const payment = this.payments.get(orderId);

    if (payment) {
      payment.status = 'REFUNDED';
      console.log(`  [PaymentService] Refund for ${orderId}`);
    }

    return {
      type: 'PAYMENT_REFUNDED',
      payload: { orderId },
      sagaId: event.sagaId,
      timestamp: Date.now(),
    };
  }
}

// --- Stock Service ---
class StockService {
  private inventory: Map<string, number> = new Map([['ITEM-A', 5]]);

  constructor(private bus: EventBus) {
    bus.subscribe('PAYMENT_COMPLETED', async (event) => {
      return this.reserveStock(event);
    });
  }

  private async reserveStock(event: SagaEvent): Promise<SagaEvent> {
    const orderId = event.payload.orderId as string;
    const currentStock = this.inventory.get('ITEM-A') ?? 0;

    if (currentStock <= 0) {
      console.log(`  [StockService] No stock for ${orderId}`);
      return {
        type: 'STOCK_RESERVATION_FAILED',
        payload: { orderId, reason: 'Out of stock' },
        sagaId: event.sagaId,
        timestamp: Date.now(),
      };
    }

    this.inventory.set('ITEM-A', currentStock - 1);
    console.log(
      `  [StockService] Stock reserved for ${orderId} ` +
      `(remaining: ${currentStock - 1})`
    );

    return {
      type: 'STOCK_RESERVED',
      payload: { orderId },
      sagaId: event.sagaId,
      timestamp: Date.now(),
    };
  }
}
```

---

## 6. Implementation : Saga par orchestration

```typescript
type SagaStepStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'COMPENSATED';

interface SagaStep {
  name: string;
  execute: (context: SagaContext) => Promise<boolean>;
  compensate: (context: SagaContext) => Promise<void>;
  status: SagaStepStatus;
}

interface SagaContext {
  sagaId: string;
  data: Record<string, unknown>;
  log: Array<{ step: string; action: string; timestamp: number }>;
}

class SagaOrchestrator {
  private steps: SagaStep[] = [];

  addStep(
    name: string,
    execute: (ctx: SagaContext) => Promise<boolean>,
    compensate: (ctx: SagaContext) => Promise<void>
  ): this {
    this.steps.push({ name, execute, compensate, status: 'PENDING' });
    return this;
  }

  async run(initialData: Record<string, unknown> = {}): Promise<{
    success: boolean;
    context: SagaContext;
  }> {
    const context: SagaContext = {
      sagaId: `saga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      data: { ...initialData },
      log: [],
    };

    console.log(`\n=== Saga ${context.sagaId} started ===\n`);

    let lastCompletedIndex = -1;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      console.log(`[Step ${i + 1}/${this.steps.length}] ${step.name}...`);

      try {
        const success = await step.execute(context);
        context.log.push({
          step: step.name,
          action: 'EXECUTE',
          timestamp: Date.now(),
        });

        if (success) {
          step.status = 'SUCCESS';
          lastCompletedIndex = i;
          console.log(`  => SUCCESS`);
        } else {
          step.status = 'FAILED';
          console.log(`  => FAILED`);
          break;
        }
      } catch (error) {
        step.status = 'FAILED';
        context.data.error =
          error instanceof Error ? error.message : String(error);
        console.log(`  => ERROR: ${context.data.error}`);
        break;
      }
    }

    // If not all steps succeeded, compensate in reverse order
    const allSucceeded = this.steps.every((s) => s.status === 'SUCCESS');

    if (!allSucceeded && lastCompletedIndex >= 0) {
      console.log(`\n--- Compensating (rolling back) ---\n`);

      for (let i = lastCompletedIndex; i >= 0; i--) {
        const step = this.steps[i];
        if (step.status === 'SUCCESS') {
          console.log(`[Compensate] ${step.name}...`);
          try {
            await step.compensate(context);
            step.status = 'COMPENSATED';
            context.log.push({
              step: step.name,
              action: 'COMPENSATE',
              timestamp: Date.now(),
            });
            console.log(`  => COMPENSATED`);
          } catch (err) {
            console.error(
              `  => COMPENSATION FAILED for ${step.name}: ${err}`
            );
            // In production: alert, manual intervention, dead letter queue
          }
        }
      }
    }

    const success = allSucceeded;
    console.log(
      `\n=== Saga ${context.sagaId} ${success ? 'COMPLETED' : 'ROLLED BACK'} ===\n`
    );

    return { success, context };
  }
}

// --- Usage: Order Creation Saga ---
function createOrderSaga(): SagaOrchestrator {
  const saga = new SagaOrchestrator();

  saga
    .addStep(
      'Create Order',
      async (ctx) => {
        ctx.data.orderId = `ORD-${Date.now()}`;
        ctx.data.orderStatus = 'CREATED';
        return true;
      },
      async (ctx) => {
        ctx.data.orderStatus = 'CANCELLED';
        console.log(`    Order ${ctx.data.orderId} cancelled`);
      }
    )
    .addStep(
      'Reserve Stock',
      async (ctx) => {
        const stock = (ctx.data.availableStock as number) ?? 10;
        const qty = (ctx.data.quantity as number) ?? 1;
        if (stock < qty) return false;
        ctx.data.availableStock = stock - qty;
        ctx.data.stockReserved = true;
        return true;
      },
      async (ctx) => {
        const stock = (ctx.data.availableStock as number) ?? 0;
        const qty = (ctx.data.quantity as number) ?? 1;
        ctx.data.availableStock = stock + qty;
        ctx.data.stockReserved = false;
        console.log(`    Stock restored (+${qty})`);
      }
    )
    .addStep(
      'Process Payment',
      async (ctx) => {
        const amount = ctx.data.amount as number;
        if (amount > 500) {
          throw new Error('Payment declined: amount exceeds limit');
        }
        ctx.data.paymentId = `PAY-${Date.now()}`;
        ctx.data.paymentStatus = 'CHARGED';
        return true;
      },
      async (ctx) => {
        ctx.data.paymentStatus = 'REFUNDED';
        console.log(`    Payment ${ctx.data.paymentId} refunded`);
      }
    )
    .addStep(
      'Schedule Shipping',
      async (ctx) => {
        ctx.data.shippingId = `SHIP-${Date.now()}`;
        ctx.data.shippingStatus = 'SCHEDULED';
        return true;
      },
      async (ctx) => {
        ctx.data.shippingStatus = 'CANCELLED';
        console.log(`    Shipping ${ctx.data.shippingId} cancelled`);
      }
    );

  return saga;
}

// Execution example
async function runExample(): Promise<void> {
  // Successful saga
  console.log('========== Scenario 1: Success ==========');
  const saga1 = createOrderSaga();
  await saga1.run({ amount: 200, quantity: 2, availableStock: 10 });

  // Failed saga (payment declined)
  console.log('========== Scenario 2: Payment Failure ==========');
  const saga2 = createOrderSaga();
  await saga2.run({ amount: 600, quantity: 1, availableStock: 10 });
}
```

---

## 7. Transactions compensatoires

La compensation n'est **pas** un rollback technique (UNDO). C'est une action metier qui **annule semantiquement** l'effet de l'etape precedente.

```
  +-------------------+---------------------------+
  | Etape             | Compensation              |
  +-------------------+---------------------------+
  | Debiter compte    | Crediter compte (refund)  |
  | Reserver stock    | Liberer stock             |
  | Envoyer email     | Envoyer email annulation  |
  | Creer facture     | Creer avoir (credit note) |
  | Reserver vol      | Annuler reservation       |
  +-------------------+---------------------------+
```

:::warning
Certaines actions sont **non-compensables** : un email envoye ne peut pas etre "desenvoye". Dans ce cas, concevez les compensations comme des actions correctrices (envoyer un email d'annulation) plutot que des annulations pures.
:::

```typescript
interface CompensableAction<T> {
  name: string;
  execute: () => Promise<T>;
  compensate: (result: T) => Promise<void>;
  isCompensable: boolean;
}

class CompensableTransaction {
  private actions: CompensableAction<unknown>[] = [];
  private results: unknown[] = [];

  add<T>(action: CompensableAction<T>): this {
    this.actions.push(action as CompensableAction<unknown>);
    return this;
  }

  async execute(): Promise<{ success: boolean; results: unknown[] }> {
    this.results = [];

    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];

      try {
        const result = await action.execute();
        this.results.push(result);
      } catch (error) {
        console.error(`Action "${action.name}" failed: ${error}`);
        await this.compensateFrom(i - 1);
        return { success: false, results: this.results };
      }
    }

    return { success: true, results: this.results };
  }

  private async compensateFrom(index: number): Promise<void> {
    for (let i = index; i >= 0; i--) {
      const action = this.actions[i];
      const result = this.results[i];

      if (action.isCompensable) {
        try {
          await action.compensate(result);
          console.log(`  Compensated: ${action.name}`);
        } catch (err) {
          console.error(
            `  FAILED to compensate "${action.name}": ${err}`
          );
          // Log for manual resolution
        }
      } else {
        console.warn(
          `  "${action.name}" is NOT compensable — manual intervention needed`
        );
      }
    }
  }
}
```

---

## 8. Gestion des erreurs dans les sagas

### 8.1 Timeouts

```typescript
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stepName: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Step "${stepName}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
```

### 8.2 Retries avec backoff

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    stepName: string;
  }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < options.maxRetries) {
        const delay = Math.min(
          options.baseDelay * Math.pow(2, attempt),
          options.maxDelay
        );
        const jitter = delay * (0.5 + Math.random() * 0.5);
        console.log(
          `  Retry ${attempt + 1}/${options.maxRetries} ` +
          `for "${options.stepName}" in ${Math.round(jitter)}ms`
        );
        await new Promise((r) => setTimeout(r, jitter));
      }
    }
  }

  throw lastError;
}
```

### 8.3 Dead Letter Queue

```typescript
interface DeadLetterEntry {
  sagaId: string;
  stepName: string;
  error: string;
  payload: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
}

class DeadLetterQueue {
  private queue: DeadLetterEntry[] = [];

  add(entry: DeadLetterEntry): void {
    this.queue.push(entry);
    console.log(
      `[DLQ] Added failed saga step: ${entry.stepName} ` +
      `(saga: ${entry.sagaId})`
    );
  }

  getEntries(): DeadLetterEntry[] {
    return [...this.queue];
  }

  async processEntry(
    index: number,
    handler: (entry: DeadLetterEntry) => Promise<boolean>
  ): Promise<boolean> {
    const entry = this.queue[index];
    if (!entry) return false;

    const success = await handler(entry);
    if (success) {
      this.queue.splice(index, 1);
    } else {
      entry.retryCount++;
    }
    return success;
  }

  size(): number {
    return this.queue.length;
  }
}
```

---

## 9. Saga Execution Log

Pour le monitoring et le debugging, il est essentiel de tracer l'execution de chaque saga.

```typescript
type SagaLogLevel = 'INFO' | 'WARN' | 'ERROR';

interface SagaLogEntry {
  sagaId: string;
  step: string;
  action: 'EXECUTE' | 'COMPENSATE' | 'RETRY' | 'TIMEOUT' | 'DLQ';
  level: SagaLogLevel;
  message: string;
  timestamp: number;
  duration?: number;
}

class SagaExecutionLog {
  private entries: SagaLogEntry[] = [];

  append(entry: SagaLogEntry): void {
    this.entries.push(entry);
  }

  getBySagaId(sagaId: string): SagaLogEntry[] {
    return this.entries.filter((e) => e.sagaId === sagaId);
  }

  getFailedSagas(): string[] {
    const sagaIds = new Set<string>();
    for (const entry of this.entries) {
      if (entry.level === 'ERROR') {
        sagaIds.add(entry.sagaId);
      }
    }
    return Array.from(sagaIds);
  }

  printTimeline(sagaId: string): void {
    const sagaEntries = this.getBySagaId(sagaId);
    console.log(`\nTimeline for saga ${sagaId}:`);
    console.log('─'.repeat(60));

    for (const entry of sagaEntries) {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      const icon =
        entry.level === 'ERROR'
          ? '[X]'
          : entry.level === 'WARN'
            ? '[!]'
            : '[+]';
      const duration = entry.duration ? ` (${entry.duration}ms)` : '';
      console.log(
        `  ${time} ${icon} ${entry.action.padEnd(12)} ${entry.step}${duration}`
      );
      if (entry.message) {
        console.log(`             ${entry.message}`);
      }
    }

    console.log('─'.repeat(60));
  }
}
```

---

## Recapitulatif

| Concept | Cle a retenir |
|---------|---------------|
| 2PC | Atomique mais bloquant, ne scale pas |
| Saga | Sequence de transactions locales + compensations |
| Choreographie | Decentralise, event-driven, simple mais dur a debugger |
| Orchestration | Centralise, visible, adapte aux sagas complexes |
| Compensation | Annulation semantique, pas technique |
| Dead Letter Queue | Filet de securite pour les echecs non-recuperables |

---

## Liens

- [Lab 12 : Implementer une saga orchestree complete](../labs/lab-12-saga-pattern/)
- [Quiz 12 : Testez vos connaissances](../quizzes/quiz-12-saga.html)
- [Module suivant : CQRS & Event Sourcing](./13-cqrs-event-sourcing.md)
- [Visualisation interactive : Saga Orchestration](../visualizations/saga-orchestration.html)
- [Module precedent : Replication & Partitionnement](./11-replication-et-partitionnement.md)
