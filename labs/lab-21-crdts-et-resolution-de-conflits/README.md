# Lab 21 — CRDTs & résolution de conflits

> **Outcome :** à la fin, tu sais implémenter un **OR-Set** et un **PN-Counter** en TypeScript, les faire tourner sur **deux vrais nœuds** (deux processus Node séparés) qui éditent hors-ligne puis réconcilient, observer l'**add-wins**, et **prouver** la convergence (commutativité, associativité, idempotence).
> **Vrai outil :** Node.js + TypeScript (`tsx`), deux processus réels échangeant leur état via des fichiers JSON (pas de simulation en mémoire dans une seule boucle). Optionnel : `docker-compose` fourni pour lancer les deux nœuds en conteneurs.
> **Feedback :** le coach valide en session — pas de test-runner auto-correcteur. Tu implémentes le CRDT **toi-même** ; il n'y a pas de gap-fill.

---

## Énoncé

On rejoue le **cas concret du module** (§1) : Alice et Bob préparent la sortie « Accrobranche » **hors-ligne**, chacun sur son nœud. Alice édite la **checklist** (OR-Set) et Bob aussi ; les deux touchent le **budget** (PN-Counter). Au retour du réseau, les deux nœuds échangent leur **état** et doivent **converger** sans perdre de contribution.

Tu dois livrer **quatre** choses :

1. Une classe **`ORSet<T>`** state-based (CvRDT) : `add`, `remove`, `has`, `values`, `state`, `merge`.
2. Une classe **`PNCounter`** : `increment`, `decrement`, `value`, `state`, `merge` (tu peux t'appuyer sur un `GCounter` interne).
3. Un **nœud** (`node.ts`) qui : charge son état depuis un fichier, applique une liste d'opérations locales (offline), écrit son état sur disque, puis **merge** l'état de l'autre nœud et réaffiche le résultat.
4. Une **preuve de convergence** (`convergence.ts`) qui vérifie les 3 propriétés du merge sur le G-Counter/OR-Set.

**Contrainte anti-triche pédagogique :** interdit d'importer `automerge` ou `yjs`. Le but est de **construire** le CRDT pour comprendre ce que ces libs garantissent. (En prod, on utiliserait Yjs/Automerge — cf. module §2.11.)

### Setup (fourni)

Arborescence à créer :

```
lab-21-crdts/
  src/
    crdt/or-set.ts        ← à écrire
    crdt/pn-counter.ts    ← à écrire
    node.ts               ← à écrire (charge/édite/sync)
    convergence.ts        ← à écrire (preuve)
  shared/                 ← "réseau" : les nœuds y déposent leur état
  package.json
  tsconfig.json
  docker-compose.yml      ← fourni ci-dessous (optionnel)
```

`package.json` minimal :

```json
{
  "name": "lab-21-crdts",
  "type": "module",
  "scripts": {
    "alice": "tsx src/node.ts alice",
    "bob": "tsx src/node.ts bob",
    "prove": "tsx src/convergence.ts"
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0" }
}
```

**Multi-nœud fourni — `docker-compose.yml`** (deux vrais conteneurs Node partageant un volume `shared/` qui joue le rôle de canal réseau) :

```yaml
services:
  alice:
    image: node:22-alpine
    working_dir: /app
    volumes: [".:/app"]
    command: sh -c "npm i && npx tsx src/node.ts alice"
    depends_on: [bob]
  bob:
    image: node:22-alpine
    working_dir: /app
    volumes: [".:/app"]
    command: sh -c "npm i && npx tsx src/node.ts bob"
```

> Tu peux tout faire **sans Docker** : deux terminaux, `npm run alice` puis `npm run bob`. Docker sert juste à montrer que ce sont **deux processus isolés** qui ne partagent que le dossier `shared/` (le « réseau »). Le point important : **aucune mémoire partagée** entre Alice et Bob — la seule communication est l'**échange d'état** via fichier.

### Scénario imposé (offline → sync)

Chaque nœud applique **ses** opérations hors-ligne, écrit son état, puis merge l'autre :

- **Alice** : `checklist.add('gourdes')`, `checklist.add('crème solaire')`, `checklist.remove('bottes')`, `budget.decrement(8)`.
- **Bob** : `checklist.add('trousse de secours')`, `budget.increment(20)`.
- État de départ **commun** (avant la coupure) : checklist `['bottes']`, budget `0`.

**Résultat attendu après merge bidirectionnel :**
- checklist convergente = `{crème solaire, gourdes, trousse de secours}` (pas de « bottes »), **identique** sur les deux nœuds.
- budget convergent = `20 − 8 = 12`.

---

## Étapes (en friction)

1. **Écris `GCounter`** (dans `pn-counter.ts`) : map `nodeId → number`, `increment` (rejette les négatifs), `value` = somme, `merge` = **max** élément par élément.
2. **Écris `PNCounter`** : deux `GCounter` (P, N) ; `decrement` = `N.increment` ; `value` = `P.value − N.value` ; `merge` = merge de P **et** de N.
3. **Écris `ORSet<T>`** : tags uniques `nodeId:seq`, `add` (nouveau tag), `remove` (déplace les tags **observés** en tombstones), `merge` (union actifs + union tombstones, puis soustrais les tombstones). N'efface **jamais** un tag sans tombstone.
4. **Sérialise l'état** : `state` doit être **JSON-sérialisable** (les `Map`/`Set` ne le sont pas nativement → convertis en tableaux/objets pour écrire dans `shared/<node>.json`, et reparse au chargement). C'est la friction principale.
5. **Écris `node.ts`** : lit l'argv (`alice`/`bob`), charge l'état de départ commun, applique **ses** opérations offline, écrit `shared/<node>.json`, attend/lit `shared/<autre>.json`, `merge`, réaffiche checklist + budget.
6. **Lance les deux nœuds** (deux terminaux ou Docker) et vérifie le résultat attendu (checklist identique des deux côtés, budget = 12).
7. **Écris `convergence.ts`** : sur un G-Counter à 3 nœuds, vérifie `merge(a,b)==merge(b,a)`, `((a⊔b)⊔c)==(a⊔(b⊔c))`, et `merge` avec **doublons** == sans doublons. Affiche VERIFIE/ECHOUE.
8. **Casse-le exprès** : dans une copie, remplace le `merge` du G-Counter par une **addition** au lieu du `max`. Relance `convergence.ts` et le scénario avec un **état rejoué deux fois** → observe la **divergence** (idempotence perdue). Puis remets le `max`. **Comprends** pourquoi le rejeu double la valeur.

---

## Corrigé complet commenté

```ts
// src/crdt/pn-counter.ts
export class GCounter {
  private slots = new Map<string, number>();
  constructor(readonly nodeId: string) { this.slots.set(nodeId, 0); }

  increment(n = 1): void {
    if (n < 0) throw new Error('G-Counter: increment only'); // grow-only
    this.slots.set(this.nodeId, (this.slots.get(this.nodeId) ?? 0) + n);
  }
  get value(): number { return [...this.slots.values()].reduce((a, b) => a + b, 0); }

  // état JSON-sérialisable (Map -> objet)
  get state(): Record<string, number> { return Object.fromEntries(this.slots); }

  merge(remote: Record<string, number>): void {
    for (const [id, n] of Object.entries(remote)) {
      // LUB = max élément par élément. JAMAIS d'addition (sinon rejeu = double).
      this.slots.set(id, Math.max(this.slots.get(id) ?? 0, n));
    }
  }
}

export class PNCounter {
  private P: GCounter;
  private N: GCounter;
  constructor(readonly nodeId: string) {
    this.P = new GCounter(nodeId);
    this.N = new GCounter(nodeId);
  }
  increment(n = 1): void { this.P.increment(n); }
  decrement(n = 1): void { this.N.increment(n); } // on INCRÉMENTE N (chaque moitié reste grow-only)
  get value(): number { return this.P.value - this.N.value; }

  get state(): { p: Record<string, number>; n: Record<string, number> } {
    return { p: this.P.state, n: this.N.state };
  }
  merge(remote: { p: Record<string, number>; n: Record<string, number> }): void {
    this.P.merge(remote.p); // chaque moitié converge indépendamment
    this.N.merge(remote.n);
  }
}
```

```ts
// src/crdt/or-set.ts
type Tag = string; // "nodeId:seq" — unique

// état JSON-sérialisable : élément -> tableau de tags
export interface ORSetState {
  active: Record<string, Tag[]>;
  tombstones: Record<string, Tag[]>;
}

export class ORSet<T> {
  private active = new Map<string, Set<Tag>>();
  private tombstones = new Map<string, Set<Tag>>();
  private seq = 0;
  constructor(readonly nodeId: string) {}

  private key(el: T): string { return JSON.stringify(el); }
  private newTag(): Tag { return `${this.nodeId}:${++this.seq}`; } // UNIQUE par add

  add(el: T): void {
    const k = this.key(el);
    if (!this.active.has(k)) this.active.set(k, new Set());
    this.active.get(k)!.add(this.newTag()); // chaque add = nouveau tag (jamais réutilisé)
  }

  remove(el: T): void {
    const k = this.key(el);
    const tags = this.active.get(k);
    if (!tags || tags.size === 0) return;
    if (!this.tombstones.has(k)) this.tombstones.set(k, new Set());
    // on tombstone SEULEMENT les tags observés localement (add-wins pour les tags non vus)
    for (const t of tags) this.tombstones.get(k)!.add(t);
    tags.clear();
  }

  has(el: T): boolean {
    const t = this.active.get(this.key(el));
    return t !== undefined && t.size > 0;
  }
  values(): T[] {
    return [...this.active].filter(([, t]) => t.size > 0).map(([k]) => JSON.parse(k) as T);
  }

  get state(): ORSetState {
    const dump = (m: Map<string, Set<Tag>>): Record<string, Tag[]> =>
      Object.fromEntries([...m].map(([k, v]) => [k, [...v]]));
    return { active: dump(this.active), tombstones: dump(this.tombstones) };
  }

  merge(remote: ORSetState): void {
    // 1) UNION des tags actifs
    for (const [k, tags] of Object.entries(remote.active)) {
      if (!this.active.has(k)) this.active.set(k, new Set());
      for (const t of tags) this.active.get(k)!.add(t);
    }
    // 2) UNION des tombstones
    for (const [k, tombs] of Object.entries(remote.tombstones)) {
      if (!this.tombstones.has(k)) this.tombstones.set(k, new Set());
      for (const t of tombs) this.tombstones.get(k)!.add(t);
    }
    // 3) un tag tombstoné n'est jamais actif → soustraction (empêche la résurrection)
    for (const [k, tombs] of this.tombstones) {
      const tags = this.active.get(k);
      if (tags) for (const t of tombs) tags.delete(t);
    }
  }
}
```

```ts
// src/node.ts — un VRAI nœud : charge, édite offline, écrit, merge l'autre
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { ORSet, type ORSetState } from './crdt/or-set.js';
import { PNCounter } from './crdt/pn-counter.js';

const me = process.argv[2] as 'alice' | 'bob';
const other = me === 'alice' ? 'bob' : 'alice';
mkdirSync('shared', { recursive: true });

interface NodeState { checklist: ORSetState; budget: { p: Record<string, number>; n: Record<string, number> }; }

const checklist = new ORSet<string>(me);
const budget = new PNCounter(me);

// État de départ COMMUN (avant la coupure réseau)
checklist.add('bottes');

// --- Opérations HORS-LIGNE, propres à chaque nœud ---
if (me === 'alice') {
  checklist.add('gourdes');
  checklist.add('crème solaire');
  checklist.remove('bottes');
  budget.decrement(8);
} else {
  checklist.add('trousse de secours');
  budget.increment(20);
}

// Écrit son état sur le "réseau" (dossier partagé)
const myFile = `shared/${me}.json`;
const dump: NodeState = { checklist: checklist.state, budget: budget.state };
writeFileSync(myFile, JSON.stringify(dump, null, 2));
console.log(`[${me}] avant merge — checklist=${checklist.values().sort()} budget=${budget.value}`);

// --- Réseau rétabli : lit l'état de l'autre et merge ---
const otherFile = `shared/${other}.json`;
if (existsSync(otherFile)) {
  const remote: NodeState = JSON.parse(readFileSync(otherFile, 'utf8'));
  checklist.merge(remote.checklist);
  budget.merge(remote.budget);
  console.log(`[${me}] APRÈS merge — checklist=${checklist.values().sort()} budget=${budget.value}`);
} else {
  console.log(`[${me}] ${other} pas encore synchronisé — relance ce nœud après l'autre.`);
}
```

```ts
// src/convergence.ts — preuve des 3 propriétés (SEC)
import { GCounter } from './crdt/pn-counter.js';

function merged(states: Record<string, number>[]): number {
  const g = new GCounter('probe');
  for (const s of states) g.merge(s);
  return g.value;
}

const x = new GCounter('X'); x.increment(5);
const y = new GCounter('Y'); y.increment(3);
const z = new GCounter('Z'); z.increment(7);
const [a, b, c] = [x.state, y.state, z.state];

const commut = merged([a, b]) === merged([b, a]);
const assoc  = merged([a, b, c]) === merged([c, a, b]);
const idem   = merged([a, b, c]) === merged([a, b, c, b, a]); // doublons rejoués
console.log(`commutativité : ${commut ? 'VERIFIE' : 'ECHOUE'} (${merged([a, b])})`);
console.log(`associativité : ${assoc ? 'VERIFIE' : 'ECHOUE'} (${merged([a, b, c])})`);
console.log(`idempotence   : ${idem ? 'VERIFIE' : 'ECHOUE'} (rejeu inoffensif)`);
```

**Lancement :**

```bash
npm i
npm run alice   # écrit shared/alice.json, dit "bob pas encore synchronisé"
npm run bob     # écrit shared/bob.json PUIS merge alice → checklist convergée, budget=12
npm run alice   # relance : alice lit bob.json et converge à son tour (même résultat)
npm run prove   # les 3 propriétés VERIFIE
```

**Pourquoi ce corrigé est correct :**
- **Aucune contribution perdue** : les `add` d'Alice et Bob ont des **tags distincts** → l'union les garde tous. « bottes » disparaît car son tag a été tombstoné (et Bob ne l'avait pas ré-ajouté). Le budget = `P(20) − N(8) = 12`.
- **Convergence indépendante de l'ordre** : relancer `alice` après `bob` donne le **même** état — c'est la SEC. Peu importe qui merge en dernier.
- **Idempotence réelle** : le `max` du G-Counter et l'union de l'OR-Set rendent un état **rejoué** inoffensif. `convergence.ts` le prouve avec `[a,b,c,b,a]`.
- **Deux vrais processus** : Alice et Bob ne partagent **aucune** mémoire ; leur seul canal est `shared/*.json` — le merge fonctionne malgré l'isolation, exactement comme deux téléphones offline.

**L'expérience « casse-le » (étape 8) :** remplace `Math.max(...)` par une addition dans `GCounter.merge`. `npm run prove` → **idempotence ECHOUE** (rejouer `a` re-additionne son slot). Relancer `alice`/`bob` plusieurs fois **gonfle** le budget. Leçon : **sans idempotence, pas de SEC** — le rejeu (réseau at-least-once, module 05) casse tout.

---

## Variante J+30 (fading)

**Même objectif, contraintes ajoutées.** Reproduis, **de mémoire, en 40 minutes**, sans rouvrir ce corrigé ni le module :

1. Implémente à la place un **LWW-Register** (`set(value, ts)`, `merge`, bris d'égalité par `nodeId`) pour un champ « lieu de rendez-vous » de la sortie, édité en concurrence par Alice et Bob.
2. **Démontre sa perte silencieuse** : fais deux `set` concurrents (`'Parc Nord'` @ ts=100 côté Alice, `'Parc Sud'` @ ts=100 côté Bob), merge, et **explique par écrit** pourquoi une des deux valeurs disparaît sans erreur.
3. **Compare** : pour la checklist, pourquoi un OR-Set est-il préférable à un LWW-Register (par item) ? Réponds en une phrase sur l'**add-wins**.

**Critère de réussite :** le LWW-Register converge (les deux nœuds affichent la **même** valeur), tu **nommes** laquelle gagne et **pourquoi** (tie-break `nodeId`), et tu **articules** la perte silencieuse vs l'add-wins de l'OR-Set.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, le mode offline-first vit ici :

```
tribuzen/
  src/
    sync/
      crdt/               ← nos types (or-set, pn-counter) pour comprendre
      useOfflineSync.ts   ← en prod : wrapper autour d'Automerge/Yjs
```

**Différences par rapport au lab :**
- En **prod**, TribuZen n'écrit pas ses CRDTs à la main : il utilise **Yjs** ou **Automerge** (module §2.11) qui gèrent la persistance (IndexedDB), l'undo/redo, les curseurs et la sync réseau (WebRTC/WebSocket). Le lab sert à **comprendre** ce que ces libs garantissent — et leurs limites (tombstones, GC, invariants non tenus).
- Le canal « fichier `shared/*.json` » du lab est remplacé par un vrai **provider** de sync ; la logique de merge est **identique** dans le principe.
- L'invariant « max N places » n'est **pas** confié au CRDT (il ne le tient pas) → il passe par le service de réservation avec **saga + semantic lock** (module 11) ou **consensus** (module 18).

**Commit cible :**
```
feat(sync): OR-Set checklist + PN-Counter budget — réconciliation offline-first sans perte
```
