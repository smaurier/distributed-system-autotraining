// =============================================================================
// Lab 27 — Kubernetes en pratique (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 27 — Kubernetes en pratique');

// =============================================================================
// Exercice 1 : HPA Simulator
// =============================================================================

interface HPASpec {
  minReplicas: number;
  maxReplicas: number;
  targetCPUUtilization: number;
  scaleUpStabilization: number;
  scaleDownStabilization: number;
}

interface HPAState {
  currentReplicas: number;
  desiredReplicas: number;
  scaleUpCount: number;
  scaleDownCount: number;
}

function createHPAState(initialReplicas: number): HPAState {
  return { currentReplicas: initialReplicas, desiredReplicas: initialReplicas, scaleUpCount: 0, scaleDownCount: 0 };
}

function evaluateHPA(state: HPAState, spec: HPASpec, currentCPU: number): HPAState {
  let desired = Math.ceil(state.currentReplicas * (currentCPU / spec.targetCPUUtilization));
  desired = Math.max(spec.minReplicas, Math.min(spec.maxReplicas, desired));

  const newState = { ...state, desiredReplicas: desired };

  if (desired > state.currentReplicas) {
    newState.scaleUpCount = state.scaleUpCount + 1;
    newState.scaleDownCount = 0;
    if (newState.scaleUpCount >= spec.scaleUpStabilization) {
      newState.currentReplicas = desired;
      newState.scaleUpCount = 0;
    }
  } else if (desired < state.currentReplicas) {
    newState.scaleDownCount = state.scaleDownCount + 1;
    newState.scaleUpCount = 0;
    if (newState.scaleDownCount >= spec.scaleDownStabilization) {
      newState.currentReplicas = desired;
      newState.scaleDownCount = 0;
    }
  } else {
    newState.scaleUpCount = 0;
    newState.scaleDownCount = 0;
  }

  return newState;
}

// =============================================================================
// Exercice 2 : Helm Values Merger
// =============================================================================

type HelmValues = Record<string, unknown>;

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function deepMerge(base: HelmValues, override: HelmValues): HelmValues {
  const result: HelmValues = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as HelmValues, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function resolveHelmValues(...valueFiles: HelmValues[]): HelmValues {
  return valueFiles.reduce((acc, file) => deepMerge(acc, file), {} as HelmValues);
}

// =============================================================================
// Exercice 3 : Canary Deployment Controller
// =============================================================================

interface CanaryConfig {
  steps: number[];
  errorThreshold: number;
  evaluationPeriod: number;
}

interface CanaryState {
  currentStep: number;
  trafficPercent: number;
  status: 'progressing' | 'completed' | 'rolled-back';
  totalRequests: number;
  errorRequests: number;
}

function createCanaryState(): CanaryState {
  return { currentStep: 0, trafficPercent: 0, status: 'progressing', totalRequests: 0, errorRequests: 0 };
}

function processCanaryBatch(
  state: CanaryState,
  config: CanaryConfig,
  batchResults: { total: number; errors: number }
): CanaryState {
  const newState = {
    ...state,
    totalRequests: state.totalRequests + batchResults.total,
    errorRequests: state.errorRequests + batchResults.errors,
  };

  if (newState.totalRequests >= config.evaluationPeriod) {
    const errorRate = newState.errorRequests / newState.totalRequests;

    if (errorRate >= config.errorThreshold) {
      return { ...newState, status: 'rolled-back', trafficPercent: 0 };
    }

    const nextStep = newState.currentStep + 1;
    if (nextStep >= config.steps.length) {
      return { ...newState, status: 'completed', totalRequests: 0, errorRequests: 0 };
    }

    return {
      ...newState,
      currentStep: nextStep,
      trafficPercent: config.steps[nextStep],
      totalRequests: 0,
      errorRequests: 0,
    };
  }

  return newState;
}

function routeCanaryRequest(state: CanaryState): 'canary' | 'stable' {
  return Math.random() * 100 < state.trafficPercent ? 'canary' : 'stable';
}

// =============================================================================
// Exercice 4 : Troubleshooter
// =============================================================================

interface PodStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  containerStatuses: Array<{
    name: string;
    ready: boolean;
    restartCount: number;
    state: {
      waiting?: { reason: string; message?: string };
      running?: { startedAt: string };
      terminated?: { reason: string; exitCode: number };
    };
  }>;
  conditions: Array<{
    type: string;
    status: 'True' | 'False';
    reason?: string;
    message?: string;
  }>;
}

interface Diagnosis {
  issue: string;
  severity: 'critical' | 'warning' | 'info';
  suggestion: string;
}

function diagnosePod(status: PodStatus): Diagnosis[] {
  const diags: Diagnosis[] = [];

  for (const cs of status.containerStatuses) {
    if (cs.state.waiting) {
      const reason = cs.state.waiting.reason;
      if (reason === 'CrashLoopBackOff') {
        diags.push({ issue: 'CrashLoopBackOff', severity: 'critical', suggestion: 'Container crashing repeatedly, check logs' });
      }
      if (reason === 'ImagePullBackOff' || reason === 'ErrImagePull') {
        diags.push({ issue: 'ImagePullBackOff', severity: 'critical', suggestion: 'Image not found or registry auth failed' });
      }
    }

    if (cs.state.terminated?.reason === 'OOMKilled') {
      diags.push({ issue: 'OOMKilled', severity: 'critical', suggestion: 'Container killed due to memory limit, increase memory limits' });
    }

    if (cs.restartCount > 5) {
      diags.push({ issue: 'HighRestartCount', severity: 'warning', suggestion: 'High restart count' });
    }

    if (status.phase === 'Running' && !cs.ready && !cs.state.waiting && !cs.state.terminated) {
      diags.push({ issue: 'NotReady', severity: 'info', suggestion: 'Container not ready, check readiness probe' });
    }
  }

  for (const cond of status.conditions) {
    if (cond.type === 'PodScheduled' && cond.status === 'False') {
      diags.push({ issue: 'Unschedulable', severity: 'warning', suggestion: 'No node with enough resources' });
    }
  }

  return diags;
}

// =============================================================================
// Exercice 5 : Network Policy Evaluator
// =============================================================================

interface NetworkPolicyRule {
  direction: 'ingress' | 'egress';
  podSelector: Record<string, string>;
  from?: Array<{ podSelector?: Record<string, string>; namespaceSelector?: Record<string, string> }>;
  to?: Array<{ podSelector?: Record<string, string>; namespaceSelector?: Record<string, string> }>;
  ports?: Array<{ protocol: 'TCP' | 'UDP'; port: number }>;
}

interface TrafficRequest {
  sourceLabels: Record<string, string>;
  sourceNamespace: string;
  destLabels: Record<string, string>;
  destNamespace: string;
  port: number;
  protocol: 'TCP' | 'UDP';
}

function labelsMatch(target: Record<string, string>, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => target[k] === v);
}

function isTrafficAllowed(
  policies: NetworkPolicyRule[],
  traffic: TrafficRequest,
  namespaceLabels: Record<string, Record<string, string>>
): boolean {
  // Find ingress policies that apply to the destination pod
  const applicablePolicies = policies.filter(p =>
    p.direction === 'ingress' && labelsMatch(traffic.destLabels, p.podSelector)
  );

  // No policy = default allow
  if (applicablePolicies.length === 0) return true;

  // Check if any policy allows the traffic
  for (const policy of applicablePolicies) {
    // Check ports
    if (policy.ports) {
      const portMatch = policy.ports.some(p => p.port === traffic.port && p.protocol === traffic.protocol);
      if (!portMatch) continue;
    }

    // Check from
    if (policy.from) {
      const fromMatch = policy.from.some(rule => {
        if (rule.podSelector && !labelsMatch(traffic.sourceLabels, rule.podSelector)) return false;
        if (rule.namespaceSelector) {
          const nsLabels = namespaceLabels[traffic.sourceNamespace];
          if (!nsLabels || !labelsMatch(nsLabels, rule.namespaceSelector)) return false;
        }
        return true;
      });
      if (fromMatch) return true;
    } else {
      // No from = allow all sources (if ports match)
      return true;
    }
  }

  return false;
}

// =============================================================================
// Exercice 6 : PDB Checker
// =============================================================================

interface PodDisruptionBudget {
  selector: Record<string, string>;
  minAvailable?: number;
  maxUnavailable?: number;
}

interface RunningPod {
  name: string;
  labels: Record<string, string>;
  nodeName: string;
  ready: boolean;
}

interface DrainResult {
  allowed: boolean;
  evictablePods: string[];
  blockedBy?: string;
}

function checkDrain(
  nodeName: string,
  pods: RunningPod[],
  pdbs: PodDisruptionBudget[]
): DrainResult {
  const podsOnNode = pods.filter(p => p.nodeName === nodeName);
  const evictablePods = podsOnNode.map(p => p.name);

  for (const pdb of pdbs) {
    const matchingPods = pods.filter(p =>
      Object.entries(pdb.selector).every(([k, v]) => p.labels[k] === v)
    );

    const matchingOnNode = podsOnNode.filter(p =>
      Object.entries(pdb.selector).every(([k, v]) => p.labels[k] === v)
    );

    if (matchingOnNode.length === 0) continue;

    const totalReady = matchingPods.filter(p => p.ready).length;
    const onNodeCount = matchingOnNode.length;

    if (pdb.minAvailable !== undefined) {
      const afterDrain = totalReady - onNodeCount;
      if (afterDrain < pdb.minAvailable) {
        return { allowed: false, evictablePods: [], blockedBy: `PDB minAvailable=${pdb.minAvailable}` };
      }
    }

    if (pdb.maxUnavailable !== undefined) {
      const currentUnavailable = matchingPods.filter(p => !p.ready).length;
      if (currentUnavailable + onNodeCount > pdb.maxUnavailable) {
        return { allowed: false, evictablePods: [], blockedBy: `PDB maxUnavailable=${pdb.maxUnavailable}` };
      }
    }
  }

  return { allowed: true, evictablePods };
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 27 — Kubernetes en pratique\n');

  await test('Ex1 — Scale up quand CPU depasse le target', () => {
    const spec: HPASpec = { minReplicas: 1, maxReplicas: 10, targetCPUUtilization: 50, scaleUpStabilization: 1, scaleDownStabilization: 3 };
    let state = createHPAState(2);
    state = evaluateHPA(state, spec, 80);
    assert(state.currentReplicas > 2, 'Doit scaler up');
    assert(state.currentReplicas <= 10, 'Ne doit pas depasser maxReplicas');
  });

  await test('Ex1 — Scale down avec stabilisation', () => {
    const spec: HPASpec = { minReplicas: 1, maxReplicas: 10, targetCPUUtilization: 50, scaleUpStabilization: 1, scaleDownStabilization: 3 };
    let state = createHPAState(5);
    state = evaluateHPA(state, spec, 20);
    assertEqual(state.currentReplicas, 5);
    state = evaluateHPA(state, spec, 20);
    assertEqual(state.currentReplicas, 5);
    state = evaluateHPA(state, spec, 20);
    assert(state.currentReplicas < 5, 'Doit scaler down apres stabilisation');
    assert(state.currentReplicas >= 1, 'Ne doit pas descendre sous minReplicas');
  });

  await test('Ex1 — Clamp aux limites min/max', () => {
    const spec: HPASpec = { minReplicas: 2, maxReplicas: 5, targetCPUUtilization: 50, scaleUpStabilization: 1, scaleDownStabilization: 1 };
    let state = createHPAState(3);
    state = evaluateHPA(state, spec, 500);
    assertEqual(state.currentReplicas, 5);
    state = evaluateHPA(state, spec, 1);
    assertEqual(state.currentReplicas, 2);
  });

  await test('Ex2 — Deep merge simple', () => {
    const result = deepMerge(
      { replicaCount: 1, image: { repository: 'nginx', tag: 'latest' } },
      { replicaCount: 3, image: { tag: '1.25' } }
    );
    assertEqual(result.replicaCount, 3);
    assertEqual((result.image as any).repository, 'nginx');
    assertEqual((result.image as any).tag, '1.25');
  });

  await test('Ex2 — Arrays sont remplaces', () => {
    const result = deepMerge(
      { env: [{ name: 'A', value: '1' }] },
      { env: [{ name: 'B', value: '2' }] }
    );
    assertDeepEqual(result.env, [{ name: 'B', value: '2' }]);
  });

  await test('Ex2 — Resolve multiples fichiers', () => {
    const result = resolveHelmValues(
      { replicaCount: 1, debug: false },
      { replicaCount: 2 },
      { debug: true, extra: 'value' }
    );
    assertEqual(result.replicaCount, 2);
    assertEqual(result.debug, true);
    assertEqual(result.extra, 'value');
  });

  await test('Ex3 — Canary progresse step par step', () => {
    const config: CanaryConfig = { steps: [10, 50, 100], errorThreshold: 0.05, evaluationPeriod: 100 };
    let state = createCanaryState();
    state = { ...state, currentStep: 0, trafficPercent: 10 };
    state = processCanaryBatch(state, config, { total: 100, errors: 2 });
    assertEqual(state.trafficPercent, 50);
    assertEqual(state.status, 'progressing');
  });

  await test('Ex3 — Canary rollback si erreur elevee', () => {
    const config: CanaryConfig = { steps: [10, 50, 100], errorThreshold: 0.05, evaluationPeriod: 100 };
    let state = createCanaryState();
    state = { ...state, currentStep: 0, trafficPercent: 10 };
    state = processCanaryBatch(state, config, { total: 100, errors: 10 });
    assertEqual(state.status, 'rolled-back');
    assertEqual(state.trafficPercent, 0);
  });

  await test('Ex3 — Canary completed au dernier step', () => {
    const config: CanaryConfig = { steps: [10, 50, 100], errorThreshold: 0.05, evaluationPeriod: 50 };
    let state: CanaryState = { currentStep: 2, trafficPercent: 100, status: 'progressing', totalRequests: 0, errorRequests: 0 };
    state = processCanaryBatch(state, config, { total: 50, errors: 1 });
    assertEqual(state.status, 'completed');
  });

  await test('Ex4 — Diagnostique CrashLoopBackOff', () => {
    const diags = diagnosePod({
      phase: 'Running',
      containerStatuses: [{
        name: 'main', ready: false, restartCount: 8,
        state: { waiting: { reason: 'CrashLoopBackOff' } },
      }],
      conditions: [],
    });
    assert(diags.some(d => d.issue === 'CrashLoopBackOff' && d.severity === 'critical'), 'Doit detecter CrashLoopBackOff');
    assert(diags.some(d => d.issue === 'HighRestartCount'), 'Doit detecter restart count eleve');
  });

  await test('Ex4 — Diagnostique OOMKilled', () => {
    const diags = diagnosePod({
      phase: 'Running',
      containerStatuses: [{
        name: 'main', ready: false, restartCount: 3,
        state: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
      }],
      conditions: [],
    });
    assert(diags.some(d => d.issue === 'OOMKilled' && d.severity === 'critical'), 'Doit detecter OOMKilled');
  });

  await test('Ex4 — Diagnostique Pending + unschedulable', () => {
    const diags = diagnosePod({
      phase: 'Pending',
      containerStatuses: [],
      conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }],
    });
    assert(diags.some(d => d.issue === 'Unschedulable'), 'Doit detecter pod non-schedulable');
  });

  await test('Ex5 — Trafic autorise sans policy', () => {
    const allowed = isTrafficAllowed([], {
      sourceLabels: { app: 'web' }, sourceNamespace: 'default',
      destLabels: { app: 'api' }, destNamespace: 'default',
      port: 3000, protocol: 'TCP',
    }, { default: { name: 'default' } });
    assert(allowed, 'Sans policy = autorise');
  });

  await test('Ex5 — Policy bloque trafic non-autorise', () => {
    const policies: NetworkPolicyRule[] = [{
      direction: 'ingress',
      podSelector: { app: 'api' },
      from: [{ podSelector: { app: 'web' } }],
      ports: [{ protocol: 'TCP', port: 3000 }],
    }];
    const blocked = isTrafficAllowed(policies, {
      sourceLabels: { app: 'hacker' }, sourceNamespace: 'default',
      destLabels: { app: 'api' }, destNamespace: 'default',
      port: 3000, protocol: 'TCP',
    }, { default: { name: 'default' } });
    assert(!blocked, 'Trafic non-autorise doit etre bloque');
  });

  await test('Ex5 — Policy autorise trafic conforme', () => {
    const policies: NetworkPolicyRule[] = [{
      direction: 'ingress',
      podSelector: { app: 'api' },
      from: [{ podSelector: { app: 'web' } }],
      ports: [{ protocol: 'TCP', port: 3000 }],
    }];
    const allowed = isTrafficAllowed(policies, {
      sourceLabels: { app: 'web' }, sourceNamespace: 'default',
      destLabels: { app: 'api' }, destNamespace: 'default',
      port: 3000, protocol: 'TCP',
    }, { default: { name: 'default' } });
    assert(allowed, 'Trafic conforme doit etre autorise');
  });

  await test('Ex6 — Drain autorise si PDB respecte', () => {
    const pods: RunningPod[] = [
      { name: 'api-1', labels: { app: 'api' }, nodeName: 'node-1', ready: true },
      { name: 'api-2', labels: { app: 'api' }, nodeName: 'node-2', ready: true },
      { name: 'api-3', labels: { app: 'api' }, nodeName: 'node-2', ready: true },
    ];
    const pdbs: PodDisruptionBudget[] = [{ selector: { app: 'api' }, minAvailable: 2 }];
    const result = checkDrain('node-1', pods, pdbs);
    assertEqual(result.allowed, true);
    assertDeepEqual(result.evictablePods, ['api-1']);
  });

  await test('Ex6 — Drain bloque si PDB viole', () => {
    const pods: RunningPod[] = [
      { name: 'api-1', labels: { app: 'api' }, nodeName: 'node-1', ready: true },
      { name: 'api-2', labels: { app: 'api' }, nodeName: 'node-1', ready: true },
      { name: 'api-3', labels: { app: 'api' }, nodeName: 'node-2', ready: true },
    ];
    const pdbs: PodDisruptionBudget[] = [{ selector: { app: 'api' }, minAvailable: 2 }];
    const result = checkDrain('node-1', pods, pdbs);
    assertEqual(result.allowed, false);
  });

  await test('Ex6 — MaxUnavailable PDB', () => {
    const pods: RunningPod[] = [
      { name: 'api-1', labels: { app: 'api' }, nodeName: 'node-1', ready: true },
      { name: 'api-2', labels: { app: 'api' }, nodeName: 'node-2', ready: true },
      { name: 'api-3', labels: { app: 'api' }, nodeName: 'node-2', ready: true },
    ];
    const pdbs: PodDisruptionBudget[] = [{ selector: { app: 'api' }, maxUnavailable: 1 }];
    const result = checkDrain('node-1', pods, pdbs);
    assertEqual(result.allowed, true);
  });

  summary();
}

main();
