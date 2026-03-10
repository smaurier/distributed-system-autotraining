import pino from 'pino';
import type { DomainEvent } from '../../../shared/types/events.js';

const logger = pino({ name: 'outbox' });

interface OutboxEntry {
  event: DomainEvent;
  status: 'pending' | 'sent' | 'failed';
  retryCount: number;
  createdAt: string;
  lastAttemptAt: string | null;
}

export class Outbox {
  private entries: Map<string, OutboxEntry> = new Map();
  private handlers: Map<string, ((event: DomainEvent) => Promise<void>)[]> = new Map();
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly processingIntervalMs: number = 5000) {}

  /** Register a handler for a specific event type */
  on(eventType: string, handler: (event: DomainEvent) => Promise<void>): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /** Add an event to the outbox */
  add(event: DomainEvent): void {
    const entry: OutboxEntry = {
      event,
      status: 'pending',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
    };
    this.entries.set(event.id, entry);
    logger.info({ eventId: event.id, eventType: event.type }, 'Event added to outbox');
  }

  /** Process all pending events */
  async processPending(): Promise<void> {
    const pendingEntries = Array.from(this.entries.values()).filter(
      (entry) => entry.status === 'pending' || entry.status === 'failed'
    );

    for (const entry of pendingEntries) {
      if (entry.retryCount >= 3) {
        logger.error(
          { eventId: entry.event.id, eventType: entry.event.type },
          'Event exceeded max retries, marking as failed permanently'
        );
        entry.status = 'failed';
        continue;
      }

      const handlers = this.handlers.get(entry.event.type) || [];
      if (handlers.length === 0) {
        logger.warn({ eventType: entry.event.type }, 'No handlers registered for event type');
        entry.status = 'sent';
        continue;
      }

      try {
        entry.lastAttemptAt = new Date().toISOString();
        await Promise.all(handlers.map((handler) => handler(entry.event)));
        entry.status = 'sent';
        logger.info(
          { eventId: entry.event.id, eventType: entry.event.type },
          'Event processed successfully'
        );
      } catch (error) {
        entry.retryCount++;
        entry.status = 'failed';
        logger.error(
          { eventId: entry.event.id, eventType: entry.event.type, error, retryCount: entry.retryCount },
          'Failed to process event'
        );
      }
    }
  }

  /** Start periodic processing */
  startProcessing(): void {
    if (this.processingInterval) return;
    this.processingInterval = setInterval(() => {
      this.processPending().catch((err) => {
        logger.error({ err }, 'Error in outbox processing loop');
      });
    }, this.processingIntervalMs);
    logger.info({ intervalMs: this.processingIntervalMs }, 'Outbox processing started');
  }

  /** Stop periodic processing */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info('Outbox processing stopped');
    }
  }

  /** Get all entries (for debugging/inspection) */
  getEntries(): OutboxEntry[] {
    return Array.from(this.entries.values());
  }

  /** Get entry count by status */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = { pending: 0, sent: 0, failed: 0 };
    for (const entry of this.entries.values()) {
      stats[entry.status] = (stats[entry.status] || 0) + 1;
    }
    return stats;
  }
}

// Singleton outbox instance
export const outbox = new Outbox();
