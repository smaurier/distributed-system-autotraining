// =============================================================================
// Lab 02 — Communication reseau (Exercice)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 02 — Communication reseau');

// =============================================================================
// Exercice 1 : Simulation TCP — 3-way handshake
// Simuler le processus de connexion TCP avec une machine a etats.
// Etats : CLOSED -> SYN_SENT -> SYN_ACK_RECEIVED -> ESTABLISHED
//
// Regles de transition :
// - CLOSED + SYN -> SYN_SENT
// - SYN_SENT + SYN_ACK -> SYN_ACK_RECEIVED
// - SYN_ACK_RECEIVED + ACK -> ESTABLISHED
// - Toute autre combinaison doit lancer une erreur
// =============================================================================

type TcpState = 'CLOSED' | 'SYN_SENT' | 'SYN_ACK_RECEIVED' | 'ESTABLISHED';
type TcpEvent = 'SYN' | 'SYN_ACK' | 'ACK';

interface TcpConnection {
  state: TcpState;
  events: TcpEvent[];
  transition(event: TcpEvent): void;
}

function createTcpConnection(): TcpConnection {
  // TODO: Creer un objet TcpConnection avec :
  // - state initial = 'CLOSED'
  // - events = []
  // - transition(event) qui change l'etat selon les regles ci-dessus
  //   et enregistre chaque event dans events[]
  //   Lancer une erreur si la transition est invalide
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Mesure de latence
// Mesurer la latence d'une fonction async sur N iterations
// et calculer min, max, avg.
// =============================================================================

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  measurements: number[];
}

async function measureLatency(fn: () => Promise<void>, iterations: number): Promise<LatencyStats> {
  // TODO: Appeler fn() iterations fois, mesurer chaque duree avec Date.now()
  // Calculer min, max, avg (arrondi a l'entier)
  // Retourner { min, max, avg, measurements }
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Implementation de timeout
// Creer un wrapper qui rejette la promesse si elle ne se resout pas a temps.
// Utiliser Promise.race avec un setTimeout.
// =============================================================================

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  // TODO: Retourner Promise.race entre :
  // - la promesse originale
  // - une promesse qui rejette apres timeoutMs avec le message `Timeout after ${timeoutMs}ms`
  throw new Error('Not implemented');
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
  // TODO: Implementer un pool de connexions avec :
  // - acquire() : retourne une connexion libre ou en cree une nouvelle (si < maxSize)
  //   Lance 'Connection pool exhausted' si le pool est plein et toutes sont utilisees
  // - release(connId) : libere la connexion (inUse = false)
  //   Lance une erreur si la connexion n'existe pas ou est deja liberee
  // - getActive() : nombre de connexions en cours d'utilisation
  // - getPoolSize() : nombre total de connexions dans le pool
  // - drain() : vide le pool completement
  throw new Error('Not implemented');
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
  // TODO: Implementer la logique de retry avec timeout
  // - Pour chaque tentative, utiliser withTimeout(fn(), perAttemptTimeoutMs)
  // - Si la tentative echoue, attendre delayBetweenRetriesMs avant de reessayer
  // - Apres maxRetries + 1 tentatives, lancer une erreur contenant 'attempts failed'
  // - Retourner { result, attempts } (attempts = numero de la tentative reussie)
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Diagnostics reseau
// Analyser un tableau de resultats de requetes pour calculer des metriques.
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
  // TODO: Analyser les resultats :
  // - totalRequests : nombre total
  // - successCount : status >= 200 et < 400
  // - errorCount : le reste
  // - errorRate : errorCount / totalRequests (arrondi a 4 decimales)
  // - p50, p95, p99 : percentiles de durationMs
  //   Percentile : trier les durees, prendre l'index ceil(p/100 * length) - 1
  throw new Error('Not implemented');
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
