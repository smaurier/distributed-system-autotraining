# Screencast 17 — Rate Limiting & Load Shedding

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/17-rate-limiting.md`
- **Lab associe** : Lab 17
- **Prerequis** : Screencast 16

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal integre ouvert
- [ ] Fichier `modules/17-rate-limiting.md` ouvert
- [ ] Deux terminaux (serveur + client de charge)
- [ ] Aucun processus sur les ports 3000-3001

## Script

### [00:00-01:30] Introduction — Proteger les services contre la surcharge

> Au screencast precedent, on a vu le circuit breaker qui protege un service contre ses dependances defaillantes. Le rate limiting protege un service contre ses propres clients. Trop de requetes par seconde, meme legales, peuvent saturer un service. Le rate limiting dit "tu as le droit a N requetes par minute, pas plus".

**Action** : Ouvrir le module 17 et afficher le diagramme.

```
Sans rate limiting :              Avec rate limiting :

1000 req/s ──────► Service        1000 req/s ──► [Rate Limiter] ──► Service
                   ☠️ crash                       │                 100 req/s
                                                 │                 ✅ stable
                                                 └──► 429 Too Many
                                                      (900 req/s rejetees)
```

### [01:30-05:30] Token Bucket — L'algorithme classique

> L'algorithme token bucket est le plus utilise. Imaginez un seau contenant des jetons. Chaque requete consomme un jeton. Le seau se remplit a un rythme constant. Quand il est vide, les requetes sont rejetees.

**Action** : Creer un fichier `rate-limiter.ts`.

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,      // Nombre max de jetons
    private refillRate: number,    // Jetons par seconde
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(tokensNeeded: number = 1): { allowed: boolean; remaining: number; retryAfterMs: number } {
    this.refill();

    if (this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded;
      return { allowed: true, remaining: Math.floor(this.tokens), retryAfterMs: 0 };
    }

    // Calculer le temps d'attente pour avoir assez de jetons
    const deficit = tokensNeeded - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRate) * 1000);

    return { allowed: false, remaining: 0, retryAfterMs };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefill = now;
  }

  getState(): { tokens: number; capacity: number } {
    this.refill();
    return { tokens: Math.floor(this.tokens), capacity: this.capacity };
  }
}

// Demo
const bucket = new TokenBucket(10, 2); // 10 jetons max, 2 par seconde

for (let i = 0; i < 15; i++) {
  const result = bucket.tryConsume();
  console.log(
    `Request ${(i + 1).toString().padStart(2)}: ${result.allowed ? 'ALLOWED' : 'REJECTED'} ` +
    `(remaining: ${result.remaining}, retry after: ${result.retryAfterMs}ms)`
  );
}
```

**Action** : Executer et montrer que les 10 premieres passent, puis les suivantes sont rejetees.

> Le token bucket a un avantage sur le compteur simple : il permet les bursts. Si le seau est plein avec 10 jetons, un client peut envoyer 10 requetes d'un coup. Mais ensuite il doit attendre que le seau se remplisse.

### [05:30-09:00] Sliding Window — Plus precis

> Le token bucket est simple mais imrecis aux limites de fenetre. Le sliding window est plus precis : il compte les requetes dans une fenetre glissante.

**Action** : Implementer le sliding window.

```typescript
class SlidingWindowLimiter {
  private requests: Map<string, number[]> = new Map();

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  isAllowed(clientId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Recuperer les timestamps des requetes de ce client
    let timestamps = this.requests.get(clientId) ?? [];

    // Supprimer les requetes hors de la fenetre
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length < this.maxRequests) {
      timestamps.push(now);
      this.requests.set(clientId, timestamps);

      return {
        allowed: true,
        remaining: this.maxRequests - timestamps.length,
        resetMs: timestamps.length > 0 ? timestamps[0] + this.windowMs - now : this.windowMs,
      };
    }

    // Calcul du temps avant la prochaine place libre
    const oldestInWindow = timestamps[0];
    const resetMs = oldestInWindow + this.windowMs - now;

    return { allowed: false, remaining: 0, resetMs };
  }
}

// Demo : 5 requetes par 10 secondes
const limiter = new SlidingWindowLimiter(5, 10_000);

console.log('\n=== Sliding Window (5 req / 10s) ===');
for (let i = 0; i < 8; i++) {
  const result = limiter.isAllowed('client-1');
  console.log(
    `Request ${i + 1}: ${result.allowed ? 'ALLOWED' : 'REJECTED'} ` +
    `(remaining: ${result.remaining}, reset in: ${result.resetMs}ms)`
  );
}
```

> Le sliding window est plus equitable : il ne penalise pas un client qui envoie ses requetes a la fin d'une fenetre. C'est l'algorithme utilise par Stripe, GitHub, et la plupart des API publiques.

### [09:00-12:30] Rate Limiting par tiers et load shedding

> En production, differents clients ont des quotas differents. Et quand le systeme est vraiment surcharge, le load shedding va plus loin que le rate limiting : il abandonne activement du travail pour sauver le systeme.

**Action** : Implementer un rate limiter multi-tier.

```typescript
interface RateLimitTier {
  name: string;
  requestsPerMinute: number;
  burstCapacity: number;
}

class TieredRateLimiter {
  private tiers: Map<string, RateLimitTier> = new Map();
  private buckets: Map<string, TokenBucket> = new Map();

  addTier(tier: RateLimitTier): void {
    this.tiers.set(tier.name, tier);
  }

  isAllowed(clientId: string, tierName: string): { allowed: boolean; tier: string; headers: Record<string, string> } {
    const tier = this.tiers.get(tierName);
    if (!tier) throw new Error(`Unknown tier: ${tierName}`);

    const bucketKey = `${clientId}:${tierName}`;
    if (!this.buckets.has(bucketKey)) {
      this.buckets.set(bucketKey, new TokenBucket(tier.burstCapacity, tier.requestsPerMinute / 60));
    }

    const bucket = this.buckets.get(bucketKey)!;
    const result = bucket.tryConsume();

    return {
      allowed: result.allowed,
      tier: tierName,
      headers: {
        'X-RateLimit-Limit': String(tier.requestsPerMinute),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.retryAfterMs / 1000)),
        'Retry-After': result.allowed ? '' : String(Math.ceil(result.retryAfterMs / 1000)),
      },
    };
  }
}

const tiered = new TieredRateLimiter();
tiered.addTier({ name: 'free', requestsPerMinute: 60, burstCapacity: 10 });
tiered.addTier({ name: 'pro', requestsPerMinute: 600, burstCapacity: 50 });
tiered.addTier({ name: 'enterprise', requestsPerMinute: 6000, burstCapacity: 500 });
```

**Action** : Montrer le load shedding.

```typescript
class LoadShedder {
  private currentLoad = 0;

  constructor(
    private maxLoad: number,
    private shedThreshold: number // Pourcentage (0.8 = 80%)
  ) {}

  shouldShed(priority: 'critical' | 'normal' | 'low'): boolean {
    const loadPercent = this.currentLoad / this.maxLoad;

    if (loadPercent < this.shedThreshold) return false;

    // Au-dela du seuil, shedder par priorite
    switch (priority) {
      case 'critical': return loadPercent > 0.95; // Shedder seulement a 95%
      case 'normal':   return loadPercent > 0.80; // Shedder a 80%
      case 'low':      return loadPercent > 0.60; // Shedder des 60%
    }
  }

  recordRequest(): void { this.currentLoad++; }
  releaseRequest(): void { this.currentLoad = Math.max(0, this.currentLoad - 1); }

  getLoadPercent(): number {
    return Math.round((this.currentLoad / this.maxLoad) * 100);
  }
}

const shedder = new LoadShedder(100, 0.6);

// Simuler une montee en charge
for (let i = 0; i < 100; i++) {
  shedder.recordRequest();

  const criticalShed = shedder.shouldShed('critical');
  const normalShed = shedder.shouldShed('normal');
  const lowShed = shedder.shouldShed('low');

  if (i % 20 === 0) {
    console.log(
      `Load: ${shedder.getLoadPercent()}% | ` +
      `Low: ${lowShed ? 'SHED' : 'ok'} | ` +
      `Normal: ${normalShed ? 'SHED' : 'ok'} | ` +
      `Critical: ${criticalShed ? 'SHED' : 'ok'}`
    );
  }
}
```

> Le load shedding est la derniere ligne de defense. A 60% de charge, on arrete les requetes basse priorite (analytics, rapports). A 80%, on arrete les requetes normales. A 95%, meme les requetes critiques sont shedded. Mieux vaut servir 50% des clients correctement que 100% des clients mal.

### [12:30-15:30] Integration Express avec headers standards

> Integrons le rate limiting dans un serveur Express avec les headers standards que les clients HTTP comprennent.

**Action** : Montrer l'integration complete.

```typescript
import express from 'express';

const app = express();
const limiter = new TieredRateLimiter();
limiter.addTier({ name: 'free', requestsPerMinute: 60, burstCapacity: 10 });
limiter.addTier({ name: 'pro', requestsPerMinute: 600, burstCapacity: 50 });

app.use((req, res, next) => {
  // Determiner le tier du client (en prod: depuis le token JWT)
  const clientId = req.headers['x-api-key'] as string ?? req.ip ?? 'anonymous';
  const tier = req.headers['x-api-tier'] as string ?? 'free';

  const result = limiter.isAllowed(clientId, tier);

  // Toujours envoyer les headers, meme si la requete est acceptee
  for (const [key, value] of Object.entries(result.headers)) {
    if (value) res.set(key, value);
  }

  if (!result.allowed) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded for tier "${result.tier}"`,
      retryAfter: result.headers['Retry-After'],
    });
  }

  next();
});

app.get('/api/data', (_req, res) => {
  res.json({ data: 'Hello, rate-limited world!', timestamp: Date.now() });
});

app.listen(3000, () => console.log('[Server] Started on port 3000'));
```

**Action** : Tester avec curl et montrer les headers.

```bash
# Voir les headers de rate limit
curl -i http://localhost:3000/api/data -H "X-Api-Key: client-1"

# Bombarder pour atteindre la limite
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/api/data -H "X-Api-Key: client-1"
done
```

### [15:30-17:30] Recapitulatif

> Recapitulons. Le token bucket permet les bursts avec un debit moyen controle. Le sliding window est plus precis et equitable. Le rate limiting par tiers differencie les clients. Le load shedding sacrifie les requetes basse priorite pour sauver le systeme. Et les headers standards (X-RateLimit-*, Retry-After) informent les clients.

**Action** : Afficher le recapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Token Bucket = simple, permet les bursts
2. Sliding Window = equitable, pas de probleme aux limites
3. Tiers = free/pro/enterprise avec des quotas differents
4. Load Shedding = sacrifier les basses priorites sous forte charge
5. Headers standards : X-RateLimit-Limit, Remaining, Reset, Retry-After

PROCHAINE ETAPE :
→ Screencast 18 : Observabilite distribuee
```

> Au prochain screencast, on va parler d'observabilite : comment savoir ce qui se passe dans un systeme distribue en temps reel. Correlation IDs, structured logging, health checks avances et RED metrics. A bientot !

## Points d'attention pour l'enregistrement
- Le token bucket est tres visuel — montrer les jetons qui se vident et se remplissent
- La comparaison token bucket vs sliding window doit etre claire
- Les headers X-RateLimit-* sont visibles avec curl -i — les montrer a l'ecran
- Le load shedding par priorite est un concept avance — bien expliquer le "mieux servir 50% bien que 100% mal"
- Tester en boucle pour atteindre la limite et montrer le 429
- Verifier que le serveur Express fonctionne avant la demo
