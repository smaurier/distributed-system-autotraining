# Lab 25 — Docker en profondeur

## Objectifs
- Ecrire un Dockerfile optimise multi-stage
- Simuler et analyser le systeme de layers Docker
- Configurer le networking inter-services
- Implementer des health checks dans une stack Docker Compose
- Gerer la securite d'une image Docker
- Debugger des problemes courants de conteneurisation

## Exercices

Le fichier `exercise.ts` contient 6 exercices :

1. **Dockerfile Analyzer** — Analyser un Dockerfile et detecter les problemes d'optimisation
2. **Layer Cache Simulator** — Simuler le systeme de cache par couches de Docker
3. **Network Resolver** — Resoudre les noms DNS entre services Docker Compose
4. **Health Check Engine** — Implementer la logique de health check Docker
5. **Security Auditor** — Scanner une configuration Docker et detecter les failles
6. **Compose Dependency Resolver** — Resoudre l'ordre de demarrage des services

## Instructions

1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite

Tous les tests passent (checkmarks verts dans la console).
