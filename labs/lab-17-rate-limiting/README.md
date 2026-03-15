# Lab 17 — Rate Limiting

## Objectifs

- Comprendre les différentes stratégies de limitation de debit
- Implementer un rate limiter a fenêtre fixe
- Implementer un rate limiter a fenêtre glissante avec ponderation
- Implementer l'algorithme du token bucket avec burst
- Générer les headers HTTP standards de rate limiting
- Implementer des limites differenciees par niveau de priorite
- Implementer le load shedding base sur les metriques système

## Exercices

### Exercice 1 : Fixed Window
Compter les requêtes par fenêtre de temps fixe. Rejeter les requêtes quand la limite est atteinte.

### Exercice 2 : Sliding Window
Compteur a fenêtre glissante utilisant la fenêtre courante et la fenêtre précédente ponderee pour lisser les transitions.

### Exercice 3 : Token Bucket
Remplir les tokens à un taux fixe, consommer un token par requête. Permettre des bursts jusqu'au nombre maximum de tokens.

### Exercice 4 : Rate Limit Headers
Générer les headers HTTP de rate limiting : X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset et Retry-After.

### Exercice 5 : Priority Rate Limiting
Limites de debit différentes selon le niveau de priorite : high=100/min, normal=50/min, low=10/min.

### Exercice 6 : Load Shedding
Rejeter les requêtes quand la charge système (CPU, mémoire, latence) dépasse des seuils configurables.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-17-rate-limiting/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-17-rate-limiting/solution.ts`

## Concepts clés

- **Fixed Window** : comptage par intervalle fixe, simple mais sujet au problème de bord
- **Sliding Window** : lissage entre fenetres pour éviter les pics aux frontieres
- **Token Bucket** : algorithme flexible permettant les bursts controles
- **Rate Limit Headers** : headers HTTP standardises pour communiquer les limites au client
- **Priority Limiting** : differentiation des limites selon l'importance des requêtes
- **Load Shedding** : rejet proactif des requêtes pour proteger le système en surcharge
