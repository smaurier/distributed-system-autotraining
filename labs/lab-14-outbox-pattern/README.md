# Lab 14 — Outbox Pattern

## Objectifs
- Comprendre le problème du dual write (écriture BD + publication message)
- Implementer le pattern Outbox pour garantir la coherence
- Créer un polling publisher qui lit et publie les entrees de l'outbox
- Implementer un inbox pour la deduplication des messages
- Construire un consommateur idempotent avec le pattern inbox
- Combiner outbox + inbox pour un messaging fiable at-least-once

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Dual write problem** — demontrer le problème du dual write (écriture BD reussie, publication echouee)
2. **Outbox table** — implementer un outbox : écrire l'événement dans l'outbox dans la même transaction que la donnee
3. **Polling publisher** — implementer un poller qui lit les entrees pending de l'outbox et les publie
4. **Inbox deduplication** — implementer un inbox qui deduplique les messages par ID
5. **Idempotent consumer** — implementer un consommateur qui traite chaque message exactement une fois
6. **End-to-end reliable messaging** — combiner outbox producer + inbox consumer pour un messaging fiable

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
