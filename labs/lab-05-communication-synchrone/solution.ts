// =============================================================================
// Lab 05 — Communication synchrone (Solution)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : REST maturity levels
// =============================================================================

interface ApiEndpoint {
  uri: string;
  method: string;
  hasResourceUri: boolean;
  usesCorrectHttpVerb: boolean;
  hasHypermediaLinks: boolean;
}

function classifyRichardsonLevel(endpoint: ApiEndpoint): number {
  if (endpoint.hasHypermediaLinks) return 3;
  if (endpoint.hasResourceUri && endpoint.usesCorrectHttpVerb) return 2;
  if (endpoint.hasResourceUri) return 1;
  return 0;
}

// =============================================================================
// Exercice 2 : HATEOAS links
// =============================================================================

interface HateoasLink {
  rel: string;
  href: string;
  method: string;
}

interface Order {
  id: string;
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled';
  totalAmount: number;
}

function generateOrderLinks(order: Order): HateoasLink[] {
  const links: HateoasLink[] = [
    { rel: 'self', href: `/orders/${order.id}`, method: 'GET' },
  ];

  switch (order.status) {
    case 'pending':
      links.push({ rel: 'pay', href: `/orders/${order.id}/pay`, method: 'POST' });
      links.push({ rel: 'cancel', href: `/orders/${order.id}/cancel`, method: 'POST' });
      break;
    case 'paid':
      links.push({ rel: 'ship', href: `/orders/${order.id}/ship`, method: 'POST' });
      links.push({ rel: 'refund', href: `/orders/${order.id}/refund`, method: 'POST' });
      break;
    case 'shipped':
      links.push({ rel: 'deliver', href: `/orders/${order.id}/deliver`, method: 'POST' });
      break;
    case 'delivered':
      links.push({ rel: 'return', href: `/orders/${order.id}/return`, method: 'POST' });
      break;
    case 'cancelled':
      break;
  }

  return links;
}

// =============================================================================
// Exercice 3 : Service discovery
// =============================================================================

interface ServiceInstance {
  name: string;
  url: string;
  healthCheck: string;
  lastHeartbeat: number;
}

class ServiceRegistry {
  private services: Map<string, ServiceInstance[]> = new Map();

  register(name: string, url: string, healthCheck: string): void {
    if (!this.services.has(name)) {
      this.services.set(name, []);
    }
    const instances = this.services.get(name)!;
    const existing = instances.find(i => i.url === url);
    if (existing) {
      existing.lastHeartbeat = Date.now();
    } else {
      instances.push({ name, url, healthCheck, lastHeartbeat: Date.now() });
    }
  }

  deregister(name: string, url: string): void {
    const instances = this.services.get(name);
    if (instances) {
      this.services.set(name, instances.filter(i => i.url !== url));
    }
  }

  discover(name: string): ServiceInstance[] {
    return this.services.get(name) || [];
  }

  heartbeat(name: string, url: string): void {
    const instances = this.services.get(name);
    if (instances) {
      const instance = instances.find(i => i.url === url);
      if (instance) {
        instance.lastHeartbeat = Date.now();
      }
    }
  }

  evictStale(maxAgeMs: number): string[] {
    const evicted: string[] = [];
    const now = Date.now();
    for (const [name, instances] of this.services) {
      const stale = instances.filter(i => now - i.lastHeartbeat > maxAgeMs);
      stale.forEach(i => evicted.push(i.url));
      this.services.set(name, instances.filter(i => now - i.lastHeartbeat <= maxAgeMs));
    }
    return evicted;
  }
}

// =============================================================================
// Exercice 4 : Client-side load balancer
// =============================================================================

interface ServiceEndpoint {
  url: string;
  activeConnections: number;
}

class LoadBalancer {
  private endpoints: ServiceEndpoint[];
  private roundRobinIndex: number = 0;

  constructor(urls: string[]) {
    this.endpoints = urls.map(url => ({ url, activeConnections: 0 }));
  }

  roundRobin(): string {
    const endpoint = this.endpoints[this.roundRobinIndex % this.endpoints.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % this.endpoints.length;
    return endpoint.url;
  }

  leastConnections(): string {
    let min = this.endpoints[0];
    for (const ep of this.endpoints) {
      if (ep.activeConnections < min.activeConnections) {
        min = ep;
      }
    }
    return min.url;
  }

  connect(url: string): void {
    const ep = this.endpoints.find(e => e.url === url);
    if (ep) ep.activeConnections++;
  }

  disconnect(url: string): void {
    const ep = this.endpoints.find(e => e.url === url);
    if (ep && ep.activeConnections > 0) ep.activeConnections--;
  }

  getConnections(url: string): number {
    const ep = this.endpoints.find(e => e.url === url);
    return ep ? ep.activeConnections : 0;
  }
}

// =============================================================================
// Exercice 5 : Request routing
// =============================================================================

interface RouteDefinition {
  path: string;
  service: string;
  url: string;
}

class RequestRouter {
  private routes: RouteDefinition[] = [];

  addRoute(path: string, service: string, url: string): void {
    this.routes.push({ path, service, url });
  }

  removeRoute(path: string): void {
    this.routes = this.routes.filter(r => r.path !== path);
  }

  route(requestPath: string): { service: string; url: string } | null {
    let bestMatch: RouteDefinition | null = null;
    for (const r of this.routes) {
      if (requestPath === r.path || requestPath.startsWith(r.path + '/') || requestPath.startsWith(r.path + '?')) {
        if (!bestMatch || r.path.length > bestMatch.path.length) {
          bestMatch = r;
        }
      }
    }
    if (bestMatch) {
      return { service: bestMatch.service, url: bestMatch.url };
    }
    return null;
  }

  getRoutes(): RouteDefinition[] {
    return [...this.routes];
  }
}

// =============================================================================
// Exercice 6 : Service mesh simulation
// =============================================================================

interface ProxyMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  retries: number;
}

interface SidecarConfig {
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

class SidecarProxy {
  private metrics: ProxyMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalLatencyMs: 0,
    retries: 0,
  };
  private config: SidecarConfig;

  constructor(config: SidecarConfig) {
    this.config = config;
  }

  async call(fn: () => Promise<unknown>): Promise<unknown> {
    this.metrics.totalRequests++;
    const start = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        this.metrics.retries++;
        await simulateNetworkDelay(this.config.retryDelayMs);
      }
      try {
        const result = await Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), this.config.timeoutMs)
          ),
        ]);
        this.metrics.successfulRequests++;
        this.metrics.totalLatencyMs += Date.now() - start;
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.message === 'Request timed out') {
          break;
        }
      }
    }

    this.metrics.failedRequests++;
    this.metrics.totalLatencyMs += Date.now() - start;
    throw lastError;
  }

  getMetrics(): ProxyMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      retries: 0,
    };
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, summary } = createTestRunner('Lab 05 — Communication synchrone');

  // --- Exercice 1 ---
  console.log('\n📘 Exercice 1 : REST maturity levels');

  await test('Level 0 — single URI, single method', () => {
    const endpoint: ApiEndpoint = { uri: '/api', method: 'POST', hasResourceUri: false, usesCorrectHttpVerb: false, hasHypermediaLinks: false };
    assertEqual(classifyRichardsonLevel(endpoint), 0);
  });

  await test('Level 1 — resource URI but wrong verb', () => {
    const endpoint: ApiEndpoint = { uri: '/api/users/1', method: 'POST', hasResourceUri: true, usesCorrectHttpVerb: false, hasHypermediaLinks: false };
    assertEqual(classifyRichardsonLevel(endpoint), 1);
  });

  await test('Level 2 — resource URI + correct HTTP verb', () => {
    const endpoint: ApiEndpoint = { uri: '/api/users/1', method: 'GET', hasResourceUri: true, usesCorrectHttpVerb: true, hasHypermediaLinks: false };
    assertEqual(classifyRichardsonLevel(endpoint), 2);
  });

  await test('Level 3 — full HATEOAS', () => {
    const endpoint: ApiEndpoint = { uri: '/api/users/1', method: 'GET', hasResourceUri: true, usesCorrectHttpVerb: true, hasHypermediaLinks: true };
    assertEqual(classifyRichardsonLevel(endpoint), 3);
  });

  // --- Exercice 2 ---
  console.log('\n📘 Exercice 2 : HATEOAS links');

  await test('Pending order has self, pay, cancel links', () => {
    const order: Order = { id: 'ord-1', status: 'pending', totalAmount: 100 };
    const links = generateOrderLinks(order);
    assertEqual(links.length, 3);
    assert(links.some(l => l.rel === 'self'), 'Missing self link');
    assert(links.some(l => l.rel === 'pay'), 'Missing pay link');
    assert(links.some(l => l.rel === 'cancel'), 'Missing cancel link');
  });

  await test('Paid order has self, ship, refund links', () => {
    const order: Order = { id: 'ord-2', status: 'paid', totalAmount: 200 };
    const links = generateOrderLinks(order);
    assertEqual(links.length, 3);
    assert(links.some(l => l.rel === 'ship'), 'Missing ship link');
    assert(links.some(l => l.rel === 'refund'), 'Missing refund link');
  });

  await test('Shipped order has self, deliver links', () => {
    const order: Order = { id: 'ord-3', status: 'shipped', totalAmount: 300 };
    const links = generateOrderLinks(order);
    assertEqual(links.length, 2);
    assert(links.some(l => l.rel === 'deliver'), 'Missing deliver link');
  });

  await test('Delivered order has self, return links', () => {
    const order: Order = { id: 'ord-4', status: 'delivered', totalAmount: 400 };
    const links = generateOrderLinks(order);
    assertEqual(links.length, 2);
    assert(links.some(l => l.rel === 'return'), 'Missing return link');
  });

  await test('Cancelled order has only self link', () => {
    const order: Order = { id: 'ord-5', status: 'cancelled', totalAmount: 500 };
    const links = generateOrderLinks(order);
    assertEqual(links.length, 1);
    assertEqual(links[0].rel, 'self');
  });

  // --- Exercice 3 ---
  console.log('\n📘 Exercice 3 : Service discovery');

  await test('Register and discover a service', () => {
    const registry = new ServiceRegistry();
    registry.register('user-service', 'http://localhost:3001', '/health');
    const instances = registry.discover('user-service');
    assertEqual(instances.length, 1);
    assertEqual(instances[0].url, 'http://localhost:3001');
  });

  await test('Register multiple instances', () => {
    const registry = new ServiceRegistry();
    registry.register('user-service', 'http://localhost:3001', '/health');
    registry.register('user-service', 'http://localhost:3002', '/health');
    assertEqual(registry.discover('user-service').length, 2);
  });

  await test('Deregister a service instance', () => {
    const registry = new ServiceRegistry();
    registry.register('user-service', 'http://localhost:3001', '/health');
    registry.register('user-service', 'http://localhost:3002', '/health');
    registry.deregister('user-service', 'http://localhost:3001');
    const instances = registry.discover('user-service');
    assertEqual(instances.length, 1);
    assertEqual(instances[0].url, 'http://localhost:3002');
  });

  await test('Discover unknown service returns empty', () => {
    const registry = new ServiceRegistry();
    assertEqual(registry.discover('unknown').length, 0);
  });

  await test('Evict stale instances', async () => {
    const registry = new ServiceRegistry();
    registry.register('svc', 'http://localhost:3001', '/health');
    registry.register('svc', 'http://localhost:3002', '/health');
    await simulateNetworkDelay(50);
    registry.heartbeat('svc', 'http://localhost:3001');
    const evicted = registry.evictStale(30);
    assert(evicted.includes('http://localhost:3002'), 'Should evict stale instance');
    assert(!evicted.includes('http://localhost:3001'), 'Should not evict fresh instance');
    assertEqual(registry.discover('svc').length, 1);
  });

  // --- Exercice 4 ---
  console.log('\n📘 Exercice 4 : Client-side load balancer');

  await test('Round-robin distributes evenly', () => {
    const lb = new LoadBalancer(['http://a', 'http://b', 'http://c']);
    assertEqual(lb.roundRobin(), 'http://a');
    assertEqual(lb.roundRobin(), 'http://b');
    assertEqual(lb.roundRobin(), 'http://c');
    assertEqual(lb.roundRobin(), 'http://a');
  });

  await test('Least-connections picks minimum', () => {
    const lb = new LoadBalancer(['http://a', 'http://b', 'http://c']);
    lb.connect('http://a');
    lb.connect('http://a');
    lb.connect('http://b');
    assertEqual(lb.leastConnections(), 'http://c');
  });

  await test('Connect and disconnect track state', () => {
    const lb = new LoadBalancer(['http://a', 'http://b']);
    lb.connect('http://a');
    lb.connect('http://a');
    assertEqual(lb.getConnections('http://a'), 2);
    lb.disconnect('http://a');
    assertEqual(lb.getConnections('http://a'), 1);
  });

  // --- Exercice 5 ---
  console.log('\n📘 Exercice 5 : Request routing');

  await test('Route exact path', () => {
    const router = new RequestRouter();
    router.addRoute('/api/users', 'user-service', 'http://localhost:3001');
    const result = router.route('/api/users');
    assert(result !== null, 'Route should be found');
    assertEqual(result!.service, 'user-service');
  });

  await test('Route prefix matching', () => {
    const router = new RequestRouter();
    router.addRoute('/api/users', 'user-service', 'http://localhost:3001');
    const result = router.route('/api/users/123');
    assert(result !== null, 'Route should match prefix');
    assertEqual(result!.service, 'user-service');
  });

  await test('Longest prefix wins', () => {
    const router = new RequestRouter();
    router.addRoute('/api', 'gateway', 'http://localhost:3000');
    router.addRoute('/api/users', 'user-service', 'http://localhost:3001');
    const result = router.route('/api/users/123');
    assertEqual(result!.service, 'user-service');
  });

  await test('No matching route returns null', () => {
    const router = new RequestRouter();
    router.addRoute('/api/users', 'user-service', 'http://localhost:3001');
    assertEqual(router.route('/other'), null);
  });

  await test('Remove route', () => {
    const router = new RequestRouter();
    router.addRoute('/api/users', 'user-service', 'http://localhost:3001');
    router.removeRoute('/api/users');
    assertEqual(router.route('/api/users'), null);
  });

  // --- Exercice 6 ---
  console.log('\n📘 Exercice 6 : Service mesh simulation');

  await test('Successful call updates metrics', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 1000, maxRetries: 3, retryDelayMs: 10 });
    const result = await proxy.call(async () => 'ok');
    assertEqual(result, 'ok');
    const m = proxy.getMetrics();
    assertEqual(m.totalRequests, 1);
    assertEqual(m.successfulRequests, 1);
    assertEqual(m.failedRequests, 0);
  });

  await test('Retries on failure then succeeds', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 1000, maxRetries: 3, retryDelayMs: 10 });
    let attempts = 0;
    const result = await proxy.call(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'recovered';
    });
    assertEqual(result, 'recovered');
    const m = proxy.getMetrics();
    assertEqual(m.successfulRequests, 1);
    assertEqual(m.retries, 2);
  });

  await test('Exhausts retries and fails', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 1000, maxRetries: 2, retryDelayMs: 10 });
    try {
      await proxy.call(async () => { throw new Error('always fails'); });
      assert(false, 'Should have thrown');
    } catch (e) {
      // expected
    }
    const m = proxy.getMetrics();
    assertEqual(m.failedRequests, 1);
    assertEqual(m.retries, 2);
  });

  await test('Timeout triggers failure', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 50, maxRetries: 0, retryDelayMs: 10 });
    try {
      await proxy.call(async () => {
        await simulateNetworkDelay(200);
        return 'too late';
      });
      assert(false, 'Should have timed out');
    } catch (e) {
      assert((e as Error).message.includes('timed out'), 'Should be a timeout error');
    }
    const m = proxy.getMetrics();
    assertEqual(m.failedRequests, 1);
  });

  await test('Metrics accumulate across calls', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 1000, maxRetries: 0, retryDelayMs: 10 });
    await proxy.call(async () => 'a');
    await proxy.call(async () => 'b');
    try { await proxy.call(async () => { throw new Error('fail'); }); } catch {}
    const m = proxy.getMetrics();
    assertEqual(m.totalRequests, 3);
    assertEqual(m.successfulRequests, 2);
    assertEqual(m.failedRequests, 1);
  });

  await test('Reset metrics clears state', async () => {
    const proxy = new SidecarProxy({ timeoutMs: 1000, maxRetries: 0, retryDelayMs: 10 });
    await proxy.call(async () => 'a');
    proxy.resetMetrics();
    const m = proxy.getMetrics();
    assertEqual(m.totalRequests, 0);
  });

  summary();
}

main().catch(console.error);
