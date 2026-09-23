// resilientCall.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
export function fullJitterDelay(attempt: number, baseMs: number, capMs: number): number {
  const plafondnExponentiel = baseMs * 2 ** attempt;
  const borneHaute = Math.min(capMs, plafondnExponentiel);
  return Math.random() * borneHaute;
}

export class TimeoutError extends Error {}

export function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const minuteur = setTimeout(() => {
      reject(new TimeoutError(`Timeout après ${timeoutMs}ms`));
    }, timeoutMs);

    fn().then(
      (valeur) => {
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (erreur) => {
        clearTimeout(minuteur);
        reject(erreur);
      },
    );
  });
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  capDelayMs: number;
  isTransient: (error: unknown) => boolean;
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let derniereErreur: unknown;

  for (let tentative = 0; tentative < options.maxAttempts; tentative++) {
    try {
      return await fn();
    } catch (erreur) {
      derniereErreur = erreur;

      // Erreur permanente (4xx...) : jamais de retry, on rejette tout de suite.
      if (!options.isTransient(erreur)) throw erreur;

      const derniereTentative = tentative === options.maxAttempts - 1;
      if (derniereTentative) break;

      await attendre(fullJitterDelay(tentative, options.baseDelayMs, options.capDelayMs));
    }
  }
  throw derniereErreur;
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreakerOpenError extends Error {}

export class CircuitBreaker {
  private etat: CircuitState = "CLOSED";
  private nombreEchecs = 0;
  private ouvertDepuis = 0;
  private readonly seuil: number;
  private readonly resetTimeoutMs: number;

  constructor(config: { failureThreshold: number; resetTimeoutMs: number }) {
    this.seuil = config.failureThreshold;
    this.resetTimeoutMs = config.resetTimeoutMs;
  }

  get state(): CircuitState {
    return this.etat;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // OPEN : fail-fast, SAUF si le reset timeout est écoulé → passage en HALF_OPEN.
    if (this.etat === "OPEN") {
      if (Date.now() - this.ouvertDepuis >= this.resetTimeoutMs) {
        this.etat = "HALF_OPEN";
      } else {
        throw new CircuitBreakerOpenError("Circuit ouvert : appel refusé sans requête réseau");
      }
    }

    try {
      const resultat = await fn();
      // Succès en CLOSED (reset du compteur) ou en HALF_OPEN (le service est revenu) : CLOSED.
      this.etat = "CLOSED";
      this.nombreEchecs = 0;
      return resultat;
    } catch (erreur) {
      if (this.etat === "HALF_OPEN") {
        // L'essai a échoué : retour OPEN, le reset timeout REPART de zéro (piège #6).
        this.etat = "OPEN";
        this.ouvertDepuis = Date.now();
        throw erreur;
      }

      this.nombreEchecs++;
      if (this.nombreEchecs >= this.seuil) {
        this.etat = "OPEN";
        this.ouvertDepuis = Date.now();
      }
      throw erreur;
    }
  }
}

export function createResilientCaller<T>(
  call: () => Promise<T>,
  options: {
    timeoutMs: number;
    retry: RetryOptions;
    breaker: { failureThreshold: number; resetTimeoutMs: number };
  },
): () => Promise<T> {
  const breaker = new CircuitBreaker(options.breaker);

  // Un timeout est TOUJOURS transitoire, en plus du classificateur fourni par l'appelant.
  const retryOptions: RetryOptions = {
    ...options.retry,
    isTransient: (erreur) => erreur instanceof TimeoutError || options.retry.isTransient(erreur),
  };

  // Ordre exact (module 14 §2.7) : breaker ENGLOBE retry ENGLOBE timeout ENGLOBE l'appel.
  // Le breaker ne voit qu'UN succès ou UN échec final par appel — jamais les tentatives
  // intermédiaires absorbées par le retry (c'est précisément le piège du lab).
  return () => breaker.execute(() => retryWithBackoff(() => withTimeout(call, options.timeoutMs), retryOptions));
}
