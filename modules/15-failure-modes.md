# 15 — Failure Modes & Fault Tolerance

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 90 min        | [Lab 15](../labs/lab-15-failure-modes/) | [Quiz 15](../quizzes/quiz-15-failure-modes.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Classifier les differents types de pannes dans un systeme distribue (partielle, en cascade, grise)
- Expliquer pourquoi les pannes partielles sont le defi fondamental des systemes distribues
- Identifier et prevenir les pannes en cascade avec des strategies d'isolation
- Diagnostiquer les pannes grises (gray failures) et comprendre pourquoi elles sont les plus insidieuses
- Implementer le principe fail-fast pour detecter les erreurs au plus tot
- Calculer et reduire le blast radius d'une panne
- Implementer un mecanisme de detection de pannes par heartbeat
- Concevoir des systemes qui tolerent les pannes plutot que de les eviter

---

## Introduction : les pannes sont inevitables

:::tip Principe fondamental
Dans un systeme distribue, la question n'est pas **si** une panne va se produire, mais **quand**. Un systeme bien concu ne cherche pas a eviter toutes les pannes — il les **tolere** et **limite leur impact**.
:::

A l'echelle d'un datacenter avec des milliers de machines :
- Des disques tombent en panne chaque jour
- Des processus crashent chaque heure
- Des paquets reseau sont perdus chaque seconde

```
┌─────────────────────────────────────────────────────────────────┐
│              SPECTRE DES PANNES DISTRIBUEES                      │
│                                                                 │
│  Facile a detecter ◄──────────────────────► Difficile           │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────┐ │
│  │  Crash   │  │  Omission    │  │  Timing   │  │  Byzantine│ │
│  │  total   │  │  (perte msg) │  │  (lenteur)│  │  (malice) │ │
│  └──────────┘  └──────────────┘  └───────────┘  └───────────┘ │
│                                                                 │
│  Cout de tolerance : bas ──────────────────────► tres eleve     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Types de pannes dans les systemes distribues

### Classification formelle

```typescript
// Taxonomie des pannes
enum FailureType {
  CRASH = 'crash',           // Le noeud s'arrete completement
  OMISSION = 'omission',     // Le noeud oublie d'envoyer/recevoir des messages
  TIMING = 'timing',         // Le noeud repond trop tard
  BYZANTINE = 'byzantine',   // Le noeud se comporte de maniere arbitraire
}

interface Failure {
  type: FailureType;
  nodeId: string;
  timestamp: number;
  description: string;
  detectable: boolean;
  impact: 'low' | 'medium' | 'high' | 'critical';
}

// Exemples concrets
const realWorldFailures: Failure[] = [
  {
    type: FailureType.CRASH,
    nodeId: 'payment-service-03',
    timestamp: Date.now(),
    description: 'OOM kill par le kernel Linux',
    detectable: true,
    impact: 'high',
  },
  {
    type: FailureType.OMISSION,
    nodeId: 'message-broker-01',
    timestamp: Date.now(),
    description: 'Paquets UDP perdus sous forte charge',
    detectable: false,
    impact: 'medium',
  },
  {
    type: FailureType.TIMING,
    nodeId: 'database-replica-02',
    timestamp: Date.now(),
    description: 'GC pause de 30s sur la JVM',
    detectable: false,
    impact: 'critical',
  },
];
```

---

## Pannes partielles : le defi fondamental

:::warning Le piege
Dans un monolithe, soit tout fonctionne, soit rien ne fonctionne. Dans un systeme distribue, **une partie** peut tomber en panne pendant que le reste continue. C'est la source de la plupart des bugs subtils.
:::

```
┌────────────────────────────────────────────────────────────┐
│                    PANNE PARTIELLE                          │
│                                                            │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐             │
│  │ Service │ ──► │ Service │ ──► │ Service │             │
│  │    A    │     │    B    │     │    C    │             │
│  │   ✅    │     │   ❌    │     │   ✅    │             │
│  └─────────┘     └─────────┘     └─────────┘             │
│                                                            │
│  A fonctionne, C fonctionne, mais B est en panne.         │
│  A a envoye un message a B... B l'a-t-il recu ?           │
│  B a-t-il traite le message avant de tomber ?              │
│  C ne sait pas que B est en panne.                         │
│                                                            │
│  → INCERTITUDE = le probleme fondamental                   │
└────────────────────────────────────────────────────────────┘
```

```typescript
// Simulation d'une panne partielle
interface ServiceNode {
  id: string;
  healthy: boolean;
  process: (request: string) => Promise<string>;
}

class DistributedSystem {
  private nodes: Map<string, ServiceNode> = new Map();

  addNode(node: ServiceNode): void {
    this.nodes.set(node.id, node);
  }

  async processRequest(path: string[]): Promise<string> {
    let result = 'initial';

    for (const nodeId of path) {
      const node = this.nodes.get(nodeId);
      if (!node) {
        throw new Error(`Noeud inconnu : ${nodeId}`);
      }

      try {
        // Timeout pour detecter les noeuds lents ou morts
        result = await Promise.race([
          node.process(result),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${nodeId}`)), 5000)
          ),
        ]);
      } catch (error) {
        // PANNE PARTIELLE : ce noeud a echoue
        // Que faire ? Reessayer ? Sauter ? Annuler tout ?
        console.error(`Panne partielle sur ${nodeId}:`, error);

        // Option 1 : propager l'erreur (fail-fast)
        throw new Error(
          `Echec de la chaine au noeud ${nodeId}: ${(error as Error).message}`
        );

        // Option 2 : degradation gracieuse (si possible)
        // result = getDefaultResponse(nodeId);
      }
    }

    return result;
  }
}
```

---

## Pannes en cascade : la reaction en chaine

Une panne en cascade se produit quand la defaillance d'un composant surcharge les autres, provoquant une chaine de pannes.

```
┌──────────────────────────────────────────────────────────────┐
│              ANATOMIE D'UNE PANNE EN CASCADE                  │
│                                                              │
│  t=0   [A] [B] [C] [D] [E]     5 instances, charge = 20%   │
│                                                              │
│  t=1   [A] [B] [C] [D] [💀]    E tombe, charge redistribuee│
│                                 charge par noeud = 25%       │
│                                                              │
│  t=2   [A] [B] [C] [💀] [💀]   D surcharge et tombe aussi  │
│                                 charge par noeud = 33%       │
│                                                              │
│  t=3   [A] [B] [💀] [💀] [💀]  C surcharge...               │
│                                 charge par noeud = 50%       │
│                                                              │
│  t=4   [A] [💀] [💀] [💀] [💀] Effondrement total imminent  │
│                                 charge par noeud = 100%      │
│                                                              │
│  t=5   [💀] [💀] [💀] [💀] [💀] PANNE TOTALE                │
└──────────────────────────────────────────────────────────────┘
```

### Simulation d'une panne en cascade

```typescript
interface CascadeNode {
  id: string;
  maxCapacity: number;
  currentLoad: number;
  healthy: boolean;
}

class CascadeSimulator {
  private nodes: CascadeNode[] = [];
  private timeline: Array<{ time: number; event: string; alive: number }> = [];

  constructor(nodeCount: number, capacityPerNode: number) {
    for (let i = 0; i < nodeCount; i++) {
      this.nodes.push({
        id: `node-${i}`,
        maxCapacity: capacityPerNode,
        currentLoad: 0,
        healthy: true,
      });
    }
  }

  distributeLoad(totalLoad: number): void {
    const aliveNodes = this.nodes.filter((n) => n.healthy);
    if (aliveNodes.length === 0) {
      this.timeline.push({
        time: this.timeline.length,
        event: 'PANNE TOTALE — plus aucun noeud vivant',
        alive: 0,
      });
      return;
    }

    const loadPerNode = totalLoad / aliveNodes.length;
    for (const node of aliveNodes) {
      node.currentLoad = loadPerNode;
    }
  }

  simulateCascade(totalLoad: number): typeof this.timeline {
    this.distributeLoad(totalLoad);
    let tick = 0;

    while (true) {
      const aliveNodes = this.nodes.filter((n) => n.healthy);
      if (aliveNodes.length === 0) break;

      // Verifier quels noeuds sont surcharges
      const overloaded = aliveNodes.filter(
        (n) => n.currentLoad > n.maxCapacity
      );

      if (overloaded.length === 0) {
        this.timeline.push({
          time: tick,
          event: `Stable — ${aliveNodes.length} noeuds, charge=${
            aliveNodes[0]?.currentLoad.toFixed(0) ?? 0
          } chacun`,
          alive: aliveNodes.length,
        });
        break;
      }

      // Les noeuds surcharges tombent
      for (const node of overloaded) {
        node.healthy = false;
        this.timeline.push({
          time: tick,
          event: `${node.id} TOMBE (charge ${node.currentLoad.toFixed(
            0
          )} > capacite ${node.maxCapacity})`,
          alive: this.nodes.filter((n) => n.healthy).length,
        });
      }

      // Redistribuer la charge sur les survivants
      this.distributeLoad(totalLoad);
      tick++;
    }

    return this.timeline;
  }
}

// Demonstration
const sim = new CascadeSimulator(5, 250);
const events = sim.simulateCascade(1000);
// Avec 5 noeuds a 250 de capacite, charge totale 1000 :
// → 200 par noeud, stable.
// Mais si un noeud tombe (charge initiale 200, un noeud meurt) :
// → 250 par noeud, limite.
// Un deuxieme tombe → 333 par noeud → cascade !
```

:::warning Causes frequentes de pannes en cascade
- **Retry storms** : un service en panne recoit des milliers de retries
- **Connection pool exhaustion** : les connexions vers un service lent bloquent toutes les autres
- **Memory pressure** : les requetes en attente consomment de la memoire
- **Thread starvation** : les threads bloques par un service lent ne sont plus disponibles
:::

---

## Gray failures : les pannes fantomes

Les gray failures sont les plus dangereuses car le systeme semble fonctionner mais se comporte de maniere degradee ou incorrecte de facon intermittente.

```
┌──────────────────────────────────────────────────────────────┐
│                   GRAY FAILURE                                │
│                                                              │
│  Health check :  "Je suis vivant !" ✅                       │
│  Realite :                                                   │
│    - 5% des requetes echouent                                │
│    - P99 latence = 30s (au lieu de 200ms)                    │
│    - Reponses parfois corrompues                             │
│    - Le noeud pense qu'il va bien                            │
│                                                              │
│  ┌─────────────────────────────────────────────┐             │
│  │  Observateur A (health check) :  ✅ OK      │             │
│  │  Observateur B (requetes)     :  ❌ LENT    │             │
│  │  Observateur C (donnees)      :  ⚠️  CORROMPU│             │
│  │  Le noeud lui-meme            :  ✅ OK      │             │
│  └─────────────────────────────────────────────┘             │
│                                                              │
│  Differential observability : chaque observateur voit        │
│  un etat different du systeme.                               │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Exemples de gray failures
class GrayFailureExamples {
  // Exemple 1 : Latence intermittente (GC pause, disk I/O)
  async handleRequest(data: string): Promise<string> {
    // 95% du temps : < 10ms
    // 5% du temps : > 5 secondes (GC pause)
    if (Math.random() < 0.05) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return `processed: ${data}`;
  }

  // Exemple 2 : Corruption silencieuse (bit flip, bug logique)
  calculateTotal(items: number[]): number {
    let total = 0;
    for (const item of items) {
      total += item;
      // Bug subtil : overflow silencieux dans certains cas
      // Le resultat est "presque" correct mais pas exact
    }
    return total;
  }

  // Exemple 3 : Partial network failure
  // Le noeud peut parler a A mais pas a B
  // Du point de vue de A : le noeud est sain
  // Du point de vue de B : le noeud est mort
}

// Detection de gray failure avec observation multi-sources
interface HealthObservation {
  observerId: string;
  targetId: string;
  timestamp: number;
  latencyMs: number;
  success: boolean;
  errorRate: number;
}

class GrayFailureDetector {
  private observations: Map<string, HealthObservation[]> = new Map();
  private readonly windowMs = 60_000; // fenetre d'1 minute
  private readonly errorThreshold = 0.05; // 5% d'erreurs
  private readonly latencyThresholdMs = 2000; // P99 > 2s

  addObservation(obs: HealthObservation): void {
    const key = obs.targetId;
    if (!this.observations.has(key)) {
      this.observations.set(key, []);
    }
    this.observations.get(key)!.push(obs);
    this.pruneOld(key);
  }

  isGrayFailure(targetId: string): {
    detected: boolean;
    reasons: string[];
  } {
    const obs = this.observations.get(targetId) || [];
    const reasons: string[] = [];

    if (obs.length < 10) {
      return { detected: false, reasons: ['Pas assez de donnees'] };
    }

    // Verifier le taux d'erreur
    const errorRate = obs.filter((o) => !o.success).length / obs.length;
    if (errorRate > this.errorThreshold) {
      reasons.push(`Taux d'erreur eleve: ${(errorRate * 100).toFixed(1)}%`);
    }

    // Verifier la latence P99
    const latencies = obs.map((o) => o.latencyMs).sort((a, b) => a - b);
    const p99Index = Math.floor(latencies.length * 0.99);
    const p99 = latencies[p99Index];
    if (p99 > this.latencyThresholdMs) {
      reasons.push(`P99 latence elevee: ${p99}ms`);
    }

    // Verifier les divergences entre observateurs
    const byObserver = new Map<string, boolean[]>();
    for (const o of obs) {
      if (!byObserver.has(o.observerId)) {
        byObserver.set(o.observerId, []);
      }
      byObserver.get(o.observerId)!.push(o.success);
    }

    const observerRates = [...byObserver.entries()].map(([id, results]) => ({
      id,
      rate: results.filter((r) => r).length / results.length,
    }));

    if (observerRates.length >= 2) {
      const rates = observerRates.map((o) => o.rate);
      const maxDiff = Math.max(...rates) - Math.min(...rates);
      if (maxDiff > 0.2) {
        reasons.push(
          `Observabilite differentielle: ecart de ${(maxDiff * 100).toFixed(
            1
          )}% entre observateurs`
        );
      }
    }

    return { detected: reasons.length > 0, reasons };
  }

  private pruneOld(targetId: string): void {
    const now = Date.now();
    const obs = this.observations.get(targetId) || [];
    this.observations.set(
      targetId,
      obs.filter((o) => now - o.timestamp < this.windowMs)
    );
  }
}
```

---

## Fail-fast : detecter tot, echouer vite

:::tip Principe fail-fast
Un systeme fail-fast detecte les erreurs le plus tot possible et signale immediatement l'echec plutot que de tenter de continuer dans un etat incertain. Cela evite de gaspiller des ressources et de propager des erreurs.
:::

```
┌──────────────────────────────────────────────────────────────┐
│         FAIL-FAST vs FAIL-SLOW                                │
│                                                              │
│  Fail-slow (mauvais) :                                       │
│  Requete → tentative → attente → timeout → retry →           │
│  attente → timeout → retry → attente → erreur (30s perdu)   │
│                                                              │
│  Fail-fast (bon) :                                           │
│  Requete → verification prealable → ERREUR immediate (5ms)  │
│                                                              │
│  Gain : 30 secondes de ressources economisees                │
│  Benefice : le client peut reagir immediatement              │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Implementation fail-fast avec validations prealables
class FailFastService {
  private circuitOpen = false;
  private dependencyHealthy = true;
  private lastHealthCheck = 0;
  private readonly healthCheckIntervalMs = 5000;

  async handleRequest(request: {
    userId: string;
    amount: number;
    currency: string;
  }): Promise<{ success: boolean; data?: unknown; error?: string }> {
    // 1. Fail-fast : validation des entrees
    if (!request.userId || request.userId.trim() === '') {
      return { success: false, error: 'userId est requis' };
    }
    if (request.amount <= 0) {
      return { success: false, error: 'amount doit etre positif' };
    }
    if (!['EUR', 'USD', 'GBP'].includes(request.currency)) {
      return { success: false, error: `Devise non supportee: ${request.currency}` };
    }

    // 2. Fail-fast : verifier l'etat du circuit breaker
    if (this.circuitOpen) {
      return { success: false, error: 'Service temporairement indisponible (circuit ouvert)' };
    }

    // 3. Fail-fast : verifier la sante des dependances
    if (!this.dependencyHealthy) {
      return { success: false, error: 'Dependance critique indisponible' };
    }

    // 4. Fail-fast : verifier les ressources systeme
    const memUsage = process.memoryUsage();
    const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;
    if (heapUsedPercent > 0.9) {
      return { success: false, error: 'Memoire insuffisante (>90% utilisee)' };
    }

    // 5. Si toutes les verifications passent, traiter la requete
    try {
      const result = await this.processPayment(request);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // Preconditions check a l'initialisation du service
  static assertPreconditions(): void {
    const requiredEnvVars = ['DATABASE_URL', 'API_KEY', 'SERVICE_NAME'];
    const missing = requiredEnvVars.filter((v) => !process.env[v]);

    if (missing.length > 0) {
      // FAIL FAST au demarrage : ne pas lancer un service mal configure
      throw new Error(
        `Variables d'environnement manquantes : ${missing.join(', ')}. ` +
        `Le service refuse de demarrer dans un etat invalide.`
      );
    }
  }

  private async processPayment(
    _request: unknown
  ): Promise<{ transactionId: string }> {
    return { transactionId: `tx-${Date.now()}` };
  }
}
```

---

## Blast radius : contenir l'impact

Le **blast radius** est la zone d'impact d'une panne. L'objectif est de minimiser cette zone pour qu'une panne dans un composant n'affecte pas l'ensemble du systeme.

```
┌──────────────────────────────────────────────────────────────┐
│         BLAST RADIUS — AVANT vs APRES ISOLATION              │
│                                                              │
│  AVANT (monolithe, pas d'isolation) :                        │
│  ┌──────────────────────────────────┐                        │
│  │  💥 Un bug dans le paiement      │                        │
│  │  → tout le site est en panne    │                        │
│  │  Blast radius = 100%            │                        │
│  └──────────────────────────────────┘                        │
│                                                              │
│  APRES (cell-based architecture) :                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │
│  │ Cell 1 │ │ Cell 2 │ │ Cell 3 │ │ Cell 4 │               │
│  │  💥    │ │   ✅   │ │   ✅   │ │   ✅   │               │
│  │ 25%    │ │ 25%    │ │ 25%    │ │ 25%    │               │
│  └────────┘ └────────┘ └────────┘ └────────┘               │
│  Blast radius = 25%                                          │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Architecture cell-based pour limiter le blast radius
interface Cell {
  id: string;
  region: string;
  userRange: [number, number]; // hash range des utilisateurs
  healthy: boolean;
  services: Map<string, ServiceInstance>;
}

interface ServiceInstance {
  name: string;
  url: string;
  healthy: boolean;
}

class CellBasedArchitecture {
  private cells: Cell[] = [];

  constructor(cellCount: number) {
    const rangeSize = Math.floor(1000 / cellCount);
    for (let i = 0; i < cellCount; i++) {
      this.cells.push({
        id: `cell-${i}`,
        region: ['eu-west', 'eu-east', 'us-west', 'us-east'][i % 4],
        userRange: [i * rangeSize, (i + 1) * rangeSize - 1],
        healthy: true,
        services: new Map([
          ['api', { name: 'api', url: `http://cell-${i}-api:3000`, healthy: true }],
          ['db', { name: 'db', url: `http://cell-${i}-db:5432`, healthy: true }],
          ['cache', { name: 'cache', url: `http://cell-${i}-cache:6379`, healthy: true }],
        ]),
      });
    }
  }

  // Router un utilisateur vers sa cellule
  routeUser(userId: string): Cell | null {
    const hash = this.simpleHash(userId) % 1000;
    return this.cells.find(
      (c) => c.healthy && hash >= c.userRange[0] && hash <= c.userRange[1]
    ) || null;
  }

  // Simuler une panne dans une cellule
  failCell(cellId: string): { blastRadius: number; affectedUsers: string } {
    const cell = this.cells.find((c) => c.id === cellId);
    if (!cell) return { blastRadius: 0, affectedUsers: 'aucun' };

    cell.healthy = false;
    const totalCells = this.cells.length;
    const blastRadius = (1 / totalCells) * 100;
    const range = `utilisateurs avec hash ${cell.userRange[0]}-${cell.userRange[1]}`;

    return {
      blastRadius,
      affectedUsers: range,
    };
  }

  getBlastRadiusReport(): string[] {
    const totalCells = this.cells.length;
    const failedCells = this.cells.filter((c) => !c.healthy).length;
    const blastRadius = ((failedCells / totalCells) * 100).toFixed(1);

    return [
      `Cellules totales: ${totalCells}`,
      `Cellules en panne: ${failedCells}`,
      `Blast radius actuel: ${blastRadius}%`,
      `Cellules saines: ${this.cells.filter((c) => c.healthy).map((c) => c.id).join(', ')}`,
    ];
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash;
  }
}
```

---

## Detection de pannes : heartbeat et phi accrual

### Heartbeat simple

```typescript
interface HeartbeatConfig {
  intervalMs: number;       // Frequence d'envoi des heartbeats
  timeoutMs: number;        // Delai avant de declarer un noeud mort
  maxMissedBeats: number;   // Nombre de heartbeats manques toleres
}

interface NodeState {
  id: string;
  lastHeartbeat: number;
  missedBeats: number;
  status: 'alive' | 'suspect' | 'dead';
  metadata: Record<string, unknown>;
}

class HeartbeatFailureDetector {
  private nodes: Map<string, NodeState> = new Map();
  private config: HeartbeatConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: HeartbeatConfig) {
    this.config = config;
  }

  registerNode(nodeId: string, metadata: Record<string, unknown> = {}): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      lastHeartbeat: Date.now(),
      missedBeats: 0,
      status: 'alive',
      metadata,
    });
  }

  receiveHeartbeat(nodeId: string, metadata?: Record<string, unknown>): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      // Noeud inconnu — l'enregistrer automatiquement
      this.registerNode(nodeId, metadata);
      return;
    }

    node.lastHeartbeat = Date.now();
    node.missedBeats = 0;
    node.status = 'alive';
    if (metadata) {
      node.metadata = { ...node.metadata, ...metadata };
    }
  }

  startMonitoring(
    onSuspect: (nodeId: string) => void,
    onDead: (nodeId: string) => void
  ): void {
    this.checkInterval = setInterval(() => {
      const now = Date.now();

      for (const [nodeId, node] of this.nodes) {
        const elapsed = now - node.lastHeartbeat;

        if (elapsed > this.config.intervalMs) {
          node.missedBeats = Math.floor(elapsed / this.config.intervalMs);
        }

        if (
          node.status === 'alive' &&
          node.missedBeats >= 1
        ) {
          node.status = 'suspect';
          onSuspect(nodeId);
        }

        if (
          node.status !== 'dead' &&
          node.missedBeats >= this.config.maxMissedBeats
        ) {
          node.status = 'dead';
          onDead(nodeId);
        }
      }
    }, this.config.intervalMs);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  getStatus(): Map<string, NodeState> {
    return new Map(this.nodes);
  }
}
```

### Phi accrual failure detector

Le detecteur phi accrual est plus sophistique : il calcule une probabilite de panne basee sur l'historique des intervalles entre heartbeats, plutot qu'un simple seuil fixe.

```typescript
// Phi Accrual Failure Detector (simplifie)
class PhiAccrualFailureDetector {
  private arrivalIntervals: Map<string, number[]> = new Map();
  private lastArrival: Map<string, number> = new Map();
  private readonly maxSamples = 200;
  private readonly phiThreshold: number;

  constructor(phiThreshold: number = 8) {
    // phi = 8 → probabilite de faux positif ≈ 0.00000001
    this.phiThreshold = phiThreshold;
  }

  heartbeatReceived(nodeId: string): void {
    const now = Date.now();
    const last = this.lastArrival.get(nodeId);

    if (last !== undefined) {
      const interval = now - last;
      if (!this.arrivalIntervals.has(nodeId)) {
        this.arrivalIntervals.set(nodeId, []);
      }
      const intervals = this.arrivalIntervals.get(nodeId)!;
      intervals.push(interval);
      if (intervals.length > this.maxSamples) {
        intervals.shift();
      }
    }

    this.lastArrival.set(nodeId, now);
  }

  // Calculer phi — plus phi est grand, plus le noeud est suspect
  phi(nodeId: string): number {
    const intervals = this.arrivalIntervals.get(nodeId);
    const last = this.lastArrival.get(nodeId);

    if (!intervals || intervals.length < 2 || last === undefined) {
      return 0; // Pas assez de donnees
    }

    const timeSinceLastBeat = Date.now() - last;

    // Calculer la moyenne et l'ecart-type des intervalles
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance =
      intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
      intervals.length;
    const stddev = Math.sqrt(variance);

    // Calcul phi basee sur la distribution normale
    // phi = -log10(1 - F(timeSinceLastBeat))
    // ou F est la CDF de la distribution normale
    const y = (timeSinceLastBeat - mean) / stddev;
    const probability = 1 / (1 + Math.exp(-1.5976 * y));

    return -Math.log10(1 - probability);
  }

  isAlive(nodeId: string): boolean {
    return this.phi(nodeId) < this.phiThreshold;
  }

  getNodeReport(nodeId: string): {
    phi: number;
    threshold: number;
    verdict: 'alive' | 'suspect' | 'dead';
    confidence: string;
  } {
    const currentPhi = this.phi(nodeId);
    let verdict: 'alive' | 'suspect' | 'dead';

    if (currentPhi < this.phiThreshold * 0.5) {
      verdict = 'alive';
    } else if (currentPhi < this.phiThreshold) {
      verdict = 'suspect';
    } else {
      verdict = 'dead';
    }

    return {
      phi: Math.round(currentPhi * 100) / 100,
      threshold: this.phiThreshold,
      verdict,
      confidence: `${(
        (1 - Math.pow(10, -currentPhi)) *
        100
      ).toFixed(6)}%`,
    };
  }
}
```

---

## Failure domain isolation

```
┌──────────────────────────────────────────────────────────────┐
│         DOMAINES DE PANNE HIERARCHIQUES                      │
│                                                              │
│  ┌──────────────────── Region us-east-1 ───────────────────┐│
│  │                                                          ││
│  │  ┌──── AZ-a ────┐  ┌──── AZ-b ────┐  ┌──── AZ-c ────┐ ││
│  │  │               │  │               │  │               │ ││
│  │  │ ┌──────────┐  │  │ ┌──────────┐  │  │ ┌──────────┐ │ ││
│  │  │ │ Rack 1   │  │  │ │ Rack 3   │  │  │ │ Rack 5   │ │ ││
│  │  │ │ ┌──┐┌──┐ │  │  │ │ ┌──┐┌──┐ │  │  │ │ ┌──┐┌──┐ │ │ ││
│  │  │ │ │S1││S2│ │  │  │ │ │S5││S6│ │  │  │ │ │S9││10│ │ │ ││
│  │  │ │ └──┘└──┘ │  │  │ │ └──┘└──┘ │  │  │ │ └──┘└──┘ │ │ ││
│  │  │ └──────────┘  │  │ └──────────┘  │  │ └──────────┘ │ ││
│  │  │ ┌──────────┐  │  │ ┌──────────┐  │  │ ┌──────────┐ │ ││
│  │  │ │ Rack 2   │  │  │ │ Rack 4   │  │  │ │ Rack 6   │ │ ││
│  │  │ │ ┌──┐┌──┐ │  │  │ │ ┌──┐┌──┐ │  │  │ │ ┌──┐┌──┐ │ │ ││
│  │  │ │ │S3││S4│ │  │  │ │ │S7││S8│ │  │  │ │ │11││12│ │ │ ││
│  │  │ │ └──┘└──┘ │  │  │ │ └──┘└──┘ │  │  │ │ └──┘└──┘ │ │ ││
│  │  │ └──────────┘  │  │ └──────────┘  │  │ └──────────┘ │ ││
│  │  └───────────────┘  └───────────────┘  └───────────────┘ ││
│  │                                                          ││
│  │  Panne de rack 1 → blast radius = 2 serveurs (16%)      ││
│  │  Panne de AZ-a  → blast radius = 4 serveurs (33%)       ││
│  │  Panne region   → blast radius = 12 serveurs (100%)     ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

```typescript
// Modelisation des domaines de panne
type FailureDomainLevel = 'server' | 'rack' | 'zone' | 'region';

interface FailureDomain {
  level: FailureDomainLevel;
  id: string;
  parent?: string;
  children: string[];
  serverCount: number;
}

class FailureDomainPlanner {
  private domains: Map<string, FailureDomain> = new Map();

  addDomain(domain: FailureDomain): void {
    this.domains.set(domain.id, domain);
  }

  // Calculer l'impact d'une panne a un niveau donne
  calculateBlastRadius(
    domainId: string,
    totalServers: number
  ): { serversAffected: number; percentageAffected: number } {
    const domain = this.domains.get(domainId);
    if (!domain) {
      return { serversAffected: 0, percentageAffected: 0 };
    }

    const serversAffected = domain.serverCount;
    const percentageAffected = (serversAffected / totalServers) * 100;

    return {
      serversAffected,
      percentageAffected: Math.round(percentageAffected * 10) / 10,
    };
  }

  // Verifier si le placement des replicas est resilient
  validateReplicaPlacement(replicaLocations: string[]): {
    safe: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Verifier que les replicas ne sont pas dans le meme rack
    const racks = replicaLocations.map((loc) => {
      const domain = this.domains.get(loc);
      return domain?.parent;
    });

    const uniqueRacks = new Set(racks);
    if (uniqueRacks.size < racks.length) {
      warnings.push(
        'Plusieurs replicas dans le meme rack — une panne de rack perdrait plusieurs replicas'
      );
    }

    // Verifier que les replicas ne sont pas dans la meme zone
    const zones = replicaLocations.map((loc) => {
      const domain = this.domains.get(loc);
      const rack = domain?.parent ? this.domains.get(domain.parent) : null;
      return rack?.parent;
    });

    const uniqueZones = new Set(zones);
    if (uniqueZones.size < 2) {
      warnings.push(
        'Tous les replicas dans la meme zone de disponibilite — vulnerable a une panne de zone'
      );
    }

    return { safe: warnings.length === 0, warnings };
  }
}
```

---

## Concevoir pour la panne

:::tip Design for failure
1. **Assume que tout peut echouer** — reseau, disque, processus, memoire
2. **Detecte les pannes rapidement** — heartbeats, health checks, monitoring
3. **Isole les pannes** — bulkheads, cellules, domaines de panne
4. **Degrade gracieusement** — reponses par defaut, mode degrade
5. **Recupere automatiquement** — restart, failover, self-healing
:::

```typescript
// Checklist de conception pour la tolerance aux pannes
interface FaultToleranceChecklist {
  service: string;
  checks: Array<{
    category: string;
    item: string;
    implemented: boolean;
    notes: string;
  }>;
}

const checklist: FaultToleranceChecklist = {
  service: 'payment-service',
  checks: [
    {
      category: 'Detection',
      item: 'Health check endpoint (/health)',
      implemented: true,
      notes: 'Liveness + readiness',
    },
    {
      category: 'Detection',
      item: 'Heartbeat vers le service registry',
      implemented: true,
      notes: 'Toutes les 10s',
    },
    {
      category: 'Isolation',
      item: 'Circuit breaker sur les dependances',
      implemented: true,
      notes: 'Seuil a 50% d\'erreurs',
    },
    {
      category: 'Isolation',
      item: 'Timeout sur tous les appels reseau',
      implemented: true,
      notes: '5s max',
    },
    {
      category: 'Isolation',
      item: 'Bulkhead — pool de connexions isole par dependance',
      implemented: false,
      notes: 'TODO: implementer pour DB et cache',
    },
    {
      category: 'Degradation',
      item: 'Reponse par defaut si cache indisponible',
      implemented: true,
      notes: 'Retourne les donnees stale du cache local',
    },
    {
      category: 'Recuperation',
      item: 'Retry avec backoff exponentiel',
      implemented: true,
      notes: 'Max 3 retries, backoff 1s/2s/4s',
    },
    {
      category: 'Recuperation',
      item: 'Dead letter queue pour les messages echoues',
      implemented: true,
      notes: 'Retraitement manuel possible',
    },
    {
      category: 'Test',
      item: 'Chaos testing — injection de pannes',
      implemented: false,
      notes: 'TODO: implementer avec chaos middleware',
    },
  ],
};
```

---

## Resume

| Concept | Description | Impact |
|---------|------------|--------|
| **Panne partielle** | Certains noeuds echouent, d'autres non | Incertitude sur l'etat du systeme |
| **Panne en cascade** | Un echec entraine une chaine de pannes | Panne totale du systeme |
| **Gray failure** | Le systeme marche "presque" mais avec des anomalies | Tres difficile a detecter |
| **Fail-fast** | Detecter et signaler les erreurs immediatement | Economie de ressources |
| **Blast radius** | Zone d'impact d'une panne | A minimiser par isolation |
| **Heartbeat** | Signal periodique de vie entre noeuds | Detection de pannes |
| **Phi accrual** | Detecteur de pannes probabiliste | Moins de faux positifs |
| **Cell-based** | Isolation des utilisateurs par cellules | Limite le blast radius |

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [14 - Outbox pattern](./14-outbox-pattern-reliable-messaging.md) | [16 - Circuit Breaker, Bulkhead & Backpressure](./16-circuit-breaker.md) |

**Ressources associees :**
- [Lab 15 — Failure Modes](../labs/lab-15-failure-modes/)
- [Quiz 15 — Failure Modes](../quizzes/quiz-15-failure-modes.html)
