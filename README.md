# Systèmes Distribués — Microservices, CQRS, Saga, Consensus

![VitePress](https://img.shields.io/badge/-VitePress-646CFF?style=flat-square&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
[![fullstack-autotraining](https://img.shields.io/badge/curriculum-fullstack--autotraining-4C1?style=flat-square)](https://github.com/smaurier/fullstack-autotraining)

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

Le parcours combine modules, labs, quizzes et visualisations pour passer de la theorie a l'operationnel sur les flux distribues : communication sync/async, fiabilite messaging (ack, retry, dead-letter, idempotence), resilience (timeouts, degradation) et diagnostic d'incidents avec logs/traces/metrics.
