# Lab 20 — Consensus & Raft

## Objectifs

- Comprendre le protocole de consensus Raft et ses mecanismes fondamentaux
- Implementer l'election de leader avec termes, votes et timeouts aleatoires
- Gerer le RequestVote RPC pour accorder ou refuser un vote
- Implementer la replication de log via AppendEntries
- Detecter quand une entree peut etre commitee (majorite)
- Implementer des verrous distribues avec fencing tokens
- Prevenir le split brain avec un systeme base sur le quorum

## Exercices

### Exercice 1 : Leader Election
Implementer l'election de leader Raft avec termes, votes et timeouts aleatoires. Un noeud demarre comme follower, devient candidat apres un timeout, et se fait elire leader s'il recoit la majorite des votes.

### Exercice 2 : Vote Handling
Implementer le RPC RequestVote : un noeud accorde son vote si le terme du candidat est >= au sien et si le log du candidat est au moins aussi a jour.

### Exercice 3 : Log Replication
Implementer AppendEntries : le leader envoie des entrees aux followers, qui les ajoutent a leur log et acquittent.

### Exercice 4 : Commit Detection
Implementer l'avancement du commit index lorsque la majorite des followers a acquitte une entree.

### Exercice 5 : Distributed Lock with Fencing
Implementer un service de verrou distribue qui emet des fencing tokens monotonement croissants pour eviter les operations perimees.

### Exercice 6 : Split Brain Prevention
Implementer un systeme base sur le quorum qui refuse les operations si la majorite des noeuds n'est pas disponible.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-20-consensus-raft/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-20-consensus-raft/solution.ts`

## Concepts cles

- **Terme (Term)** : periode d'election dans Raft, incrementee a chaque nouvelle election
- **Leader Election** : processus par lequel un candidat obtient la majorite des votes
- **Log Replication** : mecanisme par lequel le leader propage les entrees aux followers
- **Commit Index** : indice de la derniere entree replicee sur la majorite
- **Fencing Token** : jeton monotonement croissant empechant les ecritures perimees
- **Quorum** : majorite de noeuds necessaire pour valider une operation
