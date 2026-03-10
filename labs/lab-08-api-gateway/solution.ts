// =============================================================================
// Lab 08 — API Gateway (Solution)
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

interface RouteConfig {
  path: string;       // e.g. '/api/users/:id'
  service: string;    // e.g. 'http://user-service:3001'
  targetPath: string; // e.g. '/users/:id'
}

interface MatchResult {
  service: string;
  targetUrl: string;
  params: Record<string, string>;
}

function createRouteMatcher(routes: RouteConfig[]) {
  return function match(incomingPath: string): MatchResult | null {
    for (const route of routes) {
      const routeParts = route.path.split('/');
      const incomingParts = incomingPath.split('/');

      if (routeParts.length !== incomingParts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = incomingParts[i];
        } else if (routeParts[i] !== incomingParts[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        let targetUrl = route.targetPath;
        for (const [key, value] of Object.entries(params)) {
          targetUrl = targetUrl.replace(`:${key}`, value);
        }
        return {
          service: route.service,
          targetUrl: `${route.service}${targetUrl}`,
          params,
        };
      }
    }
    return null;
  };
}

// =============================================================================
// Exercise 2: Request Aggregation
// =============================================================================

interface ServiceCall {
  name: string;
  fn: () => Promise<unknown>;
}

interface AggregatedResponse {
  data: Record<string, unknown>;
  errors: Record<string, string>;
  timing: Record<string, number>;
}

async function aggregateRequests(calls: ServiceCall[]): Promise<AggregatedResponse> {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const timing: Record<string, number> = {};

  const results = await Promise.allSettled(
    calls.map(async (call) => {
      const start = Date.now();
      try {
        const result = await call.fn();
        timing[call.name] = Date.now() - start;
        data[call.name] = result;
      } catch (err) {
        timing[call.name] = Date.now() - start;
        errors[call.name] = err instanceof Error ? err.message : String(err);
      }
    })
  );

  return { data, errors, timing };
}

// =============================================================================
// Exercise 3: Auth Propagation
// =============================================================================

interface JWTPayload {
  sub: string;
  exp: number;
  roles: string[];
}

function extractJWT(authHeader: string): JWTPayload | null {
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload as JWTPayload;
  } catch {
    return null;
  }
}

function createAuthPropagation() {
  return function propagate(
    headers: Record<string, string>
  ): { isAuthenticated: boolean; user: JWTPayload | null; forwardHeaders: Record<string, string> } {
    const authHeader = headers['authorization'] || headers['Authorization'] || '';
    const user = extractJWT(authHeader);

    if (!user) {
      return { isAuthenticated: false, user: null, forwardHeaders: {} };
    }

    // Check expiration
    if (user.exp * 1000 < Date.now()) {
      return { isAuthenticated: false, user: null, forwardHeaders: {} };
    }

    return {
      isAuthenticated: true,
      user,
      forwardHeaders: {
        'authorization': authHeader,
        'x-user-id': user.sub,
        'x-user-roles': user.roles.join(','),
      },
    };
  };
}

// =============================================================================
// Exercise 4: Rate Limiting — Token Bucket
// =============================================================================

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(maxTokens: number, refillRate: number) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
  }

  allowRequest(clientId: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(clientId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  getTokens(clientId: string): number {
    const bucket = this.buckets.get(clientId);
    return bucket ? Math.floor(bucket.tokens) : this.maxTokens;
  }

  reset(clientId: string): void {
    this.buckets.delete(clientId);
  }
}

// =============================================================================
// Exercise 5: Correlation ID Injection
// =============================================================================

function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function correlationIdMiddleware(
  headers: Record<string, string>
): Record<string, string> {
  const existing = headers['x-correlation-id'];
  const correlationId = existing || generateCorrelationId();
  return {
    ...headers,
    'x-correlation-id': correlationId,
  };
}

// =============================================================================
// Exercise 6: Gateway with Circuit Breaker
// =============================================================================

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  public state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private halfOpenMaxAttempts: number;

  constructor(failureThreshold: number = 3, resetTimeoutMs: number = 5000, halfOpenMaxAttempts: number = 1) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenMaxAttempts = halfOpenMaxAttempts;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
}

interface GatewayRequest {
  path: string;
  headers: Record<string, string>;
  clientId: string;
}

interface GatewayResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

function createGateway(config: {
  routes: RouteConfig[];
  rateLimiter: RateLimiter;
  circuitBreaker: CircuitBreaker;
  serviceCaller: (url: string, headers: Record<string, string>) => Promise<unknown>;
}) {
  const { routes, rateLimiter, circuitBreaker, serviceCaller } = config;
  const routeMatcher = createRouteMatcher(routes);
  const authPropagation = createAuthPropagation();

  return async function handleRequest(req: GatewayRequest): Promise<GatewayResponse> {
    // 1. Inject correlation ID
    const headersWithCorrelation = correlationIdMiddleware(req.headers);
    const correlationId = headersWithCorrelation['x-correlation-id'];

    // 2. Rate limiting
    if (!rateLimiter.allowRequest(req.clientId)) {
      return {
        status: 429,
        body: { error: 'Too Many Requests' },
        headers: { 'x-correlation-id': correlationId },
      };
    }

    // 3. Route matching
    const routeMatch = routeMatcher(req.path);
    if (!routeMatch) {
      return {
        status: 404,
        body: { error: 'Not Found' },
        headers: { 'x-correlation-id': correlationId },
      };
    }

    // 4. Auth propagation
    const auth = authPropagation(headersWithCorrelation);
    const forwardHeaders: Record<string, string> = {
      'x-correlation-id': correlationId,
      ...auth.forwardHeaders,
    };

    // 5. Circuit breaker + call service
    try {
      const body = await circuitBreaker.execute(() =>
        serviceCaller(routeMatch.targetUrl, forwardHeaders)
      );
      return {
        status: 200,
        body,
        headers: { 'x-correlation-id': correlationId },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'Circuit breaker is OPEN') {
        return {
          status: 503,
          body: { error: 'Service Unavailable' },
          headers: { 'x-correlation-id': correlationId },
        };
      }
      return {
        status: 502,
        body: { error: 'Bad Gateway', message },
        headers: { 'x-correlation-id': correlationId },
      };
    }
  };
}

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
