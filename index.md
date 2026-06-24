---
layout: home

hero:
  name: "Distributed Systems Course"
  text: "Formation complete Systemes Distribues"
  tagline: "Des microservices au consensus distribue — Maitrisez la resilience, CQRS, event sourcing, sagas et les algorithmes distribues de A a Z (debutant → expert)"
  actions:
    - theme: brand
      text: Commencer le cours
      link: /modules/00-prerequis-et-introduction
    - theme: alt
      text: Voir les labs
      link: /labs/lab-01-monolithe-vs-distribue/README

features:
  - title: 28 Modules theoriques
    details: Des fondamentaux reseau aux algorithmes de consensus, en passant par les microservices, les patterns de communication, CQRS, event sourcing, sagas, la resilience, Docker et Kubernetes.
  - title: 27 Labs pratiques
    details: Exercices progressifs avec corrections — monolithe vs distribue, message queues, circuit breakers, saga orchestration, CRDTs, Docker avance, Kubernetes, et plus.
  - title: 6 Visualisations animees
    details: Diagrammes interactifs pour comprendre les network partitions, le theoreme CAP, l'orchestration de sagas, le circuit breaker, le consistent hashing et le consensus Raft.
  - title: 28 Quizzes
    details: Testez vos connaissances apres chaque module avec des quiz interactifs, plus un quiz bonus transverse.
---

## Plan du cours

| #   | Module                                                                      | Niveau        | Lab                                                    | Quiz                                                  |
| --- | --------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ | ----------------------------------------------------- |
|     | **Phase 1 — Fondamentaux**                                                  |               |                                                        |                                                       |
| 00  | [Prérequis et introduction](/modules/00-prerequis-et-introduction)          | Débutant      | —                                                      | [Quiz](/quizzes/quiz-00-prerequis.html)               |
| 01  | [Monolithe vs distribue](/modules/01-pourquoi-les-systemes-distribues)      | Débutant      | [Lab 01](/labs/lab-01-monolithe-vs-distribue/README)   | [Quiz](/quizzes/quiz-01-pourquoi-distribue.html)      |
| 02  | [Communication réseau](/modules/02-communication-reseau-fondamentale)       | Débutant      | [Lab 02](/labs/lab-02-communication-reseau/README)     | [Quiz](/quizzes/quiz-02-communication-reseau.html)    |
| 03  | [Microservices fondamentaux](/modules/03-premiers-microservices-typescript) | Débutant      | [Lab 03](/labs/lab-03-microservices-express/README)    | [Quiz](/quizzes/quiz-03-microservices.html)           |
| 04  | [Serialisation et validation](/modules/04-serialisation-et-contrats-api)    | Débutant      | [Lab 04](/labs/lab-04-serialisation-validation/README) | [Quiz](/quizzes/quiz-04-serialisation.html)           |
|     | **Phase 2 — Patterns de Communication**                                     |               |                                                        |                                                       |
| 05  | [Communication synchrone](/modules/05-communication-synchrone-avancee)      | Intermédiaire | [Lab 05](/labs/lab-05-communication-synchrone/README)  | [Quiz](/quizzes/quiz-05-communication-synchrone.html) |
| 06  | [Message queues](/modules/06-communication-asynchrone-message-queues)       | Intermédiaire | [Lab 06](/labs/lab-06-message-queues/README)           | [Quiz](/quizzes/quiz-06-message-queues.html)          |
| 07  | [Event-driven architecture](/modules/07-event-driven-architecture)          | Intermédiaire | [Lab 07](/labs/lab-07-event-driven/README)             | [Quiz](/quizzes/quiz-07-event-driven.html)            |
| 08  | [API Gateway et BFF](/modules/08-api-gateway-et-bff)                        | Intermédiaire | [Lab 08](/labs/lab-08-api-gateway/README)              | [Quiz](/quizzes/quiz-08-api-gateway.html)             |
| 09  | [Retries et idempotency](/modules/09-retries-timeouts-idempotency)          | Intermédiaire | [Lab 09](/labs/lab-09-retries-idempotency/README)      | [Quiz](/quizzes/quiz-09-retries-idempotency.html)     |

> **Chevauchement avec 10-Architecture** : les modules saga (12), CQRS (13) et circuit breaker (16) sont aussi traites dans le cours 10-Architecture (module 07). Ici l'angle est implementation distribuee. Dans le cours 10, l'angle est design pattern et decision architecturale. Les deux se completent.

| | **Phase 3 — Donnees & État Distribue** | | | |
| 10 | [Coherence et théorème CAP](/modules/10-coherence-et-theoreme-cap) | Avance | [Lab 10](/labs/lab-10-coherence-cap/README) | [Quiz](/quizzes/quiz-10-coherence-cap.html) |
| 11 | [Replication et partitionnement](/modules/11-replication-et-partitionnement) | Avance | [Lab 11](/labs/lab-11-replication-partitionnement/README) | [Quiz](/quizzes/quiz-11-replication.html) |
| 12 | [Saga pattern](/modules/12-transactions-distribuees-saga) | Avance | [Lab 12](/labs/lab-12-saga-pattern/README) | [Quiz](/quizzes/quiz-12-saga.html) |
| 13 | [CQRS et event sourcing](/modules/13-cqrs-event-sourcing) | Avance | [Lab 13](/labs/lab-13-cqrs-event-sourcing/README) | [Quiz](/quizzes/quiz-13-cqrs-event-sourcing.html) |
| 14 | [Outbox pattern](/modules/14-outbox-pattern) | Avance | [Lab 14](/labs/lab-14-outbox-pattern/README) | [Quiz](/quizzes/quiz-14-outbox-pattern.html) |
| | **Phase 4 — Résilience & Production** | | | |
| 15 | [Failure modes](/modules/15-failure-modes) | Expert | [Lab 15](/labs/lab-15-failure-modes/README) | [Quiz](/quizzes/quiz-15-failure-modes.html) |
| 16 | [Circuit breaker](/modules/16-circuit-breaker) | Expert | [Lab 16](/labs/lab-16-circuit-breaker/README) | [Quiz](/quizzes/quiz-16-circuit-breaker.html) |
| 17 | [Rate limiting](/modules/17-rate-limiting) | Expert | [Lab 17](/labs/lab-17-rate-limiting/README) | [Quiz](/quizzes/quiz-17-rate-limiting.html) |
| 18 | [Observabilité distribuee](/modules/18-observabilite-distribuee) | Expert | [Lab 18](/labs/lab-18-observabilite-distribuee/README) | [Quiz](/quizzes/quiz-18-observabilite.html) |
| 19 | [Testing distribue](/modules/19-testing-distribue) | Expert | [Lab 19](/labs/lab-19-testing-distribue/README) | [Quiz](/quizzes/quiz-19-testing.html) |
| | **Phase 5 — Expert Avance** | | | |
| 20 | [Consensus et Raft](/modules/20-consensus-coordination-distribuee) | Expert | [Lab 20](/labs/lab-20-consensus-raft/README) | [Quiz](/quizzes/quiz-20-consensus.html) |
| 21 | [Horloges logiques](/modules/21-temps-ordre-horloges) | Expert | [Lab 21](/labs/lab-21-horloges-logiques/README) | [Quiz](/quizzes/quiz-21-horloges.html) |
| 22 | [Stream processing](/modules/22-stream-processing-event-streaming) | Expert | [Lab 22](/labs/lab-22-stream-processing/README) | [Quiz](/quizzes/quiz-22-stream-processing.html) |
| 23 | [CRDTs](/modules/23-crdts-resolution-conflits) | Expert | [Lab 23](/labs/lab-23-crdts/README) | [Quiz](/quizzes/quiz-23-crdts.html) |
| 24 | [Projet final](/modules/24-projet-final) | Expert | [Lab 24](/labs/lab-24-projet-final/README) | [Quiz](/quizzes/quiz-24-projet-final.html) |
| | **Phase 6 — Conteneurisation & Orchestration** | | | |
| 25 | [Docker en profondeur](/modules/25-docker-en-profondeur) | Intermédiaire | [Lab 25](/labs/lab-25-docker-avance/README) | [Quiz](/quizzes/quiz-25-docker.html) |
| 26 | [Kubernetes fondamental](/modules/26-kubernetes-fondamental) | Avancé | [Lab 26](/labs/lab-26-kubernetes-fondamental/README) | [Quiz](/quizzes/quiz-26-kubernetes.html) |
| 27 | [Kubernetes en pratique](/modules/27-kubernetes-en-pratique) | Expert | [Lab 27](/labs/lab-27-kubernetes-pratique/README) | [Quiz](/quizzes/quiz-27-kubernetes-pratique.html) |

## Annexes

| Ressource                                                   | Description                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Références & Lectures](/modules/99-references-et-lectures) | DDIA, Building Microservices, Release It!, papiers Raft/Dynamo/Kafka — guide de lecture par phase |
| [Glossaire](/glossaire)                                     | ~70 termes techniques définis et illustres                                                        |
