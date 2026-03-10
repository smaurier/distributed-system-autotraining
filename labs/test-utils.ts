// =============================================================================
// test-utils.ts — Utilitaires partages pour les labs Systemes Distribues (01-24)
// =============================================================================

export function createTestRunner(labName: string) {
  let passed = 0;
  let failed = 0;
  const errors: { name: string; error: Error }[] = [];

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ name, error });
      console.log(`  ❌ ${name}`);
      console.log(`     → ${error.message}`);
    }
  }

  function assert(condition: boolean, message: string = 'Assertion failed'): void {
    if (!condition) throw new Error(message);
  }

  function assertEqual<T>(actual: T, expected: T, message?: string): void {
    if (actual !== expected) {
      throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  function assertDeepEqual<T>(actual: T, expected: T, message?: string): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(message || `Expected ${b}, got ${a}`);
  }

  function assertThrows(fn: () => void, message?: string): void {
    try {
      fn();
      throw new Error(message || 'Expected function to throw');
    } catch (err) {
      if (err instanceof Error && err.message === (message || 'Expected function to throw')) throw err;
    }
  }

  function assertIncludes(haystack: string | unknown[], needle: unknown, message?: string): void {
    if (typeof haystack === 'string' && typeof needle === 'string') {
      if (!haystack.includes(needle)) throw new Error(message || `Expected string to include "${needle}"`);
    } else if (Array.isArray(haystack)) {
      if (!haystack.includes(needle)) throw new Error(message || `Expected array to include ${JSON.stringify(needle)}`);
    }
  }

  function assertType<_T>(_message?: string): void {}

  function assertGreaterThan(actual: number, expected: number, message?: string): void {
    if (!(actual > expected)) throw new Error(message || `Expected ${actual} > ${expected}`);
  }

  function assertLessThan(actual: number, expected: number, message?: string): void {
    if (!(actual < expected)) throw new Error(message || `Expected ${actual} < ${expected}`);
  }

  function summary(): { passed: number; failed: number; total: number } {
    const total = passed + failed;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📊 ${labName} — Resultats : ${passed}/${total} tests reussis`);
    if (failed > 0) {
      console.log(`\n❌ ${failed} test(s) echoue(s) :`);
      errors.forEach(({ name, error }) => { console.log(`   • ${name} : ${error.message}`); });
    } else {
      console.log(`\n🎉 Tous les tests passent !`);
    }
    console.log(`${'─'.repeat(50)}\n`);
    return { passed, failed, total };
  }

  return { test, assert, assertEqual, assertDeepEqual, assertThrows, assertIncludes, assertType, assertGreaterThan, assertLessThan, summary };
}

// =============================================================================
// Helpers Systemes Distribues
// =============================================================================

/** Simule un delai reseau */
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Simule une panne reseau avec une probabilite donnee */
export function simulateNetworkFailure(probability: number): void {
  if (Math.random() < probability) {
    throw new Error('Network failure: connection refused');
  }
}

/** Verifie qu'une fonction est idempotente (meme resultat apres N appels) */
export async function assertIdempotent<T>(fn: () => T | Promise<T>, times: number = 3): Promise<void> {
  const results: T[] = [];
  for (let i = 0; i < times; i++) {
    results.push(await fn());
  }
  const first = JSON.stringify(results[0]);
  for (let i = 1; i < results.length; i++) {
    if (JSON.stringify(results[i]) !== first) {
      throw new Error(`Function is not idempotent: call ${i + 1} returned different result`);
    }
  }
}

/** Verifie qu'une valeur converge eventuellement vers l'attendu */
export async function assertEventuallyConsistent<T>(
  fn: () => T | Promise<T>,
  expected: T,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (JSON.stringify(result) === JSON.stringify(expected)) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Value did not converge to ${JSON.stringify(expected)} within ${timeoutMs}ms`);
}

/** Genere des messages simules */
export function simulateMessages(count: number, options?: { errorRate?: number }): Array<{ id: string; payload: string; timestamp: number; error?: boolean }> {
  const msgs = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      id: `msg-${i.toString().padStart(4, '0')}`,
      payload: `Message ${i}`,
      timestamp: Date.now() + i * 10,
      error: options?.errorRate ? Math.random() < options.errorRate : false,
    });
  }
  return msgs;
}

/** Calcule le backoff exponentiel */
export function calculateExponentialBackoff(attempt: number, baseMs: number = 100, maxMs: number = 30000, jitter: boolean = true): number {
  const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  return jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
}

/** Verifie l'etat d'un circuit breaker */
export function assertCircuitBreakerState(breaker: { state: string }, expectedState: string): void {
  if (breaker.state !== expectedState) {
    throw new Error(`Expected circuit breaker state "${expectedState}", got "${breaker.state}"`);
  }
}

/** Cree un mock de message broker */
export function createMockMessageBroker(): { publish: (channel: string, msg: unknown) => void; subscribe: (channel: string, handler: (msg: unknown) => void) => void; getMessages: (channel: string) => unknown[]; clear: () => void } {
  const channels = new Map<string, unknown[]>();
  const subscribers = new Map<string, ((msg: unknown) => void)[]>();
  return {
    publish(channel, msg) {
      if (!channels.has(channel)) channels.set(channel, []);
      channels.get(channel)!.push(msg);
      (subscribers.get(channel) || []).forEach(handler => handler(msg));
    },
    subscribe(channel, handler) {
      if (!subscribers.has(channel)) subscribers.set(channel, []);
      subscribers.get(channel)!.push(handler);
    },
    getMessages(channel) { return channels.get(channel) || []; },
    clear() { channels.clear(); subscribers.clear(); },
  };
}

/** Verifie les transactions compensatoires d'une saga */
export async function assertCompensatingTransaction(
  saga: { execute: () => Promise<void>; getCompensations: () => string[] },
  failAtStep: number
): Promise<void> {
  try {
    await saga.execute();
  } catch {
    const compensations = saga.getCompensations();
    if (compensations.length !== failAtStep) {
      throw new Error(`Expected ${failAtStep} compensating transactions, got ${compensations.length}`);
    }
  }
}

/** Cree un mock de key-value store */
export function createMockKVStore(): { get: (key: string) => unknown | undefined; set: (key: string, value: unknown) => void; delete: (key: string) => boolean; has: (key: string) => boolean; clear: () => void; size: () => number } {
  const store = new Map<string, unknown>();
  return {
    get(key) { return store.get(key); },
    set(key, value) { store.set(key, value); },
    delete(key) { return store.delete(key); },
    has(key) { return store.has(key); },
    clear() { store.clear(); },
    size() { return store.size; },
  };
}

/** Simule des requetes HTTP avec latence et erreurs */
export function simulateRequests(count: number, options?: { errorRate?: number; minLatencyMs?: number; maxLatencyMs?: number }): Array<{ status: number; durationMs: number; timestamp: number }> {
  const { errorRate = 0.01, minLatencyMs = 10, maxLatencyMs = 500 } = options || {};
  const requests = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const isError = Math.random() < errorRate;
    const durationMs = minLatencyMs + Math.random() * (maxLatencyMs - minLatencyMs);
    requests.push({
      status: isError ? (Math.random() < 0.5 ? 500 : 503) : 200,
      durationMs: Math.round(durationMs * 100) / 100,
      timestamp: now + i * 100,
    });
  }
  return requests;
}
