# Lab 15 — Rate limiting & backpressure

> **Outcome :** à la fin, tu sais **protéger un vrai service** contre un pic de trafic — écrire un **token bucket** local, **prouver** qu'il fuit derrière 2 instances, le rendre **distribué** via un **script Lua atomique sur Redis**, renvoyer un **`429 + Retry-After`** correct, **déclencher** le dépassement avec un script de charge réel, puis **borner** une file de notifications avec du **backpressure** — et **expliquer** chaque garantie.
> **Vrai outil :** **Redis** (via `docker-compose` fourni) + un service **Node/TypeScript** (Express + `ioredis`) lancé en **2 instances** derrière un mini load balancer, + un **script de charge** en Node natif (aucun mock). Redis réel, script Lua réel exécuté par Redis, vrais `429`. **Aucun harnais simulé, aucun auto-correcteur.**
> **Feedback :** le coach valide en session à la grille ci-dessous.

---

## Objectif

Tu protèges l'endpoint `GET /sorties/feed` de `sorties-svc` (le cas du §1 du module) : un client mobile buggé passe de 50 à 3 000 req/s et sature le pool DB. Tu dois plafonner chaque famille à **30 req/min avec un burst de 10**, **de façon cohérente sur les 2 instances**, et refuser proprement le surplus.

Tu obtiens, sur une **vraie infra**, ces comportements et tu **sais les provoquer** :

1. Un token bucket **en mémoire locale** limite bien… **une** instance — et **fuit à ×2** dès qu'il y en a deux.
2. Un token bucket **distribué** (état sur Redis, décrément **atomique** via Lua) tient **globalement** sur les 2 instances.
3. Le dépassement renvoie un **`429 Too Many Requests`** avec un **`Retry-After`** juste et des en-têtes `RateLimit`.
4. Une **file de notifications bornée** applique du **backpressure** : le fan-out d'une grosse sortie **ne fait pas exploser la mémoire**.

> Pas de gap-fill : tu écris le middleware, le script Lua et le script de charge à partir de la page blanche. Le corrigé plus bas est une **référence de débrief**, pas un modèle à recopier.

---

## Prérequis

- **Module 15** de ce cours lu (token bucket, lazy refill, atomicité Lua, `429`/`Retry-After`, backpressure).
- Docker + Docker Compose installés (`docker compose version` répond).
- Node 20+ et un client HTTP (le script de charge fourni suffit — pas besoin d'outil externe).
- Rappels utiles : **module 08** (retries/backoff — le client consomme le `Retry-After`), **module 09** (CAP — la politique de repli si Redis tombe).

---

## Mise en place

Crée un dossier de lab, place-y le `docker-compose.yml` et lance-le. Tu montes **Redis** + **2 instances** de `sorties-svc` derrière un **Nginx** qui répartit le trafic (round-robin) — c'est le load balancer qui rend le bug « ×2 » observable.

```yaml
# docker-compose.yml — Redis + 2 instances de sorties-svc + Nginx (load balancer)
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"       # exposé pour inspecter avec redis-cli MONITOR
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 3s
      retries: 10

  svc-a:
    build: .
    environment:
      INSTANCE_ID: "svc-a"
      REDIS_URL: "redis://redis:6379"
      PORT: "3000"
    depends_on:
      redis:
        condition: service_healthy

  svc-b:
    build: .
    environment:
      INSTANCE_ID: "svc-b"
      REDIS_URL: "redis://redis:6379"
      PORT: "3000"
    depends_on:
      redis:
        condition: service_healthy

  lb:
    image: nginx:1.27-alpine
    ports:
      - "8080:8080"       # tout le trafic client entre ici → réparti sur svc-a / svc-b
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - svc-a
      - svc-b
```

```nginx
# nginx.conf — round-robin sur les 2 instances (rend le bug "compteur local ×N" visible)
events {}
http {
  upstream sorties {
    server svc-a:3000;
    server svc-b:3000;
  }
  server {
    listen 8080;
    location / {
      proxy_pass http://sorties;
      proxy_set_header X-Instance $upstream_addr;   # pour voir quelle instance a répondu
    }
  }
}
```

```dockerfile
# Dockerfile — image commune aux 2 instances
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npx", "tsx", "server.ts"]
```

```bash
npm init -y && npm i express ioredis && npm i -D typescript tsx @types/express @types/node
docker compose up --build      # Redis + svc-a + svc-b + lb:8080
```

Tout le trafic client tape **http://localhost:8080** (le LB). Garde un terminal sur `docker compose exec redis redis-cli monitor` pour **voir** les commandes que ton script Lua envoie.

---

## Étapes (en friction)

Fais-le **dans cet ordre**, sans lire le corrigé, en **écrivant** le code et en **observant** ce qui se passe (réponses HTTP + `redis-cli monitor`).

### Étape 1 — Le service nu (reproduis le problème)

Écris `server.ts` : un Express qui expose `GET /sorties/feed?familyId=...` et renvoie `200` avec un petit payload. Ajoute un log `INSTANCE_ID` sur chaque requête. Lance et vérifie que le LB alterne bien `svc-a` / `svc-b` (le header `X-Instance` change).

### Étape 2 — Token bucket **local** (et sa fuite)

Ajoute un middleware `localRateLimit` qui tient un `Map<familyId, { tokens, ts }>` **en mémoire du process**. Applique le token bucket **lazy refill** : `B = 10`, `r = 0.5` token/s (= 30/min). Refuse à `429` quand le seau est vide.

Teste **sur une seule instance** d'abord (`http://svc-a` en direct si tu l'exposes, ou arrête `svc-b`) : après 10 requêtes rapides, tu prends des `429`. **Correct.**

Puis teste **via le LB** (`:8080`, les 2 instances up) avec le script de l'étape 4 : tu obtiens **~20 requêtes** acceptées d'affilée au lieu de 10. **C'est la fuite ×2** : chaque instance a **son** `Map`. Note-le — c'est le piège #2 du module, rendu concret.

### Étape 3 — Token bucket **distribué** (script Lua atomique)

Écris `token_bucket.lua` : lecture de `(tokens, ts)`, **lazy refill** calculé **dans** Redis, décrément, réécriture, `PEXPIRE` — le tout en **une** exécution atomique. Le script retourne `{ autorisé, tokens_restants, retry_ms }`.

Remplace `localRateLimit` par un middleware `distributedRateLimit` qui appelle le script via `redis.eval(...)` sur la clé `rl:feed:<familyId>`. Relance le script de charge via le LB : cette fois **10 requêtes** passent au total, **peu importe** l'instance qui répond. Vérifie dans `redis-cli monitor` que tu vois bien **un seul** `EVALSHA` par requête (pas de `GET` puis `HSET` séparés — sinon race condition, piège #3).

### Étape 4 — Script de charge pour **déclencher le 429**

Écris `load.ts` (Node natif, `fetch`) : envoie **40 requêtes** en rafale sur `:8080/sorties/feed?familyId=fam-123` et **compte** les `200` vs `429`. Affiche pour chaque `429` la valeur de `Retry-After` et l'en-tête `RateLimit`. Attendu après l'étape 3 : **~10 × `200`** puis **~30 × `429`**, avec un `Retry-After` en secondes cohérent (≈ le temps de regagner 1 token). Attends ce délai, rejoue **1** requête → elle passe.

### Étape 5 — Backpressure sur la file de notifications

Publier une sortie déclenche un **fan-out** (200 familles → 200 push) vers un provider **lent** (100 push/s). Écris une **`BoundedQueue`** (taille max) + un `fanOut` qui **attend** (`await sleep`) quand `tryEnqueue` renvoie `false`. Prouve que la profondeur de file **ne dépasse jamais** `max`, même avec un fan-out de 5 000 : le producteur est **cadencé par l'aval**. (Bonus : ajoute un `shouldAdmit` par priorité — le refresh `low` est jeté avant le paiement `critical`.)

### Étape 6 — Verbalise la garantie

En 5 lignes : « Le compteur local fuit à ×N parce que… », « le script Lua est atomique parce que… », « mon `Retry-After` vaut X parce que… », « ma file ne peut pas OOM parce que… ». Si tu ne peux pas l'écrire, reviens à l'étape concernée.

---

## Grille d'évaluation (coach)

Le coach coche. Objectif : **autonomie page blanche**, pas la beauté du code.

| # | Critère | Vert | Rouge |
|---|---------|------|-------|
| 1 | **Token bucket correct** | Lazy refill (`tokens += elapsed × r`, plafonné à `B`), pas de timer ; burst `B` autorisé puis régime `r` | Refill par `setInterval`, ou pas de plafond à `B`, ou consomme sans recalculer le temps écoulé |
| 2 | **Fuite locale prouvée** | Sait **montrer** ~20 acceptées via le LB avec le compteur en `Map`, et **expliquer** que chaque instance a son état | « Ça marche » sur une instance sans jamais tester les deux ; ne voit pas le ×N |
| 3 | **Atomicité distribuée** | Décrément **dans** un script Lua (une seule exécution) ; `redis-cli monitor` montre `EVAL/EVALSHA`, pas `GET`+`HSET` séparés | `GET` puis `HSET` en plusieurs allers-retours (race) ; ou logique de bucket côté Node avec Redis comme simple stockage |
| 4 | **Limite globale tenue** | 10 acceptées **au total** via le LB, indépendamment de l'instance ; `PEXPIRE` pose un TTL (pas de buckets morts) | La limite dépend de l'instance touchée ; ou clé sans TTL qui s'accumule |
| 5 | **429 correct** | `429` (pas 400/403) **avec** `Retry-After` en secondes cohérent + en-têtes `RateLimit` ; `200` portent aussi `RateLimit` | `429` nu sans `Retry-After` (piège #7), ou `Retry-After` bidon, ou mauvais code HTTP |
| 6 | **Backpressure borné** | File **bornée** ; `tryEnqueue` refuse quand plein, le producteur **attend** ; profondeur ≤ `max` prouvée sous gros fan-out | File non bornée « pour ne rien perdre » (piège #6) ; ou enqueue qui ignore le signal plein |
| 7 | **Verbalisation** | Sait dire pourquoi le local fuit à ×N, pourquoi Lua est atomique (Redis mono-thread sur le script), et distinguer `429` (quota) de `503` (surcharge) | Confond rate limiting / backpressure / load shedding ; croit qu'un `GET`+`INCR` non atomique suffit |

**Seuil de réussite :** 6/7 au vert, dont **obligatoirement** #3 (atomicité) et #4 (limite globale) — c'est tout l'enjeu du « distribué ».

---

## Débrief coach — seeds de relance

Le coach ne laisse pas passer un lab « qui a l'air de marcher ». Il **sonde** (au fil, pas en rafale) :

- « Ton compteur en `Map` limite à 30/min. Il y a 2 instances derrière le LB. Combien une famille passe-t-elle **vraiment** par minute, et pourquoi ? Montre-le avec ton script de charge. »
- « Enlève le script Lua : fais `HMGET` puis `HSET` en deux appels côté Node. Lance 40 requêtes concurrentes. Combien passent au-dessus de 10, et **pourquoi** ? Où est la fenêtre de course ? »
- « Ton `429` sort. Un client qui reçoit un `429` **nu**, il fait quoi dans la seconde ? Et avec ton `Retry-After` ? Lequel calme la tempête, lequel l'aggrave ? »
- « D'où vient le chiffre exact de ton `Retry-After` ? Prouve-le : il reste 0,3 token, `r = 0,5/s`, tu renvoies combien ? »
- « `429` ou `503` : si c'est le CPU du service qui est à 95 % et pas le quota de la famille, tu renvoies lequel, et pourquoi ce n'est pas le même ? »
- « Ta file de notifications est pleine et le fan-out continue. Sans borne, dessine la courbe mémoire dans 30 s. Avec ta borne, qui attend qui ? »
- « Redis tombe en pleine soirée. Sur `/feed`, tu laisses passer (fail-open) ou tu bloques (fail-closed) ? Et sur un futur endpoint de paiement ? Justifie chaque choix. »

---

## Corrigé de référence (pour le débrief — ne pas ouvrir avant d'avoir produit ton code)

**`token_bucket.lua`** — tout le calcul token bucket **dans** Redis, atomique :

```lua
-- token_bucket.lua
-- KEYS[1] = clé du bucket (ex. "rl:feed:fam-123")
-- ARGV[1] = capacité B ; ARGV[2] = débit r (tokens/s) ; ARGV[3] = now (ms) ; ARGV[4] = coût
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local cost     = tonumber(ARGV[4])

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
if tokens == nil then tokens = capacity; ts = now end   -- premier hit : seau plein

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

local retry = 0
if allowed == 0 then retry = math.ceil((cost - tokens) / rate * 1000) end
return { allowed, math.floor(tokens), retry }   -- {autorisé, tokens restants, ms avant 1 token}
```

**`server.ts`** — Express + middleware distribué qui appelle le script et pose les en-têtes :

```ts
// server.ts
import express from 'express';
import Redis from 'ioredis';
import { readFileSync } from 'node:fs';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const INSTANCE = process.env.INSTANCE_ID ?? 'svc-?';

// Politique affichée + paramètres du bucket
const LIMIT = 30;          // pour l'affichage RateLimit-Policy
const WINDOW_S = 60;
const CAPACITY = 10;       // burst B
const RATE = 0.5;          // 30/60 token/s
const TOKEN_BUCKET_LUA = readFileSync('./token_bucket.lua', 'utf8');

function distributedRateLimit() {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const familyId = String(req.query.familyId ?? 'anon');
    const key = `rl:feed:${familyId}`;
    const now = Date.now();

    // eval : Redis charge+exécute le script atomiquement (en prod : evalsha pour éviter de renvoyer le source)
    const [allowed, remaining, retryMs] = (await redis.eval(
      TOKEN_BUCKET_LUA, 1, key, CAPACITY, RATE, now, 1,
    )) as [number, number, number];

    // En-têtes informatifs (draft IETF) — même sur les 200, le client peut s'auto-réguler
    res.setHeader('RateLimit-Policy', `${LIMIT};w=${WINDOW_S}`);
    res.setHeader('RateLimit', `limit=${LIMIT}, remaining=${remaining}, reset=${Math.ceil(retryMs / 1000)}`);

    if (!allowed) {
      const retryAfter = Math.max(1, Math.ceil(retryMs / 1000)); // format "secondes"
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Quota /feed dépassé. Réessaie dans ${retryAfter}s.`,
      });
    }
    next();
  };
}

const app = express();
app.get('/sorties/feed', distributedRateLimit(), (req, res) => {
  // Ici, en vrai, buildFeed(familyId) : 3 jointures + sérialisation. On simule un 200 léger.
  res.json({ instance: INSTANCE, familyId: req.query.familyId, sorties: [] });
});

app.listen(Number(process.env.PORT ?? 3000), () =>
  console.log(`[${INSTANCE}] up`),
);
```

**`load.ts`** — script de charge natif qui déclenche le `429` :

```ts
// load.ts — 40 requêtes en rafale sur le LB, compte 200 vs 429
const URL = 'http://localhost:8080/sorties/feed?familyId=fam-123';

async function main() {
  const results = await Promise.all(
    Array.from({ length: 40 }, () => fetch(URL)),
  );
  let ok = 0, limited = 0;
  for (const r of results) {
    if (r.status === 200) ok++;
    else if (r.status === 429) {
      limited++;
      // Sur le premier 429, on lit les en-têtes de régulation
      if (limited === 1) {
        console.log('  Retry-After :', r.headers.get('retry-after'), 's');
        console.log('  RateLimit   :', r.headers.get('ratelimit'));
      }
    }
  }
  console.log(`200 = ${ok}  |  429 = ${limited}`); // attendu ~ 10 / 30 après l'étape 3
}
main();
```

**`notification-queue.ts`** — file bornée + backpressure (étape 5) :

```ts
// notification-queue.ts
type Priority = 'critical' | 'normal' | 'low';
interface PushJob { familyId: string; priority: Priority }

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Le producteur DOIT réagir au signal : il ralentit au lieu d'entasser.
async function fanOut(familles: string[], q: BoundedQueue<PushJob>) {
  for (const f of familles) {
    while (!q.tryEnqueue({ familyId: f, priority: 'low' })) {
      await sleep(10); // file pleine → on ATTEND que le worker draine (cadencé par l'aval)
    }
  }
}

// Load shedding optionnel : sous forte profondeur, on jette le non-essentiel.
function shouldAdmit(job: PushJob, q: BoundedQueue<PushJob>, max: number): boolean {
  const load = q.depth / max;
  if (job.priority === 'critical') return true;              // paiement : jamais jeté
  if (load > 0.9 && job.priority === 'low') return false;    // "sortie likée" : sacrifié
  return true;
}
```

**Pourquoi c'est correct :**
- **Fuite locale** : un `Map` par process → 2 instances = 2 seaux → limite réelle ×2. Seul un **état partagé** (Redis) donne une limite **globale** (piège #2).
- **Atomicité** : Redis exécute le script Lua **sans entrelacement** (mono-thread sur l'exécution du script). Lecture + refill + décrément + réécriture forment **une** opération → pas de race entre `svc-a` et `svc-b`, contrairement à un `HMGET` puis `HSET` en deux allers-retours (piège #3).
- **Lazy refill** : on ne remplit pas avec un timer ; on calcule `tokens += elapsed × rate` au moment de la requête, plafonné à `B`. O(1) en mémoire, un burst de `B` passe puis le régime revient à `r`.
- **`429` coopératif** : `Retry-After` en secondes (dérivé du déficit de tokens) + en-têtes `RateLimit` sur **tous** les statuts → un bon client attend le bon délai au lieu de marteler (piège #7). On distingue `429` (quota **client**) de `503` (surcharge **système**, load shedding).
- **Backpressure** : la file **bornée** transforme « producteur rapide » en « producteur cadencé par l'aval » ; la profondeur ne dépasse jamais `max` → pas d'OOM (piège #6).

> Le `redis.eval` renvoie le source à chaque appel : en prod on précharge avec `SCRIPT LOAD` puis `EVALSHA` (économie de bande passante). La politique de repli si Redis est injoignable (**fail-open** sur `/feed` lecture non critique, **fail-closed** sur un paiement) est une décision **métier** à écrire explicitement (module 09).

---

## Variante J+30 (fading)

**Même exercice, contrainte ajoutée — de mémoire, en 30 minutes, sans rouvrir le module ni ce corrigé :**

TribuZen impose désormais **deux quotas simultanés** sur `/feed` : **10 req/s** (protéger le burst court) **ET** **1 000 req/jour** (quota produit). Une requête n'est admise que si elle passe **les deux**. Attendu :

1. Tu appliques **deux buckets** (ou un bucket + un compteur journalier) dans **un seul** script Lua atomique — pas deux allers-retours Redis.
2. Le `429` renvoie le `Retry-After` du quota **le plus contraignant** (celui qui reste le plus longtemps épuisé) et un `RateLimit-Policy` qui **liste les deux** politiques.
3. Tu expliques pourquoi il faut que les deux décréments soient dans **le même** script (sinon on peut décrémenter le quota jour sans admettre la requête, ou l'inverse → incohérence sous concurrence).

**Critère de réussite :** un seul appel Redis par requête, les deux quotas sont réellement appliqués (tu le prouves avec deux profils de charge : rafale courte vs long filet), et le `Retry-After` reflète le bon quota.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette protection se matérialise dans le backend `sorties-svc` :

```
tribuzen/
  apps/api/
    src/sorties/sorties.controller.ts          ← @Get('/sorties/feed') protégé par le guard
    src/rate-limit/rate-limit.guard.ts          ← guard NestJS qui appelle le script Lua
    src/rate-limit/token_bucket.lua             ← script atomique (chargé via SCRIPT LOAD au boot)
    src/rate-limit/redis.provider.ts            ← client ioredis partagé
    src/notifications/notification.worker.ts     ← file bornée + backpressure sur le fan-out
  docker-compose.yml                            ← redis pour le dev local
```

**Différences par rapport au lab :**
- Le middleware Express devient un **guard NestJS** (`canActivate`) ; la logique Lua est **identique**.
- Le script est chargé une fois au démarrage (`SCRIPT LOAD`) et appelé en **`EVALSHA`**, pas en `eval` à chaque requête.
- La **politique de repli Redis** (fail-open `/feed` / fail-closed paiement) est codée explicitement avec un fallback + une alerte (cours 16 — observabilité).
- Le load shedding par priorité est branché sur un **vrai signal de charge** (profondeur de queue, latence p99) plutôt qu'un ratio de file en dur.

**Commit cible :**
```
feat(sorties): rate limiter token bucket distribué (Redis + Lua) sur /feed + 429 Retry-After + backpressure notifications
```
