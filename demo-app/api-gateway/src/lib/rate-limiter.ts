import pino from 'pino';

const logger = pino({ name: 'rate-limiter' });

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimiterOptions {
  maxTokens: number;
  refillRate: number;     // Tokens per second
  refillInterval: number; // Milliseconds between refills
}

const DEFAULT_OPTIONS: RateLimiterOptions = {
  maxTokens: 100,
  refillRate: 10,
  refillInterval: 1000,
};

export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private readonly options: RateLimiterOptions;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Try to consume a token for the given key. Returns true if allowed. */
  consume(key: string, tokens: number = 1): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket);

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    // Calculate how long the client needs to wait
    const tokensNeeded = tokens - bucket.tokens;
    const retryAfterMs = Math.ceil((tokensNeeded / this.options.refillRate) * 1000);

    logger.warn(
      { key, tokensNeeded, remaining: Math.floor(bucket.tokens), retryAfterMs },
      'Rate limit exceeded'
    );

    return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs };
  }

  /** Get current status for a key */
  getStatus(key: string): { tokens: number; maxTokens: number } {
    const bucket = this.getOrCreateBucket(key);
    this.refill(bucket);
    return { tokens: Math.floor(bucket.tokens), maxTokens: this.options.maxTokens };
  }

  /** Reset a specific key */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Reset all keys */
  resetAll(): void {
    this.buckets.clear();
  }

  /** Start periodic cleanup of stale buckets */
  startCleanup(intervalMs: number = 60000, maxAgeMs: number = 300000): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      for (const [key, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > maxAgeMs) {
          this.buckets.delete(key);
          removed++;
        }
      }
      if (removed > 0) {
        logger.info({ removed, remaining: this.buckets.size }, 'Stale rate limit buckets cleaned');
      }
    }, intervalMs);
  }

  /** Stop cleanup */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private getOrCreateBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.options.maxTokens,
        lastRefill: Date.now(),
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = (elapsed / 1000) * this.options.refillRate;

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(this.options.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }
}

// Singleton rate limiter
export const rateLimiter = new RateLimiter({
  maxTokens: 100,
  refillRate: 10,
  refillInterval: 1000,
});
