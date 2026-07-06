---
titre: Communication synchrone — REST vs gRPC en profondeur
cours: 17-distributed-systems
notions:
  - "REST vs gRPC (critères de choix)"
  - "gRPC sur HTTP/2 (multiplexing, binaire)"
  - "les 4 types d'appels gRPC (unary, server/client/bidi streaming)"
  - "deadlines et timeouts"
  - "propagation de deadline"
  - "annulation d'appel (cancellation)"
  - "couplage temporel"
  - "health checking (grpc.health.v1.Health)"
  - "codes de statut (DEADLINE_EXCEEDED, CANCELLED)"
outcomes:
  - sait décider entre REST et gRPC pour un appel inter-services selon des critères concrets
  - sait expliquer pourquoi gRPC repose sur HTTP/2 et ce que le multiplexing apporte
  - sait distinguer et choisir les 4 types d'appels gRPC (unary, server/client/bidi streaming)
  - sait poser une deadline sur un appel, la propager dans une chaîne, et gérer DEADLINE_EXCEEDED
  - sait reconnaître le couplage temporel d'un appel synchrone et ses conséquences en cas de panne
  - sait exposer et consommer un health check gRPC pour retirer une instance malade
prerequis: [modules 00-03 — réseau, latence, panne partielle, RPC, premiers microservices, sérialisation et contrats (Protobuf)]
next: 05-communication-asynchrone-message-queues
libs: []
tribuzen: backend TribuZen — appel synchrone family-service → membership-service (vérifier l'appartenance avant d'écrire un événement) avec deadline et health check
last-reviewed: 2026-07
---

# Communication synchrone — REST vs gRPC en profondeur

> **Outcomes — tu sauras FAIRE :** choisir REST ou gRPC pour un appel inter-services, poser et propager une deadline, choisir le bon des 4 types d'appels gRPC, exposer un health check pour retirer une instance malade.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module couvre la communication **synchrone** (le demandeur attend la réponse, requête/réponse bloquante). La communication **asynchrone** (message queues, brokers, garanties de livraison) est le sujet du **module 05**. La **décision d'architecture** « quand découper en services, quel style de communication à l'échelle » relève du **cours 13-architecture** — ici on reste au niveau **mécanisme et implémentation**. Le circuit breaker et le budget de timeout sont approfondis au **module 14**.

## 1. Cas concret d'abord

Dans TribuZen, quand un utilisateur poste un message dans le fil d'une famille, le `family-service` doit d'abord vérifier auprès du `membership-service` que cet utilisateur est bien membre **actif** de la famille. C'est un appel **synchrone** : on ne peut pas écrire le message tant qu'on n'a pas la réponse.

Un collègue a écrit ce premier jet :

```ts
// family-service : vérifier l'appartenance avant d'écrire
async function postMessage(familyId: string, userId: string, body: string) {
  // Appel HTTP synchrone vers membership-service
  const res = await fetch(
    `http://membership-service/families/${familyId}/members/${userId}`
  )
  const member = await res.json()

  if (member.status !== 'active') {
    throw new Error('not a member')
  }
  // ... écrire le message
}
```

Ce code marche en démo. En production, il pose **quatre** problèmes que ce module va résoudre :

1. **Aucune deadline.** Si `membership-service` est lent (GC, surcharge, réseau), ce `fetch` peut attendre… indéfiniment. Chaque requête utilisateur bloque un handler, les threads s'accumulent, et `family-service` tombe à son tour. C'est une **panne en cascade** née d'un appel synchrone sans limite de temps.
2. **Couplage temporel.** `family-service` ne peut pas fonctionner **pendant** que `membership-service` est down. Poster un message exige que les deux services soient vivants *au même instant*. C'est le prix du synchrone — parfois justifié, parfois non.
3. **Contrat implicite.** `member.status` est un `any` sorti d'un `res.json()`. Aucune vérification que le service d'en face renvoie bien ce champ. Un renommage côté `membership-service` casse silencieusement l'appelant.
4. **Pas de retrait des instances mortes.** Si une des trois instances de `membership-service` est malade, rien ne l'empêche de recevoir cette requête.

Ce module te donne les outils : **deadlines + propagation**, choix **REST vs gRPC**, les **4 types d'appels**, la reconnaissance du **couplage temporel**, et le **health checking**.

---

## 2. Théorie complète, concise

### 2.1 Synchrone = requête/réponse bloquante = couplage temporel

Un appel est **synchrone** quand l'appelant **attend la réponse** pour continuer. Conséquence structurante : les deux services doivent être **disponibles au même moment**. On appelle ça le **couplage temporel** (temporal coupling).

```
SYNCHRONE (ce module)                ASYNCHRONE (module 05)
A ──req──► B                         A ──msg──► [ queue ] ──► B
A ◄─rép── B  (A attend, bloqué)      A continue immédiatement
Il faut A ET B vivants EN MÊME       B peut être down maintenant,
TEMPS.                               traiter le message plus tard.
```

Le synchrone n'est pas « mauvais » — il est **plus simple à raisonner** (tu as la réponse tout de suite, tu peux enchaîner) et parfois **obligatoire** : une vérification d'autorisation, une lecture de donnée dont tu as besoin *maintenant* pour répondre à l'utilisateur. Mais chaque appel synchrone **ajoute une dépendance de disponibilité** : la disponibilité de l'appelant devient le produit des disponibilités de toute la chaîne.

**Règle de décision (rappel du module 01) :** utilise le synchrone quand tu as besoin de la réponse *pour produire la tienne*. Bascule vers l'asynchrone (module 05) quand un « accusé de réception, je traiterai plus tard » suffit — ça casse le couplage temporel.

### 2.2 REST vs gRPC — les deux styles synchrones

Les deux transportent une requête/réponse. Ils diffèrent sur le transport, le format, et le contrat.

| Critère | REST / JSON (HTTP/1.1 ou 2) | gRPC / Protobuf (HTTP/2) |
|---|---|---|
| Format de données | JSON texte, verbeux, lisible | Protobuf binaire, compact, typé |
| Contrat | OpenAPI optionnel, souvent implicite | Fichier `.proto` **obligatoire**, source de vérité |
| Génération de code | Optionnelle | Client + serveur générés depuis le `.proto` |
| Streaming | Limité (SSE, chunked) | Natif : server / client / bidirectionnel |
| Navigateur | Direct (`fetch`) | Nécessite un proxy (grpc-web) |
| Outillage humain | `curl`, Postman, lisible à l'œil | Nécessite des outils (`grpcurl`) |
| Cache HTTP | Natif (module 11-http-caching) | Non |
| Idéal pour | API publiques, front↔back, hétérogène | Communication **inter-services** interne, haute fréquence, faible latence |

**Heuristique concrète :** exposé au navigateur ou à des tiers → **REST**. Appel interne service↔service à fort débit, contrat strict, streaming → **gRPC**. Beaucoup de systèmes réels font **les deux** : REST à la lisière (API gateway, module 07), gRPC entre services internes.

### 2.3 Pourquoi gRPC repose sur HTTP/2

gRPC est bâti **sur HTTP/2**, et ce n'est pas un détail. HTTP/1.1 ouvre une requête par connexion à la fois (ou fait la queue). HTTP/2 apporte :

- **Multiplexing** : plusieurs requêtes/réponses (des *streams*) circulent **en parallèle sur une seule connexion TCP**, sans se bloquer les unes les autres (pas de head-of-line blocking au niveau HTTP).
- **Cadres binaires (frames)** : le protocole est binaire, adapté à Protobuf.
- **Compression des en-têtes (HPACK)** : les headers répétés ne repartent pas en entier à chaque requête.
- **Streams bidirectionnels** longue durée : c'est ce qui rend possibles les 4 types d'appels ci-dessous.

Concrètement, une seule connexion HTTP/2 entre `family-service` et `membership-service` porte des centaines d'appels concurrents — bien plus efficace qu'un pool de connexions HTTP/1.1.

### 2.4 Les 4 types d'appels gRPC

gRPC définit **quatre** types d'appels (source : grpc.io, *Core concepts*). Le choix se fait selon la cardinalité des messages de chaque côté.

```
1. UNARY                       1 requête → 1 réponse
   Client ──req──► Serveur     « vérifie ce membre »
   Client ◄─rép── Serveur      = le cas le plus courant

2. SERVER STREAMING            1 requête → N réponses (flux serveur)
   Client ──req──► Serveur     « abonne-moi au statut de la commande »
   Client ◄─rép1─ Serveur      ordre des messages garanti dans l'appel
   Client ◄─rép2─ Serveur
   Client ◄─répN─ Serveur

3. CLIENT STREAMING            N requêtes → 1 réponse (flux client)
   Client ──req1─► Serveur     « voici 10 000 événements à ingérer »
   Client ──req2─► Serveur     réponse une fois le flux terminé
   Client ──reqN─► Serveur
   Client ◄─rép── Serveur

4. BIDIRECTIONAL STREAMING     N requêtes ↔ M réponses, indépendants
   Client ──req1─► Serveur     les deux flux sont INDÉPENDANTS :
   Client ◄─rép1─ Serveur      chacun lit/écrit dans l'ordre qu'il veut
   Client ──req2─► Serveur      « chat temps réel, télémétrie »
```

Points de sémantique **vérifiés** (grpc.io) :
- **Unary** : « comme un appel de fonction normal », une requête une réponse.
- gRPC **garantit l'ordre des messages à l'intérieur d'un appel** (utile pour le server streaming).
- En **bidirectionnel**, les deux flux « opèrent indépendamment » — client et serveur lisent/écrivent dans l'ordre qu'ils veulent, pas forcément en alternance.

Attention à ne pas confondre le **streaming gRPC** (toujours synchrone : les deux pairs sont connectés en même temps sur le même appel) avec l'**asynchronisme par message queue** du module 05. Un flux bidirectionnel est du synchrone longue durée, pas du découplage temporel.

Représentation TypeScript du contrat (le code réel est **généré** depuis le `.proto`, cf. module 03 sérialisation) :

```ts
// Signature conceptuelle d'un service gRPC côté TypeScript
interface MembershipService {
  // Unary
  checkMember(req: { familyId: string; userId: string }): Promise<MemberStatus>

  // Server streaming — flux de mises à jour de statut
  watchMember(req: { familyId: string; userId: string }): AsyncIterable<MemberStatus>

  // Client streaming — ingestion d'un lot
  importMembers(reqs: AsyncIterable<Member>): Promise<{ imported: number }>

  // Bidirectional streaming — synchro live
  syncMembers(reqs: AsyncIterable<MemberDelta>): AsyncIterable<MemberDelta>
}
```

### 2.5 Deadlines et timeouts — la protection n°1 du synchrone

C'est le point le plus important du module. **Sans deadline, un appel synchrone peut bloquer indéfiniment** (le cas concret §1, problème 1).

Vocabulaire **vérifié** (grpc.io, *Deadlines*) :
- Un **timeout** = une durée maximale (« j'attends au plus 2 s »).
- Une **deadline** = un point dans le temps (« j'attends jusqu'à 10:00:02 »).
- gRPC travaille en **deadlines** : un timeout est converti en deadline en ajoutant la durée à l'heure courante au moment de l'appel.

**Par défaut, gRPC ne pose AUCUNE deadline** — un client peut donc attendre « effectivement pour toujours ». **Tu dois en poser une explicitement sur chaque appel.** Quand la deadline est dépassée :
- le **client** reçoit le statut `DEADLINE_EXCEEDED` et abandonne l'appel ;
- le **serveur** voit l'appel annulé (statut `CANCELLED`) et **doit** arrêter le travail en cours — le framework ne tue pas automatiquement une opération longue, c'est à ton code de vérifier l'annulation.

En REST/`fetch`, l'équivalent se fait à la main avec un `AbortController` :

```ts
// REST : imposer un timeout à un fetch (pas de deadline par défaut non plus)
const ctrl = new AbortController()
const t = setTimeout(() => ctrl.abort(), 2000) // deadline = maintenant + 2 s
try {
  const res = await fetch(url, { signal: ctrl.signal })
  // ...
} finally {
  clearTimeout(t)
}
// Si le délai passe : fetch rejette avec une AbortError.
```

### 2.6 Propagation de deadline dans une chaîne

Le vrai pouvoir des deadlines apparaît dans une **chaîne d'appels** : `A → B → C`. Si A donne 2 s à B, et que B rappelle C, B ne doit **pas** redonner 2 s à C — il doit passer **le temps qui reste**.

gRPC gère ça avec la **propagation de deadline** : quand un serveur agit comme client d'un autre service, il transmet la deadline d'origine. Le framework convertit la deadline absolue en timeout relatif en **tenant compte du temps déjà écoulé** (ce qui évite les problèmes de synchronisation d'horloge entre machines — cf. module 19).

```
A pose deadline = 2 s ─────► B
                            │ 0,5 s se sont écoulées ici
                            ▼
                    B rappelle C avec le temps RESTANT = 1,5 s
```

Sans propagation, chaque étage repartirait de zéro : `A` abandonne au bout de 2 s mais `C` continuerait de travailler pour rien (**travail orphelin**). La propagation garantit que **quand A renonce, toute la chaîne renonce**. Selon le langage la propagation est activée par défaut (Java, Go) ou à configurer (C++).

### 2.7 Annulation (cancellation)

Deux façons d'annuler un appel synchrone :
1. **Deadline dépassée** → annulation automatique (`DEADLINE_EXCEEDED` côté client, `CANCELLED` côté serveur).
2. **Annulation explicite** : soit le client, soit le serveur peut annuler à tout moment.

Sémantique **cruciale et vérifiée** (grpc.io) : **les modifications faites avant l'annulation ne sont PAS annulées** (« changes made before a cancellation are not rolled back »). gRPC n'offre **aucune garantie transactionnelle**. Si l'appel a déjà écrit en base avant d'être annulé, cette écriture reste. D'où l'importance de l'**idempotence** (module 08) et des **sagas / compensation** (module 11) pour les opérations qui modifient l'état.

### 2.8 Health checking — retirer une instance malade

Comment un load balancer (module 07) sait-il qu'une instance ne doit **plus** recevoir de trafic ? Via un **health check**.

gRPC standardise ça avec le **protocole de health checking** (`grpc.health.v1.Health`), source de vérité grpc.io. Deux méthodes :
- **`Check`** (unary) : « es-tu en état de servir ? » — utilisé par le monitoring centralisé et les load balancers. Ne passe pas à l'échelle si chaque client interroge en boucle.
- **`Watch`** (server streaming) : le client s'abonne et reçoit les changements de statut en flux — utilisé par le health check côté client de gRPC.

Trois valeurs de `ServingStatus` :

| Statut | Sens |
|---|---|
| `SERVING` | opérationnel, accepte le trafic |
| `NOT_SERVING` | vivant mais ne peut pas servir *maintenant* (dépendance down, warmup) |
| `SERVICE_UNKNOWN` | service non reconnu par le serveur de health |

Une chaîne vide `""` représente la **santé globale du serveur** (pas d'un service particulier). Kubernetes et les load balancers s'appuient là-dessus pour **isoler automatiquement** une instance malsaine.

Distinction importante (revue au module 03) : **liveness** (« le process est-il vivant ? » — sinon on le redémarre) vs **readiness** (« est-il prêt à recevoir du trafic *maintenant* ? » — sinon on le retire du LB sans le tuer). Un service qui attend une dépendance répond `NOT_SERVING` en readiness sans être mort.

En REST, l'équivalent est un simple endpoint `GET /health` renvoyant `200` (sain) ou `503` (indisponible) — moins standardisé mais universel.

---

## 3. Worked examples

### Exemple 1 — Le cas concret §1, durci (REST + deadline + contrat)

On reprend `postMessage` et on corrige les 4 problèmes, en restant en REST (le plus rapide à durcir sans changer le transport).

```ts
// family-service — appel synchrone durci vers membership-service

// 1) Contrat explicite : on valide la forme de la réponse (module 03)
interface MemberStatus {
  userId: string
  familyId: string
  status: 'active' | 'invited' | 'removed'
}

function isMemberStatus(x: unknown): x is MemberStatus {
  return (
    typeof x === 'object' && x !== null &&
    'status' in x &&
    ['active', 'invited', 'removed'].includes((x as MemberStatus).status)
  )
}

async function checkMember(
  familyId: string,
  userId: string,
  deadlineMs = 2000, // 2) deadline explicite — JAMAIS d'appel synchrone sans limite
): Promise<MemberStatus> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), deadlineMs)
  try {
    const res = await fetch(
      `http://membership-service/families/${familyId}/members/${userId}`,
      { signal: ctrl.signal },
    )
    if (!res.ok) {
      // 404 = pas membre, 5xx = panne d'en face : on distingue
      throw new Error(`membership-service ${res.status}`)
    }
    const data: unknown = await res.json()
    if (!isMemberStatus(data)) {
      throw new Error('contrat invalide: réponse inattendue')
    }
    return data
  } finally {
    clearTimeout(timer) // toujours nettoyer le timer
  }
}

async function postMessage(familyId: string, userId: string, body: string) {
  const member = await checkMember(familyId, userId) // synchrone : on a besoin de la réponse maintenant
  if (member.status !== 'active') {
    throw new Error('not an active member')
  }
  // ... écrire le message
}
```

Ce qui est corrigé :
- **Deadline** (`AbortController` + `setTimeout`) → l'appel ne peut plus bloquer indéfiniment (problème 1).
- **Contrat** validé par `isMemberStatus` → un renommage côté serveur lève une erreur claire au lieu d'un `undefined` silencieux (problème 3).
- Le **couplage temporel** (problème 2) reste — c'est **inhérent** au synchrone. Si `membership-service` est down, `postMessage` échoue. La deadline empêche juste que l'échec **contamine** `family-service`. Casser réellement le couplage voudrait dire basculer en asynchrone (module 05) ou tolérer une réponse dégradée (circuit breaker + fallback, module 14).
- Le **retrait d'instance morte** (problème 4) se règle avec le health check (Exemple 2).

### Exemple 2 — Health check des deux côtés

Côté `membership-service`, on expose une readiness honnête ; côté appelant / LB, on l'interroge.

```ts
// membership-service — endpoint de readiness (REST, style grpc.health.v1)
import express from 'express'
const app = express()

let dbReady = false // passe à true quand la connexion DB est établie

app.get('/health/live', (_req, res) => {
  // Liveness : le process tourne. Ne teste PAS les dépendances.
  res.status(200).json({ status: 'SERVING' })
})

app.get('/health/ready', (_req, res) => {
  // Readiness : prêt à servir MAINTENANT ? Teste la dépendance critique.
  if (!dbReady) {
    // NOT_SERVING : vivant mais à retirer du load balancer, sans le tuer
    return res.status(503).json({ status: 'NOT_SERVING' })
  }
  res.status(200).json({ status: 'SERVING' })
})
```

```ts
// Côté load balancer / registre (rappel module 03) : sonde périodique
async function probe(host: string): Promise<'SERVING' | 'NOT_SERVING'> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1000) // deadline courte sur le health check
  try {
    const res = await fetch(`http://${host}/health/ready`, { signal: ctrl.signal })
    return res.ok ? 'SERVING' : 'NOT_SERVING'
  } catch {
    return 'NOT_SERVING' // timeout ou refus de connexion = à retirer
  } finally {
    clearTimeout(t)
  }
}
```

Le distinguo **live / ready** est le cœur : redémarrer un service parce que sa DB rame (confondre readiness et liveness) aggrave la panne au lieu de la contenir. Un `NOT_SERVING` en readiness le sort du trafic, le laisse récupérer, et le LB le réintègre dès qu'il repasse `SERVING`.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « gRPC, c'est de l'asynchrone »

Faux. gRPC est **synchrone**, y compris en streaming. Un flux bidirectionnel garde **les deux pairs connectés en même temps** sur le même appel HTTP/2 — c'est du couplage temporel longue durée. L'asynchrone au sens « découplé dans le temps via un broker » est le **module 05**. Ne pas confondre *streaming* (flux sur un appel synchrone vivant) et *messaging* (dépôt dans une queue, l'autre lira plus tard).

### PIÈGE #2 — Appel synchrone sans deadline

Le défaut le plus dangereux. **gRPC ne pose aucune deadline par défaut**, et un `fetch` non plus. Un appel sans limite de temps transforme la lenteur d'un service en **panne en cascade** de tous ses appelants (threads/handlers épuisés). Règle absolue : **tout appel synchrone porte une deadline explicite**, choisie d'après la latence réelle mesurée (pas au hasard).

### PIÈGE #3 — Redonner la deadline complète à chaque étage

Dans `A → B → C`, si B redonne 2 s à C alors que 0,5 s sont déjà écoulées, C peut travailler jusqu'à 2 s pendant que A a déjà abandonné à 2 s : **travail orphelin**. Il faut **propager le temps restant** (1,5 s), pas repartir de zéro. gRPC le fait via la propagation de deadline ; en REST à la main, calcule `restant = deadline_absolue - maintenant` et repasse-le à l'appel suivant.

### PIÈGE #4 — Croire qu'une annulation « annule » le travail déjà fait

`CANCELLED` / `DEADLINE_EXCEEDED` arrêtent l'attente, **pas** les effets de bord déjà produits. gRPC le dit explicitement : « les changements faits avant l'annulation ne sont pas rollback ». Si l'appel a déjà inséré une ligne, elle reste. Pour toute opération qui **modifie l'état**, prévois l'**idempotence** (module 08) ou une **compensation** (saga, module 11) — ne compte jamais sur l'annulation comme un rollback.

### PIÈGE #5 — Confondre liveness et readiness

`liveness` = « le process est-il vivant ? » → si non, on le **tue et redémarre**. `readiness` = « peut-il servir maintenant ? » → si non, on le **retire du LB sans le tuer**. Mettre un test de DB dans le check de liveness fait redémarrer en boucle un service dont la seule faute est d'attendre sa base : la panne s'auto-entretient. Réponds `NOT_SERVING` en readiness, garde la liveness minimale.

### PIÈGE #6 — Choisir gRPC pour une API navigateur

Un navigateur ne parle pas gRPC nativement (il faut un proxy grpc-web). Pour du front↔back public, REST/JSON reste le choix par défaut : lisible, cachable (module 11), débogable au `curl`. gRPC brille **entre services internes** — pas à la lisière navigateur.

---

## 5. Ancrage TribuZen

TribuZen est un ensemble de services. La communication **synchrone** apparaît partout où un service a besoin d'une réponse *pour produire la sienne* :

- **`family-service` → `membership-service`** (le cas concret) : vérifier qu'un utilisateur est membre actif **avant** d'écrire un message ou un événement. Synchrone justifié : on ne peut pas autoriser l'écriture sans la réponse. → deadline 2 s + validation de contrat + health check.
- **`api-gateway` → services** (module 07) : le gateway expose du **REST** au front (navigateur, app mobile), et parle aux services internes. C'est la frontière REST/interne.
- **`membership-service` interne → `notification-service`** : quand un lot d'invitations part, un **client streaming** gRPC pourrait pousser N invitations en un appel plutôt que N requêtes REST.

**Décision de style dans TribuZen :**
- Front ↔ gateway : **REST/JSON** (navigateur, cache HTTP, lisibilité).
- Service ↔ service interne à fort débit : candidat **gRPC/Protobuf** (contrat `.proto` strict, HTTP/2, streaming).
- Vérification synchrone bloquante (appartenance, autorisation) : garde-la **rare et bornée par une deadline** ; tout ce qui peut être « je te préviens, tu traiteras » passe en **asynchrone** (module 05).

Chaque service TribuZen expose `/health/live` et `/health/ready` (ou le service `grpc.health.v1.Health` en gRPC), consommés par le load balancer / registre du module 03.

Fichiers cibles dans `smaurier/tribuzen` :
```
tribuzen/
  services/
    family-service/
      src/clients/membershipClient.ts   ← checkMember() avec deadline + contrat
    membership-service/
      src/health.ts                      ← /health/live et /health/ready
      proto/membership.proto             ← contrat gRPC (module 03)
```

---

## 6. Points clés

1. **Synchrone = requête/réponse bloquante = couplage temporel** : les deux services doivent être vivants en même temps ; à utiliser seulement quand tu as besoin de la réponse pour produire la tienne.
2. **REST** = JSON/HTTP, lisible, cachable, idéal à la lisière navigateur ; **gRPC** = Protobuf/HTTP/2, contrat `.proto` strict, idéal inter-services internes.
3. **gRPC repose sur HTTP/2** : multiplexing (plusieurs streams concurrents sur une connexion), frames binaires, compression d'en-têtes — c'est ce qui rend le streaming possible.
4. **4 types d'appels gRPC** : unary, server streaming, client streaming, bidirectionnel (flux indépendants) ; l'ordre des messages est garanti dans un appel.
5. **Aucune deadline par défaut** (gRPC comme `fetch`) : pose-en toujours une explicite, sinon lenteur → panne en cascade.
6. **Propage le temps restant**, pas la deadline complète, dans une chaîne `A → B → C`, sinon travail orphelin.
7. **Annulation ≠ rollback** : `CANCELLED`/`DEADLINE_EXCEEDED` arrêtent l'attente mais pas les effets déjà produits → idempotence (module 08) / compensation (module 11).
8. **Health check** (`grpc.health.v1.Health` : `Check`/`Watch`, `SERVING`/`NOT_SERVING`/`SERVICE_UNKNOWN`) ; distingue **liveness** (redémarrer) et **readiness** (retirer du LB).

---

## 7. Seeds Anki

```
Qu'est-ce que le couplage temporel d'un appel synchrone ?|Les deux services doivent être disponibles AU MÊME MOMENT : l'appelant est bloqué en attente de la réponse. La disponibilité de la chaîne devient le produit des disponibilités. L'asynchrone (broker) casse ce couplage.
Quand choisir gRPC plutôt que REST ?|gRPC pour la communication inter-services INTERNE à fort débit / faible latence, avec contrat .proto strict et streaming (HTTP/2). REST pour l'exposition au navigateur / tiers : lisible, cachable, débogable au curl. gRPC ne marche pas nativement dans un navigateur.
Pourquoi gRPC repose-t-il sur HTTP/2 ?|Multiplexing (plusieurs streams concurrents sur une seule connexion TCP, sans head-of-line blocking HTTP), frames binaires adaptés à Protobuf, compression d'en-têtes HPACK, streams bidirectionnels longue durée qui rendent possibles les 4 types d'appels.
Quels sont les 4 types d'appels gRPC ?|Unary (1 req → 1 rép), server streaming (1 req → N rép), client streaming (N req → 1 rép), bidirectionnel (N req ↔ M rép, flux indépendants). L'ordre des messages est garanti à l'intérieur d'un appel.
Différence entre une deadline et un timeout en gRPC ?|Un timeout est une durée max ; une deadline est un point dans le temps. gRPC travaille en deadlines (timeout converti en deadline = maintenant + durée). Par défaut gRPC ne pose AUCUNE deadline : il faut en poser une explicitement sinon l'appel peut attendre indéfiniment.
Pourquoi propager le temps restant et non la deadline complète dans A→B→C ?|Si B redonne 2 s à C alors que 0,5 s se sont écoulées, C travaille jusqu'à 2 s pendant que A a déjà abandonné à 2 s = travail orphelin. La propagation passe le temps restant (1,5 s) pour que, quand A renonce, toute la chaîne renonce.
Une annulation gRPC annule-t-elle le travail déjà effectué ?|Non. CANCELLED / DEADLINE_EXCEEDED arrêtent l'attente mais PAS les effets de bord déjà produits (aucune garantie transactionnelle). Pour les opérations qui modifient l'état : idempotence (module 08) ou compensation/saga (module 11).
Différence entre liveness et readiness dans un health check ?|Liveness = le process est-il vivant ? Sinon on le TUE et redémarre. Readiness = peut-il servir MAINTENANT ? Sinon on le RETIRE du load balancer sans le tuer. Mettre un test de DB en liveness provoque des redémarrages en boucle : utiliser NOT_SERVING en readiness.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-04-communication-synchrone/README.md`. Implémenter un appel gRPC `family-service → membership-service` avec deadline et propagation, via un docker-compose fourni — vrai `@grpc/grpc-js`, corrigé commenté intégral.
