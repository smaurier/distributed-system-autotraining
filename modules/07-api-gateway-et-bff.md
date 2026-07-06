---
titre: API Gateway & BFF
cours: 17-distributed-systems
notions: ["API gateway", "point d'entrée unique", "reverse proxy / routing", "agrégation (composition d'API)", "fan-out", "cross-cutting concerns", "auth en périphérie (edge auth)", "propagation d'identité (JWT forwarding)", "correlation ID", "rate limiting (survol → module 15)", "protocol translation", "BFF (backend for frontend)", "un BFF par expérience utilisateur", "gateway vs BFF", "anti-pattern: gateway god object", "development bottleneck (goulot d'équipe)", "logique métier dans la gateway"]
outcomes:
  - "sait expliquer ce qu'une API gateway résout (couplage client↔topologie, N×M connexions) et ce qu'elle route/agrège/porte comme cross-cutting"
  - "sait implémenter une gateway minimale en TypeScript : routing/reverse proxy vers plusieurs services + agrégation d'un appel fan-out"
  - "sait où vérifier l'auth (en périphérie) et comment propager l'identité aux services (JWT forwarding + correlation ID)"
  - "sait définir le pattern BFF (un backend par expérience) et trancher gateway générique vs BFF au niveau mécanisme"
  - "sait nommer et éviter l'anti-pattern gateway god object (logique métier dans la gateway, goulot d'équipe)"
prerequis: ["Module 00 — pourquoi le distribué, fallacies", "Module 01 — réseau, latence, partial failure", "Module 02 — microservices en TypeScript", "Module 03 — sérialisation et contrats d'API", "Module 04 — communication synchrone (REST/gRPC, deadlines)", "Module 05 — communication asynchrone & message queues", "Module 06 — event-driven architecture"]
next: 08-retries-timeouts-idempotency
libs: []
tribuzen: "edge TribuZen — une API gateway devant les services (auth, familles, sorties, notifications) pour le point d'entrée unique + auth en périphérie, et un BFF mobile qui allège les réponses de l'app par rapport au web"
last-reviewed: 2026-07
---

# API Gateway & BFF

> **Outcomes — tu sauras FAIRE :** expliquer ce qu'une gateway résout et ce qu'elle porte, implémenter une gateway minimale (routing + agrégation + propagation d'auth) en TypeScript, décider gateway générique vs BFF, et éviter la gateway god object.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module est le niveau **mécanisme et implémentation** de la couche d'entrée d'un système distribué — comment une **gateway** route (reverse proxy), **agrège** plusieurs services en une réponse, porte les **cross-cutting concerns** (auth en périphérie, correlation ID, logging), et ce qu'apporte un **BFF** (un backend par expérience client). On **ne** refait **pas** ici la **décision d'architecture** « faut-il une gateway / un BFF / une API composite » au niveau design — ça, c'est **cours 13-architecture (module 17, communication)** ; ici on suppose le besoin posé et on regarde **le tuyau et ses mécanismes**. Le **rate limiting en profondeur** (token/leaky bucket, backpressure) est **survolé** ici et traité à fond au **module 15**. Les **retries/timeouts/idempotency** qu'une gateway applique aux appels amont = **module 08 (next)**. Le **circuit breaker** posé dans la gateway = **module 14**. La sécu (rotation de clés, mTLS) = **cours 14**.

## 1. Cas concret d'abord

TribuZen a grossi. Le monolithe Nest s'est découpé en services (module 02) : `auth-service`, `familles-service`, `sorties-service`, `notifications-service`. Deux clients les consomment : le **front web** (React) et l'**app mobile** (React Native). Aujourd'hui, chaque client tape **directement** chaque service :

```ts
// mobile — src/api/home.ts — AVANT (le client connaît TOUTE la topologie interne)
const familles = await fetch('https://familles.tribuzen.internal/familles/me', { headers: authH });
const sorties  = await fetch('https://sorties.tribuzen.internal/sorties?famille=' + id, { headers: authH });
const notifs   = await fetch('https://notifs.tribuzen.internal/notifications?unread=1', { headers: authH });
// ...et chaque service revérifie le JWT, chaque service configure son CORS, etc.
```

Quatre problèmes, tous dus au fait que **le client est couplé à la topologie interne** :

1. **Couplage client↔infra.** L'app mobile connaît l'URL de **chaque** service. Le jour où l'on scinde `sorties-service` en deux, on doit **redéployer les clients** (et l'app mobile met des semaines à passer les stores). L'interne fuit dans l'externe.
2. **Cross-cutting dupliqué.** L'authentification, le CORS, le rate limiting, le logging de corrélation sont **réimplémentés dans chaque service** — 4 copies à maintenir, 4 endroits où se tromper.
3. **Chatty client.** L'écran d'accueil mobile fait **3 allers-retours** réseau (familles + sorties + notifs) sur une connexion 4G à 150 ms de latence chacun. Le client **orchestre** un travail qui n'est pas le sien.
4. **Même réponse pour tous.** `sorties-service` renvoie la sortie **complète** (30 champs) ; l'app mobile n'affiche que `titre + date + lieu`. On paie de la bande passante mobile pour des champs jamais lus.

On veut un **point d'entrée unique** : un composant en **périphérie** (l'**edge**) devant les services. Les clients lui parlent à **une seule adresse** ; il **route** vers le bon service, **vérifie l'auth une fois**, **agrège** les 3 appels de l'accueil en **un seul**, et propage un **correlation ID** pour tracer la requête. C'est une **API gateway**. Et parce que web et mobile n'ont **pas** les mêmes besoins, on donnera peut-être au mobile son **propre** backend d'entrée — un **BFF**. Ce module te donne les mécanismes exacts : comment router, comment agréger un **fan-out**, où mettre l'auth, et surtout **où s'arrêter** pour ne pas transformer la gateway en monolithe déguisé.

---

## 2. Théorie complète, concise

### 2.1 Le problème : N clients × M services

Sans point d'entrée, chaque **client** doit connaître chaque **service** : avec N types de clients et M services, on tend vers **N × M** liaisons à gérer, et chaque cross-cutting concern (auth, CORS, rate limit, tracing) est **répliqué M fois**. Pire : la **topologie interne** (nombre de services, leurs adresses, leurs protocoles) devient **visible du client**, donc **gelée** — on ne peut plus refactorer l'interne sans casser l'externe.

```
SANS GATEWAY                              AVEC GATEWAY
web ─┬─▶ auth-svc                         web ───┐
     ├─▶ familles-svc                            ├─▶ ┌─────────┐ ─┬─▶ auth-svc
     └─▶ sorties-svc                       mobile┤   │ GATEWAY │  ├─▶ familles-svc
mobile┬▶ auth-svc                                └─▶ └─────────┘ ─┴─▶ sorties-svc
      ├▶ familles-svc                       (1 adresse publique,   (topologie interne
      └▶ sorties-svc                         auth/CORS/trace 1×)    cachée, libre de bouger)
```

### 2.2 L'API gateway : point d'entrée unique + reverse proxy

Une **API gateway** est le **single entry point** du système : *« a single entry point for all clients »* (microservices.io). Sa fonction de base est le **reverse proxy / routing** : elle reçoit une requête publique, décide **quel service interne** doit la traiter, la **transmet**, et renvoie la réponse. Le client parle à **une** adresse ; l'interne peut bouger derrière sans que le client le sache.

Elle *« insulates the clients from how the application is partitioned into microservices »* — c'est le bénéfice numéro un : **découpler le client de la topologie**. Elle peut aussi faire de la **protocol translation** : exposer une API REST/HTTP web-friendly côté public et parler gRPC (module 04) ou messaging (module 05) côté interne — *« from a 'standard' public web-friendly API protocol to whatever protocols are used internally »*.

> **Distinguer de choses proches.** Un **load balancer** répartit un même service sur N instances (couche 4/7, pas de logique applicative). Un **reverse proxy** (nginx) route sur l'URL mais ne connaît pas ton auth ni tes contrats. Une **API gateway** est un reverse proxy **applicatif** qui porte en plus l'auth, l'agrégation et les cross-cutting. On peut d'ailleurs **implémenter** une gateway *au-dessus* d'un reverse proxy.

### 2.3 Agrégation (composition d'API) & fan-out

Deuxième rôle : au lieu de router 1→1, la gateway peut **fanner vers plusieurs services** et **composer** une seule réponse — *« Some requests are routed … Other requests are handled by fanning out to multiple services »* (microservices.io). C'est l'**agrégation** (API composition).

Bénéfice mesurable : elle *« reduces the number of requests/roundtrips … the client makes one round-trip »* et *« simplifies the client by moving logic for calling multiple services from the client to API gateway »*. L'écran d'accueil TribuZen passe de **3 appels 4G** à **1** ; l'orchestration (appeler familles + sorties + notifs, attendre les 3, fusionner) vit **côté serveur**, sur un réseau interne rapide.

Deux détails de mécanisme qui comptent :

- **Parallélisme.** Les appels indépendants partent **en parallèle** (`Promise.all`), pas en série — sinon la latence s'**additionne** au lieu de se **maxer**.
- **Dégradation partielle.** Si `notifications-service` est lent ou down, la gateway ne doit **pas** faire échouer tout l'accueil : elle renvoie familles + sorties et un `notifications: null` (ou un champ d'erreur). L'agrégation force à décider **quel service est essentiel** et lequel est optionnel — c'est un choix de résilience, pas un détail.

### 2.4 Cross-cutting concerns : auth en périphérie, correlation ID, rate limit

Le troisième rôle : centraliser ce qui est **transversal** à tous les services.

**Auth en périphérie (edge auth) + propagation.** La gateway *« verify that the client is authorized to perform the request »* (microservices.io) : elle **vérifie le JWT une seule fois** (signature, expiration) au bord, puis **propage l'identité** aux services amont. Deux façons de propager :
- **JWT forwarding** : réémettre le header `Authorization` tel quel ; chaque service refait confiance à la gateway (réseau interne). Simple, mais le service **peut** revérifier (défense en profondeur).
- **Token exchange / claims injectés** : la gateway extrait `sub`, `roles`, et les passe en headers signés internes (`X-User-Id`, `X-Roles`). Les services ne redécodent pas le JWT.

Le point de mécanisme : l'auth **au bord ne dispense pas** les services d'autorisation (« ce user a-t-il le droit sur CETTE famille ? » reste une décision **métier**, donc dans le service — pas dans la gateway, cf. §2.7).

**Correlation ID.** La gateway **génère** (ou propage si présent) un identifiant unique par requête entrante et l'**injecte** dans chaque appel amont (`X-Correlation-Id`). Tous les logs d'une même requête portent le même ID → on **reconstitue le trajet** d'une requête à travers N services. C'est le socle du **traçage distribué** — la version profonde (OpenTelemetry, spans, propagation de contexte) = **module 16** et **cours 16-observabilité**.

**Rate limiting.** La gateway est l'endroit naturel pour **plafonner le débit** par client/API key (protéger l'amont d'un client abusif ou d'un pic). **Survol seulement ici** : les algorithmes (token bucket, leaky bucket), le backpressure et le load shedding = **module 15**. Retiens juste : *où* on le pose (au bord) et *pourquoi* (un seul endroit protège tous les services).

### 2.5 BFF — Backend for Frontend

Une gateway **générique** sert **tous** les clients de la **même** façon. Problème : web et mobile n'ont **pas** les mêmes besoins. Sam Newman : le mobile a *« less screen real estate »*, veut *« fewer calls »* et *« different (and probably less) data than their desktop counterparts »*. Une API unique qui satisfait tout le monde devient un **goulot** — *« so many changes are trying to be made to the same deployable artifact »*.

Le pattern **BFF (Backend For Frontend)** : **un backend dédié par expérience utilisateur**. *« The BFF is tightly coupled to a specific user experience, and will typically be maintained by the same team as the user interface. »* Chaque BFF est *« tightly focused on a single UI, and just that UI. That allows it to be focused, and will therefore be smaller. »*

Concrètement pour TribuZen : un **BFF mobile** agrège et **allège** (renvoie `titre/date/lieu` pour une sortie), un **BFF web** renvoie la version riche (tous les champs + reviews + suggestions). Même écran logique, **deux réponses taillées** pour deux clients, maintenues **par l'équipe du client** — pas par une équipe plateforme centrale qui doit *« balance both the priorities of the different client teams »*.

```
GATEWAY GÉNÉRIQUE              BFF (un par expérience)
web ──┐                        web ────▶ Web BFF ───┐
      ├▶ gateway ─▶ services              (réponse   ├─▶ services
mobile┘  (1 API pour tous)     mobile ─▶ Mobile BFF   ┘    partagés
                                          (réponse allégée, équipe mobile)
```

### 2.6 Gateway vs BFF — comment trancher (au niveau mécanisme)

Ce ne sont **pas** deux choses opposées : un BFF **est** une gateway **spécialisée par client**. La question mécanique :

| Signal | Gateway générique | BFF |
|---|---|---|
| Besoins des clients | **similaires** (mêmes données, même forme) | **divergents** (web riche vs mobile léger) |
| Qui maintient | équipe plateforme centrale | **l'équipe de chaque client** |
| Nombre d'entrées | **une** | **une par expérience** |
| Risque principal | god object qui grossit (§2.7) | duplication d'agrégation entre BFF |

Règle de mécanisme : **commence par une gateway générique** ; **découpe en BFF** quand les besoins **divergent** au point que l'API unique devient un compromis inconfortable ou un **goulot d'équipe**. Sur la **duplication** entre BFF, Sam Newman est *« fairly relaxed about duplicated code across services »* : extraire du code partagé trop tôt recrée le **couplage** qu'on fuyait — on extrait *« when you're about to implement something for the 3rd time »*, pas avant.

> **Défère la décision d'archi.** « Faut-il une gateway du tout ? Une API composite côté service plutôt qu'au bord ? Combien de BFF ? » = choix de **design** → **cours 13-architecture, module 17**. Ici on a montré **les mécanismes** ; le *quand-choisir* au niveau design n'est pas répété.

### 2.7 Anti-pattern : la gateway god object

Le piège central. Parce que **tout** transite par elle, on est tenté d'y mettre **de plus en plus** : une validation métier ici, un calcul de prix là, une règle « si la famille est premium alors… ». La gateway devient un **god object** : un composant central qui **sait tout, fait tout**, couplé à **tous** les domaines.

Deux conséquences concrètes :

1. **Monolithe déguisé.** La logique métier qu'on avait sorti dans les services **revient** au centre. On a payé le prix du distribué (N services) sans en tirer le bénéfice (indépendance) — la logique est re-centralisée dans la gateway.
2. **Development bottleneck (goulot d'équipe).** microservices.io note que la gateway est *« yet another moving part that must be developed, deployed and managed »*, et — c'est le vrai danger — devient un point où *« so many changes are trying to be made to the same deployable artifact »* (Sam Newman). **Chaque** équipe qui veut ajouter une route/règle doit modifier **le même** composant → contention, files d'attente de PR, déploiements couplés.

**La règle :** la gateway reste un **passe-plat intelligent**. Elle route, authentifie (au bord), agrège, porte les cross-cutting **techniques** (correlation ID, rate limit) — mais elle ne prend **aucune décision métier**, n'accède **jamais** à une base directement, ne calcule **aucun** prix ni règle. Le BFF a un peu plus de latitude (il **assemble** pour SON client), mais lui non plus n'héberge de **logique de domaine** : la règle métier vit dans le **service** qui possède la donnée. Test simple : *« si je supprime ce bout de code de la gateway, un service métier doit-il le réimplémenter ? »* Si oui, il n'aurait jamais dû être dans la gateway.

---

## 3. Worked examples

### Exemple 1 — Une gateway minimale TribuZen : routing + agrégation + auth propagation

But : le point d'entrée du §1. Une gateway Express qui (a) vérifie le JWT une fois, (b) injecte un correlation ID, (c) route `/api/sorties/*` vers `sorties-service`, et (d) **agrège** l'écran d'accueil en un seul appel.

**Étape 1 — le socle : correlation ID + auth en périphérie.**

```ts
// gateway.ts
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(express.json());

const SERVICES = {
  familles: 'http://familles-service:3001',
  sorties:  'http://sorties-service:3002',
  notifs:   'http://notifications-service:3003',
} as const;

// (a) correlation ID : généré au bord, propagé partout → traçage distribué (deep = module 16)
app.use((req: Request, res: Response, next: NextFunction) => {
  const cid = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  req.headers['x-correlation-id'] = cid;
  res.setHeader('X-Correlation-Id', cid);
  next();
});

// (b) auth EN PÉRIPHÉRIE : on vérifie le JWT UNE fois, puis on propage l'identité.
function edgeAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing token' }); return; }
  try {
    const claims = verifyJwt(auth.slice(7)); // signature + expiration (jose/jsonwebtoken en prod)
    // claims injectés pour l'amont : les services NE redécodent PAS le JWT
    req.headers['x-user-id'] = claims.sub;
    req.headers['x-roles'] = claims.roles.join(',');
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}
```

**Étape 2 — le reverse proxy générique** (route 1→1, cache la topologie) :

```ts
async function proxy(target: string, req: Request, res: Response): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3_000); // timeout amont (deep = module 08)
  try {
    const upstream = await fetch(target + req.url.replace(/^\/api\/[^/]+/, ''), {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': req.headers['x-correlation-id'] as string,
        'x-user-id': req.headers['x-user-id'] as string, // identité propagée
        'x-roles':   req.headers['x-roles'] as string,
      },
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined,
      signal: ctrl.signal,
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({ error: timeout ? 'Gateway timeout' : 'Bad gateway' });
  } finally { clearTimeout(t); }
}

app.use('/api/sorties',  edgeAuth, (req, res) => proxy(SERVICES.sorties,  req, res));
app.use('/api/familles', edgeAuth, (req, res) => proxy(SERVICES.familles, req, res));
```

**Étape 3 — l'agrégation de l'écran d'accueil** (fan-out parallèle + dégradation partielle) :

```ts
// 3 appels internes → 1 réponse. Le client mobile fait UN aller-retour.
app.get('/api/home', edgeAuth, async (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  const h = {
    'x-correlation-id': req.headers['x-correlation-id'] as string,
    'x-user-id': userId,
  };
  const get = (u: string) => fetch(u, { headers: h }).then(r => r.ok ? r.json() : null);

  // fan-out EN PARALLÈLE : la latence se MAXe, elle ne s'additionne pas.
  const [familles, sorties, notifs] = await Promise.all([
    get(`${SERVICES.familles}/familles/me`),
    get(`${SERVICES.sorties}/sorties?membre=${userId}`),
    get(`${SERVICES.notifs}/notifications?unread=1`),
  ]);

  // dégradation partielle : notifs down → on rend quand même l'accueil, sans planter.
  res.json({ familles, sorties, notifications: notifs ?? { error: 'unavailable' } });
});

app.listen(8080);
```

**Ce que ce design achète :** une seule adresse publique (topologie cachée) ; JWT vérifié **une** fois, identité propagée ; l'accueil = **1** appel client au lieu de 3, appels internes **parallèles** ; un service optionnel (notifs) qui tombe **ne casse pas** l'écran ; un correlation ID qui **relie** tous les logs de la requête. **Ce qu'on n'a PAS mis :** aucune règle métier (« a-t-il le droit sur cette famille ? » reste dans `familles-service`), aucun accès base directe. La gateway reste un **passe-plat**.

### Exemple 2 — Introduire un BFF mobile qui allège la réponse

Le mobile n'affiche que `titre/date/lieu` d'une sortie ; le web veut tout. Plutôt qu'une gateway unique qui renvoie du gras au mobile, on donne au mobile **son** backend d'entrée.

```ts
// mobile-bff.ts — maintenu par l'ÉQUIPE MOBILE, taillé pour l'app RN
app.get('/home', edgeAuth, async (req, res) => {
  const userId = req.headers['x-user-id'] as string;
  const h = { 'x-correlation-id': req.headers['x-correlation-id'] as string, 'x-user-id': userId };

  const [familles, sortiesFull] = await Promise.all([
    fetch(`${SERVICES.familles}/familles/me`, { headers: h }).then(r => r.json()),
    fetch(`${SERVICES.sorties}/sorties?membre=${userId}`, { headers: h }).then(r => r.json()),
  ]);

  // Le BFF PROJETTE pour SON client : il n'envoie que ce que l'écran mobile affiche.
  // (ce n'est PAS de la logique métier — c'est de l'adaptation de forme pour l'UI)
  const sorties = sortiesFull.map((s: any) => ({ id: s.id, titre: s.titre, date: s.date, lieu: s.lieu }));

  res.json({ prenom: familles.moi.prenom, sorties }); // payload minimal → moins de 4G
});
```

Le **web BFF**, lui, renverrait `sortiesFull` + suggestions + reviews. Deux backends, **deux formes** de réponse, chacun **petit et focalisé** sur son UI, maintenu par l'équipe du client. On **assume** que `sorties.map(projection)` est dupliqué-ish entre BFF : tant qu'on n'est pas à la 3ᵉ occurrence, on ne factorise pas (couplage > duplication ici).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Mettre de la logique métier dans la gateway (god object)

Le piège central. « C'est central, autant y valider/calculer. » Non : la gateway route, authentifie au bord, agrège — mais **aucune** règle de domaine. Dès qu'elle calcule un prix, applique une règle « premium », ou tape une base, elle devient un **monolithe déguisé** et un **goulot d'équipe** (chaque équipe modifie le même artefact). Test : *« un service devrait-il réimplémenter ce code si je le retire de la gateway ? »* → si oui, il n'a rien à y faire.

### PIÈGE #2 — Croire que l'auth au bord dispense les services d'autorisation

« La gateway a vérifié le token, les services font confiance. » Vrai pour l'**authentification** (qui es-tu). Faux pour l'**autorisation métier** (as-tu le droit sur CETTE ressource) : « ce parent peut-il voir la sortie de CETTE famille ? » est une décision **de domaine** → dans le service qui possède la donnée. La gateway prouve l'identité ; le service décide des droits.

### PIÈGE #3 — Agréger en série au lieu d'en parallèle

Faire `await familles; await sorties; await notifs` **additionne** les latences (150 + 150 + 150 ms). Les appels **indépendants** doivent partir en **`Promise.all`** → la latence se **maxe** (~150 ms). Une agrégation séquentielle annule le bénéfice « moins d'allers-retours » : on a juste déplacé le chatty du client vers la gateway.

### PIÈGE #4 — Une agrégation qui échoue en tout-ou-rien

Si un service optionnel (notifs) tombe et que la gateway **propage l'échec**, tout l'écran plante à cause d'un détail. L'agrégation **oblige** à classer chaque appel : **essentiel** (son échec = échec) vs **optionnel** (son échec = champ `null`/dégradé). Sans ce classement, la gateway devient le **point qui amplifie** les pannes au lieu de les absorber.

### PIÈGE #5 — Confondre gateway générique et BFF (et multiplier les BFF trop tôt)

Un BFF n'est **pas** « une gateway par service » : c'est **une gateway par expérience client** (web, mobile), maintenue par l'équipe du client. On ne crée un BFF que quand les besoins **divergent** vraiment. Créer un BFF par microservice = re-N×M ; créer zéro BFF quand web et mobile divergent fort = gateway compromis. Le signal, c'est la **divergence des clients**, pas le nombre de services.

### PIÈGE #6 — Sur-factoriser le code partagé entre BFF

L'inverse du #5. Deux BFF dupliquent une projection → tentation d'extraire une lib partagée **tout de suite**. Ça recouple les BFF (un changement pour le mobile impacte le web). Newman : on tolère la duplication *« across services »* et on extrait *« about to implement something for the 3rd time »*. La duplication entre BFF est souvent **moins chère** que le couplage.

### PIÈGE #7 — Confondre gateway, reverse proxy et load balancer

« nginx fait déjà gateway. » Un **load balancer** répartit un service sur ses instances ; un **reverse proxy** route sur l'URL ; une **API gateway** est un proxy **applicatif** qui porte auth, agrégation et cross-cutting. Ils se **superposent** (gateway *au-dessus* d'un LB) mais ne se remplacent pas. Attendre d'un nginx nu qu'il agrège 3 services et vérifie ton JWT métier, c'est y remettre… de la logique (retour au #1).

---

## 5. Ancrage TribuZen

TribuZen expose un **front web** (React) et une **app mobile** (React Native) devant des services (`auth`, `familles`, `sorties`, `notifications`). L'edge de TribuZen, de bout en bout :

```
                 ┌───────────────────────── EDGE TribuZen ─────────────────────────┐
 web ───────────┼─▶ Web BFF ─┐   (correlation ID · edge auth JWT · rate limit → m15)│
                │            ├─▶ fan-out parallèle ──┬─▶ auth-service               │
 mobile ────────┼─▶ Mobile BFF                       ├─▶ familles-service           │
                │   (payload allégé)                 ├─▶ sorties-service            │
                └────────────────────────────────────┴─▶ notifications-service ─────┘
                                                          (autorisation métier = DANS le service)
```

Décisions concrètes pour TribuZen :

- **Un point d'entrée unique** devant les services : les clients ne connaissent **plus** les adresses internes → on peut scinder `sorties-service` sans redéployer l'app mobile (qui met des semaines à passer les stores).
- **Auth en périphérie** : le JWT est vérifié **une** fois à l'edge ; l'identité est propagée (`X-User-Id`, `X-Roles`). Mais « ce parent peut-il modifier CETTE sortie ? » reste **dans `sorties-service`** (autorisation = métier).
- **Agrégation de l'accueil** : `GET /home` fan-out `familles + sorties + notifs` en parallèle, une seule réponse → l'app mobile fait **1** aller-retour 4G au lieu de 3, et notifs down **ne casse pas** l'écran.
- **BFF mobile vs web** : le BFF mobile **projette** des sorties allégées (`titre/date/lieu`) ; le web renvoie la version riche. Chaque BFF est maintenu par l'équipe de son client. On n'a **pas** de BFF par service (ce serait re-N×M).
- **Ce qui n'entre PAS dans l'edge** : aucun calcul de règle famille, aucun accès Postgres direct, aucune saga. L'edge reste un passe-plat — sinon goulot d'équipe et monolithe déguisé.

> **Défère :** la **décision d'archi** (faut-il une gateway ? combien de BFF ? API composite au bord vs côté service) = **cours 13-architecture, module 17** ; les **retries/timeouts/idempotency** des appels amont = **module 08 (next)** ; le **circuit breaker** posé dans la gateway = **module 14** ; le **rate limiting** à fond (token/leaky bucket, backpressure) = **module 15** ; le **traçage distribué** via le correlation ID (OpenTelemetry, spans) = **module 16** + **cours 16** ; la sécu edge (mTLS, rotation de clés) = **cours 14**. Ici on a posé **le mécanisme de la couche d'entrée**.

---

## 6. Points clés

1. **API gateway** = **point d'entrée unique** (single entry point) qui **découple le client de la topologie interne** : les clients parlent à une adresse, l'interne bouge librement derrière.
2. **Trois rôles** : **routing** (reverse proxy, éventuelle protocol translation) ; **agrégation** (fan-out vers N services, une réponse, moins d'allers-retours) ; **cross-cutting** (auth au bord, correlation ID, rate limit).
3. **Agrégation** : appels indépendants **en parallèle** (`Promise.all`, la latence se maxe) et **dégradation partielle** (un service optionnel down ⇒ champ dégradé, pas échec global).
4. **Auth en périphérie** : JWT vérifié **une** fois, identité **propagée** (forwarding ou claims injectés) ; mais l'**autorisation métier** reste **dans le service**.
5. **BFF** = **un backend par expérience client** (web/mobile), maintenu par l'équipe du client, qui **taille** la réponse à SON UI. On y passe quand les besoins clients **divergent**.
6. **Gateway vs BFF** : besoins similaires → gateway générique ; besoins divergents / goulot d'équipe → BFF. Duplication entre BFF **tolérée** (extraire à la 3ᵉ fois ; le couplage coûte plus cher).
7. **Anti-pattern god object** : pas de **logique métier**, pas d'accès base, pas de saga dans la gateway — sinon **monolithe déguisé** + **development bottleneck** (tous modifient le même artefact). La gateway reste un **passe-plat intelligent**.

---

## 7. Seeds Anki

```
Quel est le rôle premier d'une API gateway et quel couplage supprime-t-elle ?|C'est le point d'entrée unique (single entry point) : le client parle à UNE adresse et la gateway route vers le bon service. Elle supprime le couplage client↔topologie interne (« insulates the clients from how the application is partitioned into microservices ») — l'interne peut bouger sans redéployer les clients — et évite les N×M liaisons + le cross-cutting répliqué dans chaque service.
Que fait l'agrégation (API composition) dans une gateway et quels deux détails de mécanisme comptent ?|Elle fanne vers plusieurs services et compose une seule réponse (moins d'allers-retours client, orchestration déplacée côté serveur). Deux détails : (1) appels indépendants EN PARALLÈLE (Promise.all — la latence se maxe, pas s'additionne) ; (2) dégradation partielle — un service optionnel down rend un champ dégradé/null, pas un échec global.
Où vérifie-t-on l'auth avec une gateway, et qu'est-ce qui reste malgré tout dans les services ?|On vérifie le JWT UNE fois EN PÉRIPHÉRIE (edge auth : signature + expiration), puis on propage l'identité (JWT forwarding ou claims injectés X-User-Id/X-Roles). Reste dans le service : l'AUTORISATION métier (« ce user a-t-il le droit sur CETTE ressource ? ») — c'est une décision de domaine, pas d'infrastructure.
Qu'est-ce que le pattern BFF et par quoi diffère-t-il d'une gateway générique ?|BFF (Backend For Frontend) = un backend dédié PAR EXPÉRIENCE utilisateur (web, mobile), maintenu par l'équipe du client, qui taille la réponse à SON UI (mobile = moins de données, moins d'appels). La gateway générique sert tous les clients pareil ; le BFF est « focused on a single UI, and just that UI », donc plus petit. Un BFF est une gateway spécialisée par client, PAS une par service.
Comment tranche-t-on gateway générique vs BFF, et que fait-on de la duplication entre BFF ?|Besoins clients SIMILAIRES → gateway générique ; besoins DIVERGENTS (web riche vs mobile léger) ou goulot d'équipe → BFF. Le signal est la divergence des clients, pas le nombre de services. La duplication d'agrégation entre BFF est tolérée (Newman « fairly relaxed about duplicated code across services ») : on n'extrait qu'à la 3e occurrence, sinon on recrée le couplage qu'on fuyait.
Qu'est-ce que l'anti-pattern « gateway god object » et pourquoi est-il dangereux ?|Mettre de plus en plus dans la gateway (validation/règles métier, accès base, saga) parce que tout y transite. Danger : (1) monolithe déguisé — la logique sortie dans les services revient au centre ; (2) development bottleneck — chaque équipe modifie le même artefact déployable → contention. Règle : la gateway reste un passe-plat intelligent (route/auth/agrège/cross-cutting technique), zéro logique de domaine.
Quelle différence entre une API gateway, un reverse proxy et un load balancer ?|Load balancer = répartit un même service sur ses N instances (pas de logique applicative). Reverse proxy = route sur l'URL (nginx). API gateway = reverse proxy APPLICATIF qui porte en plus auth, agrégation et cross-cutting. Ils se superposent (gateway au-dessus d'un LB) mais ne se remplacent pas ; attendre d'un nginx nu qu'il agrège et vérifie le JWT métier = y remettre de la logique.
Quel est le rôle du correlation ID injecté par la gateway ?|La gateway génère (ou propage) un identifiant unique par requête entrante et l'injecte dans chaque appel amont (X-Correlation-Id). Tous les logs d'une même requête portent le même ID → on reconstitue le trajet à travers N services. C'est le socle du traçage distribué (version profonde OpenTelemetry/spans = module 16 / cours 16).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-07-api-gateway-et-bff/README.md`. Implémenter une **gateway minimale TribuZen** avec Express + TypeScript (docker-compose fournissant 2-3 services stub) : routing/reverse proxy, **auth en périphérie** (JWT vérifié une fois + identité propagée), et **agrégation** `GET /home` en fan-out parallèle avec dégradation partielle. Exercice évalué par grille + coach, avec variante J+30 (ajouter un BFF mobile qui allège la réponse) — zéro harnais auto-correcteur.
