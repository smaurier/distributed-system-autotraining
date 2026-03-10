import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Distributed Systems Course',
  description:
    'Formation complete Systemes Distribues : microservices, communication, resilience, CQRS, event sourcing, sagas, consensus (debutant → expert)',
  lang: 'fr-FR',
  srcDir: '.',
  ignoreDeadLinks: true,

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-prerequis-et-introduction' },
      { text: 'Labs', link: '/labs/lab-01-monolithe-vs-distribue/README' },
      { text: 'Quizzes', link: '/quizzes/quiz-00-prerequis.html' },
      { text: 'Visualisations', link: '/visualizations/network-partitions.html' },
      { text: 'Glossaire', link: '/glossaire' },
      { text: 'References', link: '/modules/99-references-et-lectures' },
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Phase 1 — Fondamentaux',
          collapsed: false,
          items: [
            { text: '00 - Prerequis et introduction', link: '/modules/00-prerequis-et-introduction' },
            { text: '01 - Pourquoi les systemes distribues', link: '/modules/01-pourquoi-les-systemes-distribues' },
            { text: '02 - Communication reseau fondamentale', link: '/modules/02-communication-reseau-fondamentale' },
            { text: '03 - Premiers microservices TypeScript', link: '/modules/03-premiers-microservices-typescript' },
            { text: '04 - Serialisation et contrats API', link: '/modules/04-serialisation-et-contrats-api' },
          ],
        },
        {
          text: 'Phase 2 — Patterns de Communication',
          collapsed: false,
          items: [
            { text: '05 - Communication synchrone avancee', link: '/modules/05-communication-synchrone-avancee' },
            { text: '06 - Communication asynchrone et message queues', link: '/modules/06-communication-asynchrone-message-queues' },
            { text: '07 - Event-driven architecture', link: '/modules/07-event-driven-architecture' },
            { text: '08 - API Gateway et BFF', link: '/modules/08-api-gateway-et-bff' },
            { text: '09 - Retries, timeouts et idempotency', link: '/modules/09-retries-timeouts-idempotency' },
          ],
        },
        {
          text: 'Phase 3 — Donnees & Etat Distribue',
          collapsed: false,
          items: [
            { text: '10 - Coherence et theoreme CAP', link: '/modules/10-coherence-et-theoreme-cap' },
            { text: '11 - Replication et partitionnement', link: '/modules/11-replication-et-partitionnement' },
            { text: '12 - Transactions distribuees et Saga', link: '/modules/12-transactions-distribuees-saga' },
            { text: '13 - CQRS et event sourcing', link: '/modules/13-cqrs-event-sourcing' },
            { text: '14 - Outbox pattern et reliable messaging', link: '/modules/14-outbox-pattern-reliable-messaging' },
          ],
        },
        {
          text: 'Phase 4 — Resilience & Production',
          collapsed: false,
          items: [
            { text: '15 - Failure modes', link: '/modules/15-failure-modes' },
            { text: '16 - Circuit breaker', link: '/modules/16-circuit-breaker' },
            { text: '17 - Rate limiting', link: '/modules/17-rate-limiting' },
            { text: '18 - Observabilite distribuee', link: '/modules/18-observabilite-distribuee' },
            { text: '19 - Testing distribue', link: '/modules/19-testing-distribue' },
          ],
        },
        {
          text: 'Phase 5 — Expert Avance',
          collapsed: false,
          items: [
            { text: '20 - Consensus et coordination distribuee', link: '/modules/20-consensus-coordination-distribuee' },
            { text: '21 - Temps, ordre et horloges', link: '/modules/21-temps-ordre-horloges' },
            { text: '22 - Stream processing et event streaming', link: '/modules/22-stream-processing-event-streaming' },
            { text: '23 - CRDTs et resolution de conflits', link: '/modules/23-crdts-resolution-conflits' },
            { text: '24 - Projet final', link: '/modules/24-projet-final' },
          ],
        },
        {
          text: 'Annexes',
          collapsed: false,
          items: [
            { text: '99 - References et lectures', link: '/modules/99-references-et-lectures' },
          ],
        },
      ],

      '/labs/': [
        {
          text: 'Phase 1 — Fondamentaux',
          collapsed: false,
          items: [
            { text: 'Lab 01 - Monolithe vs distribue', link: '/labs/lab-01-monolithe-vs-distribue/README' },
            { text: 'Lab 02 - Communication reseau', link: '/labs/lab-02-communication-reseau/README' },
            { text: 'Lab 03 - Microservices Express', link: '/labs/lab-03-microservices-express/README' },
            { text: 'Lab 04 - Serialisation et validation', link: '/labs/lab-04-serialisation-validation/README' },
          ],
        },
        {
          text: 'Phase 2 — Patterns de Communication',
          collapsed: false,
          items: [
            { text: 'Lab 05 - Communication synchrone', link: '/labs/lab-05-communication-synchrone/README' },
            { text: 'Lab 06 - Message queues', link: '/labs/lab-06-message-queues/README' },
            { text: 'Lab 07 - Event-driven', link: '/labs/lab-07-event-driven/README' },
            { text: 'Lab 08 - API Gateway', link: '/labs/lab-08-api-gateway/README' },
            { text: 'Lab 09 - Retries et idempotency', link: '/labs/lab-09-retries-idempotency/README' },
          ],
        },
        {
          text: 'Phase 3 — Donnees & Etat Distribue',
          collapsed: false,
          items: [
            { text: 'Lab 10 - Coherence et CAP', link: '/labs/lab-10-coherence-cap/README' },
            { text: 'Lab 11 - Replication et partitionnement', link: '/labs/lab-11-replication-partitionnement/README' },
            { text: 'Lab 12 - Saga pattern', link: '/labs/lab-12-saga-pattern/README' },
            { text: 'Lab 13 - CQRS et event sourcing', link: '/labs/lab-13-cqrs-event-sourcing/README' },
            { text: 'Lab 14 - Outbox pattern', link: '/labs/lab-14-outbox-pattern/README' },
          ],
        },
        {
          text: 'Phase 4 — Resilience & Production',
          collapsed: false,
          items: [
            { text: 'Lab 15 - Failure modes', link: '/labs/lab-15-failure-modes/README' },
            { text: 'Lab 16 - Circuit breaker', link: '/labs/lab-16-circuit-breaker/README' },
            { text: 'Lab 17 - Rate limiting', link: '/labs/lab-17-rate-limiting/README' },
            { text: 'Lab 18 - Observabilite distribuee', link: '/labs/lab-18-observabilite-distribuee/README' },
            { text: 'Lab 19 - Testing distribue', link: '/labs/lab-19-testing-distribue/README' },
          ],
        },
        {
          text: 'Phase 5 — Expert Avance',
          collapsed: false,
          items: [
            { text: 'Lab 20 - Consensus et Raft', link: '/labs/lab-20-consensus-raft/README' },
            { text: 'Lab 21 - Horloges logiques', link: '/labs/lab-21-horloges-logiques/README' },
            { text: 'Lab 22 - Stream processing', link: '/labs/lab-22-stream-processing/README' },
            { text: 'Lab 23 - CRDTs', link: '/labs/lab-23-crdts/README' },
            { text: 'Lab 24 - Projet final', link: '/labs/lab-24-projet-final/README' },
          ],
        },
      ],

      '/quizzes/': [
        {
          text: 'Quizzes',
          collapsed: false,
          items: [
            { text: 'Quiz 00 - Prerequis', link: '/quizzes/quiz-00-prerequis.html' },
            { text: 'Quiz 01 - Pourquoi le distribue', link: '/quizzes/quiz-01-pourquoi-distribue.html' },
            { text: 'Quiz 02 - Communication reseau', link: '/quizzes/quiz-02-communication-reseau.html' },
            { text: 'Quiz 03 - Microservices', link: '/quizzes/quiz-03-microservices.html' },
            { text: 'Quiz 04 - Serialisation', link: '/quizzes/quiz-04-serialisation.html' },
            { text: 'Quiz 05 - Communication synchrone', link: '/quizzes/quiz-05-communication-synchrone.html' },
            { text: 'Quiz 06 - Message queues', link: '/quizzes/quiz-06-message-queues.html' },
            { text: 'Quiz 07 - Event-driven', link: '/quizzes/quiz-07-event-driven.html' },
            { text: 'Quiz 08 - API Gateway', link: '/quizzes/quiz-08-api-gateway.html' },
            { text: 'Quiz 09 - Retries et idempotency', link: '/quizzes/quiz-09-retries-idempotency.html' },
            { text: 'Quiz 10 - Coherence et CAP', link: '/quizzes/quiz-10-coherence-cap.html' },
            { text: 'Quiz 11 - Replication', link: '/quizzes/quiz-11-replication.html' },
            { text: 'Quiz 12 - Saga', link: '/quizzes/quiz-12-saga.html' },
            { text: 'Quiz 13 - CQRS et event sourcing', link: '/quizzes/quiz-13-cqrs-event-sourcing.html' },
            { text: 'Quiz 14 - Outbox pattern', link: '/quizzes/quiz-14-outbox-pattern.html' },
            { text: 'Quiz 15 - Failure modes', link: '/quizzes/quiz-15-failure-modes.html' },
            { text: 'Quiz 16 - Circuit breaker', link: '/quizzes/quiz-16-circuit-breaker.html' },
            { text: 'Quiz 17 - Rate limiting', link: '/quizzes/quiz-17-rate-limiting.html' },
            { text: 'Quiz 18 - Observabilite', link: '/quizzes/quiz-18-observabilite.html' },
            { text: 'Quiz 19 - Testing', link: '/quizzes/quiz-19-testing.html' },
            { text: 'Quiz 20 - Consensus', link: '/quizzes/quiz-20-consensus.html' },
            { text: 'Quiz 21 - Horloges', link: '/quizzes/quiz-21-horloges.html' },
            { text: 'Quiz 22 - Stream processing', link: '/quizzes/quiz-22-stream-processing.html' },
            { text: 'Quiz 23 - CRDTs', link: '/quizzes/quiz-23-crdts.html' },
            { text: 'Quiz 24 - Projet final', link: '/quizzes/quiz-24-projet-final.html' },
          ],
        },
      ],

      '/visualizations/': [
        {
          text: 'Visualisations',
          collapsed: false,
          items: [
            { text: 'Network Partitions', link: '/visualizations/network-partitions.html' },
            { text: 'Theoreme CAP', link: '/visualizations/cap-theorem.html' },
            { text: 'Saga Orchestration', link: '/visualizations/saga-orchestration.html' },
            { text: 'Circuit Breaker', link: '/visualizations/circuit-breaker.html' },
            { text: 'Consistent Hashing', link: '/visualizations/consistent-hashing.html' },
            { text: 'Consensus Raft', link: '/visualizations/consensus-raft.html' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: 'Sur cette page',
    },

    docFooter: {
      prev: 'Page precedente',
      next: 'Page suivante',
    },
  },
});
