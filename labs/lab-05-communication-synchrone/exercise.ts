// =============================================================================
// Lab 05 — Communication synchrone (Exercise)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : REST maturity levels
// =============================================================================
// Classifier des endpoints API selon les niveaux de maturite de Richardson :
//   Level 0 : un seul URI, une seule methode (ex. POST /api)
//   Level 1 : ressources individuelles mais une seule methode
//   Level 2 : ressources + verbes HTTP corrects (GET, POST, PUT, DELETE)
//   Level 3 : Level 2 + liens HATEOAS

interface ApiEndpoint {
  uri: string;
  method: string;
  hasResourceUri: boolean;
  usesCorrectHttpVerb: boolean;
  hasHypermediaLinks: boolean;
}

function classifyRichardsonLevel(endpoint: ApiEndpoint): number {
  // TODO: Implementer la classification
  // - Level 3 si hasHypermediaLinks === true (implique Level 2)
  // - Level 2 si hasResourceUri && usesCorrectHttpVerb
  // - Level 1 si hasResourceUri mais pas usesCorrectHttpVerb
  // - Level 0 sinon
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : HATEOAS links
// =============================================================================
// Generer des liens hypermedia pour une commande selon son etat.

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
  // TODO: Implementer la generation de liens
  // - Toujours inclure : { rel: 'self', href: `/orders/${order.id}`, method: 'GET' }
  // - pending : ajouter 'pay' (POST /orders/{id}/pay), 'cancel' (POST /orders/{id}/cancel)
  // - paid : ajouter 'ship' (POST /orders/{id}/ship), 'refund' (POST /orders/{id}/refund)
  // - shipped : ajouter 'deliver' (POST /orders/{id}/deliver)
  // - delivered : ajouter 'return' (POST /orders/{id}/return)
  // - cancelled : aucun lien supplementaire
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Service discovery
// =============================================================================
// Registre de services avec enregistrement, decouverte et eviction par heartbeat.

interface ServiceInstance {
  name: string;
  url: string;
  healthCheck: string;
  lastHeartbeat: number;
}

class ServiceRegistry {
  private services: Map<string, ServiceInstance[]> = new Map();

  register(name: string, url: string, healthCheck: string): void {
    // TODO: Enregistrer une instance de service
    // Si le service (meme name + url) existe deja, mettre a jour le heartbeat
    throw new Error('Not implemented');
  }

  deregister(name: string, url: string): void {
    // TODO: Supprimer une instance de service
    throw new Error('Not implemented');
  }

  discover(name: string): ServiceInstance[] {
    // TODO: Retourner toutes les instances enregistrees pour un service
    throw new Error('Not implemented');
  }

  heartbeat(name: string, url: string): void {
    // TODO: Mettre a jour le timestamp du heartbeat
    throw new Error('Not implemented');
  }

  evictStale(maxAgeMs: number): string[] {
    // TODO: Supprimer les instances dont le heartbeat depasse maxAgeMs
    // Retourner les URLs supprimees
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 4 : Client-side load balancer
// =============================================================================
// Implementer round-robin et least-connections.

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
    // TODO: Retourner la prochaine URL en round-robin
    throw new Error('Not implemented');
  }

  leastConnections(): string {
    // TODO: Retourner l'URL avec le moins de connexions actives
    throw new Error('Not implemented');
  }

  connect(url: string): void {
    // TODO: Incrementer le compteur de connexions pour l'URL
    throw new Error('Not implemented');
  }

  disconnect(url: string): void {
    // TODO: Decrementer le compteur de connexions pour l'URL
    throw new Error('Not implemented');
  }

  getConnections(url: string): number {
    // TODO: Retourner le nombre de connexions actives pour l'URL
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 5 : Request routing
// =============================================================================
// Routeur qui mappe des chemins URL vers des services.

interface RouteDefinition {
  path: string;
  service: string;
  url: string;
}

class RequestRouter {
  private routes: RouteDefinition[] = [];

  addRoute(path: string, service: string, url: string): void {
    // TODO: Ajouter une route
    throw new Error('Not implemented');
  }

  removeRoute(path: string): void {
    // TODO: Supprimer une route par son chemin
    throw new Error('Not implemented');
  }

  route(requestPath: string): { service: string; url: string } | null {
    // TODO: Trouver la route correspondante (prefix matching, plus long prefix d'abord)
    // Ex: '/api/users/123' matche '/api/users' si defini
    throw new Error('Not implemented');
  }

  getRoutes(): RouteDefinition[] {
    // TODO: Retourner toutes les routes
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 6 : Service mesh simulation
// =============================================================================
// Simuler un sidecar proxy avec timeout, retry et metriques.

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
    // TODO: Executer fn avec :
    // - Timeout : si fn prend plus de config.timeoutMs, lever une erreur 'Request timed out'
    // - Retry : en cas d'erreur, reessayer jusqu'a config.maxRetries fois avec config.retryDelayMs entre chaque
    // - Metriques : mettre a jour this.metrics a chaque appel
    // Retourner le resultat de fn si succes
    throw new Error('Not implemented');
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
