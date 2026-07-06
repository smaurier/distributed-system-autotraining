# Lab 08 — Retries, timeouts & idempotency

> **Outcome :** à la fin, tu sais rendre une mutation TribuZen (`POST /sorties/:id/rsvp`, qui paie une quote-part) **sûre au retry** : un client qui timeoute et retente ne débite et n'inscrit **jamais** deux fois.
> **Vrai outil :** Node 20 + TypeScript (Fastify ou Express + `pg`), Postgres, un faux service de paiement — le tout dans un `docker-compose` fourni. Pas de framework de test auto-correcteur.
> **Feedback :** le coach valide en session (on provoque les timeouts/pannes ensemble et on lit la table `idempotency_keys` + le compteur de charges).

---

## Énoncé

Le backend expose déjà l'endpoint **naïf** du module (§1) : il charge le paiement puis enregistre le RSVP, **sans aucune protection**. Le `docker-compose` fournit :

- **`api`** — le service TribuZen (endpoint `POST /sorties/:id/rsvp`).
- **`db`** — Postgres (tables `rsvps` et `charges` ; à toi de créer `idempotency_keys`).
- **`fake-payments`** — un faux Stripe qui **compte les charges** (`GET /charges/count`) et qu'on peut configurer pour **injecter des timeouts et des pannes** (`FAILURE_MODE=timeout|flaky|down`).

**Le bug à reproduire d'abord, puis à corriger :** avec le client qui retente, un paiement dont la **réponse se perd** (timeout) est **rejoué** → `charges/count` monte à 2 pour un seul RSVP voulu.

Ta mission, en trois temps :
1. **Reproduire** le double débit (client naïf + `FAILURE_MODE=timeout`).
2. **Écrire le client résilient** : timeout (`AbortController`) + retry **full jitter**, en ne retentant **que** le transitoire, en envoyant une **clé d'idempotence** générée **une fois**.
3. **Rendre le serveur idempotent** : réserver la clé sous **contrainte d'unicité** avant l'effet, rejouer la réponse mémorisée à une clé déjà vue. Objectif : `charges/count === 1` même après 4 tentatives.

**Pas de gap-fill** — tu écris le client et la logique serveur à partir du starter.

### Démarrage

```bash
docker compose up -d          # api, db, fake-payments
docker compose logs -f api    # observer

# Reproduire le bug : le faux paiement réussit mais la réponse traîne au-delà du timeout client
FAILURE_MODE=timeout docker compose up -d fake-payments
node client.mjs               # le client naïf retente → double charge
curl localhost:4000/charges/count   # attendu (bug) : 2
```

### Starter — client (`client.mjs`)

```js
// client.mjs — À COMPLÉTER
// Objectif : timeout + retry full jitter (transitoire seulement) + clé d'idempotence réutilisée.
const API = 'http://localhost:3000';
const sortieId = 's-42';
const body = { userId: 'u-alice', amountCents: 1200 };

// TODO 1 : générer la clé d'idempotence UNE fois (crypto.randomUUID()), AVANT la boucle de retry.
// TODO 2 : fetchWithTimeout(url, opts, ms) via AbortController (rejeter en AbortError au-delà de ms).
// TODO 3 : isTransient(status?, err?) : true si erreur réseau/timeout, 408/429/5xx ; false si 4xx métier.
// TODO 4 : boucle de retry (max 4) : full jitter = Math.random() * Math.min(cap, base * 2**attempt).
//          N'ajouter la clé qu'UNE fois (header 'Idempotency-Key'), identique à chaque tentative.

const res = await rsvpWithRetry();      // ← à écrire
console.log('RSVP =', await res.json());
```

### Starter — serveur (handler à sécuriser)

```ts
// rsvp.handler.ts — AVANT (naïf : à rendre idempotent)
export async function rsvp(sortieId: string, key: string | undefined, input: RsvpInput) {
  const charge = await payments.charge(input.userId, input.amountCents); // effet non rejouable !
  const rsvp = await db.saveRsvp(sortieId, input.userId, charge.id);
  return rsvp;
  // TODO : si `key` déjà en base → renvoyer le résultat mémorisé sans recharger.
  //        sinon réserver `key` (INSERT sous UNIQUE index) AVANT charge ; sur violation → relire le résultat.
}
```

---

## Étapes (en friction)

1. **Reproduis le bug.** `FAILURE_MODE=timeout`, lance le client naïf, constate `charges/count === 2`. Comprends *pourquoi* : la charge a réussi, seule la réponse s'est perdue.
2. **Écris `fetchWithTimeout`** avec `AbortController` : au-delà de `timeoutMs`, `controller.abort()` → l'appel rejette en `AbortError`. Nettoie le timer dans un `finally`.
3. **Écris `isTransient`** : `AbortError`/erreur réseau → `true` ; `408/429/500/502/503/504` → `true` ; `400/401/403/404/422` → `false` (ne pas retenter).
4. **Écris la boucle de retry** : max 4 tentatives, délai **full jitter** `Math.random() * Math.min(20_000, 200 * 2 ** attempt)`. Sors immédiatement sur une erreur permanente.
5. **Génère la clé d'idempotence UNE fois** avant la boucle ; passe-la, **inchangée**, en header à chaque tentative. (Vérifie le piège : si tu la régénères dans la boucle, le fix serveur ne servira à rien.)
6. **Crée la table `idempotency_keys`** avec un **`UNIQUE`** sur la clé, une colonne `result jsonb`, un `status` (`reserved`/`done`) et un `created_at` (TTL).
7. **Sécurise le handler** : (a) clé déjà `done` → renvoyer `result` ; (b) sinon `INSERT` la clé (réservation) — si **violation d'unicité**, un retry concurrent est passé : relis/attends son résultat ; (c) sinon charge + save + `UPDATE … status='done', result=…`.
8. **Prouve le fix** : `FAILURE_MODE=timeout`, relance le client résilient, vérifie `charges/count === 1` et **un seul** RSVP. Recommence avec `FAILURE_MODE=flaky` (échecs 5xx intermittents) et `down` (permanent → doit échouer proprement sans marteler).

---

## Corrigé complet commenté

```js
// client.mjs — corrigé
const API = 'http://localhost:3000';
const sortieId = 's-42';
const body = { userId: 'u-alice', amountCents: 1200 };

// ── Timeout réel : AbortController annule la requête HTTP au-delà de timeoutMs ──
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout après ${timeoutMs}ms`);
    throw e; // vraie erreur réseau
  } finally {
    clearTimeout(id); // TOUJOURS nettoyer, succès comme échec
  }
}

// ── Ne retenter QUE le transitoire ──
function isTransient(status, err) {
  if (err) return true; // AbortError / erreur réseau = transitoire
  return [408, 429, 500, 502, 503, 504].includes(status); // 4xx métier → false
}

async function rsvpWithRetry() {
  // CLÉ générée UNE fois : elle représente l'INTENTION (payer cette sortie), pas la requête.
  const idempotencyKey = crypto.randomUUID();
  const maxAttempts = 4;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API}/sorties/${sortieId}/rsvp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey, // ← IDENTIQUE à chaque tentative
        },
        body: JSON.stringify(body),
      }, 800); // timeout court exprès pour provoquer le retry en mode 'timeout'

      if (res.ok) return res;                       // 200/201 → fini
      if (!isTransient(res.status)) {               // 400/401… → inutile d'insister
        throw new Error(`échec permanent ${res.status}`);
      }
      if (attempt === maxAttempts - 1) throw new Error(`épuisé après ${maxAttempts} tentatives`);
    } catch (e) {
      // erreur réseau/timeout → transitoire ; sinon on relance
      if (attempt === maxAttempts - 1 || !isTransient(undefined, e)) throw e;
    }
    // full jitter : random(0, min(cap, base * 2^attempt)) — étale les retries (anti thundering herd)
    const delay = Math.random() * Math.min(20_000, 200 * 2 ** attempt);
    console.log(`retry #${attempt + 1} dans ${delay.toFixed(0)}ms`);
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('unreachable');
}

const res = await rsvpWithRetry();
console.log('RSVP =', await res.json());
```

```sql
-- migration — table d'idempotence
CREATE TABLE idempotency_keys (
  key         TEXT PRIMARY KEY,          -- UNIQUE : la course concurrente se résout ICI
  status      TEXT NOT NULL,             -- 'reserved' | 'done'
  result      JSONB,                     -- réponse mémorisée (rejouée aux retries)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Nettoyage TTL (job périodique) : DELETE WHERE created_at < now() - interval '30 days';
```

```ts
// rsvp.handler.ts — corrigé (idempotent, atomique)
export async function rsvp(sortieId: string, key: string | undefined, input: RsvpInput) {
  if (!key) throw new HttpError(400, 'Idempotency-Key requise'); // mutation à effet monétaire → clé obligatoire

  // 1. Déjà traité ? on rejoue le résultat mémorisé — AUCUN effet refait.
  const existing = await db.query(
    `SELECT status, result FROM idempotency_keys WHERE key = $1`, [key],
  );
  if (existing.rows[0]?.status === 'done') return existing.rows[0].result;

  // 2. Réserver la clé AVANT l'effet. La contrainte UNIQUE tranche la concurrence :
  //    si un retry concurrent a déjà réservé, l'INSERT échoue (23505) et on relit son résultat.
  try {
    await db.query(
      `INSERT INTO idempotency_keys (key, status) VALUES ($1, 'reserved')`, [key],
    );
  } catch (e: any) {
    if (e.code === '23505') return await waitForResult(key); // violation d'unicité = course perdue
    throw e;
  }

  // 3. On n'atteint l'effet non rejouable QUE si on a gagné la réservation.
  const charge = await payments.charge(input.userId, input.amountCents);
  const rsvp = await db.saveRsvp(sortieId, input.userId, charge.id);

  // 4. Mémoriser pour les retries futurs (idéalement dans la MÊME transaction que l'étape 3).
  await db.query(
    `UPDATE idempotency_keys SET status = 'done', result = $2 WHERE key = $1`,
    [key, rsvp],
  );
  return rsvp;
}
```

**Pourquoi ce corrigé est correct :**
- **La clé départage la concurrence dans la DB**, pas dans le code : deux retries simultanés ne peuvent pas tous deux `INSERT` la même clé — l'un gagne, l'autre reçoit `23505` et relit le résultat. Un `if (map.has(key))` aurait laissé passer les deux (fenêtre de course, piège #3 du module).
- **La réservation précède l'effet** : la charge Stripe n'est atteinte que par le gagnant de la réservation → **une seule** charge, quelles que soient les tentatives.
- **Le client génère la clé une fois** : la réémettre inchangée est ce qui permet au serveur de reconnaître le rejeu. Régénérée dans la boucle, la protection serveur serait inerte.
- **Full jitter + transitoire seulement** : les retries s'étalent (pas de rafale synchronisée) et on n'insiste jamais sur un `400`.

**Vérification finale attendue :**
```bash
FAILURE_MODE=timeout docker compose up -d fake-payments
node client.mjs
curl localhost:4000/charges/count     # ✅ 1  (avant fix : 2)
docker compose exec db psql -c "SELECT count(*) FROM rsvps"   # ✅ 1
```

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées, en 40 minutes, sans rouvrir ce corrigé ni le module :**

1. Ajoute un **retry budget (token bucket)** côté serveur pour l'appel `api → fake-payments` : chaque retry consomme des jetons, un succès recharge, et **fail-fast** quand le bucket est vide (avec `FAILURE_MODE=down`, l'API doit cesser de marteler `fake-payments` et répondre en erreur rapide au lieu d'épuiser ses 4 tentatives à chaque requête).
2. Ajoute une **deadline propagée** : le client envoie un header `X-Request-Deadline` (epoch ms) ; le serveur **abandonne** l'appel paiement si la deadline est déjà dépassée (`remaining ≤ 0`), sans appeler `fake-payments` (pas de travail fantôme).

**Critère de réussite :** en mode `down`, `charges/count` reste à `0`, l'API répond vite (pas de blocage jusqu'au timeout à chaque fois), et le token bucket se voit dans les logs. En mode `timeout` avec une deadline déjà courte, l'API renonce sans appeler le paiement.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, la logique vit ici :

```
tribuzen/
  apps/
    api/
      src/
        modules/
          rsvp/
            rsvp.controller.ts      ← handler idempotent (clé + unique index)
            idempotency.repository.ts
        shared/
          http/
            resilient-client.ts     ← fetchWithTimeout + retry full jitter + isTransient
  packages/
    mobile/
      src/api/rsvp.ts               ← génère l'Idempotency-Key une fois par intention
```

**Différences par rapport au lab :**

- Le faux service de paiement devient le **vrai** connecteur Stripe (Stripe supporte nativement l'en-tête `Idempotency-Key` côté API — la clé métier TribuZen s'aligne dessus).
- La table `idempotency_keys` gagne un **TTL réel** (job de purge à 30 jours) et l'étape 3+4 se fait dans **une seule transaction** DB pour que « réservation done » et « RSVP enregistré » soient atomiques.
- Le retry budget devient un **middleware partagé** appliqué à tous les appels backend-to-backend faillibles, pas seulement au paiement.
- La deadline propagée se branche sur le tracing (module 16) pour corréler timeout et span.

**Commit cible :**
```
feat(rsvp): POST /rsvp idempotent — timeout+retry full jitter client, clé d'idempotence (unique index) serveur
```
