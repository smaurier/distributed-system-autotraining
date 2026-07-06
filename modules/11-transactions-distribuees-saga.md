---
titre: Transactions distribuées & saga
cours: 17-distributed-systems
notions: ["pourquoi pas de transaction ACID distribuée simple", "transaction locale vs distribuée", "2PC (two-phase commit)", "phase prepare / phase commit", "coordinateur & write-ahead log", "blocking problem du 2PC", "saga (Garcia-Molina 1987)", "transaction locale + compensation", "orchestration vs chorégraphie", "transaction compensatoire (rollback sémantique)", "action non-compensable", "backward vs forward recovery", "compensatable / pivot / retriable", "absence d'isolation (ACD sans I)", "anomalies : lost update / dirty read / fuzzy read", "semantic lock", "commutative updates", "pessimistic view", "reread value", "cohérence éventuelle assumée"]
outcomes:
  - "sait expliquer pourquoi une transaction ACID unique ne traverse pas plusieurs services et pourquoi les locks ne franchissent pas le réseau"
  - "sait décrire le 2PC (prepare/commit, coordinateur, WAL) et démontrer le blocking problem quand le coordinateur crashe entre les deux phases"
  - "sait implémenter une saga en orchestration et en chorégraphie et choisir entre les deux"
  - "sait concevoir une transaction compensatoire comme un rollback sémantique et reconnaître une action non-compensable"
  - "sait structurer une saga en transactions compensatables / pivot / retriables"
  - "sait nommer les trois anomalies dues à l'absence d'isolation (lost update, dirty read, fuzzy read) et appliquer un semantic lock comme contre-mesure"
  - "sait décider quand accepter la cohérence éventuelle plutôt que forcer une atomicité distribuée"
prerequis: ["Module 05 — communication asynchrone, garanties de livraison, DLQ", "Module 06 — event-driven architecture (événement vs commande)", "Module 08 — retries, timeouts, idempotency key", "Module 09 — cohérence & théorème CAP", "Module 10 — réplication & partitionnement"]
next: 12-cqrs-event-sourcing
libs: []
tribuzen: "backend TribuZen — créer une sortie est une opération multi-services (Sorties + Budget/Réservation + Notifications) sans base commune ; une saga orchestrée avec compensations garantit qu'on ne laisse jamais une place réservée pour une sortie annulée"
last-reviewed: 2026-07
---

# Transactions distribuées & saga

> **Outcomes — tu sauras FAIRE :** expliquer pourquoi une transaction ACID ne traverse pas plusieurs services, décrire le 2PC et son blocking problem, implémenter une saga en orchestration et en chorégraphie, concevoir des compensations sémantiques, structurer une saga en compensatable/pivot/retriable, nommer les anomalies d'isolation et les corriger par un semantic lock, décider quand accepter la cohérence éventuelle.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes** des transactions qui traversent plusieurs services : pourquoi l'ACID distribué « simple » n'existe pas, comment le **2PC** essaie (et pourquoi il **bloque**), et comment la **saga** échange l'atomicité contre la disponibilité au prix de l'**isolation**. On va **plus profond** que le niveau design : **compensation sémantique**, structure **compensatable/pivot/retriable**, **anomalies** d'isolation et **semantic lock**. On **ne** couvre **pas** ici : la **décision d'architecture** « saga vs autre chose » et le cadrage CQRS/ES → **cours 13-architecture, module 18** ; la publication fiable d'un événement depuis une transaction DB (dual-write, **outbox**) → **module 13 (ce cours)** ; les **retries/backoff/idempotency key** génériques → **module 08** ; les **garanties de livraison** du broker qui transporte les commandes de saga → **module 05**. Ici : le mécanisme transactionnel et ses garanties réelles.

## 1. Cas concret d'abord

Dans TribuZen, un parent crée une **sortie** payante à places limitées (« Accrobranche samedi, 12 places, 8 €/enfant »). L'opération n'est **pas** locale : elle traverse **trois services**, chacun avec **sa propre base de données** :

- **Sorties** — enregistre la sortie.
- **Budget/Réservation** — réserve les places et débite le budget commun de la famille.
- **Notifications** — prévient les autres parents.

Tu voudrais écrire ça comme une transaction unique, « tout ou rien » :

```ts
// createSortie — CE QU'ON VOUDRAIT ÉCRIRE (et qui n'existe PAS en distribué)
async createSortie(input: CreateSortieInput): Promise<Sortie> {
  // ❌ Il n'y a AUCUN "BEGIN TRANSACTION" qui engloberait trois bases distinctes.
  const sortie = await sortiesService.save(input);          // DB 1
  await budgetService.reservePlacesEtDebite(sortie);        // DB 2  ← et si ça throw ?
  await notificationsService.notifier(sortie);              // DB 3
  return sortie;
}
```

Le problème surgit dès qu'une étape **échoue au milieu** : le budget de la famille est dépassé, `reservePlacesEtDebite` lève une erreur. Mais la sortie est **déjà commitée** en DB 1 — le `save` a fait son propre commit local. Résultat : une sortie « fantôme », affichée aux parents, sans places ni budget. Personne ne rollback la DB 1 : **son commit local est déjà parti**, et un `BEGIN … COMMIT` ne peut pas englober trois bases qui ne partagent ni connexion, ni verrous, ni journal.

Deux réponses existent. La première, le **2PC**, tente de rétablir l'atomicité en coordonnant un commit global — mais paie ça par du **blocage**. La seconde, la **saga**, abandonne l'atomicité stricte : elle enchaîne des transactions locales et, en cas d'échec, **annule sémantiquement** les précédentes (libérer les places, recréditer le budget). Ce module te donne les deux mécanismes, leurs garanties exactes, et le prix caché de la saga : **elle n'a pas d'isolation**, donc elle expose des anomalies qu'aucune base ne te montrait jusqu'ici.

---

## 2. Théorie complète, concise

### 2.1 Pourquoi pas de transaction ACID distribuée « simple »

Une transaction **locale** (une seule base) te donne l'**ACID** gratuitement : **A**tomicité (tout ou rien), **C**ohérence, **I**solation (les transactions concurrentes ne se voient pas à mi-chemin), **D**urabilité. Le moteur de la base y arrive parce qu'il contrôle **une** connexion, **un** journal (WAL), **un** gestionnaire de verrous.

En microservices, chaque service possède **sa** base (règle du *database-per-service*, vue au module 02). Il n'existe donc **aucun** point qui puisse :
- ouvrir un `BEGIN` commun aux trois bases ;
- tenir des **verrous** sur les trois pendant toute l'opération ;
- décider un `COMMIT`/`ROLLBACK` **atomique** sur les trois.

Les verrous d'une base **ne franchissent pas le réseau**, et un commit local est **définitif** dès qu'il est fait. On ne peut donc pas « simplement » étendre l'ACID à N services. Il faut soit un **protocole de commit distribué** (2PC — §2.2), soit **renoncer** à l'atomicité stricte (saga — §2.4).

### 2.2 Two-Phase Commit (2PC)

Le **2PC** rétablit l'atomicité via un **coordinateur** qui pilote un vote en **deux phases**.

**Phase 1 — PREPARE (le vote).** Le coordinateur demande à chaque participant : « peux-tu commiter ? ». Chaque participant fait le travail *jusqu'au bord du commit* et **acquiert ses verrous**. Fowler : *« each node participating in the transaction acquires whatever it needs to assure that it will be able to do the commit in the second phase — for example, any locks that are required. »* Il répond **YES** (je promets de pouvoir commiter) ou **NO**.

**Phase 2 — COMMIT (ou ABORT).** Si **tous** ont voté YES, le coordinateur envoie **COMMIT** à tous ; il est alors attendu que *« they will all successfully update »*. Si **un seul** a voté NO (ou n'a pas répondu), le coordinateur envoie **ABORT** : chacun *« roll back, releasing any locks they have »*.

```
Phase 1 PREPARE                    Phase 2 COMMIT
Coord ──PREPARE──▶ P1  P2  P3      Coord ──COMMIT──▶ P1  P2  P3
Coord ◀──YES───── P1               Coord ◀──ACK──── (verrous relâchés)
Coord ◀──YES───── P2               si un seul NO en phase 1 → ABORT partout
Coord ◀──YES───── P3
(tous YES → GO)
```

**Durabilité obligatoire.** Coordinateur et participants **journalisent** leur décision avant de l'annoncer : *« each participant [must] ensure the durability of their decisions using [a] pattern like Write-Ahead Log »*. C'est ce qui permet de reprendre le protocole après un crash + redémarrage : au reboot, on relit le WAL et on sait où on en était.

### 2.3 Les limites du 2PC — le *blocking problem*

Le 2PC est **atomique**, mais son défaut est structurel : il **bloque**.

**Le blocking problem.** Entre la phase 1 et la phase 2, chaque participant a voté YES et **tient ses verrous**, en attendant l'ordre du coordinateur. Si le **coordinateur crashe** juste là, les participants sont **coincés** : ils ont promis de commiter, ils **ne peuvent pas** décider seuls (un autre a peut-être voté NO), et ils **gardent les verrous**. Tant que le coordinateur n'est pas revenu, les données verrouillées sont **inaccessibles** aux autres transactions.

```
Coord ──PREPARE──▶ P1, P2         P1, P2 ont voté YES,
Coord ◀──YES──────                verrous PRIS.
   ✗ (coordinateur crash)
                                  P1, P2 : COMMIT ? ABORT ?
                                  → impossible de décider seuls
                                  → BLOQUÉS, verrous tenus indéfiniment
```

Les autres griefs découlent de là :
- **Single Point of Failure** : la disponibilité de l'opération dépend d'**un** coordinateur.
- **Latence** : minimum deux allers-retours réseau synchrones, verrous tenus pendant tout ce temps → **débit** effondré sous contention.
- **Couplage temporel fort** : **tous** les participants doivent être joignables **en même temps**.
- **Lecture CAP** (module 09) : le 2PC choisit **C** (cohérence) au détriment de **A** (disponibilité) — sous partition réseau, il **bloque** au lieu de répondre.

C'est pourquoi le 2PC est rare entre microservices autonomes (il réapparaît surtout dans des transactions XA legacy ou intra-datacenter très contrôlées). Pour des services indépendants et disponibles, on préfère la **saga**.

### 2.4 La saga — séquence de transactions locales + compensations

La **saga** (Hector Garcia-Molina & Kenneth Salem, 1987) abandonne l'atomicité globale. Définition de référence (microservices.io) : *« A saga is a sequence of local transactions. Each local transaction updates the database and publishes a message or event to trigger the next local transaction in the saga. »*

Chaque étape `Tᵢ` **commite localement** (donc devient visible tout de suite) et déclenche la suivante. En cas d'échec : *« If a local transaction fails because it violates a business rule then the saga executes a series of compensating transactions that undo the changes that were made by the preceding local transactions. »*

```
Succès :   T1 ─▶ T2 ─▶ T3 ─▶ T4         (chaque Tᵢ commite localement)

Échec T3 : T1 ─▶ T2 ─▶ T3 ✗
                 ◀── C2 ◀── C1           (compensations, ordre INVERSE)
           Cᵢ = compensation sémantique de Tᵢ
```

Différence fondamentale avec le 2PC : la saga ne tient **aucun verrou distribué**. Chaque `Tᵢ` prend et relâche ses verrous **localement, immédiatement**. On gagne la disponibilité et le découplage… et on **perd l'isolation** (§2.8) : entre `T2` commitée et sa compensation `C2`, le monde **voit** l'état intermédiaire.

### 2.5 Orchestration vs chorégraphie

Deux façons de **coordonner** les étapes.

**Chorégraphie — décentralisée, par événements.** *« Each local transaction publishes domain events that trigger local transactions in other services. »* Aucun chef d'orchestre : chaque service **écoute** les événements qui le concernent et **réagit**. Le service Sorties publie `SortieCréée` → Budget réagit et publie `PlacesRéservées` → Notifications réagit. En cas d'échec, l'événement d'échec (`BudgetDépassé`) déclenche les compensations en cascade.

**Orchestration — centralisée, par commandes.** *« An orchestrator (object) tells the participants what local transactions to execute. »* Un **orchestrateur** (une machine à états) envoie des **commandes** explicites (`RéservePlaces`), attend la réponse, décide de l'étape suivante, et **pilote lui-même** les compensations si une étape échoue.

```
CHORÉGRAPHIE (événements)              ORCHESTRATION (commandes)
Sorties ─SortieCréée─▶ Budget          ┌── Orchestrateur (state machine) ──┐
Budget ─PlacesRéservées─▶ Notifs       │  cmd RéservePlaces ─▶ Budget      │
(chaque service connaît la suite)      │  cmd Notifie       ─▶ Notifs      │
pas de point central                   │  échec → pilote C2, C1            │
```

| Critère | Chorégraphie | Orchestration |
|---|---|---|
| Couplage | Faible (événements) | Moyen (l'orchestrateur connaît le flux) |
| Logique du flux | **Dispersée** dans N services | **Centralisée**, lisible d'un coup |
| Débogage / visibilité | Dur (suivre une cascade d'événements) | Facile (un état de saga interrogeable) |
| Point de défaillance | Aucun central | L'orchestrateur (à rendre résilient) |
| Dépendances cycliques | Risque élevé (A écoute B qui écoute A) | Évitées (flux linéaire piloté) |
| Bon pour | Sagas courtes (2-3 étapes) | Sagas longues / avec branches |

Règle : **chorégraphie** pour une saga courte et stable ; **orchestration** dès que le flux dépasse 3 étapes, comporte des branches, ou doit être **auditable**. TribuZen (Sorties → Budget → Notifications, avec compensations) est un cas d'**orchestration**.

### 2.6 La compensation est un rollback **sémantique**, pas technique

Une compensation `Cᵢ` **n'est pas** un `ROLLBACK` SQL : la transaction `Tᵢ` est **déjà commitée**, il n'y a plus rien à défaire techniquement. `Cᵢ` est une **nouvelle transaction métier** qui **annule l'effet** de `Tᵢ` :

| Étape `Tᵢ` | Compensation `Cᵢ` |
|---|---|
| Débiter le budget famille | Recréditer le budget |
| Réserver 4 places | Libérer 4 places |
| Créer la facture | Émettre un avoir (credit note) |
| Envoyer un email de confirmation | Envoyer un email d'annulation |

Deux conséquences dures :

- **Certaines actions sont non-compensables.** Un email envoyé ne se « désenvoie » pas ; un versement bancaire irréversible ne s'annule pas. La parade est une **action correctrice** (email d'annulation, geste commercial), pas une annulation pure. **Conception :** place les étapes **non-compensables le plus tard possible** dans la saga (§2.7).
- **Backward recovery vs forward recovery.** *Backward* = annuler ce qui est fait (compensations, l'échec ramène à l'état initial). *Forward* = **avancer coûte que coûte** en **retentant** l'étape qui a échoué jusqu'à ce qu'elle passe (utile quand l'étape *doit* réussir et **ne peut pas** être compensée). Une vraie saga combine les deux : compensable avant le point de non-retour, retry-forward après.

### 2.7 Structurer la saga : compensatable / pivot / retriable

Pour maîtriser le point de non-retour, on classe les étapes en **trois** catégories (Richardson, *Microservices Patterns*, ch. 4) :

- **Transactions compensatables** — celles **avant** le pivot ; chacune a une compensation `Cᵢ` capable d'annuler son effet. (Réserver les places, débiter le budget : compensables.)
- **Transaction pivot** — le **point de non-retour** (go/no-go). Elle n'est **ni** compensatable **ni** retriable : **si le pivot commite, la saga ira jusqu'au bout** ; s'il échoue, on compense tout ce qui précède. Le pivot peut être la **dernière** étape compensatable ou la **première** retriable.
- **Transactions retriables** — celles **après** le pivot ; elles **ne peuvent plus** violer de règle métier et sont **garanties d'aboutir** (au besoin par retry-forward). (Envoyer la notification : retriable — on la **retente**, on ne compense pas la sortie déjà validée.)

```
[ T1 compensatable ][ T2 compensatable ][ PIVOT ][ T3 retriable ][ T4 retriable ]
        │ C1                │ C2          go/no-go   retry-forward   retry-forward
        └──── backward recovery si échec AVANT pivot ────┘   └─ forward après ─┘
```

Cette structure te dit **où** placer l'action risquée (débit budget = pivot) et **quoi faire** à chaque échec : avant le pivot → **compenser** ; après → **retenter**.

### 2.8 Le prix caché : absence d'isolation (ACD sans I)

Une saga te rend **A**, **C**, **D**… mais **pas l'I**. microservices.io : *« Lack of isolation (the 'I' in ACID) — the lack of isolation means that there's risk that the concurrent execution of multiple sagas and transactions can [cause] data anomalies. »* Cause racine : chaque `Tᵢ` **commite localement avant** que la saga entière soit finie → ses résultats intermédiaires sont **visibles** aux autres sagas pendant la fenêtre `Tᵢ … Cᵢ`.

Trois **anomalies** classiques (les mêmes qu'une base sans isolation, mais ici tu dois les gérer **toi-même**) :

- **Lost update (mise à jour perdue)** — une saga écrase une modification faite par une autre saga qu'elle n'a pas « vue ». *Ex TribuZen :* deux parents créent en parallèle deux sorties payantes ; chacun lit « budget = 100 € », chacun débite ; l'un des deux débits est perdu → budget faux.
- **Dirty read (lecture sale)** — une saga lit un état **intermédiaire** qu'une autre saga va **compenser**. *Ex :* la saga A a réservé 4 places (pas encore validée) ; un parent B affiche « 4 places prises » et renonce à inscrire ses enfants ; puis A échoue au pivot et **libère** les 4 places → B a décidé sur une donnée qui n'a jamais existé durablement.
- **Fuzzy / non-repeatable read (lecture non répétable)** — dans **la même** saga, on lit deux fois la même donnée et on obtient **deux valeurs différentes**, car une autre saga a commité entre les deux lectures.

### 2.9 Contre-mesures — dont le **semantic lock**

On ne rétablit pas l'isolation gratuitement ; on la **simule** au niveau applicatif via des **contre-mesures** (Richardson) :

- **Semantic lock (verrou sémantique applicatif)** — la contre-mesure phare. Une `Tᵢ` compensatable pose un **marqueur d'état « en cours »** (`*_PENDING`) sur la ressource, au lieu de la marquer directement « final ». Ce drapeau **signale** aux autres sagas que la donnée est **provisoire** : elles peuvent l'ignorer, attendre, ou échouer proprement. La transaction finale (ou la compensation) **lève** le verrou (`CONFIRMED` / annulé). *Ex TribuZen :* réserver 4 places les met en `RESERVE_PENDING` ; l'UI d'un autre parent **ne les compte pas** comme définitivement prises ; le pivot les passe en `RESERVE_CONFIRMED`, la compensation les repasse à `LIBRE`.
- **Commutative updates (mises à jour commutatives)** — concevoir les updates pour que l'**ordre n'importe pas** : `créditer(+8)` / `débiter(−8)` commutent, donc rejouer/compenser dans le désordre reste correct → **élimine les lost updates**. Bien plus sûr que `SET solde = 92`.
- **Pessimistic view (vue pessimiste)** — **réordonner** les étapes pour **minimiser** l'exposition aux dirty reads (faire le plus tard possible ce qui, lu trop tôt, tromperait un autre acteur).
- **Reread value (relire la valeur)** — avant d'écrire, **relire** la donnée et vérifier qu'elle **n'a pas changé** depuis la lecture initiale (optimistic offline lock) → détecte et évite les **lost updates**.
- **By value** — **choisir la stratégie selon le risque métier** de chaque requête : requêtes à faible enjeu → saga (cohérence éventuelle) ; requêtes à fort enjeu (argent réel important) → mécanisme plus strict (voire 2PC/transaction locale regroupée). On ne paie l'isolation que là où elle compte.

### 2.10 Quand accepter la cohérence éventuelle

Une saga te met en **cohérence éventuelle** : il existe une **fenêtre** (`Tᵢ … Cᵢ`) où le système est **globalement incohérent** (places réservées pour une sortie qui va être annulée), puis il **converge**. Tu l'acceptes quand :

- l'opération est **multi-services** et l'atomicité stricte coûterait la **disponibilité** (blocage 2PC) ;
- la **fenêtre d'incohérence** est **courte** et **bornée** (secondes), et l'anomalie possible est **tolérable** métier (une notification légèrement en retard, une place « pending » brièvement affichée) ;
- tu peux **maquiller** l'intermédiaire avec un **semantic lock** (afficher « réservation en cours » plutôt qu'un état faux).

Tu la **refuses** (et tu regroupes plutôt les données dans **un seul** service/base, ou tu utilises une transaction locale) quand l'anomalie serait **inacceptable** : mouvement d'argent réel irréversible, contrainte d'unicité critique, conformité légale. La **décision d'architecture** entre ces options relève du **cours 13-architecture, module 18** ; ici tu as le mécanisme et ses garanties pour l'alimenter.

---

## 3. Worked examples

### Exemple 1 — La saga orchestrée `createSortie` (TribuZen), de bout en bout

But : transformer le pseudo-« tout ou rien » du §1 en une **saga orchestrée** avec compensations, structure compensatable/pivot/retriable, et **semantic lock**.

**Étape 1 — classer les étapes.**

| Étape | Catégorie | Compensation |
|---|---|---|
| `T1` créer la sortie (statut `PENDING`) | compensatable | `C1` marquer la sortie `ANNULÉE` |
| `T2` réserver 4 places (`RESERVE_PENDING`) | compensatable | `C2` libérer les places |
| `T3` **débiter le budget famille** | **pivot** (argent engagé) | `C3` recréditer le budget |
| `T4` confirmer la sortie + notifier | retriable | — (on retente, on ne compense pas) |

> Ici le **pivot** est le débit budget : tant qu'il n'a pas commité, tout est annulable proprement ; une fois débité, on **avance** (retry-forward sur la notification).

**Étape 2 — l'orchestrateur.** Une machine à états qui exécute les étapes et, en cas d'échec **avant** le pivot, **compense en ordre inverse**.

```ts
// saga.types.ts
interface SagaStep {
  name: string;
  execute: (ctx: SagaContext) => Promise<void>;   // throw = échec de l'étape
  compensate?: (ctx: SagaContext) => Promise<void>; // absent = étape retriable
}
interface SagaContext {
  sagaId: string;
  data: Record<string, unknown>;
}

// orchestrator.ts
class SagaOrchestrator {
  constructor(private readonly steps: SagaStep[]) {}

  async run(ctx: SagaContext): Promise<{ ok: boolean }> {
    const done: SagaStep[] = []; // étapes réussies, à compenser si besoin
    for (const step of this.steps) {
      try {
        await step.execute(ctx);
        done.push(step);
      } catch (err) {
        // Échec : on compense les étapes déjà faites, en ORDRE INVERSE.
        for (const s of done.reverse()) {
          if (!s.compensate) continue; // retriable : rien à compenser
          try {
            await s.compensate(ctx);
          } catch (compErr) {
            // Compensation qui échoue = incident : on l'isole (DLQ, module 05) + alerte.
            await deadLetter.add({ sagaId: ctx.sagaId, step: s.name, compErr });
          }
        }
        return { ok: false };
      }
    }
    return { ok: true };
  }
}
```

**Étape 3 — les étapes TribuZen, avec semantic lock et compensations sémantiques.**

```ts
// createSortie.saga.ts
const steps: SagaStep[] = [
  {
    name: 'creerSortie',
    execute: async (ctx) => {
      const sortie = await sortiesService.create({ ...ctx.data, statut: 'PENDING' });
      ctx.data.sortieId = sortie.id;
    },
    compensate: async (ctx) => {
      // Rollback SÉMANTIQUE : la ligne est déjà commitée, on la marque annulée.
      await sortiesService.markCancelled(ctx.data.sortieId as string);
    },
  },
  {
    name: 'reserverPlaces',
    execute: async (ctx) => {
      // SEMANTIC LOCK : places posées en RESERVE_PENDING, pas encore définitives.
      // L'UI d'un autre parent NE les compte PAS comme prises tant que non confirmées.
      await reservationService.hold({
        sortieId: ctx.data.sortieId as string,
        places: 4,
        state: 'RESERVE_PENDING',
      });
    },
    compensate: async (ctx) => {
      await reservationService.release(ctx.data.sortieId as string); // libère les places
    },
  },
  {
    name: 'debiterBudget', // ← PIVOT : point de non-retour
    execute: async (ctx) => {
      // Update COMMUTATIF (débit relatif), pas "SET solde = X" → pas de lost update.
      await budgetService.debit({ familyId: ctx.data.familyId as string, amount: 32 });
    },
    compensate: async (ctx) => {
      await budgetService.credit({ familyId: ctx.data.familyId as string, amount: 32 });
    },
  },
  {
    name: 'confirmerEtNotifier', // ← RETRIABLE : après le pivot, on RETENTE, on ne compense pas
    execute: async (ctx) => {
      await reservationService.confirm(ctx.data.sortieId as string); // RESERVE_PENDING → CONFIRMED
      await sortiesService.markConfirmed(ctx.data.sortieId as string);
      await notificationsService.notifyFamily(ctx.data.sortieId as string); // via queue (module 05)
    },
    // pas de compensate : cette étape doit aboutir (retry-forward géré par la queue)
  },
];

// Point d'entrée
async function createSortie(input: CreateSortieInput): Promise<{ ok: boolean }> {
  const ctx: SagaContext = { sagaId: randomUUID(), data: { ...input } };
  return new SagaOrchestrator(steps).run(ctx);
}
```

**Ce que ce design achète :** plus jamais de sortie « fantôme » (échec avant pivot → tout est compensé) ; aucune place bloquée pour une sortie annulée (`C2` libère) ; budget correct (débit commutatif + `C3` recrédite) ; pas de dirty read exploité (le semantic lock affiche « en cours » et non « pris »). **Reste à assumer :** une **fenêtre** de cohérence éventuelle de quelques secondes entre `T2` et `confirmerEtNotifier`, et le fait que la notification est en **retry-forward** (elle *doit* partir, on ne revient pas en arrière une fois le budget engagé).

### Exemple 2 — Une anomalie d'isolation concrète, et sa correction

**Le bug (dirty read).** Deux sagas concurrentes sur la même sortie « 12 places » :

```
t0  Saga A : reserverPlaces(8)  → RESERVE (état intermédiaire, PAS de semantic lock)
t1  Saga B : lit "places libres = 4"  → propose à un parent : "plus que 4 places !"
t2  parent B renonce (trop peu de places pour ses 3 enfants)
t3  Saga A : échoue au pivot (budget dépassé) → C2 libère les 8 places
t4  état réel : 12 places libres. Mais B a décidé sur "4 libres" — une valeur FANTÔME.
```

B a lu un état que A a ensuite **annulé** : c'est un **dirty read**. Aucune base ne l'a signalé, parce qu'il n'y a **pas** d'isolation à cheval sur deux services.

**La correction (semantic lock + reread).** On rend l'état intermédiaire **explicitement provisoire**, et on relit avant de décider :

```ts
// reservationService — hold pose un verrou sémantique visible
async function hold(sortieId: string, places: number): Promise<void> {
  await db.reservations.insert({ sortieId, places, state: 'RESERVE_PENDING' }); // ← marqueur
}

// Côté lecture (Saga B / UI) : on DISTINGUE le pending du confirmé.
async function placesRéellementLibres(sortieId: string): Promise<number> {
  const total = 12;
  const confirmées = await db.reservations.sum({ sortieId, state: 'RESERVE_CONFIRMED' });
  const pending    = await db.reservations.sum({ sortieId, state: 'RESERVE_PENDING' });
  // On AFFICHE le pending à part ("2 en cours de réservation") au lieu de le compter
  // comme définitivement pris → B ne décide plus sur une donnée qui peut disparaître.
  return total - confirmées; // le pending n'est PAS soustrait comme s'il était acquis
}

// Avant d'écrire une décision critique : RE-READ + vérif d'invariance (anti lost update).
async function confirmIfStillFree(sortieId: string, places: number): Promise<boolean> {
  const libres = await placesRéellementLibres(sortieId); // relecture juste avant l'écriture
  if (libres < places) return false;                     // l'état a changé → on renonce
  await reservationService.confirm(sortieId);
  return true;
}
```

**Pourquoi c'est correct :** le `RESERVE_PENDING` est un **semantic lock** — il rend l'état provisoire **lisible** au lieu de le maquiller en état final ; le `confirmIfStillFree` **relit** juste avant d'écrire (contre-mesure *reread value*) et évite qu'une décision prise sur une vieille lecture ne cause un **lost update**. On n'a pas rétabli l'isolation vraie (impossible en distribué), on l'a **simulée** au bon endroit.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un `BEGIN … COMMIT` peut englober plusieurs services

« J'ouvre une transaction et je commite à la fin. » Impossible dès qu'il y a **deux bases** : chaque `save` fait son **commit local** immédiat, les verrous **ne traversent pas** le réseau, et il n'existe aucun journal commun. Le premier commit est **définitif** quand le second échoue. Sans 2PC ni saga, tu produis des états orphelins (la sortie « fantôme » du §1).

### PIÈGE #2 — Utiliser le 2PC « parce que c'est atomique »

Le 2PC **est** atomique, mais si le **coordinateur crashe entre prepare et commit**, les participants ayant voté YES restent **bloqués, verrous tenus**, incapables de décider seuls. Ajoute SPOF, deux allers-retours synchrones et couplage temporel fort : sous charge ou partition, l'opération **se fige**. Le 2PC choisit **C** contre **A** — rarement le bon compromis entre microservices autonomes.

### PIÈGE #3 — Confondre compensation et `ROLLBACK`

Une compensation **n'annule rien techniquement** : `Tᵢ` est déjà commitée. `Cᵢ` est une **nouvelle transaction métier** qui produit l'effet **inverse** (recréditer, libérer, émettre un avoir). Traiter la compensation comme un `ROLLBACK` SQL mène à un code impossible (« rollbacker » une ligne commitée par un **autre** service il y a 3 secondes).

### PIÈGE #4 — Ignorer les actions non-compensables

« Chaque étape aura sa compensation. » Faux : un email envoyé, un versement irréversible **ne se défont pas**. Conçois-les en **actions correctrices** (email d'annulation) et **place-les après le pivot** (étapes **retriables** qu'on **retente** plutôt que d'annuler). Mettre un envoi d'email **avant** le pivot = risque d'annoncer puis démentir.

### PIÈGE #5 — Oublier que la saga n'a **pas** d'isolation

C'est **le** piège du module. La saga te rend A, C, D mais **pas I** : entre `Tᵢ` et sa compensation, l'état intermédiaire est **visible**. Sans contre-mesure, tu t'exposes aux **lost updates**, **dirty reads**, **fuzzy reads**. « Ça marche en test » parce qu'il n'y a **pas** de concurrence en test — le bug n'apparaît **qu'en parallèle**. Pose un **semantic lock** et des updates **commutatifs** dès la conception.

### PIÈGE #6 — Compenser sans idempotence

Les commandes/événements de saga transitent par un broker **at-least-once** (module 05) : `C2` peut être **rejouée**. Si `libérerPlaces` **ajoute** 4 places à chaque appel au lieu de **poser** l'état « libéré », une double livraison **rend trop de places**. Toute étape **et** toute compensation doivent être **idempotentes** (dédup par `sagaId`+étape, ou opération naturellement idempotente).

### PIÈGE #7 — Mettre le pivot au mauvais endroit

Placer l'action risquée/irréversible (débit réel, envoi) **trop tôt** rend le reste de la saga **incompensable** proprement. Le **pivot** doit être le **dernier** point où l'on peut encore tout annuler ; **avant** lui, tout est compensatable ; **après**, tout est retriable (garanti d'aboutir). Un pivot mal placé = soit on n'arrive plus à compenser, soit on compense ce qui aurait dû être définitif.

---

## 5. Ancrage TribuZen

TribuZen a des opérations qui **traversent** plusieurs services sans base commune — le terrain exact des sagas.

**`createSortie` (le cas du §1), en saga orchestrée** — c'est le worked example 1 :

```
Orchestrateur createSortie
  T1 creerSortie (PENDING)         [compensatable]  C1 → ANNULÉE
  T2 reserverPlaces (PENDING)      [compensatable]  C2 → libère
  T3 debiterBudget                 [PIVOT]          C3 → recrédite
  T4 confirmer + notifier          [retriable]      (retry-forward via queue)
```

Décisions concrètes pour TribuZen :

- **Orchestration**, pas chorégraphie : le flux fait 4 étapes avec un pivot et des branches d'échec → un orchestrateur **auditable** (on peut demander « où en est la saga X ? ») bat une cascade d'événements difficile à suivre.
- **Semantic lock systématique** sur les places (`RESERVE_PENDING` → `RESERVE_CONFIRMED`) : l'UI affiche « en cours de réservation » et **ne compte pas** ces places comme prises → pas de dirty read exploité par un autre parent.
- **Updates commutatifs** sur le budget (`debit(+/-)` relatif, jamais `SET solde = X`) → pas de lost update quand deux parents créent des sorties en parallèle.
- **Pivot = débit budget** : avant lui tout s'annule proprement ; après lui, la notification est **retriable** (on la **retente**, on ne « dé-crée » pas une sortie déjà payée).
- **Idempotence** des compensations (le broker est at-least-once) : `release` / `credit` posent un état, ne l'incrémentent pas.

D'autres sagas TribuZen suivront le même moule : **rejoindre une sortie** (place + budget enfant + notif organisateur), **annuler une sortie** (rembourser les budgets débités + libérer + notifier).

> **Défère :** la **décision** « faut-il une saga, un CQRS, ou regrouper ces services ? » et le cadrage archi = **cours 13-architecture, module 18** ; publier de façon **fiable** l'événement `SortieCréée` depuis la transaction DB (dual-write/**outbox**) = **module 13 (ce cours)** ; les **retries/backoff/idempotency key** génériques des étapes = **module 08** ; les **garanties de livraison** du broker qui porte les commandes de saga = **module 05**. Ici on a posé **le mécanisme transactionnel et ses garanties**.

---

## 6. Points clés

1. **Pas d'ACID distribué « simple »** : chaque service a sa base, les verrous ne franchissent pas le réseau, un commit local est définitif — il faut un protocole (**2PC**) ou renoncer à l'atomicité (**saga**).
2. **2PC** = coordinateur + **prepare** (voter YES/NO, prendre les verrous) puis **commit/abort**, avec **WAL** pour la reprise. Atomique.
3. **Blocking problem** : si le **coordinateur crashe entre les deux phases**, les participants ayant voté YES restent **bloqués, verrous tenus** — SPOF, latence, couplage synchrone ; 2PC choisit **C** contre **A**.
4. **Saga** = séquence de **transactions locales** ; chaque `Tᵢ` commite localement et déclenche la suivante ; en cas d'échec, des **compensations** `Cᵢ` défont les précédentes **en ordre inverse**. Aucun verrou distribué.
5. **Orchestration** (commandes, flux centralisé, auditable) vs **chorégraphie** (événements, décentralisée, dure à suivre) — orchestration dès 4+ étapes ou branches.
6. **Compensation = rollback sémantique**, pas technique ; certaines actions sont **non-compensables** (→ action correctrice + placer **après le pivot**) ; **backward** (annuler) vs **forward** (retenter).
7. Structure **compensatable → pivot (point de non-retour) → retriable** : avant le pivot on **compense**, après on **retente**.
8. **La saga n'a pas d'isolation (ACD sans I)** → **lost update**, **dirty read**, **fuzzy read**. Contre-mesures : **semantic lock** (état `*_PENDING` visible), **commutative updates**, **pessimistic view**, **reread value**, **by value**.
9. **Cohérence éventuelle** : on l'accepte quand la fenêtre d'incohérence est courte, bornée et tolérable métier (et maquillée par un semantic lock) ; on la refuse pour l'irréversible critique.

---

## 7. Seeds Anki

```
Pourquoi ne peut-on pas faire une transaction ACID "simple" à travers plusieurs services ?|Chaque service a sa propre base : il n'existe aucun BEGIN/COMMIT commun, les verrous ne franchissent pas le réseau, et un commit local est définitif dès qu'il est fait. On ne peut pas rollbacker la base A quand la base B échoue. Il faut soit un protocole de commit distribué (2PC), soit renoncer à l'atomicité (saga).
Comment fonctionne le 2PC (two-phase commit) ?|Un coordinateur pilote deux phases. Phase PREPARE : chaque participant fait le travail jusqu'au bord du commit, prend ses verrous, et vote YES ou NO. Phase COMMIT : si tous ont voté YES le coordinateur envoie COMMIT à tous ; si un seul NO, il envoie ABORT (relâche les verrous). Coordinateur et participants journalisent (WAL) pour reprendre après crash.
Qu'est-ce que le blocking problem du 2PC ?|Si le coordinateur crashe ENTRE prepare et commit, les participants ayant voté YES tiennent leurs verrous et ne peuvent pas décider seuls (un autre a peut-être voté NO). Ils restent bloqués, verrous tenus, tant que le coordinateur n'est pas revenu. S'ajoutent le SPOF, la latence (2 aller-retours) et le couplage synchrone : le 2PC choisit C au détriment de A (CAP).
Qu'est-ce qu'une saga et comment gère-t-elle un échec ?|Une saga est une séquence de transactions locales : chaque Tᵢ commite localement et déclenche la suivante (message/événement). Si une étape échoue (violation de règle métier), la saga exécute des transactions compensatoires Cᵢ, en ordre INVERSE, qui annulent l'effet des étapes précédentes. Aucun verrou distribué n'est tenu.
Orchestration vs chorégraphie dans une saga ?|Chorégraphie : décentralisée, chaque service publie des événements qui déclenchent les étapes des autres — faible couplage mais dure à suivre/débuguer. Orchestration : un orchestrateur central envoie des commandes, attend les réponses et pilote les compensations — flux visible et auditable. Orchestration dès 4+ étapes ou branches ; chorégraphie pour 2-3 étapes.
Pourquoi une compensation est-elle un rollback sémantique et pas un ROLLBACK SQL ?|Parce que la transaction Tᵢ est DÉJÀ commitée localement : il n'y a plus rien à défaire techniquement. La compensation est une NOUVELLE transaction métier qui produit l'effet inverse (recréditer le budget, libérer les places, émettre un avoir). Certaines actions sont non-compensables (email envoyé) → action correctrice + les placer après le pivot.
Que sont les transactions compensatable, pivot et retriable ?|Compensatables : les étapes AVANT le pivot, chacune avec une compensation. Pivot : le point de non-retour (go/no-go), ni compensatable ni retriable — s'il commite, la saga ira au bout. Retriables : les étapes APRÈS le pivot, garanties d'aboutir (retry-forward), qui ne peuvent plus violer de règle. Avant le pivot on compense, après on retente.
Quelle propriété ACID une saga sacrifie-t-elle, et quelles anomalies en résultent ?|L'isolation (le I) : la saga garde A, C, D mais chaque Tᵢ commite localement avant la fin, donc l'état intermédiaire est visible aux autres sagas. Anomalies : lost update (une saga écrase la modif d'une autre), dirty read (lire un état qui sera compensé), fuzzy/non-repeatable read (deux lectures de la même donnée donnent des valeurs différentes).
Qu'est-ce qu'un semantic lock et à quoi sert-il ?|C'est une contre-mesure applicative à l'absence d'isolation : une étape compensatable pose un marqueur d'état "en cours" (ex. RESERVE_PENDING) au lieu de marquer la ressource comme finale. Les autres sagas voient que la donnée est provisoire et n'agissent pas dessus comme si elle était acquise → évite les dirty reads. La transaction finale ou la compensation lève le verrou (CONFIRMED / libéré).
Quand accepter la cohérence éventuelle d'une saga plutôt qu'une atomicité stricte ?|Quand l'opération est multi-services et que l'atomicité stricte coûterait la disponibilité (blocage 2PC), que la fenêtre d'incohérence est courte et bornée, que l'anomalie possible est tolérable métier, et qu'on peut la maquiller avec un semantic lock. On la refuse pour l'irréversible critique (argent réel, unicité forte, conformité) → regrouper les données ou transaction locale.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-11-transactions-distribuees-saga/README.md`. Concevoir et implémenter la saga orchestrée `createSortie` de TribuZen (Sorties + Réservation + Budget + Notifications) via un docker-compose fourni : classer les étapes en compensatable/pivot/retriable, écrire les compensations sémantiques, provoquer un échec au pivot pour observer la compensation en ordre inverse, puis reproduire un **dirty read** en concurrence et le corriger par un **semantic lock**. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
