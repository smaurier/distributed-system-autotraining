// =============================================================================
// Lab 18 — Observabilite distribuee (Solution)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Correlation ID
// =============================================================================

function generateCorrelationId(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const s = (n: number) => Array.from({ length: n }, hex).join('');
  const variant = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  return `${s(8)}-${s(4)}-4${s(3)}-${variant}${s(3)}-${s(12)}`;
}

function createCorrelationMiddleware(): (context: Record<string, unknown>) => Record<string, unknown> {
  return (context: Record<string, unknown>) => {
    if (!context.correlationId) {
      context.correlationId = generateCorrelationId();
    }
    return context;
  };
}

// =============================================================================
// Exercise 2: Structured Distributed Log
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  service: string;
  correlationId: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

class StructuredLogger {
  private serviceName: string;
  private correlationId = '';
  private entries: LogEntry[] = [];

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  log(level: LogLevel, message: string, metadata?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      service: this.serviceName,
      correlationId: this.correlationId,
      timestamp: Date.now(),
      level,
      message,
    };
    if (metadata) entry.metadata = metadata;
    this.entries.push(entry);
    return entry;
  }

  info(message: string, metadata?: Record<string, unknown>): LogEntry {
    return this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): LogEntry {
    return this.log('warn', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): LogEntry {
    return this.log('error', message, metadata);
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }

  toJSON(): string[] {
    return this.entries.map(e => JSON.stringify(e));
  }
}

// =============================================================================
// Exercise 3: Request Tracing
// =============================================================================

interface Span {
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentSpanId?: string;
  children: Span[];
}

class SpanCollector {
  private spans: Map<string, Span> = new Map();
  private counter = 0;

  startSpan(name: string, parentSpanId?: string): string {
    const spanId = `span-${++this.counter}-${Date.now()}`;
    const span: Span = {
      spanId,
      name,
      startTime: Date.now(),
      parentSpanId,
      children: [],
    };
    this.spans.set(spanId, span);

    if (parentSpanId) {
      const parent = this.spans.get(parentSpanId);
      if (parent) {
        parent.children.push(span);
      }
    }

    return spanId;
  }

  endSpan(spanId: string): void {
    const span = this.spans.get(spanId);
    if (span) {
      span.endTime = Date.now();
    }
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  getTrace(): Span[] {
    const roots: Span[] = [];
    for (const span of this.spans.values()) {
      if (!span.parentSpanId) {
        roots.push(span);
      }
    }
    return roots;
  }
}

// =============================================================================
// Exercise 4: Health Check Aggregator
// =============================================================================

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface DependencyCheck {
  name: string;
  check: () => Promise<boolean>;
  critical: boolean;
}

interface HealthCheckResult {
  status: HealthStatus;
  checks: { name: string; healthy: boolean; critical: boolean }[];
  timestamp: number;
}

class HealthAggregator {
  private dependencies: DependencyCheck[] = [];

  register(dep: DependencyCheck): void {
    this.dependencies.push(dep);
  }

  async checkAll(): Promise<HealthCheckResult> {
    const checks: { name: string; healthy: boolean; critical: boolean }[] = [];

    for (const dep of this.dependencies) {
      let healthy: boolean;
      try {
        healthy = await dep.check();
      } catch {
        healthy = false;
      }
      checks.push({ name: dep.name, healthy, critical: dep.critical });
    }

    let status: HealthStatus = 'healthy';
    const hasCriticalFailure = checks.some(c => c.critical && !c.healthy);
    const hasAnyFailure = checks.some(c => !c.healthy);

    if (hasCriticalFailure) {
      status = 'unhealthy';
    } else if (hasAnyFailure) {
      status = 'degraded';
    }

    return { status, checks, timestamp: Date.now() };
  }
}

// =============================================================================
// Exercise 5: RED Metrics
// =============================================================================

interface RequestData {
  timestamp: number;
  durationMs: number;
  isError: boolean;
}

interface REDMetrics {
  rate: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
}

function calculateREDMetrics(requests: RequestData[], windowMs: number): REDMetrics {
  if (requests.length === 0) {
    return { rate: 0, errorRate: 0, p50: 0, p95: 0, p99: 0 };
  }

  const count = requests.length;
  const rate = count / (windowMs / 1000);
  const errors = requests.filter(r => r.isError).length;
  const errorRate = (errors / count) * 100;

  const durations = requests.map(r => r.durationMs).sort((a, b) => a - b);

  function percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  return {
    rate,
    errorRate,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
  };
}

// =============================================================================
// Exercise 6: Alert Rules
// =============================================================================

interface AlertRule {
  name: string;
  metric: string;
  operator: '>' | '<' | '>=' | '<=';
  threshold: number;
  forDurationMs: number;
}

interface MetricDataPoint {
  timestamp: number;
  metric: string;
  value: number;
}

interface AlertResult {
  rule: string;
  triggered: boolean;
  currentValue: number;
  threshold: number;
}

function evaluateAlertRules(
  rules: AlertRule[],
  dataPoints: MetricDataPoint[],
  now: number
): AlertResult[] {
  return rules.map(rule => {
    const relevantPoints = dataPoints.filter(
      dp => dp.metric === rule.metric && dp.timestamp >= now - rule.forDurationMs
    );

    const currentValue = relevantPoints.length > 0
      ? relevantPoints[relevantPoints.length - 1].value
      : 0;

    function compare(value: number, operator: string, threshold: number): boolean {
      switch (operator) {
        case '>': return value > threshold;
        case '<': return value < threshold;
        case '>=': return value >= threshold;
        case '<=': return value <= threshold;
        default: return false;
      }
    }

    // All points in the window must exceed the threshold for the alert to trigger
    const triggered = relevantPoints.length > 0 &&
      relevantPoints.every(dp => compare(dp.value, rule.operator, rule.threshold));

    return {
      rule: rule.name,
      triggered,
      currentValue,
      threshold: rule.threshold,
    };
  });
}

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
