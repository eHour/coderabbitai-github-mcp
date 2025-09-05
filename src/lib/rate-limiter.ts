import { Logger } from './logger.js';

export interface RateLimitConfig {
  maxRequestsPerHour: number;
  maxRequestsPerMinute: number;
  maxConcurrent: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export class RateLimiter {
  private logger = new Logger('RateLimiter');
  private requestTimestamps: number[] = [];
  private concurrentRequests = 0;
  private backoffUntil: number = 0;
  private consecutiveErrors = 0;
  private acquireGuard = false;

  constructor(private config: RateLimitConfig) {
    const problems: string[] = [];
    if (config.maxRequestsPerHour <= 0) problems.push('maxRequestsPerHour must be > 0');
    if (config.maxRequestsPerMinute <= 0) problems.push('maxRequestsPerMinute must be > 0');
    if (config.maxConcurrent <= 0) problems.push('maxConcurrent must be > 0');
    if (config.backoffMultiplier < 1) problems.push('backoffMultiplier must be >= 1');
    if (config.maxBackoffMs <= 0) problems.push('maxBackoffMs must be > 0');
    if (problems.length) throw new Error(`Invalid RateLimitConfig: ${problems.join(', ')}`);
  }

  /**
   * Check if we can make a request based on rate limits
   */
  async checkLimit(): Promise<{ allowed: boolean; waitMs: number; reason?: string }> {
    const now = Date.now();

    // Check if we're in backoff period
    if (this.backoffUntil > now) {
      const waitMs = this.backoffUntil - now;
      return {
        allowed: false,
        waitMs,
        reason: `In backoff period, wait ${Math.ceil(waitMs / 1000)}s`
      };
    }

    // Check concurrent request limit
    if (this.concurrentRequests >= this.config.maxConcurrent) {
      return {
        allowed: false,
        waitMs: 1000,
        reason: `Max concurrent requests (${this.config.maxConcurrent}) reached`
      };
    }

    // Clean old timestamps
    const oneHourAgo = now - 3600000;
    const oneMinuteAgo = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneHourAgo);

    // Check hourly limit
    const requestsInLastHour = this.requestTimestamps.length;
    if (requestsInLastHour >= this.config.maxRequestsPerHour) {
      const oldestInWindow = Math.min(...this.requestTimestamps);
      const waitMs = oldestInWindow + 3600000 - now;
      return {
        allowed: false,
        waitMs,
        reason: `Hourly limit (${this.config.maxRequestsPerHour}) reached, wait ${Math.ceil(waitMs / 1000)}s`
      };
    }

    // Check minute limit
    const requestsInLastMinute = this.requestTimestamps.filter(ts => ts > oneMinuteAgo).length;
    if (requestsInLastMinute >= this.config.maxRequestsPerMinute) {
      const oldestInMinute = Math.min(...this.requestTimestamps.filter(ts => ts > oneMinuteAgo));
      const waitMs = oldestInMinute + 60000 - now;
      return {
        allowed: false,
        waitMs,
        reason: `Minute limit (${this.config.maxRequestsPerMinute}) reached, wait ${Math.ceil(waitMs / 1000)}s`
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  /**
   * Wait until rate limit allows request
   */
  async waitForLimit(): Promise<void> {
    // Keep for backward compatibility (no reservation)
    let check = await this.checkLimit();
    
    while (!check.allowed) {
      this.logger.info(`Rate limit: ${check.reason}`);
      await new Promise(resolve => setTimeout(resolve, check.waitMs));
      check = await this.checkLimit();
    }
  }

  /**
   * Atomically wait and reserve capacity to avoid races
   */
  async acquire(): Promise<void> {
    for (;;) {
      // Wait until likely allowed
      await this.waitForLimit();
      
      // Lightweight reservation guard: ensure only one reserver at a time
      if (this.acquireGuard) {
        await new Promise(r => setTimeout(r, 10));
        continue;
      }
      
      this.acquireGuard = true;
      try {
        const check = await this.checkLimit();
        if (check.allowed) {
          const now = Date.now();
          const oneHourAgo = now - 3600000;
          this.requestTimestamps = this.requestTimestamps.filter(ts => ts >= oneHourAgo);
          this.requestTimestamps.push(now);
          this.concurrentRequests++;
          return;
        }
      } finally {
        this.acquireGuard = false;
      }
      await new Promise(r => setTimeout(r, 25));
    }
  }

  /**
   * Record that a request is starting
   */
  startRequest(): void {
    this.requestTimestamps.push(Date.now());
    this.concurrentRequests++;
  }

  /**
   * Record that a request has completed
   */
  endRequest(success: boolean = true): void {
    this.concurrentRequests = Math.max(0, this.concurrentRequests - 1);
    
    if (success) {
      this.consecutiveErrors = 0;
    } else {
      this.consecutiveErrors++;
      // Exponential backoff on errors
      const backoffMs = Math.min(
        this.config.maxBackoffMs,
        1000 * Math.pow(this.config.backoffMultiplier, this.consecutiveErrors)
      );
      this.backoffUntil = Date.now() + backoffMs;
      this.logger.warn(`Backing off for ${backoffMs}ms after ${this.consecutiveErrors} consecutive errors`);
    }
  }

  /**
   * Handle rate limit error from API
   */
  handleRateLimitError(waitMinutes: number, waitSeconds: number): void {
    const waitMs = (waitMinutes * 60 + waitSeconds) * 1000;
    this.backoffUntil = Date.now() + waitMs;
    this.logger.warn(`API rate limit hit, backing off for ${waitMinutes}m ${waitSeconds}s`);
  }

  /**
   * Get current status
   */
  getStatus(): {
    requestsInLastHour: number;
    requestsInLastMinute: number;
    concurrentRequests: number;
    inBackoff: boolean;
    backoffRemainingSec: number;
    } {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneMinuteAgo = now - 60000;
    
    return {
      requestsInLastHour: this.requestTimestamps.filter(ts => ts > oneHourAgo).length,
      requestsInLastMinute: this.requestTimestamps.filter(ts => ts > oneMinuteAgo).length,
      concurrentRequests: this.concurrentRequests,
      inBackoff: this.backoffUntil > now,
      backoffRemainingSec: Math.max(0, Math.ceil((this.backoffUntil - now) / 1000))
    };
  }
}