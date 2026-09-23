// Oracle du lab 03 (Systèmes distribués). Ne pas modifier.
import { describe, expect, it } from "vitest";
import { Bulkhead, getHomePage, type HomePagePools } from "@lab/cascade";

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function creerDiffere<T>(): { promesse: Promise<T>; resoudre: (valeur: T) => void } {
  let resoudre!: (valeur: T) => void;
  const promesse = new Promise<T>((resolve) => {
    resoudre = resolve;
  });
  return { promesse, resoudre };
}

function creerPools(capacite = 5): HomePagePools {
  return {
    sorties: new Bulkhead("sorties", capacite),
    budget: new Bulkhead("budget", capacite),
    notifications: new Bulkhead("notifications", capacite),
  };
}

describe("getHomePage — cas nominal", () => {
  it("agrège les trois dépendances quand tout va bien", async () => {
    const pools = creerPools();
    const resultat = await getHomePage(
      {
        fetchSorties: () => Promise.resolve("sorties-ok"),
        fetchBudget: () => Promise.resolve("budget-ok"),
        fetchNotifications: () => Promise.resolve("notifs-ok"),
      },
      pools,
    );
    expect(resultat).toEqual({ sorties: "sorties-ok", budget: "budget-ok", notifications: "notifs-ok" });
  });
});

describe("getHomePage — classification critique vs non critique (module 14 §2.6)", () => {
  it("Sorties CRITIQUE : son échec fait échouer TOUTE la page", async () => {
    const pools = creerPools();
    await expect(
      getHomePage(
        {
          fetchSorties: () => Promise.reject(new Error("sorties indisponible")),
          fetchBudget: () => Promise.resolve("budget-ok"),
          fetchNotifications: () => Promise.resolve("notifs-ok"),
        },
        pools,
      ),
    ).rejects.toThrow("sorties indisponible");
  });

  it("Budget CRITIQUE : son échec fait échouer TOUTE la page", async () => {
    const pools = creerPools();
    await expect(
      getHomePage(
        {
          fetchSorties: () => Promise.resolve("sorties-ok"),
          fetchBudget: () => Promise.reject(new Error("budget indisponible")),
          fetchNotifications: () => Promise.resolve("notifs-ok"),
        },
        pools,
      ),
    ).rejects.toThrow("budget indisponible");
  });

  it("Notifications NON CRITIQUE : son échec dégrade gracieusement, ne fait PAS échouer la page", async () => {
    const pools = creerPools();
    const resultat = await getHomePage(
      {
        fetchSorties: () => Promise.resolve("sorties-ok"),
        fetchBudget: () => Promise.resolve("budget-ok"),
        fetchNotifications: () => Promise.reject(new Error("notifications indisponibles")),
      },
      pools,
    );
    expect(resultat).toEqual({ sorties: "sorties-ok", budget: "budget-ok", notifications: null });
  });
});

describe("getHomePage — piège #8 : le permis est TOUJOURS rendu, même sur erreur", () => {
  it("des échecs RÉPÉTÉS de Sorties (critique) ne font jamais fuir un seul permis", async () => {
    const pools = creerPools(5);

    for (let i = 0; i < 5; i++) {
      await getHomePage(
        { fetchSorties: () => Promise.reject(new Error("boom")), fetchBudget: () => Promise.resolve("b"), fetchNotifications: () => Promise.resolve("n") },
        pools,
      ).catch(() => {});
      await attendre(0); // laisse les .finally des trois branches (Promise.all n'attend pas les autres) se terminer
    }

    // Si un seul permis avait fui à chaque itération, le pool serait à 0 après 5 échecs
    // (capacité 5) — un bulkhead qui ne rend jamais ses permis se bloque pour de bon.
    expect(pools.sorties.available).toBe(5);
  });
});

describe("getHomePage — LA PANNE EN CASCADE (le sujet réel du lab)", () => {
  it("REPRODUIT : une requête saine échoue à cause d'un pool partagé encore occupé par une AUTRE requête (starter) / la CONTIENT avec des pools isolés (solution)", async () => {
    const pools = creerPools(5); // capacité généreuse pour UNE requête isolée (3 dépendances), insuffisante pour DEUX requêtes concurrentes sur UN SEUL pool partagé (3+3 > 5)

    const notifEncoreEnCours = creerDiffere<unknown>(); // simule une requête Notifications qui n'a pas encore fini de répondre

    // Requête A : trois dépendances saines, mais Notifications n'a pas encore répondu.
    const requeteA = getHomePage(
      { fetchSorties: () => Promise.resolve("s-A"), fetchBudget: () => Promise.resolve("b-A"), fetchNotifications: () => notifEncoreEnCours.promesse },
      pools,
    );

    // Requête B, lancée juste après : TROIS dépendances parfaitement saines et rapides, elle
    // ne demande RIEN à Notifications de A. Elle ne devrait JAMAIS échouer à cause de A.
    const requeteB = getHomePage(
      { fetchSorties: () => Promise.resolve("s-B"), fetchBudget: () => Promise.resolve("b-B"), fetchNotifications: () => Promise.resolve("n-B") },
      pools,
    );

    const resultatB = await requeteB.then(() => "ok" as const).catch(() => "echec" as const);
    expect(resultatB).toBe("ok");

    notifEncoreEnCours.resoudre("liberee"); // débloque A pour ne laisser aucune promesse pendante
    await requeteA.catch(() => {});
  });

  it("CONTIENT explicitement : un bulkhead notifications plein ne touche jamais au pool sorties/budget", async () => {
    const pools: HomePagePools = { sorties: new Bulkhead("sorties", 5), budget: new Bulkhead("budget", 5), notifications: new Bulkhead("notifications", 1) };
    pools.notifications.acquire(); // sature notifications AVANT tout appel

    const resultat = await getHomePage(
      { fetchSorties: () => Promise.resolve("s"), fetchBudget: () => Promise.resolve("b"), fetchNotifications: () => Promise.resolve("n") },
      pools,
    );

    expect(resultat.sorties).toBe("s");
    expect(resultat.budget).toBe("b");
    expect(resultat.notifications).toBeNull(); // fallback, puisque son bulkhead était plein
  });
});
