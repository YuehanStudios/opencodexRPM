const fs = require('fs');
const filePath = 'src/lib/rate-limiter.ts';
let content = fs.readFileSync(filePath, 'utf8');

// === Patch 1: Add properties to RateLimitConfig ===
const oldConfig = `export interface RateLimitConfig {
  /** Maximum number of requests allowed per window */
  maxRequests: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs: number;
  /** Whether to distribute requests evenly (true) or allow bursts (false) */
  evenDistribution: boolean;
}`;

const newConfig = `export interface RateLimitConfig {
  /** Maximum number of requests allowed per window */
  maxRequests: number;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs: number;
  /** Whether to distribute requests evenly (true) or allow bursts (false) */
  evenDistribution: boolean;
  /** When true, requests that exceed the rate limit are enqueued and run sequentially when capacity frees up (no 429 error returned). Default: true. */
  queueWhenLimited?: boolean;
  /** Maximum time (ms) a queued request waits for capacity before rejecting with 429. Default: 300000 (5 minutes). */
  queueTimeoutMs?: number;
}`;

if (content.includes(oldConfig)) {
  content = content.replace(oldConfig, newConfig);
  console.log('Patch 1 applied: RateLimitConfig extended');
} else if (content.includes('queueWhenLimited')) {
  console.log('Patch 1 skipped: already applied');
} else {
  console.log('Patch 1 ERROR: pattern not found');
}

// === Patch 2: Add waiters array to TokenBucket ===
const oldBucketClass = `class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
    // For even distribution: refill one token every (windowMs / maxRequests) ms
    this.refillIntervalMs = windowMs / maxRequests;
  }`;

const newBucketClass = `class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  /** FIFO queue of resolvers waiting for a token. */
  private waiters: Array<() => void> = [];

  constructor(maxRequests: number, windowMs: number) {
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
    // For even distribution: refill one token every (windowMs / maxRequests) ms
    this.refillIntervalMs = windowMs / maxRequests;
  }`;

if (content.includes(oldBucketClass)) {
  content = content.replace(oldBucketClass, newBucketClass);
  console.log('Patch 2 applied: TokenBucket waiters field added');
} else if (content.includes('waiters: Array')) {
  console.log('Patch 2 skipped: already applied');
} else {
  console.log('Patch 2 ERROR: pattern not found');
}

// === Patch 3: Add waitForToken and notifyWaiters methods to TokenBucket (after getTimeUntilNextToken) ===
const oldGetTokenMethod = `  public getTimeUntilNextToken(): number {
    this.refill();
    
    if (this.tokens >= 1) {
      return 0;
    }
    
    const timeSinceLastRefill = Date.now() - this.lastRefill;
    return Math.ceil(this.refillIntervalMs - timeSinceLastRefill);
  }
}

class SlidingWindowCounter {`;

const newGetTokenMethod = `  public getTimeUntilNextToken(): number {
    this.refill();
    
    if (this.tokens >= 1) {
      return 0;
    }
    
    const timeSinceLastRefill = Date.now() - this.lastRefill;
    return Math.ceil(this.refillIntervalMs - timeSinceLastRefill);
  }

  /**
   * Block (enqueue) until at least one token is available, then consume it.
   * Returns true if a token was obtained, false if timeoutMs elapsed.
   * Waiters are released in FIFO order each time notifyWaiters runs.
   */
  public async waitForToken(timeoutMs: number): Promise<boolean> {
    if (this.consume()) return true;

    return new Promise<boolean>(resolve => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(this.consume());
      };
      let cleanup = () => {};
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== done);
        cleanup();
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }, timeoutMs);
      cleanup = () => clearTimeout(timer);
      this.waiters.push(done);
    });
  }

  /** Resolve queued waiters when tokens are available, draining them in FIFO order. */
  public notifyWaiters(): void {
    this.refill();
    if (this.tokens < 1) return;
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }
}

class SlidingWindowCounter {`;

if (content.includes(oldGetTokenMethod)) {
  content = content.replace(oldGetTokenMethod, newGetTokenMethod);
  console.log('Patch 3 applied: waitForToken + notifyWaiters added to TokenBucket');
} else if (content.includes('waitForToken')) {
  console.log('Patch 3 skipped: already applied');
} else {
  console.log('Patch 3 ERROR: pattern not found');
}

// === Patch 4: Add getTimeToSlot to SlidingWindowCounter (after record method) ===
const oldRecordMethod = `  public record(): void {
    this.requests.push(Date.now());
  }
}

export class RateLimiter {`;

const newRecordMethod = `  public record(): void {
    this.requests.push(Date.now());
  }

  /** Returns ms until a slot frees up (0 if available). */
  public getTimeToSlot(): number {
    this.cleanup();
    if (this.requests.length < this.maxRequests) return 0;
    const now = Date.now();
    const oldest = this.requests[0];
    if (!oldest) return 0;
    return Math.max(0, oldest + this.windowMs - now);
  }
}

export class RateLimiter {`;

if (content.includes(oldRecordMethod)) {
  content = content.replace(oldRecordMethod, newRecordMethod);
  console.log('Patch 4 applied: getTimeToSlot added to SlidingWindowCounter');
} else if (content.includes('getTimeToSlot')) {
  console.log('Patch 4 skipped: already applied');
} else {
  console.log('Patch 4 ERROR: pattern not found');
}

// === Patch 5: Add notifyWaiters() call in checkByKey ===
const oldCheckByKeyConsume = `      if (limiter instanceof TokenBucket) {
        const allowed = limiter.consume();
        return {
          allowed,`;

const newCheckByKeyConsume = `      if (limiter instanceof TokenBucket) {
        const allowed = limiter.consume();
        if (allowed) limiter.notifyWaiters();
        return {
          allowed,`;

if (content.includes(oldCheckByKeyConsume)) {
  content = content.replace(oldCheckByKeyConsume, newCheckByKeyConsume);
  console.log('Patch 5 applied: notifyWaiters in checkByKey');
} else {
  console.log('Patch 5 skipped (pattern not found or already applied)');
}

// === Patch 6: Add notifyWaiters() call in checkGlobal ===
const oldCheckGlobalConsume = `    if (this.globalBucket) {
      const allowed = this.globalBucket.consume();
      return {`;

const newCheckGlobalConsume = `    if (this.globalBucket) {
      const allowed = this.globalBucket.consume();
      if (allowed) this.globalBucket.notifyWaiters();
      return {`;

if (content.includes(oldCheckGlobalConsume)) {
  content = content.replace(oldCheckGlobalConsume, newCheckGlobalConsume);
  console.log('Patch 6 applied: notifyWaiters in checkGlobal');
} else {
  console.log('Patch 6 skipped (pattern not found or already applied)');
}

// === Patch 7: Add waitForGlobal method after checkGlobal ===
const oldAfterCheckGlobal = `    return {
      allowed: true,
      statusCode: 200,
      remaining: this.config.maxRequests,
      resetInMs: this.config.windowMs,
    };
  }

  /**
   * Extract client identifier from request (IP address or other identifier)`;

const newAfterCheckGlobal = `    return {
      allowed: true,
      statusCode: 200,
      remaining: this.config.maxRequests,
      resetInMs: this.config.windowMs,
    };
  }

  /**
   * Queue-aware variant of checkGlobal: when the bucket is exhausted the
   * caller is enqueued (FIFO) and only resumes when a token frees up or
   * the configured queue timeout elapses. Returns a result whose allowed
   * is true once capacity was obtained.
   *
   * When queueWhenLimited is false (or no global limiter is configured)
   * this falls back to checkGlobal() so legacy behavior is preserved.
   */
  public async waitForGlobal(): Promise<RateLimitResult> {
    const timeoutMs = this.config.queueTimeoutMs ?? 300000;

    if (this.config.queueWhenLimited === false) {
      return this.checkGlobal();
    }

    if (this.globalBucket) {
      const obtained = await this.globalBucket.waitForToken(timeoutMs);
      if (!obtained) {
        return {
          allowed: false,
          statusCode: 429,
          retryAfter: Math.ceil(this.globalBucket.getTimeUntilNextToken() / 1000),
          remaining: 0,
          resetInMs: this.globalBucket.getTimeUntilNextToken(),
        };
      }
      return {
        allowed: true,
        statusCode: 200,
        remaining: this.globalBucket.getRemaining(),
        resetInMs: this.globalBucket.getTimeUntilNextToken(),
      };
    }

    if (this.globalWindow) {
      const start = Date.now();
      while (true) {
        const r = this.globalWindow.check();
        if (r.allowed) {
          this.globalWindow.record();
          return r;
        }
        if (Date.now() - start >= timeoutMs) return r;
        const waitMs = Math.max(0, this.globalWindow.getTimeToSlot());
        await new Promise(resolve => setTimeout(resolve, Math.min(waitMs || 1000, 500)));
      }
    }

    return this.checkGlobal();
  }

  /**
   * Extract client identifier from request (IP address or other identifier)`;

if (content.includes(oldAfterCheckGlobal)) {
  content = content.replace(oldAfterCheckGlobal, newAfterCheckGlobal);
  console.log('Patch 7 applied: waitForGlobal method added');
} else if (content.includes('waitForGlobal')) {
  console.log('Patch 7 skipped: already applied');
} else {
  console.log('Patch 7 ERROR: pattern not found');
}

// === Patch 8: Update updateConfig to handle new fields ===
const oldUpdateConfig = `  public updateConfig(newConfig: Partial<RateLimitConfig>): void {
    if (newConfig.maxRequests !== undefined) {
      this.config.maxRequests = newConfig.maxRequests;
    }
    if (newConfig.windowMs !== undefined) {
      this.config.windowMs = newConfig.windowMs;
    }
    if (newConfig.evenDistribution !== undefined) {
      this.config.evenDistribution = newConfig.evenDistribution;`;

const newUpdateConfig = `  public updateConfig(newConfig: Partial<RateLimitConfig>): void {
    if (newConfig.maxRequests !== undefined) {
      this.config.maxRequests = newConfig.maxRequests;
    }
    if (newConfig.windowMs !== undefined) {
      this.config.windowMs = newConfig.windowMs;
    }
    if (newConfig.queueTimeoutMs !== undefined) {
      this.config.queueTimeoutMs = newConfig.queueTimeoutMs;
    }
    if (newConfig.queueWhenLimited !== undefined) {
      this.config.queueWhenLimited = newConfig.queueWhenLimited;
    }
    if (newConfig.evenDistribution !== undefined) {
      this.config.evenDistribution = newConfig.evenDistribution;`;

if (content.includes(oldUpdateConfig)) {
  content = content.replace(oldUpdateConfig, newUpdateConfig);
  console.log('Patch 8 applied: updateConfig extended');
} else {
  console.log('Patch 8 skipped (pattern not found or already applied)');
}

// === Patch 9: Update singleton to include queueWhenLimited ===
const oldSingleton = `    globalRateLimiter = new RateLimiter({
      maxRequests: 20,
      windowMs: 60000,
      evenDistribution: true,
    });`;

const newSingleton = `    globalRateLimiter = new RateLimiter({
      maxRequests: 20,
      windowMs: 60000,
      evenDistribution: true,
      queueWhenLimited: true,
    });`;

if (content.includes(oldSingleton)) {
  content = content.replace(oldSingleton, newSingleton);
  console.log('Patch 9 applied: singleton queueWhenLimited=true');
} else if (content.includes('queueWhenLimited: true,')) {
  console.log('Patch 9 skipped: already applied');
} else {
  console.log('Patch 9 ERROR: pattern not found');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('=== All patches saved to file ===');
