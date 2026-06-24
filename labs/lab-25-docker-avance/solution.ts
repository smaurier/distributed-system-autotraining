// =============================================================================
// Lab 25 — Docker en profondeur (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertIncludes, summary } = createTestRunner('Lab 25 — Docker en profondeur');

// =============================================================================
// Exercice 1 : Dockerfile Analyzer
// =============================================================================

interface DockerInstruction {
  instruction: string;
  args: string;
}

type DockerIssue = 'NO_ALPINE' | 'ROOT_USER' | 'NO_HEALTHCHECK' | 'COPY_ALL_BEFORE_INSTALL' | 'DEV_DEPS_IN_PROD';

function analyzeDockerfile(instructions: DockerInstruction[]): DockerIssue[] {
  const issues: DockerIssue[] = [];

  const fromInstr = instructions.find(i => i.instruction === 'FROM');
  if (fromInstr && !fromInstr.args.includes('alpine') && !fromInstr.args.includes('slim')) {
    issues.push('NO_ALPINE');
  }

  if (!instructions.some(i => i.instruction === 'USER')) {
    issues.push('ROOT_USER');
  }

  if (!instructions.some(i => i.instruction === 'HEALTHCHECK')) {
    issues.push('NO_HEALTHCHECK');
  }

  const copyAllIdx = instructions.findIndex(i => i.instruction === 'COPY' && i.args.trim() === '. .');
  const installIdx = instructions.findIndex(i =>
    i.instruction === 'RUN' && /npm install|npm ci|yarn install|pnpm install/.test(i.args)
  );
  if (copyAllIdx !== -1 && installIdx !== -1 && copyAllIdx < installIdx) {
    issues.push('COPY_ALL_BEFORE_INSTALL');
  }

  const npmInstall = instructions.find(i =>
    i.instruction === 'RUN' && /npm install/.test(i.args)
  );
  if (npmInstall && !npmInstall.args.includes('--omit=dev') && !npmInstall.args.includes('--production')) {
    issues.push('DEV_DEPS_IN_PROD');
  }

  return issues;
}

// =============================================================================
// Exercice 2 : Layer Cache Simulator
// =============================================================================

interface LayerResult {
  instruction: string;
  hash: string;
  cached: boolean;
}

interface BuildResult {
  layers: LayerResult[];
  totalLayers: number;
  cachedLayers: number;
  rebuiltLayers: number;
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function buildWithCache(instructions: string[], previousBuild?: BuildResult): BuildResult {
  const layers: LayerResult[] = [];
  let previousHash = '00000000';
  let cacheInvalidated = false;

  for (let i = 0; i < instructions.length; i++) {
    const hash = simpleHash(previousHash + ':' + instructions[i]);
    const wasCached = !cacheInvalidated && previousBuild !== undefined &&
      i < previousBuild.layers.length && previousBuild.layers[i].hash === hash;

    if (!wasCached) cacheInvalidated = true;

    layers.push({ instruction: instructions[i], hash, cached: wasCached });
    previousHash = hash;
  }

  const cachedLayers = layers.filter(l => l.cached).length;
  return {
    layers,
    totalLayers: layers.length,
    cachedLayers,
    rebuiltLayers: layers.length - cachedLayers,
  };
}

// =============================================================================
// Exercice 3 : Network Resolver
// =============================================================================

interface DockerService {
  name: string;
  ip: string;
  port: number;
  networks: string[];
}

interface DockerNetwork {
  services: DockerService[];
}

function createDockerNetwork(services: DockerService[]): DockerNetwork {
  return { services };
}

function resolveService(network: DockerNetwork, serviceName: string, fromNetwork: string): string | null {
  const service = network.services.find(s => s.name === serviceName && s.networks.includes(fromNetwork));
  return service ? service.ip : null;
}

function canCommunicate(network: DockerNetwork, fromService: string, toService: string): boolean {
  const from = network.services.find(s => s.name === fromService);
  const to = network.services.find(s => s.name === toService);
  if (!from || !to) return false;
  return from.networks.some(n => to.networks.includes(n));
}

// =============================================================================
// Exercice 4 : Health Check Engine
// =============================================================================

interface HealthCheckConfig {
  interval: number;
  timeout: number;
  retries: number;
  startPeriod: number;
}

interface ContainerHealth {
  status: 'starting' | 'healthy' | 'unhealthy';
  failCount: number;
  successCount: number;
  lastCheck: number | null;
}

function createContainerHealth(): ContainerHealth {
  return { status: 'starting', failCount: 0, successCount: 0, lastCheck: null };
}

function processHealthCheck(
  health: ContainerHealth,
  checkResult: boolean,
  config: HealthCheckConfig,
  elapsedSinceStart: number
): ContainerHealth {
  const inStartPeriod = elapsedSinceStart < config.startPeriod;

  if (checkResult) {
    return {
      status: inStartPeriod ? 'starting' : 'healthy',
      failCount: 0,
      successCount: health.successCount + 1,
      lastCheck: Date.now(),
    };
  }

  const newFailCount = health.failCount + 1;
  let newStatus: ContainerHealth['status'];

  if (inStartPeriod) {
    newStatus = 'starting';
  } else if (newFailCount >= config.retries) {
    newStatus = 'unhealthy';
  } else {
    newStatus = health.status === 'starting' ? 'starting' : health.status;
  }

  return {
    status: newStatus,
    failCount: newFailCount,
    successCount: 0,
    lastCheck: Date.now(),
  };
}

// =============================================================================
// Exercice 5 : Security Auditor
// =============================================================================

interface ComposeService {
  name: string;
  image: string;
  privileged?: boolean;
  networkMode?: string;
  readOnly?: boolean;
  env?: Record<string, string>;
  ports?: { host: number; container: number }[];
}

interface SecurityFinding {
  service: string;
  issue: string;
  severity: 'critical' | 'high' | 'medium';
}

function auditComposeSecurity(services: ComposeService[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const svc of services) {
    if (svc.privileged) {
      findings.push({ service: svc.name, issue: 'PRIVILEGED', severity: 'critical' });
    }
    if (svc.networkMode === 'host') {
      findings.push({ service: svc.name, issue: 'HOST_NETWORK', severity: 'critical' });
    }
    if (svc.env) {
      const sensitiveKeys = Object.keys(svc.env).filter(k =>
        /password|secret|token|key/i.test(k)
      );
      for (const key of sensitiveKeys) {
        if (!svc.env[key].startsWith('vault://')) {
          findings.push({ service: svc.name, issue: 'ENV_SECRET', severity: 'high' });
        }
      }
    }
    if (!svc.readOnly) {
      findings.push({ service: svc.name, issue: 'NO_READONLY_ROOT', severity: 'medium' });
    }
    if (svc.ports) {
      for (const p of svc.ports) {
        if (p.host > 1024 && p.container < 1024) {
          findings.push({ service: svc.name, issue: 'EXPOSED_PORT_RANGE', severity: 'medium' });
        }
      }
    }
  }

  return findings;
}

// =============================================================================
// Exercice 6 : Compose Dependency Resolver
// =============================================================================

interface ComposeDependency {
  name: string;
  dependsOn: string[];
}

function resolveStartOrder(services: ComposeDependency[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const svc of services) {
    if (!inDegree.has(svc.name)) inDegree.set(svc.name, 0);
    if (!adjacency.has(svc.name)) adjacency.set(svc.name, []);
    for (const dep of svc.dependsOn) {
      if (!adjacency.has(dep)) adjacency.set(dep, []);
      adjacency.get(dep)!.push(svc.name);
      inDegree.set(svc.name, (inDegree.get(svc.name) || 0) + 1);
      if (!inDegree.has(dep)) inDegree.set(dep, 0);
    }
  }

  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (result.length !== inDegree.size) {
    throw new Error('Circular dependency');
  }

  return result;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 25 — Docker en profondeur\n');

  await test('Ex1 — Detecte image non-alpine', () => {
    const issues = analyzeDockerfile([
      { instruction: 'FROM', args: 'node:20' },
      { instruction: 'WORKDIR', args: '/app' },
      { instruction: 'COPY', args: '. .' },
      { instruction: 'RUN', args: 'npm install' },
      { instruction: 'CMD', args: 'node index.js' },
    ]);
    assert(issues.includes('NO_ALPINE'), 'Doit detecter NO_ALPINE');
    assert(issues.includes('ROOT_USER'), 'Doit detecter ROOT_USER');
    assert(issues.includes('NO_HEALTHCHECK'), 'Doit detecter NO_HEALTHCHECK');
    assert(issues.includes('DEV_DEPS_IN_PROD'), 'Doit detecter DEV_DEPS_IN_PROD');
  });

  await test('Ex1 — Detecte COPY . . avant install', () => {
    const issues = analyzeDockerfile([
      { instruction: 'FROM', args: 'node:20-alpine' },
      { instruction: 'COPY', args: '. .' },
      { instruction: 'RUN', args: 'npm ci --omit=dev' },
      { instruction: 'USER', args: 'node' },
      { instruction: 'HEALTHCHECK', args: 'CMD wget ...' },
      { instruction: 'CMD', args: 'node index.js' },
    ]);
    assert(issues.includes('COPY_ALL_BEFORE_INSTALL'), 'Doit detecter COPY_ALL_BEFORE_INSTALL');
    assert(!issues.includes('NO_ALPINE'), 'Ne doit PAS detecter NO_ALPINE');
    assert(!issues.includes('ROOT_USER'), 'Ne doit PAS detecter ROOT_USER');
  });

  await test('Ex1 — Dockerfile optimise = aucun probleme', () => {
    const issues = analyzeDockerfile([
      { instruction: 'FROM', args: 'node:20-alpine' },
      { instruction: 'WORKDIR', args: '/app' },
      { instruction: 'COPY', args: 'package*.json ./' },
      { instruction: 'RUN', args: 'npm ci --omit=dev' },
      { instruction: 'COPY', args: 'src/ ./src/' },
      { instruction: 'USER', args: 'appuser' },
      { instruction: 'HEALTHCHECK', args: 'CMD wget ...' },
      { instruction: 'CMD', args: 'node dist/main.js' },
    ]);
    assertEqual(issues.length, 0);
  });

  await test('Ex2 — Build sans cache precedent', () => {
    const result = buildWithCache(['FROM node:20-alpine', 'COPY . .', 'RUN npm ci']);
    assertEqual(result.totalLayers, 3);
    assertEqual(result.cachedLayers, 0);
    assertEqual(result.rebuiltLayers, 3);
    assert(result.layers.every(l => !l.cached), 'Toutes les layers doivent etre rebuilt');
  });

  await test('Ex2 — Build identique = tout cache', () => {
    const build1 = buildWithCache(['FROM node:20-alpine', 'COPY . .', 'RUN npm ci']);
    const build2 = buildWithCache(['FROM node:20-alpine', 'COPY . .', 'RUN npm ci'], build1);
    assertEqual(build2.cachedLayers, 3);
    assertEqual(build2.rebuiltLayers, 0);
  });

  await test('Ex2 — Changement au milieu invalide les suivantes', () => {
    const build1 = buildWithCache(['FROM node:20-alpine', 'COPY package.json .', 'RUN npm ci', 'COPY src/ .']);
    const build2 = buildWithCache(['FROM node:20-alpine', 'COPY package.json .', 'RUN npm ci', 'COPY dist/ .'], build1);
    assertEqual(build2.layers[0].cached, true);
    assertEqual(build2.layers[1].cached, true);
    assertEqual(build2.layers[2].cached, true);
    assertEqual(build2.layers[3].cached, false);
  });

  await test('Ex3 — Resolution DNS dans le meme reseau', () => {
    const net = createDockerNetwork([
      { name: 'api', ip: '172.18.0.2', port: 3000, networks: ['backend'] },
      { name: 'db', ip: '172.18.0.3', port: 5432, networks: ['backend'] },
    ]);
    assertEqual(resolveService(net, 'db', 'backend'), '172.18.0.3');
  });

  await test('Ex3 — Resolution echoue entre reseaux differents', () => {
    const net = createDockerNetwork([
      { name: 'api', ip: '172.18.0.2', port: 3000, networks: ['backend'] },
      { name: 'frontend', ip: '172.19.0.2', port: 80, networks: ['frontend'] },
    ]);
    assertEqual(resolveService(net, 'frontend', 'backend'), null);
  });

  await test('Ex3 — canCommunicate avec reseau partage', () => {
    const net = createDockerNetwork([
      { name: 'api', ip: '172.18.0.2', port: 3000, networks: ['backend', 'shared'] },
      { name: 'worker', ip: '172.18.0.4', port: 4000, networks: ['worker-net', 'shared'] },
    ]);
    assert(canCommunicate(net, 'api', 'worker'), 'Doivent pouvoir communiquer via shared');
    assertEqual(canCommunicate(net, 'api', 'unknown'), false);
  });

  await test('Ex4 — Status starting pendant le start period', () => {
    const config: HealthCheckConfig = { interval: 5000, timeout: 3000, retries: 3, startPeriod: 10000 };
    let health = createContainerHealth();
    health = processHealthCheck(health, true, config, 5000);
    assertEqual(health.status, 'starting');
  });

  await test('Ex4 — Passage a healthy apres le start period', () => {
    const config: HealthCheckConfig = { interval: 5000, timeout: 3000, retries: 3, startPeriod: 10000 };
    let health = createContainerHealth();
    health = processHealthCheck(health, true, config, 15000);
    assertEqual(health.status, 'healthy');
    assertEqual(health.failCount, 0);
    assertEqual(health.successCount, 1);
  });

  await test('Ex4 — Unhealthy apres retries echecs', () => {
    const config: HealthCheckConfig = { interval: 5000, timeout: 3000, retries: 3, startPeriod: 0 };
    let health = createContainerHealth();
    health = processHealthCheck(health, false, config, 5000);
    health = processHealthCheck(health, false, config, 10000);
    health = processHealthCheck(health, false, config, 15000);
    assertEqual(health.status, 'unhealthy');
    assertEqual(health.failCount, 3);
  });

  await test('Ex4 — Un succes reset le compteur', () => {
    const config: HealthCheckConfig = { interval: 5000, timeout: 3000, retries: 3, startPeriod: 0 };
    let health = createContainerHealth();
    health = processHealthCheck(health, false, config, 5000);
    health = processHealthCheck(health, false, config, 10000);
    assertEqual(health.failCount, 2);
    health = processHealthCheck(health, true, config, 15000);
    assertEqual(health.status, 'healthy');
    assertEqual(health.failCount, 0);
  });

  await test('Ex5 — Detecte privileged et env secrets', () => {
    const findings = auditComposeSecurity([
      {
        name: 'api',
        image: 'node:20',
        privileged: true,
        env: { DB_PASSWORD: 'postgres123', NODE_ENV: 'production' },
        ports: [{ host: 3000, container: 3000 }],
      },
    ]);
    assert(findings.some(f => f.issue === 'PRIVILEGED' && f.severity === 'critical'), 'Doit detecter PRIVILEGED');
    assert(findings.some(f => f.issue === 'ENV_SECRET' && f.severity === 'high'), 'Doit detecter ENV_SECRET');
  });

  await test('Ex5 — Service securise = pas de findings critiques', () => {
    const findings = auditComposeSecurity([
      {
        name: 'api',
        image: 'node:20-alpine',
        readOnly: true,
        env: { NODE_ENV: 'production', DB_HOST: 'db' },
        ports: [{ host: 3000, container: 3000 }],
      },
    ]);
    assert(!findings.some(f => f.severity === 'critical'), 'Pas de finding critique');
    assert(!findings.some(f => f.issue === 'ENV_SECRET'), 'Pas de secret en clair');
  });

  await test('Ex6 — Ordre simple', () => {
    const order = resolveStartOrder([
      { name: 'api', dependsOn: ['db', 'redis'] },
      { name: 'db', dependsOn: [] },
      { name: 'redis', dependsOn: [] },
    ]);
    const apiIdx = order.indexOf('api');
    const dbIdx = order.indexOf('db');
    const redisIdx = order.indexOf('redis');
    assert(dbIdx < apiIdx, 'db doit demarrer avant api');
    assert(redisIdx < apiIdx, 'redis doit demarrer avant api');
  });

  await test('Ex6 — Chaine de dependances', () => {
    const order = resolveStartOrder([
      { name: 'frontend', dependsOn: ['api'] },
      { name: 'api', dependsOn: ['db'] },
      { name: 'db', dependsOn: [] },
    ]);
    assertEqual(order[0], 'db');
    assertEqual(order[1], 'api');
    assertEqual(order[2], 'frontend');
  });

  await test('Ex6 — Detection de cycle', () => {
    let caught = false;
    try {
      resolveStartOrder([
        { name: 'a', dependsOn: ['b'] },
        { name: 'b', dependsOn: ['c'] },
        { name: 'c', dependsOn: ['a'] },
      ]);
    } catch (e) {
      if (e instanceof Error && e.message === 'Circular dependency') caught = true;
    }
    assert(caught, 'Doit lancer une erreur Circular dependency');
  });

  summary();
}

main();
