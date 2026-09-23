// cascade.ts — L'EXISTANT, EN PRODUCTION (module 14). La page d'accueil TribuZen agrège trois
// appels en parallèle : Sorties, Budget (CRITIQUES — leur échec fait échouer la page) et
// Notifications (NON CRITIQUE — le badge "3 notifs", mieux vaut la page sans lui que pas de
// page du tout). `getHomePage` COMPILE et MARCHE dans le cas nominal. Le bug ne se voit que
// sous charge : une requête Notifications encore en cours siphonne un pool PARTAGÉ avec
// Sorties/Budget (une vraie panne en cascade, module 14 §2.2) et fait échouer une AUTRE
// requête dont les trois dépendances sont parfaitement saines.
//
// `Bulkhead`/`BulkheadFullError` sont DONNÉS et déjà corrects (module 14 §2.4, exemple 2) —
// pas le sujet du bug. `acquire()` échoue IMMÉDIATEMENT (fail-fast, pas de file d'attente) si
// le pool est plein — c'est voulu, pas à "améliorer" en semaphore à file d'attente.
//
// AVANT de corriger : ouvre CE fichier ET comprends pourquoi `getHomePage` utilise
// `pools.sorties` pour les TROIS appels (copier-coller resté là) au lieu du pool de CHAQUE
// dépendance.
//
// Contrat à respecter (signature inchangée) :
//
// export async function getHomePage(deps: HomePageDeps, pools: HomePagePools): Promise<HomePageResult>
//   - Isolation (module 14 §2.4, bulkhead) : CHAQUE appel prend son permis dans SON PROPRE
//     pool (`pools.sorties` pour `fetchSorties`, `pools.budget` pour `fetchBudget`,
//     `pools.notifications` pour `fetchNotifications`) — jamais un pool partagé. Une requête
//     Notifications encore en cours ne doit JAMAIS pouvoir empêcher une AUTRE requête,
//     parfaitement saine, d'obtenir un permis pour Sorties ou Budget.
//   - Le permis d'un pool DOIT être rendu dans un `finally`, TOUJOURS — même si l'appel
//     échoue (piège #8 du module : oublier de le rendre sur le chemin d'erreur vide le
//     bulkhead permis par permis jusqu'au blocage total, une panne pire que celle qu'on
//     voulait éviter).
//   - Dégradation gracieuse (module 14 §2.6) : Sorties et Budget sont CRITIQUES — si
//     `fetchSorties` ou `fetchBudget` rejette (ou si leur bulkhead est plein), `getHomePage`
//     rejette (la page entière échoue, c'est le comportement voulu, PAS un bug à corriger).
//     Notifications est NON CRITIQUE — si `fetchNotifications` rejette (ou si son bulkhead est
//     plein), `getHomePage` ne rejette PAS : `result.notifications` vaut `null` (le fallback),
//     la page s'affiche sans le badge.
//
// LE PIÈGE (le sujet réel du lab, vérifié en construisant l'oracle) : le bug n'empêche PAS la
// page de fonctionner en usage normal — un SEUL appel isolé marche très bien. Il ne se révèle
// QUE quand une requête en cours (même encore saine, juste pas encore terminée) laisse un
// permis occupé dans le pool PARTAGÉ au moment où une AUTRE requête, totalement indépendante
// et saine, en a besoin. C'est exactement le mécanisme d'amplification du module (§2.2) : un
// composant sature une ressource partagée bornée et fait tomber des requêtes qui n'ont rien
// demandé à ce composant.
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
    pool.release();
  }
}

export async function getHomePage(deps: HomePageDeps, pools: HomePagePools): Promise<HomePageResult> {
  // BUG (pool partagé, module 14 §2.2-2.4) : les TROIS appels prennent leur permis dans
  // `pools.sorties` — une requête Notifications encore en cours peut ainsi épuiser le pool
  // de Sorties/Budget et faire échouer une AUTRE requête qui n'a rien demandé à Notifications.
  const [sorties, budget, notifications] = await Promise.all([
    appelAvecPermis(pools.sorties, deps.fetchSorties),
    appelAvecPermis(pools.sorties, deps.fetchBudget),
    appelAvecPermis(pools.sorties, deps.fetchNotifications),
  ]);

  return { sorties, budget, notifications };
}
