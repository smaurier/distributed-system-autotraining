# Lab 15 — Failure Modes

## Objectifs

- Comprendre les differents modes de defaillance dans les systemes distribues
- Simuler des pannes partielles ou seuls certains services echouent
- Observer la propagation de defaillances en cascade (A -> B -> C)
- Detecter les defaillances grises avec un taux d'erreur en fenetre glissante
- Implementer la validation fail-fast pour eviter les operations couteuses
- Calculer le rayon d'impact (blast radius) des pannes
- Implementer un detecteur de defaillance base sur les heartbeats

## Exercices

### Exercice 1 : Partial Failure Simulation
Simuler l'appel a N services dont certains echouent aleatoirement. Retourner le resultat par service avec son statut (success/failure).

### Exercice 2 : Cascading Failure
Simuler une chaine A -> B -> C ou la defaillance de C cause un timeout de B, qui cause la defaillance de A. Tracer la propagation.

### Exercice 3 : Gray Failure Detection
Calculer le taux d'erreur dans une fenetre glissante. Detecter une defaillance grise quand le taux est entre 5% et 50%.

### Exercice 4 : Fail-Fast Validation
Implementer un verificateur de preconditions qui valide les entrees avant de lancer des operations couteuses.

### Exercice 5 : Blast Radius Calculation
Etant donne N cellules avec M utilisateurs chacune, calculer le pourcentage d'utilisateurs affectes quand K cellules tombent en panne.

### Exercice 6 : Heartbeat Detector
Implementer un detecteur de defaillance base sur les heartbeats : les noeuds envoient des heartbeats, le detecteur marque les noeuds comme suspects puis defaillants apres un timeout.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-15-failure-modes/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-15-failure-modes/solution.ts`

## Concepts cles

- **Partial Failure** : certains composants echouent tandis que d'autres continuent de fonctionner
- **Cascading Failure** : une defaillance se propage d'un service a ses dependants
- **Gray Failure** : defaillance subtile ou le systeme est degrade mais pas completement en panne
- **Fail-Fast** : rejeter rapidement les requetes invalides avant de consommer des ressources
- **Blast Radius** : mesure de l'impact d'une defaillance sur les utilisateurs
- **Heartbeat** : signal periodique indiquant qu'un noeud est vivant
