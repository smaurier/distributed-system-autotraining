# Lab 16 — Circuit Breaker & Bulkhead

## Objectifs

- Implementer le pattern Circuit Breaker avec les etats closed, open et half-open
- Compter les echecs dans une fenetre glissante pour declencher l'ouverture
- Gerer la recuperation en half-open avec des requetes de test limitees
- Implementer le pattern Bulkhead avec un semaphore de concurrence
- Construire une file d'attente avec backpressure et strategies de debordement
- Combiner circuit breaker, bulkhead et timeout dans un wrapper de resilience

## Exercices

### Exercice 1 : Circuit Breaker
Implementer un CircuitBreaker avec les etats closed, open et half-open. Le circuit s'ouvre apres un seuil d'echecs et se ferme apres un delai de reset.

### Exercice 2 : Failure Counting
Compter les echecs dans une fenetre glissante temporelle. Le circuit s'ouvre quand le seuil est depasse.

### Exercice 3 : Half-Open Recovery
En etat half-open, autoriser un nombre limite de requetes de test. Sur succes, revenir a closed. Sur echec, revenir a open.

### Exercice 4 : Bulkhead
Implementer un semaphore limitant le nombre maximal d'appels concurrents. Les appels sont rejetes quand le bulkhead est plein.

### Exercice 5 : Backpressure Queue
Implementer une file d'attente bornee avec les strategies de debordement 'drop-newest' et 'reject'.

### Exercice 6 : Combined Resilience
Combiner circuit breaker + bulkhead + timeout dans une seule fonction wrapper de resilience.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-16-circuit-breaker/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-16-circuit-breaker/solution.ts`

## Concepts cles

- **Circuit Breaker** : coupe-circuit qui empeche les appels a un service defaillant
- **Closed** : etat normal, les requetes passent
- **Open** : etat de protection, les requetes sont rejetees immediatement
- **Half-Open** : etat de test, quelques requetes sont autorisees pour verifier la recuperation
- **Bulkhead** : isolation des ressources pour limiter l'impact d'une defaillance
- **Backpressure** : mecanisme de controle de flux pour gerer la surcharge
