# Lab 11 — Transactions distribuées & saga

> **Outcome :** à la fin, tu sais concevoir et implémenter une **saga orchestrée** avec compensations sémantiques pour une opération TribuZen multi-services, observer une **compensation en ordre inverse** quand le pivot échoue, puis reproduire une **anomalie d'isolation** (dirty read) et la corriger par un **semantic lock**.
> **Vrai outil :** Node.js + TypeScript, trois « services » (chacun sa base) lancés via le **docker-compose fourni** (PostgreSQL ×3 + un broker RabbitMQ pour les commandes). Pas de framework de saga : tu écris l'orchestrateur toi-même.
> **Feedback :** le coach valide en session à partir de la grille ci-dessous — pas de test-runner auto-correcteur.

---

## Contexte

Dans TribuZen, **créer une sortie payante à places limitées** traverse trois services sans base commune :

- **sorties-svc** — enregistre la sortie (`PENDING` → `CONFIRMED` / `CANCELLED`).
- **reservation-svc** — pose/lève des places (`RESERVE_PENDING` → `RESERVE_CONFIRMED` / libéré).
- **budget-svc** — débite/recrédite le budget commun de la famille.
- (+ une notification en fin de course, envoyée via la queue.)

Il n'existe **aucun** `BEGIN … COMMIT` qui engloberait ces trois bases. Tu vas donc écrire une **saga orchestrée** : une séquence de transactions locales, chacune avec sa compensation, un **pivot** (point de non-retour), et un **semantic lock** pour masquer l'absence d'isolation.

## Environnement fourni (docker-compose)

Un `docker-compose.yml` t'est fourni (ne le modifie pas) :

```yaml
# docker-compose.yml (fourni)
services:
  db-sorties:      { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5441:5432"] }
  db-reservation:  { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5442:5432"] }
  db-budget:       { image: postgres:16, environment: { POSTGRES_PASSWORD: dev }, ports: ["5443:5432"] }
  broker:          { image: rabbitmq:3-management, ports: ["5672:5672", "15672:15672"] }
```

```bash
docker compose up -d          # 3 bases isolées + broker
pnpm install
pnpm run migrate              # crée les tables sorties / reservations / budgets
pnpm run dev                  # démarre les 3 services + l'orchestrateur
```

Chaque service expose un mini-repository TypeScript déjà branché sur **sa** base (`sortiesRepo`, `reservationRepo`, `budgetRepo`). **Tu ne partages jamais une connexion entre deux services** — c'est tout l'intérêt.

**Starter fourni** (`src/saga/orchestrator.ts`) — squelette **incomplet**, à toi de le remplir :

```ts
// src/saga/orchestrator.ts — STARTER (à compléter)
export interface SagaStep {
  name: string;
  execute: (ctx: SagaContext) => Promise<void>;      // throw = échec de l'étape
  compensate?: (ctx: SagaContext) => Promise<void>;  // absent = étape retriable
}
export interface SagaContext {
  sagaId: string;
  data: Record<string, unknown>;
}

export class SagaOrchestrator {
  constructor(private readonly steps: SagaStep[]) {}

  async run(ctx: SagaContext): Promise<{ ok: boolean }> {
    // TODO : exécuter les étapes dans l'ordre ; à la première erreur,
    // compenser les étapes DÉJÀ réussies en ORDRE INVERSE (sauf les retriables).
    throw new Error('à implémenter');
  }
}
```

**Pas de gap-fill** : tu écris l'orchestrateur et les 4 étapes en entier à partir de ce squelette.

---

## Énoncé

### Partie A — Concevoir la saga (sur papier d'abord)

Avant de coder, **classe** les 4 étapes de `createSortie` et écris pour chacune sa compensation. Remplis ce tableau (c'est le premier point de la grille) :

| Étape | Catégorie (compensatable / pivot / retriable) | Compensation |
|---|---|---|
| créer la sortie (`PENDING`) | ? | ? |
| réserver 4 places (`RESERVE_PENDING`) | ? | ? |
| débiter le budget (32 €) | ? | ? |
| confirmer + notifier | ? | ? |

Justifie **où** tu places le **pivot** et **pourquoi** (point de non-retour).

### Partie B — Implémenter l'orchestrateur + les étapes

1. Complète `SagaOrchestrator.run` : exécution séquentielle, et **à la première erreur**, compensation des étapes réussies **en ordre inverse** (les étapes **retriables**, sans `compensate`, ne sont pas compensées).
2. Écris les 4 `SagaStep` de `createSortie` en branchant les vrais repos. **Contraintes** :
   - la réservation pose un **semantic lock** `RESERVE_PENDING` (pas `CONFIRMED`) ;
   - le débit budget est un **update commutatif** (`debit(+/-)` relatif, **jamais** `SET solde = X`) ;
   - le débit budget est le **pivot** ;
   - la confirmation + notification est **retriable** (pas de compensation).
3. Rends chaque `execute` **et** chaque `compensate` **idempotents** (le broker est at-least-once → une commande peut être rejouée). Dédup par `sagaId`+étape, ou opération naturellement idempotente.

### Partie C — Provoquer l'échec et observer la compensation

1. Force le **budget-svc** à refuser (budget famille = 20 €, sortie = 32 €) → l'étape pivot **throw**.
2. Observe dans les logs que la saga **compense en ordre inverse** : libère les places, marque la sortie annulée. Vérifie dans les **3 bases** qu'il ne reste **aucun** état orphelin (pas de sortie `PENDING` fantôme, pas de place `RESERVE_PENDING` bloquée).

### Partie D — Reproduire un dirty read et le corriger

1. Lance **deux** sagas concurrentes sur la même sortie « 12 places ». Saga A réserve 8 places puis échoue au pivot. **Pendant** ce temps, un endpoint de lecture compte « places libres ».
2. Montre le **dirty read** : la lecture voit « 4 libres » alors que A va tout libérer → décision prise sur une valeur fantôme.
3. **Corrige** : le compteur de lecture **distingue** `RESERVE_PENDING` de `RESERVE_CONFIRMED` (le pending est affiché « en cours », **pas** soustrait comme acquis), et la décision d'écriture fait un **reread** juste avant de confirmer. Re-teste : plus de décision sur un état qui disparaît.

---

## Grille d'évaluation (le coach coche)

- [ ] **A** — Tableau compensatable/pivot/retriable correct ; pivot = débit budget, justifié comme point de non-retour.
- [ ] **B1** — L'orchestrateur compense les étapes réussies **en ordre inverse**, et **saute** les retriables.
- [ ] **B2** — Réservation en `RESERVE_PENDING` (semantic lock), budget en update **commutatif** (pas de `SET solde`).
- [ ] **B3** — `execute` **et** `compensate` idempotents (une double livraison ne double pas l'effet).
- [ ] **C** — Échec au pivot → compensation visible ; **aucun** état orphelin dans les 3 bases.
- [ ] **D** — Dirty read reproduit **puis** corrigé (lecture distingue pending/confirmed + reread avant écriture).
- [ ] **Transverse** — Aucune connexion partagée entre deux services ; la notification est retriable (jamais compensée après le pivot).

**Pièges guettés par le coach :** compenser dans le mauvais ordre ; traiter la compensation comme un `ROLLBACK` (alors que la ligne est déjà commitée) ; oublier l'idempotence des compensations ; compter le `RESERVE_PENDING` comme acquis (dirty read non corrigé) ; placer une action non-compensable (la notif) **avant** le pivot.

---

## Coaching (relances si tu bloques)

- **« Par où commencer ? »** → Fais d'abord la **Partie A sur papier**. Tant que le pivot n'est pas placé, le code n'a pas de forme.
- **« Ma compensation ne défait rien. »** → Normal si tu cherches un `ROLLBACK`. La ligne est **déjà commitée** : écris une **nouvelle** transaction qui produit l'effet inverse (`release`, `credit`).
- **« Ça marche, je ne vois pas de bug d'isolation. »** → C'est parce que tu testes **en séquentiel**. Lance **deux** sagas **en parallèle** (Partie D) — le dirty read n'apparaît qu'en concurrence.
- **« Faut-il compenser la notification ? »** → Non : après le pivot, une étape est **retriable**. On la **retente** (retry-forward), on ne « dé-crée » pas une sortie déjà payée.
- **« Ma compensation s'exécute deux fois. »** → Le broker est **at-least-once** (module 05). Rends `compensate` **idempotent** : pose un état (`libéré`), n'incrémente pas un compteur.

---

## Variante J+30 (fading)

Reprends la saga **de mémoire, en 40 minutes**, avec **une contrainte ajoutée** :

- Ajoute une **cinquième étape après le pivot** : `envoyerRecuPaiement` (email), **non-compensable**. Montre qu'elle est bien placée en **retriable** (après le pivot) et qu'un échec y déclenche un **retry-forward**, jamais une annulation de la sortie déjà payée.
- **Bonus concurrence :** deux parents créent **en parallèle** deux sorties qui débitent le même budget famille. Prouve qu'avec des updates **commutatifs** (`debit` relatif), aucun **lost update** ne se produit — puis casse-le volontairement en passant à `SET solde = X` pour **voir** le lost update apparaître.

**Critère de réussite :** échec au pivot → aucun état orphelin dans les 3 bases ; l'étape non-compensable est après le pivot et retriée ; le lost update n'apparaît **qu'** avec `SET solde` et **pas** avec l'update commutatif.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, la saga vit côté backend :

```
tribuzen/
  services/
    sagas/
      createSortie/
        orchestrator.ts       ← SagaOrchestrator générique
        steps.ts              ← creerSortie / reserverPlaces / debiterBudget (pivot) / confirmer
        compensations.ts      ← markCancelled / release / credit
```

**Différences par rapport au lab :**

- Les commandes/événements de saga passent par la **vraie** couche de messagerie (module 05) avec **DLQ** sur les compensations qui échouent — dans le lab, on log l'échec de compensation.
- L'événement `SortieCréée` sera publié via un **outbox** (module 13) pour être fiable malgré le dual-write — ici on publie directement.
- Le statut de saga sera **persisté** (table `saga_state`) pour survivre à un crash de l'orchestrateur et **reprendre** — dans le lab, l'état vit en mémoire.

**Commit cible :**

```
feat(sagas): createSortie — saga orchestrée (compensatable/pivot/retriable) + semantic lock places
```
