# Lab 04 — Communication synchrone (gRPC + deadline + health check)

> **Outcome :** à la fin, tu sais implémenter un appel gRPC **unary** entre deux services TribuZen, poser une **deadline**, la **propager** dans une chaîne d'appels, gérer `DEADLINE_EXCEEDED`, et exposer un **health check** — le tout en local via un `docker-compose` fourni.
> **Vrai outil :** Node.js + TypeScript + `@grpc/grpc-js` + `@grpc/proto-loader`, orchestré par Docker Compose (deux vrais conteneurs qui se parlent sur le réseau).
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur. Tu observes le comportement réel (logs, `DEADLINE_EXCEEDED`, health status).

---

## Énoncé

Tu construis la chaîne d'appels synchrone au cœur de TribuZen :

```
gateway ──(gRPC unary, deadline 2 s)──► family-service ──(gRPC unary, temps restant)──► membership-service
```

Quand le gateway demande « poste ce message », `family-service` doit vérifier auprès de `membership-service` que l'utilisateur est **membre actif** avant d'accepter. Trois exigences non négociables :

1. **Deadline** : le gateway pose une deadline de 2 s sur son appel à `family-service`.
2. **Propagation** : `family-service` ne redonne **pas** 2 s à `membership-service` — il propage le **temps restant**.
3. **Health check** : `membership-service` expose le service standard `grpc.health.v1.Health` ; on doit pouvoir le sonder et le voir passer `SERVING` → `NOT_SERVING`.

Tu dois **observer** trois scénarios :
- **Nominal** : membre actif → message accepté.
- **Lenteur** : on injecte 5 s de délai dans `membership-service` → l'appel remonte `DEADLINE_EXCEEDED` **avant** les 5 s, et le gateway n'attend jamais plus que sa deadline.
- **Instance malade** : `membership-service` répond `NOT_SERVING` au health check → tu constates comment un LB le retirerait.

**Pas de gap-fill** — tu écris les handlers et le client à partir du starter ci-dessous.

### Infra fournie — `docker-compose.yml`

Crée l'arborescence suivante dans un dossier de travail (hors du repo cours) :

```
lab-04/
  docker-compose.yml
  proto/
    membership.proto
  gateway/        (Dockerfile + src)
  family/         (Dockerfile + src)
  membership/     (Dockerfile + src)
```

`docker-compose.yml` (fourni — à copier tel quel) :

```yaml
services:
  membership:
    build: ./membership
    environment:
      # Injection de latence pour le scénario "lenteur" (0 = nominal)
      SLOW_MS: "0"
      # Bascule le health status pour le scénario "instance malade"
      HEALTHY: "true"
    expose: ["50051"]

  family:
    build: ./family
    environment:
      MEMBERSHIP_ADDR: "membership:50051"
    expose: ["50052"]
    depends_on: [membership]

  gateway:
    build: ./gateway
    environment:
      FAMILY_ADDR: "family:50052"
    ports: ["3000:3000"]     # seul le gateway est exposé à l'hôte
    depends_on: [family]
```

`Dockerfile` type (identique pour les trois, à adapter le `CMD`) :

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npx", "tsx", "src/index.ts"]
```

Contrat partagé `proto/membership.proto` (fourni) :

```proto
syntax = "proto3";
package tribuzen.membership;

service Membership {
  // Unary : vérifier l'appartenance
  rpc CheckMember (CheckMemberRequest) returns (CheckMemberReply);
}

message CheckMemberRequest {
  string family_id = 1;
  string user_id = 2;
}

message CheckMemberReply {
  // "active" | "invited" | "removed"
  string status = 1;
}
```

> Le service `grpc.health.v1.Health` est fourni clé en main par `grpc-health-check` (ou tu l'implémentes toi-même depuis le `health.proto` standard). L'énoncé te demande de l'exposer et de le sonder, pas de le réécrire.

### Starter — `membership/src/index.ts`

```ts
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'node:path'

const SLOW_MS = Number(process.env.SLOW_MS ?? 0)

const def = protoLoader.loadSync(path.join(__dirname, '../../proto/membership.proto'))
const pkg = grpc.loadPackageDefinition(def) as any

// À toi : implémente checkMember.
// - respecte SLOW_MS (setTimeout) pour simuler la lenteur
// - renvoie { status: 'active' } pour l'utilisateur 'u-active'
// - expose aussi le service grpc.health.v1.Health
function checkMember(call: any, cb: any) {
  // ... À COMPLÉTER
}

const server = new grpc.Server()
server.addService(pkg.tribuzen.membership.Membership.service, { checkMember })
// À toi : addService pour grpc.health.v1.Health
server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
  console.log('[membership] up on 50051')
})
```

---

## Étapes (en friction)

1. **Implémente `checkMember`** côté `membership` : si `SLOW_MS > 0`, attends ce délai (`setTimeout`) avant de répondre ; renvoie `{ status: 'active' }` pour `user_id === 'u-active'`, sinon `{ status: 'removed' }`.
2. **Expose le health check** côté `membership` : ajoute le service `grpc.health.v1.Health` avec un statut initial `SERVING`, piloté par la variable `HEALTHY`.
3. **Écris le client gRPC** dans `family` : appelle `CheckMember` **avec une deadline**. En `@grpc/grpc-js`, la deadline se passe via l'objet `metadata`/`options` — `{ deadline: Date.now() + remainingMs }`.
4. **Propage le temps restant** : `family` reçoit une deadline de la part du gateway (via metadata `grpc-timeout` ou un champ applicatif). Calcule `remaining = deadlineAbsolue - Date.now()` et repasse-le à `membership`. **Ne redonne pas 2 s en dur.**
5. **Écris le handler gateway** (`family`'s caller) : appelle `family` avec `{ deadline: Date.now() + 2000 }`. Gère l'erreur `DEADLINE_EXCEEDED` (code `4`) → réponds `504 Gateway Timeout` à l'hôte.
6. **Lance** `docker compose up --build`. Teste le **nominal** : `curl -X POST localhost:3000/messages -d '{"userId":"u-active"}'` → accepté.
7. **Scénario lenteur** : passe `SLOW_MS=5000` sur `membership`, relance. Chronomètre : le `curl` doit échouer en **~2 s** (`504`), **pas** en 5 s. Vérifie dans les logs que `membership` voit l'appel **annulé**.
8. **Scénario instance malade** : passe `HEALTHY=false`, sonde le health check (`grpcurl -plaintext localhost:.../grpc.health.v1.Health/Check`) → `NOT_SERVING`. Explique à voix haute ce qu'un load balancer en ferait.

---

## Corrigé complet commenté

`membership/src/index.ts` :

```ts
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { HealthImplementation } from 'grpc-health-check'
import path from 'node:path'

const SLOW_MS = Number(process.env.SLOW_MS ?? 0)
const HEALTHY = process.env.HEALTHY !== 'false'

const def = protoLoader.loadSync(path.join(__dirname, '../../proto/membership.proto'))
const pkg = grpc.loadPackageDefinition(def) as any

// Handler unary : 1 requête → 1 réponse
function checkMember(call: any, cb: any) {
  const { user_id } = call.request

  // Détecter l'annulation : si le client (family) abandonne parce que SA deadline
  // est dépassée, gRPC annule l'appel côté serveur. On DOIT arrêter le travail —
  // le framework ne tue pas le setTimeout tout seul.
  let cancelled = false
  call.on('cancelled', () => {
    cancelled = true
    console.log('[membership] appel ANNULÉ (deadline amont dépassée)')
  })

  const respond = () => {
    if (cancelled) return // ne pas répondre à un appel déjà abandonné
    const status = user_id === 'u-active' ? 'active' : 'removed'
    cb(null, { status })
  }

  // SLOW_MS simule un service lent → déclenche DEADLINE_EXCEEDED en amont
  if (SLOW_MS > 0) setTimeout(respond, SLOW_MS)
  else respond()
}

const server = new grpc.Server()
server.addService(pkg.tribuzen.membership.Membership.service, { checkMember })

// Health check standard grpc.health.v1.Health.
// "" = santé globale du serveur ; on peut aussi enregistrer par service.
const health = new HealthImplementation({
  '': HEALTHY ? 'SERVING' : 'NOT_SERVING',
})
health.addToServer(server)

server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
  console.log(`[membership] up on 50051 (SLOW_MS=${SLOW_MS}, HEALTHY=${HEALTHY})`)
})
```

`family/src/index.ts` (sert de serveur pour le gateway ET de client pour membership) :

```ts
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'node:path'

const def = protoLoader.loadSync(path.join(__dirname, '../../proto/membership.proto'))
const pkg = grpc.loadPackageDefinition(def) as any

// Client vers membership (une connexion HTTP/2 réutilisée = multiplexing)
const membership = new pkg.tribuzen.membership.Membership(
  process.env.MEMBERSHIP_ADDR!,
  grpc.credentials.createInsecure(),
)

// Handler appelé par le gateway. call.getDeadline() renvoie la deadline
// propagée par gRPC depuis l'amont (le gateway l'a posée).
function postMessage(call: any, cb: any) {
  const { family_id, user_id } = call.request

  // PROPAGATION : on ne redonne PAS 2 s en dur.
  // On repasse la deadline reçue (déjà exprimée en point dans le temps).
  // gRPC convertit en temps restant tout seul quand on passe { deadline }.
  const upstreamDeadline = call.getDeadline() // Date | number hérité de l'amont

  membership.checkMember(
    { family_id, user_id },
    { deadline: upstreamDeadline }, // ← propagation du temps restant
    (err: any, reply: any) => {
      if (err) {
        // code 4 = DEADLINE_EXCEEDED, 1 = CANCELLED
        console.log(`[family] erreur amont: ${err.code} ${err.details}`)
        return cb({ code: err.code, details: 'membership indisponible' })
      }
      if (reply.status !== 'active') {
        return cb({ code: grpc.status.PERMISSION_DENIED, details: 'not an active member' })
      }
      // ... ici on écrirait réellement le message
      cb(null, { accepted: true })
    },
  )
}

const server = new grpc.Server()
// (proto family omis pour la concision — même principe : un service PostMessage)
server.bindAsync('0.0.0.0:50052', grpc.ServerCredentials.createInsecure(), () => {
  console.log('[family] up on 50052')
})
```

`gateway/src/index.ts` (REST à la lisière → gRPC en interne) :

```ts
import express from 'express'
import * as grpc from '@grpc/grpc-js'
// ... chargement du proto family identique

const app = express()
app.use(express.json())

const family = /* client gRPC vers process.env.FAMILY_ADDR */ null as any

app.post('/messages', (req, res) => {
  const { userId } = req.body

  // DEADLINE posée ICI, à la frontière : 2 s. C'est le point de départ
  // du budget de temps que toute la chaîne va se partager (propagation).
  const deadline = Date.now() + 2000

  family.postMessage(
    { family_id: 'fam-1', user_id: userId },
    { deadline },
    (err: any, reply: any) => {
      if (err?.code === grpc.status.DEADLINE_EXCEEDED) {
        // On a renoncé au bout de ~2 s, quelle que soit la lenteur d'en face.
        return res.status(504).json({ error: 'timeout' })
      }
      if (err?.code === grpc.status.PERMISSION_DENIED) {
        return res.status(403).json({ error: err.details })
      }
      if (err) return res.status(502).json({ error: 'upstream' })
      res.status(201).json(reply)
    },
  )
})

app.listen(3000, () => console.log('[gateway] REST up on 3000'))
```

**Pourquoi ce corrigé est correct :**
- La **deadline** est posée **une seule fois** au gateway (2 s). Grâce à `call.getDeadline()` + `{ deadline }`, `family` **propage** ce point dans le temps à `membership` : gRPC recalcule le temps restant → pas de travail orphelin (piège #3 du module).
- Avec `SLOW_MS=5000`, `membership` mettrait 5 s, mais la deadline de 2 s **remonte** en `DEADLINE_EXCEEDED` : le `curl` échoue en ~2 s. Le `call.on('cancelled')` côté `membership` **prouve** que le serveur voit l'annulation et arrête (piège #4 : mais tout effet de bord déjà écrit resterait).
- Le **health check** `grpc.health.v1.Health` est fourni par `grpc-health-check` avec `SERVING`/`NOT_SERVING` selon `HEALTHY` — c'est exactement le mécanisme qu'un LB/Kubernetes sonde pour retirer l'instance.
- Le **gateway parle REST** à l'hôte et **gRPC** en interne : la frontière REST/gRPC de TribuZen.

---

## Variante J+30 (fading)

**Même chaîne, contraintes ajoutées, en 30 min, sans rouvrir ce corrigé ni le module :**

1. Ajoute un **3ᵉ étage** : `membership → audit-service` (unary), lui aussi dans la propagation de deadline. Vérifie qu'avec un budget global de 2 s, si `family` consomme 0,5 s et `membership` 0,3 s, `audit` reçoit ~1,2 s.
2. Remplace l'appel `family → membership` par un **server streaming** `WatchMember` : `membership` pousse le statut à chaque changement pendant 10 s. Question à te poser : **la deadline s'applique-t-elle à l'appel entier ou à chaque message ?** (réponds à voix haute au coach).
3. Fais échouer le health check en cours de route (`HEALTHY=false` à chaud via un endpoint) et observe : le statut passe-t-il à `NOT_SERVING` **sans** tuer le process ?

**Critère de réussite :** le budget de temps est respecté de bout en bout sur 3 étages, et tu sais expliquer la sémantique de deadline sur un stream.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette chaîne vit ici :

```
tribuzen/
  services/
    api-gateway/     src/routes/messages.ts     ← REST → gRPC, deadline 2 s
    family-service/  src/clients/membership.ts  ← propagation via call.getDeadline()
                     proto/membership.proto
    membership-service/
                     src/health.ts              ← grpc.health.v1.Health
```

**Différences par rapport au lab :**
- Les adresses (`MEMBERSHIP_ADDR`, etc.) viendront du **service discovery / registre** (module 03) et non de variables d'env en dur.
- La deadline de 2 s sera un **budget configurable** par route, et couplée à un **circuit breaker** (module 14) pour arrêter d'appeler un service durablement malade au lieu d'attendre chaque deadline.
- Les effets de bord (écriture du message) seront rendus **idempotents** (module 08) pour tolérer un retry après `DEADLINE_EXCEEDED`.

**Commit cible :**
```
feat(family): CheckMember gRPC avec deadline propagée + health check membership
```
