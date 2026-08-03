const fs = require('fs');
const filePath = 'src/server/index.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the rate limiting check block that returns 429
const oldBlock = [
  '        // Rate limiting check for /v1/responses endpoint',
  '        if (config.rateLimit?.enabled) {',
  '          const limiter = getGlobalRateLimiter();',
  '          const result = limiter.checkGlobal();',
  '          ',
  '          if (!result.allowed) {',
  '            const rateLimitResponse = new Response(',
  '              JSON.stringify({',
  '                error: {',
  '                  type: "rate_limit_error",',
  '                  message: `Too many requests. Maximum ${limiter.getConfig().maxRequests} requests per ${limiter.getConfig().windowMs / 1000} seconds allowed.`,',
  '                },',
  '              }),',
  '              {',
  '                status: 429,',
  '                headers: {',
  '                  "Content-Type": "application/json",',
  '                  "X-RateLimit-Limit": String(limiter.getConfig().maxRequests),',
  '                  "X-RateLimit-Remaining": String(result.remaining),',
  '                  "Retry-After": String(result.retryAfter ?? Math.ceil(limiter.getConfig().windowMs / 1000)),',
  '                  ...corsHeaders(req, config),',
  '                },',
  '              }',
  '            );',
  '            return withCors(rateLimitResponse, req, config);',
  '          }',
  '        }'
].join('\n');

const newBlock = [
  '        // Rate limiting: enqueue requests when capacity is exhausted instead of',
  '        // returning a 429 error. Requests are processed FIFO as soon as a token',
  '        // becomes available. queueWhenLimited (default true) in RateLimiter config',
  '        // controls whether to enqueue or reject; queueTimeoutMs caps the wait.',
  '        if (config.rateLimit?.enabled) {',
  '          const limiter = getGlobalRateLimiter();',
  '          const result = await limiter.waitForGlobal();',
  '',
  '          if (!result.allowed) {',
  '            const retryAfter =',
  '              result.retryAfter ?? Math.ceil(limiter.getConfig().windowMs / 1000);',
  '            const rateLimitResponse = new Response(',
  '              JSON.stringify({',
  '                error: {',
  '                  type: "rate_limit_error",',
  '                  message: `Rate limit queue timeout. Maximum ${limiter.getConfig().maxRequests} requests per ${limiter.getConfig().windowMs / 1000} seconds allowed. Try again in ${retryAfter}s.`,',
  '                },',
  '              }),',
  '              {',
  '                status: 429,',
  '                headers: {',
  '                  "Content-Type": "application/json",',
  '                  "X-RateLimit-Limit": String(limiter.getConfig().maxRequests),',
  '                  "X-RateLimit-Remaining": String(result.remaining),',
  '                  "Retry-After": String(retryAfter),',
  '                  ...corsHeaders(req, config),',
  '                },',
  '              }',
  '            );',
  '            return withCors(rateLimitResponse, req, config);',
  '          }',
  '        }'
].join('\n');

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  console.log('Server patch applied: rate limiting now uses waitForGlobal()');
} else {
  console.log('Server patch ERROR: pattern not found');
  // Show context around checkGlobal
  if (content.includes('checkGlobal')) {
    const idx = content.indexOf('checkGlobal');
    console.log('Context around checkGlobal:');
    console.log(content.substring(Math.max(0, idx - 500), idx + 500));
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('=== Server file saved ===');
