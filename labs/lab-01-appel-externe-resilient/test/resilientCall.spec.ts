// Oracle du lab 01 (Systèmes distribués). Ne pas modifier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  TimeoutError,
  createResilientCaller,
  fullJitterDelay,
  isTransientHttpStatus,
  retryWithBackoff,
  withTimeout,
} from "@lab/resilientCall";

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

describe("fullJitterDelay — random(0, min(cap, base * 2^attempt))", () => {
  it("reste toujours dans les bornes [0, min(cap, base*2^attempt)]", () => {
    const base = 200;
    const cap = 20_000;
    for (const attempt of [0, 1, 2, 5]) {
      const borne = Math.min(cap, base * 2 ** attempt);
      for (let i = 0; i < 200; i++) {
        const delai = fullJitterDelay(attempt, base, cap);
        expect(delai).toBeGreaterThanOrEqual(0);
        expect(delai).toBeLessThanOrEqual(borne);
      }
    }
  });

  it("respecte le plafond même quand base*2^attempt le dépasse largement", () => {
    const cap = 20_000;
    for (let i = 0; i < 200; i++) {
      const delai = fullJitterDelay(10, 200, cap); // 200*2^10 = 204 800 >> cap
      expect(delai).toBeLessThanOrEqual(cap);
    }
  });

  it("est réellement aléatoire (pas une constante déguisée)", () => {
    const valeurs = new Set(Array.from({ length: 50 }, () => fullJitterDelay(4, 200, 20_000)));
    expect(valeurs.size).toBeGreaterThan(1);
  });
});

describe("withTimeout — borne l'attente d'une promesse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("résout normalement si fn() finit avant le timeout", async () => {
    await expect(withTimeout(() => Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("rejette une TimeoutError si fn() ne finit jamais avant le timeout", async () => {
    const jamais = () => new Promise<never>(() => {});
    const promesse = withTimeout(jamais, 1000);
    const attente = expect(promesse).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await attente;
  });

  it("propage l'erreur RÉELLE de fn() si elle rejette avant le timeout (jamais masquée en TimeoutError)", async () => {
    await expect(withTimeout(() => Promise.reject(new Error("boom applicatif")), 1000)).rejects.toThrow(
      "boom applicatif",
    );
  });
});

describe("isTransientHttpStatus — 5xx et 429 transitoires, 4xx permanents", () => {
  it.each([
    [500, true],
    [502, true],
    [503, true],
    [429, true],
    [400, false],
    [404, false],
    [401, false],
    [200, false],
  ])("status %i → transitoire = %s", (status, attendu) => {
    expect(isTransientHttpStatus(status)).toBe(attendu);
  });
});

describe("retryWithBackoff — retry sur transitoire, jamais sur permanent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("réussit du premier coup sans jamais retenter", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const resultat = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => true });
    expect(resultat).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retente une erreur transitoire puis réussit", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("panne temporaire")).mockResolvedValueOnce("ok");
    const promesse = retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => true });
    await vi.advanceTimersByTimeAsync(50);
    await expect(promesse).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("abandonne après maxAttempts échecs transitoires consécutifs", async () => {
    const erreur = new Error("toujours en panne");
    const fn = vi.fn().mockRejectedValue(erreur);
    const promesse = retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => true });
    const attente = expect(promesse).rejects.toBe(erreur);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    await attente;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("ne retente JAMAIS une erreur permanente — rejette immédiatement", async () => {
    const erreur = new Error("400 Bad Request");
    const fn = vi.fn().mockRejectedValue(erreur);
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => false }),
    ).rejects.toBe(erreur);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker — CLOSED / OPEN / HALF_OPEN", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const echoue = () => Promise.reject(new Error("panne"));
  const reussit = () => Promise.resolve("ok");

  it("démarre CLOSED", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    expect(breaker.state).toBe("CLOSED");
  });

  it("s'ouvre après failureThreshold échecs consécutifs, puis fail-fast SANS appeler fn", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    await expect(breaker.execute(echoue)).rejects.toThrow();
    await expect(breaker.execute(echoue)).rejects.toThrow();
    expect(breaker.state).toBe("OPEN");

    const espion = vi.fn(reussit);
    await expect(breaker.execute(espion)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(espion).not.toHaveBeenCalled();
  });

  it("passe en HALF_OPEN après resetTimeoutMs ; un essai réussi referme le circuit (CLOSED)", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(breaker.execute(echoue)).rejects.toThrow();
    expect(breaker.state).toBe("OPEN");

    await vi.advanceTimersByTimeAsync(1000);
    await expect(breaker.execute(reussit)).resolves.toBe("ok");
    expect(breaker.state).toBe("CLOSED");
  });

  it("un essai HALF_OPEN qui échoue repart en OPEN et redémarre le reset timeout", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
    await expect(breaker.execute(echoue)).rejects.toThrow();
    expect(breaker.state).toBe("OPEN");

    await vi.advanceTimersByTimeAsync(1000);
    await expect(breaker.execute(echoue)).rejects.toThrow(); // l'essai HALF_OPEN échoue
    expect(breaker.state).toBe("OPEN");

    // Si le reset timeout n'avait pas redémarré, on serait déjà à t=1000ms depuis l'ouverture
    // d'origine et l'appel suivant tenterait un nouvel essai au lieu de fail-fast.
    const espion = vi.fn(reussit);
    await expect(breaker.execute(espion)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(espion).not.toHaveBeenCalled();
  });
});

describe("createResilientCaller — le geste complet : breaker englobe retry englobe timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chemin heureux : réussit du premier coup", async () => {
    const call = vi.fn().mockResolvedValue("ok");
    const resilient = createResilientCaller(call, {
      timeoutMs: 1000,
      retry: { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => true },
      breaker: { failureThreshold: 2, resetTimeoutMs: 5000 },
    });
    await expect(resilient()).resolves.toBe("ok");
  });

  it("le breaker ne voit qu'UN résultat final par appel, jamais les échecs absorbés par le retry (le piège du lab)", async () => {
    const erreurTransitoire = new ProviderError("indisponible", 503);
    const call = vi
      .fn()
      .mockRejectedValueOnce(erreurTransitoire)
      .mockResolvedValueOnce("premier-ok")
      .mockRejectedValueOnce(erreurTransitoire)
      .mockResolvedValueOnce("second-ok");

    // Seuil minimal : la moindre "vraie" panne comptée par le breaker l'ouvrirait tout de suite.
    const resilient = createResilientCaller(call, {
      timeoutMs: 1000,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 10,
        capDelayMs: 50,
        isTransient: (e) => e instanceof ProviderError && isTransientHttpStatus(e.status),
      },
      breaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
    });

    const p1 = resilient();
    await vi.advanceTimersByTimeAsync(50);
    await expect(p1).resolves.toBe("premier-ok");

    // Si le breaker avait compté l'échec transitoire intermédiaire, il serait déjà OPEN ici.
    const p2 = resilient();
    await vi.advanceTimersByTimeAsync(50);
    await expect(p2).resolves.toBe("second-ok");
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("une erreur permanente n'est jamais retentée, mais compte comme UN échec pour le breaker", async () => {
    const erreurPermanente = new ProviderError("introuvable", 404);
    const call = vi.fn().mockRejectedValue(erreurPermanente);
    const resilient = createResilientCaller(call, {
      timeoutMs: 1000,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 10,
        capDelayMs: 50,
        isTransient: (e) => e instanceof ProviderError && isTransientHttpStatus(e.status),
      },
      breaker: { failureThreshold: 1, resetTimeoutMs: 5000 },
    });

    await expect(resilient()).rejects.toBe(erreurPermanente);
    expect(call).toHaveBeenCalledTimes(1); // pas de retry sur une erreur permanente

    // Le breaker a quand même compté cet échec (seuil=1) : l'appel suivant fail-fast.
    await expect(resilient()).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(call).toHaveBeenCalledTimes(1); // le 2e appel n'a jamais touché `call`
  });

  it("un appel trop lent (timeout) est TOUJOURS traité comme transitoire, même si le classificateur dit non", async () => {
    let compteur = 0;
    const call = vi.fn(() => {
      compteur++;
      if (compteur === 1) return new Promise<string>(() => {}); // ne se résout jamais
      return Promise.resolve("recupere");
    });

    const resilient = createResilientCaller(call, {
      timeoutMs: 100,
      retry: { maxAttempts: 3, baseDelayMs: 10, capDelayMs: 50, isTransient: () => false },
      breaker: { failureThreshold: 5, resetTimeoutMs: 5000 },
    });

    const promesse = resilient();
    await vi.advanceTimersByTimeAsync(100); // déclenche le timeout de la 1re tentative
    await vi.advanceTimersByTimeAsync(50); // laisse le backoff s'écouler avant la 2e tentative
    await expect(promesse).resolves.toBe("recupere");
    expect(call).toHaveBeenCalledTimes(2);
  });
});
