// =============================================================================
// Lab 02 — Communication reseau (Solution)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 02 — Communication reseau');

// =============================================================================
// Exercice 1 : Simulation TCP — 3-way handshake
// Simuler le processus de connexion TCP avec une machine a etats.
// Etats : CLOSED -> SYN_SENT -> ESTABLISHED
// =============================================================================

type TcpState = 'CLOSED' | 'SYN_SENT' | 'SYN_ACK_RECEIVED' | 'ESTABLISHED';
type TcpEvent = 'SYN' | 'SYN_ACK' | 'ACK';

interface TcpConnection {
  state: TcpState;
  events: TcpEvent[];
  transition(event: TcpEvent): void;
}

function createTcpConnection(): TcpConnection {
  const connection: TcpConnection = {
    state: 'CLOSED',
    events: [],
    transition(event: TcpEvent) {
      switch (this.state) {
        case 'CLOSED':
          if (event === 'SYN') {
            this.state = 'SYN_SENT';
            this.events.push(event);
          } else {
            throw new Error(`Invalid event ${event} in state ${this.state}`);
          }
          break;
        case 'SYN_SENT':
          if (event === 'SYN_ACK') {
            this.state = 'SYN_ACK_RECEIVED';
            this.events.push(event);
          } else {
            throw new Error(`Invalid event ${event} in state ${this.state}`);
          }
          break;
        case 'SYN_ACK_RECEIVED':
          if (event === 'ACK') {
            this.state = 'ESTABLISHED';
            this.events.push(event);
          } else {
            throw new Error(`Invalid event ${event} in state ${this.state}`);
          }
          break;
        case 'ESTABLISHED':
          throw new Error(`Connection already established`);
        default:
          throw new Error(`Unknown state ${this.state}`);
      }
    },
  };
  return connection;
}

// =============================================================================
// Exercice 2 : Mesure de latence
// Mesurer la latence de fonctions async et calculer min, max, avg.
// =============================================================================

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  measurements: number[];
}

async function measureLatency(fn: () => Promise<void>, iterations: number): Promise<LatencyStats> {
  const measurements: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    const elapsed = Date.now() - start;
    measurements.push(elapsed);
  }

  const min = Math.min(...measurements);
  const max = Math.max(...measurements);
  const avg = Math.round(measurements.reduce((s, v) => s + v, 0) / measurements.length);

  return { min, max, avg, measurements };
}

// =============================================================================
// Exercice 3 : Implementation de timeout
// Wrapper qui rejette la promesse si elle ne se resout pas a temps.
// =============================================================================

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// =============================================================================
// Exercice 4 : Pool de connexions
// Gerer un nombre limite de connexions reutilisables.
// =============================================================================

interface Connection {
  id: number;
  inUse: boolean;
  createdAt: number;
}

interface ConnectionPool {
  acquire(): Connection;
  release(connId: number): void;
  getActive(): number;
  getPoolSize(): number;
  drain(): void;
}

function createConnectionPool(maxSize: number): ConnectionPool {
  const connections: Connection[] = [];
  let nextId = 1;

  return {
    acquire(): Connection {
      // Try reusing an idle connection
      const idle = connections.find(c => !c.inUse);
      if (idle) {
        idle.inUse = true;
        return idle;
      }

      // Create a new one if we can
      if (connections.length < maxSize) {
        const conn: Connection = { id: nextId++, inUse: true, createdAt: Date.now() };
        connections.push(conn);
        return conn;
      }

      throw new Error('Connection pool exhausted');
    },

    release(connId: number): void {
      const conn = connections.find(c => c.id === connId);
      if (!conn) throw new Error(`Connection ${connId} not found`);
      if (!conn.inUse) throw new Error(`Connection ${connId} is already released`);
      conn.inUse = false;
    },

    getActive(): number {
      return connections.filter(c => c.inUse).length;
    },

    getPoolSize(): number {
      return connections.length;
    },

    drain(): void {
      connections.length = 0;
    },
  };
}

// =============================================================================
// Exercice 5 : Retry avec timeout
// Combiner retry et timeout : chaque tentative a un timeout individuel.
// =============================================================================

interface RetryOptions {
  maxRetries: number;
  perAttemptTimeoutMs: number;
  delayBetweenRetriesMs: number;
}

async function retryWithTimeout<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<{ result: T; attempts: number }> {
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const result = await withTimeout(fn(), options.perAttemptTimeoutMs);
      return { result, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < options.maxRetries) {
        await simulateNetworkDelay(options.delayBetweenRetriesMs);
      }
    }
  }

  throw new Error(`All ${options.maxRetries + 1} attempts failed. Last error: ${lastError.message}`);
}

// =============================================================================
// Exercice 6 : Diagnostics reseau
// Analyser des resultats de requetes pour calculer des metriques.
// =============================================================================

interface RequestResult {
  status: number;
  durationMs: number;
}

interface NetworkDiagnostics {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
}

function analyzeRequests(results: RequestResult[]): NetworkDiagnostics {
  const totalRequests = results.length;
  const successCount = results.filter(r => r.status >= 200 && r.status < 400).length;
  const errorCount = totalRequests - successCount;
  const errorRate = Math.round((errorCount / totalRequests) * 10000) / 10000;

  const sorted = [...results].map(r => r.durationMs).sort((a, b) => a - b);

  function percentile(arr: number[], p: number): number {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  }

  return {
    totalRequests,
    successCount,
    errorCount,
    errorRate,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 02 — Communication reseau\n');

  // --- Exercice 1 ---
  await test('Ex1: TCP handshake complet SYN -> SYN_ACK -> ACK', () => {
    const conn = createTcpConnection();
    assertEqual(conn.state, 'CLOSED');
    conn.transition('SYN');
    assertEqual(conn.state, 'SYN_SENT');
    conn.transition('SYN_ACK');
    assertEqual(conn.state, 'SYN_ACK_RECEIVED');
    conn.transition('ACK');
    assertEqual(conn.state, 'ESTABLISHED');
    assertDeepEqual(conn.events, ['SYN', 'SYN_ACK', 'ACK']);
  });

  await test('Ex1: TCP rejette les transitions invalides', () => {
    const conn = createTcpConnection();
    try {
      conn.transition('ACK');
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.includes('Invalid event'), 'Should mention invalid event');
    }
  });

  // --- Exercice 2 ---
  await test('Ex2: measureLatency calcule min/max/avg', async () => {
    const stats = await measureLatency(() => simulateNetworkDelay(10), 3);
    assertEqual(stats.measurements.length, 3);
    assert(stats.min >= 0, 'Min should be >= 0');
    assert(stats.max >= stats.min, 'Max should be >= min');
    assert(stats.avg >= stats.min && stats.avg <= stats.max, 'Avg should be between min and max');
  });

  // --- Exercice 3 ---
  await test('Ex3: withTimeout resout avant le timeout', async () => {
    const result = await withTimeout(
      simulateNetworkDelay(10).then(() => 'ok'),
      500
    );
    assertEqual(result, 'ok');
  });

  await test('Ex3: withTimeout rejette apres le timeout', async () => {
    try {
      await withTimeout(simulateNetworkDelay(500).then(() => 'ok'), 20);
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.includes('Timeout'), 'Should mention timeout');
    }
  });

  // --- Exercice 4 ---
  await test('Ex4: pool cree et reutilise des connexions', () => {
    const pool = createConnectionPool(3);
    const c1 = pool.acquire();
    const c2 = pool.acquire();
    assertEqual(pool.getActive(), 2);
    assertEqual(pool.getPoolSize(), 2);
    pool.release(c1.id);
    assertEqual(pool.getActive(), 1);
    const c3 = pool.acquire();
    assertEqual(c3.id, c1.id, 'Should reuse released connection');
    assertEqual(pool.getPoolSize(), 2);
  });

  await test('Ex4: pool lance une erreur quand epuise', () => {
    const pool = createConnectionPool(2);
    pool.acquire();
    pool.acquire();
    try {
      pool.acquire();
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.includes('exhausted'), 'Should mention pool exhausted');
    }
  });

  // --- Exercice 5 ---
  await test('Ex5: retryWithTimeout reussit a la premiere tentative', async () => {
    let callCount = 0;
    const { result, attempts } = await retryWithTimeout(
      async () => { callCount++; return 42; },
      { maxRetries: 3, perAttemptTimeoutMs: 100, delayBetweenRetriesMs: 10 }
    );
    assertEqual(result, 42);
    assertEqual(attempts, 1);
  });

  await test('Ex5: retryWithTimeout reessaie apres echec', async () => {
    let callCount = 0;
    const { result, attempts } = await retryWithTimeout(
      async () => {
        callCount++;
        if (callCount < 3) throw new Error('fail');
        return 'success';
      },
      { maxRetries: 5, perAttemptTimeoutMs: 100, delayBetweenRetriesMs: 10 }
    );
    assertEqual(result, 'success');
    assertEqual(attempts, 3);
  });

  await test('Ex5: retryWithTimeout echoue apres maxRetries', async () => {
    try {
      await retryWithTimeout(
        async () => { throw new Error('always fails'); },
        { maxRetries: 2, perAttemptTimeoutMs: 100, delayBetweenRetriesMs: 10 }
      );
      throw new Error('Should have thrown');
    } catch (err) {
      assert((err as Error).message.includes('attempts failed'), 'Should mention all attempts failed');
    }
  });

  // --- Exercice 6 ---
  await test('Ex6: analyzeRequests calcule les metriques correctement', () => {
    const results: RequestResult[] = [
      { status: 200, durationMs: 10 },
      { status: 200, durationMs: 20 },
      { status: 200, durationMs: 30 },
      { status: 200, durationMs: 40 },
      { status: 500, durationMs: 50 },
    ];
    const diag = analyzeRequests(results);
    assertEqual(diag.totalRequests, 5);
    assertEqual(diag.successCount, 4);
    assertEqual(diag.errorCount, 1);
    assertEqual(diag.errorRate, 0.2);
    assertEqual(diag.p50, 30);
  });

  await test('Ex6: analyzeRequests calcule les percentiles p95 et p99', () => {
    const results: RequestResult[] = [];
    for (let i = 1; i <= 100; i++) {
      results.push({ status: 200, durationMs: i });
    }
    const diag = analyzeRequests(results);
    assertEqual(diag.totalRequests, 100);
    assertEqual(diag.p50, 50);
    assertEqual(diag.p95, 95);
    assertEqual(diag.p99, 99);
  });

  summary();
}

main();
