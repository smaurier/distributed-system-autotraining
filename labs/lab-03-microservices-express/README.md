# Lab 03 — Premiers microservices

## Objectifs
- Définir une interface de microservice avec routes et health check
- Implementer un health check avec uptime et vérification de dépendances
- Créer un logger structure (JSON) avec timestamp, level, service, message
- Comprendre et implementer la propagation de correlation IDs
- Construire un registre de services en mémoire (register, discover)
- Simuler des appels inter-services avec forwarding de correlation ID

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Definition de service** — définir une interface de microservice avec name, port, routes, health check
2. **Health check** — implementer un health check retournant status, uptime et vérification de dépendances
3. **Logging structure** — créer un logger structure (JSON avec timestamp, level, service, message)
4. **Correlation ID** — implementer la génération et propagation de correlation IDs
5. **Registre de services** — créer un registre en mémoire (register, deregister, discover)
6. **Appel inter-services** — simuler un appel à un autre service avec forwarding de correlation ID

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
