# Lab 26 — Kubernetes : fondamentaux

## Objectifs

- Modéliser des ressources Kubernetes (Pods, Deployments, Services)
- Comprendre la logique des selectors/labels
- Implémenter la logique des health probes
- Simuler le routing de services
- Valider des manifests Kubernetes

## Prérequis

- Module 26 terminé
- Connaissances TypeScript (interfaces, types)

## Exercices

### Exercice 1 : Pod Scheduler

Implémentez un mini-scheduler qui attribue des Pods à des Nodes en fonction des resources demandées (CPU, mémoire) et des `nodeSelector` labels.

### Exercice 2 : Label Selector Engine

Créez un moteur de sélection par labels qui supporte `matchLabels` et `matchExpressions` (`In`, `NotIn`, `Exists`, `DoesNotExist`).

### Exercice 3 : Deployment Controller

Simulez un Deployment controller : gestion du `replicas`, `rollingUpdate` (maxSurge, maxUnavailable), et tracking du rollout status.

### Exercice 4 : Service Router

Implémentez le routing d'un Service Kubernetes : résolution des Endpoints via label selectors, round-robin entre pods, et gestion des types `ClusterIP` / `NodePort`.

### Exercice 5 : Probe Evaluator

Modélisez le système complet de probes (liveness, readiness, startup) avec les transitions d'état du Pod.

### Exercice 6 : Manifest Validator

Validez des manifests Kubernetes : champs requis, labels conformes (RFC 1123), limits/requests cohérents, ports non-conflictuels.

## Lancer les tests

```bash
npx tsx labs/lab-26-kubernetes-fondamental/exercise.ts
```
