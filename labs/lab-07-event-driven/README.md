# Lab 07 — Event-Driven

## Objectifs

- Comprendre l'architecture event-driven et ses principes fondamentaux
- Definir des evenements de domaine types avec discriminants
- Implementer un bus d'evenements type (publish/subscribe)
- Construire des aggregats qui collectent des evenements de domaine
- Garantir l'idempotence des handlers d'evenements
- Mettre en oeuvre le versioning et l'upcasting des evenements
- Orchestrer des workflows event-driven (chaines d'evenements)

## Exercices

### Exercice 1 : Event Types
Definir des interfaces d'evenements de domaine (`OrderCreated`, `PaymentProcessed`, etc.) avec un champ `type` discriminant permettant le pattern matching TypeScript.

### Exercice 2 : Event Bus
Implementer un `EventBus` type avec les methodes :
- `on(type, handler)` — s'abonner a un type d'evenement
- `emit(event)` — publier un evenement
- `off(type, handler)` — se desabonner

### Exercice 3 : Domain Events
Implementer une classe de base `Aggregate` qui collecte des evenements de domaine, puis un aggregat `Order` qui emet des evenements lors de ses transitions d'etat.

### Exercice 4 : Event Handler
Implementer des handlers d'evenements idempotents qui trackent les IDs d'evenements deja traites pour eviter le double-processing.

### Exercice 5 : Event Versioning
Implementer l'upcasting d'evenements du format V1 vers V2, permettant l'evolution du schema sans casser les consommateurs existants.

### Exercice 6 : Event Chain
Implementer un workflow event-driven complet : Order Created -> Reserve Stock -> Process Payment -> Notify Customer.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-07-event-driven/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-07-event-driven/solution.ts`

## Concepts cles

- **Event** : un fait immutable qui s'est produit dans le systeme
- **Event Bus** : mediateur qui route les evenements vers les handlers abonnes
- **Domain Event** : evenement metier significatif emis par un aggregat
- **Idempotence** : capacite a traiter le meme evenement plusieurs fois sans effet de bord
- **Upcasting** : transformation d'un evenement ancien vers un format plus recent
- **Event Chain** : sequence de reactions en chaine declenchees par un evenement initial
