// resilientCall.ts — PAGE BLANCHE. TribuZen appelle un fournisseur externe de notifications
// push. Il est lent et tombe parfois en panne. Rends CET appel résilient (module 08 + 14) :
// un seul geste, pas trois utilitaires isolés — circuit breaker qui ENGLOBE retry qui
// ENGLOBE timeout (piège #5 du module 14 : l'ordre inverse annule le breaker).
//
// export function fullJitterDelay(attempt: number, baseMs: number, capMs: number): number
//   - Formule "full jitter" (AWS Architecture Blog, module 08 §2.5) :
//     `random(0, min(capMs, baseMs * 2^attempt))`. `attempt` commence à 0.
//
// export class TimeoutError extends Error {}
// export function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T>
//   - Si `fn()` ne se résout pas avant `timeoutMs`, rejette une `TimeoutError` (l'appel sous-
//     jacent continue en arrière-plan, ignoré — pas d'AbortController réseau ici, `fn` est déjà
//     une Promise fournie). Si `fn()` rejette AVANT le timeout, propage SON erreur telle quelle
//     (jamais une TimeoutError pour une vraie erreur applicative).
//
// export function isTransientHttpStatus(status: number): boolean
//   - Module 08 §2.4 : 5xx et 429 → transitoire (retry) ; 4xx (400, 404...) → permanent
//     (jamais retry, ce sont des erreurs client, retenter ne change rien).
//
// export interface RetryOptions { maxAttempts: number; baseDelayMs: number; capDelayMs: number; isTransient: (error: unknown) => boolean }
// export function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>
//   - `maxAttempts` tentatives AU TOTAL (la première incluse). Entre deux tentatives, si
//     `isTransient(erreur)` est vrai ET qu'il reste des tentatives, attend `fullJitterDelay`
//     puis réessaie. Si `isTransient` est FAUX, rejette IMMÉDIATEMENT (jamais de retry sur une
//     erreur permanente). Après la dernière tentative épuisée, rejette la DERNIÈRE erreur reçue.
//
// export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
// export class CircuitBreakerOpenError extends Error {}
// export class CircuitBreaker {
//   constructor(config: { failureThreshold: number; resetTimeoutMs: number })
//   get state(): CircuitState
//   execute<T>(fn: () => Promise<T>): Promise<T>
// }
//   - Module 14 §2.5, les trois états CLOSED/OPEN/HALF_OPEN :
//     - CLOSED : les appels passent. Un échec incrémente un compteur ; un succès le remet à
//       zéro. Au `failureThreshold`e échec consécutif, on ouvre (OPEN, horodatage noté).
//     - OPEN : rejette IMMÉDIATEMENT `CircuitBreakerOpenError`, SANS jamais appeler `fn`
//       (fail-fast) — sauf si `resetTimeoutMs` est écoulé depuis l'ouverture, auquel cas on
//       passe en HALF_OPEN et on tente CET appel comme requête d'essai.
//     - HALF_OPEN : un succès → retour CLOSED (compteur remis à zéro). Un échec → retour OPEN,
//       le `resetTimeoutMs` REPART de zéro (piège #6 du module : jamais direct OPEN→CLOSED).
//
// export function createResilientCaller<T>(call: () => Promise<T>, options: { timeoutMs: number; retry: RetryOptions; breaker: { failureThreshold: number; resetTimeoutMs: number } }): () => Promise<T>
//   - LE GESTE COMPLET : compose les trois. Ordre EXACT (module 14 §2.7, piège #5) :
//     `breaker.execute(() => retryWithBackoff(() => withTimeout(call, timeoutMs), retry))`.
//   - Un TimeoutError doit TOUJOURS être traité comme transitoire par le retry interne, EN PLUS
//     du classificateur fourni dans `options.retry.isTransient` (un timeout est par nature une
//     panne transitoire — module 08 §2.4 — quel que soit l'appelant).
//
// LE PIÈGE (le sujet réel du lab, vérifié en construisant l'oracle) : si le breaker comptait
// CHAQUE tentative individuelle du retry comme un échec séparé, un seul appel qui réussit à la
// 2e tentative (transitoire, récupéré) ouvrirait le circuit bien plus vite qu'il ne le devrait.
// Le breaker doit voir la séquence retry+timeout comme UN SEUL appel : un seul succès ou un
// seul échec final, jamais les échecs intermédiaires absorbés par le retry.
export function fullJitterDelay(_attempt: number, _baseMs: number, _capMs: number): number {
  throw new Error("fullJitterDelay n'est pas encore implémenté");
}

export class TimeoutError extends Error {}

export function withTimeout<T>(_fn: () => Promise<T>, _timeoutMs: number): Promise<T> {
  throw new Error("withTimeout n'est pas encore implémenté");
}

export function isTransientHttpStatus(_status: number): boolean {
  throw new Error("isTransientHttpStatus n'est pas encore implémenté");
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  capDelayMs: number;
  isTransient: (error: unknown) => boolean;
}

export function retryWithBackoff<T>(_fn: () => Promise<T>, _options: RetryOptions): Promise<T> {
  throw new Error("retryWithBackoff n'est pas encore implémenté");
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreakerOpenError extends Error {}

export class CircuitBreaker {
  constructor(_config: { failureThreshold: number; resetTimeoutMs: number }) {
    throw new Error("CircuitBreaker n'est pas encore implémenté");
  }

  get state(): CircuitState {
    throw new Error("CircuitBreaker n'est pas encore implémenté");
  }

  execute<T>(_fn: () => Promise<T>): Promise<T> {
    throw new Error("CircuitBreaker n'est pas encore implémenté");
  }
}

export function createResilientCaller<T>(
  _call: () => Promise<T>,
  _options: {
    timeoutMs: number;
    retry: RetryOptions;
    breaker: { failureThreshold: number; resetTimeoutMs: number };
  },
): () => Promise<T> {
  throw new Error("createResilientCaller n'est pas encore implémenté");
}
