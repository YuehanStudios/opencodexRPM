import { describe, expect, test } from "bun:test";
import { fetchWithTransientRetry, isTransientUpstreamStatus } from "../src/lib/upstream-retry";

function bodyResponse(status: number, headers?: Record<string, string>): Response {
  // ReadableStream body so cancel() is observable.
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() { cancelled = true; },
  });
  const res = new Response(status === 204 ? null : stream, { status, headers });
  return Object.assign(res, { __wasCancelled: () => cancelled });
}

describe("isTransientUpstreamStatus", () => {
  test("classifies gateway/Cloudflare transients and 429; excludes 4xx and 507", () => {
    for (const s of [500, 502, 503, 504, 520, 521, 522]) expect(isTransientUpstreamStatus(s)).toBe(true);
    // 429 is gated through retryTransient429, not the 5xx layer; the shared
    // isTransientUpstreamStatus() now also reports it so the 5xx layer can
    // duck-guard `res.status === 429` and avoid consuming its budget on throttles.
    for (const s of [200, 400, 401, 499, 507, 529]) expect(isTransientUpstreamStatus(s)).toBe(false);
  });
});

describe("fetchWithTransientRetry", () => {
  test("retries 429 honouring upstream Retry-After then returns the 200", async () => {
    let calls = 0;
    const started = Date.now();
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      return calls === 1 ? bodyResponse(429, { "retry-after": "1" }) : bodyResponse(200);
    }, { slowAttemptMs: 60_000, status429SlotFallbackMs: 5_000 });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    // Retry-After: 1s dominates the 5xx base backoff; 5xx layer is bypassed.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 10_000);

  test("429 with no Retry-After uses the configured slot-time fallback", async () => {
    let calls = 0;
    const started = Date.now();
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      return calls === 1 ? bodyResponse(429) : bodyResponse(200);
    }, { slowAttemptMs: 60_000, status429SlotFallbackMs: 250, status429MaxAttempts: 3 });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    // No Retry-After: slotFallback=250ms is the floor; allow generous timing on slow CI.
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  }, 10_000);

  test("429 layer respects the total wall-time budget and returns last 429", async () => {
    let calls = 0;
    const started = Date.now();
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      return bodyResponse(429);
    }, {
      slowAttemptMs: 60_000,
      status429MaxAttempts: 10,
      status429SlotFallbackMs: 400,
      status429TotalBudgetMs: 900, // ~2 retries (then capped)
    });
    expect(res.status).toBe(429);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(Date.now() - started).toBeLessThan(2_000);
  }, 10_000);

  test("status429MaxAttempts=0 disables the 429 layer (pass-through)", async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => { calls++; return bodyResponse(429); }, {
      slowAttemptMs: 60_000,
      status429MaxAttempts: 0,
    });
    expect(calls).toBe(1);
    expect(res.status).toBe(429);
  });

  test("retries a 502 then returns the 200; failed body is cancelled", async () => {
    const first = bodyResponse(502) as Response & { __wasCancelled: () => boolean };
    const responses = [first, bodyResponse(200)];
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => responses[calls++]!, { slowAttemptMs: 60_000 });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
    expect(first.__wasCancelled()).toBe(true);
  });

  test("exhausts attempts on persistent 502 and returns the final 502 with body intact", async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => { calls++; return bodyResponse(502); }, { slowAttemptMs: 60_000 });
    expect(calls).toBe(3);
    expect(res.status).toBe(502);
    expect(res.body).not.toBeNull();
  });

  test("does not retry non-transient statuses", async () => {
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => { calls++; return bodyResponse(400); }, { slowAttemptMs: 60_000 });
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
  });

  test("honors Retry-After header for the backoff delay", async () => {
    let calls = 0;
    const started = Date.now();
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      return calls === 1 ? bodyResponse(503, { "retry-after": "1" }) : bodyResponse(200);
    }, { slowAttemptMs: 60_000 });
    expect(res.status).toBe(200);
    // Retry-After: 1s should dominate the 400ms base backoff.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  }, 10_000);

  test("returns the 5xx as-is when the caller aborted", async () => {
    const ac = new AbortController();
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      ac.abort();
      return bodyResponse(502);
    }, { abortSignal: ac.signal, slowAttemptMs: 60_000 });
    expect(calls).toBe(1);
    expect(res.status).toBe(502);
  });

  test("does not retry a slow failed 5xx attempt (slow-502 incident shape)", async () => {
    // The 429 layer tries first (one call), then the 5xx layer measures attempt
    // duration. A 502 that already ate more than the slow budget means an
    // upstream-side stall — duplicating it only burns the client's visibility.
    let calls = 0;
    const res = await fetchWithTransientRetry(async () => {
      calls++;
      await new Promise(r => setTimeout(r, 30));
      return bodyResponse(502);
    }, { slowAttemptMs: 10 });
    expect(calls).toBe(1);
    expect(res.status).toBe(502);
  });
});
