---
titre: Rate limiting & backpressure
cours: 17-distributed-systems
notions: ["rate limiting vs load shedding vs backpressure", "token bucket (débit moyen + bursts contrôlés)", "leaky bucket (débit de sortie constant, FIFO)", "fixed window counter (et son burst 2x à la frontière)", "sliding window log (précis, mémoire O(n))", "sliding window counter (compromis O(1))", "rate limiting distribué (état partagé Redis)", "atomicité via script Lua (INCR + PEXPIRE)", "quotas (par clé / par fenêtre)", "backpressure (le consommateur signale à l'amont de ralentir)", "load shedding (délestage sélectif par priorité)", "admission control", "429 Too Many Requests (RFC 6585)", "Retry-After (delay-seconds ou HTTP-date)", "en-têtes RateLimit (draft IETF httpapi)", "503 vs 429 (surcharge vs quota)"]
outcomes:
  - "sait distinguer rate limiting, load shedding et backpressure et dire lequel protège quoi"
  - "sait implémenter et comparer token bucket, leaky bucket, fixed/sliding window et choisir selon le besoin (burst vs débit lissé)"
  - "sait expliquer pourquoi un compteur en mémoire locale ne suffit pas à N instances et implémenter un rate limiter distribué à état partagé Redis avec un script Lua atomique"
  - "sait appliquer le backpressure pour propager la saturation vers l'amont au lieu d'accumuler une queue infinie"
  - "sait délester (load shedding) par priorité quand le système est saturé, plutôt que tout dégrader uniformément"
  - "sait répondre un 429 correct avec Retry-After et les en-têtes RateLimit, et distinguer 429 (quota client) de 503 (surcharge système)"
prerequis: ["Module 04 — communication synchrone (deadlines, timeouts)", "Module 05 — message queues, garanties de livraison, DLQ", "Module 08 — retries, backoff+jitter, idempotency key", "Module 09 — cohérence & théorème CAP (choisir la disponibilité)", "Module 14 — failure modes, circuit breaker, bulkhead, timeout budget"]
next: 16-observabilite-distribuee
libs: []
tribuzen: "backend TribuZen — un pic de trafic (retry storm mobile, moment viral) sature sorties-svc ; un rate limiter distribué (token bucket sur Redis) protège chaque instance, le backpressure propage la saturation vers l'amont, et le load shedding sacrifie le non-essentiel pour garder le cœur vivant"
last-reviewed: 2026-07
---

# Rate limiting & backpressure

> **Outcomes — tu sauras FAIRE :** distinguer rate limiting / load shedding / backpressure, implémenter et comparer token bucket / leaky bucket / fixed & sliding window, écrire un rate limiter distribué à état partagé Redis (script Lua atomique), propager la saturation par backpressure, délester par priorité, et renvoyer un 429 correct avec `Retry-After`.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module est le niveau **système** de la régulation de charge : comment un service **protège son propre débit** face à un afflux, avec quels **algorithmes** (token/leaky bucket, fenêtres), comment partager cet état entre **N instances** (Redis), et comment **propager** la saturation (backpressure) ou **abandonner** proprement du travail (load shedding). On **ne** traite **pas** ici le rate limiting comme **contre-mesure de sécurité / abus d'API** (brute-force login, protection anti-scraping, quotas commerciaux par plan) → **cours 14-securite** ; ni le **circuit breaker / bulkhead / timeout budget** (protéger un *appelant* d'un *dépendant* lent) → **module 14 (ce cours)** ; ni la **décision d'architecture** « gateway centralisée vs par service » → **cours 13-architecture**. Ici : les mécanismes et leurs garanties de débit.

## 1. Cas concret d'abord

Vendredi 18 h. Un organisateur TribuZen publie une **grosse sortie** (« kermesse de l'école, 200 familles »). L'app mobile de chaque parent, en arrière-plan, **poll** l'endpoint `GET /sorties/feed` pour rafraîchir le fil. Un bug côté mobile transforme le poll « toutes les 60 s » en « toutes les 2 s », et la notification push réveille **toutes les familles en même temps**. Résultat : `sorties-svc` passe de 50 req/s à **3 000 req/s** en trente secondes.

Le service n'a **aucune** régulation :

```ts
// sorties.controller.ts — AUCUNE protection de débit
@Get('/sorties/feed')
async feed(@Query('familyId') familyId: string) {
  // Chaque requête ouvre une connexion DB, fait 3 jointures, sérialise 200 sorties.
  return this.sortiesService.buildFeed(familyId); // ← 3 000×/s → pool DB épuisé
}
```

L'enchaînement est brutal : le **pool de connexions** PostgreSQL (20 connexions) est saturé, les requêtes s'**empilent** dans une queue interne, la **latence** grimpe de 40 ms à 8 s, les **timeouts** clients déclenchent des **retries** (module 08) qui ajoutent *encore* de la charge — c'est un **retry storm**. Comme `sorties-svc` partage sa base avec `createSortie`, **plus personne** ne peut créer de sortie non plus. Un seul endpoint non protégé fait tomber tout le domaine.

Le réflexe faux serait « ajoutons des serveurs ». Mais la base, elle, ne se duplique pas d'un claquement de doigts, et un client buggé peut toujours saturer ce que tu ajoutes. La vraie réponse est de **réguler le débit admis** :

- **Rate limiting** — plafonner ce que **chaque client** peut envoyer (« une famille : 30 req/min sur `/feed` ») pour qu'un client fou ne mange pas tout.
- **Backpressure** — quand un étage est plein, **dire à l'amont de ralentir** au lieu d'accumuler une queue infinie.
- **Load shedding** — si malgré tout on sature, **rejeter d'abord le non-essentiel** (le refresh de feed) pour garder vivant le cœur (créer/payer une sortie).

Et comme `sorties-svc` tourne en **4 instances** derrière un load balancer, un compteur « 30 req/min » gardé **en mémoire locale** de chaque instance autorise en réalité **120 req/min** par famille : il faut un **état partagé** (Redis). Ce module te donne les algorithmes, l'état partagé atomique, et les deux mécanismes systémiques (backpressure, load shedding) — plus la bonne réponse HTTP à renvoyer.

---

## 2. Théorie complète, concise

### 2.1 Trois choses différentes : rate limiting, load shedding, backpressure

On les confond parce qu'ils « rejettent du trafic », mais ils répondent à des questions distinctes.

- **Rate limiting** — *« ce client a-t-il droit à cette requête maintenant ? »* Plafond **par client / par clé**, **toujours actif** même système sain. But : **équité** (aucun client ne monopolise) et **protection** contre l'abus involontaire. Décision **locale à la requête**, sans regarder la charge globale.
- **Load shedding (délestage)** — *« le système est-il trop chargé pour accepter ça ? »* Décision **globale**, basée sur des **signaux de charge** (CPU, profondeur de queue, latence). **Ne s'active qu'en surcharge**. But : protéger la **stabilité de l'ensemble** en sacrifiant du travail — de préférence le **moins prioritaire**.
- **Backpressure (contre-pression)** — *« le consommateur ne suit pas : comment le dire au producteur ? »* Ce n'est pas un rejet mais un **signal de flux** : le maillon aval **saturé** fait **ralentir** l'amont (bloquer, buffer borné, `pause()`, fenêtre TCP, crédit de flux). But : éviter qu'un producteur rapide **noie** un consommateur lent et fasse **exploser la mémoire**.

Image mnémonique : le rate limiting est un **videur** à l'entrée (par personne) ; le load shedding est le patron qui **ferme la porte** quand la salle est pleine et ne laisse entrer que les VIP ; le backpressure est la **file qui remonte** et fait patienter dehors au lieu d'entasser dans le couloir.

### 2.2 Token bucket — débit moyen + bursts contrôlés

Un **seau** (bucket) de capacité `B` **tokens**. On **ajoute** des tokens à débit constant `r` (tokens/s) jusqu'à `B` max. Chaque requête **consomme** un token ; s'il n'y en a pas, elle est **rejetée** (ou attend).

- Débit **moyen** long terme = `r`.
- **Burst** autorisé = jusqu'à `B` requêtes d'un coup (seau plein), puis retour au régime `r`.
- Seau plein → les tokens en trop sont **perdus** (pas d'accumulation infinie de « crédit »).

C'est l'algorithme **de référence** pour les API : il autorise des **rafales courtes** (un client qui charge 10 écrans d'un coup) tout en **bornant** le débit soutenu. Mémoire **O(1)** : on ne stocke que `(tokens, lastRefill)`. Astuce clé : on **ne** remplit **pas** avec un timer ; on calcule les tokens accumulés **au moment de la requête** (`tokens += (now - lastRefill) * r`, plafonné à `B`) — c'est le *lazy refill*.

### 2.3 Leaky bucket — débit de sortie strictement constant

Le **leaky bucket** est un seau **percé** : les requêtes entrent dans une **file** (FIFO) et **sortent** à débit **constant** (une fuite régulière). File pleine → les nouvelles requêtes sont **jetées**.

Différence essentielle avec le token bucket : le leaky bucket **lisse** le trafic — la sortie est **toujours** régulière, **aucun burst** ne passe (les rafales sont mises en file et étalées). Le token bucket, lui, **laisse passer** un burst tant qu'il reste des tokens. Donc :

- Tu veux **absorber des rafales** et rester réactif → **token bucket**.
- Tu veux un **débit de sortie parfaitement lissé** (protéger un aval fragile qui déteste les à-coups) → **leaky bucket**.

Coût : le leaky bucket maintient une **file** (mémoire liée à sa taille) et **retarde** les requêtes au lieu de les rejeter tout de suite.

### 2.4 Fixed window counter — et son défaut de frontière

Le plus simple : un **compteur** par fenêtre de temps fixe. Clé = `client:timestamp_de_fenêtre`. On `INCR` ; si le compteur dépasse `N`, on rejette ; la fenêtre suivante repart de zéro. Mémoire **O(1)**, trivial à implémenter.

**Le piège (burst 2×).** Comme la fenêtre **saute** brutalement, un client peut envoyer `N` requêtes dans les **dernières** millisecondes de la fenêtre 1 **et** `N` dans les **premières** de la fenêtre 2 : **2N** requêtes en un court intervalle à cheval, alors que la limite « voulue » est `N` par fenêtre. Acceptable pour du grossier, insuffisant pour une limite stricte.

### 2.5 Sliding window log — précis mais coûteux

On stocke le **timestamp de chaque requête**. À chaque appel : on **purge** les timestamps hors de la fenêtre glissante `[now - W, now]`, on **compte** ce qui reste ; si `< N`, on accepte et on ajoute `now`.

- **Précision exacte** : pas de problème de frontière, la fenêtre glisse en continu.
- **Coût** : mémoire **O(n)** — un timestamp **par requête** dans la fenêtre. Un client à 1 000 req/min stocke 1 000 entrées. Cher à grande échelle (souvent implémenté par un `ZSET` Redis, avec `ZREMRANGEBYSCORE` pour purger).

### 2.6 Sliding window counter — le compromis O(1)

On garde **deux compteurs** (fenêtre courante + précédente) et on **interpole** : estimation = `précédent × (part de la fenêtre précédente encore dans la fenêtre glissante) + courant`. On approxime la précision du sliding window log **sans** stocker chaque timestamp → mémoire **O(1)**. C'est le compromis retenu par la plupart des rate limiters de production (ex. Cloudflare) : quasi la précision du log, le coût du fixed window.

| Algorithme | Mémoire | Précision | Autorise burst | Complexité |
|---|---|---|---|---|
| Fixed window | O(1) | Faible (2× à la frontière) | 2× | Très simple |
| Sliding window log | O(n) | Exacte | Non | Simple |
| Sliding window counter | O(1) | Bonne (approx.) | ~Non | Moyenne |
| Token bucket | O(1) | Bonne | **Oui** (jusqu'à `B`) | Simple |
| Leaky bucket | O(taille file) | Exacte (débit lissé) | Non | Moyenne |

### 2.7 Rate limiting distribué — pourquoi l'état doit être partagé

Un compteur **en mémoire locale** d'une instance ne connaît **que** le trafic vu **par cette instance**. Avec 4 instances derrière un load balancer, une limite « 30/min » gardée localement laisse en réalité passer **~120/min** par client (30 × 4), et de façon **inéquitable** selon le routage. Il faut un **magasin partagé, rapide, atomique** : **Redis** est le choix classique (latence sub-milliseconde, opérations atomiques).

**Le point dur : l'atomicité.** Un rate limiter naïf fait `GET` puis `INCR` puis `EXPIRE` en trois allers-retours — c'est une **race condition** : deux instances lisent `29`, incrémentent chacune, et on dépasse. Il faut que **lecture + incrément + expiration** soient **une seule opération atomique**. Deux façons :

- **Script Lua** exécuté par Redis (Redis est **mono-thread** sur l'exécution d'un script → atomicité garantie) :

```lua
-- fixed window atomique : INCR + pose du TTL au premier hit de la fenêtre
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])  -- TTL = durée de la fenêtre (ms)
end
return current
```

  Le service compare le retour à `N`. Le `if current == 1` garantit qu'on **pose le TTL une seule fois** (à la création de la clé), sinon la fenêtre ne s'effacerait jamais.

- **`INCR` + `EXPIRE NX`** (variante sans Lua, depuis Redis 7 : `EXPIRE key ttl NX` ne pose le TTL que s'il n'existe pas). Le script Lua reste le plus portable et permet des algos plus riches (token bucket : lire `tokens`+`ts`, recalculer le refill, décrémenter, réécrire — **le tout atomique**).

> **Compromis distribué (lien CAP, module 09) :** centraliser l'état sur Redis crée une **dépendance** au disponible de Redis et un léger **surcoût réseau** par requête. En cas de Redis injoignable, tu choisis une **politique de repli** explicite : *fail-open* (laisser passer — on préfère servir que bloquer) ou *fail-closed* (rejeter — on préfère protéger). C'est une décision **métier**, pas un défaut à ignorer.

### 2.8 Quotas

Un **quota** est un rate limit exprimé côté **produit** : « plan gratuit = 1 000 req/jour », « une famille = 30 refresh/min ». Techniquement c'est le même mécanisme (compteur + fenêtre), mais la **clé** et la **fenêtre** encodent une règle métier : clé = `plan:famille123`, fenêtre = jour glissant. On distingue souvent **plusieurs quotas simultanés** (par seconde **et** par jour) — d'où les **politiques multiples** dans les en-têtes (§2.11). *La tarification / les plans commerciaux relèvent du cours 14, pas d'ici.*

### 2.9 Backpressure — propager la saturation vers l'amont

Le rate limiting protège **à l'entrée**. Le **backpressure** gère ce qui se passe **entre étages** d'un pipeline : un producteur rapide + un consommateur lent = une **queue qui gonfle** → mémoire épuisée → crash. La bonne réponse n'est pas de bufferiser à l'infini, mais de **ralentir le producteur**.

Mécanismes concrets :

- **Bornage de la file** : la queue a une **taille max** ; pleine, l'`enqueue` **bloque** (le producteur attend) ou **échoue** vite.
- **Pull plutôt que push** : le consommateur **tire** (`pull`) à son rythme au lieu de subir un `push` — le débit est **piloté par l'aval**. C'est le modèle des *streams* (`readable.pause()`/`resume()`, `highWaterMark` de Node), de la fenêtre de flux **TCP**, du **crédit** (credit-based flow control) de gRPC/HTTP-2, du *prefetch* borné d'un broker AMQP.
- **Signal explicite** : renvoyer `429`/`503 Retry-After` **est** une forme de backpressure côté HTTP — on dit au client « reviens plus tard ».

Règle : une queue **doit** être **bornée**. Une queue non bornée n'est pas un tampon, c'est une **fuite de mémoire à retardement**. Quand elle est pleine, tu **propages** (backpressure) ou tu **jettes** (load shedding) — mais tu ne « gardes pas tout ».

### 2.10 Load shedding — sacrifier le non-essentiel

Quand la charge dépasse ce que backpressure et rate limiting absorbent, il reste le **délestage** : **rejeter activement** une partie du trafic pour **sauver le reste**. Deux idées :

- **Admission control par priorité** : classe les requêtes (`critical` > `high` > `normal` > `low` > `background`). Sous surcharge (CPU haut, queue profonde, latence élevée), on **admet** d'abord les prioritaires et on **rejette** les basses. Un health-check ou un paiement passe ; un refresh de feed est sacrifié en premier.
- **Fail fast** : mieux vaut **rejeter vite et proprement** (`503` immédiat) que d'accepter une requête qu'on traitera **trop tard** (le client a déjà timeouté → travail **gaspillé**, qui aggrave la surcharge). Rejeter tôt libère des ressources pour ce qu'on garde.

Le load shedding est un **dernier rempart** : il dégrade **partiellement** (le non-essentiel) au lieu de laisser le système s'effondrer **totalement**.

### 2.11 La réponse HTTP correcte : 429, Retry-After, en-têtes RateLimit

Quand tu refuses pour cause de **quota client**, le code standard est **`429 Too Many Requests`** (défini par **RFC 6585 §4**). Quand tu refuses pour cause de **surcharge système** (load shedding), c'est **`503 Service Unavailable`**. Les deux **devraient** porter un **`Retry-After`**.

- **`Retry-After`** accepte **deux** formats (MDN / RFC 9110) : un **nombre de secondes** (`Retry-After: 42`) **ou** une **date HTTP** (`Retry-After: Wed, 21 Oct 2025 07:28:00 GMT`). Il indique **combien de temps attendre** avant de réessayer. Le format secondes est le plus courant pour du rate limiting.
- **En-têtes `RateLimit` (draft IETF `httpapi`, `draft-ietf-httpapi-ratelimit-headers`)** — pour informer le client **en continu** (même sur les `200`) de son quota restant :
  - `RateLimit-Policy: 100;w=60` — la politique : 100 requêtes par fenêtre de `w=60` secondes.
  - `RateLimit: limit=100, remaining=73, reset=42` — état courant : limite, quota restant, secondes avant reset.

  (Historiquement, les en-têtes non standard `X-RateLimit-Limit / -Remaining / -Reset` remplissent le même rôle et restent très répandus.)

Servir ces en-têtes transforme un client aveugle en client **coopératif** : un bon client lit `RateLimit`/`Retry-After` et **s'auto-régule** au lieu de marteler et de se faire jeter — ce qui réduit la charge à la source (moins de retries inutiles, cf. module 08 : `Retry-After` du serveur **prime** sur le backoff local).

---

## 3. Worked examples

### Exemple 1 — Token bucket distribué (Redis + Lua) pour protéger `/feed`

But : plafonner `GET /sorties/feed` à **30 req/min par famille avec un burst de 10**, de façon **cohérente sur les 4 instances**, et renvoyer un `429` propre. Token bucket : `B = 10` (capacité/burst), `r = 30/60 = 0.5` token/s.

**Étape 1 — le script Lua atomique** (tout le calcul token bucket se fait *dans* Redis) :

```lua
-- token_bucket.lua
-- KEYS[1] = clé du bucket (ex. "rl:feed:family123")
-- ARGV[1] = capacité B ; ARGV[2] = débit r (tokens/s) ; ARGV[3] = now (ms) ; ARGV[4] = coût
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end  -- premier hit : seau plein

-- LAZY REFILL : on ajoute les tokens accumulés depuis la dernière fois, plafonné à B
local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) * 2)  -- GC des buckets inactifs

-- retourne : autorisé ? tokens restants (entier), ms avant 1 token si refusé
local retry = 0
if allowed == 0 then retry = math.ceil((cost - tokens) / rate * 1000) end
return { allowed, math.floor(tokens), retry }
```

Points clés : **tout** (lecture, refill, décrément, réécriture) est **une** exécution atomique → pas de race entre les 4 instances. Le `PEXPIRE` évite d'accumuler des buckets morts. On **calcule** le refill, on n'utilise **aucun** timer.

**Étape 2 — le middleware NestJS/Express** qui appelle le script et pose les en-têtes :

```ts
// rate-limit.middleware.ts
const LIMIT = 30;                 // pour l'affichage RateLimit-Policy
const WINDOW_S = 60;
const CAPACITY = 10;              // burst
const RATE = 0.5;                 // 30/60 token/s

export function feedRateLimit(redis: Redis) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const familyId = req.query.familyId as string;
    const key = `rl:feed:${familyId}`;
    const now = Date.now();

    // redis.eval charge/exécute le script ; en prod on précharge via EVALSHA
    const [allowed, remaining, retryMs] = (await redis.eval(
      TOKEN_BUCKET_LUA, 1, key, CAPACITY, RATE, now, 1,
    )) as [number, number, number];

    // En-têtes informatifs — le client peut s'auto-réguler (draft IETF)
    res.setHeader('RateLimit-Policy', `${LIMIT};w=${WINDOW_S}`);
    res.setHeader('RateLimit', `limit=${LIMIT}, remaining=${remaining}, reset=${Math.ceil(retryMs / 1000)}`);

    if (!allowed) {
      const retryAfterSec = Math.max(1, Math.ceil(retryMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSec)); // format "secondes"
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Quota /feed dépassé. Réessaie dans ${retryAfterSec}s.`,
      });
    }
    next();
  };
}
```

**Ce que ce design achète :** un client buggé qui poll toutes les 2 s vide son seau en 20 s puis reçoit des `429` avec `Retry-After` — il ne mange plus le pool DB. La limite est **globale aux 4 instances** (état sur Redis). Le burst de 10 laisse un usage **normal** (ouvrir l'app, charger 3 écrans) passer sans friction. **Reste à décider :** la politique de repli si Redis tombe (§2.7) — ici on choisirait **fail-open** sur `/feed` (lecture non critique), mais **fail-closed** sur un endpoint de paiement.

### Exemple 2 — Backpressure + load shedding sur le pipeline de notifications

Contexte : publier une sortie déclenche un **fan-out** de notifications (200 familles → 200 push). Un `NotificationWorker` consomme une file interne et appelle un provider push **lent** (100 push/s max). Sans régulation, l'`enqueue` est illimité : un gros fan-out **gonfle la file** jusqu'à l'`OutOfMemory`.

**Backpressure — file bornée + pull :**

```ts
// notification-queue.ts — file BORNÉE : enqueue échoue vite quand c'est plein
class BoundedQueue<T> {
  private buf: T[] = [];
  constructor(private readonly max: number) {}

  tryEnqueue(item: T): boolean {
    if (this.buf.length >= this.max) return false; // ← backpressure : signal "plein"
    this.buf.push(item);
    return true;
  }
  dequeue(): T | undefined { return this.buf.shift(); }
  get depth() { return this.buf.length; }
}

// Le producteur (fan-out) DOIT réagir au signal : il ralentit au lieu d'entasser.
async function fanOut(familles: string[], q: BoundedQueue<PushJob>) {
  for (const f of familles) {
    while (!q.tryEnqueue({ familyId: f })) {
      await sleep(50); // la file est pleine → on ATTEND que le worker draine (pull-driven)
    }
  }
}
```

La file **bornée** transforme « producteur rapide » en « producteur **cadencé par l'aval** » : quand le worker n'a pas drainé, `fanOut` **patiente**. La mémoire ne peut plus exploser.

**Load shedding — délester le non-prioritaire sous surcharge :**

```ts
// admission.ts — sous forte profondeur de file, on JETTE le non-essentiel
type Priority = 'critical' | 'normal' | 'low';

function shouldAdmit(job: PushJob, q: BoundedQueue<PushJob>): boolean {
  const load = q.depth / q_MAX;              // 0..1
  if (job.priority === 'critical') return true;        // rappel de paiement : jamais jeté
  if (load > 0.9 && job.priority === 'low') return false;   // "sortie likée" : sacrifié en premier
  if (load > 0.98 && job.priority === 'normal') return false;
  return true;
}
```

**Pourquoi c'est correct :** le backpressure **borne** la mémoire (la file ne dépasse jamais `max`) et **cadence** le producteur ; le load shedding **choisit** quoi sacrifier quand ça déborde quand même — on garde les notifications **critiques** (paiement, annulation) et on **jette** les cosmétiques (« Untel a aimé »). Le système **dégrade** au lieu de **tomber**. Les push jetés peuvent partir en **DLQ** (module 05) pour un envoi différé, ou être simplement abandonnés si obsolètes.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre rate limiting, load shedding et backpressure

Ce sont **trois** outils pour **trois** questions. Rate limiting = plafond **par client**, toujours actif (équité). Load shedding = rejet **global** déclenché par la **charge** (survie). Backpressure = **signal de flux** entre étages (ne pas noyer un consommateur lent). Croire que « limiter par client » protège de la surcharge globale est faux : 10 000 clients **sous** leur quota peuvent quand même saturer le système → il faut **aussi** du load shedding.

### PIÈGE #2 — Compteur en mémoire locale derrière un load balancer

« J'ai un `Map` en mémoire, limite 30/min. » Avec **N instances**, chaque instance ne voit que **sa** part : la limite réelle devient **30 × N**, et elle varie selon le routage. Un rate limit qui doit être **global** exige un **état partagé** (Redis). La mémoire locale ne convient qu'à une limite **par-instance assumée** (ex. protéger le pool DB *local* d'une instance).

### PIÈGE #3 — `GET` puis `INCR` : la race condition

Lire le compteur, décider, puis incrémenter en **trois** allers-retours laisse deux instances lire la **même** valeur et dépasser. Le check-and-increment **doit** être **atomique** : script **Lua** (Redis exécute le script sans entrelacement) ou opération unique (`INCR` + `EXPIRE NX`). Un rate limiter distribué non atomique **fuit** sous concurrence — exactement quand il devrait tenir.

### PIÈGE #4 — Token bucket vs leaky bucket pris l'un pour l'autre

Le **token bucket laisse passer un burst** (jusqu'à `B`) puis lisse à `r` : bon pour une API réactive. Le **leaky bucket lisse tout** : sortie à débit **constant**, **aucun** burst, rafales mises en file. Choisir un leaky bucket là où tu voulais autoriser des rafales rend l'UX poussive ; choisir un token bucket pour protéger un aval qui **déteste** les à-coups le laisse encaisser des pics de `B`. Le besoin (« absorber les rafales » vs « débit de sortie lissé ») dicte l'algo.

### PIÈGE #5 — Fixed window et le burst 2× à la frontière

`INCR` par fenêtre est simple mais un client peut envoyer `N` en fin de fenêtre **et** `N` en début de la suivante → **2N** à cheval. Si ta limite est **stricte** (facturation, protection dure), passe en **sliding window** (log ou counter). Le fixed window ne convient qu'à du plafonnement **grossier**.

### PIÈGE #6 — Queue non bornée « pour ne rien perdre »

Une file sans taille max n'est **pas** un tampon de sécurité : c'est une **fuite de mémoire différée**. Sous charge soutenue, elle gonfle jusqu'à l'OOM et **tout** tombe — pire que de jeter proprement. Une queue **doit** être **bornée** ; pleine, tu appliques **backpressure** (ralentir l'amont) ou **load shedding** (jeter, idéalement le non-prioritaire). « Garder tout » n'est pas une option en régime saturé.

### PIÈGE #7 — Renvoyer un `429`/`503` **sans** `Retry-After`

Un `429` nu pousse le client à **réessayer immédiatement** (ou selon son propre backoff, parfois agressif) → tu aggraves la tempête que tu voulais calmer. Renvoie **toujours** `Retry-After` (secondes ou date HTTP) et, si possible, les en-têtes `RateLimit` : un client coopératif **attend** le bon délai et **cesse** de marteler. Et distingue `429` (quota **client**) de `503` (surcharge **système**) — ce ne sont pas les mêmes causes ni les mêmes remèdes.

---

## 5. Ancrage TribuZen

TribuZen subit des **pics** structurels : publication d'une grosse sortie, notification push qui réveille toutes les familles d'un coup, retry storm d'un client mobile buggé. Sans régulation, un endpoint de lecture fait tomber tout le domaine (le cas du §1).

**Protection en couches sur `sorties-svc` :**

```
Client mobile ─▶ [ Rate limiter distribué (token bucket / Redis) ]   ← §2.7, exemple 1
                        │ par famille : 30 req/min, burst 10
                        ▼ (429 + Retry-After si dépassé)
                 [ Admission control / load shedding ]                ← §2.10
                        │ sous forte charge : /feed sacrifié, createSortie gardé
                        ▼
                 [ File bornée + backpressure ]                       ← §2.9, exemple 2
                        │ fan-out notifications cadencé par le worker
                        ▼
                 provider push (100/s)
```

Décisions concrètes pour TribuZen :

- **Token bucket sur Redis** pour `/feed` : autorise l'usage normal en rafale (ouvrir l'app) mais borne un client fou ; **état partagé** sur les 4 instances (sinon la limite est × 4).
- **Priorités de load shedding** : `createSortie` / paiement = **critical** (jamais délesté) ; `/feed` refresh = **low** (sacrifié en premier sous surcharge). Un moment viral dégrade le *confort* (feed en retard), jamais le *cœur* (créer/payer).
- **File de notifications bornée** avec backpressure : le fan-out d'une grosse sortie **ne** gonfle **pas** la mémoire ; il est cadencé par le débit du provider push.
- **Réponses HTTP correctes** : `429 + Retry-After` sur dépassement de quota, `503 + Retry-After` sur load shedding, en-têtes `RateLimit` sur les `200` pour que l'app mobile s'auto-régule (et arrête son poll à 2 s).
- **Politique de repli Redis** : *fail-open* sur `/feed` (lecture non critique — mieux vaut servir), *fail-closed* sur un futur endpoint de paiement.

> **Défère :** le rate limiting comme **sécurité** (anti-brute-force login, anti-scraping, quotas par plan commercial) = **cours 14-securite** ; le **circuit breaker / bulkhead / timeout budget** qui protègent `sorties-svc` d'un **dépendant lent** (et non d'un afflux entrant) = **module 14 (ce cours)** ; le **placement** (rate limiter dans la gateway centralisée vs par service, module 07) et la **décision d'archi** = **cours 13-architecture** ; les **retries/backoff** côté client qui **consomment** le `Retry-After` = **module 08**. Ici : les mécanismes de débit et leurs garanties.

---

## 6. Points clés

1. **Trois outils, trois questions** : rate limiting (plafond **par client**, toujours actif, équité) ≠ load shedding (rejet **global** déclenché par la **charge**, survie) ≠ backpressure (**signal de flux** pour ne pas noyer un consommateur lent).
2. **Token bucket** = débit moyen `r` + **burst** jusqu'à `B` ; **lazy refill** (pas de timer), mémoire O(1) — l'algo de référence des API.
3. **Leaky bucket** = file FIFO à **débit de sortie constant**, **aucun** burst — pour lisser le trafic vers un aval fragile.
4. **Fixed window** (O(1), simple, **burst 2× à la frontière**) < **sliding window log** (exact, O(n)) ≈ **sliding window counter** (O(1), interpolé, le bon compromis).
5. **Rate limiting distribué** : un compteur **local** derrière N instances vaut **× N** → **état partagé Redis**. Le check-and-increment **doit être atomique** (script **Lua** : `INCR`+`PEXPIRE`, ou token bucket recalculé dans le script).
6. **Backpressure** : borner les queues, **pull** plutôt que push, propager la saturation vers l'amont. Une queue **non bornée** = fuite mémoire à retardement.
7. **Load shedding** : sous surcharge, **rejeter le non-prioritaire** (admission control) et **fail fast** — dégrader partiellement plutôt que tomber totalement.
8. **HTTP** : `429 Too Many Requests` (RFC 6585) pour un quota client, `503` pour une surcharge système ; **toujours** `Retry-After` (secondes **ou** date HTTP) ; en-têtes `RateLimit` (draft IETF : `RateLimit-Policy: 100;w=60`, `RateLimit: limit=…, remaining=…, reset=…`) pour un client coopératif.

---

## 7. Seeds Anki

```
Rate limiting, load shedding et backpressure : quelle différence ?|Rate limiting = plafond PAR CLIENT/clé, toujours actif, pour l'équité (aucun client ne monopolise). Load shedding = rejet GLOBAL déclenché par la charge (CPU, queue, latence), seulement en surcharge, pour la survie du système (sacrifier le non-prioritaire). Backpressure = signal de FLUX entre étages : un consommateur saturé fait ralentir le producteur pour ne pas exploser la mémoire.
Token bucket vs leaky bucket ?|Token bucket : un seau de B tokens rempli à r tokens/s ; chaque requête consomme un token → débit moyen r AVEC bursts autorisés jusqu'à B (seau plein). Leaky bucket : file FIFO vidée à débit CONSTANT ; les rafales sont mises en file et lissées → AUCUN burst ne passe. Token bucket pour absorber des rafales ; leaky bucket pour un débit de sortie strictement lissé.
Quel est le défaut du fixed window counter et comment le corriger ?|Le burst 2× à la frontière : un client peut envoyer N requêtes en fin de fenêtre 1 ET N en début de fenêtre 2 → 2N sur un court intervalle à cheval, alors que la limite voulue est N/fenêtre. Correction : sliding window log (exact mais O(n) mémoire, un timestamp par requête) ou sliding window counter (O(1), interpole entre fenêtre courante et précédente — le bon compromis).
Pourquoi un rate limiter en mémoire locale ne marche pas derrière plusieurs instances, et quelle est la solution ?|Chaque instance ne voit que SON trafic : une limite "30/min" gardée localement laisse passer 30 × N (N instances), de façon inéquitable selon le routage. Solution : un état PARTAGÉ rapide et atomique = Redis. Impératif : le check-and-increment doit être ATOMIQUE (script Lua exécuté par Redis, ou INCR + EXPIRE NX) — sinon deux instances lisent la même valeur et dépassent (race condition).
Pourquoi un script Lua pour un rate limiter Redis plutôt que GET puis INCR ?|Parce que GET → décision → INCR en trois allers-retours est une race condition : deux instances lisent la même valeur et incrémentent chacune → dépassement. Redis exécute un script Lua de façon atomique (mono-thread, sans entrelacement) : lecture + incrément + pose du TTL (INCR puis PEXPIRE si current==1) en UNE opération. Idem pour un token bucket : lire tokens+ts, recalculer le refill, décrémenter, réécrire, le tout atomique.
Qu'est-ce que le backpressure et pourquoi une queue doit-elle être bornée ?|Backpressure = quand un consommateur ne suit pas, on fait RALENTIR le producteur (file bornée qui bloque/échoue à l'enqueue, modèle pull, fenêtre TCP, crédit gRPC/HTTP-2) au lieu d'accumuler. Une queue NON bornée n'est pas un tampon : c'est une fuite de mémoire à retardement (elle gonfle jusqu'à l'OOM et tout tombe). Bornée : pleine, on propage (backpressure) ou on jette (load shedding).
Comment répondre correctement en HTTP quand on rejette pour rate limiting ou surcharge ?|Quota client dépassé → 429 Too Many Requests (RFC 6585). Surcharge système (load shedding) → 503 Service Unavailable. Dans les deux cas, TOUJOURS un Retry-After (nombre de secondes OU date HTTP) pour dire quand réessayer. En bonus, les en-têtes RateLimit (draft IETF) même sur les 200 : RateLimit-Policy: 100;w=60 et RateLimit: limit=100, remaining=73, reset=42 → le client s'auto-régule au lieu de marteler.
C'est quoi le load shedding et comment choisir quoi rejeter ?|Load shedding = dernier rempart : sous surcharge, rejeter ACTIVEMENT du trafic pour sauver le reste. Admission control par priorité : classer les requêtes (critical > high > normal > low > background) et, quand CPU/queue/latence montent, admettre d'abord les prioritaires, jeter les basses. + Fail fast : rejeter vite (503) plutôt qu'accepter une requête qu'on traitera trop tard (client déjà timeouté = travail gaspillé). On dégrade partiellement au lieu de tomber totalement.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-15-rate-limiting-et-backpressure/README.md`. Implémenter un **rate limiter token bucket distribué** avec Redis (script Lua atomique) pour protéger l'endpoint `/feed` de TribuZen, via un docker-compose fourni (API × 2 instances + Redis) : écrire le script Lua, poser les en-têtes `429 + Retry-After` + `RateLimit`, **prouver** que la limite tient bien **globalement** sur les 2 instances (et échoue si l'état est local), puis ajouter du **load shedding par priorité** et un **backpressure** sur la file de notifications. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
