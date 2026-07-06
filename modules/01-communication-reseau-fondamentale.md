---
titre: Communication réseau fondamentale (le réseau n'est pas fiable)
cours: 17-distributed-systems
notions: ["modèle réseau utile au distribué", "latence vs bande passante", "RTT (round-trip time)", "TCP vs UDP", "RPC : concept et limites", "partial failure réseau", "le réseau n'est pas fiable", "timeout et incertitude"]
outcomes:
  - sait distinguer latence et bande passante, et raisonner en RTT plutôt qu'en débit
  - sait situer les ordres de grandeur (mémoire vs même datacenter vs traversée continentale)
  - sait expliquer pourquoi TCP est fiable mais pas gratuit, et quand UDP a du sens
  - sait dire ce qu'un RPC cache et pourquoi un appel distant n'est pas un appel local
  - sait raisonner le partial failure et l'incertitude fondamentale d'un timeout
prerequis: [pourquoi le distribué et les fallacies — module 00 du cours 17-distributed-systems]
next: 02-microservices-en-typescript
libs: []
tribuzen: plateforme TribuZen découpée en services (auth, familles, notifications) — le lien réseau entre ces services
last-reviewed: 2026-07
---

# Communication réseau fondamentale — le réseau n'est pas fiable

> **Outcomes — tu sauras FAIRE :** distinguer latence et bande passante et raisonner en RTT, situer les ordres de grandeur réseau, expliquer TCP vs UDP et ce qu'un RPC cache, raisonner un partial failure.
> **Difficulté :** :star::star:
>
> **Portée :** ce module pose le socle réseau *utile au distribué*. On ne refait pas un cours OSI complet : on garde ce qui change tes décisions de conception. Les timeouts/retries en profondeur sont le **module 08**, la communication synchrone (REST/gRPC) le **module 04**, l'asynchrone (brokers) le **module 05**.

## 1. Cas concret d'abord

TribuZen était un monolithe. Tu viens de le découper en trois services : `auth-service`, `family-service`, `notification-service`. Hier, `family.getMembers()` était un appel de fonction dans le même processus : quelques nanosecondes, jamais d'échec « réseau ». Aujourd'hui, `family-service` doit demander à `auth-service` si le token est valide, **par le réseau**.

Un collègue a écrit ce code, qui « marche sur ma machine » :

```typescript
// family-service — vérifie le token auprès de auth-service
async function getMembers(familyId: string, token: string) {
  // ⚠️ appel réseau déguisé en appel de fonction ordinaire
  const user = await authClient.verify(token)
  return db.members.findByFamily(familyId, user.id)
}
```

En production, trois choses nouvelles peuvent arriver, qui n'existaient **pas** dans le monolithe :

1. `auth-service` répond en **80 ms** au lieu de 0,0001 ms — la page traîne sans qu'aucun code ne soit « lent ».
2. `authClient.verify()` **ne répond jamais** : le service est tombé, ou le paquet s'est perdu. Ton `await` attend… combien de temps ? Indéfiniment, par défaut.
3. `auth-service` **a bien validé le token**, mais la réponse s'est perdue sur le retour. De ton côté : échec. De son côté : succès. Qui a raison ?

Ces trois problèmes — latence, panne partielle, incertitude — sont le cœur du distribué. Ce module te donne le vocabulaire et les ordres de grandeur pour les raisonner **avant** d'écrire une seule ligne de retry.

---

## 2. Théorie complète, concise

### 2.1 Latence vs bande passante — deux choses différentes

Deux métriques indépendantes, souvent confondues :

- **Latence** : le temps d'aller-retour d'un message. MDN la définit comme « the time it takes for a data request to get from the computer making the request, to the computer responding […] generally measured as a round trip delay ». Unité : millisecondes.
- **Bande passante** (throughput/débit) : la quantité de données transférables par seconde. Unité : Mb/s, Gb/s.

Analogie : la latence est le temps que met **un** camion pour faire Lyon→Paris ; la bande passante est **combien** de camions passent par heure. Élargir l'autoroute (plus de bande passante) ne fait pas rouler le camion plus vite (latence inchangée).

**Conséquence de conception :** en distribué, le tueur c'est presque toujours la **latence**, pas la bande passante. Un endpoint qui fait 10 petits appels séquentiels à un autre service paie **10 × RTT**, même si chaque réponse pèse 200 octets. La bande passante est oisive ; le temps s'accumule en allers-retours.

### 2.2 RTT — l'unité de raisonnement

Le **RTT** (round-trip time) est le temps d'un aller-retour complet. C'est l'unité dans laquelle il faut penser, parce que la plupart des protocoles coûtent un nombre entier de RTT :

- Établir une connexion TCP : **1 RTT** (le handshake, cf. 2.4).
- Négocier TLS par-dessus : **1 à 2 RTT** de plus.
- Chaque requête/réponse applicative : **≥ 1 RTT**.

Donc un premier appel HTTPS « à froid » vers un service coûte facilement **3 à 4 RTT** avant même la première donnée utile. Si le RTT est de 40 ms, tu as déjà brûlé ~120–160 ms sans rien calculer.

### 2.3 Les ordres de grandeur (à mémoriser)

Le raisonnement distribué repose sur une intuition des échelles. Chiffres canoniques (Jeff Dean, « Latency Numbers Every Programmer Should Know », ~2012 — les ratios restent valables) :

| Opération | Temps | En « échelle humaine » (×10⁹) |
|---|---|---|
| Référence cache L1 | 0,5 ns | 0,5 s (un battement de cœur) |
| Référence mémoire vive | 100 ns | ~2 min |
| Lecture 4 Ko aléatoire sur SSD | 150 µs | ~2 jours |
| **Aller-retour même datacenter** | **500 µs** | ~6 jours |
| Lecture 1 Mo séquentiel sur SSD | 1 ms | ~11 jours |
| **Paquet Californie→Pays-Bas→Californie** | **150 ms** | ~5 ans |

La leçon : un aller-retour dans le **même datacenter** (~0,5 ms) est déjà **5 000 fois** plus lent qu'un accès mémoire. Une traversée **intercontinentale** (~150 ms) est ~1,5 million de fois plus lente. Un appel réseau n'est jamais « gratuit » — il est d'un autre ordre de grandeur que l'appel de fonction qu'il remplace.

Note physique : ~150 ms Californie↔Pays-Bas n'est pas de la lenteur logicielle, c'est la **vitesse de la lumière** dans la fibre sur ~9 000 km × 2. Aucun optimisation logicielle ne descendra sous ce plancher. On ne « corrige » pas la latence géographique ; on l'**architecture** (colocaliser, mettre en cache, batcher).

### 2.4 TCP vs UDP — fiable ou pas, au choix

Deux protocoles de transport au-dessus d'IP :

**TCP** — orienté connexion, **fiable et ordonné** :
- Un **handshake en 3 temps** (SYN → SYN-ACK → ACK) établit la connexion avant tout échange : ça coûte 1 RTT.
- Il garantit la livraison (ré-émission des paquets perdus), l'ordre, et le contrôle de flux/congestion.
- Prix à payer : le handshake, la latence de ré-émission en cas de perte, l'état à maintenir des deux côtés.
- **HTTP, gRPC, la plupart des API** roulent sur TCP.

**UDP** — sans connexion, **best-effort** :
- Pas de handshake, pas de garantie de livraison, pas d'ordre. Tu envoies, tu espères.
- Beaucoup plus léger : idéal quand une donnée en retard est inutile de toute façon.
- Usages : DNS, streaming vidéo/voix, jeux temps réel, métriques haute fréquence, **QUIC/HTTP-3** (qui reconstruit la fiabilité au-dessus d'UDP).

Règle mentale : **TCP quand chaque octet compte** (transactions, API métier) ; **UDP quand la fraîcheur prime sur la complétude** (un vieux paquet audio ne sert à rien).

### 2.5 RPC — l'appel distant déguisé en appel local

Un **RPC** (Remote Procedure Call) fait qu'appeler une fonction sur une autre machine *ressemble* à un appel local : `authClient.verify(token)` cache l'encodage des arguments, l'envoi réseau, l'attente, le décodage de la réponse. gRPC, tRPC, un client REST typé — tous sont des RPC. L'idée (Wikipedia) : « the programmer writes essentially the same code whether the subroutine is local […] or remote. »

C'est puissant *et* dangereux, parce que la ressemblance est un mensonge. Un appel distant diffère d'un appel local sur des points **non négociables** :

1. **Il peut échouer sans que ta fonction ait de bug** : « remote calls can fail because of unpredictable network problems ». Le réseau tombe, le service redémarre — le langage ne modélise pas ça.
2. **Il est plus lent de plusieurs ordres de grandeur** : « orders of magnitude slower and less reliable than local calls ». (cf. 2.3.)
3. **Pas de mémoire partagée** : les arguments doivent être **sérialisés** (copiés, encodés) puis désérialisés. On ne passe pas un pointeur par le réseau.

L'erreur classique — la « transparence » de RPC — consiste à traiter `authClient.verify(token)` comme `verify(token)` local : sans timeout, sans gestion d'échec, sans conscience du coût. Ça marche en dev (RTT ~0,1 ms, jamais de panne) et casse en prod.

### 2.6 Partial failure — le problème central du distribué

Dans un monolithe, l'échec est **total** : soit tout le processus tourne, soit il crashe. Il n'y a pas d'entre-deux. En distribué, l'échec est **partiel** : `auth-service` est tombé mais `family-service` tourne ; le lien réseau vers `notification-service` est coupé mais le service va bien.

Le piège n'est pas la panne — c'est **l'incertitude**. Reprends le scénario 3 du §1 : tu envoies `verify(token)`, tu ne reçois **rien**. Trois causes possibles, indistinguables de ton côté :

- (a) ta requête ne lui est jamais parvenue (perdue à l'aller) ;
- (b) il l'a traitée mais la réponse s'est perdue (perdue au retour) ;
- (c) il est juste très lent et la réponse arrive dans 200 ms.

**Tu ne peux pas savoir laquelle.** Un timeout ne te dit **pas** « ça a échoué » ; il te dit seulement « je n'ai pas eu de réponse à temps ». Le travail a peut-être été fait. C'est pourquoi rejouer aveuglément un appel après timeout peut **doubler** l'action (deux débits, deux emails) — d'où l'**idempotence** et les retries prudents (module 08).

### 2.7 Le réseau n'est pas fiable — la première fallacie, en pratique

« The network is reliable » est la première des 8 fallacies (module 00). Concrètement, entre deux services tu dois toujours supposer possible :

- la **perte** d'un message (à l'aller ou au retour) ;
- le **délai** arbitraire (un paquet peut arriver après ton timeout) ;
- le **duplicata** (ré-émission TCP, retry applicatif) ;
- le **désordre** applicatif (deux appels partis dans un ordre, arrivés dans l'autre).

La conséquence pratique tient en une phrase : **tout appel réseau a besoin d'un timeout explicite**. Sans lui, l'`await` du §1 attend l'infini, immobilise un connecteur, et une seule dépendance lente peut geler tout ton service (cascade — module 14). Le timeout n'est pas un détail de robustesse : c'est la reconnaissance codée que le réseau n'est pas fiable.

---

## 3. Worked examples

### Exemple 1 — Compter le coût réel d'un endpoint en RTT

`family-service` expose `GET /families/:id/dashboard`. Le code naïf appelle trois services **en séquence** :

```typescript
async function dashboard(familyId: string, token: string) {
  const user    = await authClient.verify(token)          // appel 1
  const family  = await familyClient.get(familyId)        // appel 2
  const notifs  = await notifClient.unreadCount(user.id)  // appel 3
  return { family, unread: notifs }
}
```

Supposons un RTT intra-datacenter de **0,5 ms** par appel, avec connexions déjà chaudes (pas de handshake à repayer). Raisonnons **en RTT**, pas en débit :

- Séquentiel : `verify` puis `get` puis `unreadCount` → **3 × 0,5 = 1,5 ms** de temps réseau, car chaque `await` attend la réponse avant de lancer le suivant.
- Mais `familyClient.get` et `notifClient.unreadCount` **ne dépendent pas** l'un de l'autre. Seul `unreadCount` a besoin de `user.id`.

Version parallélisée :

```typescript
async function dashboard(familyId: string, token: string) {
  const user = await authClient.verify(token)   // 1 RTT — nécessaire d'abord (donne user.id)
  // les deux suivants partent EN MÊME TEMPS : coût = max, pas somme
  const [family, notifs] = await Promise.all([
    familyClient.get(familyId),
    notifClient.unreadCount(user.id),
  ])
  return { family, unread: notifs }
}
```

Coût réseau : **1 RTT + max(1 RTT, 1 RTT) = 2 × 0,5 = 1 ms**. On a économisé 0,5 ms (33 %) **sans toucher au réseau ni aux données** — juste en cessant d'attendre inutilement. Refais ce calcul avec un RTT de 40 ms (services dans des zones différentes) : 120 ms → 80 ms. L'unité de raisonnement, c'est le RTT.

### Exemple 2 — Un timeout ne prouve pas l'échec

`notification-service` envoie un email de bienvenue via `verify` puis `sendEmail`. Écrivons l'appel avec timeout explicite et raisonnons ce qu'on **sait vraiment** :

```typescript
async function callWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn()          // fn doit propager ctrl.signal jusqu'au fetch
  } finally {
    clearTimeout(timer)
  }
}

async function sendWelcome(userId: string) {
  try {
    await callWithTimeout(() => emailClient.send(userId, 'welcome'), 2000)
    // ✅ on a reçu un ACK : l'email est (probablement) parti
  } catch (err) {
    // ❓ timeout OU vraie erreur — on NE SAIT PAS si l'email est parti
    // (a) requête perdue à l'aller → pas d'email
    // (b) email envoyé, ACK perdu au retour → email PARTI quand même
    // Rejouer aveuglément (b) = DEUXIÈME email de bienvenue.
    log.warn({ userId, err }, 'send welcome: résultat inconnu')
    // Décision correcte : retry seulement si l'opération est idempotente
    // (ex. clé d'idempotence côté emailClient) — sinon, ne pas rejouer.
  }
}
```

Le point clé : le `catch` **ne signifie pas « échec »**, il signifie « inconnu ». C'est exactement le partial failure du §2.6. On ne rejoue en sécurité que si l'opération est idempotente — sinon on risque le doublon. (Comment rendre idempotent → module 08.)

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre latence et bande passante

« Nos appels inter-services sont lents, prenons plus de bande passante. » Faux si le problème est le nombre d'allers-retours. Ajouter de la bande passante ne réduit pas le RTT. Le correctif contre la lenteur d'orchestration, c'est **moins d'allers-retours** (batching, parallélisation, colocalisation) — pas un plus gros tuyau. Diagnostique d'abord : est-ce la latence (RTT × nombre d'appels) ou le volume (Mo transférés) ?

### PIÈGE #2 — Traiter un appel distant comme un appel local (transparence RPC)

`await authClient.verify(token)` a la *forme* d'un appel local, mais il peut être 10 000× plus lent et échouer sans bug de ton code. Le piège est d'oublier le timeout, la gestion d'échec, et le coût. **Signal d'alarme :** un `await` sur un client réseau sans timeout ni `try/catch` autour — c'est presque toujours un bug latent qui ne se voit qu'en prod.

### PIÈGE #3 — Croire qu'un timeout signifie « ça a échoué »

Un timeout signifie « pas de réponse à temps », pas « pas exécuté ». Traiter un timeout comme un échec certain puis rejouer une opération non idempotente = doublons (double débit, double email). Le correct : après timeout, l'état est **inconnu** ; on ne rejoue que si c'est sûr (idempotence).

### PIÈGE #4 — « TCP garantit la livraison, donc mon appel arrivera »

TCP garantit la livraison **tant que la connexion tient**. Si le réseau se coupe ou le pair tombe, TCP finit par abandonner et remonter une erreur — la garantie ne survit pas à une vraie panne. TCP fiabilise le *transport*, il n'immunise pas contre le *partial failure*. La fiabilité applicative (retry, idempotence) reste ton travail.

### PIÈGE #5 — Choisir UDP « parce que c'est plus rapide »

UDP n'est pas « TCP en plus rapide » : il enlève les garanties. Sur UDP, tu dois reconstruire toi-même ce dont tu as besoin (accusés, ré-émission, ordre) — c'est ce que fait QUIC. Pour une API métier où chaque octet compte, UDP nu est un mauvais défaut. UDP brille quand un message en retard est **inutile** (audio, vidéo, métriques), pas pour gagner « un peu de vitesse » sur des transactions.

---

## 5. Ancrage TribuZen

TribuZen passe du monolithe à trois services qui se parlent par le réseau. Ce module cadre **le lien entre eux** :

- **`auth-service`** — appelé par tous les autres pour valider un token. C'est le chemin critique du §1 : chaque requête entrante déclenche un RPC `verify`. Un `auth-service` lent ou tombé fait souffrir *tout* TribuZen → timeout obligatoire, et à terme circuit breaker (module 14).
- **`family-service`** — orchestre le dashboard (Exemple 1). C'est là qu'on raisonne en RTT : paralléliser les appels indépendants, ne jamais empiler des `await` séquentiels par paresse.
- **`notification-service`** — envoie emails/push. C'est le cas d'école du partial failure (Exemple 2) : après un timeout d'envoi, l'email est peut-être parti. Ces opérations devront devenir idempotentes (module 08).

Décisions de transport dans TribuZen :
- API entre front et services, et entre services : **HTTP/TCP** (chaque octet compte). Plus tard, gRPC entre services (module 04).
- Métriques haute fréquence des services vers la collecte d'observabilité : candidat **UDP** (un point de métrique perdu n'est pas grave) — sujet du cours 16.

Cible dans `smaurier/tribuzen` :
```
tribuzen/
  services/
    auth-service/        ← RPC verify(token) — chemin critique
    family-service/      ← orchestration dashboard (raisonnement RTT)
    notification-service/← partial failure sur l'envoi
  packages/
    rpc-client/          ← wrapper HTTP avec timeout explicite par défaut
```
La règle d'équipe qui découle de ce module : **aucun appel inter-services sans timeout explicite**, matérialisée dans `packages/rpc-client`.

---

## 6. Points clés

1. **Latence ≠ bande passante** : la latence est le temps d'un aller-retour (RTT), la bande passante le débit. En distribué, l'ennemi est presque toujours la latence.
2. **Raisonne en RTT** : la plupart des protocoles coûtent un nombre entier de RTT ; un HTTPS à froid = 3–4 RTT avant la première donnée.
3. **Ordres de grandeur** : même datacenter ~0,5 ms, intercontinental ~150 ms — soit ~5 000× à ~1,5 M× plus lent que la mémoire. Un appel réseau n'est jamais gratuit.
4. **TCP** = fiable/ordonné mais coûte un handshake ; **UDP** = best-effort, pour quand un message en retard est inutile.
5. **RPC** rend un appel distant *ressemblant* à un appel local — mais il est plus lent, peut échouer sans bug, et n'a pas de mémoire partagée (sérialisation obligatoire).
6. **Partial failure** : en distribué l'échec est partiel et surtout **incertain** ; un timeout dit « pas de réponse », pas « pas exécuté ».
7. **Le réseau n'est pas fiable** : perte, délai, duplicata, désordre sont toujours possibles → tout appel réseau exige un **timeout explicite**.

---

## 7. Seeds Anki

```
Quelle est la différence entre latence et bande passante ?|Latence = temps d'un aller-retour (RTT), en ms. Bande passante = débit, en Mb/s. Indépendantes : élargir le tuyau ne réduit pas le temps d'un aller simple. En distribué, l'ennemi est surtout la latence.
Pourquoi raisonner « en RTT » plutôt qu'en débit ?|La plupart des protocoles coûtent un nombre entier de RTT : TCP handshake 1 RTT, TLS 1-2 RTT, chaque requête >= 1 RTT. 10 appels séquentiels = 10 x RTT même si les données sont minuscules.
Ordre de grandeur : aller-retour même datacenter vs intercontinental ?|~0,5 ms dans le même datacenter, ~150 ms Californie<->Pays-Bas. Le second est un plancher physique (vitesse de la lumière dans la fibre), non optimisable en logiciel.
TCP vs UDP : quand choisir lequel ?|TCP = fiable, ordonné, contrôle de flux, mais handshake + état (API, transactions). UDP = best-effort, sans connexion, léger (DNS, audio/vidéo, métriques, base de QUIC). Règle : TCP quand chaque octet compte, UDP quand un message en retard est inutile.
Qu'est-ce qu'un RPC cache, et en quoi un appel distant diffère d'un appel local ?|Un RPC (gRPC, tRPC, client REST) fait ressembler un appel réseau à un appel de fonction. Différences non négociables : il peut échouer sans bug (réseau), il est plus lent de plusieurs ordres de grandeur, il n'a pas de mémoire partagée (sérialisation obligatoire).
Qu'est-ce que le partial failure et pourquoi est-il piégeux ?|En distribué, l'échec est partiel (un service tombe, pas tout le système) et surtout incertain : après un timeout on ne sait pas si (a) la requête est perdue, (b) elle a réussi mais la réponse est perdue, ou (c) c'est juste lent.
Que signifie vraiment un timeout sur un appel réseau ?|« Pas de réponse à temps », PAS « l'opération a échoué ». Le travail a peut-être été fait. Rejouer aveuglément une opération non idempotente peut la dupliquer (double débit/email) -> d'où l'idempotence.
Pourquoi « le réseau n'est pas fiable » impose un timeout explicite partout ?|Perte, délai arbitraire, duplicata, désordre sont toujours possibles. Sans timeout, un await attend l'infini, immobilise un connecteur, et une dépendance lente gèle tout le service (cascade).
```

---

## Pont vers le lab

> Lab associé : `labs/lab-01-communication-reseau-fondamentale/README.md`. Mesurer la latence réelle entre trois services TribuZen (docker-compose fourni), raisonner le coût en RTT, puis provoquer et diagnostiquer un partial failure — vrai réseau, pas de harnais simulé.
