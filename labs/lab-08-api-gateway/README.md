# Lab 08 — API Gateway

## Objectifs

- Comprendre le role de l'API Gateway dans une architecture microservices
- Implementer le routage de requêtes vers les services backend
- Agreger les réponses de plusieurs services en une seule réponse
- Propager l'authentification (JWT) vers les services downstream
- Mettre en place du rate limiting par client (token bucket)
- Injecter des correlation IDs pour le tracing distribue
- Combiner routage, auth, rate limiting et circuit breaker dans un gateway complet

## Exercices

### Exercice 1 : Route Mapping
Implementer un matcher de routes qui mappe les chemins entrants vers les URLs de services backend, avec support des path parameters.

### Exercice 2 : Request Aggregation
Implementer une fonction qui appelle plusieurs services en parallele et combine leurs réponses en un seul objet.

### Exercice 3 : Auth Propagation
Implementer l'extraction de JWT depuis les headers et sa propagation vers les services downstream.

### Exercice 4 : Rate Limiting Middleware
Implementer un rate limiter par client utilisant l'algorithme token bucket.

### Exercice 5 : Correlation ID Injection
Implementer un middleware qui ajoute un correlation ID unique à chaque requête pour le tracing distribue.

### Exercice 6 : Gateway with Circuit Breaker
Combiner routage, auth, rate limiting et circuit breaker dans une fonction gateway complete.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-08-api-gateway/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-08-api-gateway/solution.ts`

## Concepts clés

- **API Gateway** : point d'entree unique pour les clients, reverse proxy intelligent
- **Route Mapping** : association entre chemins publics et services internes
- **Request Aggregation** : composition de plusieurs appels backend en une réponse
- **JWT Propagation** : transmission du token d'authentification aux services
- **Token Bucket** : algorithme de rate limiting base sur des jetons consommes par requête
- **Correlation ID** : identifiant unique propag a travers tous les services pour le tracing
- **Circuit Breaker** : protection contre les services defaillants
