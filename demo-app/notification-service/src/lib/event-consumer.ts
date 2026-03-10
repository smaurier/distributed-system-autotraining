import pino from 'pino';
import type { DomainEvent } from '../../../shared/types/events.js';

const logger = pino({ name: 'event-consumer' });

type EventHandler = (event: DomainEvent) => Promise<void>;

interface ProcessedEvent {
  eventId: string;
  processedAt: string;
  success: boolean;
  error?: string;
}

export class EventConsumer {
  private handlers: Map<string, EventHandler[]> = new Map();
  private processedEvents: Map<string, ProcessedEvent> = new Map();
  private readonly maxProcessedHistory: number;

  constructor(maxProcessedHistory: number = 1000) {
    this.maxProcessedHistory = maxProcessedHistory;
  }

  /** Register a handler for a specific event type */
  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
    logger.info({ eventType, handlerCount: existing.length }, 'Event handler registered');
  }

  /** Process a single event, with deduplication */
  async process(event: DomainEvent): Promise<{ processed: boolean; duplicate: boolean }> {
    // Deduplication check
    if (this.processedEvents.has(event.id)) {
      logger.warn({ eventId: event.id, eventType: event.type }, 'Duplicate event detected, skipping');
      return { processed: false, duplicate: true };
    }

    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.length === 0) {
      logger.warn({ eventType: event.type }, 'No handlers registered for event type');
      return { processed: false, duplicate: false };
    }

    try {
      logger.info(
        { eventId: event.id, eventType: event.type, correlationId: event.correlationId },
        'Processing event'
      );

      await Promise.all(handlers.map((handler) => handler(event)));

      this.recordProcessed(event.id, true);
      logger.info(
        { eventId: event.id, eventType: event.type, correlationId: event.correlationId },
        'Event processed successfully'
      );
      return { processed: true, duplicate: false };
    } catch (error) {
      this.recordProcessed(event.id, false, (error as Error).message);
      logger.error(
        { eventId: event.id, eventType: event.type, error, correlationId: event.correlationId },
        'Failed to process event'
      );
      throw error;
    }
  }

  /** Process a batch of events */
  async processBatch(events: DomainEvent[]): Promise<{
    processed: number;
    duplicates: number;
    failed: number;
  }> {
    let processed = 0;
    let duplicates = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const result = await this.process(event);
        if (result.duplicate) {
          duplicates++;
        } else if (result.processed) {
          processed++;
        }
      } catch {
        failed++;
      }
    }

    return { processed, duplicates, failed };
  }

  private recordProcessed(eventId: string, success: boolean, error?: string): void {
    // Evict old entries if at capacity
    if (this.processedEvents.size >= this.maxProcessedHistory) {
      const oldestKey = this.processedEvents.keys().next().value;
      if (oldestKey) {
        this.processedEvents.delete(oldestKey);
      }
    }

    this.processedEvents.set(eventId, {
      eventId,
      processedAt: new Date().toISOString(),
      success,
      error,
    });
  }

  /** Get processing stats */
  getStats(): { totalProcessed: number; handlers: Record<string, number> } {
    const handlerStats: Record<string, number> = {};
    for (const [type, handlers] of this.handlers.entries()) {
      handlerStats[type] = handlers.length;
    }
    return {
      totalProcessed: this.processedEvents.size,
      handlers: handlerStats,
    };
  }

  /** Get processed event history */
  getHistory(): ProcessedEvent[] {
    return Array.from(this.processedEvents.values());
  }
}

// Singleton instance
export const eventConsumer = new EventConsumer();
