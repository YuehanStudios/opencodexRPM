const fs = require('fs');
const filePath = 'src/lib/rate-limiter.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Patch 1: Add properties to RateLimitConfig
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
} else {
  console.log('Patch 1 skipped (pattern not found)');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('Saved');
