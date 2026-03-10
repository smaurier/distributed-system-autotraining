# Lab 22 — Stream Processing

## Objectifs

- Comprendre les principes du traitement de flux (stream processing)
- Implementer un log partitionne en append-only avec routage par cle
- Gerer des groupes de consommateurs avec assignation des partitions
- Implementer l'agregation en fenetre tumbling (fixe, non-chevauchante)
- Implementer l'agregation en fenetre glissante (sliding window)
- Comprendre la dualite stream-table et implementer la jointure
- Simuler le traitement exactly-once avec consommateur idempotent et outbox

## Exercices

### Exercice 1 : Partitioned Log
Implementer un log partitionne en append-only avec un nombre configurable de partitions. Les messages sont routes vers une partition basee sur un hash de la cle.

### Exercice 2 : Consumer Groups
Implementer l'assignation des partitions aux consommateurs d'un groupe. Chaque partition est assignee a exactement un consommateur, et les partitions sont reparties equitablement.

### Exercice 3 : Tumbling Window
Implementer l'agregation en fenetre tumbling : fenetres de taille fixe, non-chevauchantes, qui collectent et agregent les evenements.

### Exercice 4 : Sliding Window
Implementer une fenetre glissante avec taille et intervalle de glissement configurables.

### Exercice 5 : Stream-Table Join
Implementer la dualite stream-table : les evenements mettent a jour une table, et les changements de table produisent des evenements.

### Exercice 6 : Exactly-Once Simulation
Implementer un consommateur idempotent et un producteur outbox pour garantir le traitement exactly-once.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-22-stream-processing/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-22-stream-processing/solution.ts`

## Concepts cles

- **Partitioned Log** : log divise en partitions pour le parallelisme
- **Consumer Group** : groupe de consommateurs se partageant les partitions
- **Tumbling Window** : fenetre fixe non-chevauchante pour l'agregation temporelle
- **Sliding Window** : fenetre qui glisse dans le temps avec chevauchement
- **Stream-Table Duality** : un stream peut etre materialise en table et vice-versa
- **Exactly-Once** : garantie de traitement unique via idempotence et outbox
