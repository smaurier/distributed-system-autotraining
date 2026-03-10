// =============================================================================
// Lab 18 — Observabilite distribuee (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Correlation ID
// =============================================================================
// TODO: Implement function generateCorrelationId(): string
//   - Generate a UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
//   - y must be one of [8, 9, a, b]

// TODO: Implement function createCorrelationMiddleware():
//   (context: Record<string, unknown>) => Record<string, unknown>
//   - If context has no 'correlationId', add one via generateCorrelationId()
//   - Return the context (with correlationId)

// =============================================================================
// Exercise 2: Structured Distributed Log
// =============================================================================
// TODO: Define LogLevel type: 'debug' | 'info' | 'warn' | 'error'

// TODO: Define LogEntry interface:
//   { service: string; correlationId: string; timestamp: number; level: LogLevel; message: string; metadata?: Record<string, unknown> }

// TODO: Implement class StructuredLogger with:
//   - constructor(serviceName: string)
//   - setCorrelationId(id: string): void
//   - log(level: LogLevel, message: string, metadata?: Record<string, unknown>): LogEntry
//     - Create and store a LogEntry with current timestamp
//   - info(message: string, metadata?): LogEntry — shorthand
//   - warn(message: string, metadata?): LogEntry
//   - error(message: string, metadata?): LogEntry
//   - getEntries(): LogEntry[] — return all stored entries
//   - toJSON(): string[] — return entries as JSON strings

// =============================================================================
// Exercise 3: Request Tracing
// =============================================================================
// TODO: Define Span interface:
//   { spanId: string; name: string; startTime: number; endTime?: number; parentSpanId?: string; children: Span[] }

// TODO: Implement class SpanCollector with:
//   - startSpan(name: string, parentSpanId?: string): string — create span, return spanId
//   - endSpan(spanId: string): void — set endTime
//   - getSpan(spanId: string): Span | undefined
//   - getTrace(): Span[] — return root spans (those without parent) with nested children

// =============================================================================
// Exercise 4: Health Check Aggregator
// =============================================================================
// TODO: Define HealthStatus type: 'healthy' | 'degraded' | 'unhealthy'

// TODO: Define DependencyCheck interface:
//   { name: string; check: () => Promise<boolean>; critical: boolean }

// TODO: Define HealthCheckResult interface:
//   { status: HealthStatus; checks: { name: string; healthy: boolean; critical: boolean }[]; timestamp: number }

// TODO: Implement class HealthAggregator with:
//   - register(dep: DependencyCheck): void
//   - async checkAll(): Promise<HealthCheckResult>
//     - Run all checks
//     - healthy: all pass
//     - unhealthy: any critical check fails
//     - degraded: some non-critical checks fail

// =============================================================================
// Exercise 5: RED Metrics
// =============================================================================
// TODO: Define RequestData interface:
//   { timestamp: number; durationMs: number; isError: boolean }

// TODO: Define REDMetrics interface:
//   { rate: number; errorRate: number; p50: number; p95: number; p99: number }

// TODO: Implement function calculateREDMetrics(requests: RequestData[], windowMs: number): REDMetrics
//   - rate = count / (windowMs / 1000) — requests per second
//   - errorRate = (errors / total) * 100 — percentage
//   - p50, p95, p99: percentile durations (sort durations, pick index)

// =============================================================================
// Exercise 6: Alert Rules
// =============================================================================
// TODO: Define AlertRule interface:
//   { name: string; metric: string; operator: '>' | '<' | '>=' | '<='; threshold: number; forDurationMs: number }

// TODO: Define MetricDataPoint interface:
//   { timestamp: number; metric: string; value: number }

// TODO: Define AlertResult interface:
//   { rule: string; triggered: boolean; currentValue: number; threshold: number }

// TODO: Implement function evaluateAlertRules(
//   rules: AlertRule[], dataPoints: MetricDataPoint[], now: number
// ): AlertResult[]
//   - For each rule, check if the metric has exceeded the threshold
//     for the entire forDurationMs window (all data points in window match)
//   - Return an AlertResult per rule

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 18 — Observabilite distribuee');

// --- Exercise 1 Tests ---
await test('Ex1: generateCorrelationId returns UUID v4 format', () => {
  const id = generateCorrelationId();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert(uuidRegex.test(id), `Should match UUID v4 format, got: ${id}`);
});

await test('Ex1: generateCorrelationId returns unique values', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
  assertEqual(ids.size, 100);
});

await test('Ex1: middleware adds correlationId to context', () => {
  const middleware = createCorrelationMiddleware();
  const ctx = middleware({});
  assert(typeof ctx.correlationId === 'string', 'Should add correlationId');
});

await test('Ex1: middleware preserves existing correlationId', () => {
  const middleware = createCorrelationMiddleware();
  const ctx = middleware({ correlationId: 'existing-id' });
  assertEqual(ctx.correlationId, 'existing-id');
});

// --- Exercise 2 Tests ---
await test('Ex2: structured logger creates entries', () => {
  const logger = new StructuredLogger('order-service');
  logger.setCorrelationId('corr-123');
  const entry = logger.info('Order created', { orderId: 'ord-1' });
  assertEqual(entry.service, 'order-service');
  assertEqual(entry.correlationId, 'corr-123');
  assertEqual(entry.level, 'info');
  assertEqual(entry.message, 'Order created');
  assert(entry.timestamp > 0, 'Should have timestamp');
});

await test('Ex2: logger stores all entries', () => {
  const logger = new StructuredLogger('api-gateway');
  logger.setCorrelationId('corr-456');
  logger.info('Request received');
  logger.warn('Slow response');
  logger.error('Timeout');
  assertEqual(logger.getEntries().length, 3);
});

await test('Ex2: logger toJSON returns JSON strings', () => {
  const logger = new StructuredLogger('payment-service');
  logger.setCorrelationId('corr-789');
  logger.info('Payment processed');
  const jsonEntries = logger.toJSON();
  assertEqual(jsonEntries.length, 1);
  const parsed = JSON.parse(jsonEntries[0]);
  assertEqual(parsed.service, 'payment-service');
  assertEqual(parsed.level, 'info');
});

// --- Exercise 3 Tests ---
await test('Ex3: span collector creates and tracks spans', () => {
  const collector = new SpanCollector();
  const spanId = collector.startSpan('handle-request');
  assert(spanId.length > 0, 'Should return spanId');
  const span = collector.getSpan(spanId);
  assert(span !== undefined, 'Should find span');
  assertEqual(span!.name, 'handle-request');
  assert(span!.startTime > 0, 'Should have startTime');
});

await test('Ex3: span collector ends spans', async () => {
  const collector = new SpanCollector();
  const spanId = collector.startSpan('db-query');
  await simulateNetworkDelay(10);
  collector.endSpan(spanId);
  const span = collector.getSpan(spanId);
  assert(span!.endTime !== undefined, 'Should have endTime');
  assert(span!.endTime! >= span!.startTime, 'endTime >= startTime');
});

await test('Ex3: span collector builds span tree', () => {
  const collector = new SpanCollector();
  const parentId = collector.startSpan('request');
  const childId = collector.startSpan('db-call', parentId);
  collector.endSpan(childId);
  collector.endSpan(parentId);
  const trace = collector.getTrace();
  assertEqual(trace.length, 1); // one root span
  assertEqual(trace[0].name, 'request');
  assertEqual(trace[0].children.length, 1);
  assertEqual(trace[0].children[0].name, 'db-call');
});

// --- Exercise 4 Tests ---
await test('Ex4: health aggregator — all healthy', async () => {
  const aggregator = new HealthAggregator();
  aggregator.register({ name: 'database', check: async () => true, critical: true });
  aggregator.register({ name: 'cache', check: async () => true, critical: false });
  const result = await aggregator.checkAll();
  assertEqual(result.status, 'healthy');
  assertEqual(result.checks.length, 2);
});

await test('Ex4: health aggregator — critical failure = unhealthy', async () => {
  const aggregator = new HealthAggregator();
  aggregator.register({ name: 'database', check: async () => false, critical: true });
  aggregator.register({ name: 'cache', check: async () => true, critical: false });
  const result = await aggregator.checkAll();
  assertEqual(result.status, 'unhealthy');
});

await test('Ex4: health aggregator — non-critical failure = degraded', async () => {
  const aggregator = new HealthAggregator();
  aggregator.register({ name: 'database', check: async () => true, critical: true });
  aggregator.register({ name: 'cache', check: async () => false, critical: false });
  const result = await aggregator.checkAll();
  assertEqual(result.status, 'degraded');
});

// --- Exercise 5 Tests ---
await test('Ex5: RED metrics calculation', () => {
  const now = 10000;
  const requests: RequestData[] = [
    { timestamp: now - 900, durationMs: 100, isError: false },
    { timestamp: now - 700, durationMs: 200, isError: false },
    { timestamp: now - 500, durationMs: 50, isError: true },
    { timestamp: now - 300, durationMs: 150, isError: false },
  ];
  const metrics = calculateREDMetrics(requests, 1000);
  assertEqual(metrics.rate, 4); // 4 requests / 1 second
  assertEqual(metrics.errorRate, 25); // 1/4 = 25%
  assertEqual(metrics.p50, 100); // median of sorted [50, 100, 150, 200]
});

await test('Ex5: RED metrics with no errors', () => {
  const now = 10000;
  const requests: RequestData[] = [
    { timestamp: now - 500, durationMs: 100, isError: false },
    { timestamp: now - 300, durationMs: 200, isError: false },
  ];
  const metrics = calculateREDMetrics(requests, 1000);
  assertEqual(metrics.errorRate, 0);
});

// --- Exercise 6 Tests ---
await test('Ex6: alert rule triggers when threshold exceeded', () => {
  const now = 10000;
  const rules: AlertRule[] = [
    { name: 'high-error-rate', metric: 'error_rate', operator: '>', threshold: 5, forDurationMs: 2000 },
  ];
  const dataPoints: MetricDataPoint[] = [
    { timestamp: now - 1500, metric: 'error_rate', value: 10 },
    { timestamp: now - 1000, metric: 'error_rate', value: 12 },
    { timestamp: now - 500, metric: 'error_rate', value: 8 },
  ];
  const results = evaluateAlertRules(rules, dataPoints, now);
  assertEqual(results.length, 1);
  assertEqual(results[0].triggered, true);
});

await test('Ex6: alert rule does not trigger when below threshold', () => {
  const now = 10000;
  const rules: AlertRule[] = [
    { name: 'high-error-rate', metric: 'error_rate', operator: '>', threshold: 20, forDurationMs: 2000 },
  ];
  const dataPoints: MetricDataPoint[] = [
    { timestamp: now - 1500, metric: 'error_rate', value: 10 },
    { timestamp: now - 1000, metric: 'error_rate', value: 12 },
  ];
  const results = evaluateAlertRules(rules, dataPoints, now);
  assertEqual(results[0].triggered, false);
});

await test('Ex6: alert rule does not trigger when threshold exceeded only briefly', () => {
  const now = 10000;
  const rules: AlertRule[] = [
    { name: 'high-latency', metric: 'latency', operator: '>', threshold: 500, forDurationMs: 3000 },
  ];
  const dataPoints: MetricDataPoint[] = [
    { timestamp: now - 2000, metric: 'latency', value: 200 },
    { timestamp: now - 1000, metric: 'latency', value: 600 },
    { timestamp: now - 500, metric: 'latency', value: 700 },
  ];
  const results = evaluateAlertRules(rules, dataPoints, now);
  assertEqual(results[0].triggered, false);
});

summary();
