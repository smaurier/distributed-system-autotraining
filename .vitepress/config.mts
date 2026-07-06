import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Distributed Systems',
  description:
    'Systemes distribues (theorie + implementation) : microservices, communication sync/async, coherence & CAP, replication, saga, CQRS/ES, outbox, resilience, consensus, horloges logiques, stream processing, CRDTs',
  lang: 'fr-FR',
  srcDir: '.',
  ignoreDeadLinks: true,

  // NB : PAS d'override `vue.template.compilerOptions.delimiters` — il s'applique aussi
  // aux composants .vue du thème par défaut et casse leur `{{ }}` (menu/outline affichés
  // littéralement). Les moustaches du contenu restent dans des blocs de code (non interprétés).

  // Refonte v1 : le cours vit dans modules/ + labs/. Le reste (quizzes, visualizations,
  // demo-app, config, docker-compose, scripts, screencasts) = outillage/archive, exclu du build.
  srcExclude: [
    'quizzes/**',
    'screencasts/**',
    'visualizations/**',
    'demo-app/**',
    'config/**',
    'scripts/**',
  ],

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-prerequis-et-introduction' },
      { text: 'Labs', link: '/labs/lab-00-prerequis-et-introduction/README' },
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'Phase 1 — Fondamentaux',
          collapsed: false,
          items: [
            { text: '00 · Prerequis et introduction', link: '/modules/00-prerequis-et-introduction' },
            { text: '01 · Communication reseau fondamentale', link: '/modules/01-communication-reseau-fondamentale' },
            { text: '02 · Microservices en TypeScript', link: '/modules/02-microservices-en-typescript' },
            { text: '03 · Serialisation et contrats API', link: '/modules/03-serialisation-et-contrats-api' },
          ],
        },
        {
          text: 'Phase 2 — Communication',
          collapsed: false,
          items: [
            { text: '04 · Communication synchrone', link: '/modules/04-communication-synchrone' },
            { text: '05 · Communication asynchrone & queues', link: '/modules/05-communication-asynchrone-message-queues' },
            { text: '06 · Event-driven architecture', link: '/modules/06-event-driven-architecture' },
            { text: '07 · API Gateway et BFF', link: '/modules/07-api-gateway-et-bff' },
            { text: '08 · Retries, timeouts, idempotency', link: '/modules/08-retries-timeouts-idempotency' },
          ],
        },
        {
          text: 'Phase 3 — Donnees & etat distribue',
          collapsed: false,
          items: [
            { text: '09 · Coherence et theoreme CAP', link: '/modules/09-coherence-et-theoreme-cap' },
            { text: '10 · Replication et partitionnement', link: '/modules/10-replication-et-partitionnement' },
            { text: '11 · Transactions distribuees & saga', link: '/modules/11-transactions-distribuees-saga' },
            { text: '12 · CQRS et event sourcing', link: '/modules/12-cqrs-event-sourcing' },
            { text: '13 · Outbox & reliable messaging', link: '/modules/13-outbox-pattern-reliable-messaging' },
          ],
        },
        {
          text: 'Phase 4 — Resilience & production',
          collapsed: false,
          items: [
            { text: '14 · Failure modes & circuit breaker', link: '/modules/14-failure-modes-et-circuit-breaker' },
            { text: '15 · Rate limiting et backpressure', link: '/modules/15-rate-limiting-et-backpressure' },
            { text: '16 · Observabilite distribuee', link: '/modules/16-observabilite-distribuee' },
            { text: '17 · Testing distribue', link: '/modules/17-testing-distribue' },
          ],
        },
        {
          text: 'Phase 5 — Expert',
          collapsed: false,
          items: [
            { text: '18 · Consensus et coordination', link: '/modules/18-consensus-et-coordination' },
            { text: '19 · Temps, ordre et horloges', link: '/modules/19-temps-ordre-et-horloges' },
            { text: '20 · Stream processing', link: '/modules/20-stream-processing' },
            { text: '21 · CRDTs et resolution de conflits', link: '/modules/21-crdts-et-resolution-de-conflits' },
            { text: '22 · Projet final', link: '/modules/22-projet-final' },
          ],
        },
      ],

      '/labs/': [
        {
          text: 'Labs — pratique (docker-compose fournis)',
          collapsed: false,
          items: [
            { text: 'Lab 00 · Prerequis et introduction', link: '/labs/lab-00-prerequis-et-introduction/README' },
            { text: 'Lab 01 · Communication reseau', link: '/labs/lab-01-communication-reseau-fondamentale/README' },
            { text: 'Lab 02 · Microservices TypeScript', link: '/labs/lab-02-microservices-en-typescript/README' },
            { text: 'Lab 03 · Serialisation et contrats API', link: '/labs/lab-03-serialisation-et-contrats-api/README' },
            { text: 'Lab 04 · Communication synchrone', link: '/labs/lab-04-communication-synchrone/README' },
            { text: 'Lab 05 · Communication asynchrone & queues', link: '/labs/lab-05-communication-asynchrone-message-queues/README' },
            { text: 'Lab 06 · Event-driven architecture', link: '/labs/lab-06-event-driven-architecture/README' },
            { text: 'Lab 07 · API Gateway et BFF', link: '/labs/lab-07-api-gateway-et-bff/README' },
            { text: 'Lab 08 · Retries, timeouts, idempotency', link: '/labs/lab-08-retries-timeouts-idempotency/README' },
            { text: 'Lab 09 · Coherence et CAP', link: '/labs/lab-09-coherence-et-theoreme-cap/README' },
            { text: 'Lab 10 · Replication et partitionnement', link: '/labs/lab-10-replication-et-partitionnement/README' },
            { text: 'Lab 11 · Transactions distribuees & saga', link: '/labs/lab-11-transactions-distribuees-saga/README' },
            { text: 'Lab 12 · CQRS et event sourcing', link: '/labs/lab-12-cqrs-event-sourcing/README' },
            { text: 'Lab 13 · Outbox & reliable messaging', link: '/labs/lab-13-outbox-pattern-reliable-messaging/README' },
            { text: 'Lab 14 · Failure modes & circuit breaker', link: '/labs/lab-14-failure-modes-et-circuit-breaker/README' },
            { text: 'Lab 15 · Rate limiting et backpressure', link: '/labs/lab-15-rate-limiting-et-backpressure/README' },
            { text: 'Lab 16 · Observabilite distribuee', link: '/labs/lab-16-observabilite-distribuee/README' },
            { text: 'Lab 17 · Testing distribue', link: '/labs/lab-17-testing-distribue/README' },
            { text: 'Lab 18 · Consensus et coordination', link: '/labs/lab-18-consensus-et-coordination/README' },
            { text: 'Lab 19 · Temps, ordre et horloges', link: '/labs/lab-19-temps-ordre-et-horloges/README' },
            { text: 'Lab 20 · Stream processing', link: '/labs/lab-20-stream-processing/README' },
            { text: 'Lab 21 · CRDTs et resolution de conflits', link: '/labs/lab-21-crdts-et-resolution-de-conflits/README' },
            { text: 'Lab 22 · Projet final', link: '/labs/lab-22-projet-final/README' },
          ],
        },
      ],
    },

    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'Sur cette page' },
    docFooter: { prev: 'Page precedente', next: 'Page suivante' },
  },
});
