# Screencast 23 — CRDTs & Resolution de Conflits

## Informations
- **Duree estimee** : 18-20 min
- **Module** : `modules/23-crdts-resolution-conflits.md`
- **Lab associe** : Lab 23
- **Prérequis** : Screencast 22

## Setup
- [ ] VS Code ouvert dans `distributed-systems-course/`
- [ ] Terminal intégré ouvert
- [ ] Fichier `modules/23-crdts-resolution-conflits.md` ouvert
- [ ] Terminal supplementaire pour les demos
- [ ] Fichier `labs/lab-23-crdts/` pret

## Script

### [00:00-02:00] Introduction — Le problème des conflits

> En eventual consistency, deux noeuds peuvent modifier la même donnee en parallele sans se coordonner. Quand ils se synchronisent, il y à un conflit. Les stratégies classiques — last-write-wins, merge manuel — sont fragiles. Les CRDTs (Conflict-free Replicated Data Types) resolvent ce problème par construction : les conflits sont mathematiquement impossibles.

**Action** : Ouvrir le module 23 et afficher le diagramme du conflit.

```
CONFLIT CLASSIQUE :

Node A: counter = 5 → increment → counter = 6
Node B: counter = 5 → increment → counter = 6

Synchronisation : counter = 6 ??? Devrait etre 7 !

CRDT (G-Counter) :

Node A: {A: 3, B: 2} → increment A → {A: 4, B: 2}
Node B: {A: 3, B: 2} → increment B → {A: 3, B: 3}

Merge: {A: max(4,3), B: max(2,3)} = {A: 4, B: 3} → total = 7 ✅
```

> Le secret des CRDTs : au lieu de stocker une seule valeur, chaque noeud stocke sa contribution. Le merge prend le maximum de chaque composante. C'est mathematiquement garanti de converger vers le bon résultat.

### [02:00-06:00] G-Counter — Le compteur qui ne decroit jamais

> Le G-Counter (Grow-only Counter) est le CRDT le plus simple. Chaque noeud a son propre compteur. La valeur globale est la somme.

**Action** : Créer un fichier `crdts.ts`.

```typescript
class GCounter {
  private counters: Map<string, number>;

  constructor(public nodeId: string, nodeIds: string[]) {
    this.counters = new Map();
    for (const id of nodeIds) {
      this.counters.set(id, 0);
    }
  }

  increment(amount: number = 1): void {
    const current = this.counters.get(this.nodeId) ?? 0;
    this.counters.set(this.nodeId, current + amount);
  }

  value(): number {
    let total = 0;
    for (const count of this.counters.values()) {
      total += count;
    }
    return total;
  }

  merge(other: GCounter): void {
    for (const [nodeId, count] of other.counters) {
      const current = this.counters.get(nodeId) ?? 0;
      this.counters.set(nodeId, Math.max(current, count));
    }
  }

  getState(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

// Demo
const nodes = ['A', 'B', 'C'];
const counterA = new GCounter('A', nodes);
const counterB = new GCounter('B', nodes);
const counterC = new GCounter('C', nodes);

console.log('=== G-Counter Demo ===\n');

// Chaque noeud incremente independamment
counterA.increment(3);
counterB.increment(5);
counterC.increment(2);

console.log(`Before merge: A=${counterA.value()}, B=${counterB.value()}, C=${counterC.value()}`);
// A=3, B=5, C=2 — chacun ne voit que sa propre contribution

// Merge
counterA.merge(counterB);
counterA.merge(counterC);
console.log(`After merge on A: ${counterA.value()}`); // 10
console.log(`State: ${JSON.stringify(counterA.getState())}`); // {A:3, B:5, C:2}
```

### [06:00-09:00] PN-Counter — Incrementer ET decrementer

> Le G-Counter ne peut que croitre. Pour permettre la decrementation, le PN-Counter utilise deux G-Counters : un pour les increments (P) et un pour les decrements (N).

**Action** : Implementer le PN-Counter.

```typescript
class PNCounter {
  private P: GCounter; // Positive
  private N: GCounter; // Negative

  constructor(public nodeId: string, nodeIds: string[]) {
    this.P = new GCounter(nodeId, nodeIds);
    this.N = new GCounter(nodeId, nodeIds);
  }

  increment(amount: number = 1): void {
    this.P.increment(amount);
  }

  decrement(amount: number = 1): void {
    this.N.increment(amount);
  }

  value(): number {
    return this.P.value() - this.N.value();
  }

  merge(other: PNCounter): void {
    this.P.merge(other.P);
    this.N.merge(other.N);
  }
}

// Demo : stock d'un produit
const stockA = new PNCounter('A', ['A', 'B']);
const stockB = new PNCounter('B', ['A', 'B']);

console.log('\n=== PN-Counter (Stock) ===\n');

// Noeuds A et B recoivent des commandes en parallele
stockA.increment(100);  // Approvisionnement
stockA.decrement(3);    // Vente sur noeud A
stockB.decrement(5);    // Vente sur noeud B

console.log(`Stock A: ${stockA.value()}`); // 97 (ne voit pas les ventes de B)
console.log(`Stock B: ${stockB.value()}`); // -5 (ne voit pas l'approvisionnement)

// Apres synchronisation
stockA.merge(stockB);
stockB.merge(stockA);
console.log(`After merge — A: ${stockA.value()}, B: ${stockB.value()}`); // 92 et 92
```

> Le PN-Counter est ideal pour les compteurs de stock, les likes/dislikes, ou tout ce qui doit pouvoir monter et descendre. La convergence est garantie : après le merge, tous les noeuds ont la même valeur.

### [09:00-13:00] LWW-Register et OR-Set

> Pour stocker des valeurs arbitraires (pas juste des compteurs), on utilise le LWW-Register (Last-Writer-Wins) et l'OR-Set (Observed-Remove Set).

**Action** : Implementer les deux structures.

```typescript
// LWW-Register : la derniere ecriture gagne (basee sur le timestamp)
class LWWRegister<T> {
  private value: T | null = null;
  private timestamp = 0;
  public nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  set(value: T, timestamp: number = Date.now()): void {
    if (timestamp > this.timestamp) {
      this.value = value;
      this.timestamp = timestamp;
    }
  }

  get(): T | null {
    return this.value;
  }

  merge(other: LWWRegister<T>): void {
    if (other.timestamp > this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
    }
  }

  getTimestamp(): number {
    return this.timestamp;
  }
}

// OR-Set (Observed-Remove Set) : ajout et suppression concurrents
class ORSet<T> {
  private elements: Map<string, { value: T; addedBy: string; tag: string }> = new Map();
  public nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  add(value: T): void {
    const tag = `${this.nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.elements.set(tag, { value, addedBy: this.nodeId, tag });
  }

  remove(value: T): void {
    // Supprimer tous les tags associes a cette valeur
    for (const [tag, entry] of this.elements) {
      if (JSON.stringify(entry.value) === JSON.stringify(value)) {
        this.elements.delete(tag);
      }
    }
  }

  has(value: T): boolean {
    const serialized = JSON.stringify(value);
    for (const entry of this.elements.values()) {
      if (JSON.stringify(entry.value) === serialized) return true;
    }
    return false;
  }

  values(): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const entry of this.elements.values()) {
      const key = JSON.stringify(entry.value);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(entry.value);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): void {
    // Union des elements
    for (const [tag, entry] of other.elements) {
      if (!this.elements.has(tag)) {
        this.elements.set(tag, entry);
      }
    }
  }
}
```

**Action** : Demontrer l'OR-Set avec un conflit add/remove.

```typescript
console.log('\n=== OR-Set Demo ===\n');

const cartA = new ORSet<string>('A');
const cartB = new ORSet<string>('B');

// Les deux noeuds voient le meme panier initial
cartA.add('TypeScript Book');
cartA.add('Node.js Guide');
cartB.merge(cartA); // Synchronisation initiale

console.log('Initial cart:', cartB.values());

// Conflit : A supprime "TypeScript Book", B ajoute "TypeScript Book" (re-ajout)
cartA.remove('TypeScript Book');
cartB.add('TypeScript Book'); // Re-ajout concurrent

console.log('Cart A (after remove):', cartA.values());
console.log('Cart B (after re-add):', cartB.values());

// Merge — l'ajout gagne sur la suppression (add-wins semantics)
cartA.merge(cartB);
console.log('Cart A after merge:', cartA.values());
// "TypeScript Book" est present — l'intent de B (ajouter) est preserve
```

> L'OR-Set à une semantique "add-wins" : si un noeud ajoute un élément pendant qu'un autre le supprime, l'ajout gagne. C'est le comportement intuitif pour un panier e-commerce : si un utilisateur ajoute un article depuis son mobile pendant que son navigateur desktop le supprime, l'ajout devrait gagner.

### [13:00-16:30] Convergence demo — Tous les noeuds convergent

> La propriété fondamentale des CRDTs : après avoir echange leurs états, tous les noeuds ont exactement la même valeur, quel que soit l'ordre des operations et des merges.

**Action** : Demontrer la convergence avec plusieurs noeuds.

```typescript
console.log('\n=== Convergence Demo (5 noeuds) ===\n');

const nodeIds = ['N1', 'N2', 'N3', 'N4', 'N5'];
const counters = nodeIds.map(id => new PNCounter(id, nodeIds));

// Chaque noeud fait des operations independantes
counters[0].increment(10);
counters[1].increment(20);
counters[2].increment(5);
counters[3].decrement(3);
counters[4].increment(8);
counters[4].decrement(2);

console.log('Before convergence:');
for (const c of counters) {
  console.log(`  ${c.nodeId}: ${c.value()}`);
}

// Synchronisation complete (chaque noeud merge avec tous les autres)
for (const target of counters) {
  for (const source of counters) {
    if (target.nodeId !== source.nodeId) {
      target.merge(source);
    }
  }
}

console.log('\nAfter convergence:');
for (const c of counters) {
  console.log(`  ${c.nodeId}: ${c.value()}`);
}

// Verifier que toutes les valeurs sont identiques
const values = counters.map(c => c.value());
const allEqual = values.every(v => v === values[0]);
console.log(`\nAll equal: ${allEqual} (value: ${values[0]})`);
// Attendu : 10 + 20 + 5 - 3 + 8 - 2 = 38
```

> Peu importe l'ordre des merges, le résultat est toujours 38. C'est la "Strong Eventual Consistency" : si tous les noeuds ont recu les memes operations, ils convergent vers le même état. Pas besoin de coordination, pas besoin de consensus, pas besoin de leader.

### [16:30-18:30] Cas d'usage et limites

**Action** : Afficher le tableau des cas d'usage.

```
CRDT         | CAS D'USAGE               | LIMITES
─────────────|───────────────────────────|──────────────────────────
G-Counter    | Compteurs de vues, likes  | Ne peut pas decroitre
PN-Counter   | Stock, solde, quotas      | Peut devenir negatif
LWW-Register | Config partagee, profil   | Perd les ecritures concurrentes
OR-Set       | Panier, tags, favoris     | Metadata grandit avec les ops
G-Set        | Membres d'un groupe       | Pas de suppression
LWW-Map      | Document collaboratif     | Conflit par champ
```

```typescript
// En pratique : Redis CRDT, Riak, Automerge, Yjs
// Utilisations reelles :
// - Figma : edition collaborative en temps reel (CRDTs)
// - SoundCloud : compteurs de lectures (G-Counter)
// - Phoenix Framework : Presence (OR-Set)
// - Cassandra : compteurs distribues (PN-Counter)
```

> Les CRDTs ne sont pas une solution universelle. Ils ne gerent pas les contraintes globales (comme "le stock ne peut pas etre negatif sur l'ensemble du système"). Pour ça, il faut du consensus (Raft). Le choix depend du cas d'usage.

### [18:30-19:30] Récapitulatif

> Recapitulons. Les CRDTs resolvent les conflits par construction mathematique. Le G-Counter somme les contributions par noeud. Le PN-Counter combine deux G-Counters pour la decrementation. L'OR-Set utilise des tags uniques pour l'add-wins. Et la convergence est garantie : tous les noeuds finissent avec la même valeur.

**Action** : Afficher le récapitulatif.

```
CE QU'IL FAUT RETENIR :
1. CRDTs = structures de donnees sans conflit par construction
2. G-Counter : chaque noeud a son compteur, merge = max
3. PN-Counter : P (increments) - N (decrements)
4. OR-Set : tags uniques, add-wins semantics
5. Convergence garantie apres echange d'etats
6. CRDTs ≠ consensus — pas de contraintes globales

PROCHAINE ETAPE :
→ Screencast 24 : Projet final — Architecture complète
```

> Au dernier screencast, on va assembler tout ce qu'on a appris dans un projet complet : microservices, events, saga, CQRS, CRDTs, observabilité. A bientot pour la grande finale !

## Points d'attention pour l'enregistrement
- Le diagramme du conflit classique vs G-Counter en intro est très parlant
- Montrer les états internes ({A:3, B:5}) pas juste la valeur totale
- L'OR-Set avec le conflit add/remove est le moment clé — bien montrer que l'ajout gagne
- La demo de convergence sur 5 noeuds doit montrer l'egalite finale explicitement
- Les cas d'usage réels (Figma, SoundCloud) rendent les CRDTs concrets
- Prendre un rythme calme — les CRDTs sont un concept nouveau pour la plupart
