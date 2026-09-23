// outbox.ts — L'EXISTANT, EN PRODUCTION (module 13). Quand une sortie est créée, l'événement
// `SortieCréée` doit atteindre Budget et Notifications SANS JAMAIS être perdu. `createSortie`
// COMPILE et MARCHE dans le cas nominal (la sortie est bien enregistrée, l'événement bien
// publié) — le bug ne se voit que quand `bus.publish` échoue (broker injoignable, un crash
// entre les deux écritures) : la sortie existe déjà en base, mais l'événement est perdu à
// jamais, personne ne réserve les places, personne n'est notifié. La saga est cassée en
// silence — c'est le "dual write problem" (module 13 §2.1).
//
// `createDatabase()` et `createInbox()` sont DONNÉS et déjà corrects (de simples fabriques).
//
// AVANT de corriger : ouvre CE fichier ET comprends le bug dans `createSortie` (deux écritures
// séparées : la base ET le bus, jamais atomiques).
//
// Contrat à respecter (signatures inchangées) :
//
// export async function createSortie(db: Database, bus: MessageBus, input: { id, famille, titre }): Promise<Sortie>
//   - Doit rester non-régressif : `db.sorties` contient toujours la sortie après l'appel.
//   - Doit corriger le bug (module 13 §2.2, transactional outbox) : n'appelle JAMAIS `bus`
//     directement. Écrit ATOMIQUEMENT (dans ce store en mémoire : les deux `Map.set` d'affilée,
//     rien entre les deux qui puisse échouer) la sortie ET une ligne dans `db.outbox`
//     (`publishedAt: null`). La publication réelle est un problème SÉPARÉ (voir
//     `pollOutboxAndPublish`) — c'est précisément ce découplage qui rend `createSortie`
//     increvable face à un `bus` en panne.
//
// export async function pollOutboxAndPublish(db: Database, bus: MessageBus): Promise<number>
//   - Le "message relay" (module 13 §2.3, polling publisher) : lit les lignes `db.outbox` NON
//     publiées (`publishedAt === null`), triées par `createdAt` croissant (préserve l'ordre),
//     publie chacune via `bus.publish`, puis marque `publishedAt` (horodatage) SEULEMENT après
//     un `publish` réussi. Retourne le nombre de lignes publiées.
//   - Si `bus.publish` rejette sur une ligne : la fonction s'arrête là (l'erreur remonte), les
//     lignes déjà publiées avant restent publiées, celle qui a échoué et les suivantes restent
//     `publishedAt: null` — un futur appel les republiera (at-least-once, jamais perdu).
//
// export function applyIdempotent<T>(inbox: Inbox, event: { id: string; payload: T }, handler: (payload: T) => void): boolean
//   - Le pendant côté consommateur (module 13 : inbox pattern) : l'outbox garantit
//     at-least-once, JAMAIS exactly-once — un événement peut arriver deux fois. Si
//     `event.id` est déjà dans `inbox.processedEventIds`, NE PAS rappeler `handler` (retourne
//     `false`). Sinon, appelle `handler(event.payload)`, mémorise `event.id`, retourne `true`.
//
// LE PIÈGE (le sujet réel du lab, vérifié en construisant l'oracle) : le bug n'est PAS que
// `createSortie` throw ou que la sortie ne soit pas enregistrée — les DEUX marchent très bien
// en usage normal. Le bug est invisible à l'usage normal et ne se révèle QUE quand `bus`
// tombe en panne au mauvais moment (exactement comme la fuite mémoire du cours JS Runtime,
// invisible sur une seule instance). C'est pour ça qu'un test qui vérifie juste "la sortie
// est créée" ne suffit PAS — il faut un test qui fait échouer `bus.publish` et vérifie que
// l'événement n'est JAMAIS perdu pour de bon.
export interface Sortie {
  id: string;
  famille: string;
  titre: string;
}

export interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
  publishedAt: number | null;
}

export interface Database {
  sorties: Map<string, Sortie>;
  outbox: Map<string, OutboxRow>;
}

export function createDatabase(): Database {
  return { sorties: new Map(), outbox: new Map() };
}

export interface PublishedEvent {
  id: string;
  type: string;
  payload: unknown;
}

export interface MessageBus {
  publish(event: PublishedEvent): Promise<void>;
}

export interface Inbox {
  processedEventIds: Set<string>;
}

export function createInbox(): Inbox {
  return { processedEventIds: new Set() };
}

export async function createSortie(
  db: Database,
  bus: MessageBus,
  input: { id: string; famille: string; titre: string },
): Promise<Sortie> {
  const sortie: Sortie = { id: input.id, famille: input.famille, titre: input.titre };
  db.sorties.set(sortie.id, sortie); // "commit" métier — fonctionne, ce n'est PAS le bug

  // BUG (dual write, module 13 §2.1) : publication DIRECTE, hors transaction. Si ceci
  // rejette (broker injoignable, crash), la sortie existe déjà en base mais l'événement
  // n'est écrit NULLE PART ailleurs — il est perdu à jamais, aucun moyen de le rejouer.
  await bus.publish({ id: `evt-${sortie.id}`, type: "SortieCréée", payload: sortie });

  return sortie;
}

export async function pollOutboxAndPublish(_db: Database, _bus: MessageBus): Promise<number> {
  throw new Error("pollOutboxAndPublish n'est pas encore implémenté");
}

export function applyIdempotent<T>(
  _inbox: Inbox,
  _event: { id: string; payload: T },
  _handler: (payload: T) => void,
): boolean {
  throw new Error("applyIdempotent n'est pas encore implémenté");
}
