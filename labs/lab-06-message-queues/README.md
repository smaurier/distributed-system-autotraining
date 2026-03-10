# Lab 06 — Message Queues

## Objectifs

Comprendre et implementer les mecanismes fondamentaux des files de messages : FIFO, pub/sub, consumer groups, dead letter queues, message ordering et backpressure.

## Exercices

### Exercice 1 : Simple queue
Implementer une file FIFO avec enqueue, dequeue, peek, size et isEmpty.

### Exercice 2 : Pub/Sub
Implementer un systeme pub/sub base sur des topics avec subscribe, publish et unsubscribe.

### Exercice 3 : Consumer groups
Chaque message est traite par un seul consommateur par groupe (round-robin au sein du groupe).

### Exercice 4 : Dead letter queue
DLQ qui capture les messages echoues apres maxRetries tentatives.

### Exercice 5 : Message ordering
Traitement ordonne avec numeros de sequence, detection de trous et tampon de reordonnancement.

### Exercice 6 : Backpressure
File bornee avec strategie de debordement configurable ('drop-newest' | 'drop-oldest' | 'reject').

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
