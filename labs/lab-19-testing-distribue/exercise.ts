// =============================================================================
// Lab 19 — Testing distribue (Exercise)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 19 — Testing distribue');

// =============================================================================
// Exercice 1 : Mock Service
// Implementer un mock HTTP service qui retourne des reponses configurables
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

  // TODO: Implementer addRoute(route: MockRoute): void
  // Ajouter une route au mock service

  // TODO: Implementer handle(request: MockRequest): Promise<MockResponse>
  // Trouver la route correspondante, simuler le delai si present,
  // enregistrer l'appel, retourner la reponse
  // Si aucune route ne correspond, retourner { status: 404, body: 'Not Found' }

  // TODO: Implementer getCalls(): CallRecord[]
  // Retourner tous les appels enregistres

  // TODO: Implementer getCallsTo(path: string): CallRecord[]
  // Retourner les appels filtres par path

  // TODO: Implementer reset(): void
  // Effacer toutes les routes et appels
}

// =============================================================================
// Exercice 2 : Contract Definition
// Definir et verifier un contrat consumer-driven
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

// TODO: Implementer validateSchema(data: Record<string, unknown>, schema: ContractField[]): { valid: boolean; errors: string[] }
// Verifier que data respecte le schema :
// - Chaque champ required doit etre present
// - Chaque champ present doit avoir le bon type (utiliser typeof, sauf 'array' -> Array.isArray)
function validateSchema(_data: Record<string, unknown>, _schema: ContractField[]): { valid: boolean; errors: string[] } {
  // TODO
  return { valid: false, errors: ['Not implemented'] };
}

// TODO: Implementer verifyContract(contract: Contract, mockService: MockService): Promise<{ passed: boolean; errors: string[] }>
// 1. Envoyer une requete au mock service selon le contrat
// 2. Verifier que le status de la reponse correspond
// 3. Verifier que le body de la reponse respecte le schema
async function verifyContract(_contract: Contract, _mockService: MockService): Promise<{ passed: boolean; errors: string[] }> {
  // TODO
  return { passed: false, errors: ['Not implemented'] };
}

// =============================================================================
// Exercice 3 : Chaos Middleware
// Implementer un middleware qui injecte aleatoirement latence, erreurs ou timeouts
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

// TODO: Implementer chaosMiddleware<T>(fn: () => Promise<T>, config: ChaosConfig, rng?: () => number): Promise<ChaosResult<T>>
// 1. Verifier si on injecte un timeout (rng() < timeoutRate) -> attendre timeoutMs puis retourner erreur
// 2. Verifier si on injecte une erreur (rng() < errorRate) -> retourner erreur 'Chaos: injected error'
// 3. Verifier si on injecte de la latence (rng() < latencyMs.probability) -> attendre un delai aleatoire
// 4. Executer fn() et retourner le resultat
// Utiliser rng (defaut Math.random) pour la reproductibilite
async function chaosMiddleware<T>(_fn: () => Promise<T>, _config: ChaosConfig, _rng?: () => number): Promise<ChaosResult<T>> {
  // TODO
  return { success: false, error: 'Not implemented' };
}

// =============================================================================
// Exercice 4 : Property-Based Test
// Implementer un runner de tests par propriete
// =============================================================================

interface PropertyTestResult {
  passed: boolean;
  iterations: number;
  counterexample?: unknown;
  error?: string;
}

// TODO: Implementer propertyTest<T>(
//   generator: (seed: number) => T,
//   property: (input: T) => boolean,
//   iterations?: number
// ): PropertyTestResult
// Pour chaque iteration, generer une entree avec generator(i),
// verifier property(input). Si elle echoue, retourner le counterexample.
function propertyTest<T>(
  _generator: (seed: number) => T,
  _property: (input: T) => boolean,
  _iterations?: number
): PropertyTestResult {
  // TODO
  return { passed: false, iterations: 0, error: 'Not implemented' };
}

// =============================================================================
// Exercice 5 : Linearizability Checker
// Verifier si un historique d'operations read/write est linearisable
// =============================================================================

interface Operation {
  id: number;
  type: 'write' | 'read';
  key: string;
  value?: number;        // valeur ecrite (write) ou lue (read)
  startTime: number;
  endTime: number;
}

// TODO: Implementer checkLinearizability(history: Operation[]): { linearizable: boolean; witness?: Operation[] }
// Un historique est linearisable si on peut trouver un ordre sequentiel des operations tel que :
// 1. L'ordre respecte le temps reel (si op1.endTime < op2.startTime, op1 est avant op2)
// 2. Chaque read retourne la valeur du dernier write precedent
// Retourner l'ordre temoin si linearisable
// Approche : essayer toutes les permutations valides (backtracking)
function checkLinearizability(_history: Operation[]): { linearizable: boolean; witness?: Operation[] } {
  // TODO
  return { linearizable: false };
}

// =============================================================================
// Exercice 6 : Test Harness
// Combiner mock services + chaos injection + assertions
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

// TODO: Implementer runTestHarness(scenarios: TestScenario[]): Promise<HarnessResult[]>
// Pour chaque scenario :
// 1. Creer un MockService, appeler setup
// 2. Executer execute (avec chaos si configure)
// 3. Appeler verify avec le resultat et les appels
// 4. Retourner le HarnessResult avec duree et nombre d'appels
async function runTestHarness(_scenarios: TestScenario[]): Promise<HarnessResult[]> {
  // TODO
  return [];
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
