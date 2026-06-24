// =============================================================================
// Lab 26 — Kubernetes : fondamentaux (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertIncludes, assertThrows, summary } = createTestRunner('Lab 26 — Kubernetes fondamental');

// =============================================================================
// Exercice 1 : Pod Scheduler
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
  let candidates = nodes;

  // Filter by nodeSelector
  if (pod.nodeSelector) {
    candidates = candidates.filter(node =>
      Object.entries(pod.nodeSelector!).every(([k, v]) => node.labels[k] === v)
    );
  }

  // Filter by available resources
  candidates = candidates.filter(node => {
    const freeCpu = node.allocatable.cpu - node.allocated.cpu;
    const freeMem = node.allocatable.memory - node.allocated.memory;
    return freeCpu >= pod.requests.cpu && freeMem >= pod.requests.memory;
  });

  if (candidates.length === 0) {
    return { podName: pod.name, nodeName: null, reason: 'No suitable node found' };
  }

  // Pick node with most available resources
  const best = candidates.reduce((a, b) => {
    const aFree = (a.allocatable.cpu - a.allocated.cpu) + (a.allocatable.memory - a.allocated.memory);
    const bFree = (b.allocatable.cpu - b.allocated.cpu) + (b.allocatable.memory - b.allocated.memory);
    return bFree > aFree ? b : a;
  });

  return { podName: pod.name, nodeName: best.name };
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
  if (selector.matchLabels) {
    for (const [key, value] of Object.entries(selector.matchLabels)) {
      if (resource.labels[key] !== value) return false;
    }
  }

  if (selector.matchExpressions) {
    for (const expr of selector.matchExpressions) {
      const value = resource.labels[expr.key];
      const exists = expr.key in resource.labels;

      switch (expr.operator) {
        case 'In':
          if (!exists || !expr.values?.includes(value)) return false;
          break;
        case 'NotIn':
          if (exists && expr.values?.includes(value)) return false;
          break;
        case 'Exists':
          if (!exists) return false;
          break;
        case 'DoesNotExist':
          if (exists) return false;
          break;
      }
    }
  }

  return true;
}

function selectResources(resources: K8sResource[], selector: LabelSelector): K8sResource[] {
  return resources.filter(r => matchSelector(r, selector));
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
  const pods: PodInstance[] = [];
  for (let i = 0; i < spec.replicas; i++) {
    pods.push({ name: `pod-${version}-${i}`, version, status: 'Running' });
  }
  return {
    pods,
    availableReplicas: spec.replicas,
    updatedReplicas: spec.replicas,
    generation: 1,
  };
}

function rolloutStep(state: RolloutState, spec: DeploymentSpec, newVersion: string): RolloutState {
  let pods = state.pods.map(p => ({ ...p }));

  // Promote pending pods to running
  pods = pods.filter(p => p.status !== 'Terminating');
  pods.forEach(p => { if (p.status === 'Pending') p.status = 'Running'; });

  if (spec.strategy.type === 'Recreate') {
    pods = [];
    for (let i = 0; i < spec.replicas; i++) {
      pods.push({ name: `pod-${newVersion}-${i}`, version: newVersion, status: 'Running' });
    }
    return {
      pods,
      availableReplicas: spec.replicas,
      updatedReplicas: spec.replicas,
      generation: state.generation + 1,
    };
  }

  // Rolling update
  const maxSurge = spec.strategy.maxSurge ?? 1;
  const maxUnavailable = spec.strategy.maxUnavailable ?? 1;

  const oldPods = pods.filter(p => p.version !== newVersion && p.status === 'Running');
  const newPods = pods.filter(p => p.version === newVersion);
  const maxTotal = spec.replicas + maxSurge;
  const minAvailable = spec.replicas - maxUnavailable;

  // Terminate an old pod if we have enough running
  const runningCount = pods.filter(p => p.status === 'Running').length;
  if (oldPods.length > 0 && (runningCount - 1) >= minAvailable) {
    oldPods[0].status = 'Terminating';
  }

  // Create a new pod if under maxTotal
  const activePods = pods.filter(p => p.status !== 'Terminating');
  if (activePods.length < maxTotal) {
    pods.push({
      name: `pod-${newVersion}-${newPods.length}`,
      version: newVersion,
      status: 'Pending',
    });
  }

  const available = pods.filter(p => p.status === 'Running').length;
  const updated = pods.filter(p => p.version === newVersion && p.status !== 'Terminating').length;

  return {
    pods,
    availableReplicas: available,
    updatedReplicas: updated,
    generation: state.generation + 1,
  };
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
  const matchingPods = pods.filter(pod =>
    Object.entries(spec.selector).every(([k, v]) => pod.labels[k] === v)
  );

  const endpoints: Endpoint[] = matchingPods.map(pod => ({
    podName: pod.name,
    ip: pod.ip,
    port: spec.targetPort,
    ready: pod.ready,
  }));

  return { spec, endpoints, currentIndex: 0 };
}

function routeRequest(router: ServiceRouter): { endpoint: Endpoint; router: ServiceRouter } | null {
  const readyEndpoints = router.endpoints.filter(e => e.ready);
  if (readyEndpoints.length === 0) return null;

  const index = router.currentIndex % readyEndpoints.length;
  const endpoint = readyEndpoints[index];

  return {
    endpoint,
    router: { ...router, currentIndex: router.currentIndex + 1 },
  };
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
  let newState = { ...state };

  // 1. Startup probe
  if (probes.startup && !newState.startupCompleted) {
    if (probes.startup.result) {
      newState.startupCompleted = true;
    } else {
      newState.livenessFailures++;
      if (newState.livenessFailures >= probes.startup.config.failureThreshold) {
        // Restart
        return {
          ...createPodProbeState(),
          restartCount: newState.restartCount + 1,
        };
      }
      // Startup not completed, skip liveness/readiness
      return newState;
    }
    // If startup just completed, continue to liveness/readiness
    if (!newState.startupCompleted) return newState;
  }

  // If startup defined but not completed, skip liveness/readiness
  if (probes.startup && !newState.startupCompleted) {
    return newState;
  }

  // 2. Liveness probe
  if (probes.liveness && newState.startupCompleted) {
    if (probes.liveness.result) {
      newState.livenessFailures = 0;
      newState.containerReady = true;
    } else {
      newState.livenessFailures++;
      if (newState.livenessFailures >= probes.liveness.config.failureThreshold) {
        return {
          ...createPodProbeState(),
          restartCount: newState.restartCount + 1,
        };
      }
    }
  }

  // 3. Readiness probe
  if (probes.readiness && (newState.startupCompleted || !probes.startup)) {
    if (probes.readiness.result) {
      newState.readinessSuccesses++;
      newState.readinessFailures = 0;
      if (newState.readinessSuccesses >= probes.readiness.config.successThreshold) {
        newState.podReady = true;
      }
    } else {
      newState.readinessFailures++;
      newState.readinessSuccesses = 0;
      if (newState.readinessFailures >= probes.readiness.config.failureThreshold) {
        newState.podReady = false;
      }
    }
  }

  return newState;
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

const RFC_1123_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const LABEL_VALUE_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

function validateManifest(manifest: K8sManifest): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];

  if (!manifest.apiVersion) {
    errors.push({ path: 'apiVersion', message: 'apiVersion is required' });
  }

  if (!manifest.kind) {
    errors.push({ path: 'kind', message: 'kind is required' });
  }

  if (!manifest.metadata?.name) {
    errors.push({ path: 'metadata.name', message: 'metadata.name is required' });
  } else {
    const name = manifest.metadata.name;
    if (name.length > 63 || !RFC_1123_REGEX.test(name)) {
      errors.push({ path: 'metadata.name', message: 'metadata.name must conform to RFC 1123 (lowercase alphanumeric and hyphens, max 63 chars)' });
    }
  }

  if (manifest.metadata?.labels) {
    for (const [key, value] of Object.entries(manifest.metadata.labels)) {
      if (key.length > 63 || !LABEL_VALUE_REGEX.test(key)) {
        errors.push({ path: `metadata.labels.${key}`, message: `Label key "${key}" is invalid` });
      }
      if (value.length > 63 || (value.length > 0 && !LABEL_VALUE_REGEX.test(value))) {
        errors.push({ path: `metadata.labels.${key}`, message: `Label value "${value}" is invalid` });
      }
    }
  }

  if (manifest.kind === 'Pod') {
    if (!manifest.spec?.containers || manifest.spec.containers.length === 0) {
      errors.push({ path: 'spec.containers', message: 'At least one container is required for Pod' });
    }
  }

  if (manifest.spec?.containers) {
    manifest.spec.containers.forEach((container, i) => {
      if (!container.name) {
        errors.push({ path: `spec.containers[${i}].name`, message: 'Container name is required' });
      }
      if (!container.image) {
        errors.push({ path: `spec.containers[${i}].image`, message: 'Container image is required' });
      }
      if (container.resources?.limits && !container.resources?.requests) {
        errors.push({ path: `spec.containers[${i}].resources`, message: 'requests must be defined when limits are set' });
      }
      if (container.ports) {
        const ports = container.ports.map(p => p.containerPort);
        const unique = new Set(ports);
        if (unique.size !== ports.length) {
          errors.push({ path: `spec.containers[${i}].ports`, message: 'duplicate containerPort detected' });
        }
      }
    });
  }

  return errors;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 26 — Kubernetes fondamental\n');

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
    assert(v2Pods.length >= 1, 'Au moins un pod v2 cree');
    assert(state.pods.length <= 4, 'Max replicas + maxSurge pods');
  });

  await test('Ex3 — Recreate strategy', () => {
    const spec: DeploymentSpec = { replicas: 3, strategy: { type: 'Recreate' } };
    let state = createRolloutState(spec, 'v1');
    state = rolloutStep(state, spec, 'v2');
    assert(state.pods.every(p => p.version === 'v2'), 'Tous les pods doivent etre v2');
  });

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
