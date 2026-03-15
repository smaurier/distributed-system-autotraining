# Lab 10 — Coherence & CAP

## Objectifs

Explorer les modèles de coherence dans les systèmes distribues et comprendre le théorème CAP a travers des simulations : coherence forte, coherence eventuelle, quorums, partitions réseau, read repair et coherence ajustable.

## Exercices

### Exercice 1 : Strong consistency store
Store single-leader ou les lectures voient toujours la dernière écriture, avec simulation du lag de replication.

### Exercice 2 : Eventual consistency
Store avec replication asynchrone, les lectures peuvent retourner des donnees perimees, converge avec le temps.

### Exercice 3 : Quorum system
Implementer les ecritures/lectures avec W, R, N configurables ; coherence forte quand W+R>N.

### Exercice 4 : CAP simulation
Système a 3 noeuds, injection de partition, vérification que CP rejette les ecritures vs AP accepte avec lectures perimees.

### Exercice 5 : Read repair
Lors des lectures quorum, si les repliques divergent, reparer les repliques perimees avec la valeur la plus recente.

### Exercice 6 : Tunable consistency
Store avec niveaux de coherence : ONE (plus rapide), QUORUM (equilibre), ALL (plus fort).

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
