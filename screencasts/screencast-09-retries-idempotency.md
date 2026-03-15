# Screencast 09 — Retries, Timeouts & Idempotency

## Informations
- **Duree estimee** : 15-18 min
- **Module** : `modules/09-retries-timeouts-idempotency.md`
- **Lab associe** : Lab 09
- **Prérequis** : Screencast 08

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/09-retries-timeouts-idempotency.md` ouvert
- [ ] Terminal supplementaire pour les tests
- [ ] Aucun processus sur les ports 3001-3002

## Script

### [00:00-01:30] Introduction — Pourquoi les retries naifs sont dangereux

> On a déjà vu les retries dans les screencasts précédents. Mais un retry naif peut etre pire que pas de retry du tout. Imaginez : un service de paiement est lent, vous retentez 3 fois, chaque retry créé un paiement supplementaire. L'utilisateur est debite 4 fois au lieu d'une. C'est le problème fondamental que l'idempotency resout.

**Action** : Ouvrir le module 09 et afficher le diagramme du problème.

```
CLIENT                    PAYMENT SERVICE
  │                             │
  │── POST /pay (100 EUR) ────►│
  │                             │ ... processing (lent)
  │   Timeout! Retry...         │
  │── POST /pay (100 EUR) ────►│ ← deuxieme paiement !
  │                             │ ... processing
  │   Timeout! Retry...         │
  │── POST /pay (100 EUR) ────►│ ← troisieme paiement !
  │                             │
  │◄── 200 OK ─────────────────│
  │                             │
  RESULTAT : 300 EUR debites au lieu de 100 EUR
```

### [01:30-05:00] Backoff exponentiel avec jitter

> Le premier problème des retries naifs est le "thundering herd". Si 1000 clients retentent en même temps après un timeout, le serveur qui venait de se relever est immediatement submerge. Le backoff exponentiel avec jitter resout ça.

**Action** : Créer un fichier `retry-strategies.ts`.

```typescript
// --- Strategies de backoff ---

// Backoff exponentiel : 100ms, 200ms, 400ms, 800ms...
function exponentialBackoff(attempt: number, baseMs: number = 100): number {
  return baseMs * Math.pow(2, attempt);
}

// Jitter : ajouter de l'aleatoire pour eviter le thundering herd
function withJitter(delayMs: number, jitterFactor: number = 0.5): number {
  const jitter = delayMs * jitterFactor * Math.random();
  return delayMs + jitter;
}

// Full jitter (recommande par AWS) : entre 0 et le backoff max
function fullJitter(attempt: number, baseMs: number = 100): number {
  const maxDelay = baseMs * Math.pow(2, attempt);
  return Math.random() * maxDelay;
}

// Decorrelated jitter (le plus performant selon les benchmarks)
function decorrelatedJitter(prevDelay: number, baseMs: number = 100): number {
  return Math.min(30_000, Math.random() * (prevDelay * 3 - baseMs) + baseMs);
}

// --- Visualiser les delais ---
console.log('=== Comparaison des strategies (5 retries) ===\n');
console.log('Attempt | Exponential | + Jitter    | Full Jitter | Decorrelated');
console.log('--------|-------------|-------------|-------------|-------------');

let prevDelay = 100;
for (let i = 0; i < 5; i++) {
  const exp = exponentialBackoff(i);
  const jit = Math.round(withJitter(exp));
  const full = Math.round(fullJitter(i));
  const decor = Math.round(decorrelatedJitter(prevDelay));
  prevDelay = decor;

  console.log(
    `   ${i}    | ${String(exp).padStart(7)}ms  | ${String(jit).padStart(7)}ms  | ${String(full).padStart(7)}ms  | ${String(decor).padStart(7)}ms`
  );
}
```

**Action** : Exécuter et montrer la variabilite des delais.

```bash
npx tsx retry-strategies.ts
```

> La stratégie "full jitter" est recommandee par Amazon. Elle repartit les retries uniformement dans la fenêtre de temps, evitant les pics de charge. Sans jitter, 1000 clients retentent tous a exactement 200ms, 400ms, 800ms — ce qui créé des pics periodiques.

### [05:00-09:30] Idempotency keys — Le paiement ne se fait qu'une fois

> L'idempotency garantit qu'une operation peut etre executee plusieurs fois avec le même résultat. Le client généré un identifiant unique (idempotency key) et l'envoie avec chaque requête. Le serveur détecté les doublons et retourne le résultat original.

**Action** : Implementer un serveur idempotent.

```typescript
import express from 'express';

interface IdempotencyRecord {
  key: string;
  response: { status: number; body: unknown };
  createdAt: number;
  expiresAt: number;
}

class IdempotencyStore {
  private records: Map<string, IdempotencyRecord> = new Map();
  private ttlMs = 24 * 60 * 60 * 1000; // 24 heures

  get(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    if (record && Date.now() > record.expiresAt) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  set(key: string, response: { status: number; body: unknown }): void {
    this.records.set(key, {
      key,
      response,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    });
  }
}

const idempotencyStore = new IdempotencyStore();
const app = express();
app.use(express.json());

// --- Middleware d'idempotency ---
function idempotencyMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== 'POST' && req.method !== 'PUT') return next();

  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing Idempotency-Key header for write operation' });
  }

  // Verifier si on a deja traite cette requete
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing) {
    console.log(`[Idempotency] Returning cached response for key ${idempotencyKey}`);
    res.set('X-Idempotent-Replayed', 'true');
    return res.status(existing.response.status).json(existing.response.body);
  }

  // Intercepter la reponse pour la cacher
  const originalJson = res.json.bind(res);
  res.json = function(body: unknown) {
    idempotencyStore.set(idempotencyKey, { status: res.statusCode, body });
    console.log(`[Idempotency] Cached response for key ${idempotencyKey}`);
    return originalJson(body);
  };

  next();
}

app.use(idempotencyMiddleware);

// --- Endpoint de paiement ---
app.post('/payments', async (req, res) => {
  const { userId, amount } = req.body;
  console.log(`[Payment] Processing ${amount} EUR for ${userId}`);

  // Simuler un traitement lent
  await new Promise(r => setTimeout(r, 500));

  const payment = {
    id: `pay-${Date.now()}`,
    userId,
    amount,
    status: 'completed',
    processedAt: new Date().toISOString(),
  };

  res.status(201).json(payment);
});

app.listen(3001, () => console.log('[Payment Service] Started on port 3001'));
```

**Action** : Tester avec la même idempotency key.

```bash
# Premier appel — traitement reel
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-abc-123" \
  -d '{"userId": "user-1", "amount": 100}'

# Deuxieme appel avec la meme cle — reponse cachee
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-abc-123" \
  -d '{"userId": "user-1", "amount": 100}'

# Troisieme appel — meme resultat, meme id de paiement
curl -i -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pay-abc-123" \
  -d '{"userId": "user-1", "amount": 100}'
```

> Regardez le header `X-Idempotent-Replayed: true` dans la réponse du deuxieme appel. Le serveur n'a pas recree un paiement — il a retourne le résultat cache. L'utilisateur n'est debite qu'une seule fois, peu importe le nombre de retries.

### [09:30-13:00] Client HTTP resilient complet

> Combinons backoff+jitter et idempotency dans un client HTTP resilient.

**Action** : Créer un fichier `resilient-client.ts`.

```typescript
interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

class ResilientHttpClient {
  private defaults: RetryOptions = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 10_000,
    retryableStatuses: [429, 500, 502, 503, 504],
  };

  async request(url: string, options: RequestInit & { retryOptions?: Partial<RetryOptions> } = {}): Promise<Response> {
    const config = { ...this.defaults, ...options.retryOptions };
    const idempotencyKey = crypto.randomUUID();

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            'Idempotency-Key': idempotencyKey,
          },
          signal: options.signal ?? AbortSignal.timeout(5000),
        });

        // Succes ou erreur client non-retryable
        if (response.ok || !config.retryableStatuses.includes(response.status)) {
          return response;
        }

        // Respecter Retry-After si present
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter && attempt < config.maxRetries) {
          const delay = parseInt(retryAfter) * 1000;
          console.log(`[Client] Retry-After: waiting ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Erreur retryable → backoff + jitter
        if (attempt < config.maxRetries) {
          const delay = Math.min(
            config.maxDelayMs,
            Math.random() * config.baseDelayMs * Math.pow(2, attempt)
          );
          console.log(`[Client] Attempt ${attempt + 1} failed (${response.status}), retrying in ${delay.toFixed(0)}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        return response;
      } catch (err) {
        if (attempt === config.maxRetries) throw err;
        const delay = Math.random() * config.baseDelayMs * Math.pow(2, attempt);
        console.log(`[Client] Attempt ${attempt + 1} error: ${err}, retrying in ${delay.toFixed(0)}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw new Error('Should not reach here');
  }
}
```

> Le client généré une idempotency key unique par requête logique et l'envoie à chaque retry. Il respecte le header `Retry-After` si le serveur le fournit. Et il utilise le full jitter pour le backoff. C'est le type de client qu'on utilise en production.

### [13:00-15:30] Quand NE PAS retenter

> Les retries ne sont pas toujours la bonne réponse. Il faut savoir quand s'arreter.

**Action** : Afficher la table de decision.

```
STATUS CODE    | RETRYABLE ? | POURQUOI
───────────────|─────────────|─────────────────────────────────
400 Bad Request| NON         | La requete est invalide, retry = meme erreur
401 Unauthorized| NON        | Le token est expire, retry = meme erreur
403 Forbidden  | NON         | Pas les droits, retry = meme erreur
404 Not Found  | NON         | La ressource n'existe pas
409 Conflict   | DEPEND      | Si idempotency key → retourne le cache
429 Too Many   | OUI         | Respecter Retry-After
500 Internal   | OUI         | Erreur transitoire possible
502 Bad Gateway| OUI         | Probleme d'infra temporaire
503 Unavailable| OUI         | Service en redemarrage
504 Timeout    | OUI         | Timeout temporaire
Network Error  | OUI         | Connectivite temporaire
```

> La regle : on retente les erreurs transitoires (5xx, timeout, erreur réseau), jamais les erreurs clients (4xx sauf 429). Un 400 retente 1000 fois donne toujours un 400 — c'est du gaspillage.

### [15:30-17:30] Récapitulatif

> Recapitulons. Le backoff exponentiel avec full jitter evite le thundering herd. L'idempotency key garantit qu'une operation est executee exactement une fois, même avec des retries. Le client resilient combine les deux avec le respect du Retry-After. Et on ne retente jamais les erreurs clients.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. Backoff exponentiel + full jitter = repartition optimale des retries
2. Idempotency key = genere par le client, cache par le serveur
3. Respecter Retry-After quand le serveur le fournit
4. Ne JAMAIS retenter les erreurs 4xx (sauf 429)
5. Toujours un timeout sur chaque requete (AbortSignal.timeout)

PROCHAINE ETAPE :
→ Screencast 10 : Coherence et theoreme CAP
```

> Au prochain screencast, on change complètement de sujet : on va parler de coherence des donnees et du théorème CAP. C'est le fondement théorique qui guide toutes les decisions d'architecture en distribue. A bientot !

## Points d'attention pour l'enregistrement
- Le diagramme du triple paiement est très parlant — y passer du temps
- Exécuter le code de comparaison des stratégies de backoff plusieurs fois pour montrer la variabilite
- La demo d'idempotency est le moment clé : montrer que le même ID de paiement est retourne
- Le header X-Idempotent-Replayed doit etre visible dans la sortie curl -i
- La table de decision retryable/non-retryable est un référence utile — la montrer en plein ecran
- Vérifier que le serveur de paiement fonctionne avant de lancer les tests
