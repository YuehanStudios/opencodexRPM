const fs = require('fs');
const filePath = 'src/server/index.ts';
let content = fs.readFileSync(filePath, 'utf8');

const oldInit = `    const limiter = new RateLimiter({
      maxRequests: config.rateLimit.maxRequests ?? 20,
      windowMs: config.rateLimit.windowMs ?? 60000,
      evenDistribution: config.rateLimit.evenDistribution ?? true,
    });`;

const newInit = `    const limiter = new RateLimiter({
      maxRequests: config.rateLimit.maxRequests ?? 20,
      windowMs: config.rateLimit.windowMs ?? 60000,
      evenDistribution: config.rateLimit.evenDistribution ?? true,
      queueWhenLimited: config.rateLimit.queueWhenLimited ?? true,
      queueTimeoutMs: config.rateLimit.queueTimeoutMs ?? 300000,
    });`;

if (content.includes(oldInit)) {
  content = content.replace(oldInit, newInit);
  console.log('Init patch applied: RateLimiter now receives queueWhenLimited and queueTimeoutMs');
} else {
  console.log('Init patch ERROR: pattern not found');
  const idx = content.indexOf('new RateLimiter');
  console.log('Context: ' + content.substring(Math.max(0, idx - 100), idx + 300));
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('=== Server init file saved ===');
