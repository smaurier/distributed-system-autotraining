# Lab 04 — Serialisation & Validation Zod

## Objectifs
- Comprendre les pieges de la serialisation JSON (Date, BigInt, undefined)
- Définir des schemas de validation avec TypeScript pur
- Implementer une validation runtime avec contraintes
- Gérer le versioning de schemas avec migration
- Distinguer les changements breaking des non-breaking
- Implementer des tests de contrat (consumer-driven contracts)

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Pieges JSON** — demonstrer les problèmes de Date, BigInt, undefined et créer un serialiseur sur
2. **Definition de schema** — définir des schemas order/payment avec interfaces TypeScript + fonction de validation
3. **Validation runtime** — implementer une fonction validate qui vérifié champs requis, types et contraintes
4. **Versioning de schema** — implementer des schemas V1 et V2 avec fonction de migration
5. **Breaking vs non-breaking** — categoriser une liste de changements comme breaking ou non-breaking
6. **Contract testing** — implementer un verificateur de contrat consumer-driven

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
