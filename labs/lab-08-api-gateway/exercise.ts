// =============================================================================
// Lab 08 — API Gateway (Exercise)
// =============================================================================

import {
  createTestRunner,
  simulateNetworkDelay,
  simulateNetworkFailure,
  assertCircuitBreakerState,
  simulateRequests,
} from '../test-utils.ts';

// =============================================================================
// Exercise 1: Route Mapping
// =============================================================================
// TODO: Define RouteConfig interface:
//   { path: string; service: string; targetPath: string }
//   path supports :param syntax (e.g. '/api/users/:id')

// TODO: Define MatchResult interface:
//   { service: string; targetUrl: string; params: Record<string, string> }

// TODO: Implement createRouteMatcher(routes: RouteConfig[]) that returns a match function:
//   match(incomingPath: string): MatchResult | null
//   - Split path by '/' and compare segment by segment
//   - Segments starting with ':' are parameters (capture the value)
//   - Build targetUrl by replacing :param in targetPath with captured values
//   - Return null if no route matches

// =============================================================================
// Exercise 2: Request Aggregation
// =============================================================================
// TODO: Define ServiceCall interface: { name: string; fn: () => Promise<unknown> }
// TODO: Define AggregatedResponse interface:
//   { data: Record<string, unknown>; errors: Record<string, string>; timing: Record<string, number> }

// TODO: Implement async aggregateRequests(calls: ServiceCall[]): Promise<AggregatedResponse>
//   - Call all service functions in parallel (Promise.allSettled)
//   - Collect successful results in data, errors in errors
//   - Track timing for each call in ms

// =============================================================================
// Exercise 3: Auth Propagation
// =============================================================================
// TODO: Define JWTPayload interface: { sub: string; exp: number; roles: string[] }

// TODO: Implement extractJWT(authHeader: string): JWTPayload | null
//   - Check header starts with 'Bearer '
//   - Split token by '.', decode middle part with atob + JSON.parse
//   - Return null if invalid

// TODO: Implement createAuthPropagation() that returns a propagate function:
//   propagate(headers) => { isAuthenticated, user, forwardHeaders }
//   - Extract JWT from authorization header
//   - Check expiration (exp * 1000 < Date.now())
//   - Build forwardHeaders with authorization, x-user-id, x-user-roles

// =============================================================================
// Exercise 4: Rate Limiting — Token Bucket
// =============================================================================
// TODO: Define TokenBucket interface: { tokens: number; lastRefill: number }

// TODO: Implement class RateLimiter with:
//   - constructor(maxTokens: number, refillRate: number) — tokens per second
//   - allowRequest(clientId: string, now?: number): boolean
//     - Create bucket if new client (start with maxTokens)
//     - Refill tokens based on elapsed time: tokens += elapsed * refillRate (cap at max)
//     - If tokens >= 1, consume one and return true; else return false
//   - getTokens(clientId: string): number
//   - reset(clientId: string): void

// =============================================================================
// Exercise 5: Correlation ID Injection
// =============================================================================
// TODO: Implement generateCorrelationId(): string
//   Return format: `corr-${Date.now()}-${random}`

// TODO: Implement correlationIdMiddleware(headers: Record<string, string>): Record<string, string>
//   - If 'x-correlation-id' exists, keep it
//   - Otherwise, generate a new one
//   - Return new headers object with correlation ID included

// =============================================================================
// Exercise 6: Gateway with Circuit Breaker
// =============================================================================
// TODO: Implement class CircuitBreaker with states: CLOSED, OPEN, HALF_OPEN
//   - constructor(failureThreshold, resetTimeoutMs, halfOpenMaxAttempts)
//   - async execute<T>(fn): Promise<T>
//     - OPEN: if timeout elapsed -> HALF_OPEN, else throw 'Circuit breaker is OPEN'
//     - CLOSED/HALF_OPEN: try fn, track success/failure
//     - HALF_OPEN success >= max -> CLOSED
//     - Failure count >= threshold -> OPEN

// TODO: Define GatewayRequest: { path, headers, clientId }
// TODO: Define GatewayResponse: { status, body, headers }

// TODO: Implement createGateway(config) that returns async handleRequest(req) => GatewayResponse
//   Config: { routes, rateLimiter, circuitBreaker, serviceCaller }
//   Flow:
//   1. Inject correlation ID
//   2. Check rate limit -> 429
//   3. Match route -> 404
//   4. Auth propagation
//   5. Circuit breaker + service call -> 200, 503, or 502

// =============================================================================
// Tests
// =============================================================================

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 08 — API Gateway');

// --- Exercise 1 Tests ---
await test('Ex1: route matcher matches static paths', () => {
  const match = createRouteMatcher([
    { path: '/api/users', service: 'http://user-svc:3001', targetPath: '/users' },
    { path: '/api/orders', service: 'http://order-svc:3002', targetPath: '/orders' },
  ]);
  const result = match('/api/users');
  assert(result !== null, 'Should match /api/users');
  assertEqual(result!.service, 'http://user-svc:3001');
  assertEqual(result!.targetUrl, 'http://user-svc:3001/users');
});

await test('Ex1: route matcher extracts path params', () => {
  const match = createRouteMatcher([
    { path: '/api/users/:id', service: 'http://user-svc:3001', targetPath: '/users/:id' },
  ]);
  const result = match('/api/users/42');
  assert(result !== null, 'Should match /api/users/42');
  assertEqual(result!.params.id, '42');
  assertEqual(result!.targetUrl, 'http://user-svc:3001/users/42');
});

await test('Ex1: route matcher returns null for unknown path', () => {
  const match = createRouteMatcher([
    { path: '/api/users', service: 'http://user-svc:3001', targetPath: '/users' },
  ]);
  const result = match('/api/unknown');
  assertEqual(result, null);
});

// --- Exercise 2 Tests ---
await test('Ex2: aggregateRequests combines successful responses', async () => {
  const result = await aggregateRequests([
    { name: 'users', fn: async () => { await simulateNetworkDelay(5); return { id: 1, name: 'Alice' }; } },
    { name: 'orders', fn: async () => { await simulateNetworkDelay(5); return [{ id: 'o1' }]; } },
  ]);
  assertDeepEqual(result.data.users, { id: 1, name: 'Alice' });
  assertDeepEqual(result.data.orders, [{ id: 'o1' }]);
  assertEqual(Object.keys(result.errors).length, 0);
});

await test('Ex2: aggregateRequests captures errors per service', async () => {
  const result = await aggregateRequests([
    { name: 'users', fn: async () => ({ id: 1 }) },
    { name: 'payments', fn: async () => { throw new Error('Service down'); } },
  ]);
  assert(result.data.users !== undefined, 'users should succeed');
  assertEqual(result.errors.payments, 'Service down');
});

// --- Exercise 3 Tests ---
await test('Ex3: extractJWT parses valid token', () => {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, roles: ['admin'] };
  const token = `header.${btoa(JSON.stringify(payload))}.signature`;
  const result = extractJWT(`Bearer ${token}`);
  assert(result !== null, 'Should parse JWT');
  assertEqual(result!.sub, 'user-1');
  assertDeepEqual(result!.roles, ['admin']);
});

await test('Ex3: auth propagation forwards headers', () => {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600, roles: ['admin', 'user'] };
  const token = `header.${btoa(JSON.stringify(payload))}.signature`;
  const propagate = createAuthPropagation();
  const result = propagate({ authorization: `Bearer ${token}` });
  assertEqual(result.isAuthenticated, true);
  assertEqual(result.forwardHeaders['x-user-id'], 'user-1');
  assertEqual(result.forwardHeaders['x-user-roles'], 'admin,user');
});

await test('Ex3: auth propagation rejects expired token', () => {
  const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 3600, roles: ['user'] };
  const token = `header.${btoa(JSON.stringify(payload))}.signature`;
  const propagate = createAuthPropagation();
  const result = propagate({ authorization: `Bearer ${token}` });
  assertEqual(result.isAuthenticated, false);
});

// --- Exercise 4 Tests ---
await test('Ex4: rate limiter allows requests within limit', () => {
  const limiter = new RateLimiter(5, 1);
  const now = Date.now();
  assert(limiter.allowRequest('client-1', now), 'First request allowed');
  assert(limiter.allowRequest('client-1', now), 'Second request allowed');
  assert(limiter.allowRequest('client-1', now), 'Third request allowed');
});

await test('Ex4: rate limiter blocks after tokens exhausted', () => {
  const limiter = new RateLimiter(2, 1);
  const now = Date.now();
  assert(limiter.allowRequest('client-1', now), 'First allowed');
  assert(limiter.allowRequest('client-1', now), 'Second allowed');
  assert(!limiter.allowRequest('client-1', now), 'Third blocked');
});

await test('Ex4: rate limiter refills tokens over time', () => {
  const limiter = new RateLimiter(2, 2); // 2 tokens max, 2 tokens/sec
  const now = Date.now();
  limiter.allowRequest('client-1', now);
  limiter.allowRequest('client-1', now);
  assert(!limiter.allowRequest('client-1', now), 'Should be blocked');
  // 1 second later, should have 2 new tokens
  assert(limiter.allowRequest('client-1', now + 1000), 'Should be allowed after refill');
});

// --- Exercise 5 Tests ---
await test('Ex5: correlation ID middleware adds new ID', () => {
  const headers = correlationIdMiddleware({ 'content-type': 'application/json' });
  assert(headers['x-correlation-id'] !== undefined, 'Should add correlation ID');
  assert(headers['x-correlation-id'].startsWith('corr-'), 'Should start with corr-');
});

await test('Ex5: correlation ID middleware preserves existing ID', () => {
  const headers = correlationIdMiddleware({ 'x-correlation-id': 'existing-123' });
  assertEqual(headers['x-correlation-id'], 'existing-123');
});

// --- Exercise 6 Tests ---
await test('Ex6: gateway routes request and returns response', async () => {
  const gateway = createGateway({
    routes: [{ path: '/api/users/:id', service: 'http://user-svc:3001', targetPath: '/users/:id' }],
    rateLimiter: new RateLimiter(10, 10),
    circuitBreaker: new CircuitBreaker(3, 5000),
    serviceCaller: async (url, headers) => ({ id: 42, name: 'Alice' }),
  });
  const response = await gateway({ path: '/api/users/42', headers: {}, clientId: 'c1' });
  assertEqual(response.status, 200);
  assertDeepEqual(response.body, { id: 42, name: 'Alice' });
  assert(response.headers['x-correlation-id'] !== undefined, 'Should have correlation ID');
});

await test('Ex6: gateway returns 429 when rate limited', async () => {
  const limiter = new RateLimiter(1, 0.001);
  const gateway = createGateway({
    routes: [{ path: '/api/test', service: 'http://svc:3000', targetPath: '/test' }],
    rateLimiter: limiter,
    circuitBreaker: new CircuitBreaker(3, 5000),
    serviceCaller: async () => ({}),
  });
  const now = Date.now();
  await gateway({ path: '/api/test', headers: {}, clientId: 'c1' });
  const response = await gateway({ path: '/api/test', headers: {}, clientId: 'c1' });
  assertEqual(response.status, 429);
});

await test('Ex6: gateway returns 404 for unknown route', async () => {
  const gateway = createGateway({
    routes: [{ path: '/api/users', service: 'http://user-svc:3001', targetPath: '/users' }],
    rateLimiter: new RateLimiter(10, 10),
    circuitBreaker: new CircuitBreaker(3, 5000),
    serviceCaller: async () => ({}),
  });
  const response = await gateway({ path: '/api/unknown', headers: {}, clientId: 'c1' });
  assertEqual(response.status, 404);
});

await test('Ex6: gateway returns 503 when circuit breaker is open', async () => {
  const cb = new CircuitBreaker(2, 60000);
  let callCount = 0;
  const gateway = createGateway({
    routes: [{ path: '/api/test', service: 'http://svc:3000', targetPath: '/test' }],
    rateLimiter: new RateLimiter(100, 100),
    circuitBreaker: cb,
    serviceCaller: async () => { callCount++; throw new Error('fail'); },
  });
  // Trip the circuit breaker
  await gateway({ path: '/api/test', headers: {}, clientId: 'c1' });
  await gateway({ path: '/api/test', headers: {}, clientId: 'c1' });
  // Next call should get 503
  const response = await gateway({ path: '/api/test', headers: {}, clientId: 'c1' });
  assertEqual(response.status, 503);
});

summary();
