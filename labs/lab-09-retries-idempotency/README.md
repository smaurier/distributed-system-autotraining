# Lab 09 — Retries & Idempotency

## Objectifs

- Comprendre les stratégies de retry dans les systèmes distribues
- Implementer le backoff exponentiel avec jitter
- Mettre en place un budget de retries pour limiter la charge
- Implementer un timeout wrapper avec Promise.race
- Construire un store de clés d'idempotence avec TTL
- Implementer un wrapper idempotent pour les handlers
- Combiner retries, timeout et idempotence dans un client resilient

## Exercices

### Exercice 1 : Exponential Backoff
Implementer une fonction de retry avec backoff exponentiel et jitter aleatoire pour éviter les thundering herds.

### Exercice 2 : Retry with Budget
Implementer un budget de retries qui limite le nombre total de retries par fenêtre de temps.

### Exercice 3 : Timeout Wrapper
Implementer une fonction timeout utilisant Promise.race pour limiter le temps d'attente d'une operation.

### Exercice 4 : Idempotency Key Store
Implementer un key-value store pour les clés d'idempotence avec expiration TTL automatique.

### Exercice 5 : Idempotent Handler
Implementer un wrapper de fonction qui met en cache les résultats par clé d'idempotence.

### Exercice 6 : Resilient Client
Combiner retries + timeout + idempotence dans une seule fonction d'appel resiliente.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-09-retries-idempotency/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-09-retries-idempotency/solution.ts`

## Concepts clés

- **Exponential Backoff** : delai croissant entre les retries (base * 2^attempt)
- **Jitter** : composante aleatoire ajoutee au backoff pour éviter la synchronisation
- **Retry Budget** : limite du nombre de retries pour proteger le système
- **Timeout** : temps maximum d'attente pour une operation
- **Idempotency Key** : identifiant unique garantissant qu'une operation n'est executee qu'une fois
- **TTL** : Time-To-Live, duree de vie d'une entree en cache
