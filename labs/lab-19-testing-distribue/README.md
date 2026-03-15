# Lab 19 — Testing distribue

## Objectifs

- Comprendre les specificites du test en environnement distribue
- Créer des mock services configurables pour simuler des dépendances externes
- Définir et vérifier des contrats consumer-driven entre services
- Implementer du chaos engineering avec injection de pannes aleatoires
- Maîtriser le property-based testing pour vérifier des invariants
- Vérifier la linearisabilite d'un historique d'operations
- Combiner tous ces outils dans un test harness complet

## Exercices

### Exercice 1 : Mock Service
Implementer un mock HTTP service qui retourne des réponses configurables. Le mock permet d'enregistrer des routes avec des réponses predefinies et de traquer les appels recus.

### Exercice 2 : Contract Definition
Définir et vérifier un contrat consumer-driven entre services. Un contrat specifie un schema de requête et un schema de réponse, puis la vérification s'assure que le provider respecte le contrat.

### Exercice 3 : Chaos Middleware
Implementer un middleware qui injecte aleatoirement de la latence, des erreurs ou des timeouts dans les appels de service, pour tester la résilience du système.

### Exercice 4 : Property-Based Test
Implementer un runner de tests par propriété qui généré des entrees aleatoires et vérifié qu'un invariant reste vrai pour toutes les entrees generees.

### Exercice 5 : Linearizability Checker
Implementer un verificateur qui déterminé si un historique d'operations read/write est linearisable, c'est-a-dire s'il existe un ordre sequentiel valide compatible avec le temps réel.

### Exercice 6 : Test Harness
Combiner mock services, injection de chaos et assertions dans un test harness complet capable d'orchestrer des scenarios de test end-to-end.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-19-testing-distribue/exercise.ts`
3. Vérifier vos résultats avec la solution : `npx tsx labs/lab-19-testing-distribue/solution.ts`

## Concepts clés

- **Mock Service** : service simule avec réponses configurables pour isoler les tests
- **Consumer-Driven Contract** : contrat défini par le consommateur et vérifié cote producteur
- **Chaos Engineering** : injection deliberee de pannes pour valider la résilience
- **Property-Based Testing** : génération aleatoire d'entrees pour vérifier des invariants
- **Linearisabilite** : propriété de coherence forte ou chaque operation semble instantanee
- **Test Harness** : cadre d'exécution de tests combinant mocks, chaos et assertions
