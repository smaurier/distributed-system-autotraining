# Lab 17 — Rate Limiting

## Objectifs

- Comprendre les differentes strategies de limitation de debit
- Implementer un rate limiter a fenetre fixe
- Implementer un rate limiter a fenetre glissante avec ponderation
- Implementer l'algorithme du token bucket avec burst
- Generer les headers HTTP standards de rate limiting
- Implementer des limites differenciees par niveau de priorite
- Implementer le load shedding base sur les metriques systeme

## Exercices

### Exercice 1 : Fixed Window
Compter les requetes par fenetre de temps fixe. Rejeter les requetes quand la limite est atteinte.

### Exercice 2 : Sliding Window
Compteur a fenetre glissante utilisant la fenetre courante et la fenetre precedente ponderee pour lisser les transitions.

### Exercice 3 : Token Bucket
Remplir les tokens a un taux fixe, consommer un token par requete. Permettre des bursts jusqu'au nombre maximum de tokens.

### Exercice 4 : Rate Limit Headers
Generer les headers HTTP de rate limiting : X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset et Retry-After.

### Exercice 5 : Priority Rate Limiting
Limites de debit differentes selon le niveau de priorite : high=100/min, normal=50/min, low=10/min.

### Exercice 6 : Load Shedding
Rejeter les requetes quand la charge systeme (CPU, memoire, latence) depasse des seuils configurables.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-17-rate-limiting/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-17-rate-limiting/solution.ts`

## Concepts cles

- **Fixed Window** : comptage par intervalle fixe, simple mais sujet au probleme de bord
- **Sliding Window** : lissage entre fenetres pour eviter les pics aux frontieres
- **Token Bucket** : algorithme flexible permettant les bursts controles
- **Rate Limit Headers** : headers HTTP standardises pour communiquer les limites au client
- **Priority Limiting** : differentiation des limites selon l'importance des requetes
- **Load Shedding** : rejet proactif des requetes pour proteger le systeme en surcharge
