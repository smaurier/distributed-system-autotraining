---
titre: Retries, timeouts & idempotency
cours: 17-distributed-systems
notions: ["timeout (connect / read / total)", "choisir la valeur d'un timeout (percentile p99.9)", "deadline propagation", "retry (nouvelle tentative)", "erreur transitoire vs permanente", "exponential backoff", "jitter (full / equal / decorrelated)", "thundering herd / retry storm", "retry amplification", "retry budget (token bucket)", "idempotence", "clé d'idempotence (idempotency key)", "opération naturellement idempotente", "at-most-once / at-least-once / exactly-once", "effectively-once (at-least-once + idempotence)", "AbortController / Promise.race"]
outcomes:
  - "sait choisir la valeur d'un timeout à partir d'un percentile de latence du service aval (p99.9) et propager une deadline le long de la chaîne d'appels"
  - "sait distinguer une erreur transitoire (à retenter) d'une erreur permanente (à ne jamais retenter) et implémenter un retry avec exponential backoff + jitter"
  - "sait expliquer le thundering herd / retry storm et pourquoi le jitter et un retry budget (token bucket) l'évitent"
  - "sait rendre une opération non idempotente (POST paiement/RSVP) idempotente via une clé d'idempotence stockée"
  - "sait démontrer qu'exactly-once de bout en bout = at-least-once + idempotence (effectively-once)"
prerequis: ["Module 00 — pourquoi le distribué, fallacies", "Module 01 — réseau, latence, partial failure", "Module 04 — communication synchrone (REST/gRPC, deadlines)", "Module 05 — garanties de livraison (at-least-once, idempotence)", "Module 07 — API gateway & BFF"]
next: 09-coherence-et-theoreme-cap
libs: []
tribuzen: "backend TribuZen — POST /sorties/:id/rsvp (RSVP + paiement d'une quote-part) rendu sûr au retry par une clé d'idempotence, pour qu'un parent qui recharge ou dont la requête time out ne soit jamais débité ni inscrit deux fois"
last-reviewed: 2026-07
---

# Retries, timeouts & idempotency

> **Outcomes — tu sauras FAIRE :** choisir la valeur d'un timeout depuis un percentile de latence et propager une deadline, distinguer erreur transitoire et permanente et retenter avec exponential backoff + jitter, éviter le retry storm (jitter + retry budget), rendre un POST idempotent via une clé d'idempotence, démontrer qu'exactly-once = at-least-once + idempotence.
> **Difficulté :** :star::star::star:
>
> **Portée :** ce module traite les **trois briques de résilience de l'appel individuel** — **timeout** (abandonner un appel qui traîne), **retry** (le retenter proprement), **idempotence** (que le retry ne double aucun effet). On **ne** couvre **pas** ici : le **circuit breaker**, le **bulkhead** et le **timeout budget** au niveau système (couper la source quand l'aval s'effondre) → **module 14 (failure modes & circuit breaker)** ; publier de façon **fiable** un message depuis une transaction DB (dual-write, **outbox**, CDC) → **module 13** ; les **garanties de livraison** d'un broker et l'idempotence côté consommateur de queue → **module 05 (déjà vu)** ; le **rate limiting / backpressure** côté serveur (token/leaky bucket comme protection d'entrée) → **module 15**. Ici, on est côté **client d'un appel** : je timeoute, je retente, je ne double rien.

## 1. Cas concret d'abord

Tu reprends le backend de TribuZen. Une sortie payante est organisée (place de zoo à 12 €/enfant). Un parent **confirme sa présence et paie sa quote-part** en une action. Le handler :

```ts
// rsvp.controller.ts — AVANT (aucune protection au retry)
async rsvp(sortieId: string, input: RsvpInput): Promise<Rsvp> {
  const charge = await this.payments.charge(input.userId, input.amountCents); // ← appel Stripe, lent, faillible
  const rsvp = await this.repo.save(Rsvp.create(sortieId, input.userId, charge.id));
  return rsvp;
}
```

Côté mobile, le client a un timeout de 10 s et **retente** automatiquement en cas d'échec réseau. Un soir de mauvais réseau, voici ce qui arrive :

```
App parent ──POST /rsvp──▶ backend ──charge 12€──▶ Stripe  ✅ (débité)
App parent ◀─────── (timeout réseau à 10 s, réponse perdue) ─────
App parent ──POST /rsvp──▶ backend ──charge 12€──▶ Stripe  ✅ (débité UNE 2e FOIS)
App parent ◀──── 201 { rsvp } ────
```

**Le parent est débité 24 € pour une sortie à 12 €, et il apparaît deux fois dans la liste.** Rien n'a « bugué » : le premier appel a **réussi**, seule sa **réponse** s'est perdue. Le client ne peut pas distinguer « ma requête n'est jamais arrivée » de « elle a réussi mais la réponse s'est perdue » — les deux ressemblent à un timeout. C'est la **fallacy** classique du distribué : *l'échec d'un appel ne dit rien sur son effet*.

Trois questions à trancher, dans l'ordre :
1. **Timeout** — combien de temps le client (et le backend) attendent-ils avant d'abandonner ? Choisi comment ?
2. **Retry** — quelles erreurs retenter, et à quel rythme, pour ne pas aggraver une panne ?
3. **Idempotence** — comment garantir que retenter le paiement ne débite qu'**une** fois ?

Ce module répond aux trois. La règle qui les relie : **dès qu'on retente, on doit rendre l'opération idempotente** — sinon on transforme un incident réseau en double débit.

---

## 2. Théorie complète, concise

### 2.1 Timeout — pourquoi, et les trois niveaux

Un **timeout** est la durée au-delà de laquelle on **abandonne** un appel en cours. Sans timeout, un appel vers un service gelé **bloque indéfiniment** : le thread (ou la connexion, ou le worker) reste immobilisé, et sous charge ces blocages s'accumulent jusqu'à épuiser le pool — un service lent en amont **propage sa lenteur** à tous ceux qui l'appellent. Le timeout est ce qui **borne** cette propagation.

On distingue trois niveaux :
- **Connect timeout** — délai pour *établir* la connexion (TCP/TLS). Court : si on n'arrive pas à joindre l'hôte en ~1-3 s, c'est mort.
- **Read timeout** — délai d'*inactivité* en attente de la réponse une fois connecté.
- **Total (deadline)** — durée maximale de **toute** l'opération (connect + envoi + traitement + lecture). C'est le plus important : c'est celui que le métier ressent.

### 2.2 Choisir la valeur d'un timeout — pas au doigt mouillé

L'erreur du débutant : `timeout = 30_000` « au cas où ». Un timeout trop **long** ne protège de rien (on bloque quand même) ; trop **court**, il transforme des réponses lentes-mais-valides en faux échecs (et déclenche des retries inutiles). La bonne méthode part des **métriques de latence du service aval**.

> Amazon (Builders' Library) : on choisit un **taux de faux timeouts acceptable** (p. ex. 0,1 %), puis on prend le **percentile de latence correspondant** du service aval — ici **p99.9** — comme valeur de timeout. Autrement dit : *0,1 % des appels légitimes dépassent p99.9 ; on accepte de les couper.*

Deux nuances de la même source :
- **Sur Internet** (client mobile, latence réseau forte et variable), ce calcul ne suffit pas : il faut **ajouter une marge** pour le pire cas réseau (les clients peuvent être à l'autre bout du monde).
- **Service à latence très serrée** (p99.9 ≈ p50) : ajouter un **padding**, sinon une micro-hausse de latence fait exploser le taux de timeouts.

Règle : **le timeout se dérive d'une mesure, pas d'une intuition** — et il se **réévalue** quand la latence du service aval bouge.

### 2.3 Deadline propagation

Choisir un timeout par appel ne suffit pas dans une **chaîne** d'appels (gateway → service A → service B → DB). Si chaque maillon fixe *son* timeout à 10 s indépendamment, le total peut dépasser largement ce que le client du haut est prêt à attendre — et A continue de travailler pour une réponse que la gateway a déjà abandonnée (**travail fantôme**).

La parade est la **deadline propagation** : le client du haut fixe une **deadline absolue** (« cette requête doit être finie à T+8 s ») et la **transmet** à chaque appel aval. Chaque service calcule son budget restant = `deadline − maintenant`, passe un timeout **décroissant** au maillon suivant, et **abandonne immédiatement** si la deadline est déjà dépassée (au lieu d'appeler l'aval pour rien).

```
Client fixe deadline = T+8s, la propage (header / métadonnée gRPC)
  gateway   reste 8s  ──▶ A (timeout 8s)
     A      reste 6s  ──▶ B (timeout 6s)      ← chacun passe SON reste, pas un 10s fixe
     B      reste 4s  ──▶ DB (timeout 4s)
  À tout moment : maintenant > deadline  ⇒  abandon immédiat (pas d'appel aval)
```

gRPC porte cela nativement (`deadline` propagée dans les métadonnées) ; en HTTP on passe une deadline/`X-Request-Deadline` applicative. C'est la version « chaîne » du principe des **timeouts décroissants** vu au module 04.

### 2.4 Retry — mais quoi retenter ?

Un **retry** est une nouvelle tentative après échec. Il ne se justifie que pour une **erreur transitoire** — un problème **passager** qui a des chances de disparaître à la tentative suivante :

| Retenter (transitoire) | Ne **jamais** retenter (permanent) |
|---|---|
| timeout / erreur réseau (`ECONNRESET`, `ETIMEDOUT`) | `400` Bad Request (payload invalide) |
| `503` Service Unavailable | `401` / `403` (auth : retenter ne changera rien) |
| `429` Too Many Requests (avec backoff) | `404` Not Found |
| `500`/`502`/`504` (souvent transitoires) | `422` Unprocessable (validation métier) |

Retenter une erreur **permanente** est du pur gaspillage : le `400` restera un `400`. Pire, retenter **agressivement** un service déjà en difficulté l'achève (§2.6). D'où : **retenter peu, intelligemment, et seulement le transitoire.**

### 2.5 Exponential backoff + jitter

Le **rythme** des retries est décisif. Retenter **immédiatement** en boucle, c'est marteler un service qui vient d'échouer.

- **Exponential backoff** : on **double** le délai à chaque tentative — `base·2⁰, base·2¹, base·2²…` (1 s, 2 s, 4 s…), plafonné par un `cap`. On laisse au service un temps **croissant** pour récupérer.
- **Jitter** : on **randomise** le délai. Sans jitter, tous les clients qui ont échoué **au même instant** (un déploiement, une panne brève) retentent aux **mêmes** instants (1 s, 2 s, 4 s…) — ils re-frappent le service en **rafales synchronisées** juste au moment où il essaie de se relever. C'est le **thundering herd**. Le jitter **étale** les retries dans le temps.

Les trois formules de jitter (AWS Architecture Blog — `attempt` = numéro de tentative, `cap` = plafond) :

```
Full jitter        : sleep = random(0, min(cap, base * 2^attempt))
Equal jitter       : sleep = base * 2^attempt / 2 + random(0, base * 2^attempt / 2)
Decorrelated jitter: sleep = min(cap, random(base, sleep_precedent * 3))
```

Conclusion de l'étude AWS : le backoff **sans** jitter est *« the clear loser »* ; **Full Jitter** fait **moins de travail** (moins d'appels) pour un temps total à peine plus long — c'est le choix par défaut recommandé.

```ts
// full jitter : délai aléatoire entre 0 et le plafond exponentiel
function fullJitterDelay(attempt: number, baseMs = 200, capMs = 20_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.random() * exp; // random(0, exp)
}
```

### 2.6 Retry amplification & retry budget (token bucket)

Le danger caché du retry, c'est l'**amplification**. Chaque client qui retente *n* fois multiplie la charge par *n* — **exactement** au pire moment, quand le service est déjà en surcharge. 100 clients × 3 tentatives = 300 requêtes sur un service qui n'en supporte plus 100 : le retry ne *sauve* pas la panne, il la **transforme en effondrement** (retry storm). Et si l'aval retente vers l'aval-de-l'aval, le facteur se **multiplie couche par couche** (3 × 3 × 3 = 27×).

La parade est un **retry budget** : plafonner la **proportion** de retries, pas leur nombre par appel. Amazon l'implémente avec un **token bucket local** :

> Builders' Library : Amazon utilise un **token bucket local** qui **autorise tous les retries tant qu'il reste des jetons**, puis **retente à débit fixe** une fois les jetons épuisés. L'AWS SDK (standard mode) porte un *retry quota* : chaque retry **retire** des jetons, un **succès en re-crédite**, et quand le bucket est vide le SDK **échoue vite** (fail fast) au lieu d'enchaîner des retries voués à l'échec.

L'idée clé : **un système sous stress doit retenter MOINS, pas plus.** Le budget garantit que les retries restent une petite fraction du trafic (typiquement ~10-20 %) et laissent le service respirer.

```ts
// retry budget par token bucket : succès recharge, retry consomme
class RetryBudget {
  private tokens: number;
  constructor(private max = 100, private retryCost = 5, private successRefill = 1) {
    this.tokens = max;
  }
  onSuccess() { this.tokens = Math.min(this.max, this.tokens + this.successRefill); }
  canRetry(): boolean {
    if (this.tokens < this.retryCost) return false; // budget épuisé → fail fast
    this.tokens -= this.retryCost;
    return true;
  }
}
```

### 2.7 Idempotence — la condition qui rend le retry sûr

Une opération est **idempotente** si l'appliquer **une** fois ou **N** fois produit **le même effet observable**. C'est *la* condition qui autorise le retry : sans elle, chaque retry risque un **doublon** (le double débit du §1).

```
GET    /sorties/42   → idempotent (lire ne change rien)
PUT    /sorties/42   → idempotent (écraser avec le même état N fois = 1 fois)
DELETE /sorties/42   → idempotent (supprimer un déjà-supprimé = no-op)
POST   /sorties      → PAS idempotent (2 POST = 2 ressources)   ← le problème
```

Deux façons de rendre une opération sûre au retry :
- **Opération naturellement idempotente.** Formuler l'effet comme une **affectation absolue** plutôt qu'un **incrément relatif** : `statut = 'payé'` (rejouable à l'infini) au lieu de `solde += 12` (double si rejoué). Quand c'est possible, c'est le plus simple.
- **Clé d'idempotence** (quand l'opération crée/déclenche un effet non rejouable, comme un paiement).

### 2.8 Clé d'idempotence (idempotency key)

Le **client génère un identifiant unique** *une seule fois* pour l'opération (un UUID), et le renvoie **inchangé** à chaque tentative (header `Idempotency-Key`). Le serveur **stocke** la clé et le résultat associé ; à une clé déjà vue, il **rejoue la réponse mémorisée sans refaire l'effet**.

```
1er POST   Idempotency-Key: k-abc  → serveur : clé inconnue → charge Stripe, stocke (k-abc → rsvp) → 201
(timeout, réponse perdue)
retry POST Idempotency-Key: k-abc  → serveur : clé CONNUE → renvoie le rsvp mémorisé, PAS de 2e charge
```

Points de conception qui font qu'une clé d'idempotence **marche vraiment** :
- **Générée côté client, réutilisée au retry.** Une clé régénérée à chaque tentative ne protège de rien. Une clé = une **intention métier** (« ce parent paie CETTE sortie »), pas une requête HTTP.
- **La vérification et l'écriture de l'effet doivent être atomiques.** Deux retries **concurrents** avec la même clé ne doivent pas passer tous deux le test « clé inconnue » avant que l'un ait écrit. On s'appuie sur une **contrainte d'unicité** en base sur la clé (l'insertion du 2e échoue) plutôt que sur un `if (has(key))` naïf (fenêtre de course).
- **TTL.** La clé se garde le temps que des retries sont plausibles (heures/jours), puis expire.
- **Réponse mémorisée**, pas seulement « déjà vu » : le retry doit récupérer **le même résultat** (le même `rsvpId`), pas un `409`.

### 2.9 Delivery semantics — exactly-once = at-least-once + idempotence

On retrouve les trois garanties du module 05, ici du point de vue **appel** :
- **At-most-once** : on n'envoie pas de retry → jamais de doublon, **perte possible**. (métriques best-effort)
- **At-least-once** : on retente jusqu'au succès → jamais perdu, **doublons possibles**. **C'est ce que fait tout client qui retente.**
- **Exactly-once** : effet unique. **Impossible à garantir au niveau transport** (le *Two Generals Problem* : le client ne peut jamais *savoir* si son appel a eu un effet) — mais on en obtient l'**effet** en combinant **at-least-once + handler idempotent**. On parle d'**effectively-once**.

> **Le point à retenir du module :** on ne cherche **pas** à empêcher le doublon au transport (on n'y arrivera pas). On **retente librement** (at-least-once) et on rend l'**effet idempotent** (clé/opération absolue). Retry + idempotence = effectively-once. C'est le même théorème qu'au module 05, appliqué à l'appel synchrone au lieu du message de queue.

---

## 3. Worked examples

### Exemple 1 — Sécuriser le POST /rsvp du §1 de bout en bout

But : que le parent du §1 puisse timeouter, recharger, retenter **autant qu'il veut** sans jamais être débité ni inscrit deux fois.

**Étape 1 — le client génère la clé UNE fois et la réutilise au retry.**

```ts
// mobile — la clé est liée à l'INTENTION (payer cette sortie), pas à la requête
const idempotencyKey = crypto.randomUUID(); // généré AVANT la boucle de retry
await resilientPost(`/sorties/${sortieId}/rsvp`, body, {
  idempotencyKey,              // ← identique à chaque tentative
  timeoutMs: 8000,
  maxAttempts: 4,
});
```

**Étape 2 — le timeout côté client, via `AbortController`** (annule vraiment la requête HTTP) :

```ts
async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`timeout après ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(id); // TOUJOURS nettoyer le timer, succès comme échec
  }
}
```

**Étape 3 — le retry : full jitter + n'agir que sur le transitoire.**

```ts
function isTransient(status?: number, err?: unknown): boolean {
  if (err) return true; // erreur réseau / AbortError → transitoire
  return status !== undefined && [408, 429, 500, 502, 503, 504].includes(status);
}

async function resilientPost(url: string, body: unknown, o: {
  idempotencyKey: string; timeoutMs: number; maxAttempts: number;
}): Promise<Response> {
  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': o.idempotencyKey },
        body: JSON.stringify(body),
      }, o.timeoutMs);

      if (res.ok) return res;
      if (!isTransient(res.status)) throw new Error(`échec permanent ${res.status}`); // 400/401… : on N'insiste PAS
      if (attempt === o.maxAttempts - 1) throw new Error(`épuisé après ${o.maxAttempts} tentatives`);
    } catch (e) {
      if (attempt === o.maxAttempts - 1 || !isTransient(undefined, e)) throw e;
    }
    // full jitter : random(0, min(cap, base * 2^attempt))
    const delay = Math.random() * Math.min(20_000, 200 * 2 ** attempt);
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('unreachable');
}
```

**Étape 4 — le serveur rend l'effet idempotent via une contrainte d'unicité** (pas de `if (has)` naïf : deux retries concurrents doivent être départagés par la DB) :

```ts
// rsvp.controller.ts — APRÈS
async rsvp(sortieId: string, key: string, input: RsvpInput): Promise<Rsvp> {
  // 1. Rejeu ? une clé déjà traitée renvoie SON résultat mémorisé — aucun effet refait.
  const seen = await this.idem.find(key);
  if (seen) return seen.result as Rsvp;

  // 2. Réserver la clé AVANT l'effet, sous contrainte d'unicité (unique index sur idempotency_key).
  //    Si un retry concurrent a déjà réservé → l'insert throw → on relit son résultat.
  try {
    await this.idem.reserve(key);
  } catch (e) {
    if (isUniqueViolation(e)) return (await this.idem.waitResult(key)) as Rsvp;
    throw e;
  }

  // 3. L'effet non rejouable : on ne l'atteint QUE si on a gagné la réservation de la clé.
  const charge = await this.payments.charge(input.userId, input.amountCents);
  const rsvp = await this.repo.save(Rsvp.create(sortieId, input.userId, charge.id));

  // 4. Mémoriser le résultat pour les retries futurs.
  await this.idem.complete(key, rsvp);
  return rsvp;
}
```

**Ce que ce design achète :** le parent peut timeouter et retenter 4 fois → **une seule** charge Stripe, **un seul** RSVP ; les erreurs permanentes (`400`) ne sont pas martelées ; les retries sont étalés (full jitter) donc pas de rafale synchronisée ; deux retries concurrents sont départagés par la contrainte d'unicité, pas par une course applicative. **Reste à assumer :** stocker les clés (table + TTL) et faire de la réservation-clé + effet une frontière transactionnelle propre.

### Exemple 2 — Choisir un timeout et propager la deadline dans une chaîne

TribuZen : `gateway → service-sorties → service-paiement → Stripe`. On veut des timeouts **dérivés** et une **deadline** unique.

**Étape 1 — dériver chaque timeout d'un percentile de latence** (méthode Builders' Library : taux de faux timeouts acceptable 0,1 % → p99.9 du service aval) :

```
service aval        p50     p99.9    timeout retenu
service-paiement    40 ms   900 ms   1000 ms   (p99.9 + petit padding)
Stripe (Internet)   120 ms  1500 ms  3000 ms   (p99.9 + marge réseau : client mondial)
```

`service-paiement` a un p99.9 net → timeout ≈ p99.9. Stripe est sur **Internet** → on **ajoute une marge** pour le pire cas réseau (la nuance de §2.2).

**Étape 2 — une seule deadline, propagée et décroissante** :

```ts
// la gateway fixe la deadline absolue ; chaque maillon passe SON reste
async function callWithDeadline<T>(fn: (timeoutMs: number) => Promise<T>, deadlineEpochMs: number): Promise<T> {
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) throw new Error('deadline dépassée — abandon sans appeler l’aval'); // pas de travail fantôme
  return fn(remaining); // l'aval reçoit le budget RESTANT, pas un timeout fixe
}

// gateway
const deadline = Date.now() + 8000;                 // toute la requête doit finir en 8 s
const rsvp = await callWithDeadline(t => sortiesClient.rsvp(input, t), deadline);
// service-sorties propage `deadline` à service-paiement, qui la propage à Stripe…
```

**Pourquoi c'est correct :** aucun maillon ne travaille pour une réponse déjà abandonnée en amont (dès que `remaining ≤ 0`, on coupe) ; les timeouts sont **cohérents entre eux** (dérivés d'une seule deadline) au lieu d'être fixés à 10 s indépendamment à chaque niveau.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Retenter sans rendre l'opération idempotente

Le piège fondateur (le §1). Un retry sur un `POST` qui a **réussi mais dont la réponse s'est perdue** crée un **doublon** : double débit, double RSVP, double email. **Retry et idempotence sont indissociables** : si tu ajoutes un retry quelque part, tu **dois** rendre l'effet idempotent (clé ou opération absolue) dans le même geste. Jamais l'un sans l'autre.

### PIÈGE #2 — Régénérer la clé d'idempotence à chaque tentative

`headers['Idempotency-Key'] = crypto.randomUUID()` **à l'intérieur** de la boucle de retry ne protège de **rien** : chaque tentative a une clé différente, donc le serveur les voit toutes comme distinctes → doublons. La clé se génère **une fois**, **avant** la boucle, et représente l'**intention métier**. Corollaire : c'est le **client** qui la génère (il sait que « c'est la même action »), pas le serveur.

### PIÈGE #3 — `if (store.has(key))` comme protection d'idempotence

Vérifier puis écrire en deux temps ouvre une **fenêtre de course** : deux retries **concurrents** passent tous deux le `has(key)` (encore vide) avant que l'un ait écrit → double effet. La vraie protection est **atomique** : contrainte d'**unicité** en base sur la clé (le 2e `INSERT` échoue) ou opération `INSERT … ON CONFLICT DO NOTHING`. L'idempotence se garantit dans la **DB**, pas dans une `Map` avec un `if`.

### PIÈGE #4 — Retenter une erreur permanente

Boucler sur un `400`/`401`/`404`/`422` est du gaspillage pur : le résultat ne changera **jamais**, on brûle du temps et du budget. Ne retenter **que** le transitoire (timeout, réseau, `429`, `5xx`). Un `401` se règle en renouvelant le token, pas en réémettant la même requête.

### PIÈGE #5 — Exponential backoff **sans** jitter

Doubler les délais mais laisser tous les clients synchrones (1 s, 2 s, 4 s pile) recrée le **thundering herd** : des rafales synchronisées frappent le service pile quand il se relève, et le renvoient au tapis. L'étude AWS est explicite : le backoff sans jitter est *« the clear loser »*. **Full jitter** (`random(0, min(cap, base·2^attempt))`) étale les retries — c'est le défaut.

### PIÈGE #6 — Croire que le retry aide **toujours** un service en surcharge

Sous surcharge, retenter **amplifie** la charge (100 clients × 3 = 300 req sur un service qui suffoque déjà) et se **multiplie couche par couche** — c'est le **retry storm**. Il faut un **retry budget** (token bucket : retries plafonnés en proportion, fail-fast quand le bucket est vide) : *un système stressé doit retenter **moins**.* Le retry sauve un incident **isolé**, il aggrave une **panne systémique**.

### PIÈGE #7 — Timeout « au doigt mouillé » (30 s « pour être sûr »)

Un timeout trop long ne protège de rien (on bloque le pool quand même) ; trop court, il fabrique des faux échecs et des retries inutiles. Le timeout se **dérive** d'un percentile de latence du service aval (p99.9 pour ~0,1 % de faux timeouts), avec **marge** sur Internet et **padding** si p99.9 ≈ p50. Et il se **propage** en deadline décroissante dans une chaîne (pas un `10s` fixe recopié à chaque niveau).

---

## 5. Ancrage TribuZen

TribuZen a des opérations **à effet non rejouable** (payer une quote-part, envoyer une invitation, réserver une place limitée) appelées depuis des **clients mobiles au réseau instable** qui **retentent**. Sans discipline retry/idempotence, chaque coupure réseau devient un double débit ou une double inscription — un **bug produit visible et coûteux** (support, remboursement, confiance).

**Le POST `/sorties/:id/rsvp` (le cas du §1), de bout en bout :**

```
App parent ──POST /rsvp  Idempotency-Key: k (généré 1×, réutilisé au retry)
   │  timeout 8s (AbortController) · retry full jitter · seulement le transitoire
   ▼
gateway ──(deadline propagée)──▶ service-sorties ──▶ service-paiement ──▶ Stripe
                                        │
                                        ├─ clé k déjà vue ?  → renvoie le RSVP mémorisé (0 charge)
                                        ├─ réserve k (unique index) → gagne : charge 1×, save RSVP
                                        └─ retry concurrent : insert k échoue → relit le résultat
```

Décisions concrètes pour TribuZen :
- **Clé d'idempotence obligatoire** sur toute mutation à effet monétaire ou à effet externe (paiement, invitation, réservation de place). Header `Idempotency-Key` généré par le mobile, **une fois par intention**, stocké côté backend avec un **unique index** + TTL (30 jours).
- **Timeouts dérivés** des percentiles de latence par service aval (p99.9 + marge Internet pour Stripe), et **deadline unique** propagée dans la chaîne — jamais un `30s` recopié.
- **Retry full jitter** côté client mobile, **uniquement sur le transitoire** (timeout, `429`, `5xx`), avec **retry budget** (token bucket) côté backend-to-backend pour ne pas amplifier une panne de `service-paiement`.
- **Opérations formulées en absolu** quand c'est possible (`statut_rsvp = 'confirmé'`) plutôt qu'en incrément, pour être idempotentes sans même une clé.

> **Défère :** couper la source quand `service-paiement` s'effondre (**circuit breaker**, **bulkhead**, timeout budget système) = **module 14** ; publier de façon fiable l'événement « RSVP payé » vers d'autres services depuis la même transaction (dual-write, **outbox**) = **module 13** ; l'idempotence côté **consommateur de queue** (dédup sur `messageId`) = **module 05 (déjà vu)** ; protéger le serveur de l'excès de trafic entrant (**rate limiting**, backpressure) = **module 15**. Ici : l'appel individuel, timeouté, retenté, non-doublé.

---

## 6. Points clés

1. **L'échec d'un appel ne dit rien de son effet** : un timeout peut cacher une opération qui a **réussi** (réponse perdue). Tout retry doit donc supposer que l'effet a **peut-être** déjà eu lieu.
2. **Timeout dérivé d'une mesure** : p99.9 du service aval pour ~0,1 % de faux timeouts, + marge sur Internet, + padding si p99.9 ≈ p50 ; jamais un chiffre « au cas où ».
3. **Deadline propagation** : une deadline absolue unique, transmise et **décroissante** le long de la chaîne ; on abandonne dès qu'elle est dépassée (pas de travail fantôme).
4. **Ne retenter que le transitoire** (timeout, réseau, `429`, `5xx`) ; jamais le permanent (`400`/`401`/`404`/`422`).
5. **Exponential backoff + full jitter** (`random(0, min(cap, base·2^attempt))`) : le backoff **sans** jitter est le « clear loser » (thundering herd).
6. **Retry budget = token bucket** : les retries consomment des jetons, un succès recharge, fail-fast quand vide — *un système stressé retente **moins*** (évite le retry storm / l'amplification).
7. **Idempotence = condition du retry** : opération naturellement idempotente (affectation absolue) ou **clé d'idempotence** (générée 1× côté client, réservée sous **contrainte d'unicité**, réponse mémorisée + TTL).
8. **Exactly-once de bout en bout n'existe pas au transport** ; on obtient l'**effet** (effectively-once) = **at-least-once (retry) + handler idempotent**.

---

## 7. Seeds Anki

```
Pourquoi un retry sur un POST qui a "timeouté" peut-il créer un doublon ?|L'échec d'un appel ne dit rien de son effet : le 1er appel a pu RÉUSSIR et seule la réponse s'est perdue. Le retry refait alors l'effet (double débit). D'où : tout retry exige une opération idempotente.
Comment choisir la valeur d'un timeout selon la Builders' Library AWS ?|On part des métriques de latence du service aval : on fixe un taux de faux timeouts acceptable (ex. 0,1 %) et on prend le percentile correspondant (p99.9) comme timeout. + marge sur Internet, + padding si p99.9 ≈ p50.
Qu'est-ce que la deadline propagation ?|Le client du haut fixe une deadline ABSOLUE unique et la transmet à chaque appel aval ; chaque maillon passe son budget restant (deadline − maintenant) comme timeout décroissant et abandonne dès que la deadline est dépassée, sans appeler l'aval (pas de travail fantôme).
Quelles erreurs retenter, lesquelles jamais ?|Retenter le TRANSITOIRE : timeout, erreur réseau, 429, 500/502/503/504. Ne JAMAIS retenter le PERMANENT : 400, 401, 403, 404, 422 (le résultat ne changera pas — gaspillage).
Qu'est-ce que le thundering herd et comment le jitter l'évite ?|Sans jitter, tous les clients qui ont échoué au même instant retentent aux mêmes instants (1s,2s,4s) → rafales synchronisées qui re-cassent le service. Le jitter randomise le délai (full jitter = random(0, min(cap, base·2^attempt))) et étale les retries.
Donne la formule du full jitter et pourquoi c'est le défaut recommandé.|sleep = random(0, min(cap, base * 2^attempt)). L'étude AWS conclut que le backoff SANS jitter est "the clear loser" ; full jitter fait moins de travail (moins d'appels) pour un temps à peine plus long.
Qu'est-ce qu'un retry budget par token bucket ?|Un bucket de jetons : chaque retry consomme des jetons, un succès en recharge ; quand le bucket est vide on ÉCHOUE VITE au lieu de retenter. Ça plafonne les retries en proportion et évite l'amplification/retry storm — un système stressé retente MOINS.
Pourquoi "if (store.has(key))" est-il une mauvaise protection d'idempotence ?|Vérifier puis écrire en deux temps ouvre une fenêtre de course : deux retries concurrents passent tous deux le has() encore vide → double effet. Il faut une garantie ATOMIQUE : contrainte d'unicité en base sur la clé (le 2e INSERT échoue).
Comment fonctionne une clé d'idempotence, et qui la génère ?|Le CLIENT génère un UUID UNE fois pour l'intention métier et le renvoie inchangé à chaque tentative (header Idempotency-Key). Le serveur stocke clé→résultat ; à une clé déjà vue il rejoue la réponse mémorisée SANS refaire l'effet.
Pourquoi exactly-once est-il impossible au transport, et comment obtient-on son effet ?|Le client ne peut jamais SAVOIR si son appel a eu un effet (Two Generals Problem). On obtient l'effet (effectively-once) en combinant at-least-once (retry libre) + un handler IDEMPOTENT (clé ou opération absolue). Même théorème qu'au module 05.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-08-retries-timeouts-idempotency/README.md`. Rendre le `POST /sorties/:id/rsvp` de TribuZen sûr au retry : implémenter un client à timeout (`AbortController`) + retry full jitter (transitoire seulement), puis une clé d'idempotence côté serveur (unique index) qui empêche le double débit — via un `docker-compose` fourni (API + Postgres + faux service de paiement injectant timeouts et pannes). Évalué par grille + coach, variante J+30, zéro harnais auto-correcteur.
