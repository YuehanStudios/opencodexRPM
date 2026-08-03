const fs = require('fs');
const filePath = 'src/types.ts';
let content = fs.readFileSync(filePath, 'utf8');

const oldConfig = `  rateLimit?: {
    /** Maximum requests per window. Default: 20 */
    maxRequests?: number;
    /** Window duration in milliseconds. Default: 60000 (1 minute) */
    windowMs?: number;
    /** When true, distributes requests evenly across the window. When false, allows bursts. Default: true */
    evenDistribution?: boolean;
    /** Enable/disable rate limiting. Default: false (disabled) */
    enabled?: boolean;
  };`;

const newConfig = `  rateLimit?: {
    /** Maximum requests per window. Default: 20 */
    maxRequests?: number;
    /** Window duration in milliseconds. Default: 60000 (1 minute) */
    windowMs?: number;
    /** When true, distributes requests evenly across the window. When false, allows bursts. Default: true */
    evenDistribution?: boolean;
    /** Enable/disable rate limiting. Default: false (disabled) */
    enabled?: boolean;
    /**
     * When true, requests that exceed the rate limit are enqueued and run
     * sequentially when capacity frees up (no 429 error returned to caller
     * unless the queue timeout is exceeded). Default: true.
     */
    queueWhenLimited?: boolean;
    /**
     * Maximum time (ms) a queued request waits for capacity before the
     * server returns a 429. Default: 300000 (5 minutes).
     */
    queueTimeoutMs?: number;
  };`;

if (content.includes(oldConfig)) {
  content = content.replace(oldConfig, newConfig);
  console.log('Types patch applied: rateLimit config extended');
} else if (content.includes('queueWhenLimited')) {
  console.log('Types patch skipped: already applied');
} else {
  console.log('Types patch ERROR: pattern not found');
  const idx = content.indexOf('rateLimit');
  console.log('Context: ' + content.substring(Math.max(0, idx - 100), idx + 400));
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('=== Types file saved ===');
