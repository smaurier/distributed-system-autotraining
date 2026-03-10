// =============================================================================
// Lab 15 — Failure Modes (Solution)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Partial Failure Simulation
// =============================================================================

interface ServiceResult {
  serviceName: string;
  status: 'success' | 'failure';
  data?: string;
  error?: string;
  durationMs: number;
}

async function callServices(
  serviceNames: string[],
  failureProbability: number
): Promise<ServiceResult[]> {
  const results: ServiceResult[] = [];

  for (const serviceName of serviceNames) {
    const start = Date.now();
    const shouldFail = Math.random() < failureProbability;
    const durationMs = Math.round(10 + Math.random() * 90);

    if (shouldFail) {
      results.push({
        serviceName,
        status: 'failure',
        error: `${serviceName}: Connection refused`,
        durationMs,
      });
    } else {
      results.push({
        serviceName,
        status: 'success',
        data: `${serviceName}: OK`,
        durationMs,
      });
    }
  }

  return results;
}

// =============================================================================
// Exercise 2: Cascading Failure
// =============================================================================

interface CascadeStep {
  service: string;
  status: 'success' | 'timeout' | 'failure';
  reason: string;
  timestamp: number;
}

async function simulateCascadingFailure(options: {
  services: string[];
  failingService: string;
  timeoutMs: number;
}): Promise<CascadeStep[]> {
  const { services, failingService, timeoutMs } = options;
  const steps: CascadeStep[] = [];

  // Process from last service to first (C -> B -> A)
  const reversed = [...services].reverse();
  let previousStatus: 'success' | 'timeout' | 'failure' = 'success';

  for (const service of reversed) {
    const timestamp = Date.now();

    if (service === failingService) {
      steps.push({
        service,
        status: 'failure',
        reason: `${service} crashed: internal error`,
        timestamp,
      });
      previousStatus = 'failure';
    } else if (previousStatus === 'failure') {
      // Depends on the failed service -> times out
      await simulateNetworkDelay(timeoutMs);
      steps.push({
        service,
        status: 'timeout',
        reason: `${service} timed out waiting for downstream service`,
        timestamp: Date.now(),
      });
      previousStatus = 'timeout';
    } else if (previousStatus === 'timeout') {
      // Depends on the timed-out service -> fails
      steps.push({
        service,
        status: 'failure',
        reason: `${service} failed: downstream service unavailable`,
        timestamp: Date.now(),
      });
      previousStatus = 'failure';
    } else {
      steps.push({
        service,
        status: 'success',
        reason: `${service} responded normally`,
        timestamp,
      });
    }
  }

  return steps;
}

// =============================================================================
// Exercise 3: Gray Failure Detection
// =============================================================================

class GrayFailureDetector {
  private window: boolean[] = [];
  private windowSize: number;
  private grayMin: number;
  private grayMax: number;

  constructor(windowSize: number, grayMin: number = 0.05, grayMax: number = 0.5) {
    this.windowSize = windowSize;
    this.grayMin = grayMin;
    this.grayMax = grayMax;
  }

  record(success: boolean): void {
    this.window.push(success);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
  }

  getErrorRate(): number {
    if (this.window.length === 0) return 0;
    const errors = this.window.filter(s => !s).length;
    return errors / this.window.length;
  }

  getStatus(): 'healthy' | 'gray-failure' | 'failing' {
    const errorRate = this.getErrorRate();
    if (errorRate < this.grayMin) return 'healthy';
    if (errorRate <= this.grayMax) return 'gray-failure';
    return 'failing';
  }

  getWindowSize(): number {
    return this.window.length;
  }
}

// =============================================================================
// Exercise 4: Fail-Fast Validation
// =============================================================================

interface ValidationRule {
  name: string;
  check: () => boolean;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function failFastValidate(rules: ValidationRule[]): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    if (!rule.check()) {
      errors.push(rule.message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function executeWithValidation<T>(
  rules: ValidationRule[],
  operation: () => Promise<T>
): Promise<T> {
  const validation = failFastValidate(rules);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }
  return operation();
}

// =============================================================================
// Exercise 5: Blast Radius Calculation
// =============================================================================

interface BlastRadiusResult {
  totalCells: number;
  failedCells: number;
  totalUsers: number;
  affectedUsers: number;
  percentAffected: number;
}

function calculateBlastRadius(
  cells: { name: string; users: number }[],
  failedCellNames: string[]
): BlastRadiusResult {
  const totalCells = cells.length;
  const failedCells = failedCellNames.length;
  const totalUsers = cells.reduce((sum, c) => sum + c.users, 0);
  const affectedUsers = cells
    .filter(c => failedCellNames.includes(c.name))
    .reduce((sum, c) => sum + c.users, 0);
  const percentAffected = totalUsers === 0 ? 0 : (affectedUsers / totalUsers) * 100;

  return { totalCells, failedCells, totalUsers, affectedUsers, percentAffected };
}

// =============================================================================
// Exercise 6: Heartbeat Detector
// =============================================================================

class HeartbeatDetector {
  private suspectTimeoutMs: number;
  private failedTimeoutMs: number;
  private nodes: Map<string, number> = new Map();

  constructor(suspectTimeoutMs: number, failedTimeoutMs: number) {
    this.suspectTimeoutMs = suspectTimeoutMs;
    this.failedTimeoutMs = failedTimeoutMs;
  }

  registerNode(nodeId: string): void {
    this.nodes.set(nodeId, Date.now());
  }

  heartbeat(nodeId: string): void {
    this.nodes.set(nodeId, Date.now());
  }

  checkNodes(now: number): Map<string, 'alive' | 'suspected' | 'failed'> {
    const statuses = new Map<string, 'alive' | 'suspected' | 'failed'>();

    for (const [nodeId, lastHeartbeat] of this.nodes) {
      const elapsed = now - lastHeartbeat;
      if (elapsed <= this.suspectTimeoutMs) {
        statuses.set(nodeId, 'alive');
      } else if (elapsed <= this.failedTimeoutMs) {
        statuses.set(nodeId, 'suspected');
      } else {
        statuses.set(nodeId, 'failed');
      }
    }

    return statuses;
  }

  getNodeStatus(nodeId: string, now: number): 'alive' | 'suspected' | 'failed' | 'unknown' {
    if (!this.nodes.has(nodeId)) return 'unknown';
    const lastHeartbeat = this.nodes.get(nodeId)!;
    const elapsed = now - lastHeartbeat;
    if (elapsed <= this.suspectTimeoutMs) return 'alive';
    if (elapsed <= this.failedTimeoutMs) return 'suspected';
    return 'failed';
  }
}

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 15 — Failure Modes');

// --- Exercise 1 Tests ---
await test('Ex1: callServices returns results for all services', async () => {
  const results = await callServices(['svc-1', 'svc-2', 'svc-3'], 0);
  assertEqual(results.length, 3);
  for (const r of results) {
    assertEqual(r.status, 'success');
    assert(r.data !== undefined, 'Should have data on success');
  }
});

await test('Ex1: callServices with 100% failure', async () => {
  const results = await callServices(['svc-1', 'svc-2'], 1);
  for (const r of results) {
    assertEqual(r.status, 'failure');
    assert(r.error !== undefined, 'Should have error on failure');
  }
});

await test('Ex1: callServices records durationMs', async () => {
  const results = await callServices(['svc-1'], 0);
  assert(results[0].durationMs >= 0, 'Should have durationMs');
});

// --- Exercise 2 Tests ---
await test('Ex2: cascading failure propagates from C to A', async () => {
  const steps = await simulateCascadingFailure({
    services: ['A', 'B', 'C'],
    failingService: 'C',
    timeoutMs: 50,
  });
  assertEqual(steps.length, 3);
  const cStep = steps.find(s => s.service === 'C');
  const bStep = steps.find(s => s.service === 'B');
  const aStep = steps.find(s => s.service === 'A');
  assert(cStep !== undefined, 'Should have C step');
  assertEqual(cStep!.status, 'failure');
  assert(bStep !== undefined, 'Should have B step');
  assertEqual(bStep!.status, 'timeout');
  assert(aStep !== undefined, 'Should have A step');
  assertEqual(aStep!.status, 'failure');
});

await test('Ex2: cascade tracks timestamps in order', async () => {
  const steps = await simulateCascadingFailure({
    services: ['A', 'B', 'C'],
    failingService: 'C',
    timeoutMs: 50,
  });
  for (let i = 1; i < steps.length; i++) {
    assert(steps[i].timestamp >= steps[i - 1].timestamp, 'Timestamps should be non-decreasing');
  }
});

// --- Exercise 3 Tests ---
await test('Ex3: gray failure detector — healthy', () => {
  const detector = new GrayFailureDetector(100, 0.05, 0.5);
  for (let i = 0; i < 100; i++) detector.record(true);
  assertEqual(detector.getStatus(), 'healthy');
  assertLessThan(detector.getErrorRate(), 0.05);
});

await test('Ex3: gray failure detector — gray failure', () => {
  const detector = new GrayFailureDetector(100, 0.05, 0.5);
  for (let i = 0; i < 80; i++) detector.record(true);
  for (let i = 0; i < 20; i++) detector.record(false);
  assertEqual(detector.getStatus(), 'gray-failure');
});

await test('Ex3: gray failure detector — failing', () => {
  const detector = new GrayFailureDetector(100, 0.05, 0.5);
  for (let i = 0; i < 30; i++) detector.record(true);
  for (let i = 0; i < 70; i++) detector.record(false);
  assertEqual(detector.getStatus(), 'failing');
});

await test('Ex3: sliding window respects size', () => {
  const detector = new GrayFailureDetector(10, 0.05, 0.5);
  for (let i = 0; i < 20; i++) detector.record(true);
  assertEqual(detector.getWindowSize(), 10);
});

// --- Exercise 4 Tests ---
await test('Ex4: fail-fast passes when all rules pass', () => {
  const result = failFastValidate([
    { name: 'config-check', check: () => true, message: 'Config missing' },
    { name: 'dep-check', check: () => true, message: 'Dependency unavailable' },
  ]);
  assertEqual(result.valid, true);
  assertEqual(result.errors.length, 0);
});

await test('Ex4: fail-fast fails with error messages', () => {
  const result = failFastValidate([
    { name: 'config-check', check: () => false, message: 'Config missing' },
    { name: 'dep-check', check: () => true, message: 'Dependency unavailable' },
  ]);
  assertEqual(result.valid, false);
  assertEqual(result.errors.length, 1);
  assertEqual(result.errors[0], 'Config missing');
});

await test('Ex4: executeWithValidation throws on invalid', async () => {
  try {
    await executeWithValidation(
      [{ name: 'check', check: () => false, message: 'Bad input' }],
      async () => 'should not run'
    );
    throw new Error('Should have thrown');
  } catch (err) {
    assert((err as Error).message.includes('Bad input'), 'Should include validation message');
  }
});

await test('Ex4: executeWithValidation runs operation when valid', async () => {
  const result = await executeWithValidation(
    [{ name: 'check', check: () => true, message: 'OK' }],
    async () => 42
  );
  assertEqual(result, 42);
});

// --- Exercise 5 Tests ---
await test('Ex5: blast radius with no failures', () => {
  const result = calculateBlastRadius(
    [{ name: 'cell-1', users: 1000 }, { name: 'cell-2', users: 2000 }],
    []
  );
  assertEqual(result.totalCells, 2);
  assertEqual(result.failedCells, 0);
  assertEqual(result.affectedUsers, 0);
  assertEqual(result.percentAffected, 0);
});

await test('Ex5: blast radius with some failures', () => {
  const result = calculateBlastRadius(
    [
      { name: 'cell-1', users: 1000 },
      { name: 'cell-2', users: 2000 },
      { name: 'cell-3', users: 1000 },
    ],
    ['cell-2']
  );
  assertEqual(result.totalCells, 3);
  assertEqual(result.failedCells, 1);
  assertEqual(result.totalUsers, 4000);
  assertEqual(result.affectedUsers, 2000);
  assertEqual(result.percentAffected, 50);
});

await test('Ex5: blast radius with all failures', () => {
  const result = calculateBlastRadius(
    [{ name: 'cell-1', users: 500 }, { name: 'cell-2', users: 500 }],
    ['cell-1', 'cell-2']
  );
  assertEqual(result.percentAffected, 100);
});

// --- Exercise 6 Tests ---
await test('Ex6: heartbeat detector — alive node', () => {
  const detector = new HeartbeatDetector(1000, 3000);
  const now = Date.now();
  detector.registerNode('node-1');
  detector.heartbeat('node-1');
  const statuses = detector.checkNodes(now + 500);
  assertEqual(statuses.get('node-1'), 'alive');
});

await test('Ex6: heartbeat detector — suspected node', () => {
  const detector = new HeartbeatDetector(1000, 3000);
  const now = Date.now();
  detector.registerNode('node-1');
  detector.heartbeat('node-1');
  const statuses = detector.checkNodes(now + 1500);
  assertEqual(statuses.get('node-1'), 'suspected');
});

await test('Ex6: heartbeat detector — failed node', () => {
  const detector = new HeartbeatDetector(1000, 3000);
  const now = Date.now();
  detector.registerNode('node-1');
  detector.heartbeat('node-1');
  const statuses = detector.checkNodes(now + 4000);
  assertEqual(statuses.get('node-1'), 'failed');
});

await test('Ex6: heartbeat detector — unknown node', () => {
  const detector = new HeartbeatDetector(1000, 3000);
  assertEqual(detector.getNodeStatus('unknown', Date.now()), 'unknown');
});

summary();
