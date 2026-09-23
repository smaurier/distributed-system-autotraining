// outbox.ts — SOLUTION DE RÉFÉRENCE (commentée). Ne l'ouvre pas avant ton GREEN.
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
  _bus: MessageBus,
  input: { id: string; famille: string; titre: string },
): Promise<Sortie> {
  const sortie: Sortie = { id: input.id, famille: input.famille, titre: input.titre };
  const ligneOutbox: OutboxRow = {
    id: `evt-${sortie.id}`,
    type: "SortieCréée",
    payload: sortie,
    createdAt: Date.now(),
    publishedAt: null,
  };

  // Les DEUX écritures "dans une seule transaction locale" (module 13 §2.2) : ce store en
  // mémoire simule l'atomicité d'une vraie transaction DB — rien d'externe (réseau, broker)
  // ne peut s'intercaler entre ces deux lignes. `bus` n'est JAMAIS appelé ici : la publication
  // est un problème séparé, géré par `pollOutboxAndPublish`.
  db.sorties.set(sortie.id, sortie);
  db.outbox.set(ligneOutbox.id, ligneOutbox);

  return sortie;
}

export async function pollOutboxAndPublish(db: Database, bus: MessageBus): Promise<number> {
  const lignesEnAttente = [...db.outbox.values()]
    .filter((ligne) => ligne.publishedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt); // préserve l'ordre de création (module 13 §2.5)

  let nombrePublie = 0;
  for (const ligne of lignesEnAttente) {
    // Si `bus.publish` rejette ici, l'erreur remonte et la boucle s'arrête : les lignes
    // publiées avant restent publiées, celle-ci et les suivantes restent `publishedAt: null`
    // pour un futur appel — at-least-once, jamais perdu.
    await bus.publish({ id: ligne.id, type: ligne.type, payload: ligne.payload });
    ligne.publishedAt = Date.now(); // marquer publiée SEULEMENT après un publish réussi
    nombrePublie++;
  }
  return nombrePublie;
}

export function applyIdempotent<T>(inbox: Inbox, event: { id: string; payload: T }, handler: (payload: T) => void): boolean {
  // At-least-once + idempotence = effectively-once (module 13 §2.4/2.9 et module 08 §2.9).
  if (inbox.processedEventIds.has(event.id)) return false;

  handler(event.payload);
  inbox.processedEventIds.add(event.id);
  return true;
}
