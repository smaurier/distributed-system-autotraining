// =============================================================================
// Lab 12 — Saga Pattern (Exercise)
// =============================================================================

import { createTestRunner, createMockMessageBroker, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : Compensating transactions
// =============================================================================
// Implementer une action compensable avec execute() et compensate().

class CompensableAction {
  private executed: boolean = false;
  private compensated: boolean = false;
  private executeFn: () => Promise<void>;
  private compensateFn: () => Promise<void>;

  constructor(executeFn: () => Promise<void>, compensateFn: () => Promise<void>) {
    this.executeFn = executeFn;
    this.compensateFn = compensateFn;
  }

  async execute(): Promise<void> {
    // TODO: Executer l'action si elle n'a pas deja ete executee
    // Mettre executed a true
    throw new Error('Not implemented');
  }

  async compensate(): Promise<void> {
    // TODO: Compenser l'action si elle a ete executee et pas encore compensee
    // Mettre compensated a true
    throw new Error('Not implemented');
  }

  isExecuted(): boolean {
    return this.executed;
  }

  isCompensated(): boolean {
    return this.compensated;
  }
}

// =============================================================================
// Exercice 2 : Saga step definition
// =============================================================================
// Definir un SagaStep avec un nom, une fonction d'execution et de compensation.

interface SagaStep {
  name: string;
  execute: () => Promise<void>;
  compensate: () => Promise<void>;
}

function createSagaStep(
  name: string,
  executeFn: () => Promise<void>,
  compensateFn: () => Promise<void>
): SagaStep {
  // TODO: Retourner un objet SagaStep
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Saga orchestrator
// =============================================================================
// Executer les etapes sequentiellement.
// En cas d'echec, executer les compensations en ordre inverse.

interface SagaResult {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  compensatedSteps: string[];
  error?: string;
}

class SagaOrchestrator {
  private steps: SagaStep[] = [];

  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  async run(): Promise<SagaResult> {
    // TODO: Executer les etapes dans l'ordre
    // Si une etape echoue :
    //   - Enregistrer l'etape echouee
    //   - Executer les compensations des etapes precedentes en ordre inverse
    // Retourner le resultat avec success, completedSteps, failedStep, compensatedSteps, error
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 4 : Choreography saga
// =============================================================================
// Saga pilotee par les evenements via un message broker.

interface SagaEvent {
  type: string;
  stepName: string;
  timestamp: number;
  data?: unknown;
}

class ChoreographySaga {
  private broker: ReturnType<typeof createMockMessageBroker>;
  private steps: { name: string; channel: string; handler: (event: SagaEvent) => Promise<void>; compensateChannel: string; compensateHandler: (event: SagaEvent) => Promise<void> }[] = [];
  private completedSteps: string[] = [];
  private failedStep: string | null = null;

  constructor(broker: ReturnType<typeof createMockMessageBroker>) {
    this.broker = broker;
  }

  addStep(
    name: string,
    channel: string,
    handler: (event: SagaEvent) => Promise<void>,
    compensateChannel: string,
    compensateHandler: (event: SagaEvent) => Promise<void>
  ): void {
    // TODO: Enregistrer l'etape et s'abonner aux canaux
    throw new Error('Not implemented');
  }

  async start(): Promise<void> {
    // TODO: Demarrer la saga en publiant sur le premier canal
    throw new Error('Not implemented');
  }

  getCompletedSteps(): string[] {
    return [...this.completedSteps];
  }

  getFailedStep(): string | null {
    return this.failedStep;
  }

  markCompleted(stepName: string): void {
    this.completedSteps.push(stepName);
  }

  markFailed(stepName: string): void {
    this.failedStep = stepName;
  }
}

// =============================================================================
// Exercice 5 : Saga with timeouts
// =============================================================================
// Si une etape prend trop de temps, traiter comme un echec.

interface TimeoutSagaStep extends SagaStep {
  timeoutMs: number;
}

class TimeoutSagaOrchestrator {
  private steps: TimeoutSagaStep[] = [];

  addStep(step: TimeoutSagaStep): void {
    this.steps.push(step);
  }

  async run(): Promise<SagaResult> {
    // TODO: Comme SagaOrchestrator mais avec gestion des timeouts
    // Si une etape depasse son timeoutMs, la traiter comme un echec
    // et lancer les compensations
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Exercice 6 : Saga execution log
// =============================================================================
// Journaliser toutes les executions avec horodatage.

interface LogEntry {
  timestamp: number;
  stepName: string;
  action: 'execute' | 'compensate';
  status: 'success' | 'failure';
  durationMs: number;
  error?: string;
}

class SagaWithLog {
  private steps: SagaStep[] = [];
  private log: LogEntry[] = [];

  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  async run(): Promise<{ result: SagaResult; log: LogEntry[] }> {
    // TODO: Executer la saga comme SagaOrchestrator
    // Mais enregistrer chaque execution et compensation dans le log
    // avec timestamp, duree, statut et erreur eventuelle
    throw new Error('Not implemented');
  }

  getLog(): LogEntry[] {
    return [...this.log];
  }

  getTimeline(): string[] {
    // TODO: Retourner un resume lisible de chaque entree du log
    // Format: "[timestamp] stepName: action -> status (durationMs ms)"
    throw new Error('Not implemented');
  }
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  const { test, assert, assertEqual, assertDeepEqual, summary } = createTestRunner('Lab 12 — Saga Pattern');

  // --- Exercice 1 ---
  console.log('\n📘 Exercice 1 : Compensating transactions');

  await test('Execute action', async () => {
    let executed = false;
    const action = new CompensableAction(
      async () => { executed = true; },
      async () => {}
    );
    await action.execute();
    assert(executed, 'Action should be executed');
    assert(action.isExecuted(), 'isExecuted should be true');
  });

  await test('Compensate executed action', async () => {
    let compensated = false;
    const action = new CompensableAction(
      async () => {},
      async () => { compensated = true; }
    );
    await action.execute();
    await action.compensate();
    assert(compensated, 'Action should be compensated');
    assert(action.isCompensated(), 'isCompensated should be true');
  });

  await test('Cannot compensate non-executed action', async () => {
    let compensated = false;
    const action = new CompensableAction(
      async () => {},
      async () => { compensated = true; }
    );
    await action.compensate();
    assert(!compensated, 'Should not compensate non-executed action');
  });

  await test('Cannot execute twice', async () => {
    let count = 0;
    const action = new CompensableAction(
      async () => { count++; },
      async () => {}
    );
    await action.execute();
    await action.execute();
    assertEqual(count, 1);
  });

  // --- Exercice 2 ---
  console.log('\n📘 Exercice 2 : Saga step definition');

  await test('Create a saga step', async () => {
    let executed = false;
    let compensated = false;
    const step = createSagaStep(
      'reserve-stock',
      async () => { executed = true; },
      async () => { compensated = true; }
    );
    assertEqual(step.name, 'reserve-stock');
    await step.execute();
    assert(executed, 'Step should execute');
    await step.compensate();
    assert(compensated, 'Step should compensate');
  });

  // --- Exercice 3 ---
  console.log('\n📘 Exercice 3 : Saga orchestrator');

  await test('Successful saga completes all steps', async () => {
    const saga = new SagaOrchestrator();
    const order: string[] = [];
    saga.addStep(createSagaStep('step1', async () => { order.push('exec1'); }, async () => { order.push('comp1'); }));
    saga.addStep(createSagaStep('step2', async () => { order.push('exec2'); }, async () => { order.push('comp2'); }));
    saga.addStep(createSagaStep('step3', async () => { order.push('exec3'); }, async () => { order.push('comp3'); }));
    const result = await saga.run();
    assertEqual(result.success, true);
    assertDeepEqual(result.completedSteps, ['step1', 'step2', 'step3']);
    assertEqual(result.compensatedSteps.length, 0);
    assertDeepEqual(order, ['exec1', 'exec2', 'exec3']);
  });

  await test('Failed saga compensates in reverse', async () => {
    const saga = new SagaOrchestrator();
    const order: string[] = [];
    saga.addStep(createSagaStep('step1', async () => { order.push('exec1'); }, async () => { order.push('comp1'); }));
    saga.addStep(createSagaStep('step2', async () => { order.push('exec2'); }, async () => { order.push('comp2'); }));
    saga.addStep(createSagaStep('step3', async () => { throw new Error('boom'); }, async () => { order.push('comp3'); }));
    const result = await saga.run();
    assertEqual(result.success, false);
    assertEqual(result.failedStep, 'step3');
    assertDeepEqual(result.completedSteps, ['step1', 'step2']);
    assertDeepEqual(result.compensatedSteps, ['step2', 'step1']);
    assertDeepEqual(order, ['exec1', 'exec2', 'comp2', 'comp1']);
  });

  await test('First step failure means no compensation', async () => {
    const saga = new SagaOrchestrator();
    const order: string[] = [];
    saga.addStep(createSagaStep('step1', async () => { throw new Error('fail'); }, async () => { order.push('comp1'); }));
    const result = await saga.run();
    assertEqual(result.success, false);
    assertEqual(result.failedStep, 'step1');
    assertEqual(result.compensatedSteps.length, 0);
    assertEqual(order.length, 0);
  });

  // --- Exercice 4 ---
  console.log('\n📘 Exercice 4 : Choreography saga');

  await test('Choreography saga publishes events', async () => {
    const broker = createMockMessageBroker();
    const saga = new ChoreographySaga(broker);
    saga.addStep(
      'create-order',
      'order.create',
      async () => { saga.markCompleted('create-order'); },
      'order.cancel',
      async () => {}
    );
    saga.addStep(
      'reserve-stock',
      'stock.reserve',
      async () => { saga.markCompleted('reserve-stock'); },
      'stock.release',
      async () => {}
    );
    await saga.start();
    const completed = saga.getCompletedSteps();
    assert(completed.includes('create-order'), 'First step should be completed');
  });

  await test('Choreography tracks completed steps', async () => {
    const broker = createMockMessageBroker();
    const saga = new ChoreographySaga(broker);
    saga.addStep(
      'step-a',
      'channel-a',
      async () => { saga.markCompleted('step-a'); },
      'channel-a-comp',
      async () => {}
    );
    await saga.start();
    assertDeepEqual(saga.getCompletedSteps(), ['step-a']);
  });

  // --- Exercice 5 ---
  console.log('\n📘 Exercice 5 : Saga with timeouts');

  await test('Step completes within timeout', async () => {
    const saga = new TimeoutSagaOrchestrator();
    saga.addStep({ name: 'fast', execute: async () => {}, compensate: async () => {}, timeoutMs: 1000 });
    const result = await saga.run();
    assertEqual(result.success, true);
  });

  await test('Step times out and triggers compensation', async () => {
    const saga = new TimeoutSagaOrchestrator();
    const compensated: string[] = [];
    saga.addStep({
      name: 'step1',
      execute: async () => {},
      compensate: async () => { compensated.push('step1'); },
      timeoutMs: 1000,
    });
    saga.addStep({
      name: 'slow-step',
      execute: async () => { await simulateNetworkDelay(200); },
      compensate: async () => { compensated.push('slow-step'); },
      timeoutMs: 50,
    });
    const result = await saga.run();
    assertEqual(result.success, false);
    assertEqual(result.failedStep, 'slow-step');
    assert(compensated.includes('step1'), 'Previous step should be compensated');
  });

  // --- Exercice 6 ---
  console.log('\n📘 Exercice 6 : Saga execution log');

  await test('Log records all executions', async () => {
    const saga = new SagaWithLog();
    saga.addStep(createSagaStep('s1', async () => {}, async () => {}));
    saga.addStep(createSagaStep('s2', async () => {}, async () => {}));
    const { result, log } = await saga.run();
    assertEqual(result.success, true);
    assertEqual(log.length, 2);
    assertEqual(log[0].stepName, 's1');
    assertEqual(log[0].action, 'execute');
    assertEqual(log[0].status, 'success');
  });

  await test('Log records compensations on failure', async () => {
    const saga = new SagaWithLog();
    saga.addStep(createSagaStep('s1', async () => {}, async () => {}));
    saga.addStep(createSagaStep('s2', async () => { throw new Error('fail'); }, async () => {}));
    const { result, log } = await saga.run();
    assertEqual(result.success, false);
    const execEntries = log.filter(e => e.action === 'execute');
    const compEntries = log.filter(e => e.action === 'compensate');
    assertEqual(execEntries.length, 2);
    assertEqual(execEntries[1].status, 'failure');
    assertEqual(compEntries.length, 1);
    assertEqual(compEntries[0].stepName, 's1');
  });

  await test('Timeline produces readable output', async () => {
    const saga = new SagaWithLog();
    saga.addStep(createSagaStep('s1', async () => {}, async () => {}));
    await saga.run();
    const timeline = saga.getTimeline();
    assertEqual(timeline.length, 1);
    assert(timeline[0].includes('s1'), 'Timeline should mention step name');
    assert(timeline[0].includes('execute'), 'Timeline should mention action');
    assert(timeline[0].includes('success'), 'Timeline should mention status');
  });

  await test('Log entries have timestamps and durations', async () => {
    const saga = new SagaWithLog();
    saga.addStep(createSagaStep('s1', async () => { await simulateNetworkDelay(10); }, async () => {}));
    const { log } = await saga.run();
    assert(log[0].timestamp > 0, 'Should have timestamp');
    assert(log[0].durationMs >= 0, 'Should have duration');
  });

  summary();
}

main().catch(console.error);
