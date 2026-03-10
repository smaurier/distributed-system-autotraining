// =============================================================================
// Lab 15 — Failure Modes (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Partial Failure Simulation
// =============================================================================
// TODO: Define ServiceResult interface:
//   { serviceName: string; status: 'success' | 'failure'; data?: string; error?: string; durationMs: number }

// TODO: Implement async callServices(serviceNames: string[], failureProbability: number): Promise<ServiceResult[]>
//   - For each service, simulate a call:
//     - Use Math.random() < failureProbability to decide if the call fails
//     - Record a durationMs (random 10-100ms)
//     - On success: status='success', data=`${serviceName}: OK`
//     - On failure: status='failure', error=`${serviceName}: Connection refused`
//   - Return array of ServiceResult

// =============================================================================
// Exercise 2: Cascading Failure
// =============================================================================
// TODO: Define CascadeStep interface:
//   { service: string; status: 'success' | 'timeout' | 'failure'; reason: string; timestamp: number }

// TODO: Implement async simulateCascadingFailure(options: {
//   services: string[];          // e.g. ['A', 'B', 'C']
//   failingService: string;      // e.g. 'C'
//   timeoutMs: number;
// }): Promise<CascadeStep[]>
//   - Call services from last to first (C, then B, then A)
//   - The failingService throws an error
//   - The service that depends on the failing one times out
//   - The service that depends on the timed-out one fails
//   - Track each step in a CascadeStep array

// =============================================================================
// Exercise 3: Gray Failure Detection
// =============================================================================
// TODO: Implement class GrayFailureDetector with:
//   - constructor(windowSize: number, grayMin: number = 0.05, grayMax: number = 0.5)
//   - record(success: boolean): void — add result to sliding window
//   - getErrorRate(): number — calculate error rate from window
//   - getStatus(): 'healthy' | 'gray-failure' | 'failing'
//     - healthy: errorRate < grayMin
//     - gray-failure: grayMin <= errorRate <= grayMax
//     - failing: errorRate > grayMax
//   - getWindowSize(): number — return current number of records

// =============================================================================
// Exercise 4: Fail-Fast Validation
// =============================================================================
// TODO: Define ValidationRule interface:
//   { name: string; check: () => boolean; message: string }

// TODO: Define ValidationResult interface:
//   { valid: boolean; errors: string[] }

// TODO: Implement function failFastValidate(rules: ValidationRule[]): ValidationResult
//   - Run each rule's check()
//   - Collect all failed rule messages
//   - Return { valid: true/false, errors: [...] }

// TODO: Implement async function executeWithValidation<T>(
//   rules: ValidationRule[],
//   operation: () => Promise<T>
// ): Promise<T>
//   - Validate rules first; throw Error with joined messages if invalid
//   - If valid, execute and return the operation result

// =============================================================================
// Exercise 5: Blast Radius Calculation
// =============================================================================
// TODO: Define BlastRadiusResult interface:
//   { totalCells: number; failedCells: number; totalUsers: number; affectedUsers: number; percentAffected: number }

// TODO: Implement function calculateBlastRadius(cells: { name: string; users: number }[], failedCellNames: string[]): BlastRadiusResult
//   - Sum total users across all cells
//   - Sum affected users in failed cells
//   - Calculate percentAffected = (affectedUsers / totalUsers) * 100
//   - Return BlastRadiusResult

// =============================================================================
// Exercise 6: Heartbeat Detector
// =============================================================================
// TODO: Implement class HeartbeatDetector with:
//   - constructor(suspectTimeoutMs: number, failedTimeoutMs: number)
//   - registerNode(nodeId: string): void — register a node with current timestamp
//   - heartbeat(nodeId: string): void — update last heartbeat timestamp
//   - checkNodes(now: number): Map<string, 'alive' | 'suspected' | 'failed'>
//     - alive: last heartbeat within suspectTimeoutMs
//     - suspected: last heartbeat between suspectTimeoutMs and failedTimeoutMs
//     - failed: last heartbeat older than failedTimeoutMs
//   - getNodeStatus(nodeId: string, now: number): 'alive' | 'suspected' | 'failed' | 'unknown'

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
