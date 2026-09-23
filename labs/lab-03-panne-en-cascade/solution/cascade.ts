// cascade.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
export class BulkheadFullError extends Error {
  constructor(name: string) {
    super(`Bulkhead "${name}" plein — appel rejeté en fail-fast`);
    this.name = "BulkheadFullError";
  }
}

export class Bulkhead {
  private permisDisponibles: number;

  constructor(
    private readonly name: string,
    private readonly capacite: number,
  ) {
    this.permisDisponibles = capacite;
  }

  acquire(): void {
    if (this.permisDisponibles <= 0) throw new BulkheadFullError(this.name);
    this.permisDisponibles--;
  }

  release(): void {
    this.permisDisponibles++;
  }

  get available(): number {
    return this.permisDisponibles;
  }
}

export interface HomePageDeps {
  fetchSorties: () => Promise<unknown>;
  fetchBudget: () => Promise<unknown>;
  fetchNotifications: () => Promise<unknown>;
}

export interface HomePagePools {
  sorties: Bulkhead;
  budget: Bulkhead;
  notifications: Bulkhead;
}

export interface HomePageResult {
  sorties: unknown;
  budget: unknown;
  notifications: unknown | null;
}

async function appelAvecPermis<T>(pool: Bulkhead, fn: () => Promise<T>): Promise<T> {
  pool.acquire();
  try {
    return await fn();
  } finally {
    // Piège #8 : le permis est TOUJOURS rendu, même si fn() throw — sinon un chemin
    // d'erreur répété vide le bulkhead permis par permis jusqu'au blocage total.
    pool.release();
  }
}

export async function getHomePage(deps: HomePageDeps, pools: HomePagePools): Promise<HomePageResult> {
  // Isolation (module 14 §2.4) : CHAQUE dépendance dans SON PROPRE pool. Une requête
  // Notifications encore en cours ne peut plus jamais épuiser le pool de Sorties/Budget.
  const sortiesPromesse = appelAvecPermis(pools.sorties, deps.fetchSorties);
  const budgetPromesse = appelAvecPermis(pools.budget, deps.fetchBudget);

  // Notifications = NON CRITIQUE (module 14 §2.6) : son échec (rejet, ou bulkhead plein) ne
  // doit JAMAIS faire tomber toute la page — dégradation gracieuse, fallback `null`.
  const notificationsPromesse = appelAvecPermis(pools.notifications, deps.fetchNotifications).catch(() => null);

  // Sorties et Budget restent CRITIQUES : leur rejet propage et fait échouer `getHomePage`
  // tout entier (comportement voulu, pas un bug).
  const [sorties, budget, notifications] = await Promise.all([sortiesPromesse, budgetPromesse, notificationsPromesse]);

  return { sorties, budget, notifications };
}
