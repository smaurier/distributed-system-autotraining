# Lab 02 — Microservices en TypeScript

> **Outcome :** à la fin, tu sais implémenter deux services TypeScript autonomes qui communiquent en HTTP (avec timeout), exposent des health checks liveness/readiness corrects, et se localisent par variable d'environnement — le tout orchestré par un `docker-compose.yml` fourni.
> **Vrai outil :** Node.js + TypeScript + Express + `fetch` natif, lancés en deux vrais process via Docker Compose (ou deux terminaux). **Aucun harnais simulé.**
> **Feedback :** le coach valide en session avec la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Énoncé

Tu extrais deux capabilities de TribuZen en **deux process séparés** qui se parlent :

- **`members-service`** (port 3001) — détient les membres d'une famille. Expose :
  - `GET /members/:id` → `200 {id, name, active}` si trouvé, `404` sinon.
  - `GET /health/live` → `200 {status:"alive"}`.
- **`notifications-service`** (port 3002) — envoie une notification à un membre, **après avoir vérifié auprès de `members-service`** qu'il existe et est actif. Expose :
  - `POST /notify` avec body `{ memberId, message }` :
    - `400` si `memberId` ou `message` manque ;
    - appelle `members-service` **avec un timeout de 2 s** ;
    - `503` si `members-service` est injoignable/timeout ;
    - `404` si le membre n'existe pas ; `409` si `member.active === false` ;
    - `202 {sent:true, to:<name>}` sinon (la « notif » est un `console.log` JSON structuré).
  - `GET /health/live` → trivial, aucune dépendance.
  - `GET /health/ready` → vérifie `members-service` (timeout 1 s) : `200 {status:"ready"}` si joignable, `503 {status:"degraded"}` sinon.

**Contraintes :**
- Chaque service = **son propre dossier**, `package.json`, `tsconfig.json` (ou `ts-node`/`tsx`). Pas de code partagé, pas de base partagée (une `Map` en mémoire par service).
- L'URL de `members-service` dans `notifications-service` vient de `process.env.MEMBERS_SERVICE_URL` — **jamais codée en dur**.
- Tu écris le code complet à partir du squelette — **pas de gap-fill**.

**Données de départ pour `members-service`** (à coller dans ta `Map`) :

```ts
// m-002 est INACTIF exprès — sert à tester le 409
const seed: Array<{ id: string; name: string; active: boolean }> = [
  { id: 'm-001', name: 'Alice', active: true },
  { id: 'm-002', name: 'Bob', active: false },
  { id: 'm-003', name: 'Cara', active: true },
];
```

### Arborescence cible

```
lab-02/
  members-service/
    src/index.ts
    package.json
    tsconfig.json
    Dockerfile
  notifications-service/
    src/index.ts
    src/members-client.ts
    package.json
    tsconfig.json
    Dockerfile
  docker-compose.yml   <-- FOURNI ci-dessous
```

### `docker-compose.yml` fourni

```yaml
services:
  members-service:
    build: ./members-service
    ports: ["3001:3001"]
    environment:
      PORT: "3001"

  notifications-service:
    build: ./notifications-service
    ports: ["3002:3002"]
    environment:
      PORT: "3002"
      # DNS interne du réseau compose : "members-service" est résolu tout seul.
      # C'est le service discovery le plus simple (module 02, §2.5).
      MEMBERS_SERVICE_URL: "http://members-service:3001"
    depends_on: [members-service]
```

### `Dockerfile` minimal fourni (identique pour chaque service, adapte le port EXPOSE)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npx", "tsx", "src/index.ts"]
```

> Pas de Docker sous la main ? Lance chaque service dans un terminal séparé avec
> `PORT=3001 npx tsx src/index.ts` et `PORT=3002 MEMBERS_SERVICE_URL=http://localhost:3001 npx tsx src/index.ts`.

---

## Étapes (en friction)

1. **Écris `members-service`** — Express, la `Map` seed, `GET /members/:id` (404 si absent), `GET /health/live`. Lance-le, teste `curl localhost:3001/members/m-001` puis `.../m-999`.
2. **Écris le client** `notifications-service/src/members-client.ts` — `fetchMember(id)` qui lit `MEMBERS_SERVICE_URL`, fait un `fetch` **avec `AbortSignal.timeout(2000)`**, renvoie `null` sur `404`, lève sur injoignable.
3. **Écris `POST /notify`** — validation `400`, appel client dans un `try/catch` (`503` si ça lève), `404` si `null`, `409` si `!active`, `202` sinon avec un `console.log(JSON.stringify(...))`.
4. **Écris les health checks** — `live` trivial ; `ready` qui `fetch` le `live` de `members-service` (timeout 1 s) et renvoie `degraded/503` en cas d'échec.
5. **Lance les deux** (`docker compose up --build` ou deux terminaux). Teste le chemin nominal : `curl -XPOST localhost:3002/notify -H 'content-type: application/json' -d '{"memberId":"m-001","message":"hi"}'` → `202`.
6. **Teste les cas d'erreur** : `m-002` → `409` ; `m-999` → `404` ; body vide → `400`.
7. **Provoque la panne** — arrête `members-service` (`docker compose stop members-service` ou Ctrl-C). Puis :
   - `curl localhost:3002/health/ready` → doit passer à **`503 degraded`**.
   - `curl localhost:3002/health/live` → doit **rester `200 alive`** (le process notifications va bien !).
   - un `POST /notify` → **`503`** (dépendance critique injoignable).
   Observe : le service reste vivant, mais se déclare non-prêt. C'est le comportement correct.

---

## Grille de validation (le coach coche)

- [ ] Deux process séparés, chacun avec ses données (aucune `Map`/base partagée).
- [ ] `notifications-service` localise `members-service` **par env var**, pas d'URL en dur.
- [ ] L'appel inter-service a un **timeout** (`AbortSignal.timeout`).
- [ ] `POST /notify` renvoie les bons codes : `400 / 404 / 409 / 202 / 503`.
- [ ] `/health/live` est **trivial** (aucune dépendance) ; `/health/ready` **inclut** `members-service`.
- [ ] Quand `members-service` est arrêté : `ready` → `503`, `live` → reste `200`, `notify` → `503`.
- [ ] Le candidat sait **expliquer** pourquoi la dépendance ne doit pas être dans le liveness.

---

## Coach — comment mener la session

**Objectif page blanche.** Le squelette Docker/Dockerfile est fourni ; le **code TypeScript, non**. Le candidat l'écrit.

Relances si blocage (dans l'ordre, ne pas donner la réponse trop tôt) :
- *« En monolithe, `notifications` appelait `members.get(id)`. Qu'est-ce que cet appel devient ici, et qu'est-ce qui peut mal se passer maintenant ? »* → amène le timeout.
- *« Tu arrêtes `members-service`. Est-ce que `notifications-service` est cassé, ou juste pas prêt ? Lequel des deux health checks doit bouger ? »* → force la distinction live/ready.
- *« Où est écrite l'adresse de `members-service` ? Que se passe-t-il quand on déploie et que le port change ? »* → env var / discovery.

Signaux à corriger à chaud :
- URL codée en dur → renvoyer à §2.5 du module.
- `fetch` sans `signal` → « et si le voisin met 30 s à répondre ? ».
- Dépendance dans le `live` → faire tourner le scénario de panne et observer la boucle de redémarrage (conceptuellement).
- `catch` qui avale l'erreur et renvoie un faux succès → « tu viens d'inventer une notif envoyée à personne ».

Question de sortie (compréhension, pas récitation) : *« Là tu as classé `members-service` comme dépendance critique (503 si absent). Donne-moi un cas où elle serait plutôt optionnelle, et ce que le code ferait à la place. »* → attendu : enrichissement (le nom), fallback, dégradation gracieuse.

---

## Variante J+30 (fading)

**De mémoire, en 30 minutes, sans rouvrir ce corrigé ni le module 02.** Repars des deux services et ajoute :

1. Un **troisième service** `posts-service` (port 3003) avec `POST /posts { memberId, text }` qui, après création, **appelle `notifications-service`** (`POST /notify`) pour prévenir. Chaîne : `posts → notifications → members`.
2. Rends la dépendance `posts → notifications` **optionnelle** : si `notifications-service` est injoignable, le post est **quand même créé** (`201`) et on logge un warning — dégradation gracieuse (≠ la dépendance critique `notifications → members`).
3. Ajoute à `posts-service` un `/health/ready` qui reflète l'état de `notifications-service` **sans** le rendre bloquant pour la création.

**Critère de réussite :** arrêter `notifications-service` casse les notifs mais **pas** la création de posts ; arrêter `members-service` fait échouer les notifs en `503`. Tu as implémenté une dépendance critique ET une dépendance optionnelle dans le même système.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces services vivent ici :

```
tribuzen/
  services/
    members/         # GET /members/:id, sa propre base
    notifications/   # POST /notify, appelle members
    posts/           # POST /posts, appelle notifications (J+30)
  docker-compose.yml
```

**Différences avec le lab :**
- La `Map` en mémoire devient une vraie base **par service** (Postgres/Prisma — cours 10) ; toujours **aucune table partagée**.
- Le contrat `{id, name, active}` sera un schéma versionné (**module 03 — sérialisation & contrats d'API**), pas un type inline dupliqué.
- Le timeout basique deviendra retry + circuit breaker (**modules 08 et 14**).

**Commit cible :**
```
feat(services): extract members + notifications services, HTTP inter-service call with timeout + health checks
```
