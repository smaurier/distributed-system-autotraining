# Lab 11 — Replication & Partitionnement

## Objectifs

Implementer les mecanismes de replication et de partitionnement des donnees : leader-follower, resolution de conflits, consistent hashing, hash partitioning, range partitioning et rebalancing.

## Exercices

### Exercice 1 : Leader-follower
Ecrire sur le leader, repliquer de maniere asynchrone vers les followers, lire depuis n'importe quel noeud (lectures potentiellement perimees).

### Exercice 2 : Conflict resolution
Last-Writer-Wins (LWW) par timestamp et fonction de fusion pour les conflits multi-leader.

### Exercice 3 : Consistent hashing
Anneau de hachage avec noeuds virtuels, addNode, removeNode, getNode(key), getNodes(key, replicaCount).

### Exercice 4 : Hash partitioning
Distribuer les cles sur N partitions en utilisant le hash modulo.

### Exercice 5 : Range partitioning
Partitionner les cles par plages avec des limites configurables.

### Exercice 6 : Rebalancing
Suivre les migrations de cles lors de l'ajout/suppression de noeuds, minimiser le deplacement des donnees.

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
