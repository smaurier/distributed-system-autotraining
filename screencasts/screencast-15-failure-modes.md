# Screencast 15 — Failure Modes & Fault Tolerance

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/15-failure-modes.md`
- **Lab associe** : Lab 15
- **Prérequis** : Screencast 14

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `labs/lab-15-failure-modes/` pret
- [ ] Aucun processus sur les ports 3000-3005
- [ ] Preparer 3 terminaux side-by-side pour la demo cascade

## Script

### [00:00-01:30] Introduction — Les pannes sont inevitables

> Dans un système distribue, la question n'est pas SI une panne va se produire, mais QUAND. A l'echelle d'un datacenter avec des milliers de machines, des disques tombent en panne chaque jour, des processus crashent chaque heure, et des paquets réseau sont perdus chaque seconde. Un bon système ne cherche pas a éviter toutes les pannes — il les tolere et limite leur impact.

**Action** : Afficher le spectre des pannes du module 15 (crash, omission, timing, byzantine).

> On va explorer quatre types de pannes et apprendre a s'en defendre.

### [01:30-04:30] Simuler les pannes partielles

> La panne partielle est le defi fondamental des systèmes distribues. Dans un monolithe, tout fonctionne ou tout crashe. En distribue, un service peut etre down pendant que les autres fonctionnent. Le système est dans un état indetermine.

**Action** : Créer un fichier `partial-failure.ts`.

```typescript
interface ServiceStatus {
  name: string;
  healthy: boolean;
  latencyMs: number;
}

class DistributedSystem {
  private services: Map<string, ServiceStatus> = new Map();

  addService(name: string): void {
    this.services.set(name, { name, healthy: true, latencyMs: 5 });
  }

  // Simuler une panne partielle
  failService(name: string): void {
    const svc = this.services.get(name);
    if (svc) {
      svc.healthy = false;
      console.log(`[FAILURE] ${name} is DOWN`);
    }
  }

  async processRequest(requestId: string): Promise<string> {
    const results: string[] = [];

    for (const [name, svc] of this.services) {
      if (!svc.healthy) {
        // Que faire ? Echouer pour tout le monde ? Degrader ? Attendre ?
        results.push(`${name}: UNREACHABLE`);
      } else {
        await new Promise(r => setTimeout(r, svc.latencyMs));
        results.push(`${name}: OK (${svc.latencyMs}ms)`);
      }
    }

    return results.join(' | ');
  }
}

// Demo
const system = new DistributedSystem();
system.addService('order-service');
system.addService('payment-service');
system.addService('inventory-service');
system.addService('notification-service');

console.log('=== All services healthy ===');
console.log(await system.processRequest('req-1'));

// Panne partielle
system.failService('payment-service');

console.log('\n=== Partial failure: payment-service down ===');
console.log(await system.processRequest('req-2'));
```

> Voyez : la requête traverse 4 services. Quand payment-service tombe, on à un dilemme. Est-ce qu'on echoue pour tout le monde ? Est-ce qu'on continue sans paiement ? C'est la question fondamentale de la tolerance aux pannes.

### [04:30-08:00] Pannes en cascade — L'effet domino

> La panne en cascade est le scenario catastrophe. Un service tombe, les services qui en dependent accumulent des timeouts, epuisent leurs threads, et tombent a leur tour. En quelques minutes, tout le système est down.

**Action** : Implementer une simulation de cascade.

```typescript
class CascadeSimulator {
  private services: Map<string, {
    name: string;
    healthy: boolean;
    pendingRequests: number;
    maxConcurrent: number;
    dependencies: string[];
  }> = new Map();

  addService(name: string, maxConcurrent: number, dependencies: string[]): void {
    this.services.set(name, {
      name, healthy: true, pendingRequests: 0, maxConcurrent, dependencies,
    });
  }

  async simulateLoad(requestCount: number): Promise<void> {
    for (let i = 0; i < requestCount; i++) {
      await this.processThrough('api-gateway');
      this.printStatus();
    }
  }

  private async processThrough(serviceName: string): Promise<boolean> {
    const svc = this.services.get(serviceName)!;

    if (!svc.healthy) return false;

    svc.pendingRequests++;

    // Surcharge => le service tombe aussi
    if (svc.pendingRequests > svc.maxConcurrent) {
      svc.healthy = false;
      console.log(`[CASCADE] ${svc.name} overwhelmed (${svc.pendingRequests}/${svc.maxConcurrent}) — NOW DOWN`);
      return false;
    }

    // Appeler les dependances
    for (const dep of svc.dependencies) {
      const depOk = await this.processThrough(dep);
      if (!depOk) {
        // La dependance est down, la requete reste bloquee
        // => ne pas decrementer pendingRequests (simule un timeout long)
        return false;
      }
    }

    svc.pendingRequests--;
    return true;
  }

  private printStatus(): void {
    for (const [, svc] of this.services) {
      const status = svc.healthy ? 'UP' : 'DOWN';
      console.log(`  ${svc.name}: ${status} (pending: ${svc.pendingRequests}/${svc.maxConcurrent})`);
    }
  }
}
```

**Action** : Lancer la simulation : d'abord tuer `database`, puis observer la cascade.

> Regardez comment ça se propage : la base de donnees tombe, le service order accumule les requêtes en attente, dépasse sa capacité, et tombe. Puis l'API gateway fait pareil. En 15 secondes, tout est down. C'est exactement ce qui arrive en production sans protections.

### [08:00-11:30] Gray Failure — La panne invisible

> Le pire type de panne n'est pas le crash total — c'est la panne grise. Le service repond, mais mal. Il est lent, ou il retourne des donnees incorrectes, ou il perd un message sur dix. Les health checks passent, les alertes ne se declenchent pas, mais le système est degrade.

**Action** : Implementer un detecteur de gray failures.

```typescript
class GrayFailureDetector {
  private metrics: Map<string, { latencies: number[]; errors: number; total: number }> = new Map();

  recordRequest(service: string, latencyMs: number, success: boolean): void {
    if (!this.metrics.has(service)) {
      this.metrics.set(service, { latencies: [], errors: 0, total: 0 });
    }
    const m = this.metrics.get(service)!;
    m.latencies.push(latencyMs);
    m.total++;
    if (!success) m.errors++;
  }

  detectGrayFailure(service: string): { isGray: boolean; reasons: string[] } {
    const m = this.metrics.get(service);
    if (!m || m.total < 10) return { isGray: false, reasons: [] };

    const reasons: string[] = [];

    // P99 latence trop elevee
    const sorted = [...m.latencies].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    if (p99 > p50 * 10) {
      reasons.push(`P99 latency (${p99}ms) is ${(p99 / p50).toFixed(1)}x the P50 (${p50}ms)`);
    }

    // Taux d'erreur faible mais non-zero
    const errorRate = m.errors / m.total;
    if (errorRate > 0.01 && errorRate < 0.1) {
      reasons.push(`Error rate ${(errorRate * 100).toFixed(1)}% — not failing, not healthy`);
    }

    return { isGray: reasons.length > 0, reasons };
  }
}
```

> La panne grise est insidieuse parce qu'elle passe sous le radar des alertes binaires "up/down". C'est pourquoi on a besoin de metriques fines : percentiles de latence, taux d'erreur, et detection d'anomalies.

**Action** : Injecter des latences aleatoirement elevees et montrer la detection.

### [11:30-14:30] Fail-Fast et Blast Radius

> Deux principes defensifs essentiels. Premier principe : fail-fast. Quand on détecté un problème, on echoue immediatement au lieu d'attendre un timeout de 30 secondes.

**Action** : Montrer la différence entre fail-slow et fail-fast.

```typescript
// Fail-slow (anti-pattern) : attend 30s pour rien
async function failSlow(service: string): Promise<string> {
  const start = Date.now();
  try {
    const result = await fetch(`http://${service}/api`, { signal: AbortSignal.timeout(30000) });
    return await result.text();
  } catch {
    console.log(`Failed after ${Date.now() - start}ms`); // ~30000ms
    throw new Error('timeout');
  }
}

// Fail-fast : detecte immediatement
async function failFast(service: string, healthCheck: HealthChecker): Promise<string> {
  if (!healthCheck.isHealthy(service)) {
    throw new Error(`${service} is known to be unhealthy — failing fast`);
    // Temps perdu : ~0ms au lieu de 30000ms
  }
  return fetch(`http://${service}/api`).then(r => r.text());
}
```

> Deuxieme principe : limiter le blast radius. Une panne ne doit affecter qu'une partie du système, pas tout.

```typescript
// Blast radius : isoler les pannes par domaine
class BlastRadiusIsolation {
  private zones: Map<string, string[]> = new Map([
    ['critical', ['payment', 'order']],
    ['secondary', ['notification', 'analytics']],
    ['background', ['reporting', 'recommendations']],
  ]);

  getImpactedZone(failedService: string): string {
    for (const [zone, services] of this.zones) {
      if (services.includes(failedService)) return zone;
    }
    return 'unknown';
  }

  shouldRejectRequest(failedService: string, requestPriority: string): boolean {
    const zone = this.getImpactedZone(failedService);
    // Si un service "background" tombe, les requetes critiques passent toujours
    if (zone === 'background' && requestPriority === 'critical') return false;
    return zone === this.getImpactedZone(failedService);
  }
}
```

**Action** : Montrer qu'un crash dans la zone "background" n'impacte pas les commandes critiques.

### [14:30-17:00] Récapitulatif et lien avec le Lab 15

> Recapitulons les quatre types de pannes : le crash total, la panne partielle, la panne en cascade, et la panne grise. Pour chacun, on a des stratégies : fail-fast pour détecter vite, blast radius pour isoler, et detection de gray failures pour les pannes invisibles.

**Action** : Montrer le tableau récapitulatif du module 15.

> Au prochain screencast, on va construire le circuit breaker — la protection numéro un contre les pannes en cascade. Et dans le lab 15, vous allez implementer un simulateur complet de pannes avec heartbeat detection.

**Action** : Ouvrir le README du Lab 15.

> Mettez la video en pause et lancez-vous sur le lab !

## Points d'attention pour l'enregistrement
- Utiliser 3 terminaux side-by-side pour la demo de cascade, c'est visuellement frappant
- Mettre une pause dramatique quand la cascade se declenche
- Pour les gray failures, bien insister sur le fait que le health check dit "OK" alors que le service est degrade
- Les diagrammes du module sont utiles — les afficher en split screen
- Garder un rythme rapide pour ce screencast, les concepts s'enchainent bien
- Vérifier que la simulation de cascade fonctionne de manière déterministe avant l'enregistrement
