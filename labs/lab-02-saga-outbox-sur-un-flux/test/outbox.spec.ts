// Oracle du lab 02 (Systèmes distribués). Ne pas modifier.
import { describe, expect, it, vi } from "vitest";
import {
  applyIdempotent,
  createDatabase,
  createInbox,
  createSortie,
  pollOutboxAndPublish,
  type MessageBus,
  type PublishedEvent,
} from "@lab/outbox";

function busQuiMarche(): MessageBus & { appels: PublishedEvent[] } {
  const appels: PublishedEvent[] = [];
  return {
    appels,
    publish: vi.fn(async (event: PublishedEvent) => {
      appels.push(event);
    }),
  };
}

function busEnPanne(): MessageBus {
  return { publish: vi.fn(async () => { throw new Error("broker injoignable"); }) };
}

describe("createSortie — non-régression : la sortie est TOUJOURS enregistrée", () => {
  it("écrit la sortie dans db.sorties (cas nominal)", async () => {
    const db = createDatabase();
    const bus = busQuiMarche();
    const sortie = await createSortie(db, bus, { id: "s1", famille: "Martin", titre: "Piscine" });

    expect(sortie).toEqual({ id: "s1", famille: "Martin", titre: "Piscine" });
    expect(db.sorties.get("s1")).toEqual(sortie);
  });

  it("même si le bus est EN PANNE, la sortie est enregistrée et l'appel ne throw PAS", async () => {
    const db = createDatabase();
    const bus = busEnPanne();

    await expect(createSortie(db, bus, { id: "s1", famille: "Martin", titre: "Piscine" })).resolves.toBeDefined();
    expect(db.sorties.get("s1")).toBeDefined();
  });
});

describe("createSortie — corrige le dual write : jamais de publish direct", () => {
  it("n'appelle JAMAIS bus.publish à l'intérieur de createSortie (découplage)", async () => {
    const db = createDatabase();
    const bus = busQuiMarche();
    await createSortie(db, bus, { id: "s1", famille: "Martin", titre: "Piscine" });

    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("écrit une ligne outbox non publiée, ATOMIQUEMENT avec la sortie", async () => {
    const db = createDatabase();
    const bus = busQuiMarche();
    await createSortie(db, bus, { id: "s1", famille: "Martin", titre: "Piscine" });

    const lignes = [...db.outbox.values()];
    expect(lignes).toHaveLength(1);
    expect(lignes[0].type).toBe("SortieCréée");
    expect(lignes[0].publishedAt).toBeNull();
    expect(lignes[0].payload).toEqual({ id: "s1", famille: "Martin", titre: "Piscine" });
  });
});

describe("pollOutboxAndPublish — le message relay (polling publisher)", () => {
  it("publie chaque ligne non publiée et marque publishedAt", async () => {
    const db = createDatabase();
    const busInitial = busEnPanne(); // peu importe : createSortie ne le touche jamais
    await createSortie(db, busInitial, { id: "s1", famille: "Martin", titre: "Piscine" });

    const bus = busQuiMarche();
    const nombre = await pollOutboxAndPublish(db, bus);

    expect(nombre).toBe(1);
    expect(bus.appels).toEqual([{ id: "evt-s1", type: "SortieCréée", payload: { id: "s1", famille: "Martin", titre: "Piscine" } }]);
    expect([...db.outbox.values()][0].publishedAt).not.toBeNull();
  });

  it("ne republie JAMAIS une ligne déjà publiée", async () => {
    const db = createDatabase();
    const busInitial = busQuiMarche();
    await createSortie(db, busInitial, { id: "s1", famille: "Martin", titre: "Piscine" });

    const bus = busQuiMarche();
    await pollOutboxAndPublish(db, bus);
    const secondAppel = await pollOutboxAndPublish(db, bus);

    expect(secondAppel).toBe(0);
    expect(bus.appels).toHaveLength(1);
  });

  it("préserve l'ordre de création, même si l'insertion dans la Map ne le respecte pas", async () => {
    const db = createDatabase();
    // Insertion volontairement DANS LE DÉSORDRE des createdAt (s2 créée après s1 mais insérée
    // en premier dans la Map) — la publication doit suivre createdAt, pas l'ordre d'insertion.
    db.outbox.set("evt-s2", { id: "evt-s2", type: "SortieCréée", payload: { id: "s2" }, createdAt: 200, publishedAt: null });
    db.outbox.set("evt-s1", { id: "evt-s1", type: "SortieCréée", payload: { id: "s1" }, createdAt: 100, publishedAt: null });

    const bus = busQuiMarche();
    await pollOutboxAndPublish(db, bus);

    expect(bus.appels.map((e) => e.id)).toEqual(["evt-s1", "evt-s2"]);
  });

  it("un échec de publish s'arrête là : les lignes déjà publiées le restent, rien n'est perdu", async () => {
    const db = createDatabase();
    db.outbox.set("evt-a", { id: "evt-a", type: "T", payload: {}, createdAt: 1, publishedAt: null });
    db.outbox.set("evt-b", { id: "evt-b", type: "T", payload: {}, createdAt: 2, publishedAt: null });
    db.outbox.set("evt-c", { id: "evt-c", type: "T", payload: {}, createdAt: 3, publishedAt: null });

    let appel = 0;
    const bus: MessageBus = {
      publish: vi.fn(async () => {
        appel++;
        if (appel === 2) throw new Error("broker tombé en cours de route");
      }),
    };

    await expect(pollOutboxAndPublish(db, bus)).rejects.toThrow("broker tombé en cours de route");

    expect(db.outbox.get("evt-a")!.publishedAt).not.toBeNull(); // déjà publiée avant l'échec
    expect(db.outbox.get("evt-b")!.publishedAt).toBeNull(); // celle qui a échoué
    expect(db.outbox.get("evt-c")!.publishedAt).toBeNull(); // jamais tentée

    // Un futur poll (broker revenu) republie b et c, jamais a une 2e fois.
    const busRetabli = busQuiMarche();
    const nombre = await pollOutboxAndPublish(db, busRetabli);
    expect(nombre).toBe(2);
    expect(busRetabli.appels.map((e) => e.id)).toEqual(["evt-b", "evt-c"]);
  });
});

describe("applyIdempotent — l'inbox pattern : at-least-once + idempotence = effectively-once", () => {
  it("applique le handler à la première réception d'un événement", () => {
    const inbox = createInbox();
    const handler = vi.fn();
    const applique = applyIdempotent(inbox, { id: "evt-1", payload: 42 }, handler);

    expect(applique).toBe(true);
    expect(handler).toHaveBeenCalledWith(42);
  });

  it("N'applique PAS deux fois le même événement (dédup par id)", () => {
    const inbox = createInbox();
    const handler = vi.fn();

    applyIdempotent(inbox, { id: "evt-1", payload: 42 }, handler);
    const secondeApplication = applyIdempotent(inbox, { id: "evt-1", payload: 42 }, handler);

    expect(secondeApplication).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("un événement DIFFÉRENT est bien appliqué (dédup par id, pas un verrou global)", () => {
    const inbox = createInbox();
    const handler = vi.fn();

    applyIdempotent(inbox, { id: "evt-1", payload: "a" }, handler);
    applyIdempotent(inbox, { id: "evt-2", payload: "b" }, handler);

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("Intégration — le geste complet : l'événement ne se perd JAMAIS, même sur panne au pire moment", () => {
  it("broker en panne à la création, puis rétabli : l'événement est récupéré et appliqué UNE fois côté consommateur", async () => {
    const db = createDatabase();

    // 1) Le broker est en panne pile au moment de la création — le bug d'origine perdait
    //    l'événement ici, pour toujours.
    const busEnPannePourCreation = busEnPanne();
    const sortie = await createSortie(db, busEnPannePourCreation, { id: "s1", famille: "Martin", titre: "Piscine" });
    expect(db.sorties.get("s1")).toEqual(sortie);

    // 2) Le broker revient : un poll récupère l'événement, jamais perdu.
    const busRetabli = busQuiMarche();
    const nombrePublie = await pollOutboxAndPublish(db, busRetabli);
    expect(nombrePublie).toBe(1);

    // 3) Côté Budget : le consommateur applique l'événement — même s'il arrive deux fois
    //    (redelivery at-least-once), l'effet métier (réserver les places) n'a lieu qu'une fois.
    const inbox = createInbox();
    const reserverLesPlaces = vi.fn();
    const evenement = busRetabli.appels[0];

    applyIdempotent(inbox, evenement, reserverLesPlaces);
    applyIdempotent(inbox, evenement, reserverLesPlaces); // redelivery

    expect(reserverLesPlaces).toHaveBeenCalledTimes(1);
  });
});
