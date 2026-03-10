// =============================================================================
// Lab 12 — Saga Pattern (Solution)
// =============================================================================

import { createTestRunner, createMockMessageBroker, simulateNetworkDelay } from '../test-utils';

// =============================================================================
// Exercice 1 : Compensating transactions
// =============================================================================

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
    if (this.executed) return;
    await this.executeFn();
    this.executed = true;
  }

  async compensate(): Promise<void> {
    if (!this.executed || this.compensated) return;
    await this.compensateFn();
    this.compensated = true;
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
  return {
    name,
    execute: executeFn,
    compensate: compensateFn,
  };
}

// =============================================================================
// Exercice 3 : Saga orchestrator
// =============================================================================

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
    const completedSteps: string[] = [];
    const compensatedSteps: string[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      try {
        await step.execute();
        completedSteps.push(step.name);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // Compensate in reverse order
        for (let j = completedSteps.length - 1; j >= 0; j--) {
          await this.steps[j].compensate();
          compensatedSteps.push(this.steps[j].name);
        }
        return {
          success: false,
          completedSteps,
          failedStep: step.name,
          compensatedSteps,
          error,
        };
      }
    }

    return {
      success: true,
      completedSteps,
      compensatedSteps,
    };
  }
}

// =============================================================================
// Exercice 4 : Choreography saga
// =============================================================================

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
    this.steps.push({ name, channel, handler, compensateChannel, compensateHandler });
    this.broker.subscribe(channel, async (msg) => {
      await handler(msg as SagaEvent);
    });
    this.broker.subscribe(compensateChannel, async (msg) => {
      await compensateHandler(msg as SagaEvent);
    });
  }

  async start(): Promise<void> {
    if (this.steps.length === 0) return;
    const firstStep = this.steps[0];
    const event: SagaEvent = {
      type: 'start',
      stepName: firstStep.name,
      timestamp: Date.now(),
    };
    this.broker.publish(firstStep.channel, event);
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

interface TimeoutSagaStep extends SagaStep {
  timeoutMs: number;
}

class TimeoutSagaOrchestrator {
  private steps: TimeoutSagaStep[] = [];

  addStep(step: TimeoutSagaStep): void {
    this.steps.push(step);
  }

  async run(): Promise<SagaResult> {
    const completedSteps: string[] = [];
    const compensatedSteps: string[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      try {
        await Promise.race([
          step.execute(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Step '${step.name}' timed out after ${step.timeoutMs}ms`)), step.timeoutMs)
          ),
        ]);
        completedSteps.push(step.name);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        // Compensate in reverse order
        for (let j = completedSteps.length - 1; j >= 0; j--) {
          await this.steps[j].compensate();
          compensatedSteps.push(this.steps[j].name);
        }
        return {
          success: false,
          completedSteps,
          failedStep: step.name,
          compensatedSteps,
          error,
        };
      }
    }

    return {
      success: true,
      completedSteps,
      compensatedSteps,
    };
  }
}

// =============================================================================
// Exercice 6 : Saga execution log
// =============================================================================

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
    const completedSteps: string[] = [];
    const compensatedSteps: string[] = [];
    this.log = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const start = Date.now();
      try {
        await step.execute();
        const durationMs = Date.now() - start;
        this.log.push({
          timestamp: start,
          stepName: step.name,
          action: 'execute',
          status: 'success',
          durationMs,
        });
        completedSteps.push(step.name);
      } catch (err) {
        const durationMs = Date.now() - start;
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log.push({
          timestamp: start,
          stepName: step.name,
          action: 'execute',
          status: 'failure',
          durationMs,
          error: errorMsg,
        });

        // Compensate in reverse order
        for (let j = completedSteps.length - 1; j >= 0; j--) {
          const compStart = Date.now();
          try {
            await this.steps[j].compensate();
            this.log.push({
              timestamp: compStart,
              stepName: this.steps[j].name,
              action: 'compensate',
              status: 'success',
              durationMs: Date.now() - compStart,
            });
          } catch (compErr) {
            this.log.push({
              timestamp: compStart,
              stepName: this.steps[j].name,
              action: 'compensate',
              status: 'failure',
              durationMs: Date.now() - compStart,
              error: compErr instanceof Error ? compErr.message : String(compErr),
            });
          }
          compensatedSteps.push(this.steps[j].name);
        }

        return {
          result: {
            success: false,
            completedSteps,
            failedStep: step.name,
            compensatedSteps,
            error: errorMsg,
          },
          log: [...this.log],
        };
      }
    }

    return {
      result: {
        success: true,
        completedSteps,
        compensatedSteps,
      },
      log: [...this.log],
    };
  }

  getLog(): LogEntry[] {
    return [...this.log];
  }

  getTimeline(): string[] {
    return this.log.map(entry =>
      `[${entry.timestamp}] ${entry.stepName}: ${entry.action} -> ${entry.status} (${entry.durationMs} ms)`
    );
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
