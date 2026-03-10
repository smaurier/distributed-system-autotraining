// =============================================================================
// Lab 17 — Rate Limiting (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Fixed Window Rate Limiter
// =============================================================================
// TODO: Implement class FixedWindowRateLimiter with:
//   - constructor(maxRequests: number, windowMs: number)
//   - tryRequest(now?: number): boolean
//     - If in the same window and count < max, allow (return true) and increment
//     - If in the same window and count >= max, reject (return false)
//     - If in a new window, reset count and allow
//   - getRemainingRequests(now?: number): number
//   - getWindowResetTime(now?: number): number — timestamp when current window ends

// =============================================================================
// Exercise 2: Sliding Window Rate Limiter
// =============================================================================
// TODO: Implement class SlidingWindowRateLimiter with:
//   - constructor(maxRequests: number, windowMs: number)
//   - tryRequest(now?: number): boolean
//     - Calculate weighted count: currentWindowCount + previousWindowCount * overlapRatio
//     - overlapRatio = (windowMs - elapsedInCurrentWindow) / windowMs
//     - Allow if weighted count < maxRequests
//   - getEstimatedCount(now?: number): number — return the weighted count

// =============================================================================
// Exercise 3: Token Bucket
// =============================================================================
// TODO: Implement class TokenBucket with:
//   - constructor(maxTokens: number, refillRate: number) // refillRate = tokens per second
//   - tryConsume(now?: number): boolean — consume 1 token if available
//   - getAvailableTokens(now?: number): number — refill first, then return count
//   - refill(now?: number): void — add tokens based on elapsed time since last refill
//     - tokens = Math.min(maxTokens, currentTokens + elapsed * refillRate)

// =============================================================================
// Exercise 4: Rate Limit Headers
// =============================================================================
// TODO: Define RateLimitHeaders interface:
//   { 'X-RateLimit-Limit': number; 'X-RateLimit-Remaining': number;
//     'X-RateLimit-Reset': number; 'Retry-After'?: number }

// TODO: Implement function generateRateLimitHeaders(
//   limit: number, remaining: number, resetTimestamp: number, now?: number
// ): RateLimitHeaders
//   - X-RateLimit-Limit = limit
//   - X-RateLimit-Remaining = remaining
//   - X-RateLimit-Reset = resetTimestamp (Unix seconds)
//   - Retry-After = seconds until reset (only if remaining <= 0)

// =============================================================================
// Exercise 5: Priority Rate Limiting
// =============================================================================
// TODO: Define PriorityLevel type: 'high' | 'normal' | 'low'

// TODO: Implement class PriorityRateLimiter with:
//   - constructor(limits: Record<PriorityLevel, number>, windowMs: number)
//     - limits is e.g. { high: 100, normal: 50, low: 10 }
//   - tryRequest(priority: PriorityLevel, now?: number): boolean
//   - getRemainingRequests(priority: PriorityLevel, now?: number): number

// =============================================================================
// Exercise 6: Load Shedding
// =============================================================================
// TODO: Define SystemMetrics interface:
//   { cpuUsage: number; memoryUsage: number; avgLatencyMs: number }

// TODO: Define LoadSheddingConfig interface:
//   { maxCpuUsage: number; maxMemoryUsage: number; maxLatencyMs: number }

// TODO: Implement class LoadShedder with:
//   - constructor(config: LoadSheddingConfig)
//   - shouldShed(metrics: SystemMetrics): boolean
//     - Return true if ANY metric exceeds its threshold
//   - getOverloadedResources(metrics: SystemMetrics): string[]
//     - Return list of resources that exceed thresholds (e.g. ['cpu', 'memory', 'latency'])

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 17 — Rate Limiting');

// --- Exercise 1 Tests ---
await test('Ex1: fixed window allows requests within limit', () => {
  const limiter = new FixedWindowRateLimiter(3, 60000);
  const now = 1000;
  assertEqual(limiter.tryRequest(now), true);
  assertEqual(limiter.tryRequest(now + 10), true);
  assertEqual(limiter.tryRequest(now + 20), true);
  assertEqual(limiter.tryRequest(now + 30), false);
});

await test('Ex1: fixed window resets after window expires', () => {
  const limiter = new FixedWindowRateLimiter(2, 1000);
  const now = 1000;
  assertEqual(limiter.tryRequest(now), true);
  assertEqual(limiter.tryRequest(now + 100), true);
  assertEqual(limiter.tryRequest(now + 200), false);
  // New window
  assertEqual(limiter.tryRequest(now + 1100), true);
});

await test('Ex1: fixed window tracks remaining requests', () => {
  const limiter = new FixedWindowRateLimiter(5, 60000);
  const now = 1000;
  assertEqual(limiter.getRemainingRequests(now), 5);
  limiter.tryRequest(now);
  assertEqual(limiter.getRemainingRequests(now + 10), 4);
});

// --- Exercise 2 Tests ---
await test('Ex2: sliding window allows requests within weighted limit', () => {
  const limiter = new SlidingWindowRateLimiter(10, 1000);
  const now = 1000;
  for (let i = 0; i < 10; i++) {
    assertEqual(limiter.tryRequest(now + i), true);
  }
  assertEqual(limiter.tryRequest(now + 11), false);
});

await test('Ex2: sliding window uses weighted count from previous window', () => {
  const limiter = new SlidingWindowRateLimiter(10, 1000);
  const now = 1000;
  // Fill 8 requests in first window
  for (let i = 0; i < 8; i++) limiter.tryRequest(now + i);
  // At start of new window, previous window weight is high
  // 500ms into new window: weight = (1000-500)/1000 = 0.5, so prev contributes 8*0.5=4
  // So we have room for 10-4=6 more
  const halfWindow = now + 1500; // 500ms into second window
  const estimated = limiter.getEstimatedCount(halfWindow);
  assertEqual(estimated, 4); // 8 * 0.5
});

// --- Exercise 3 Tests ---
await test('Ex3: token bucket allows burst up to max', () => {
  const bucket = new TokenBucket(5, 1);
  const now = 1000;
  for (let i = 0; i < 5; i++) {
    assertEqual(bucket.tryConsume(now + i), true);
  }
  assertEqual(bucket.tryConsume(now + 6), false);
});

await test('Ex3: token bucket refills over time', () => {
  const bucket = new TokenBucket(5, 2); // 2 tokens/sec
  const now = 1000;
  // Consume all tokens
  for (let i = 0; i < 5; i++) bucket.tryConsume(now);
  assertEqual(bucket.getAvailableTokens(now), 0);
  // After 1 second, should have 2 tokens
  assertEqual(bucket.getAvailableTokens(now + 1000), 2);
});

await test('Ex3: token bucket does not exceed max', () => {
  const bucket = new TokenBucket(3, 10); // 10 tokens/sec but max 3
  const now = 1000;
  assertEqual(bucket.getAvailableTokens(now + 5000), 3);
});

// --- Exercise 4 Tests ---
await test('Ex4: generates rate limit headers', () => {
  const now = 1000;
  const resetTimestamp = 61;
  const headers = generateRateLimitHeaders(100, 42, resetTimestamp, now);
  assertEqual(headers['X-RateLimit-Limit'], 100);
  assertEqual(headers['X-RateLimit-Remaining'], 42);
  assertEqual(headers['X-RateLimit-Reset'], resetTimestamp);
  assertEqual(headers['Retry-After'], undefined);
});

await test('Ex4: includes Retry-After when exhausted', () => {
  const nowSec = 50;
  const resetTimestamp = 60;
  const headers = generateRateLimitHeaders(100, 0, resetTimestamp, nowSec);
  assertEqual(headers['Retry-After'], 10);
});

// --- Exercise 5 Tests ---
await test('Ex5: priority rate limiter respects per-level limits', () => {
  const limiter = new PriorityRateLimiter({ high: 3, normal: 2, low: 1 }, 60000);
  const now = 1000;
  assertEqual(limiter.tryRequest('low', now), true);
  assertEqual(limiter.tryRequest('low', now + 1), false);
  assertEqual(limiter.tryRequest('normal', now + 2), true);
  assertEqual(limiter.tryRequest('normal', now + 3), true);
  assertEqual(limiter.tryRequest('normal', now + 4), false);
  assertEqual(limiter.tryRequest('high', now + 5), true);
});

await test('Ex5: priority rate limiter tracks remaining per level', () => {
  const limiter = new PriorityRateLimiter({ high: 100, normal: 50, low: 10 }, 60000);
  const now = 1000;
  assertEqual(limiter.getRemainingRequests('high', now), 100);
  assertEqual(limiter.getRemainingRequests('normal', now), 50);
  assertEqual(limiter.getRemainingRequests('low', now), 10);
  limiter.tryRequest('high', now);
  assertEqual(limiter.getRemainingRequests('high', now + 1), 99);
});

// --- Exercise 6 Tests ---
await test('Ex6: load shedder sheds when CPU overloaded', () => {
  const shedder = new LoadShedder({ maxCpuUsage: 0.8, maxMemoryUsage: 0.9, maxLatencyMs: 500 });
  assert(shedder.shouldShed({ cpuUsage: 0.95, memoryUsage: 0.5, avgLatencyMs: 100 }), 'Should shed');
});

await test('Ex6: load shedder allows when healthy', () => {
  const shedder = new LoadShedder({ maxCpuUsage: 0.8, maxMemoryUsage: 0.9, maxLatencyMs: 500 });
  assert(!shedder.shouldShed({ cpuUsage: 0.5, memoryUsage: 0.5, avgLatencyMs: 100 }), 'Should not shed');
});

await test('Ex6: load shedder reports overloaded resources', () => {
  const shedder = new LoadShedder({ maxCpuUsage: 0.8, maxMemoryUsage: 0.9, maxLatencyMs: 500 });
  const overloaded = shedder.getOverloadedResources({
    cpuUsage: 0.95, memoryUsage: 0.95, avgLatencyMs: 100,
  });
  assert(overloaded.includes('cpu'), 'Should include cpu');
  assert(overloaded.includes('memory'), 'Should include memory');
  assert(!overloaded.includes('latency'), 'Should not include latency');
});

await test('Ex6: load shedder detects latency overload', () => {
  const shedder = new LoadShedder({ maxCpuUsage: 0.8, maxMemoryUsage: 0.9, maxLatencyMs: 500 });
  assert(shedder.shouldShed({ cpuUsage: 0.3, memoryUsage: 0.3, avgLatencyMs: 600 }), 'Should shed on high latency');
});

summary();
