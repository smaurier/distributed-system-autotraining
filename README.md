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

Le parcours combine modules, labs, quizzes et visualisations pour passer de la theorie a l'operationnel sur les flux distribues : communication sync/async, fiabilite messaging (ack, retry, dead-letter, idempotence), resilience (timeouts, degradation) et diagnostic d'incidents avec logs/traces/metrics.
