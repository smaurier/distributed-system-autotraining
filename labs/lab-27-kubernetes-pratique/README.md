# Lab 27 — Kubernetes en pratique

## Objectifs

- Implémenter la logique d'auto-scaling (HPA)
- Simuler des stratégies de déploiement (canary, blue-green)
- Fusionner des values Helm
- Diagnostiquer des problèmes Kubernetes courants
- Modéliser des NetworkPolicies

## Prérequis

- Module 27 terminé
- Lab 26 terminé

## Exercices

### Exercice 1 : HPA Simulator

Implémentez la logique de l'Horizontal Pod Autoscaler : calcul du nombre désiré de réplicas basé sur les métriques CPU/mémoire, respect des limites min/max, stabilisation.

### Exercice 2 : Helm Values Merger

Fusionnez des fichiers `values.yaml` : merge profond (deep merge) avec gestion des tableaux et priorité des overrides.

### Exercice 3 : Canary Deployment Controller

Simulez un déploiement canary : routage progressif du trafic (10% → 50% → 100%), rollback automatique si le taux d'erreur dépasse un seuil.

### Exercice 4 : Troubleshooter

Analysez l'état d'un Pod et ses events pour diagnostiquer les problèmes courants (CrashLoopBackOff, ImagePullBackOff, OOMKilled, etc.).

### Exercice 5 : Network Policy Evaluator

Évaluez si un trafic réseau (source → destination, port) est autorisé par un ensemble de NetworkPolicies.

### Exercice 6 : Pod Disruption Budget Checker

Vérifiez si une opération de maintenance (drain d'un node) respecte les PodDisruptionBudgets.

## Lancer les tests

```bash
npx tsx labs/lab-27-kubernetes-pratique/exercise.ts
```
