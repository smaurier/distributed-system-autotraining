# Lab 21 — Horloges logiques

## Objectifs

- Comprendre pourquoi les horloges physiques sont insuffisantes en systemes distribues
- Implementer une horloge de Lamport pour ordonner les evenements
- Implementer une horloge vectorielle pour detecter la causalite et la concurrence
- Garantir la livraison causale des messages avec mise en tampon
- Implementer une Hybrid Logical Clock (HLC) combinant temps physique et logique
- Determiner l'ordre causal et les evenements concurrents
- Detecter les ecritures conflictuelles dans un store replique

## Exercices

### Exercice 1 : Lamport Clock
Implementer une horloge de Lamport : incrementer sur un evenement local, prendre le max+1 sur reception d'un message.

### Exercice 2 : Vector Clock
Implementer une horloge vectorielle avec increment, send, receive et compare (before, after, concurrent).

### Exercice 3 : Causal Ordering
Implementer la livraison causale des messages en utilisant les horloges vectorielles. Les messages hors-ordre sont mis en tampon jusqu'a ce que leurs dependances causales soient satisfaites.

### Exercice 4 : Hybrid Logical Clock (HLC)
Implementer une Hybrid Logical Clock qui combine le temps physique avec un compteur logique pour obtenir un horodatage unique et ordonne.

### Exercice 5 : Event Ordering
Etant donne un ensemble d'evenements avec horloges vectorielles, determiner l'ordre causal et identifier les evenements concurrents.

### Exercice 6 : Conflict Detection
Utiliser les horloges vectorielles pour detecter les ecritures conflictuelles dans un store cle-valeur replique.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-21-horloges-logiques/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-21-horloges-logiques/solution.ts`

## Concepts cles

- **Horloge de Lamport** : compteur logique garantissant l'ordre causal (si a -> b alors L(a) < L(b))
- **Horloge vectorielle** : vecteur de compteurs detectant la causalite et la concurrence
- **Livraison causale** : garantie que les messages sont delivres dans l'ordre causal
- **HLC** : horloge hybride combinant temps physique et logique
- **Concurrence** : deux evenements sont concurrents si aucun ne cause l'autre
- **Conflit** : ecritures concurrentes sur la meme cle dans un store replique
