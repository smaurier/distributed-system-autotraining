# Lab 01 — De zéro : rendre résilient un appel externe

> **Outcome :** à la fin, un appel vers un fournisseur externe lent et instable (module 14 :
> « le service Notifications devient lent ; sans protection il sature le pool de connexions
> de l'API-gateway et fait tomber tout TribuZen ») est protégé par UN SEUL geste composé —
> timeout, retry avec backoff+jitter, circuit breaker — pas trois utilitaires isolés jamais
> branchés ensemble.
> **Vrai geste :** `CircuitBreaker` à trois états (CLOSED/OPEN/HALF_OPEN, module 14 §2.5),
> `retryWithBackoff` en full jitter (module 08 §2.5), `withTimeout`, assemblés dans le BON
> ordre (module 14 §2.7, piège #5 : l'ordre inverse annule le breaker).
> **Feedback :** `npm run lab:01` — RED tant que `src/resilientCall.ts` ne satisfait pas
> l'oracle (26 tests). `npm run solution:01` prouve l'oracle.

## Prérequis technique

```bash
cd 17-distributed-systems/labs
npm install
```

## Lire avant (une lecture bornée)

- Module [`08-retries-timeouts-idempotency.md`](../../modules/08-retries-timeouts-idempotency.md),
  §2.4-2.5 — erreur transitoire vs permanente, exponential backoff + full jitter.
- Module [`14-failure-modes-et-circuit-breaker.md`](../../modules/14-failure-modes-et-circuit-breaker.md),
  §2.5 et §2.7, pièges #3, #5, #6 — le circuit breaker, l'ordre de composition, pourquoi le
  HALF_OPEN ne laisse passer qu'UNE requête d'essai.

## Énoncé

TribuZen appelle un fournisseur externe de notifications push. Lis les commentaires en tête
de `src/resilientCall.ts` et implémente, dans l'ordre :

1. `fullJitterDelay`, `withTimeout`, `isTransientHttpStatus` — les briques.
2. `retryWithBackoff` — retente une erreur transitoire, jamais une erreur permanente.
3. `CircuitBreaker` — les trois états, fail-fast en OPEN, une seule requête d'essai en
   HALF_OPEN.
4. `createResilientCaller` — assemble tout, dans le bon ordre.

**Le piège à éviter (le sujet réel du lab).** Si le breaker comptait chaque tentative
individuelle du retry comme un échec séparé, un appel qui réussit à la 2e tentative
(transitoire, récupéré) ouvrirait le circuit bien plus vite qu'il ne le devrait — et pire,
un retry placé AU-DESSUS du breaker (piège #5 du module) réarme des appels sous un circuit
déjà ouvert, ce qui l'annule purement et simplement. Le breaker doit englober la séquence
retry+timeout tout entière et n'en voir qu'UN résultat final.

## Étapes (en friction)

1. `npm run lab:01` : RED.
2. `fullJitterDelay(attempt, baseMs, capMs)` : `random(0, min(capMs, baseMs·2^attempt))`.
3. `withTimeout` : `Promise.race` implicite entre `fn()` et un timer qui rejette une
   `TimeoutError` — sans jamais masquer une VRAIE erreur applicative en timeout.
4. `retryWithBackoff` : boucle bornée par `maxAttempts`, s'arrête immédiatement sur une
   erreur permanente, attend `fullJitterDelay` entre deux tentatives transitoires.
5. `CircuitBreaker` : CLOSED → OPEN au `failureThreshold`e échec ; OPEN fail-fast jusqu'à
   `resetTimeoutMs` ; puis HALF_OPEN, une seule requête d'essai, succès → CLOSED, échec →
   OPEN et le timeout REPART de zéro.
6. `createResilientCaller` : `breaker.execute(() => retryWithBackoff(() => withTimeout(call,
   timeoutMs), retry))` — et un `TimeoutError` est TOUJOURS transitoire, en plus du
   classificateur fourni.

## Vérifier

```bash
cd 17-distributed-systems/labs
npm run lab:01
npm run solution:01
```

**Ce que l'oracle vérifie (26 tests)**

`fullJitterDelay` : bornes respectées, plafond appliqué, vraie aléatoire. `withTimeout` :
résolution normale, `TimeoutError` sur dépassement, erreur applicative jamais masquée.
`isTransientHttpStatus` : 5xx/429 vs 4xx. `retryWithBackoff` : succès direct, retry sur
transitoire, abandon après `maxAttempts`, aucun retry sur permanent. `CircuitBreaker` :
CLOSED initial, ouverture au seuil, fail-fast sans appeler `fn`, HALF_OPEN après le reset
timeout, succès → CLOSED, échec de l'essai → OPEN avec redémarrage du timeout (prouvé par
un appel immédiatement après qui fail-fast au lieu de retenter). `createResilientCaller` :
chemin heureux, **le breaker ne voit qu'un résultat final par appel** (le piège, prouvé sur
deux appels consécutifs avec un seuil de 1), une erreur permanente non retentée mais comptée
par le breaker, un timeout toujours traité comme transitoire même si le classificateur dit
non.

## Variante J+30 (fading)

Ajoute un **bulkhead** (sémaphore limitant la concurrence, module 14 §2.4) AU-DESSUS du
circuit breaker dans la composition (`bulkhead → breaker → retry → timeout → appel`) et
prouve, par un test, que la lenteur d'un appel ne peut pas épuiser le budget de concurrence
d'une AUTRE dépendance (isolation du "blast radius").

## Application TribuZen

Même geste sur le vrai appel `tribuzen-api → provider de notifications push`, remplaçant un
`while (!ok) retry()` nu qui aggravait les pannes au lieu de les contenir (retry storm,
module 14 piège #3). Commit :
`feat(resilience): appel au provider push protégé par circuit breaker + retry + timeout`.
