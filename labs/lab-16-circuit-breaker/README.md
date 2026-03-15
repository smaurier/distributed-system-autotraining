# Lab 16 — Circuit Breaker & Bulkhead

## Objectifs

- Implementer le pattern Circuit Breaker avec les états closed, open et half-open
- Compter les echecs dans une fenêtre glissante pour declencher l'ouverture
- Gérer la récupération en half-open avec des requêtes de test limitees
- Implementer le pattern Bulkhead avec un semaphore de concurrence
- Construire une file d'attente avec backpressure et stratégies de debordement
- Combiner circuit breaker, bulkhead et timeout dans un wrapper de résilience

## Exercices

### Exercice 1 : Circuit Breaker
Implementer un CircuitBreaker avec les états closed, open et half-open. Le circuit s'ouvre après un seuil d'echecs et se ferme après un delai de reset.

### Exercice 2 : Failure Counting
Compter les echecs dans une fenêtre glissante temporelle. Le circuit s'ouvre quand le seuil est dépasse.

### Exercice 3 : Half-Open Recovery
En état half-open, autoriser un nombre limite de requêtes de test. Sur succes, revenir a closed. Sur echec, revenir a open.

### Exercice 4 : Bulkhead
Implementer un semaphore limitant le nombre maximal d'appels concurrents. Les appels sont rejetes quand le bulkhead est plein.

### Exercice 5 : Backpressure Queue
Implementer une file d'attente bornee avec les stratégies de debordement 'drop-newest' et 'reject'.

### Exercice 6 : Combined Résilience
Combiner circuit breaker + bulkhead + timeout dans une seule fonction wrapper de résilience.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-16-circuit-breaker/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-16-circuit-breaker/solution.ts`

## Concepts clés

- **Circuit Breaker** : coupe-circuit qui empeche les appels à un service defaillant
- **Closed** : état normal, les requêtes passent
- **Open** : état de protection, les requêtes sont rejetees immediatement
- **Half-Open** : état de test, quelques requêtes sont autorisees pour vérifier la récupération
- **Bulkhead** : isolation des ressources pour limiter l'impact d'une defaillance
- **Backpressure** : mécanisme de controle de flux pour gérer la surcharge
