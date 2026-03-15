# Lab 07 — Event-Driven

## Objectifs

- Comprendre l'architecture event-driven et ses principes fondamentaux
- Définir des événements de domaine types avec discriminants
- Implementer un bus d'événements type (publish/subscribe)
- Construire des aggregats qui collectent des événements de domaine
- Garantir l'idempotence des handlers d'événements
- Mettre en oeuvre le versioning et l'upcasting des événements
- Orchestrer des workflows event-driven (chaines d'événements)

## Exercices

### Exercice 1 : Event Types
Définir des interfaces d'événements de domaine (`OrderCreated`, `PaymentProcessed`, etc.) avec un champ `type` discriminant permettant le pattern matching TypeScript.

### Exercice 2 : Event Bus
Implementer un `EventBus` type avec les méthodes :
- `on(type, handler)` — s'abonner à un type d'événement
- `emit(event)` — publier un événement
- `off(type, handler)` — se desabonner

### Exercice 3 : Domain Events
Implementer une classe de base `Aggregate` qui collecte des événements de domaine, puis un aggregat `Order` qui emet des événements lors de ses transitions d'état.

### Exercice 4 : Event Handler
Implementer des handlers d'événements idempotents qui trackent les IDs d'événements déjà traites pour éviter le double-processing.

### Exercice 5 : Event Versioning
Implementer l'upcasting d'événements du format V1 vers V2, permettant l'evolution du schema sans casser les consommateurs existants.

### Exercice 6 : Event Chain
Implementer un workflow event-driven complet : Order Created -> Reserve Stock -> Process Payment -> Notify Customer.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-07-event-driven/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-07-event-driven/solution.ts`

## Concepts clés

- **Event** : un fait immutable qui s'est produit dans le système
- **Event Bus** : mediateur qui route les événements vers les handlers abonnes
- **Domain Event** : événement metier significatif emis par un aggregat
- **Idempotence** : capacité a traiter le même événement plusieurs fois sans effet de bord
- **Upcasting** : transformation d'un événement ancien vers un format plus recent
- **Event Chain** : sequence de reactions en chaine declenchees par un événement initial
