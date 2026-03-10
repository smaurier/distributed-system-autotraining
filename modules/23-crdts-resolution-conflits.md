# 23 — CRDTs & Resolution de Conflits

| Difficulte | Duree estimee | Lab | Quiz |
|:----------:|:-------------:|:---:|:----:|
| 5/5        | 120 min       | [Lab 23](../labs/lab-23-crdts/) | [Quiz 23](../quizzes/quiz-23-crdts.html) |

## Objectifs pedagogiques

A la fin de ce module, vous serez capable de :

- Expliquer le probleme de la resolution de conflits dans les systemes repliques
- Definir la Strong Eventual Consistency (SEC) et la distinguer de l'eventual consistency classique
- Decrire ce que sont les CRDTs et leurs deux familles (CvRDT et CmRDT)
- Implementer un G-Counter (Grow-only Counter) en TypeScript
- Implementer un PN-Counter (Positive-Negative Counter) en TypeScript
- Implementer un LWW-Register (Last Writer Wins Register) en TypeScript
- Implementer un OR-Set (Observed-Remove Set) en TypeScript
- Demontrer les proprietes mathematiques de convergence (commutativite, associativite, idempotence)
- Identifier les trade-offs des CRDTs : overhead de metadonnees, tombstones, garbage collection

---

## Le probleme de la resolution de conflits

Dans un systeme distribue avec replication, les noeuds peuvent modifier les memes donnees independamment (pendant une partition reseau ou simplement en mode multi-leader). Quand les repliques se resynchronisent, il faut **resoudre les conflits**.

```
┌───────────────────────────────────────────────────────────┐
│          CONFLITS DANS UN SYSTEME REPLIQUE                 │
│                                                           │
│  Replique A          Partition          Replique B        │
│  ┌────────┐           reseau           ┌────────┐        │
│  │ x = 1  │           ╳ ╳ ╳           │ x = 1  │        │
│  └────┬───┘                            └────┬───┘        │
│       │                                     │             │
│  SET x = 5                             SET x = 10         │
│       │                                     │             │
│  ┌────┴───┐                            ┌────┴───┐        │
│  │ x = 5  │                            │ x = 10 │        │
│  └────┬───┘                            └────┬───┘        │
│       │         Reseau retabli              │             │
│       └─────────────┬───────────────────────┘             │
│                     │                                     │
│              x = ??? CONFLIT !                             │
│                                                           │
│  Strategies de resolution :                                │
│  1. Last Writer Wins (LWW) — simple mais perd des ecritures│
│  2. Merge manuel — complexe, necessite logique metier      │
│  3. CRDTs — convergence automatique et mathematique        │
└───────────────────────────────────────────────────────────┘
```

---

## Strong Eventual Consistency (SEC)

:::tip Definition
La **Strong Eventual Consistency** garantit que si deux repliques ont recu le meme ensemble de mises a jour (dans n'importe quel ordre), elles convergent vers le **meme etat**, sans necessiter de protocole de consensus ou de coordination.
:::

| Propriete | Eventual Consistency | Strong Eventual Consistency |
|-----------|:-------------------:|:--------------------------:|
| Convergence a terme | Oui | Oui |
| Convergence sans coordination | Non (peut necessiter conflit resolution) | Oui |
| Deterministe | Non garanti | Oui (meme ensemble → meme etat) |
| Resolution de conflits | Manuelle ou LWW | Automatique par la structure |

---

## Qu'est-ce qu'un CRDT ?

Un **Conflict-free Replicated Data Type** (CRDT) est une structure de donnees concue pour etre repliquee sur plusieurs noeuds et qui converge automatiquement, quels que soient l'ordre et le nombre de livraisons des mises a jour.

### Deux familles de CRDTs

```
┌───────────────────────────────────────────────────────────┐
│              FAMILLES DE CRDTs                              │
│                                                           │
│  CvRDT (State-based, Convergent)                           │
│  ┌────────┐    merge(state)    ┌────────┐                 │
│  │Replique│◄──────────────────►│Replique│                 │
│  │   A    │    etat complet    │   B    │                 │
│  └────────┘                    └────────┘                 │
│  • Envoie l'etat complet                                  │
│  • Merge = join du semi-treillis (LUB)                    │
│  • Idempotent, commutable, associatif                     │
│  • Plus de bande passante, tolerant aux pertes            │
│                                                           │
│  CmRDT (Operation-based, Commutative)                      │
│  ┌────────┐    operation()     ┌────────┐                 │
│  │Replique│───────────────────►│Replique│                 │
│  │   A    │    op seulement    │   B    │                 │
│  └────────┘                    └────────┘                 │
│  • Envoie uniquement les operations                       │
│  • Operations commutatives                                │
│  • Moins de bande passante, necessite livraison fiable    │
│  • Necessite exactly-once ou au moins causal delivery      │
└───────────────────────────────────────────────────────────┘
```

---

## G-Counter (Grow-only Counter)

Le G-Counter est le CRDT le plus simple. Chaque noeud maintient son propre compteur, et la valeur globale est la somme de tous les compteurs.

```
┌───────────────────────────────────────────────────────────┐
│              G-COUNTER                                      │
│                                                           │
│  Noeud A : {A: 3, B: 0, C: 0}  → valeur = 3              │
│  Noeud B : {A: 0, B: 5, C: 0}  → valeur = 5              │
│  Noeud C : {A: 0, B: 0, C: 2}  → valeur = 2              │
│                                                           │
│  Apres merge(A, B) :                                       │
│  {A: 3, B: 5, C: 0} → valeur = 8                          │
│                                                           │
│  Merge = max element par element                           │
│  Valeur = somme de tous les elements                       │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript

```typescript
// g-counter.ts — G-Counter (Grow-only Counter)

class GCounter {
  readonly nodeId: string;
  private counters: Map<string, number> = new Map();

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.counters.set(nodeId, 0);
  }

  // Incrementer (seulement notre propre compteur)
  increment(amount: number = 1): void {
    if (amount < 0) throw new Error('G-Counter ne peut qu\'incrementer');
    const current = this.counters.get(this.nodeId) || 0;
    this.counters.set(this.nodeId, current + amount);
  }

  // Obtenir la valeur globale (somme)
  get value(): number {
    let sum = 0;
    for (const count of this.counters.values()) {
      sum += count;
    }
    return sum;
  }

  // Obtenir l'etat pour la synchronisation
  get state(): Map<string, number> {
    return new Map(this.counters);
  }

  // Fusionner avec l'etat d'un autre noeud
  merge(remoteState: Map<string, number>): void {
    for (const [nodeId, remoteCount] of remoteState) {
      const localCount = this.counters.get(nodeId) || 0;
      this.counters.set(nodeId, Math.max(localCount, remoteCount));
    }
  }

  toString(): string {
    const entries = [...this.counters.entries()]
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    return `GCounter(${entries}) = ${this.value}`;
  }
}

// --- Simulation ---
function simulateGCounter(): void {
  console.log('=== Simulation G-Counter ===\n');

  const counterA = new GCounter('A');
  const counterB = new GCounter('B');
  const counterC = new GCounter('C');

  // Chaque noeud incremente independamment
  counterA.increment(3);
  counterB.increment(5);
  counterC.increment(2);

  console.log('Avant merge:');
  console.log(`  A: ${counterA}`);
  console.log(`  B: ${counterB}`);
  console.log(`  C: ${counterC}`);

  // A et B se synchronisent
  counterA.merge(counterB.state);
  counterB.merge(counterA.state);

  console.log('\nApres merge A ↔ B:');
  console.log(`  A: ${counterA}`);
  console.log(`  B: ${counterB}`);

  // B et C se synchronisent
  counterB.merge(counterC.state);
  counterC.merge(counterB.state);

  console.log('\nApres merge B ↔ C:');
  console.log(`  B: ${counterB}`);
  console.log(`  C: ${counterC}`);

  // A se synchronise avec C (ou B) pour la convergence complete
  counterA.merge(counterC.state);

  console.log('\nApres convergence complete:');
  console.log(`  A: ${counterA}`);
  console.log(`  B: ${counterB}`);
  console.log(`  C: ${counterC}`);
  console.log(`  → Tous convergent vers ${counterA.value}`);
}

simulateGCounter();
```

---

## PN-Counter (Positive-Negative Counter)

Le PN-Counter etend le G-Counter pour supporter les decrementations en utilisant **deux** G-Counters : un pour les increments (P) et un pour les decrements (N).

```
┌───────────────────────────────────────────────────────────┐
│              PN-COUNTER                                     │
│                                                           │
│  P (increments) :  {A: 5, B: 3}  → somme = 8             │
│  N (decrements) :  {A: 2, B: 1}  → somme = 3             │
│                                                           │
│  Valeur = P.value - N.value = 8 - 3 = 5                   │
│                                                           │
│  increment() → P.increment()                               │
│  decrement() → N.increment()                               │
│  merge() → P.merge() + N.merge()                           │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript

```typescript
// pn-counter.ts — PN-Counter (Positive-Negative Counter)

class PNCounter {
  readonly nodeId: string;
  private P: GCounter; // increments
  private N: GCounter; // decrements

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.P = new GCounter(nodeId);
    this.N = new GCounter(nodeId);
  }

  increment(amount: number = 1): void {
    this.P.increment(amount);
  }

  decrement(amount: number = 1): void {
    this.N.increment(amount);
  }

  get value(): number {
    return this.P.value - this.N.value;
  }

  get state(): { p: Map<string, number>; n: Map<string, number> } {
    return { p: this.P.state, n: this.N.state };
  }

  merge(remoteState: { p: Map<string, number>; n: Map<string, number> }): void {
    this.P.merge(remoteState.p);
    this.N.merge(remoteState.n);
  }

  toString(): string {
    return `PNCounter(P=${this.P.value}, N=${this.N.value}) = ${this.value}`;
  }
}

// --- Simulation ---
function simulatePNCounter(): void {
  console.log('=== Simulation PN-Counter ===\n');

  const counterA = new PNCounter('A');
  const counterB = new PNCounter('B');

  // A incremente 5 fois, decremente 2 fois
  counterA.increment(5);
  counterA.decrement(2);

  // B incremente 3 fois, decremente 1 fois
  counterB.increment(3);
  counterB.decrement(1);

  console.log('Avant merge:');
  console.log(`  A: ${counterA}`);
  console.log(`  B: ${counterB}`);

  // Merge bidirectionnel
  counterA.merge(counterB.state);
  counterB.merge(counterA.state);

  console.log('\nApres merge:');
  console.log(`  A: ${counterA}`);
  console.log(`  B: ${counterB}`);
  console.log(`  → Valeur convergente: ${counterA.value} (8 increments - 3 decrements)`);
}

simulatePNCounter();
```

---

## LWW-Register (Last Writer Wins Register)

Le LWW-Register resout les conflits en conservant l'ecriture avec le **timestamp le plus recent**. C'est le CRDT le plus utilise en pratique.

```
┌───────────────────────────────────────────────────────────┐
│              LWW-REGISTER                                   │
│                                                           │
│  Noeud A : (value="Paris", timestamp=100)                  │
│  Noeud B : (value="Lyon", timestamp=105)                   │
│                                                           │
│  Merge : timestamp 105 > 100 → "Lyon" gagne               │
│                                                           │
│  Attention : necessite des horloges raisonnablement        │
│  synchronisees (HLC recommande)                            │
└───────────────────────────────────────────────────────────┘
```

:::warning Perte silencieuse d'ecritures
Le LWW-Register est simple mais **perd silencieusement des ecritures**. L'ecriture "Paris" est simplement supprimee. Si la perte d'ecritures concurrentes est inacceptable, utilisez un Multi-Value Register ou un OR-Set.
:::

### Implementation TypeScript

```typescript
// lww-register.ts — Last Writer Wins Register

interface LWWState<T> {
  value: T;
  timestamp: number;
  nodeId: string;
}

class LWWRegister<T> {
  readonly nodeId: string;
  private current: LWWState<T>;

  constructor(nodeId: string, initialValue: T) {
    this.nodeId = nodeId;
    this.current = { value: initialValue, timestamp: 0, nodeId };
  }

  // Ecrire une nouvelle valeur
  set(value: T, timestamp: number): void {
    if (
      timestamp > this.current.timestamp ||
      (timestamp === this.current.timestamp &&
        this.nodeId > this.current.nodeId)
    ) {
      this.current = { value, timestamp, nodeId: this.nodeId };
    }
  }

  get value(): T {
    return this.current.value;
  }

  get state(): LWWState<T> {
    return { ...this.current };
  }

  // Fusionner : garder l'ecriture la plus recente
  merge(remoteState: LWWState<T>): void {
    if (
      remoteState.timestamp > this.current.timestamp ||
      (remoteState.timestamp === this.current.timestamp &&
        remoteState.nodeId > this.current.nodeId)
    ) {
      this.current = { ...remoteState };
    }
  }

  toString(): string {
    return `LWWRegister("${this.current.value}", ts=${this.current.timestamp}, node=${this.current.nodeId})`;
  }
}

// --- Simulation ---
function simulateLWWRegister(): void {
  console.log('=== Simulation LWW-Register ===\n');

  const regA = new LWWRegister<string>('A', '');
  const regB = new LWWRegister<string>('B', '');

  // Ecritures concurrentes
  regA.set('Paris', 100);
  regB.set('Lyon', 105);

  console.log('Avant merge:');
  console.log(`  A: ${regA}`);
  console.log(`  B: ${regB}`);

  // Merge bidirectionnel
  regA.merge(regB.state);
  regB.merge(regA.state);

  console.log('\nApres merge:');
  console.log(`  A: ${regA}`);
  console.log(`  B: ${regB}`);
  console.log(`  → "Lyon" gagne (timestamp 105 > 100)`);

  // Scenario avec meme timestamp → le nodeId le plus grand gagne
  console.log('\n--- Meme timestamp ---');
  const regC = new LWWRegister<string>('C', '');
  const regD = new LWWRegister<string>('D', '');
  regC.set('Bleu', 200);
  regD.set('Rouge', 200);

  regC.merge(regD.state);
  regD.merge(regC.state);
  console.log(`  C: ${regC}`);
  console.log(`  D: ${regD}`);
  console.log(`  → Bris d'egalite par nodeId: "D" > "C" → "Rouge" gagne`);
}

simulateLWWRegister();
```

---

## OR-Set (Observed-Remove Set)

L'OR-Set est un ensemble CRDT qui supporte l'ajout ET la suppression d'elements sans conflit. Chaque ajout est associe a un **tag unique**. La suppression ne retire que les tags observes localement.

```
┌───────────────────────────────────────────────────────────┐
│              OR-SET (Observed-Remove Set)                    │
│                                                           │
│  Principe : chaque add() cree un tag unique                │
│  remove() supprime tous les tags observes pour cet element │
│                                                           │
│  Noeud A : add("x") → {("x", tag1)}                       │
│  Noeud B : add("x") → {("x", tag2)}                       │
│  Noeud A : remove("x") → supprime tag1 uniquement          │
│                                                           │
│  Merge : {("x", tag2)}                                     │
│  → "x" est present ! (tag2 de B n'a pas ete observe        │
│    par A au moment de la suppression)                       │
│                                                           │
│  Semantique : add gagne sur remove concurrent              │
│  ("add-wins semantics")                                    │
└───────────────────────────────────────────────────────────┘
```

### Implementation TypeScript

```typescript
// or-set.ts — Observed-Remove Set

type Tag = string;

interface ORSetState<T> {
  elements: Map<string, Set<Tag>>; // element (serialise) → tags actifs
  tombstones: Map<string, Set<Tag>>; // element → tags supprimes
}

class ORSet<T> {
  readonly nodeId: string;
  private elements: Map<string, Set<Tag>> = new Map();
  private tombstones: Map<string, Set<Tag>> = new Map();
  private tagCounter: number = 0;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  private serialize(element: T): string {
    return JSON.stringify(element);
  }

  private generateTag(): Tag {
    this.tagCounter++;
    return `${this.nodeId}:${this.tagCounter}`;
  }

  // Ajouter un element avec un tag unique
  add(element: T): void {
    const key = this.serialize(element);
    const tag = this.generateTag();

    if (!this.elements.has(key)) {
      this.elements.set(key, new Set());
    }
    this.elements.get(key)!.add(tag);

    console.log(`[${this.nodeId}] ADD "${element}" with tag ${tag}`);
  }

  // Supprimer un element : marquer tous les tags observes comme tombstones
  remove(element: T): void {
    const key = this.serialize(element);
    const tags = this.elements.get(key);

    if (!tags || tags.size === 0) {
      console.log(`[${this.nodeId}] REMOVE "${element}" — not found`);
      return;
    }

    if (!this.tombstones.has(key)) {
      this.tombstones.set(key, new Set());
    }

    const tombstoneSet = this.tombstones.get(key)!;
    for (const tag of tags) {
      tombstoneSet.add(tag);
    }
    tags.clear();

    console.log(`[${this.nodeId}] REMOVE "${element}" — tags moved to tombstones`);
  }

  // Verifier l'appartenance
  has(element: T): boolean {
    const key = this.serialize(element);
    const tags = this.elements.get(key);
    return tags !== undefined && tags.size > 0;
  }

  // Obtenir tous les elements
  values(): T[] {
    const result: T[] = [];
    for (const [key, tags] of this.elements) {
      if (tags.size > 0) {
        result.push(JSON.parse(key) as T);
      }
    }
    return result;
  }

  // Obtenir l'etat pour la synchronisation
  get state(): ORSetState<T> {
    return {
      elements: new Map(
        [...this.elements].map(([k, v]) => [k, new Set(v)]),
      ),
      tombstones: new Map(
        [...this.tombstones].map(([k, v]) => [k, new Set(v)]),
      ),
    };
  }

  // Fusionner avec l'etat d'un autre noeud
  merge(remoteState: ORSetState<T>): void {
    // Union de tous les elements
    for (const [key, remoteTags] of remoteState.elements) {
      if (!this.elements.has(key)) {
        this.elements.set(key, new Set());
      }
      for (const tag of remoteTags) {
        this.elements.get(key)!.add(tag);
      }
    }

    // Union de tous les tombstones
    for (const [key, remoteTombs] of remoteState.tombstones) {
      if (!this.tombstones.has(key)) {
        this.tombstones.set(key, new Set());
      }
      for (const tag of remoteTombs) {
        this.tombstones.get(key)!.add(tag);
      }
    }

    // Appliquer les tombstones : retirer les tags tombstoned des elements
    for (const [key, tombs] of this.tombstones) {
      const tags = this.elements.get(key);
      if (tags) {
        for (const tomb of tombs) {
          tags.delete(tomb);
        }
      }
    }
  }

  toString(): string {
    return `ORSet{${this.values().join(', ')}}`;
  }
}

// --- Simulation ---
function simulateORSet(): void {
  console.log('=== Simulation OR-Set ===\n');

  const setA = new ORSet<string>('A');
  const setB = new ORSet<string>('B');

  // A ajoute "pomme" et "banane"
  setA.add('pomme');
  setA.add('banane');

  // Synchroniser A → B
  console.log('\n--- Sync A → B ---');
  setB.merge(setA.state);
  console.log(`A: ${setA}`);
  console.log(`B: ${setB}`);

  // Operations concurrentes :
  // A supprime "pomme"
  // B ajoute "pomme" a nouveau (nouveau tag)
  console.log('\n--- Operations concurrentes ---');
  setA.remove('pomme');
  setB.add('pomme'); // Nouveau tag, pas encore vu par A

  console.log(`A (apres remove): ${setA}`);
  console.log(`B (apres add): ${setB}`);

  // Merge bidirectionnel
  console.log('\n--- Merge bidirectionnel ---');
  const stateA = setA.state;
  const stateB = setB.state;
  setA.merge(stateB);
  setB.merge(stateA);

  console.log(`A: ${setA}`);
  console.log(`B: ${setB}`);
  console.log(`→ "pomme" est presente! (add-wins: le tag de B survit)`);
  console.log(`→ "banane" aussi presente (jamais supprimee)`);
}

simulateORSet();
```

---

## Convergence : proprietes mathematiques

Les CRDTs state-based (CvRDT) forment un **semi-treillis** (join semilattice). L'operation `merge` est le supremum (least upper bound).

```
┌───────────────────────────────────────────────────────────┐
│          PROPRIETES MATHEMATIQUES DES CRDTs                │
│                                                           │
│  Pour l'operation merge (⊔) :                              │
│                                                           │
│  1. COMMUTATIVITE :  a ⊔ b = b ⊔ a                        │
│     → L'ordre de reception n'a pas d'importance            │
│                                                           │
│  2. ASSOCIATIVITE :  (a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)           │
│     → Le regroupement n'a pas d'importance                 │
│                                                           │
│  3. IDEMPOTENCE :    a ⊔ a = a                             │
│     → Fusionner deux fois donne le meme resultat           │
│     → Les messages dupliques sont inoffensifs              │
│                                                           │
│  Ces 3 proprietes garantissent la convergence :            │
│  Peu importe l'ordre, le nombre de fusions, ou les         │
│  doublons, le resultat final est le meme.                  │
└───────────────────────────────────────────────────────────┘
```

```typescript
// convergence-proof.ts — Demonstration des proprietes

function proveConvergence(): void {
  console.log('=== Demonstration de convergence ===\n');

  // Creer 3 compteurs avec des modifications independantes
  const c1 = new GCounter('X');
  const c2 = new GCounter('Y');
  const c3 = new GCounter('Z');
  c1.increment(5);
  c2.increment(3);
  c3.increment(7);

  // Commutativite : merge(c1, c2) = merge(c2, c1)
  const testA = new GCounter('test');
  testA.merge(c1.state);
  testA.merge(c2.state);

  const testB = new GCounter('test');
  testB.merge(c2.state);
  testB.merge(c1.state);

  console.log(`Commutativite: merge(c1,c2)=${testA.value}, merge(c2,c1)=${testB.value}`);
  console.log(`  → ${testA.value === testB.value ? 'VERIFIE' : 'ECHOUE'}\n`);

  // Associativite : merge(merge(c1,c2), c3) = merge(c1, merge(c2,c3))
  const testC = new GCounter('test');
  testC.merge(c1.state);
  testC.merge(c2.state);
  testC.merge(c3.state);

  const testD = new GCounter('test');
  testD.merge(c2.state);
  testD.merge(c3.state);
  const intermediate = testD.state;
  const testE = new GCounter('test');
  testE.merge(c1.state);
  testE.merge(intermediate);

  console.log(`Associativite: ((c1⊔c2)⊔c3)=${testC.value}, (c1⊔(c2⊔c3))=${testE.value}`);
  console.log(`  → ${testC.value === testE.value ? 'VERIFIE' : 'ECHOUE'}\n`);

  // Idempotence : merge(c1, c1) = c1
  const testF = new GCounter('test');
  testF.merge(c1.state);
  const valueBefore = testF.value;
  testF.merge(c1.state); // merge a nouveau
  const valueAfter = testF.value;

  console.log(`Idempotence: merge(c1)=${valueBefore}, merge(c1,c1)=${valueAfter}`);
  console.log(`  → ${valueBefore === valueAfter ? 'VERIFIE' : 'ECHOUE'}`);
}

proveConvergence();
```

---

## Applications pratiques

| Application | CRDT utilise | Pourquoi |
|-------------|-------------|----------|
| **Compteur de likes** | G-Counter ou PN-Counter | Chaque serveur incremente localement |
| **Edition collaborative** | Sequence CRDT (RGA, LSEQ) | Insertion/suppression sans conflit |
| **Panier d'achat** | OR-Set | Ajout/suppression d'articles concurrents |
| **Statut utilisateur** | LWW-Register | Derniere mise a jour gagne |
| **Cache distribue** | LWW-Register | Invalidation sans coordination |
| **Compteur d'inventaire** | PN-Counter | Increment/decrement concurrent |

:::tip Cas reel : Amazon DynamoDB
DynamoDB et son predecesseur Dynamo utilisent des concepts proches des CRDTs pour gerer les conflits sur les repliques. L'OR-Set est similaire au mecanisme de resolution de conflits utilise dans le panier d'achat d'Amazon.
:::

---

## Trade-offs des CRDTs

```
┌───────────────────────────────────────────────────────────┐
│              TRADE-OFFS DES CRDTs                           │
│                                                           │
│  AVANTAGES :                                               │
│  ✓ Convergence automatique sans coordination               │
│  ✓ Disponibilite maximale (fonctionne durant les partitions│
│  ✓ Pas de verrou, pas de consensus necessaire              │
│  ✓ Latence d'ecriture locale                               │
│                                                           │
│  INCONVENIENTS :                                           │
│  ✗ Overhead de metadonnees (tags, vecteurs)                │
│  ✗ Tombstones (elements supprimes mais toujours stockes)   │
│  ✗ Garbage collection complexe                             │
│  ✗ Modeles de donnees limites                              │
│  ✗ Pas d'operations "negatives" naturelles (sauf PN)       │
│  ✗ Taille de l'etat peut croitre indefiniment              │
│                                                           │
│  STRATEGIES DE MITIGATION :                                │
│  • Compaction periodique des tombstones                     │
│  • Epoch-based garbage collection                          │
│  • Delta-state CRDTs (envoyer seulement les deltas)        │
│  • Compression des metadonnees                              │
└───────────────────────────────────────────────────────────┘
```

---

## Resume

```
┌──────────────────────────────────────────────────────────┐
│          CRDTs : CE QU'IL FAUT RETENIR                    │
│                                                          │
│  1. CRDTs = structures de donnees qui convergent          │
│     automatiquement sans coordination                     │
│  2. Deux familles : state-based (CvRDT) et                │
│     operation-based (CmRDT)                               │
│  3. G-Counter : compteur croissant seulement              │
│  4. PN-Counter : 2 G-Counters pour +/-                    │
│  5. LWW-Register : le plus recent gagne (simple mais      │
│     perd des ecritures)                                   │
│  6. OR-Set : add-wins semantics avec tags uniques          │
│  7. Convergence garantie par 3 proprietes :               │
│     commutativite, associativite, idempotence             │
│  8. Trade-offs : overhead metadata vs disponibilite       │
└──────────────────────────────────────────────────────────┘
```

---

## Ressources complementaires

- [A comprehensive study of CRDTs](https://hal.inria.fr/inria-00555588/document) — Shapiro et al.
- [CRDTs: The Hard Parts](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html) — Martin Kleppmann
- [Designing Data-Intensive Applications, Ch. 5](https://dataintensive.net/) — Martin Kleppmann
- [Automerge](https://automerge.org/) — Bibliotheque CRDT pour JavaScript

---

## Navigation

| Precedent | Suivant |
|:---------:|:-------:|
| [22 - Stream Processing](./22-stream-processing-event-streaming.md) | [24 - Projet Final](./24-projet-final.md) |

| Lab | Quiz |
|:---:|:----:|
| [Lab 23](../labs/lab-23-crdts/) | [Quiz 23](../quizzes/quiz-23-crdts.html) |
