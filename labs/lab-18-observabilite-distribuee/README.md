# Lab 18 — Observabilité distribuee

## Objectifs

- Comprendre les trois piliers de l'observabilité : logs, traces, metriques
- Implementer la propagation de correlation IDs entre services
- Construire un logger structure avec contexte distribue
- Implementer un collecteur de spans pour le tracing distribue
- Agreger les health checks de multiples dépendances
- Calculer les metriques RED (Rate, Error rate, Duration)
- Définir et évaluer des regles d'alerte sur les metriques

## Exercices

### Exercice 1 : Correlation ID
Générer un UUID v4 et créer un middleware qui ajoute un correlationId au contexte de la requête.

### Exercice 2 : Structured Distributed Log
Implementer un logger structure avec nom de service, correlationId, timestamp, niveau et message au format JSON.

### Exercice 3 : Request Tracing
Implementer un collecteur de spans : startSpan(name) retourne un spanId, endSpan(spanId) ferme le span, getTrace() retourne l'arbre de spans.

### Exercice 4 : Health Check Aggregator
Enregistrer des checks de dépendances, les exécuter tous, retourner un statut agrege (healthy, degraded, unhealthy).

### Exercice 5 : RED Metrics
Calculer les metriques RED à partir de donnees de requêtes : Rate (requêtes/sec), Error rate (%), Duration (p50/p95/p99).

### Exercice 6 : Alert Rules
Définir des regles d'alerte (metrique > seuil pendant une duree) et les évaluer contre un historique de metriques.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-18-observabilite-distribuee/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-18-observabilite-distribuee/solution.ts`

## Concepts clés

- **Correlation ID** : identifiant unique propageant le contexte a travers les services
- **Structured Logging** : logs au format JSON avec contexte enrichi
- **Distributed Tracing** : suivi des requêtes a travers les services via des spans
- **Health Check** : vérification de l'état de sante des dépendances
- **RED Metrics** : Rate, Error rate, Duration — les metriques essentielles pour les services
- **Alerting** : detection automatique des anomalies basee sur des seuils
