# Systèmes Distribués — Microservices, CQRS, Saga, Consensus

## Lancer le cours

```bash
npm install          # une seule fois
npm run docs:dev     # ouvre http://localhost:5173
```

Le site s'ouvre avec une sidebar navigable. Commence par le premier module (00).

## Structure

```
11-distributed-systems/
├── modules/          ← Cours théoriques (00, 01, 02...)
├── labs/             ← Exercices pratiques (exercise.ts → solution.ts)
├── quizzes/          ← Quiz interactifs (.html)
├── screencasts/      ← Scripts de screencasts
├── visualizations/   ← Visualisations interactives
├── glossaire.md      ← Termes clés
└── index.md          ← Page d'accueil VitePress
```

## Parcours

Consulte `cours/parcours.md` ou ouvre le site VitePress pour le plan de formation détaillé.

## Competences visees

Au-dela de la theorie, l'objectif est de savoir operer des flux distribues en conditions reelles :

- communication synchrone et asynchrone entre services
- fiabilite messaging (ack, retry, dead-letter, idempotence)
- resilience applicative (timeouts, backpressure, degradation)
- diagnostic d'incidents avec logs, traces et metriques
