# Lab 11 — Replication & Partitionnement

## Objectifs

Implementer les mécanismes de replication et de partitionnement des donnees : leader-follower, résolution de conflits, consistent hashing, hash partitioning, range partitioning et rebalancing.

## Exercices

### Exercice 1 : Leader-follower
Écrire sur le leader, repliquer de manière asynchrone vers les followers, lire depuis n'importe quel noeud (lectures potentiellement perimees).

### Exercice 2 : Conflict résolution
Last-Writer-Wins (LWW) par timestamp et fonction de fusion pour les conflits multi-leader.

### Exercice 3 : Consistent hashing
Anneau de hachage avec noeuds virtuels, addNode, removeNode, getNode(key), getNodes(key, replicaCount).

### Exercice 4 : Hash partitioning
Distribuer les clés sur N partitions en utilisant le hash modulo.

### Exercice 5 : Range partitioning
Partitionner les clés par plages avec des limites configurables.

### Exercice 6 : Rebalancing
Suivre les migrations de clés lors de l'ajout/suppression de noeuds, minimiser le déplacement des donnees.

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
