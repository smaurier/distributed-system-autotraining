// =============================================================================
// Lab 01 — Monolithe vs Distribue (Exercice)
// =============================================================================

import { createTestRunner, simulateNetworkDelay } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertGreaterThan, assertLessThan, summary } = createTestRunner('Lab 01 — Monolithe vs Distribue');

// =============================================================================
// Exercice 1 : Fonction monolithique
// Creer une fonction unique qui fait tout : authentification, creation de
// commande et envoi de notification. C'est l'approche monolithique typique.
//
// La fonction doit :
// - Verifier que userId n'est pas vide (sinon throw 'Authentication failed')
// - Calculer le total de la commande
// - Generer un orderId au format "ORD-{timestamp}"
// - Retourner un objet MonolithResult complet
// =============================================================================

interface MonolithResult {
  userId: string;
  authenticated: boolean;
  orderId: string;
  orderTotal: number;
  notificationSent: boolean;
}

function monolithicProcess(userId: string, items: { name: string; price: number }[]): MonolithResult {
  // TODO: Implementer la logique monolithique
  // 1. Verifier userId (throw si vide)
  // 2. Calculer le total des items
  // 3. Generer un orderId
  // 4. Retourner le resultat complet
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Decoupage en services
// Separer la logique en 3 fonctions independantes qui representent chacune
// un service distinct : authentification, commande, notification.
// =============================================================================

interface AuthResult {
  userId: string;
  authenticated: boolean;
  token: string;
}

interface OrderResult {
  orderId: string;
  userId: string;
  items: { name: string; price: number }[];
  total: number;
  status: string;
}

interface NotificationResult {
  notificationId: string;
  userId: string;
  message: string;
  sent: boolean;
}

function authService(userId: string, password: string): AuthResult {
  // TODO: Implementer le service d'authentification
  // - Verifier que userId et password ne sont pas vides (throw 'Invalid credentials')
  // - Retourner { userId, authenticated: true, token: `token-${userId}-${timestamp}` }
  throw new Error('Not implemented');
}

function orderService(userId: string, items: { name: string; price: number }[]): OrderResult {
  // TODO: Implementer le service de commande
  // - Verifier que items n'est pas vide (throw 'No items in order')
  // - Retourner { orderId, userId, items, total, status: 'created' }
  throw new Error('Not implemented');
}

function notificationService(userId: string, message: string): NotificationResult {
  // TODO: Implementer le service de notification
  // - Retourner { notificationId: `NOTIF-${timestamp}`, userId, message, sent: true }
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Communication entre services (sequentiel)
// Creer une fonction async qui appelle les 3 services sequentiellement
// avec des delais reseau simules entre chaque appel.
// =============================================================================

interface SequentialResult {
  auth: AuthResult;
  order: OrderResult;
  notification: NotificationResult;
  totalDurationMs: number;
}

async function processOrderSequential(
  userId: string,
  password: string,
  items: { name: string; price: number }[],
  delayMs: number = 50
): Promise<SequentialResult> {
  // TODO: Appeler les 3 services sequentiellement
  // - Avant chaque appel, simuler un delai avec simulateNetworkDelay(delayMs)
  // - Mesurer le temps total avec Date.now()
  // - Retourner le resultat avec totalDurationMs
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Appels paralleles
// Quand les services sont independants, on peut les appeler en parallele
// avec Promise.all pour reduire le temps total.
// =============================================================================

interface ParallelResult {
  auth: AuthResult;
  order: OrderResult;
  notification: NotificationResult;
  totalDurationMs: number;
}

async function processOrderParallel(
  userId: string,
  password: string,
  items: { name: string; price: number }[],
  delayMs: number = 50
): Promise<ParallelResult> {
  // TODO: Appeler les 3 services en parallele avec Promise.all
  // - Chaque appel doit inclure simulateNetworkDelay(delayMs) avant le service
  // - Mesurer le temps total
  // - Retourner le resultat avec totalDurationMs
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Gestion des erreurs partielles
// Dans un systeme distribue, un service peut echouer tandis que les autres
// reussissent. Implementer une gestion qui continue malgre les erreurs.
// =============================================================================

interface PartialResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ResilientResult {
  auth: PartialResult<AuthResult>;
  order: PartialResult<OrderResult>;
  notification: PartialResult<NotificationResult>;
  overallSuccess: boolean;
}

async function processOrderResilient(
  userId: string,
  password: string,
  items: { name: string; price: number }[],
  failingService?: string
): Promise<ResilientResult> {
  // TODO: Appeler chaque service dans un try/catch
  // - Si failingService === 'auth', simuler un echec du service auth
  // - Si failingService === 'order', simuler un echec du service order
  // - Si failingService === 'notification', simuler un echec du service notification
  // - overallSuccess = auth.success && order.success (notification non-critique)
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Comparaison de performance
// Mesurer et comparer le temps d'execution sequentiel vs parallele
// =============================================================================

interface PerformanceComparison {
  sequentialMs: number;
  parallelMs: number;
  speedupFactor: number;
}

async function comparePerformance(
  userId: string,
  password: string,
  items: { name: string; price: number }[],
  delayMs: number = 50
): Promise<PerformanceComparison> {
  // TODO: Mesurer le temps de processOrderSequential et processOrderParallel
  // - Calculer le speedupFactor = sequentialMs / parallelMs (arrondi a 2 decimales)
  // - Retourner { sequentialMs, parallelMs, speedupFactor }
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 01 — Monolithe vs Distribue\n');

  // --- Exercice 1 ---
  await test('Ex1: monolithicProcess retourne un resultat complet', () => {
    const result = monolithicProcess('user-1', [{ name: 'Book', price: 29.99 }]);
    assertEqual(result.userId, 'user-1');
    assert(result.authenticated === true, 'Should be authenticated');
    assert(result.orderId.startsWith('ORD-'), 'Order ID should start with ORD-');
    assertEqual(result.orderTotal, 29.99);
    assertEqual(result.notificationSent, true);
  });

  await test('Ex1: monolithicProcess lance une erreur si userId est vide', () => {
    try {
      monolithicProcess('', [{ name: 'Book', price: 10 }]);
      throw new Error('Should have thrown');
    } catch (err) {
      assertEqual((err as Error).message, 'Authentication failed');
    }
  });

  // --- Exercice 2 ---
  await test('Ex2: authService retourne un token valide', () => {
    const result = authService('user-1', 'pass123');
    assertEqual(result.userId, 'user-1');
    assertEqual(result.authenticated, true);
    assert(result.token.startsWith('token-'), 'Token should start with token-');
  });

  await test('Ex2: orderService calcule le total correctement', () => {
    const items = [{ name: 'Book', price: 10 }, { name: 'Pen', price: 5 }];
    const result = orderService('user-1', items);
    assertEqual(result.total, 15);
    assertEqual(result.status, 'created');
    assertEqual(result.items.length, 2);
  });

  await test('Ex2: notificationService envoie une notification', () => {
    const result = notificationService('user-1', 'Hello');
    assertEqual(result.userId, 'user-1');
    assertEqual(result.message, 'Hello');
    assertEqual(result.sent, true);
  });

  // --- Exercice 3 ---
  await test('Ex3: processOrderSequential enchaine les 3 services', async () => {
    const result = await processOrderSequential('user-1', 'pass', [{ name: 'Item', price: 20 }], 20);
    assert(result.auth.authenticated === true, 'Auth should succeed');
    assert(result.order.total === 20, 'Order total should be 20');
    assert(result.notification.sent === true, 'Notification should be sent');
    assertGreaterThan(result.totalDurationMs, 50, 'Sequential should take > 50ms (3 delays)');
  });

  // --- Exercice 4 ---
  await test('Ex4: processOrderParallel appelle les services en parallele', async () => {
    const result = await processOrderParallel('user-1', 'pass', [{ name: 'Item', price: 20 }], 30);
    assert(result.auth.authenticated === true, 'Auth should succeed');
    assert(result.order.total === 20, 'Order total should be 20');
    assert(result.notification.sent === true, 'Notification should be sent');
  });

  await test('Ex4: parallele est plus rapide que sequentiel', async () => {
    const delayMs = 60;
    const seqResult = await processOrderSequential('u', 'p', [{ name: 'A', price: 1 }], delayMs);
    const parResult = await processOrderParallel('u', 'p', [{ name: 'A', price: 1 }], delayMs);
    assertGreaterThan(seqResult.totalDurationMs, parResult.totalDurationMs, 'Sequential should be slower');
  });

  // --- Exercice 5 ---
  await test('Ex5: processOrderResilient gere un echec de notification', async () => {
    const result = await processOrderResilient('user-1', 'pass', [{ name: 'X', price: 10 }], 'notification');
    assert(result.auth.success === true, 'Auth should succeed');
    assert(result.order.success === true, 'Order should succeed');
    assert(result.notification.success === false, 'Notification should fail');
    assert(result.overallSuccess === true, 'Overall should still succeed (notification non-critical)');
  });

  await test('Ex5: processOrderResilient detecte un echec critique (auth)', async () => {
    const result = await processOrderResilient('user-1', 'pass', [{ name: 'X', price: 10 }], 'auth');
    assert(result.auth.success === false, 'Auth should fail');
    assert(result.overallSuccess === false, 'Overall should fail when auth fails');
    assert(typeof result.auth.error === 'string', 'Should have error message');
  });

  // --- Exercice 6 ---
  await test('Ex6: comparePerformance retourne un speedup > 1', async () => {
    const result = await comparePerformance('u', 'p', [{ name: 'A', price: 1 }], 50);
    assertGreaterThan(result.sequentialMs, 0);
    assertGreaterThan(result.parallelMs, 0);
    assertGreaterThan(result.speedupFactor, 1, 'Parallel should be faster (speedup > 1)');
  });

  await test('Ex6: comparePerformance calcule le speedupFactor', async () => {
    const result = await comparePerformance('u', 'p', [{ name: 'A', price: 1 }], 40);
    const expected = Math.round((result.sequentialMs / result.parallelMs) * 100) / 100;
    assertEqual(result.speedupFactor, expected, 'Speedup factor should be seq/par');
  });

  summary();
}

main();
