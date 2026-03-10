// =============================================================================
// Lab 03 — Premiers microservices (Exercice)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertIncludes, summary } = createTestRunner('Lab 03 — Premiers microservices');

// =============================================================================
// Exercice 1 : Definition de service
// Definir une interface de microservice et une fonction pour en creer un.
//
// createService(name, port, version?) doit retourner un objet MicroService
// avec routes = [] et startedAt = Date.now()
//
// addRoute(service, method, path, handler) ajoute une route au service
// =============================================================================

interface Route {
  method: string;
  path: string;
  handler: (req: Record<string, unknown>) => Record<string, unknown>;
}

interface MicroService {
  name: string;
  port: number;
  routes: Route[];
  version: string;
  startedAt: number;
}

function createService(name: string, port: number, version: string = '1.0.0'): MicroService {
  // TODO: Retourner un objet MicroService avec les proprietes donnees
  // routes doit etre un tableau vide, startedAt = Date.now()
  throw new Error('Not implemented');
}

function addRoute(service: MicroService, method: string, path: string, handler: (req: Record<string, unknown>) => Record<string, unknown>): void {
  // TODO: Ajouter la route { method, path, handler } au tableau service.routes
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Health check
// Implementer un health check qui verifie le statut du service et de
// ses dependances.
//
// Regles :
// - Si toutes les dependances sont 'healthy' -> status = 'healthy'
// - Si au moins une est 'healthy' mais pas toutes -> status = 'degraded'
// - Si aucune n'est 'healthy' (et il y en a) -> status = 'unhealthy'
// - Sans dependances -> status = 'healthy'
// =============================================================================

interface DependencyCheck {
  name: string;
  status: 'healthy' | 'unhealthy';
  responseTimeMs?: number;
}

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  dependencies: DependencyCheck[];
  timestamp: number;
}

function healthCheck(service: MicroService, dependencies: DependencyCheck[] = []): HealthCheckResult {
  // TODO: Implementer le health check selon les regles ci-dessus
  // uptime = Date.now() - service.startedAt
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Logging structure
// Creer un logger qui produit des logs structures en JSON.
//
// Chaque entree doit avoir : timestamp (ISO), level, service, message
// Et optionnellement : correlationId, metadata
// =============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

interface StructuredLogger {
  debug(message: string, metadata?: Record<string, unknown>): LogEntry;
  info(message: string, metadata?: Record<string, unknown>): LogEntry;
  warn(message: string, metadata?: Record<string, unknown>): LogEntry;
  error(message: string, metadata?: Record<string, unknown>): LogEntry;
  getEntries(): LogEntry[];
}

function createLogger(serviceName: string, correlationId?: string): StructuredLogger {
  // TODO: Creer un logger structure
  // - Chaque methode (debug, info, warn, error) cree une LogEntry et la stocke
  // - getEntries() retourne une copie du tableau d'entrees
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Correlation ID
// Generer et propager des correlation IDs a travers les appels de services.
//
// generateCorrelationId() -> `corr-${timestamp}-${random}`
// createRequestContext(serviceName, existingId?) -> RequestContext
// propagateContext(ctx, targetService) -> nouveau RequestContext avec meme correlationId
// =============================================================================

interface RequestContext {
  correlationId: string;
  sourceName: string;
  timestamp: number;
}

function generateCorrelationId(): string {
  // TODO: Generer un ID unique au format `corr-${Date.now()}-${random7chars}`
  throw new Error('Not implemented');
}

function createRequestContext(serviceName: string, existingCorrelationId?: string): RequestContext {
  // TODO: Creer un contexte avec le correlationId existant ou en generer un nouveau
  throw new Error('Not implemented');
}

function propagateContext(ctx: RequestContext, targetService: string): RequestContext {
  // TODO: Propager le contexte au service cible (meme correlationId, nouveau sourceName)
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Registre de services
// Creer un registre en memoire pour enregistrer et decouvrir des services.
// =============================================================================

interface ServiceInstance {
  name: string;
  host: string;
  port: number;
  metadata?: Record<string, string>;
  registeredAt: number;
  lastHeartbeat: number;
}

interface ServiceRegistry {
  register(instance: Omit<ServiceInstance, 'registeredAt' | 'lastHeartbeat'>): void;
  deregister(name: string, host: string, port: number): boolean;
  discover(name: string): ServiceInstance[];
  heartbeat(name: string, host: string, port: number): boolean;
  getAll(): ServiceInstance[];
  prune(maxAgeMs: number): number;
}

function createServiceRegistry(): ServiceRegistry {
  // TODO: Implementer le registre :
  // - register : enregistre une instance (si elle existe deja, met a jour lastHeartbeat)
  // - deregister : supprime une instance, retourne true si trouvee
  // - discover : retourne toutes les instances d'un service par nom
  // - heartbeat : met a jour lastHeartbeat, retourne true si trouvee
  // - getAll : retourne toutes les instances
  // - prune(maxAgeMs) : supprime les instances dont lastHeartbeat > maxAgeMs, retourne le nombre supprime
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Appel inter-services
// Simuler un appel a un autre service avec forwarding de correlation ID
// et gestion d'erreurs.
// =============================================================================

interface ServiceCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
  correlationId: string;
  fromService: string;
  toService: string;
  durationMs: number;
}

async function callService(
  fromService: string,
  toService: string,
  payload: unknown,
  correlationId: string,
  options?: { shouldFail?: boolean; delayMs?: number }
): Promise<ServiceCallResult> {
  // TODO: Simuler un appel inter-services
  // - Attendre delayMs (defaut 10) avec simulateNetworkDelay
  // - Si shouldFail, retourner { success: false, error: `Service ${toService} unavailable`, ... }
  // - Sinon retourner { success: true, data: { received: payload, processedBy: toService }, ... }
  // - Toujours inclure correlationId, fromService, toService, durationMs
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 03 — Premiers microservices\n');

  // --- Exercice 1 ---
  await test('Ex1: createService cree un service avec les bonnes proprietes', () => {
    const svc = createService('user-service', 3000, '2.1.0');
    assertEqual(svc.name, 'user-service');
    assertEqual(svc.port, 3000);
    assertEqual(svc.version, '2.1.0');
    assert(Array.isArray(svc.routes), 'Routes should be an array');
    assertEqual(svc.routes.length, 0);
  });

  await test('Ex1: addRoute ajoute une route au service', () => {
    const svc = createService('api', 8080);
    addRoute(svc, 'GET', '/users', () => ({ users: [] }));
    assertEqual(svc.routes.length, 1);
    assertEqual(svc.routes[0].method, 'GET');
    assertEqual(svc.routes[0].path, '/users');
    const response = svc.routes[0].handler({});
    assertDeepEqual(response, { users: [] });
  });

  // --- Exercice 2 ---
  await test('Ex2: healthCheck retourne healthy quand tout va bien', () => {
    const svc = createService('api', 8080);
    const result = healthCheck(svc, [
      { name: 'db', status: 'healthy', responseTimeMs: 5 },
    ]);
    assertEqual(result.service, 'api');
    assertEqual(result.status, 'healthy');
    assert(result.uptime >= 0, 'Uptime should be >= 0');
    assertEqual(result.dependencies.length, 1);
  });

  await test('Ex2: healthCheck retourne degraded si une dependance est down', () => {
    const svc = createService('api', 8080);
    const result = healthCheck(svc, [
      { name: 'db', status: 'healthy' },
      { name: 'cache', status: 'unhealthy' },
    ]);
    assertEqual(result.status, 'degraded');
  });

  // --- Exercice 3 ---
  await test('Ex3: logger cree des entrees structurees', () => {
    const logger = createLogger('order-service', 'corr-123');
    const entry = logger.info('Order created', { orderId: '42' });
    assertEqual(entry.level, 'info');
    assertEqual(entry.service, 'order-service');
    assertEqual(entry.message, 'Order created');
    assertEqual(entry.correlationId, 'corr-123');
    assert(entry.metadata !== undefined, 'Should have metadata');
    assert(entry.timestamp.length > 0, 'Should have timestamp');
  });

  await test('Ex3: logger enregistre toutes les entrees', () => {
    const logger = createLogger('svc');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    const entries = logger.getEntries();
    assertEqual(entries.length, 4);
    assertEqual(entries[0].level, 'debug');
    assertEqual(entries[3].level, 'error');
  });

  // --- Exercice 4 ---
  await test('Ex4: generateCorrelationId cree des IDs uniques', () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    assert(id1 !== id2, 'IDs should be unique');
    assert(id1.startsWith('corr-'), 'ID should start with corr-');
  });

  await test('Ex4: propagateContext conserve le correlationId', () => {
    const ctx = createRequestContext('service-a');
    const propagated = propagateContext(ctx, 'service-b');
    assertEqual(propagated.correlationId, ctx.correlationId);
    assertEqual(propagated.sourceName, 'service-b');
  });

  // --- Exercice 5 ---
  await test('Ex5: registre enregistre et decouvre des services', () => {
    const registry = createServiceRegistry();
    registry.register({ name: 'user-svc', host: 'localhost', port: 3000 });
    registry.register({ name: 'user-svc', host: 'localhost', port: 3001 });
    registry.register({ name: 'order-svc', host: 'localhost', port: 4000 });
    const users = registry.discover('user-svc');
    assertEqual(users.length, 2);
    const orders = registry.discover('order-svc');
    assertEqual(orders.length, 1);
  });

  await test('Ex5: registre desinscrit un service', () => {
    const registry = createServiceRegistry();
    registry.register({ name: 'svc', host: 'localhost', port: 3000 });
    assertEqual(registry.getAll().length, 1);
    const removed = registry.deregister('svc', 'localhost', 3000);
    assert(removed === true, 'Should return true');
    assertEqual(registry.getAll().length, 0);
  });

  // --- Exercice 6 ---
  await test('Ex6: callService reussit avec correlation ID', async () => {
    const result = await callService('api-gateway', 'user-service', { userId: '1' }, 'corr-abc', { delayMs: 5 });
    assert(result.success === true, 'Should succeed');
    assertEqual(result.correlationId, 'corr-abc');
    assertEqual(result.fromService, 'api-gateway');
    assertEqual(result.toService, 'user-service');
    assertGreaterThan(result.durationMs, 0);
  });

  await test('Ex6: callService gere les erreurs', async () => {
    const result = await callService('api', 'broken-svc', {}, 'corr-xyz', { shouldFail: true, delayMs: 5 });
    assert(result.success === false, 'Should fail');
    assert(typeof result.error === 'string', 'Should have error message');
    assertEqual(result.correlationId, 'corr-xyz');
  });

  summary();
}

main();
