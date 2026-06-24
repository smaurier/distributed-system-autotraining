// =============================================================================
// Lab 26 — Kubernetes : fondamentaux (Exercice)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertIncludes, assertThrows, summary } = createTestRunner('Lab 26 — Kubernetes fondamental');

// =============================================================================
// Exercice 1 : Pod Scheduler
// Attribuez des Pods aux Nodes en respectant les resources et nodeSelector.
// =============================================================================

interface K8sNode {
  name: string;
  labels: Record<string, string>;
  allocatable: { cpu: number; memory: number };
  allocated: { cpu: number; memory: number };
}

interface PodRequest {
  name: string;
  requests: { cpu: number; memory: number };
  nodeSelector?: Record<string, string>;
}

interface ScheduleResult {
  podName: string;
  nodeName: string | null;
  reason?: string;
}

function schedulePod(pod: PodRequest, nodes: K8sNode[]): ScheduleResult {
  // TODO: Implementez le scheduling
  // 1. Filtrer les nodes par nodeSelector (tous les labels doivent matcher)
  // 2. Filtrer par resources disponibles (allocatable - allocated >= requests)
  // 3. Choisir le node avec le PLUS de resources disponibles (cpu + memory)
  // 4. Retourner null si aucun node ne convient
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Label Selector Engine
// =============================================================================

interface MatchExpression {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values?: string[];
}

interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: MatchExpression[];
}

interface K8sResource {
  name: string;
  labels: Record<string, string>;
}

function matchSelector(resource: K8sResource, selector: LabelSelector): boolean {
  // TODO: Implementez le matching
  // matchLabels: toutes les paires key=value doivent etre presentes
  // matchExpressions:
  //   In: la valeur du label doit etre dans values[]
  //   NotIn: la valeur du label ne doit PAS etre dans values[]
  //   Exists: le label doit exister (peu importe la valeur)
  //   DoesNotExist: le label ne doit PAS exister
  // Tout doit matcher (AND logique)
  throw new Error('Not implemented');
}

function selectResources(resources: K8sResource[], selector: LabelSelector): K8sResource[] {
  // TODO: Retourner les ressources qui matchent le selector
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Deployment Controller
// =============================================================================

interface DeploymentSpec {
  replicas: number;
  strategy: {
    type: 'RollingUpdate' | 'Recreate';
    maxSurge?: number;
    maxUnavailable?: number;
  };
}

interface PodInstance {
  name: string;
  version: string;
  status: 'Running' | 'Pending' | 'Terminating';
}

interface RolloutState {
  pods: PodInstance[];
  availableReplicas: number;
  updatedReplicas: number;
  generation: number;
}

function createRolloutState(spec: DeploymentSpec, version: string): RolloutState {
  // TODO: Creer l'etat initial avec `replicas` pods en Running
  throw new Error('Not implemented');
}

function rolloutStep(state: RolloutState, spec: DeploymentSpec, newVersion: string): RolloutState {
  // TODO: Executez UNE etape du rolling update
  // 1. Si strategy = Recreate: terminer tous les ancien pods, creer les nouveaux
  // 2. Si RollingUpdate:
  //    - Compter les pods running de l'ancienne version
  //    - Compter les pods de la nouvelle version (running + pending)
  //    - On peut avoir au maximum replicas + maxSurge pods au total
  //    - On doit garder au minimum replicas - maxUnavailable pods running
  //    - Terminer un ancien pod si possible, puis creer un nouveau pod en Pending
  //    - Les pods Pending deviennent Running a l'etape suivante
  // 3. Retourner le nouvel etat
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Service Router
// =============================================================================

interface ServiceSpec {
  name: string;
  type: 'ClusterIP' | 'NodePort';
  selector: Record<string, string>;
  port: number;
  targetPort: number;
  nodePort?: number;
}

interface Endpoint {
  podName: string;
  ip: string;
  port: number;
  ready: boolean;
}

interface ServiceRouter {
  spec: ServiceSpec;
  endpoints: Endpoint[];
  currentIndex: number;
}

function createServiceRouter(spec: ServiceSpec, pods: Array<{ name: string; labels: Record<string, string>; ip: string; port: number; ready: boolean }>): ServiceRouter {
  // TODO: Creer un router en filtrant les pods qui matchent le selector
  throw new Error('Not implemented');
}

function routeRequest(router: ServiceRouter): { endpoint: Endpoint; router: ServiceRouter } | null {
  // TODO: Round-robin sur les endpoints READY uniquement
  // Retourner null si aucun endpoint ready
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Probe Evaluator
// =============================================================================

interface ProbeConfig {
  initialDelaySeconds: number;
  periodSeconds: number;
  failureThreshold: number;
  successThreshold: number;
}

interface PodProbeState {
  containerReady: boolean;
  podReady: boolean;
  restartCount: number;
  startupCompleted: boolean;
  livenessFailures: number;
  readinessFailures: number;
  readinessSuccesses: number;
}

function createPodProbeState(): PodProbeState {
  return {
    containerReady: false,
    podReady: false,
    restartCount: 0,
    startupCompleted: false,
    livenessFailures: 0,
    readinessFailures: 0,
    readinessSuccesses: 0,
  };
}

function evaluateProbes(
  state: PodProbeState,
  probes: {
    startup?: { result: boolean; config: ProbeConfig };
    liveness?: { result: boolean; config: ProbeConfig };
    readiness?: { result: boolean; config: ProbeConfig };
  }
): PodProbeState {
  // TODO: Evaluez les probes dans l'ordre:
  // 1. Si startup probe definie et pas encore completee:
  //    - Succes -> startupCompleted = true
  //    - Echec apres failureThreshold -> restart (restartCount++, reset state)
  //    - Tant que startup pas complete, liveness et readiness ne s'executent pas
  // 2. Liveness probe:
  //    - Succes -> reset livenessFailures
  //    - Echec -> increment livenessFailures
  //    - Si livenessFailures >= failureThreshold -> restart (restartCount++, reset)
  // 3. Readiness probe:
  //    - Succes -> increment readinessSuccesses, reset readinessFailures
  //    - Si readinessSuccesses >= successThreshold -> podReady = true
  //    - Echec -> increment readinessFailures, reset readinessSuccesses
  //    - Si readinessFailures >= failureThreshold -> podReady = false
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Manifest Validator
// =============================================================================

interface ManifestValidationError {
  path: string;
  message: string;
}

interface K8sManifest {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    namespace?: string;
  };
  spec?: {
    containers?: Array<{
      name?: string;
      image?: string;
      ports?: Array<{ containerPort: number }>;
      resources?: {
        requests?: { cpu?: string; memory?: string };
        limits?: { cpu?: string; memory?: string };
      };
    }>;
    replicas?: number;
  };
}

function validateManifest(manifest: K8sManifest): ManifestValidationError[] {
  // TODO: Validez le manifest et retournez les erreurs:
  // 1. apiVersion requis
  // 2. kind requis
  // 3. metadata.name requis et conforme RFC 1123 (lowercase, alphanumeric, '-', max 63 chars)
  // 4. labels: chaque key et value conforme (alphanumeric, '-', '_', '.', max 63 chars)
  // 5. containers: au moins un container requis si kind = 'Pod'
  // 6. Chaque container doit avoir name et image
  // 7. Si resources.limits definis, resources.requests doit aussi l'etre
  // 8. Ports containerPort doivent etre uniques dans un container
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 26 — Kubernetes fondamental\n');

  // --- Ex1 : Pod Scheduler ---
  await test('Ex1 — Schedule sur node avec resources', () => {
    const nodes: K8sNode[] = [
      { name: 'node-1', labels: { zone: 'eu-west' }, allocatable: { cpu: 4000, memory: 8192 }, allocated: { cpu: 3500, memory: 7000 } },
      { name: 'node-2', labels: { zone: 'eu-west' }, allocatable: { cpu: 4000, memory: 8192 }, allocated: { cpu: 1000, memory: 2000 } },
    ];
    const result = schedulePod({ name: 'api', requests: { cpu: 500, memory: 512 } }, nodes);
    assertEqual(result.nodeName, 'node-2');
  });

  await test('Ex1 — Schedule avec nodeSelector', () => {
    const nodes: K8sNode[] = [
      { name: 'node-1', labels: { zone: 'eu-west', gpu: 'true' }, allocatable: { cpu: 4000, memory: 8192 }, allocated: { cpu: 0, memory: 0 } },
      { name: 'node-2', labels: { zone: 'us-east' }, allocatable: { cpu: 8000, memory: 16384 }, allocated: { cpu: 0, memory: 0 } },
    ];
    const result = schedulePod({ name: 'ml-job', requests: { cpu: 1000, memory: 2048 }, nodeSelector: { gpu: 'true' } }, nodes);
    assertEqual(result.nodeName, 'node-1');
  });

  await test('Ex1 — Aucun node disponible', () => {
    const nodes: K8sNode[] = [
      { name: 'node-1', labels: {}, allocatable: { cpu: 1000, memory: 1024 }, allocated: { cpu: 900, memory: 900 } },
    ];
    const result = schedulePod({ name: 'big-pod', requests: { cpu: 500, memory: 512 } }, nodes);
    assertEqual(result.nodeName, null);
  });

  // --- Ex2 : Label Selector ---
  await test('Ex2 — matchLabels simple', () => {
    const resources: K8sResource[] = [
      { name: 'pod-1', labels: { app: 'api', env: 'prod' } },
      { name: 'pod-2', labels: { app: 'web', env: 'prod' } },
      { name: 'pod-3', labels: { app: 'api', env: 'staging' } },
    ];
    const selected = selectResources(resources, { matchLabels: { app: 'api', env: 'prod' } });
    assertEqual(selected.length, 1);
    assertEqual(selected[0].name, 'pod-1');
  });

  await test('Ex2 — matchExpressions In / NotIn', () => {
    const resources: K8sResource[] = [
      { name: 'pod-1', labels: { app: 'api', tier: 'backend' } },
      { name: 'pod-2', labels: { app: 'web', tier: 'frontend' } },
      { name: 'pod-3', labels: { app: 'worker', tier: 'backend' } },
    ];
    const selected = selectResources(resources, {
      matchExpressions: [
        { key: 'tier', operator: 'In', values: ['backend'] },
        { key: 'app', operator: 'NotIn', values: ['worker'] },
      ],
    });
    assertEqual(selected.length, 1);
    assertEqual(selected[0].name, 'pod-1');
  });

  await test('Ex2 — Exists / DoesNotExist', () => {
    const resources: K8sResource[] = [
      { name: 'pod-1', labels: { app: 'api', canary: 'true' } },
      { name: 'pod-2', labels: { app: 'api' } },
    ];
    const withCanary = selectResources(resources, { matchExpressions: [{ key: 'canary', operator: 'Exists' }] });
    assertEqual(withCanary.length, 1);
    assertEqual(withCanary[0].name, 'pod-1');
    const withoutCanary = selectResources(resources, { matchExpressions: [{ key: 'canary', operator: 'DoesNotExist' }] });
    assertEqual(withoutCanary.length, 1);
    assertEqual(withoutCanary[0].name, 'pod-2');
  });

  // --- Ex3 : Deployment Controller ---
  await test('Ex3 — Creation initiale', () => {
    const state = createRolloutState({ replicas: 3, strategy: { type: 'RollingUpdate', maxSurge: 1, maxUnavailable: 1 } }, 'v1');
    assertEqual(state.pods.length, 3);
    assertEqual(state.availableReplicas, 3);
    assert(state.pods.every(p => p.version === 'v1' && p.status === 'Running'), 'Tous en v1 Running');
  });

  await test('Ex3 — Rolling update step', () => {
    const spec: DeploymentSpec = { replicas: 3, strategy: { type: 'RollingUpdate', maxSurge: 1, maxUnavailable: 1 } };
    let state = createRolloutState(spec, 'v1');
    state = rolloutStep(state, spec, 'v2');
    const v2Pods = state.pods.filter(p => p.version === 'v2');
    const terminatingPods = state.pods.filter(p => p.status === 'Terminating');
    assert(v2Pods.length >= 1, 'Au moins un pod v2 cree');
    assert(state.pods.length <= 4, 'Max replicas + maxSurge pods');
  });

  await test('Ex3 — Recreate strategy', () => {
    const spec: DeploymentSpec = { replicas: 3, strategy: { type: 'Recreate' } };
    let state = createRolloutState(spec, 'v1');
    state = rolloutStep(state, spec, 'v2');
    assert(state.pods.every(p => p.version === 'v2'), 'Tous les pods doivent etre v2');
  });

  // --- Ex4 : Service Router ---
  await test('Ex4 — Round-robin entre pods ready', () => {
    const pods = [
      { name: 'pod-1', labels: { app: 'api' }, ip: '10.0.0.1', port: 3000, ready: true },
      { name: 'pod-2', labels: { app: 'api' }, ip: '10.0.0.2', port: 3000, ready: true },
      { name: 'pod-3', labels: { app: 'web' }, ip: '10.0.0.3', port: 80, ready: true },
    ];
    let router = createServiceRouter({ name: 'api-svc', type: 'ClusterIP', selector: { app: 'api' }, port: 80, targetPort: 3000 }, pods);
    assertEqual(router.endpoints.length, 2);

    const result1 = routeRequest(router)!;
    router = result1.router;
    const result2 = routeRequest(router)!;
    assert(result1.endpoint.podName !== result2.endpoint.podName, 'Round-robin alterne entre pods');
  });

  await test('Ex4 — Ignore pods non-ready', () => {
    const pods = [
      { name: 'pod-1', labels: { app: 'api' }, ip: '10.0.0.1', port: 3000, ready: false },
      { name: 'pod-2', labels: { app: 'api' }, ip: '10.0.0.2', port: 3000, ready: true },
    ];
    const router = createServiceRouter({ name: 'api-svc', type: 'ClusterIP', selector: { app: 'api' }, port: 80, targetPort: 3000 }, pods);
    const result = routeRequest(router)!;
    assertEqual(result.endpoint.podName, 'pod-2');
  });

  await test('Ex4 — Aucun endpoint ready retourne null', () => {
    const pods = [
      { name: 'pod-1', labels: { app: 'api' }, ip: '10.0.0.1', port: 3000, ready: false },
    ];
    const router = createServiceRouter({ name: 'api-svc', type: 'ClusterIP', selector: { app: 'api' }, port: 80, targetPort: 3000 }, pods);
    assertEqual(routeRequest(router), null);
  });

  // --- Ex5 : Probe Evaluator ---
  await test('Ex5 — Startup probe doit completer avant liveness/readiness', () => {
    let state = createPodProbeState();
    state = evaluateProbes(state, {
      startup: { result: false, config: { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 3, successThreshold: 1 } },
      liveness: { result: true, config: { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 3, successThreshold: 1 } },
      readiness: { result: true, config: { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 3, successThreshold: 1 } },
    });
    assertEqual(state.startupCompleted, false);
    assertEqual(state.podReady, false);
  });

  await test('Ex5 — Startup complete puis readiness', () => {
    let state = createPodProbeState();
    state = evaluateProbes(state, {
      startup: { result: true, config: { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 3, successThreshold: 1 } },
    });
    assertEqual(state.startupCompleted, true);
    state = evaluateProbes(state, {
      readiness: { result: true, config: { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 1, successThreshold: 1 } },
    });
    assertEqual(state.podReady, true);
  });

  await test('Ex5 — Liveness failure cause un restart', () => {
    let state = createPodProbeState();
    state.startupCompleted = true;
    const config: ProbeConfig = { initialDelaySeconds: 0, periodSeconds: 1, failureThreshold: 2, successThreshold: 1 };
    state = evaluateProbes(state, { liveness: { result: false, config } });
    state = evaluateProbes(state, { liveness: { result: false, config } });
    assertEqual(state.restartCount, 1);
    assertEqual(state.livenessFailures, 0);
  });

  // --- Ex6 : Manifest Validator ---
  await test('Ex6 — Manifest valide', () => {
    const errors = validateManifest({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'my-pod', labels: { app: 'api' } },
      spec: { containers: [{ name: 'main', image: 'node:20-alpine', ports: [{ containerPort: 3000 }] }] },
    });
    assertEqual(errors.length, 0);
  });

  await test('Ex6 — Champs requis manquants', () => {
    const errors = validateManifest({});
    assert(errors.some(e => e.path === 'apiVersion'), 'apiVersion requis');
    assert(errors.some(e => e.path === 'kind'), 'kind requis');
    assert(errors.some(e => e.path === 'metadata.name'), 'metadata.name requis');
  });

  await test('Ex6 — Nom non-conforme RFC 1123', () => {
    const errors = validateManifest({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'MY_POD!' },
      spec: { containers: [{ name: 'main', image: 'node:20' }] },
    });
    assert(errors.some(e => e.path === 'metadata.name' && e.message.includes('RFC 1123')), 'Doit signaler nom invalide');
  });

  await test('Ex6 — Ports dupliques', () => {
    const errors = validateManifest({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'my-pod' },
      spec: {
        containers: [{
          name: 'main',
          image: 'node:20',
          ports: [{ containerPort: 3000 }, { containerPort: 3000 }],
        }],
      },
    });
    assert(errors.some(e => e.message.includes('duplicate')), 'Doit detecter les ports dupliques');
  });

  summary();
}

main();
