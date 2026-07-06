# Lab 07 — API Gateway & BFF

> **Outcome :** à la fin, tu sais **monter une gateway minimale** devant plusieurs services TribuZen — **router** (reverse proxy), **vérifier l'auth une seule fois en périphérie** puis **propager l'identité**, et **agréger** un écran d'accueil en un **fan-out parallèle** qui **dégrade** proprement quand un service optionnel tombe — puis **expliquer** pourquoi la gateway ne contient aucune logique métier.
> **Vrai outil :** **Express + TypeScript** (Node) pour la gateway, **3 services stub** réels lancés via `docker-compose`. Vrais appels HTTP inter-services, vrai JWT, vraie panne provoquée. **Aucun harnais simulé, aucun auto-correcteur.**
> **Feedback :** le coach valide en session à la grille ci-dessous.

---

## Énoncé

Tu implémentes l'**edge TribuZen** du module (§1). Trois services internes existent déjà (stubs fournis) : `familles-service` (3001), `sorties-service` (3002), `notifications-service` (3003). Deux clients (web, mobile) doivent passer par **une seule** adresse : ta gateway (8080).

Tu dois obtenir, sur de **vrais** services HTTP, les comportements suivants et **savoir les provoquer** :

1. La gateway est un **point d'entrée unique** : le client ne connaît que `localhost:8080`, jamais les ports internes.
2. L'auth est vérifiée **une seule fois en périphérie** ; l'identité (`X-User-Id`) est **propagée** aux services, qui ne redécodent pas le JWT.
3. `GET /api/home` **agrège** familles + sorties + notifications en **un** appel client, avec un **fan-out parallèle** (`Promise.all`).
4. Si `notifications-service` est **coupé**, l'accueil répond **quand même** (dégradation partielle), il ne plante pas.
5. Un **correlation ID** relie les logs de la gateway et des 3 services pour une même requête.
6. Tu **refuses** d'ajouter une règle métier dans la gateway et tu sais **dire pourquoi** (god object / goulot d'équipe).

> Pas de gap-fill : tu écris la gateway à partir de la page blanche. Le corrigé plus bas est une **référence de débrief**, pas un modèle à recopier.

### Setup — `docker-compose.yml` fourni

Crée ce fichier à la racine de ton dossier de lab. Il lance **3 stubs** (image `node`, un mini-serveur inline) que ta gateway appellera. Lance `docker compose up`.

```yaml
# docker-compose.yml — 3 services stub TribuZen (aucune gateway ici : tu l'écris à côté)
services:
  familles-service:
    image: node:22-alpine
    ports: ["3001:3001"]
    command: >
      node -e "require('http').createServer((q,r)=>{
        console.log('[familles]', q.headers['x-correlation-id'], q.headers['x-user-id'], q.url);
        r.setHeader('content-type','application/json');
        r.end(JSON.stringify({moi:{id:q.headers['x-user-id'],prenom:'Sylvain'},membres:3}));
      }).listen(3001)"

  sorties-service:
    image: node:22-alpine
    ports: ["3002:3002"]
    command: >
      node -e "require('http').createServer((q,r)=>{
        console.log('[sorties]', q.headers['x-correlation-id'], q.headers['x-user-id'], q.url);
        r.setHeader('content-type','application/json');
        r.end(JSON.stringify([{id:'s1',titre:'Parc',date:'2026-07-10',lieu:'Lyon',budget:0,notes:'...'}]));
      }).listen(3002)"

  notifications-service:
    image: node:22-alpine
    ports: ["3003:3003"]
    command: >
      node -e "require('http').createServer((q,r)=>{
        console.log('[notifs]', q.headers['x-correlation-id'], q.url);
        r.setHeader('content-type','application/json');
        r.end(JSON.stringify([{id:'n1',text:'Rappel sortie'}]));
      }).listen(3003)"
```

```bash
docker compose up            # démarre les 3 stubs (logs visibles = tu verras le correlation ID)
npm init -y && npm i express jose && npm i -D typescript tsx @types/express @types/node
```

> Le JWT : pour rester local, tu peux **signer un token HS256** avec `jose` et une clé de dev, ou (plus simple pour le lab) **décoder sans vérifier la signature** et vérifier seulement `exp` — mais **nomme** ce que tu simplifies dans `NOTES.md`.

### Livrables attendus

1. **`gateway.ts`** : écoute sur 8080, middleware **correlation ID**, middleware **edge auth** (JWT une fois), **reverse proxy** `/api/sorties/*` et `/api/familles/*` vers les stubs (topologie cachée, identité propagée).
2. **La route d'agrégation `GET /api/home`** : fan-out **parallèle** familles + sorties + notifs → **une** réponse ; **dégradation partielle** si notifs down.
3. **Un court `NOTES.md`** (8-12 lignes) : (a) où l'auth est vérifiée et ce que tu propages ; (b) preuve que le fan-out est parallèle (pas séquentiel) ; (c) ce que tu as **refusé** de mettre dans la gateway et pourquoi.

---

## Étapes (en friction)

Fais-le **dans cet ordre**, sans lire le corrigé, en **écrivant** le code et en **observant les logs** des 3 stubs (le correlation ID doit s'y retrouver) :

1. **Point d'entrée + correlation ID.** Démarre `gateway.ts` sur 8080. Middleware : lis `x-correlation-id` s'il existe sinon `randomUUID()`, remets-le sur la requête et en header de réponse. `curl -i localhost:8080/api/familles/me` → tu dois voir un `X-Correlation-Id` en réponse.
2. **Reverse proxy + topologie cachée.** Route `/api/familles/*` vers `http://localhost:3001` et `/api/sorties/*` vers `:3002`. Le client ne cite **jamais** 3001/3002. Vérifie dans les logs du stub que ta requête arrive avec le bon `x-correlation-id`.
3. **Auth en périphérie + propagation.** Ajoute `edgeAuth` : `401` si pas de `Bearer`, sinon décode le JWT, injecte `x-user-id` dans les appels amont. Vérifie dans les logs du stub `familles` que `x-user-id` **arrive** — le stub ne décode aucun JWT, il fait **confiance** à la gateway.
4. **Agrégation fan-out.** Écris `GET /api/home` : appelle les 3 services en **`Promise.all`**, renvoie `{ familles, sorties, notifications }`. Un seul `curl` → une réponse combinée. Regarde l'horodatage des 3 logs stub : ils doivent être **quasi simultanés** (parallèle), pas espacés (séquentiel).
5. **Provoque la dégradation partielle.** `docker compose stop notifications-service`. Rappelle `GET /api/home` : la réponse doit **arriver quand même** avec `notifications` à `null`/erreur, familles + sorties **intacts**. Si tout plante, tu propages l'échec au lieu de l'absorber → corrige.
6. **Refuse le god object.** Le coach te demande d'ajouter dans la gateway : « si la famille a plus de 4 membres, masque le budget des sorties ». **Refuse** et écris dans `NOTES.md` où cette règle doit vivre (dans `sorties-service` ou un BFF) et pourquoi (logique métier = monolithe déguisé + goulot d'équipe).

---

## Grille d'évaluation (coach)

Le coach coche. Objectif : **autonomie page blanche**, pas la beauté du code.

| # | Critère | Vert | Rouge |
|---|---------|------|-------|
| 1 | **Point d'entrée unique** | Le client n'utilise que `:8080` ; les ports internes n'apparaissent nulle part côté client | Le client tape encore un service en direct, ou la gateway expose les URLs internes |
| 2 | **Auth en périphérie + propagation** | JWT vérifié **une** fois dans la gateway ; `x-user-id` propagé ; le stub ne redécode rien | Auth refaite dans chaque stub, ou identité non propagée, ou pas de 401 sans token |
| 3 | **Reverse proxy correct** | Routing `/api/*` → bon service, correlation ID visible dans les logs stub | Réécriture de path cassée, headers non transmis, ou correlation ID absent en amont |
| 4 | **Fan-out parallèle** | Les 3 appels partent en `Promise.all` ; logs stub quasi simultanés | `await` en série (latences additionnées) — sait pas prouver que c'est parallèle |
| 5 | **Dégradation partielle** | notifs coupé → `/api/home` répond quand même, champ dégradé, reste intact | Un service optionnel down fait planter tout l'accueil (gateway qui amplifie la panne) |
| 6 | **Refus du god object** | Sait refuser une règle métier dans la gateway et dire où elle doit vivre + pourquoi | Ajoute la règle « parce que c'est central », ou ne voit pas le problème |

**Seuil de réussite :** 5/6 critères au vert, dont **obligatoirement** #2 (auth en périphérie) et #6 (refus du god object) — les deux qui séparent une vraie gateway d'un monolithe déguisé.

---

## Débrief coach — seeds de relance

Le coach ne laisse pas passer un lab « qui a l'air de marcher ». Il **sonde** (au fil, pas en rafale) :

- « Ton `/api/home` fait 3 appels. Montre-moi la ligne qui prouve qu'ils partent en parallèle. Transforme-la en série : de combien monte la latence ? »
- « Je coupe `notifications-service`. Sans changer ton code, que renvoie `/api/home` ? Si ça plante, qui a décidé que notifs était essentiel ? »
- « Le stub `familles` fait confiance à `x-user-id`. Qu'est-ce qui empêche un client de forger ce header et de se faire passer pour un autre ? (indice : il ne parle jamais à la gateway en direct, mais…) »
- « Je te demande de bloquer le budget si la famille est grande. Où mets-tu cette règle, et pourquoi PAS dans la gateway ? Donne-moi le mot exact de l'anti-pattern. »
- « Web et mobile veulent tous les deux `/home` mais le mobile veut moins de champs. Tu fais une gateway avec un `?fields=` ou deux BFF ? Qu'est-ce qui te fait pencher ? »
- « C'est quoi la différence entre ce que tu viens d'écrire et un simple `nginx` qui proxy ? Qu'est-ce que ta gateway fait qu'un reverse proxy nu ne fait pas ? »

---

## Corrigé de référence (pour le débrief — ne pas ouvrir avant d'avoir produit ton code)

**`gateway.ts`** — point d'entrée unique, edge auth, proxy, agrégation :

```ts
// gateway.ts
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

const SVC = {
  familles: 'http://localhost:3001',
  sorties:  'http://localhost:3002',
  notifs:   'http://localhost:3003',
};

// 1) correlation ID : généré au bord, propagé partout (socle du traçage distribué)
app.use((req: Request, res: Response, next: NextFunction) => {
  const cid = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  req.headers['x-correlation-id'] = cid;
  res.setHeader('X-Correlation-Id', cid);
  next();
});

// 2) edge auth : on vérifie le JWT UNE fois, puis on propage l'identité.
//    (lab : on décode et on vérifie exp ; en prod : vérifier la signature avec jose + clé)
function edgeAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing token' }); return; }
  try {
    const [, payloadB64] = auth.slice(7).split('.');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (claims.exp && claims.exp < Date.now() / 1000) { res.status(401).json({ error: 'Expired' }); return; }
    req.headers['x-user-id'] = claims.sub;      // identité injectée pour l'amont
    req.headers['x-roles'] = (claims.roles ?? []).join(',');
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

// headers propagés à chaque appel amont (identité + trace, PAS le JWT à redécoder)
function upstreamHeaders(req: Request): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-correlation-id': req.headers['x-correlation-id'] as string,
    'x-user-id': (req.headers['x-user-id'] as string) ?? '',
  };
}

// 3) reverse proxy générique : cache la topologie interne
async function proxy(base: string, prefix: string, req: Request, res: Response): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3_000); // timeout amont (deep = module 08)
  try {
    const path = req.originalUrl.replace(prefix, '');
    const up = await fetch(base + path, {
      method: req.method,
      headers: upstreamHeaders(req),
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
      signal: ctrl.signal,
    });
    res.status(up.status).json(await up.json());
  } catch (e) {
    const to = e instanceof Error && e.name === 'AbortError';
    res.status(to ? 504 : 502).json({ error: to ? 'Gateway timeout' : 'Bad gateway' });
  } finally { clearTimeout(t); }
}

app.use('/api/familles', edgeAuth, (req, res) => proxy(SVC.familles, '/api/familles', req, res));
app.use('/api/sorties',  edgeAuth, (req, res) => proxy(SVC.sorties,  '/api/sorties',  req, res));

// 4) agrégation : fan-out PARALLÈLE + dégradation partielle
app.get('/api/home', edgeAuth, async (req: Request, res: Response) => {
  const h = upstreamHeaders(req);
  const userId = req.headers['x-user-id'] as string;
  const get = (u: string) => fetch(u, { headers: h }).then(r => (r.ok ? r.json() : null)).catch(() => null);

  // Promise.all : la latence se MAXe (pas de somme). Un service optionnel qui échoue → null.
  const [familles, sorties, notifs] = await Promise.all([
    get(`${SVC.familles}/familles/me`),
    get(`${SVC.sorties}/sorties?membre=${userId}`),
    get(`${SVC.notifs}/notifications?unread=1`),
  ]);

  res.json({ familles, sorties, notifications: notifs ?? { error: 'unavailable' } });
});

app.listen(8080, () => console.log('[gateway] :8080'));
```

**Pourquoi c'est correct :**
- **Point d'entrée unique** : le client ne cite que `:8080` ; `proxy()` réécrit le path et masque `:3001/:3002`. Refactorer l'interne ne touche pas les clients.
- **Auth en périphérie** : `edgeAuth` vérifie le token **une** fois et injecte `x-user-id`. Les stubs ne redécodent **rien** — ils font confiance à la gateway sur le réseau interne. (L'**autorisation métier** — droit sur CETTE ressource — resterait dans le service, pas ici.)
- **Fan-out parallèle** : `Promise.all` lance les 3 `fetch` en même temps → la latence totale ≈ le plus lent, pas la somme. Les logs des 3 stubs sont quasi simultanés.
- **Dégradation partielle** : chaque `get()` `.catch(() => null)` ; `notifications` tombe à un champ d'erreur, familles + sorties restent servis. La gateway **absorbe** la panne au lieu de l'amplifier.
- **Pas de god object** : aucune règle métier, aucun accès base. Si on voulait masquer le budget « pour les grandes familles », ça irait dans `sorties-service` (ou un BFF), pas ici.

> Le décodage JWT sans vérif de signature est une **simplification de lab** (assumée dans `NOTES.md`). En prod : `jose.jwtVerify` avec la clé publique/secret, rotation des clés = cours 14.

---

## Variante J+30 (fading)

**Même exercice, contrainte ajoutée — de mémoire, en 30 minutes, sans rouvrir le module ni ce corrigé :**

TribuZen sort une **app mobile** dont l'écran d'accueil n'affiche que `titre/date/lieu` d'une sortie (le web veut tout : budget, notes, membres). Ajoute un **BFF mobile** distinct de la gateway web. Attendu :

1. Tu crées un **second backend d'entrée** (`mobile-bff.ts`, port 8090) qui appelle les mêmes services mais **projette** une réponse **allégée** (`GET /home` → `{ prenom, sorties: [{id, titre, date, lieu}] }`, sans budget ni notes).
2. Tu **nommes** pourquoi c'est un **BFF** et pas un paramètre `?fields=` sur la gateway générique : besoins **divergents** entre clients, maintenu par l'équipe mobile, focalisé sur **une** UI.
3. Tu **assumes** la duplication de la projection entre BFF web et mobile : tu ne factorises **pas** (couplage > duplication ici), et tu dis à partir de quand tu factoriserais (3ᵉ occurrence).

**Critère de réussite :** tu justifies le BFF **par la divergence des clients** (pas par préférence), la réponse mobile est **strictement plus petite** que la web, et tu sais dire pourquoi la logique de projection n'est **pas** de la logique métier (c'est de l'adaptation de forme pour l'UI).

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, l'edge se matérialise ainsi :

```
tribuzen/
  apps/
    gateway/           ← point d'entrée unique (routing, edge auth, correlation ID)
      src/gateway.ts
    web-bff/           ← BFF web (réponse riche)
      src/server.ts
    mobile-bff/        ← BFF mobile (réponse allégée)
      src/server.ts
  services/
    familles-service/  ← autorisation MÉTIER ici (pas dans l'edge)
    sorties-service/
    notifications-service/
  docker-compose.yml   ← services + gateway pour le dev local
```

**Ce qui sera ensuite branché (hors de ce lab) :**
- **Retries + timeouts + idempotency** sur les appels amont de la gateway → **module 08 (next)**.
- **Circuit breaker** par service amont dans la gateway (couper vite un service en panne) → **module 14**.
- **Rate limiting** réel par API key / IP (token bucket) → **module 15**.
- **Traçage distribué** OpenTelemetry qui exploite le correlation ID (spans, propagation de contexte) → **module 16** + **cours 16**.
- Le **choix d'archi** (une gateway ? combien de BFF ?) tranché au niveau design → **cours 13-architecture, module 17**.

**Commit cible :**
```
feat(edge): gateway TribuZen (reverse proxy, edge auth JWT propagée, agrégation /home fan-out + dégradation partielle)
```
