# Lab 12 — Saga Pattern

## Objectifs

Implementer le pattern Saga pour gérer les transactions distribuees : actions compensatoires, orchestration, choregraphie, timeouts et journalisation des executions.

## Exercices

### Exercice 1 : Compensating transactions
Implementer une CompensableAction avec des méthodes exécuté() et compensate().

### Exercice 2 : Saga step définition
Définir un SagaStep avec un nom, une fonction d'exécution et une fonction de compensation.

### Exercice 3 : Saga orchestrator
Exécuter les étapes sequentiellement ; en cas d'echec, exécuter les compensations en ordre inverse.

### Exercice 4 : Choreography saga
Saga pilotee par les événements en utilisant createMockMessageBroker de test-utils.

### Exercice 5 : Saga with timeouts
Ajouter le support des timeouts : si une étape prend trop de temps, traiter comme un echec et compenser.

### Exercice 6 : Saga exécution log
Journaliser toutes les executions et compensations avec horodatage, produire une chronologie.

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
