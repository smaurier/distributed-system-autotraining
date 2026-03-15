# Lab 05 — Communication synchrone

## Objectifs

Comprendre et implementer les principaux mécanismes de communication synchrone dans les systèmes distribues : REST, HATEOAS, service discovery, load balancing, routing et service mesh.

## Exercices

### Exercice 1 : REST maturity levels
Classifier des endpoints API selon les niveaux de maturite de Richardson (0 a 3).

### Exercice 2 : HATEOAS links
Générer des liens hypermedia pour une ressource commande en fonction de son état.

### Exercice 3 : Service discovery
Implementer un registre de services avec enregistrement, découverte et eviction par heartbeat.

### Exercice 4 : Client-side load balancer
Implementer les stratégies round-robin et least-connections pour la repartition de charge.

### Exercice 5 : Request routing
Implementer un routeur qui mappe des chemins URL vers des définitions de services.

### Exercice 6 : Service mesh simulation
Simuler un sidecar proxy qui encapsule les appels avec timeout, retry et collecte de metriques.

## Lancer les tests

```bash
npx tsx exercise.ts
# ou
npx tsx solution.ts
```
