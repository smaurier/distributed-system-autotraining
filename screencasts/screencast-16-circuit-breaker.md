# Screencast 16 — Circuit Breaker, Bulkhead & Backpressure

## Informations
- **Duree estimee** : 18-20 min
- **Module** : `modules/16-circuit-breaker.md`
- **Lab associe** : Lab 16
- **Prerequis** : Screencast 15

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `labs/lab-16-circuit-breaker/` pret
- [ ] Aucun processus sur les ports 3000-3005
- [ ] Visualisation circuit-breaker prete (si disponible dans `visualizations/`)

## Script

### [00:00-02:00] Introduction — Le disjoncteur logiciel

> Au screencast precedent, on a vu comment les pannes en cascade peuvent detruire un systeme entier en quelques secondes. Le circuit breaker est la protection numero un contre ce scenario. Il fonctionne exactement comme un disjoncteur electrique : quand trop d'erreurs se produisent, il "ouvre le circuit" et empeche les requetes d'atteindre un service defaillant.

**Action** : Afficher le diagramme de la machine a etats du module 16 (Closed, Open, Half-Open).

> La machine a etats a trois positions. Closed : tout fonctionne normalement, les requetes passent. Open : le service est considere en panne, les requetes echouent immediatement. Half-Open : on laisse passer quelques requetes de test pour verifier si le service est revenu.

### [02:00-08:00] Construire la machine a etats du circuit breaker

**Action** : Creer un fichier `circuit-breaker.ts`.

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;    // Nombre d'echecs avant ouverture
  recoveryTimeout: number;     // Temps avant de tester (ms)
  halfOpenMaxAttempts: number;  // Requetes de test en half-open
  successThreshold: number;    // Succes necessaires pour fermer
}

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(
    private name: string,
    private options: CircuitBreakerOptions
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.shouldAttemptRecovery()) {
        this.transitionTo('HALF_OPEN');
      } else {
        throw new Error(`Circuit ${this.name} is OPEN — failing fast`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
      throw new Error(`Circuit ${this.name} is HALF_OPEN — max test attempts reached`);
    }

    try {
      if (this.state === 'HALF_OPEN') this.halfOpenAttempts++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      console.log(`  [${this.name}] HALF_OPEN success ${this.successCount}/${this.options.successThreshold}`);
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else {
      this.failureCount = 0; // Reset en cas de succes
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    console.log(`  [${this.name}] Failure ${this.failureCount}/${this.options.failureThreshold}`);

    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
    } else if (this.failureCount >= this.options.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private shouldAttemptRecovery(): boolean {
    return Date.now() - this.lastFailureTime >= this.options.recoveryTimeout;
  }

  private transitionTo(newState: CircuitState): void {
    console.log(`  [${this.name}] ${this.state} => ${newState}`);
    this.state = newState;
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    }
    if (newState === 'HALF_OPEN') {
      this.halfOpenAttempts = 0;
      this.successCount = 0;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
```

**Action** : Tester la machine a etats avec un service qui echoue puis revient.

```typescript
const breaker = new CircuitBreaker('payment-api', {
  failureThreshold: 3,
  recoveryTimeout: 2000,
  halfOpenMaxAttempts: 2,
  successThreshold: 2,
});

// Simuler un service instable
let callCount = 0;
async function unreliableService(): Promise<string> {
  callCount++;
  if (callCount <= 5) throw new Error('Service unavailable');
  return 'OK';
}

// Boucle de test
for (let i = 1; i <= 10; i++) {
  try {
    const result = await breaker.execute(() => unreliableService());
    console.log(`Request ${i}: ${result} [state: ${breaker.getState()}]`);
  } catch (error: any) {
    console.log(`Request ${i}: FAILED — ${error.message} [state: ${breaker.getState()}]`);
  }
  await new Promise(r => setTimeout(r, 500));
}
```

> Observez les transitions : CLOSED apres 3 echecs, il passe OPEN. Ensuite il attend le recoveryTimeout, passe en HALF_OPEN, teste quelques requetes, et si elles reussissent, revient en CLOSED.

### [08:00-12:00] Bulkhead — Isoler les ressources

> Le bulkhead est inspire de la construction navale : les cloisons etanches empechent un trou dans la coque de couler tout le navire. En logiciel, on isole les pools de connexions par dependance pour qu'un service lent ne consomme pas toutes les ressources.

**Action** : Implementer un bulkhead a base de semaphore.

```typescript
class Bulkhead {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(
    private name: string,
    private maxConcurrent: number,
    private maxQueue: number = 10
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.current >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        throw new Error(`Bulkhead ${this.name} full: ${this.current} executing, ${this.queue.length} queued`);
      }
      // Attendre qu'un slot se libere
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.current++;
    console.log(`  [${this.name}] ${this.current}/${this.maxConcurrent} slots used`);

    try {
      return await fn();
    } finally {
      this.current--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Usage : chaque dependance a son propre bulkhead
const paymentBulkhead = new Bulkhead('payment', 5);
const inventoryBulkhead = new Bulkhead('inventory', 10);
const notificationBulkhead = new Bulkhead('notification', 3);
```

**Action** : Lancer 20 requetes simultanees et montrer que le bulkhead limite la concurrence.

> Si le payment-service ralentit et utilise ses 5 slots, les requetes vers inventory-service et notification-service continuent normalement. Sans bulkhead, le payment-service lent aurait consomme tous les threads du pool global.

### [12:00-15:30] Backpressure — Signaler la surcharge

> La backpressure est le mecanisme par lequel un systeme surcharge signale a ses clients qu'il faut ralentir. Au lieu de tout accepter et s'ecrouler, le systeme dit "je suis plein, reviens plus tard".

**Action** : Implementer une bounded queue avec strategies de backpressure.

```typescript
type BackpressureStrategy = 'buffer' | 'drop-newest' | 'drop-oldest' | 'signal';

class BoundedQueue<T> {
  private items: T[] = [];

  constructor(
    private maxSize: number,
    private strategy: BackpressureStrategy
  ) {}

  enqueue(item: T): { accepted: boolean; dropped?: T } {
    if (this.items.length < this.maxSize) {
      this.items.push(item);
      return { accepted: true };
    }

    switch (this.strategy) {
      case 'drop-newest':
        console.log('  Backpressure: dropping newest item');
        return { accepted: false, dropped: item };

      case 'drop-oldest':
        const dropped = this.items.shift()!;
        this.items.push(item);
        console.log('  Backpressure: dropped oldest item');
        return { accepted: true, dropped };

      case 'signal':
        console.log('  Backpressure: signaling producer to slow down');
        return { accepted: false };

      case 'buffer':
      default:
        this.items.push(item); // Depasse la limite (dangereux)
        console.log(`  WARNING: buffer overflow (${this.items.length}/${this.maxSize})`);
        return { accepted: true };
    }
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }
}
```

**Action** : Demontrer chaque strategie avec un producteur rapide et un consommateur lent.

> La strategie "signal" est la plus propre — elle correspond au HTTP 429 (Too Many Requests) ou au mecanisme de flow control de HTTP/2 et gRPC.

### [15:30-18:00] Combiner les trois — Defense en profondeur

> En production, on combine les trois patterns. Le circuit breaker protege contre les services en panne. Le bulkhead isole les ressources par dependance. Et la backpressure protege chaque service individuellement contre la surcharge.

**Action** : Montrer la combinaison des trois.

```typescript
class ResilientClient {
  constructor(
    private breaker: CircuitBreaker,
    private bulkhead: Bulkhead
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    // 1. Le circuit breaker verifie si le service est up
    return this.breaker.execute(async () => {
      // 2. Le bulkhead limite la concurrence
      return this.bulkhead.execute(async () => {
        // 3. L'appel reel avec timeout
        return fn();
      });
    });
  }
}

const client = new ResilientClient(
  new CircuitBreaker('payment', { failureThreshold: 3, recoveryTimeout: 5000, halfOpenMaxAttempts: 2, successThreshold: 2 }),
  new Bulkhead('payment', 5)
);
```

**Action** : Ouvrir la visualisation du circuit breaker (si disponible) et montrer les transitions en temps reel.

### [18:00-19:30] Recapitulatif et lien avec le Lab 16

> Trois patterns, trois niveaux de protection. Le circuit breaker empeche d'appeler un service mort. Le bulkhead empeche un service lent de tout bloquer. La backpressure empeche la surcharge. Ensemble, ils forment une defense en profondeur contre les pannes en cascade.

**Action** : Ouvrir le README du Lab 16.

> Dans le lab, vous allez construire ces trois composants de zero et les tester avec des simulations de pannes. Mettez la video en pause et lancez-vous !

## Points d'attention pour l'enregistrement
- La machine a etats du circuit breaker est le coeur : prendre le temps de bien montrer chaque transition
- Utiliser des console.log colores (ou prefixes clairs) pour distinguer les etats
- Pour le bulkhead, lancer les requetes en parallele (Promise.all) pour bien voir la limitation
- La demo backpressure doit etre visuelle : montrer la queue qui se remplit et les messages rejetes
- Si la visualisation circuit-breaker existe, l'afficher en plein ecran pour le wow effect
- Verifier les timings : le recoveryTimeout de 2s doit etre visible sans attente trop longue
