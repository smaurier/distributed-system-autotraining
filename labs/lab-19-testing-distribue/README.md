# Lab 19 — Testing distribue

## Objectifs

- Comprendre les specificites du test en environnement distribue
- Creer des mock services configurables pour simuler des dependances externes
- Definir et verifier des contrats consumer-driven entre services
- Implementer du chaos engineering avec injection de pannes aleatoires
- Maitriser le property-based testing pour verifier des invariants
- Verifier la linearisabilite d'un historique d'operations
- Combiner tous ces outils dans un test harness complet

## Exercices

### Exercice 1 : Mock Service
Implementer un mock HTTP service qui retourne des reponses configurables. Le mock permet d'enregistrer des routes avec des reponses predefinies et de traquer les appels recus.

### Exercice 2 : Contract Definition
Definir et verifier un contrat consumer-driven entre services. Un contrat specifie un schema de requete et un schema de reponse, puis la verification s'assure que le provider respecte le contrat.

### Exercice 3 : Chaos Middleware
Implementer un middleware qui injecte aleatoirement de la latence, des erreurs ou des timeouts dans les appels de service, pour tester la resilience du systeme.

### Exercice 4 : Property-Based Test
Implementer un runner de tests par propriete qui genere des entrees aleatoires et verifie qu'un invariant reste vrai pour toutes les entrees generees.

### Exercice 5 : Linearizability Checker
Implementer un verificateur qui determine si un historique d'operations read/write est linearisable, c'est-a-dire s'il existe un ordre sequentiel valide compatible avec le temps reel.

### Exercice 6 : Test Harness
Combiner mock services, injection de chaos et assertions dans un test harness complet capable d'orchestrer des scenarios de test end-to-end.

## Instructions

1. Ouvrir `exercise.ts` et completer les sections marquees `TODO`
2. Lancer avec `npx tsx labs/lab-19-testing-distribue/exercise.ts`
3. Verifier vos resultats avec la solution : `npx tsx labs/lab-19-testing-distribue/solution.ts`

## Concepts cles

- **Mock Service** : service simule avec reponses configurables pour isoler les tests
- **Consumer-Driven Contract** : contrat defini par le consommateur et verifie cote producteur
- **Chaos Engineering** : injection deliberee de pannes pour valider la resilience
- **Property-Based Testing** : generation aleatoire d'entrees pour verifier des invariants
- **Linearisabilite** : propriete de coherence forte ou chaque operation semble instantanee
- **Test Harness** : cadre d'execution de tests combinant mocks, chaos et assertions
