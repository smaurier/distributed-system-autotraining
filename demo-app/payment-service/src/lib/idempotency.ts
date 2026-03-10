import pino from 'pino';

const logger = pino({ name: 'idempotency-store' });

interface IdempotencyEntry<T = unknown> {
  key: string;
  result: T;
  createdAt: string;
  expiresAt: string;
}

export class IdempotencyStore {
  private store: Map<string, IdempotencyEntry> = new Map();
  private readonly ttlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    // Default 24h TTL
    this.ttlMs = ttlMs;
  }

  /** Check if a key already has a stored result */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (new Date(entry.expiresAt) < new Date()) {
      this.store.delete(key);
      logger.info({ key }, 'Idempotency key expired and removed');
      return null;
    }

    logger.info({ key }, 'Idempotency key hit - returning cached result');
    return entry.result as T;
  }

  /** Store a result for an idempotency key */
  set<T>(key: string, result: T): void {
    const now = new Date();
    const entry: IdempotencyEntry<T> = {
      key,
      result,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
    };
    this.store.set(key, entry as IdempotencyEntry);
    logger.info({ key, expiresAt: entry.expiresAt }, 'Idempotency key stored');
  }

  /** Check if a key exists (without returning the result) */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (new Date(entry.expiresAt) < new Date()) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /** Remove a key */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** Start periodic cleanup of expired entries */
  startCleanup(intervalMs: number = 60000): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      let removed = 0;
      for (const [key, entry] of this.store.entries()) {
        if (new Date(entry.expiresAt) < now) {
          this.store.delete(key);
          removed++;
        }
      }
      if (removed > 0) {
        logger.info({ removed, remaining: this.store.size }, 'Expired idempotency keys cleaned up');
      }
    }, intervalMs);
  }

  /** Stop periodic cleanup */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Get store size */
  size(): number {
    return this.store.size;
  }
}

// Singleton instance
export const idempotencyStore = new IdempotencyStore();
