# Lab 13 — CQRS & Event Sourcing

## Objectifs
- Comprendre le pattern Event Sourcing et son event store append-only
- Savoir reconstruire l'état d'un agregat en rejouant les événements
- Implementer un command handler qui valide et produit des événements
- Créer des projections (read models) à partir d'un flux d'événements
- Optimiser le chargement avec des snapshots
- Effectuer des requêtes temporelles (état à un instant donne)

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Event store** — implementer un store append-only avec getEvents(streamId) et append(streamId, events)
2. **Aggregate from events** — reconstruire l'état d'un agregat (BankAccount) en rejouant les événements
3. **Command handler** — implementer un handler qui valide les commandes et produit des événements
4. **Projection** — implementer une projection read-model qui maintient une vue materialisee
5. **Snapshot** — implementer des snapshots pour accelerer le chargement des agregats
6. **Temporal query** — implementer des requêtes d'état à un point dans le temps ou une version donnee

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
