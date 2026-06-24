// =============================================================================
// Lab 27 — Kubernetes en pratique (Exercice)
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
  scaleUpStabilization: number;   // nombre d'evaluations avant scale up
  scaleDownStabilization: number; // nombre d'evaluations avant scale down
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
  // TODO: Implementez la logique HPA
  // 1. Calculer desiredReplicas = ceil(currentReplicas * (currentCPU / targetCPU))
  // 2. Clamper entre minReplicas et maxReplicas
  // 3. Si desired > current: incrementer scaleUpCount, reset scaleDownCount
  //    Si scaleUpCount >= scaleUpStabilization: appliquer le scale
  // 4. Si desired < current: incrementer scaleDownCount, reset scaleUpCount
  //    Si scaleDownCount >= scaleDownStabilization: appliquer le scale
  // 5. Si desired == current: reset les deux compteurs
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Helm Values Merger
// =============================================================================

type HelmValues = Record<string, unknown>;

function deepMerge(base: HelmValues, override: HelmValues): HelmValues {
  // TODO: Merge profond
  // - Les objets sont merges recursivement
  // - Les tableaux sont remplaces (pas concatenes)
  // - Les valeurs primitives de override ecrasent celles de base
  // - Les cles absentes de override gardent la valeur de base
  throw new Error('Not implemented');
}

function resolveHelmValues(...valueFiles: HelmValues[]): HelmValues {
  // TODO: Merger tous les fichiers de values dans l'ordre (le dernier a priorite)
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Canary Deployment Controller
// =============================================================================

interface CanaryConfig {
  steps: number[];           // pourcentages de trafic: [10, 50, 100]
  errorThreshold: number;    // taux d'erreur max (ex: 0.05 = 5%)
  evaluationPeriod: number;  // nombre de requetes a evaluer par step
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
  // TODO:
  // 1. Ajouter les resultats au compteur
  // 2. Si total requetes >= evaluationPeriod:
  //    - Calculer le taux d'erreur
  //    - Si >= errorThreshold -> rollback (status = 'rolled-back', trafficPercent = 0)
  //    - Sinon -> passer au step suivant
  //    - Reset des compteurs
  // 3. Si on depasse le dernier step -> status = 'completed'
  throw new Error('Not implemented');
}

function routeCanaryRequest(state: CanaryState): 'canary' | 'stable' {
  // TODO: Retourner 'canary' si un nombre aleatoire (0-100) < trafficPercent, sinon 'stable'
  // Pour le determinisme des tests, utiliser: Math.random() * 100 < trafficPercent
  throw new Error('Not implemented');
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
  // TODO: Analysez le status et retournez les diagnostics:
  // - CrashLoopBackOff -> critical: "Container crashing repeatedly, check logs"
  // - ImagePullBackOff / ErrImagePull -> critical: "Image not found or registry auth failed"
  // - OOMKilled (terminated.reason) -> critical: "Container killed due to memory limit, increase memory limits"
  // - restartCount > 5 -> warning: "High restart count"
  // - Pending + condition PodScheduled=False -> warning: "No node with enough resources"
  // - Running + container not ready -> info: "Container not ready, check readiness probe"
  throw new Error('Not implemented');
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

function isTrafficAllowed(policies: NetworkPolicyRule[], traffic: TrafficRequest, namespaceLabels: Record<string, Record<string, string>>): boolean {
  // TODO:
  // 1. Trouver les policies qui s'appliquent au pod destination (ingress) via podSelector
  // 2. Si aucune policy ne s'applique -> trafic autorise (default allow)
  // 3. Si une policy s'applique, verifier les regles from/ports
  //    - from: au moins un from doit matcher (podSelector OU namespaceSelector)
  //    - ports: si definis, le port et protocole doivent matcher
  // 4. Si au moins une policy autorise le trafic -> autorise
  throw new Error('Not implemented');
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
  // TODO:
  // 1. Lister les pods sur le node a drainer
  // 2. Pour chaque PDB, compter les pods matchant le selector
  // 3. Calculer combien de pods on peut evicter sans violer le PDB:
  //    - minAvailable: on peut evicter si (total ready matching - pods sur ce node) >= minAvailable
  //    - maxUnavailable: on peut evicter si (pods non-ready + pods sur ce node) <= maxUnavailable
  // 4. Retourner allowed=true si tous les PDBs sont respectes
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 27 — Kubernetes en pratique\n');

  // --- Ex1 : HPA ---
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
    assertEqual(state.currentReplicas, 5); // pas encore, stabilisation
    state = evaluateHPA(state, spec, 20);
    assertEqual(state.currentReplicas, 5); // toujours pas
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

  // --- Ex2 : Helm Values ---
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

  // --- Ex3 : Canary ---
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

  // --- Ex4 : Troubleshooter ---
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

  // --- Ex5 : Network Policy ---
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

  // --- Ex6 : PDB ---
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
