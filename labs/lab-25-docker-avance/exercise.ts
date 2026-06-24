// =============================================================================
// Lab 25 — Docker en profondeur (Exercice)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertIncludes, summary } = createTestRunner('Lab 25 — Docker en profondeur');

// =============================================================================
// Exercice 1 : Dockerfile Analyzer
// Analysez un Dockerfile (represente comme un tableau d'instructions) et
// detectez les problemes d'optimisation.
//
// Regles a verifier :
// - 'NO_ALPINE': l'image de base (FROM) ne contient pas 'alpine' ni 'slim'
// - 'ROOT_USER': aucune instruction USER n'est présente
// - 'NO_HEALTHCHECK': aucune instruction HEALTHCHECK n'est présente
// - 'COPY_ALL_BEFORE_INSTALL': un COPY . . apparait AVANT un RUN npm/yarn/pnpm install
// - 'DEV_DEPS_IN_PROD': RUN npm install sans --omit=dev ni --production
// =============================================================================

interface DockerInstruction {
  instruction: string;  // 'FROM' | 'COPY' | 'RUN' | 'USER' | 'HEALTHCHECK' | 'CMD' | 'EXPOSE' | 'WORKDIR'
  args: string;
}

type DockerIssue = 'NO_ALPINE' | 'ROOT_USER' | 'NO_HEALTHCHECK' | 'COPY_ALL_BEFORE_INSTALL' | 'DEV_DEPS_IN_PROD';

function analyzeDockerfile(instructions: DockerInstruction[]): DockerIssue[] {
  // TODO: Analyser les instructions et retourner la liste des problemes detectes
  // L'ordre des issues dans le tableau n'a pas d'importance
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Layer Cache Simulator
// Simulez le systeme de cache par couches de Docker.
//
// Chaque instruction genere un hash base sur son contenu + le hash precedent.
// Si une instruction change, toutes les couches suivantes sont invalidees.
//
// buildWithCache(instructions, previousBuild?) retourne un BuildResult:
//   - layers: tableau de { instruction, hash, cached: boolean }
//   - totalLayers, cachedLayers, rebuiltLayers
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
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function buildWithCache(instructions: string[], previousBuild?: BuildResult): BuildResult {
  // TODO: Generer les layers avec hash.
  // Hash de chaque layer = simpleHash(previousHash + ':' + instruction)
  // Pour la premiere layer, previousHash = '00000000'
  // Si previousBuild existe ET que le hash d'une layer correspond, elle est cached.
  // DES QU'UNE LAYER differe, toutes les suivantes sont rebuilt (cached = false).
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Network Resolver
// Simulez le DNS interne de Docker Compose.
//
// Dans un reseau Docker custom bridge, les services sont accessibles par
// leur nom de service. Implementez la resolution.
//
// Regles :
// - Chaque service a un nom, une ip, un port et un reseau
// - resolveService(serviceName, network) retourne l'ip si le service
//   est dans le meme reseau, sinon null
// - Les services dans des reseaux differents ne se voient pas
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
  // TODO: Trouver le service par son nom dans le reseau specifie.
  // Un service est trouvable seulement si fromNetwork est dans ses networks.
  // Retourner l'IP du service ou null.
  throw new Error('Not implemented');
}

function canCommunicate(network: DockerNetwork, fromService: string, toService: string): boolean {
  // TODO: Verifier que les deux services partagent au moins un reseau en commun.
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Health Check Engine
// Implementez la logique de health check Docker.
//
// Un conteneur a 3 etats possibles: 'starting', 'healthy', 'unhealthy'
// Le health check s'execute periodiquement.
// Apres 'retries' echecs consecutifs -> unhealthy
// Un seul succes -> healthy (reset du compteur d'echecs)
// =============================================================================

interface HealthCheckConfig {
  interval: number;      // ms entre les checks
  timeout: number;       // ms max pour un check
  retries: number;       // echecs avant unhealthy
  startPeriod: number;   // ms avant de commencer
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
  // TODO: Implementer la logique:
  // 1. Si elapsedSinceStart < config.startPeriod, le status reste 'starting'
  //    (mais compter quand meme le succes/echec)
  // 2. Si checkResult = true: reset failCount, incrementer successCount, status = 'healthy'
  // 3. Si checkResult = false: incrementer failCount, reset successCount
  //    Si failCount >= config.retries: status = 'unhealthy'
  //    Sinon garder le status precedent (sauf si 'starting' et startPeriod depasse -> 'unhealthy')
  // 4. Toujours mettre lastCheck = Date.now()
  // Retourner un NOUVEL objet (pas de mutation)
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Security Auditor
// Analysez une configuration Docker Compose et detectez les failles de securite.
//
// Failles a detecter :
// - 'PRIVILEGED': un service a privileged: true
// - 'HOST_NETWORK': un service utilise network_mode: host
// - 'ENV_SECRET': une variable d'environnement contient 'password', 'secret',
//   'token' ou 'key' dans son nom (case insensitive) avec une valeur en clair (pas de vault://)
// - 'NO_READONLY_ROOT': un service n'a pas read_only: true
// - 'EXPOSED_PORT_RANGE': un service expose un port > 1024 vers un port < 1024
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
  // TODO: Analyser chaque service et retourner les findings.
  // Severite:
  // - PRIVILEGED, HOST_NETWORK: critical
  // - ENV_SECRET: high
  // - NO_READONLY_ROOT, EXPOSED_PORT_RANGE: medium
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Compose Dependency Resolver
// Resolvez l'ordre de demarrage des services Docker Compose en respectant
// les depends_on.
//
// L'ordre doit etre un tri topologique : un service demarre apres ses
// dependances. Si un cycle est detecte, lancer une Error('Circular dependency').
// =============================================================================

interface ComposeDependency {
  name: string;
  dependsOn: string[];
}

function resolveStartOrder(services: ComposeDependency[]): string[] {
  // TODO: Retourner les noms de services dans l'ordre de demarrage.
  // Utiliser un tri topologique (algorithme de Kahn ou DFS).
  // Lancer une Error('Circular dependency') si un cycle est detecte.
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🧪 Lab 25 — Docker en profondeur\n');

  // --- Exercice 1 : Dockerfile Analyzer ---
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

  // --- Exercice 2 : Layer Cache ---
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
    assertEqual(build2.layers[3].cached, false);  // Change
  });

  // --- Exercice 3 : Network Resolver ---
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

  // --- Exercice 4 : Health Check ---
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

  // --- Exercice 5 : Security Auditor ---
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

  // --- Exercice 6 : Dependency Resolver ---
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
