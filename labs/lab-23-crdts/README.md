# Lab 23 — CRDTs

## Objectifs

- Comprendre les Conflict-free Replicated Data Types (CRDTs) et leur role dans la replication
- Implementer un G-Counter (compteur en croissance seule) avec merge entre replicas
- Implementer un PN-Counter en combinant deux G-Counters
- Implementer un registre Last-Writer-Wins (LWW-Register) avec timestamps
- Implementer un OR-Set (Observed-Remove Set) avec semantique add-wins
- Prouver la convergence en verifiant les propriétés de commutativite, associativite et idempotence
- Simuler plusieurs replicas avec operations concurrentes et vérifier la convergence

## Exercices

### Exercice 1 : G-Counter
Implementer un compteur en croissance seule (grow-only). Chaque replica a son propre compteur, et le merge prend le maximum par replica.

### Exercice 2 : PN-Counter
Implementer un compteur positif-negatif en utilisant deux G-Counters : un pour les increments et un pour les decrements.

### Exercice 3 : LWW-Register
Implementer un registre Last-Writer-Wins ou la dernière écriture (selon le timestamp) l'emporte lors du merge.

### Exercice 4 : OR-Set
Implementer un ensemble Observed-Remove avec semantique add-wins. Chaque ajout généré un tag unique, et les suppressions ne retirent que les tags observes.

### Exercice 5 : Convergence Proof
Vérifier que le merge du G-Counter est commutatif (merge(a,b) == merge(b,a)), associatif (merge(merge(a,b),c) == merge(a,merge(b,c))) et idempotent (merge(a,a) == a).

### Exercice 6 : Multi-Replica Simulation
Simuler 3 replicas avec des operations concurrentes, propager les états, et vérifier que toutes les replicas convergent vers la même valeur.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-23-crdts/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-23-crdts/solution.ts`

## Concepts clés

- **CRDT** : structure de donnees qui converge automatiquement sans coordination
- **G-Counter** : compteur qui ne peut que croitre, merge par maximum
- **PN-Counter** : compteur avec support du decrement via deux G-Counters
- **LWW-Register** : registre ou le dernier ecrivain gagne
- **OR-Set** : ensemble avec suppression observable et semantique add-wins
- **Convergence** : propriété garantie par commutativite, associativite et idempotence du merge
