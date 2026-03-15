# Lab 24 — Projet Final

## Objectifs

- Intégrer l'ensemble des concepts vus dans les labs précédents
- Implementer la communication inter-services avec propagation de correlation ID
- Construire un event store complet avec append et lecture de streams
- Orchestrer une saga complete avec transactions compensatoires
- Proteger les appels de service avec un circuit breaker
- Implementer un rate limiter avec algorithme token bucket
- Garantir la fiabilité des messages avec le pattern outbox/inbox
- Implementer des health checks agreges multi-services
- Tester un flux complet de bout en bout

## Exercices

### Exercice 1 : Service Communication
Implementer un client de service avec propagation de correlation ID et timeout configurable.

### Exercice 2 : Event Store
Implementer un event store avec les méthodes append, getStream et getAllEvents.

### Exercice 3 : Saga Orchestrator
Implementer une saga qui créé une commande, reserve le stock et traite le paiement, avec des transactions compensatoires en cas d'echec.

### Exercice 4 : Circuit Breaker
Implementer un circuit breaker qui enveloppe le client de service avec les états CLOSED, OPEN et HALF_OPEN.

### Exercice 5 : Rate Limiter
Implementer un rate limiter avec l'algorithme token bucket.

### Exercice 6 : Outbox + Inbox
Implementer le pattern de messagerie fiable avec un producteur outbox et un consommateur inbox garantissant l'idempotence.

### Exercice 7 : Health Check
Implementer des health checks agreges pour vérifier l'état de sante de tous les services.

### Exercice 8 : Intégration Test
Exécuter un flux complet de commande : créer une commande via la saga, vérifier les événements generes, vérifier l'idempotence.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-24-projet-final/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-24-projet-final/solution.ts`

## Concepts clés

- **Correlation ID** : identifiant propageant le contexte a travers les services
- **Event Store** : stockage immutable d'événements de domaine
- **Saga** : coordination de transactions distribuees avec compensations
- **Circuit Breaker** : protection contre les pannes en cascade
- **Token Bucket** : algorithme de limitation de debit
- **Outbox/Inbox** : pattern de messagerie fiable avec deduplication
- **Health Check** : vérification de l'état de sante des services
