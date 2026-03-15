# Screencast 19 — Testing Distribue

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/19-testing-distribue.md`
- **Lab associe** : Lab 19
- **Prérequis** : Screencast 18

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/19-testing-distribue.md` ouvert
- [ ] Terminal supplementaire pour exécuter les tests
- [ ] Fichier `labs/lab-19-testing-distribue/` pret

## Script

### [00:00-01:30] Introduction — Pourquoi le testing change en distribue

> Tester un monolithe est relativement simple : on lance l'application, on fait des requêtes, on vérifié les résultats. En distribue, les tests doivent vérifier non seulement que chaque service fonctionne, mais aussi que les services fonctionnent ensemble, que les contrats sont respectes, et que le système se comporte correctement face aux pannes.

**Action** : Ouvrir le module 19 et afficher la pyramide de tests distribues.

```
              /\
             /  \  E2E Tests
            / (peu,\  lents, fragiles)
           /________\
          /          \
         / Integration\  Contract Tests
        /   Tests      \  (entre services)
       /________________\
      /                  \
     /    Unit Tests      \  (rapides, nombreux)
    /______________________\
```

> La pyramide reste valide en distribue, mais on ajoute une couche cruciale : les contract tests. Et on ajoute un type de test unique au distribue : le chaos testing.

### [01:30-05:30] Contract tests — Vérifier les interfaces entre services

> Les contract tests verifient que le producteur d'une API envoie bien ce que le consommateur attend. Sans contract tests, un changement dans le User Service peut casser le Order Service sans que personne ne s'en rende compte avant la production.

**Action** : Créer un fichier `contract-tests.ts`.

```typescript
import { z } from 'zod';

// --- Contrat partage : ce que le consommateur attend ---
const UserResponseContract = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  createdAt: z.string().datetime().optional(),
});

type UserResponse = z.infer<typeof UserResponseContract>;

// --- Test cote PRODUCTEUR ---
// "Est-ce que mon service produit des reponses conformes au contrat ?"
class ProducerContractTest {
  private results: { test: string; pass: boolean; error?: string }[] = [];

  async testUserEndpoint(): Promise<void> {
    // Simuler la reponse du User Service
    const response = this.simulateUserService('user-1');
    const result = UserResponseContract.safeParse(response);

    this.results.push({
      test: 'GET /users/:id returns valid UserResponse',
      pass: result.success,
      error: result.success ? undefined : result.error.issues.map(i => `${i.path}: ${i.message}`).join(', '),
    });
  }

  async testUserNotFound(): Promise<void> {
    const response = this.simulateUserServiceNotFound();
    const isError = response.statusCode === 404 && response.body.error;

    this.results.push({
      test: 'GET /users/:id returns 404 for unknown user',
      pass: isError,
    });
  }

  private simulateUserService(id: string): UserResponse {
    return { id, name: 'Alice Dupont', email: 'alice@example.com', createdAt: '2025-01-15T10:00:00Z' };
  }

  private simulateUserServiceNotFound(): { statusCode: number; body: any } {
    return { statusCode: 404, body: { error: 'User not found' } };
  }

  printResults(): void {
    console.log('\n=== Producer Contract Tests ===');
    for (const r of this.results) {
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'} : ${r.test}${r.error ? ` (${r.error})` : ''}`);
    }
  }
}

// --- Test cote CONSOMMATEUR ---
// "Est-ce que mon service parse correctement les reponses du producteur ?"
class ConsumerContractTest {
  private results: { test: string; pass: boolean; error?: string }[] = [];

  testValidResponse(): void {
    const raw = { id: 'user-1', name: 'Alice', email: 'alice@example.com' };
    const parsed = UserResponseContract.safeParse(raw);
    this.results.push({
      test: 'Parses valid UserResponse correctly',
      pass: parsed.success,
    });
  }

  testMissingFields(): void {
    const raw = { id: 'user-1' }; // Manque name et email
    const parsed = UserResponseContract.safeParse(raw);
    this.results.push({
      test: 'Rejects response with missing required fields',
      pass: !parsed.success,
    });
  }

  testExtraFields(): void {
    const raw = { id: 'user-1', name: 'Alice', email: 'a@b.com', age: 30, role: 'admin' };
    const parsed = UserResponseContract.safeParse(raw);
    this.results.push({
      test: 'Tolerates extra fields (forward compatibility)',
      pass: parsed.success,
    });
  }

  printResults(): void {
    console.log('\n=== Consumer Contract Tests ===');
    for (const r of this.results) {
      console.log(`  ${r.pass ? 'PASS' : 'FAIL'} : ${r.test}${r.error ? ` (${r.error})` : ''}`);
    }
  }
}

// Executer
const producer = new ProducerContractTest();
await producer.testUserEndpoint();
await producer.testUserNotFound();
producer.printResults();

const consumer = new ConsumerContractTest();
consumer.testValidResponse();
consumer.testMissingFields();
consumer.testExtraFields();
consumer.printResults();
```

> Les contract tests sont rapides (pas de serveur a démarrer), fiables (pas de réseau réel), et detectent les ruptures de contrat en CI. Chaque service maintient ses tests de contrat pour les APIs qu'il consomme.

### [05:30-09:30] Chaos middleware — Injecter des pannes

> Le chaos testing vérifié que votre système se comporte correctement quand les choses vont mal. Au lieu d'attendre qu'une panne arrive en production, on l'injecte volontairement.

**Action** : Créer un fichier `chaos-middleware.ts`.

```typescript
interface ChaosConfig {
  enabled: boolean;
  latencyInjection: { enabled: boolean; minMs: number; maxMs: number; probability: number };
  errorInjection: { enabled: boolean; statusCode: number; probability: number };
  timeoutInjection: { enabled: boolean; probability: number };
}

class ChaosMiddleware {
  constructor(private config: ChaosConfig) {}

  middleware() {
    return async (req: any, res: any, next: any) => {
      if (!this.config.enabled) return next();

      // Injection de latence
      if (this.config.latencyInjection.enabled && Math.random() < this.config.latencyInjection.probability) {
        const delay = this.config.latencyInjection.minMs +
          Math.random() * (this.config.latencyInjection.maxMs - this.config.latencyInjection.minMs);
        console.log(`[Chaos] Injecting ${Math.round(delay)}ms latency on ${req.method} ${req.path}`);
        await new Promise(r => setTimeout(r, delay));
      }

      // Injection d'erreur
      if (this.config.errorInjection.enabled && Math.random() < this.config.errorInjection.probability) {
        console.log(`[Chaos] Injecting ${this.config.errorInjection.statusCode} error on ${req.method} ${req.path}`);
        return res.status(this.config.errorInjection.statusCode).json({
          error: 'Chaos injection',
          message: 'This error was intentionally injected for testing',
        });
      }

      // Injection de timeout (ne repond jamais)
      if (this.config.timeoutInjection.enabled && Math.random() < this.config.timeoutInjection.probability) {
        console.log(`[Chaos] Injecting timeout on ${req.method} ${req.path}`);
        // Ne pas appeler next() ni res.send() — la requete va timeout
        return;
      }

      next();
    };
  }
}

// Configuration pour les tests
const chaos = new ChaosMiddleware({
  enabled: process.env.CHAOS_ENABLED === 'true',
  latencyInjection: { enabled: true, minMs: 200, maxMs: 2000, probability: 0.3 },
  errorInjection: { enabled: true, statusCode: 500, probability: 0.1 },
  timeoutInjection: { enabled: true, probability: 0.05 },
});
```

**Action** : Montrer l'utilisation dans un serveur Express.

```typescript
import express from 'express';

const app = express();

// Activer le chaos uniquement en test/staging
if (process.env.NODE_ENV !== 'production') {
  app.use(chaos.middleware());
}

app.get('/api/orders', (_req, res) => {
  res.json([{ id: 'order-1', total: 49.99 }]);
});

// Lancer avec chaos actif
// CHAOS_ENABLED=true npx tsx chaos-server.ts
```

> Le chaos middleware est active uniquement en environnement de test ou staging — jamais en production. Netflix a popularise cette approche avec Chaos Monkey. L'idee : si votre système survit au chaos en staging, il survivra aux pannes reelles en production.

### [09:30-13:00] Property-based testing — Tester les invariants

> Les tests classiques verifient des exemples spécifiques. Le property-based testing vérifié des propriétés qui doivent etre vraies pour TOUTES les entrees possibles. Le framework généré des centaines de cas aleatoires.

**Action** : Créer un fichier `property-tests.ts`.

```typescript
// Property-based testing simplifie (sans framework externe)
class PropertyTester {
  private results: { property: string; pass: boolean; counterExample?: string }[] = [];

  // Generateur d'entiers aleatoires
  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Generateur de strings aleatoires
  private randomString(maxLength: number = 20): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
    const length = this.randomInt(0, maxLength);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  // Tester une propriete avec N iterations
  testProperty(name: string, iterations: number, test: (input: any) => boolean, inputGen: () => any): void {
    for (let i = 0; i < iterations; i++) {
      const input = inputGen();
      try {
        if (!test(input)) {
          this.results.push({ property: name, pass: false, counterExample: JSON.stringify(input) });
          return;
        }
      } catch (err) {
        this.results.push({ property: name, pass: false, counterExample: `${JSON.stringify(input)} threw ${err}` });
        return;
      }
    }
    this.results.push({ property: name, pass: true });
  }

  printResults(): void {
    console.log('\n=== Property-Based Tests ===');
    for (const r of this.results) {
      if (r.pass) {
        console.log(`  PASS : ${r.property}`);
      } else {
        console.log(`  FAIL : ${r.property}`);
        console.log(`         Counter-example: ${r.counterExample}`);
      }
    }
  }
}

const pt = new PropertyTester();

// Propriete 1 : L'idempotency store retourne toujours le meme resultat pour la meme cle
pt.testProperty(
  'Idempotency: same key always returns same result',
  100,
  (input) => {
    const store = new Map<string, string>();
    const key = input.key;
    const value1 = input.value;

    // Premier appel
    if (!store.has(key)) store.set(key, value1);
    const result1 = store.get(key)!;

    // Deuxieme appel (meme cle, valeur differente)
    if (!store.has(key)) store.set(key, 'different');
    const result2 = store.get(key)!;

    return result1 === result2; // Doit toujours etre vrai
  },
  () => ({ key: `key-${Math.random()}`, value: `val-${Math.random()}` })
);

// Propriete 2 : Le consistent hashing est deterministe
pt.testProperty(
  'Consistent hashing: same key always maps to same node',
  200,
  (input) => {
    const hash = (s: string) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) & 0x7fffffff;
      return h;
    };
    return hash(input) === hash(input);
  },
  () => `key-${Math.random().toString(36).slice(2)}`
);

// Propriete 3 : Un circuit breaker CLOSED accepte toujours les requetes
pt.testProperty(
  'Circuit breaker CLOSED: always allows requests when under threshold',
  100,
  (input) => {
    // Si les echecs sont sous le seuil, le circuit doit rester ferme
    return input.failures < input.threshold;
  },
  () => ({ failures: Math.floor(Math.random() * 5), threshold: 5 })
);

pt.printResults();
```

> Le property-based testing est particulierement puissant pour les invariants distribues : l'idempotency doit toujours fonctionner, le consistent hashing doit toujours etre déterministe, le circuit breaker doit toujours respecter son seuil.

### [13:00-15:30] Tester la linearizabilite

> La linearizabilite est la propriété la plus forte de coherence : toute operation apparait comme si elle s'etait executee à un instant unique entre son debut et sa fin. Testons ça.

**Action** : Implementer un test de linearizabilite simplifie.

```typescript
interface Operation {
  type: 'write' | 'read';
  key: string;
  value?: string;
  startTime: number;
  endTime: number;
  result?: string;
}

class LinearizabilityChecker {
  check(operations: Operation[]): { linearizable: boolean; violation?: string } {
    // Pour chaque lecture, verifier qu'elle retourne la derniere ecriture
    // qui s'est terminee avant le debut de la lecture
    const sorted = [...operations].sort((a, b) => a.startTime - b.startTime);

    for (const op of sorted) {
      if (op.type !== 'read') continue;

      // Trouver toutes les ecritures qui se sont terminees avant le debut de cette lecture
      const completedWrites = sorted.filter(
        w => w.type === 'write' && w.key === op.key && w.endTime <= op.startTime
      );

      if (completedWrites.length === 0) continue;

      // La derniere ecriture terminee
      const lastWrite = completedWrites[completedWrites.length - 1];

      if (op.result !== lastWrite.value) {
        return {
          linearizable: false,
          violation: `Read of "${op.key}" returned "${op.result}" but last completed write was "${lastWrite.value}"`,
        };
      }
    }

    return { linearizable: true };
  }
}

// Test
const checker = new LinearizabilityChecker();

// Scenario linearisable
const linearOps: Operation[] = [
  { type: 'write', key: 'x', value: 'A', startTime: 0, endTime: 5 },
  { type: 'read', key: 'x', startTime: 10, endTime: 12, result: 'A' },
  { type: 'write', key: 'x', value: 'B', startTime: 15, endTime: 20 },
  { type: 'read', key: 'x', startTime: 25, endTime: 27, result: 'B' },
];

console.log('Linearizable scenario:', checker.check(linearOps));

// Scenario non linearisable (stale read)
const nonLinearOps: Operation[] = [
  { type: 'write', key: 'x', value: 'A', startTime: 0, endTime: 5 },
  { type: 'write', key: 'x', value: 'B', startTime: 6, endTime: 10 },
  { type: 'read', key: 'x', startTime: 15, endTime: 17, result: 'A' }, // Stale read!
];

console.log('Non-linearizable scenario:', checker.check(nonLinearOps));
```

### [15:30-17:30] Récapitulatif

> Recapitulons. Les contract tests verifient les interfaces entre services — indispensables en CI. Le chaos middleware injecte des pannes pour tester la résilience. Le property-based testing vérifié les invariants sur des centaines de cas aleatoires. Et le test de linearizabilite vérifié la coherence des lectures et ecritures.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Contract tests = verifier producteur et consommateur respectent le contrat
2. Chaos middleware = injecter latence, erreurs, timeouts en staging
3. Property-based testing = verifier des invariants sur des entrees aleatoires
4. Linearizabilite = la lecture retourne toujours la derniere ecriture completee
5. Pyramide de tests : unit → contract → integration → E2E

PROCHAINE ETAPE :
→ Screencast 20 : Consensus et coordination distribuee (Raft)
```

> Au prochain screencast, on entre dans la phase avancee du cours : le consensus distribue avec l'algorithme Raft. C'est ce qui permet a plusieurs noeuds de se mettre d'accord, même en cas de pannes. A bientot !

## Points d'attention pour l'enregistrement
- Les contract tests sont le concept le plus important — bien montrer producteur ET consommateur
- Le chaos middleware doit etre impressionnant visuellement : montrer les erreurs qui apparaissent
- Le property-based testing avec counter-example est un "aha moment" — bien le mettre en valeur
- Le test de linearizabilite est théorique — ne pas aller trop vite, expliquer le stale read
- Rappeler que le chaos testing est uniquement en staging/test, JAMAIS en production
- Exécuter tous les tests et montrer les résultats PASS/FAIL clairement
