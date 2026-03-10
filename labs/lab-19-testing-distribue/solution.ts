// =============================================================================
// Lab 19 — Testing distribue (Solution)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 19 — Testing distribue');

// =============================================================================
// Exercice 1 : Mock Service
// =============================================================================

interface MockRoute {
  method: string;
  path: string;
  status: number;
  body: unknown;
  delay?: number;
}

interface MockRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface MockResponse {
  status: number;
  body: unknown;
}

interface CallRecord {
  request: MockRequest;
  response: MockResponse;
  timestamp: number;
}

class MockService {
  private routes: MockRoute[] = [];
  private calls: CallRecord[] = [];

  addRoute(route: MockRoute): void {
    this.routes.push(route);
  }

  async handle(request: MockRequest): Promise<MockResponse> {
    const route = this.routes.find(r => r.method === request.method && r.path === request.path);
    if (!route) {
      const response: MockResponse = { status: 404, body: 'Not Found' };
      this.calls.push({ request, response, timestamp: Date.now() });
      return response;
    }
    if (route.delay) {
      await simulateNetworkDelay(route.delay);
    }
    const response: MockResponse = { status: route.status, body: route.body };
    this.calls.push({ request, response, timestamp: Date.now() });
    return response;
  }

  getCalls(): CallRecord[] {
    return [...this.calls];
  }

  getCallsTo(path: string): CallRecord[] {
    return this.calls.filter(c => c.request.path === path);
  }

  reset(): void {
    this.routes = [];
    this.calls = [];
  }
}

// =============================================================================
// Exercice 2 : Contract Definition
// =============================================================================

interface ContractField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
}

interface Contract {
  name: string;
  consumer: string;
  provider: string;
  request: {
    method: string;
    path: string;
    bodySchema: ContractField[];
  };
  response: {
    status: number;
    bodySchema: ContractField[];
  };
}

function validateSchema(data: Record<string, unknown>, schema: ContractField[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const field of schema) {
    const value = data[field.name];
    if (value === undefined || value === null) {
      if (field.required) {
        errors.push(`Missing required field: ${field.name}`);
      }
      continue;
    }
    if (field.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`Field ${field.name}: expected array, got ${typeof value}`);
      }
    } else if (typeof value !== field.type) {
      errors.push(`Field ${field.name}: expected ${field.type}, got ${typeof value}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

async function verifyContract(contract: Contract, mockService: MockService): Promise<{ passed: boolean; errors: string[] }> {
  const errors: string[] = [];
  const request: MockRequest = {
    method: contract.request.method,
    path: contract.request.path,
  };
  const response = await mockService.handle(request);
  if (response.status !== contract.response.status) {
    errors.push(`Expected status ${contract.response.status}, got ${response.status}`);
  }
  if (contract.response.bodySchema.length > 0 && response.body && typeof response.body === 'object') {
    const schemaResult = validateSchema(response.body as Record<string, unknown>, contract.response.bodySchema);
    errors.push(...schemaResult.errors);
  }
  return { passed: errors.length === 0, errors };
}

// =============================================================================
// Exercice 3 : Chaos Middleware
// =============================================================================

interface ChaosConfig {
  latencyMs?: { min: number; max: number; probability: number };
  errorRate?: number;
  timeoutRate?: number;
  timeoutMs?: number;
}

interface ChaosResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  latencyInjected?: number;
}

async function chaosMiddleware<T>(fn: () => Promise<T>, config: ChaosConfig, rng: () => number = Math.random): Promise<ChaosResult<T>> {
  // Check timeout injection
  if (config.timeoutRate && config.timeoutMs && rng() < config.timeoutRate) {
    await simulateNetworkDelay(config.timeoutMs);
    return { success: false, error: 'Chaos: timeout' };
  }

  // Check error injection
  if (config.errorRate && rng() < config.errorRate) {
    return { success: false, error: 'Chaos: injected error' };
  }

  // Check latency injection
  let latencyInjected: number | undefined;
  if (config.latencyMs && rng() < config.latencyMs.probability) {
    const delay = config.latencyMs.min + rng() * (config.latencyMs.max - config.latencyMs.min);
    latencyInjected = Math.round(delay);
    await simulateNetworkDelay(latencyInjected);
  }

  try {
    const data = await fn();
    return { success: true, data, latencyInjected };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), latencyInjected };
  }
}

// =============================================================================
// Exercice 4 : Property-Based Test
// =============================================================================

interface PropertyTestResult {
  passed: boolean;
  iterations: number;
  counterexample?: unknown;
  error?: string;
}

function propertyTest<T>(
  generator: (seed: number) => T,
  property: (input: T) => boolean,
  iterations: number = 100
): PropertyTestResult {
  for (let i = 0; i < iterations; i++) {
    const input = generator(i);
    try {
      if (!property(input)) {
        return { passed: false, iterations: i + 1, counterexample: input, error: `Property failed for input: ${JSON.stringify(input)}` };
      }
    } catch (err) {
      return { passed: false, iterations: i + 1, counterexample: input, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { passed: true, iterations };
}

// =============================================================================
// Exercice 5 : Linearizability Checker
// =============================================================================

interface Operation {
  id: number;
  type: 'write' | 'read';
  key: string;
  value?: number;
  startTime: number;
  endTime: number;
}

function checkLinearizability(history: Operation[]): { linearizable: boolean; witness?: Operation[] } {
  const ops = [...history];
  const n = ops.length;

  function tryOrder(placed: Operation[], remaining: Operation[], state: Map<string, number>): Operation[] | null {
    if (placed.length === n) return placed;

    for (let i = 0; i < remaining.length; i++) {
      const op = remaining[i];

      // Check real-time constraint: no already-placed op should have started after this op ended
      // Actually: this op must not start after any unplaced op that has already ended before this op starts
      // Real-time: if op1.endTime < op2.startTime, op1 must come before op2
      const violatesRealTime = placed.some(p => p.endTime > op.endTime && p.startTime > op.endTime) ||
        remaining.filter((_, j) => j !== i).some(r => r.endTime < op.startTime && !placed.includes(r));

      // Simpler check: can this op be next?
      // It can be next if no remaining op (other than this one) must come before it due to real-time ordering
      const mustComeBefore = remaining.filter((r, j) => j !== i && r.endTime < op.startTime);
      if (mustComeBefore.length > 0) continue;

      // Check consistency
      const newState = new Map(state);
      if (op.type === 'write') {
        newState.set(op.key, op.value!);
      } else if (op.type === 'read') {
        const currentValue = newState.get(op.key);
        if (currentValue !== op.value) continue;
      }

      const newRemaining = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
      const result = tryOrder([...placed, op], newRemaining, newState);
      if (result) return result;
    }

    return null;
  }

  const witness = tryOrder([], ops, new Map());
  if (witness) {
    return { linearizable: true, witness };
  }
  return { linearizable: false };
}

// =============================================================================
// Exercice 6 : Test Harness
// =============================================================================

interface TestScenario {
  name: string;
  setup: (mock: MockService) => void;
  chaos?: ChaosConfig;
  execute: (mock: MockService) => Promise<unknown>;
  verify: (result: unknown, calls: CallRecord[]) => boolean;
}

interface HarnessResult {
  scenario: string;
  passed: boolean;
  error?: string;
  duration: number;
  callCount: number;
}

async function runTestHarness(scenarios: TestScenario[]): Promise<HarnessResult[]> {
  const results: HarnessResult[] = [];

  for (const scenario of scenarios) {
    const mock = new MockService();
    const start = Date.now();
    let passed = false;
    let error: string | undefined;

    try {
      scenario.setup(mock);
      let result: unknown;
      if (scenario.chaos) {
        const chaosResult = await chaosMiddleware(
          () => scenario.execute(mock),
          scenario.chaos
        );
        result = chaosResult.success ? chaosResult.data : chaosResult;
      } else {
        result = await scenario.execute(mock);
      }
      passed = scenario.verify(result, mock.getCalls());
    } catch (err) {
      passed = false;
      error = err instanceof Error ? err.message : String(err);
    }

    results.push({
      scenario: scenario.name,
      passed,
      error,
      duration: Date.now() - start,
      callCount: mock.getCalls().length,
    });
  }

  return results;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('🧪 Lab 19 — Testing distribue\n');

  // --- Tests Exercice 1 : Mock Service ---
  await test('Ex1: mock service retourne une reponse configuree', async () => {
    const mock = new MockService();
    mock.addRoute({ method: 'GET', path: '/api/users', status: 200, body: [{ id: 1, name: 'Alice' }] });
    const res = await mock.handle({ method: 'GET', path: '/api/users' });
    assertEqual(res.status, 200);
    assertDeepEqual(res.body, [{ id: 1, name: 'Alice' }]);
  });

  await test('Ex1: mock service retourne 404 pour route inconnue', async () => {
    const mock = new MockService();
    const res = await mock.handle({ method: 'GET', path: '/unknown' });
    assertEqual(res.status, 404);
  });

  await test('Ex1: mock service enregistre les appels', async () => {
    const mock = new MockService();
    mock.addRoute({ method: 'POST', path: '/api/orders', status: 201, body: { id: 'order-1' } });
    await mock.handle({ method: 'POST', path: '/api/orders', body: { item: 'book' } });
    await mock.handle({ method: 'POST', path: '/api/orders', body: { item: 'pen' } });
    assertEqual(mock.getCalls().length, 2);
    assertEqual(mock.getCallsTo('/api/orders').length, 2);
  });

  await test('Ex1: mock service reset efface tout', async () => {
    const mock = new MockService();
    mock.addRoute({ method: 'GET', path: '/test', status: 200, body: 'ok' });
    await mock.handle({ method: 'GET', path: '/test' });
    mock.reset();
    assertEqual(mock.getCalls().length, 0);
    const res = await mock.handle({ method: 'GET', path: '/test' });
    assertEqual(res.status, 404);
  });

  // --- Tests Exercice 2 : Contract Definition ---
  await test('Ex2: validation de schema - valide', () => {
    const schema: ContractField[] = [
      { name: 'id', type: 'number', required: true },
      { name: 'name', type: 'string', required: true },
    ];
    const result = validateSchema({ id: 1, name: 'Alice' }, schema);
    assert(result.valid, 'Schema should be valid');
    assertEqual(result.errors.length, 0);
  });

  await test('Ex2: validation de schema - champ manquant', () => {
    const schema: ContractField[] = [
      { name: 'id', type: 'number', required: true },
      { name: 'name', type: 'string', required: true },
    ];
    const result = validateSchema({ id: 1 }, schema);
    assert(!result.valid, 'Schema should be invalid');
    assertGreaterThan(result.errors.length, 0);
  });

  await test('Ex2: verification de contrat', async () => {
    const mock = new MockService();
    mock.addRoute({ method: 'GET', path: '/api/user/1', status: 200, body: { id: 1, name: 'Alice', active: true } });
    const contract: Contract = {
      name: 'GetUser',
      consumer: 'OrderService',
      provider: 'UserService',
      request: { method: 'GET', path: '/api/user/1', bodySchema: [] },
      response: { status: 200, bodySchema: [
        { name: 'id', type: 'number', required: true },
        { name: 'name', type: 'string', required: true },
      ]},
    };
    const result = await verifyContract(contract, mock);
    assert(result.passed, 'Contract should pass');
  });

  // --- Tests Exercice 3 : Chaos Middleware ---
  await test('Ex3: chaos middleware - pas de chaos', async () => {
    const fn = async () => 42;
    const result = await chaosMiddleware(fn, {}, () => 0.99);
    assert(result.success, 'Should succeed without chaos');
    assertEqual(result.data, 42);
  });

  await test('Ex3: chaos middleware - erreur injectee', async () => {
    const fn = async () => 42;
    const result = await chaosMiddleware(fn, { errorRate: 0.5 }, () => 0.1);
    assert(!result.success, 'Should fail with injected error');
    assert(result.error !== undefined, 'Should have error message');
  });

  await test('Ex3: chaos middleware - timeout injecte', async () => {
    const fn = async () => 42;
    const result = await chaosMiddleware(fn, { timeoutRate: 0.5, timeoutMs: 50 }, () => 0.1);
    assert(!result.success, 'Should fail with timeout');
  });

  // --- Tests Exercice 4 : Property-Based Test ---
  await test('Ex4: property test - propriete vraie', () => {
    const result = propertyTest(
      (seed) => seed + 1,
      (n) => n > 0,
      100
    );
    assert(result.passed, 'Property should hold');
    assertEqual(result.iterations, 100);
  });

  await test('Ex4: property test - counterexample trouve', () => {
    const result = propertyTest(
      (seed) => seed - 50,
      (n) => n >= 0,
      100
    );
    assert(!result.passed, 'Property should fail');
    assert(result.counterexample !== undefined, 'Should have counterexample');
  });

  // --- Tests Exercice 5 : Linearizability Checker ---
  await test('Ex5: historique linearisable', () => {
    const history: Operation[] = [
      { id: 1, type: 'write', key: 'x', value: 1, startTime: 0, endTime: 2 },
      { id: 2, type: 'read', key: 'x', value: 1, startTime: 3, endTime: 4 },
    ];
    const result = checkLinearizability(history);
    assert(result.linearizable, 'History should be linearizable');
  });

  await test('Ex5: historique non linearisable', () => {
    const history: Operation[] = [
      { id: 1, type: 'write', key: 'x', value: 1, startTime: 0, endTime: 2 },
      { id: 2, type: 'write', key: 'x', value: 2, startTime: 3, endTime: 5 },
      { id: 3, type: 'read', key: 'x', value: 1, startTime: 6, endTime: 7 },
    ];
    const result = checkLinearizability(history);
    assert(!result.linearizable, 'History should not be linearizable');
  });

  await test('Ex5: operations concurrentes linearisables', () => {
    const history: Operation[] = [
      { id: 1, type: 'write', key: 'x', value: 1, startTime: 0, endTime: 5 },
      { id: 2, type: 'write', key: 'x', value: 2, startTime: 1, endTime: 6 },
      { id: 3, type: 'read', key: 'x', value: 2, startTime: 7, endTime: 8 },
    ];
    const result = checkLinearizability(history);
    assert(result.linearizable, 'Concurrent writes should be linearizable');
  });

  // --- Tests Exercice 6 : Test Harness ---
  await test('Ex6: test harness execute les scenarios', async () => {
    const scenarios: TestScenario[] = [
      {
        name: 'basic get',
        setup: (mock) => { mock.addRoute({ method: 'GET', path: '/health', status: 200, body: { status: 'ok' } }); },
        execute: (mock) => mock.handle({ method: 'GET', path: '/health' }),
        verify: (result) => (result as MockResponse).status === 200,
      },
      {
        name: 'not found',
        setup: () => {},
        execute: (mock) => mock.handle({ method: 'GET', path: '/missing' }),
        verify: (result) => (result as MockResponse).status === 404,
      },
    ];
    const results = await runTestHarness(scenarios);
    assertEqual(results.length, 2);
    assert(results[0].passed, 'First scenario should pass');
    assert(results[1].passed, 'Second scenario should pass');
    assertEqual(results[0].scenario, 'basic get');
  });

  await test('Ex6: test harness rapporte les echecs', async () => {
    const scenarios: TestScenario[] = [
      {
        name: 'failing test',
        setup: (mock) => { mock.addRoute({ method: 'GET', path: '/test', status: 200, body: 'ok' }); },
        execute: (mock) => mock.handle({ method: 'GET', path: '/test' }),
        verify: () => false,
      },
    ];
    const results = await runTestHarness(scenarios);
    assert(!results[0].passed, 'Scenario should fail');
  });

  summary();
}

main();
