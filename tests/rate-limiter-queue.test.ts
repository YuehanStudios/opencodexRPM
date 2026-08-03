import { describe, expect, it } from "bun:test";
import { RateLimiter } from "../src/lib/rate-limiter";

describe("RateLimiter queue", () => {
  it("drains queued global requests FIFO, one per replenished token", async () => {
    const limiter = new RateLimiter({
      maxRequests: 1,
      windowMs: 25,
      evenDistribution: true,
      queueWhenLimited: true,
      queueTimeoutMs: 300,
    });
    const completionOrder: number[] = [];
    const startedAt = Date.now();

    const requests = [1, 2, 3].map(async id => {
      const result = await limiter.waitForGlobal();
      completionOrder.push(id);
      return result;
    });
    const results = await Promise.all(requests);

    expect(results.every(result => result.allowed)).toBe(true);
    expect(completionOrder).toEqual([1, 2, 3]);
    // The second and third requests must wait for separate replenishments.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
  });
});
