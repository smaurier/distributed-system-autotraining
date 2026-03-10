# 19 — Testing des systemes distribues

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 90 min        | [Lab 19](../labs/lab-19-testing-distribue/) | [Quiz 19](../quizzes/quiz-19-testing.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Adapter la pyramide de tests classique aux systemes distribues
- Tester un service en isolation avec des mocks et stubs
- Implementer des tests de contrat (consumer-driven contracts) en TypeScript
- Comprendre les defis specifiques aux tests end-to-end en environnement distribue
- Concevoir et implementer un chaos middleware pour injecter des pannes
- Expliquer l'approche de simulation testing (FoundationDB) et ses avantages
- Appliquer le property-based testing pour verifier les invariants distribues
- Decrire le fonctionnement de Jepsen et les anomalies qu'il detecte
- Choisir la bonne strategie de test selon le contexte

---

## La pyramide de tests pour les systemes distribues

```
┌──────────────────────────────────────────────────────────────┐
│       PYRAMIDE DE TESTS — SYSTEMES DISTRIBUES                │
│                                                              │
│                    /\                                         │
│                   /  \        Tests E2E distribues            │
│                  / E2E\       Lents, fragiles, couteux        │
│                 /      \      Mais indispensables             │
│                /────────\                                     │
│               /  Chaos   \    Chaos engineering               │
│              /  Testing   \   Injection de pannes             │
│             /──────────────\                                  │
│            /   Contract     \  Tests de contrat               │
│           /    Testing       \ Verifier les interfaces        │
│          /────────────────────\                                │
│         /    Integration       \  Tests d'integration         │
│        /     Testing            \ Service + dependances       │
│       /──────────────────────────\                             │
│      /      Unit Testing          \  Tests unitaires          │
│     /        (par service)         \ Rapides, nombreux        │
│    /────────────────────────────────\                          │
│                                                              │
│   Plus on monte, plus les tests sont :                       │
│   • Lents    • Couteux   • Fragiles                          │
│   • Mais aussi : plus realistes et plus confiants            │
└──────────────────────────────────────────────────────────────┘
```

---

## Unit testing : un service en isolation

Les tests unitaires d'un service distribue testent la logique metier en isolant les dependances externes (autres services, bases de donnees, message brokers).

```typescript
// Service a tester
interface PaymentGateway {
  charge(amount: number, currency: string): Promise<{ transactionId: string }>;
}

interface InventoryClient {
  checkStock(productId: string): Promise<{ available: number }>;
  reserve(productId: string, quantity: number): Promise<void>;
}

class OrderService {
  constructor(
    private payment: PaymentGateway,
    private inventory: InventoryClient
  ) {}

  async createOrder(order: {
    productId: string;
    quantity: number;
    pricePerUnit: number;
    currency: string;
  }): Promise<{
    orderId: string;
    status: string;
    transactionId: string;
  }> {
    // Verifier le stock
    const stock = await this.inventory.checkStock(order.productId);
    if (stock.available < order.quantity) {
      throw new Error(
        `Stock insuffisant : ${stock.available} disponibles, ${order.quantity} demandes`
      );
    }

    // Reserver le stock
    await this.inventory.reserve(order.productId, order.quantity);

    // Encaisser le paiement
    const totalAmount = order.quantity * order.pricePerUnit;
    let transaction: { transactionId: string };
    try {
      transaction = await this.payment.charge(totalAmount, order.currency);
    } catch (paymentError) {
      // Compenser : liberer la reservation si le paiement echoue
      // (en vrai, on publierait un evenement de compensation)
      throw new Error(
        `Paiement echoue : ${(paymentError as Error).message}`
      );
    }

    return {
      orderId: `order-${Date.now()}`,
      status: 'confirmed',
      transactionId: transaction.transactionId,
    };
  }
}

// Tests unitaires avec mocks
class MockPaymentGateway implements PaymentGateway {
  calls: Array<{ amount: number; currency: string }> = [];
  shouldFail = false;

  async charge(
    amount: number,
    currency: string
  ): Promise<{ transactionId: string }> {
    this.calls.push({ amount, currency });
    if (this.shouldFail) {
      throw new Error('Payment declined');
    }
    return { transactionId: `tx-mock-${Date.now()}` };
  }
}

class MockInventoryClient implements InventoryClient {
  stockLevel = 100;
  reservations: Array<{ productId: string; quantity: number }> = [];

  async checkStock(
    _productId: string
  ): Promise<{ available: number }> {
    return { available: this.stockLevel };
  }

  async reserve(productId: string, quantity: number): Promise<void> {
    this.reservations.push({ productId, quantity });
  }
}

// Execution des tests
async function runUnitTests(): Promise<void> {
  // Test 1 : commande reussie
  {
    const payment = new MockPaymentGateway();
    const inventory = new MockInventoryClient();
    const service = new OrderService(payment, inventory);

    const result = await service.createOrder({
      productId: 'prod-1',
      quantity: 2,
      pricePerUnit: 25.0,
      currency: 'EUR',
    });

    console.assert(result.status === 'confirmed', 'Status should be confirmed');
    console.assert(payment.calls.length === 1, 'Should call payment once');
    console.assert(
      payment.calls[0].amount === 50.0,
      'Amount should be 50.0'
    );
    console.assert(
      inventory.reservations.length === 1,
      'Should reserve stock once'
    );
    console.log('Test 1 PASSED: commande reussie');
  }

  // Test 2 : stock insuffisant
  {
    const payment = new MockPaymentGateway();
    const inventory = new MockInventoryClient();
    inventory.stockLevel = 1; // Seulement 1 en stock
    const service = new OrderService(payment, inventory);

    try {
      await service.createOrder({
        productId: 'prod-1',
        quantity: 5,
        pricePerUnit: 25.0,
        currency: 'EUR',
      });
      console.assert(false, 'Should have thrown');
    } catch (error) {
      console.assert(
        (error as Error).message.includes('Stock insuffisant'),
        'Should throw stock error'
      );
      console.assert(
        payment.calls.length === 0,
        'Should not call payment if no stock'
      );
    }
    console.log('Test 2 PASSED: stock insuffisant');
  }

  // Test 3 : paiement echoue
  {
    const payment = new MockPaymentGateway();
    payment.shouldFail = true;
    const inventory = new MockInventoryClient();
    const service = new OrderService(payment, inventory);

    try {
      await service.createOrder({
        productId: 'prod-1',
        quantity: 1,
        pricePerUnit: 25.0,
        currency: 'EUR',
      });
      console.assert(false, 'Should have thrown');
    } catch (error) {
      console.assert(
        (error as Error).message.includes('Paiement echoue'),
        'Should throw payment error'
      );
    }
    console.log('Test 3 PASSED: paiement echoue');
  }
}
```

---

## Contract testing : consumer-driven contracts

Le contract testing verifie que le **contrat** entre un consommateur et un producteur d'API est respecte, sans avoir besoin de deployer les deux services ensemble.

```
┌──────────────────────────────────────────────────────────────┐
│       CONTRACT TESTING — CONSUMER-DRIVEN                     │
│                                                              │
│  1. Le consommateur definit ses attentes (contrat)           │
│     "Quand j'appelle GET /users/123, je m'attends a         │
│      recevoir { id, name, email }"                           │
│                                                              │
│  2. Le contrat est verifie cote producteur                   │
│     "Mon endpoint GET /users/:id retourne bien               │
│      { id, name, email } ?"                                  │
│                                                              │
│  ┌──────────────┐    Contrat    ┌──────────────┐            │
│  │  Consumer    │ ────────────► │  Provider    │            │
│  │  (Order Svc) │               │  (User Svc)  │            │
│  └──────────────┘               └──────────────┘            │
│                                                              │
│  Le contrat est un artefact partage :                        │
│  • Si le consumer change ses attentes → contrat mis a jour   │
│  • Si le provider casse le contrat → test rouge              │
│  • Pas besoin de deployer les 2 services pour verifier       │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Definition d'un contrat
interface ContractExpectation {
  method: string;
  path: string;
  requestBody?: Record<string, unknown>;
  requestHeaders?: Record<string, string>;
  expectedStatus: number;
  expectedBody: Record<string, unknown>;
  expectedHeaders?: Record<string, string>;
}

interface ServiceContract {
  consumer: string;
  provider: string;
  interactions: ContractExpectation[];
}

// Contrat defini par le consumer (order-service)
const orderToUserContract: ServiceContract = {
  consumer: 'order-service',
  provider: 'user-service',
  interactions: [
    {
      method: 'GET',
      path: '/users/user-123',
      expectedStatus: 200,
      expectedBody: {
        id: 'user-123',
        name: '(string)',      // Marqueur de type
        email: '(string)',
      },
    },
    {
      method: 'GET',
      path: '/users/nonexistent',
      expectedStatus: 404,
      expectedBody: {
        error: 'Not Found',
      },
    },
  ],
};

// Verifier le contrat cote consumer (avec un mock du provider)
class ContractConsumerTest {
  async verify(contract: ServiceContract): Promise<{
    passed: boolean;
    results: Array<{ interaction: string; passed: boolean; error?: string }>;
  }> {
    const results: Array<{
      interaction: string;
      passed: boolean;
      error?: string;
    }> = [];

    for (const interaction of contract.interactions) {
      const label = `${interaction.method} ${interaction.path} → ${interaction.expectedStatus}`;

      try {
        // Creer un mock server qui respecte le contrat
        const mockResponse = this.buildMockResponse(interaction);

        // Verifier que le consumer peut traiter cette reponse
        this.validateResponseShape(mockResponse, interaction.expectedBody);

        results.push({ interaction: label, passed: true });
      } catch (error) {
        results.push({
          interaction: label,
          passed: false,
          error: (error as Error).message,
        });
      }
    }

    return {
      passed: results.every((r) => r.passed),
      results,
    };
  }

  private buildMockResponse(interaction: ContractExpectation): {
    status: number;
    body: Record<string, unknown>;
  } {
    // Generer une reponse conforme au contrat
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(interaction.expectedBody)) {
      if (value === '(string)') body[key] = `test-${key}`;
      else if (value === '(number)') body[key] = 42;
      else body[key] = value;
    }
    return { status: interaction.expectedStatus, body };
  }

  private validateResponseShape(
    response: { status: number; body: Record<string, unknown> },
    expectedShape: Record<string, unknown>
  ): void {
    for (const key of Object.keys(expectedShape)) {
      if (!(key in response.body)) {
        throw new Error(`Missing field "${key}" in response body`);
      }
    }
  }
}

// Verifier le contrat cote provider (contre le vrai service)
class ContractProviderTest {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async verify(contract: ServiceContract): Promise<{
    passed: boolean;
    results: Array<{ interaction: string; passed: boolean; error?: string }>;
  }> {
    const results: Array<{
      interaction: string;
      passed: boolean;
      error?: string;
    }> = [];

    for (const interaction of contract.interactions) {
      const label = `${interaction.method} ${interaction.path} → ${interaction.expectedStatus}`;

      try {
        const response = await fetch(
          `${this.baseUrl}${interaction.path}`,
          {
            method: interaction.method,
            headers: interaction.requestHeaders,
            body: interaction.requestBody
              ? JSON.stringify(interaction.requestBody)
              : undefined,
          }
        );

        // Verifier le status code
        if (response.status !== interaction.expectedStatus) {
          throw new Error(
            `Expected status ${interaction.expectedStatus}, got ${response.status}`
          );
        }

        // Verifier la structure du body
        const body = await response.json();
        for (const key of Object.keys(interaction.expectedBody)) {
          if (!(key in body)) {
            throw new Error(`Missing field "${key}" in response`);
          }
        }

        results.push({ interaction: label, passed: true });
      } catch (error) {
        results.push({
          interaction: label,
          passed: false,
          error: (error as Error).message,
        });
      }
    }

    return {
      passed: results.every((r) => r.passed),
      results,
    };
  }
}
```

---

## Chaos testing : injection de pannes

Le chaos testing consiste a injecter deliberement des pannes dans un systeme pour verifier qu'il les tolere.

```
┌──────────────────────────────────────────────────────────────┐
│              CHAOS ENGINEERING — PRINCIPES                    │
│                                                              │
│  1. Definir l'etat normal (steady state)                     │
│     "Le service repond en < 200ms avec < 1% d'erreurs"       │
│                                                              │
│  2. Formuler une hypothese                                   │
│     "Si un noeud tombe, le service continue de fonctionner"  │
│                                                              │
│  3. Injecter une panne                                       │
│     "Tuer une instance de payment-service"                   │
│                                                              │
│  4. Observer le resultat                                     │
│     "Le trafic est redirige en 5s, pas de requetes perdues"  │
│                                                              │
│  5. Ameliorer si necessaire                                  │
│     "Le failover est trop lent → reduire le timeout"         │
│                                                              │
│  TYPES DE PANNES INJECTEES :                                 │
│  • Crash de processus                                        │
│  • Latence reseau ajoutee                                    │
│  • Partition reseau                                          │
│  • Corruption de reponse                                     │
│  • Saturation CPU / memoire                                  │
│  • Erreurs DNS                                               │
└──────────────────────────────────────────────────────────────┘
```

### Chaos middleware

```typescript
interface ChaosConfig {
  enabled: boolean;
  latencyMs: { min: number; max: number; probability: number };
  errorRate: number;          // probabilite de retourner une erreur
  timeoutRate: number;        // probabilite de simuler un timeout
  corruptionRate: number;     // probabilite de corrompre la reponse
  partitionTargets: string[]; // services a simuler comme inaccessibles
}

class ChaosMiddleware {
  private config: ChaosConfig;

  constructor(config: Partial<ChaosConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      latencyMs: config.latencyMs ?? { min: 0, max: 0, probability: 0 },
      errorRate: config.errorRate ?? 0,
      timeoutRate: config.timeoutRate ?? 0,
      corruptionRate: config.corruptionRate ?? 0,
      partitionTargets: config.partitionTargets ?? [],
    };
  }

  // Middleware pour les requetes entrantes
  inbound() {
    return async (
      req: { method: string; url: string },
      res: {
        status: (code: number) => { json: (body: unknown) => void };
      },
      next: () => void
    ) => {
      if (!this.config.enabled) {
        next();
        return;
      }

      // Injection de latence
      if (Math.random() < this.config.latencyMs.probability) {
        const delay =
          this.config.latencyMs.min +
          Math.random() *
            (this.config.latencyMs.max - this.config.latencyMs.min);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Injection d'erreur
      if (Math.random() < this.config.errorRate) {
        res.status(500).json({
          error: 'Internal Server Error',
          chaos: true,
          message: 'Erreur injectee par chaos middleware',
        });
        return;
      }

      // Injection de timeout (ne repond jamais)
      if (Math.random() < this.config.timeoutRate) {
        // Ne pas appeler next() ni res → la requete expire
        return;
      }

      next();
    };
  }

  // Wrapper pour les requetes sortantes (appels a d'autres services)
  async outbound<T>(
    targetService: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enabled) {
      return operation();
    }

    // Simuler une partition reseau
    if (this.config.partitionTargets.includes(targetService)) {
      throw new Error(
        `[CHAOS] Network partition: cannot reach ${targetService}`
      );
    }

    // Injection de latence sortante
    if (Math.random() < this.config.latencyMs.probability) {
      const delay =
        this.config.latencyMs.min +
        Math.random() *
          (this.config.latencyMs.max - this.config.latencyMs.min);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Injection d'erreur sortante
    if (Math.random() < this.config.errorRate) {
      throw new Error(
        `[CHAOS] Simulated error calling ${targetService}`
      );
    }

    return operation();
  }

  // API pour controler le chaos dynamiquement
  enable(): void {
    this.config.enabled = true;
  }

  disable(): void {
    this.config.enabled = false;
  }

  setLatency(min: number, max: number, probability: number): void {
    this.config.latencyMs = { min, max, probability };
  }

  setErrorRate(rate: number): void {
    this.config.errorRate = rate;
  }

  addPartition(serviceName: string): void {
    if (!this.config.partitionTargets.includes(serviceName)) {
      this.config.partitionTargets.push(serviceName);
    }
  }

  removePartition(serviceName: string): void {
    this.config.partitionTargets = this.config.partitionTargets.filter(
      (s) => s !== serviceName
    );
  }
}

// Scenario de chaos test automatise
async function chaosTestScenario(): Promise<void> {
  const chaos = new ChaosMiddleware();

  console.log('--- Scenario 1: Service degradation under latency ---');
  chaos.enable();
  chaos.setLatency(500, 2000, 0.5); // 50% des requetes avec 500-2000ms de latence

  // Executer des requetes et verifier que le systeme tient
  const results: boolean[] = [];
  for (let i = 0; i < 100; i++) {
    try {
      await chaos.outbound('payment-service', async () => {
        return { success: true };
      });
      results.push(true);
    } catch {
      results.push(false);
    }
  }

  const successRate = results.filter((r) => r).length / results.length;
  console.log(`Success rate under latency chaos: ${(successRate * 100).toFixed(1)}%`);

  console.log('\n--- Scenario 2: Network partition ---');
  chaos.addPartition('payment-service');

  try {
    await chaos.outbound('payment-service', async () => {
      return { success: true };
    });
    console.log('ERROR: should have failed with partition');
  } catch (error) {
    console.log(`Partition detected correctly: ${(error as Error).message}`);
  }

  chaos.disable();
  console.log('\nChaos testing complete.');
}
```

---

## Simulation testing

L'approche simulation testing, popularisee par FoundationDB, remplace toutes les sources de non-determinisme par des implementations deterministes.

```
┌──────────────────────────────────────────────────────────────┐
│       SIMULATION TESTING (approche FoundationDB)             │
│                                                              │
│  Code de production :                                        │
│  ┌──────────────┐                                            │
│  │  Logique     │ ← Interface abstraite                      │
│  │  metier      │                                            │
│  └──────┬───────┘                                            │
│         │                                                    │
│    ┌────┴────┐                                               │
│    ▼         ▼                                               │
│  ┌───────┐ ┌──────────┐                                     │
│  │ Real  │ │ Simulated│                                      │
│  │ I/O   │ │ I/O      │ ← Deterministe, controlable         │
│  └───────┘ └──────────┘                                      │
│                                                              │
│  En simulation :                                             │
│  • Le reseau est simule (latence, perte, partition)          │
│  • L'horloge est simulee (on peut avancer le temps)          │
│  • Le disque est simule (crash, corruption)                  │
│  • Le scheduler est simule (ordre d'execution)               │
│                                                              │
│  Avantage : on peut explorer des millions de scenarios       │
│  en quelques minutes, de maniere reproductible               │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Simulation simplifiee d'un environnement distribue
interface SimulatedNetwork {
  send(from: string, to: string, message: unknown): void;
  tick(): Array<{ from: string; to: string; message: unknown }>;
  injectPartition(nodeA: string, nodeB: string): void;
  healPartition(nodeA: string, nodeB: string): void;
}

class DeterministicSimulator {
  private clock = 0;
  private pendingMessages: Array<{
    from: string;
    to: string;
    message: unknown;
    deliverAt: number;
  }> = [];
  private partitions: Set<string> = new Set();
  private random: () => number;

  constructor(seed: number) {
    // Generateur de nombres pseudo-aleatoires deterministe
    this.random = this.createSeededRandom(seed);
  }

  send(from: string, to: string, message: unknown): void {
    const partitionKey = [from, to].sort().join(':');
    if (this.partitions.has(partitionKey)) {
      return; // Message perdu — partition reseau
    }

    // Latence reseau simulee (deterministe)
    const latency = Math.floor(this.random() * 50) + 1;
    this.pendingMessages.push({
      from,
      to,
      message,
      deliverAt: this.clock + latency,
    });
  }

  tick(): Array<{ from: string; to: string; message: unknown }> {
    this.clock++;
    const delivered: Array<{ from: string; to: string; message: unknown }> = [];

    this.pendingMessages = this.pendingMessages.filter((msg) => {
      if (msg.deliverAt <= this.clock) {
        delivered.push({ from: msg.from, to: msg.to, message: msg.message });
        return false;
      }
      return true;
    });

    // Shuffle pour simuler le reordonnancement des messages
    for (let i = delivered.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [delivered[i], delivered[j]] = [delivered[j], delivered[i]];
    }

    return delivered;
  }

  injectPartition(nodeA: string, nodeB: string): void {
    this.partitions.add([nodeA, nodeB].sort().join(':'));
  }

  healPartition(nodeA: string, nodeB: string): void {
    this.partitions.delete([nodeA, nodeB].sort().join(':'));
  }

  getClock(): number {
    return this.clock;
  }

  private createSeededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
}

// Utilisation : tester un algorithme de consensus sous differentes conditions
async function simulationTest(): Promise<void> {
  const seeds = [42, 123, 456, 789, 1024];

  for (const seed of seeds) {
    const sim = new DeterministicSimulator(seed);

    // Simuler 3 noeuds echangeant des messages
    sim.send('node-0', 'node-1', { type: 'propose', value: 'A' });
    sim.send('node-0', 'node-2', { type: 'propose', value: 'A' });

    // Injecter une partition
    sim.injectPartition('node-1', 'node-2');

    // Avancer le temps et observer les livraisons
    for (let t = 0; t < 100; t++) {
      const delivered = sim.tick();
      for (const msg of delivered) {
        // Verifier les invariants a chaque etape
        // ex: pas de divergence, pas de duplication
      }
    }

    console.log(`Seed ${seed}: simulation terminee a t=${sim.getClock()}`);
  }
}
```

---

## Property-based testing

Le property-based testing genere automatiquement des entrees et verifie que certaines proprietes (invariants) sont toujours respectees.

```typescript
// Generateur aleatoire simple pour le property-based testing
class Gen {
  static int(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static string(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  static oneOf<T>(values: T[]): T {
    return values[Math.floor(Math.random() * values.length)];
  }

  static array<T>(generator: () => T, minLen: number, maxLen: number): T[] {
    const len = Gen.int(minLen, maxLen);
    return Array.from({ length: len }, generator);
  }
}

// Proprietes a verifier pour un systeme distribue
interface PropertyTestResult {
  property: string;
  passed: boolean;
  iterations: number;
  counterexample?: unknown;
}

class PropertyTester {
  async check(
    property: string,
    test: () => Promise<boolean>,
    iterations: number = 1000
  ): Promise<PropertyTestResult> {
    for (let i = 0; i < iterations; i++) {
      try {
        const holds = await test();
        if (!holds) {
          return {
            property,
            passed: false,
            iterations: i + 1,
            counterexample: `Iteration ${i + 1}`,
          };
        }
      } catch (error) {
        return {
          property,
          passed: false,
          iterations: i + 1,
          counterexample: (error as Error).message,
        };
      }
    }

    return { property, passed: true, iterations };
  }
}

// Exemple : verifier les proprietes d'un rate limiter
async function testRateLimiterProperties(): Promise<void> {
  const tester = new PropertyTester();

  // Propriete 1 : le nombre de requetes autorisees ne depasse jamais la limite
  const result1 = await tester.check(
    'Rate limiter ne depasse jamais la limite',
    async () => {
      const limit = Gen.int(1, 100);
      const windowMs = 1000;
      const limiter = new Map<string, number>();
      const clientId = Gen.string(8);

      let allowed = 0;
      for (let i = 0; i < limit + 50; i++) {
        const count = (limiter.get(clientId) || 0) + 1;
        limiter.set(clientId, count);
        if (count <= limit) allowed++;
      }

      return allowed <= limit;
    }
  );
  console.log(`Property 1: ${result1.passed ? 'PASSED' : 'FAILED'} (${result1.iterations} iterations)`);

  // Propriete 2 : les operations idempotentes produisent le meme resultat
  const result2 = await tester.check(
    'Operation idempotente → meme resultat',
    async () => {
      const key = Gen.string(8);
      const value = Gen.int(1, 1000);

      // Simuler une operation idempotente (PUT)
      const store = new Map<string, number>();

      store.set(key, value);
      const result1 = store.get(key);

      store.set(key, value); // Meme operation repetee
      const result2 = store.get(key);

      return result1 === result2;
    }
  );
  console.log(`Property 2: ${result2.passed ? 'PASSED' : 'FAILED'} (${result2.iterations} iterations)`);

  // Propriete 3 : linearisabilite — les lectures retournent la derniere ecriture
  const result3 = await tester.check(
    'Linearisabilite des lectures apres ecriture',
    async () => {
      const store = new Map<string, number>();
      const key = 'counter';
      const operations = Gen.int(10, 100);

      let expectedValue = 0;
      for (let i = 0; i < operations; i++) {
        const isWrite = Math.random() < 0.5;
        if (isWrite) {
          expectedValue = i;
          store.set(key, i);
        } else {
          const readValue = store.get(key);
          if (readValue !== undefined && readValue !== expectedValue) {
            return false; // Violation de linearisabilite
          }
        }
      }

      return true;
    }
  );
  console.log(`Property 3: ${result3.passed ? 'PASSED' : 'FAILED'} (${result3.iterations} iterations)`);
}
```

---

## Jepsen : tester les bases de donnees distribuees

:::tip Qu'est-ce que Jepsen ?
Jepsen est un framework de test cree par Kyle Kingsbury (alias Aphyr) qui verifie les garanties de coherence annoncees par les bases de donnees distribuees. Il a trouve des bugs dans presque toutes les bases distribuees majeures.
:::

```
┌──────────────────────────────────────────────────────────────┐
│              JEPSEN — COMMENT CA MARCHE                       │
│                                                              │
│  1. Deployer un cluster de la DB a tester (5 noeuds)         │
│                                                              │
│  2. Generer des operations (lectures, ecritures, CAS)        │
│     en parallele sur tous les noeuds                         │
│                                                              │
│  3. Injecter des pannes pendant les operations :             │
│     • Partitions reseau (iptables)                           │
│     • Kill de processus (SIGKILL)                            │
│     • Suspension de processus (SIGSTOP/SIGCONT)              │
│     • Perturbation d'horloge (NTP skew)                      │
│                                                              │
│  4. Collecter l'historique de toutes les operations           │
│                                                              │
│  5. Verifier que l'historique est consistent avec le          │
│     modele de coherence annonce :                            │
│     • Linearizability (strict)                               │
│     • Sequential consistency                                 │
│     • Serializability                                        │
│     • Snapshot isolation                                     │
│                                                              │
│  6. Rapport : OK ou violation trouvee avec contre-exemple     │
└──────────────────────────────────────────────────────────────┘
```

### Decouvertes celebres de Jepsen

```
┌────────────────────────────────────────────────────────────────────┐
│  Base de donnees    │ Anomalie trouvee                             │
│─────────────────────┼────────────────────────────────────────────  │
│  MongoDB (2013)     │ Perte de donnees en cas de partition reseau  │
│  Elasticsearch      │ Perte de documents apres partition           │
│  Redis Cluster      │ Split-brain : deux masters acceptent des     │
│                     │ ecritures contradictoires                    │
│  CockroachDB        │ Violations de serializabilite sous partition │
│  Cassandra          │ Lightweight transactions non linearizables   │
│  RabbitMQ           │ Perte de messages malgre le mode durable     │
│  etcd               │ Lectures stale apres changement de leader    │
│  PostgreSQL (BDR)   │ Anomalies d'update en replication logique    │
└────────────────────────────────────────────────────────────────────┘
```

```typescript
// Modele simplifie d'un test de linearisabilite a la Jepsen
interface Operation {
  type: 'read' | 'write' | 'cas';
  key: string;
  value?: number;
  expectedValue?: number; // Pour CAS (Compare-And-Swap)
  result?: number | null;
  nodeId: string;
  startTime: number;
  endTime?: number;
  success: boolean;
}

class LinearizabilityChecker {
  // Verifier si un historique d'operations est linearizable
  // (version tres simplifiee — le vrai algorithme est NP-complet)
  check(history: Operation[]): {
    valid: boolean;
    violation?: string;
  } {
    // Trier par temps de fin
    const completed = history
      .filter((op) => op.endTime !== undefined)
      .sort((a, b) => a.endTime! - b.endTime!);

    // Pour chaque cle, verifier que les lectures sont coherentes
    const lastWrite: Map<string, number | null> = new Map();

    for (const op of completed) {
      if (op.type === 'write' && op.success) {
        lastWrite.set(op.key, op.value!);
      }

      if (op.type === 'read' && op.success) {
        const expected = lastWrite.get(op.key) ?? null;
        if (op.result !== expected) {
          // Verifier si c'est une vraie violation ou une operation concurrente
          // (simplification : on ignore la concurrence ici)
          return {
            valid: false,
            violation:
              `Read of ${op.key} on ${op.nodeId} returned ${op.result}, ` +
              `expected ${expected} based on completed writes`,
          };
        }
      }
    }

    return { valid: true };
  }
}

// Simuler un test de type Jepsen
async function miniJepsenTest(): Promise<void> {
  const checker = new LinearizabilityChecker();

  // Historique d'operations simulees
  const history: Operation[] = [
    {
      type: 'write', key: 'x', value: 1, nodeId: 'node-0',
      startTime: 0, endTime: 5, success: true,
    },
    {
      type: 'read', key: 'x', result: 1, nodeId: 'node-1',
      startTime: 6, endTime: 8, success: true,
    },
    {
      type: 'write', key: 'x', value: 2, nodeId: 'node-2',
      startTime: 10, endTime: 15, success: true,
    },
    {
      type: 'read', key: 'x', result: 2, nodeId: 'node-1',
      startTime: 16, endTime: 18, success: true,
    },
  ];

  const result = checker.check(history);
  console.log(
    `Linearizability check: ${result.valid ? 'VALID' : 'VIOLATION'}`
  );

  // Historique avec violation (stale read)
  const badHistory: Operation[] = [
    {
      type: 'write', key: 'x', value: 1, nodeId: 'node-0',
      startTime: 0, endTime: 5, success: true,
    },
    {
      type: 'write', key: 'x', value: 2, nodeId: 'node-0',
      startTime: 6, endTime: 10, success: true,
    },
    {
      type: 'read', key: 'x', result: 1, nodeId: 'node-1', // Stale read !
      startTime: 11, endTime: 13, success: true,
    },
  ];

  const badResult = checker.check(badHistory);
  console.log(
    `Linearizability check (stale): ${badResult.valid ? 'VALID' : 'VIOLATION'}`
  );
  if (badResult.violation) {
    console.log(`Violation: ${badResult.violation}`);
  }
}
```

---

## Matrice des strategies de test

```
┌────────────────────────────────────────────────────────────────────┐
│              MATRICE DES STRATEGIES DE TEST                        │
│                                                                    │
│  Strategie        │ Quoi verifier      │ Quand        │ Cout      │
│───────────────────┼────────────────────┼──────────────┼─────────  │
│  Unit tests       │ Logique metier     │ Chaque commit│ Bas       │
│  Contract tests   │ Interfaces API     │ Chaque commit│ Bas       │
│  Integration      │ Service + deps     │ Chaque PR    │ Moyen     │
│  E2E distribue    │ Flux complets      │ Nightly      │ Eleve     │
│  Chaos testing    │ Resilience         │ Staging/Prod │ Eleve     │
│  Property-based   │ Invariants         │ Chaque commit│ Moyen     │
│  Simulation       │ Comportement       │ Chaque commit│ Moyen     │
│  Jepsen           │ Coherence DB       │ Release      │ Tres eleve│
│  Load testing     │ Performance        │ Pre-release  │ Eleve     │
│  Soak testing     │ Fuites memoire     │ Nightly      │ Moyen     │
└────────────────────────────────────────────────────────────────────┘
```

:::tip Conseil pratique
Commencez par les tests unitaires et les tests de contrat. Ajoutez le chaos testing une fois que vous avez une bonne couverture de base. Le property-based testing est particulierement precieux pour les algorithmes distribues (consensus, replication, CRDT).
:::

---

## Resume

| Strategie | Objectif | Outil / Framework |
|-----------|----------|-------------------|
| **Unit testing** | Logique metier en isolation | Mocks, stubs, vitest/jest |
| **Contract testing** | Interfaces API entre services | Pact, custom contracts |
| **Chaos testing** | Resilience aux pannes | Chaos middleware, Litmus |
| **Simulation testing** | Exploration exhaustive | FoundationDB-style, custom |
| **Property-based testing** | Invariants toujours vrais | fast-check, custom generators |
| **Jepsen** | Garanties de coherence des DBs | Jepsen (Clojure), Maelstrom |

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [18 - Observabilite des systemes distribues](./18-observabilite-distribuee.md) | [20 - Consensus & Coordination Distribuee](./20-consensus-coordination-distribuee.md) |

**Ressources associees :**
- [Lab 19 — Testing distribue](../labs/lab-19-testing-distribue/)
- [Quiz 19 — Testing distribue](../quizzes/quiz-19-testing.html)
