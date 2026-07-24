/**
 * Retry guard for upstream fetches that die on stale pooled keep-alive sockets.
 *
 * chatgpt.com (Cloudflare) closes idle keep-alive connections server-side; Bun's fetch pool
 * reuses the half-closed socket and the request write fails with ECONNRESET before any
 * response bytes arrive. Retrying on a fresh connection is safe for our replayable
 * (string-body) upstream requests, because fetch() rejects only before response headers —
 * a caught error here means no response was ever received.
 *
 * Deliberately narrow: timeouts, aborts, ECONNREFUSED/DNS/TLS failures, and HTTP error
 * statuses (returned as Response, never thrown) are NOT retried. Mid-stream SSE resets are
 * out of scope — the response has already resolved by then.
 *
 * MUST stay a leaf module: imports nothing from server.ts or adapters (kiro-retry imports
 * the shared abort helpers from here).
 */
import { clearableDeadline } from "./abort";

// 1 initial + 2 retries: the pool may hold more than one stale socket.
const RESET_RETRY_MAX_ATTEMPTS = 3;
const RESET_RETRY_BASE_DELAY_MS = 150;
const RESET_RETRY_MAX_DELAY_MS = 1_000;

// Transient-5xx status retry layer (pre-stream only; devlog/_plan/260716_claudecode_hardening/010).
const TRANSIENT_RETRY_MAX_ATTEMPTS = 3; // 1 initial + 2 retries
const TRANSIENT_RETRY_BASE_DELAY_MS = 400;
const TRANSIENT_RETRY_MAX_DELAY_MS = 5_000;
// A failed attempt slower than this is the "slow 502" incident shape (191s observed on
// 2026-07-15): retrying it only duplicates upstream load past client timeouts — return it.
const TRANSIENT_RETRY_SLOW_ATTEMPT_MS = 15_000;

// 429 throttle layer: honour upstream Retry-After; if absent, wait a slot-time
// derived from the configured RPM (12s @ 5/min) so the proxy serialises the
// client at the declared rate. Without this layer the first 429 bubbles to the
// client whose own retry budget aborts ("exceeded retry limit") before the RPM
// window has a chance to refill.
const TRANSIENT_429_MAX_ATTEMPTS = 6;
const TRANSIENT_429_BASE_DELAY_MS = 500;
const TRANSIENT_429_MAX_DELAY_MS = 5 * 60_000;
const TRANSIENT_429_SLOT_TIME_FALLBACK_MS = 12_000;

/**
 * Upstream statuses treated as transient: gateway errors and Cloudflare 52x.
 * 500 is included per the OpenAI SDK default (auto-retries >=500; Tier-2 proven in
 * devlog/260716_ocx_claude_sol_502_midstream/02). 507 was observed in the 48h ledger
 * but is deliberately excluded (storage-class, not gateway-transient).
 */
export function isTransientUpstreamStatus(status: number): boolean {
  return status === 429
    || status === 500 || status === 502 || status === 503 || status === 504
    || status === 520 || status === 521 || status === 522;
}

export interface RetryBackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  headers?: Headers;
}

export function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isConnectionResetError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Aborts and timeouts are caller decisions / honest failures — never retryable.
  if (err.name === "AbortError" || err.name === "TimeoutError") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ECONNRESET" || code === "EPIPE") return true;
  const msg = err.message.toLowerCase();
  return msg.includes("socket connection was closed unexpectedly")
    || msg.includes("connection reset by peer");
}

function retryAfterDelayMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

export function retryBackoffDelayMs(attempt: number, opts: RetryBackoffOptions): number {
  const retryAfter = opts.headers ? retryAfterDelayMs(opts.headers) : undefined;
  if (retryAfter !== undefined) return Math.min(retryAfter, opts.maxDelayMs);
  const exp = Math.min(opts.baseDelayMs * (2 ** attempt), opts.maxDelayMs);
  return Math.floor(exp * (0.8 + Math.random() * 0.4));
}

export function cancelResponseBodyBestEffort(res: Response): void {
  try {
    const cancellation = res.body?.cancel();
    if (cancellation) void cancellation.catch(() => {});
  } catch {
    // Cancellation is cleanup only; retries must not wait for or fail because of it.
  }
}

export async function fetchWithAttemptDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  abortSignal?: AbortSignal,
  preferIdentityEncoding = false,
): Promise<Response> {
  const attemptTimeout = clearableDeadline(timeoutMs, abortSignal);
  const headers = new Headers(init.headers);
  if (preferIdentityEncoding && !headers.has("accept-encoding")) {
    headers.set("accept-encoding", "identity");
  }
  try {
    return await fetch(url, {
      ...init,
      headers,
      signal: attemptTimeout.signal,
    });
  } finally {
    // Only the header timer is cleared. The composed signal still contains the parent, so a
    // caller abort after headers continue to cancel consumption of the returned response body.
    attemptTimeout.clear();
  }
}

export interface ResetRetryOptions {
  abortSignal?: AbortSignal;
  /** Short host/path label for the retry warn log (no secrets/query strings). */
  label?: string;
  attempts?: number;
}

export interface TransientRetryOptions extends ResetRetryOptions {
  /** Test seam: per-attempt slow budget override (defaults to TRANSIENT_RETRY_SLOW_ATTEMPT_MS). */
  slowAttemptMs?: number;
  /**
   * Override the 429 retry attempt cap. Default: TRANSIENT_429_MAX_ATTEMPTS. Set
   * to 0 to disable 429 retry entirely (use when the client already retries
   * throttles itself and proxy-level waiting would double-stack with it).
   */
  status429MaxAttempts?: number;
  /**
   * Slot-time fallback used when the upstream's 429 omits a Retry-After header.
   * Should be roughly windowMs/maxRequests — e.g. 12000 for a 5/min RPM
   * budget. Default: TRANSIENT_429_SLOT_TIME_FALLBACK_MS. Ignored when the
   * upstream provides Retry-After.
   */
  status429SlotFallbackMs?: number;
  /**
   * Total time budget (ms) for the 429 layer: across all attempts, the wall
   * time spent waiting must not exceed this. Prevents one stuck upstream from
   * pinning a long-lived client past its visibility deadline. Default:
   * TRANSIENT_429_MAX_DELAY_MS. Set to 0 for unbounded.
   */
  status429TotalBudgetMs?: number;
}

/**
 * Run `doFetch`, retrying only connection-reset-shaped rejections (see
 * isConnectionResetError) with jittered backoff. The caller's thunk must be replay-safe
 * (string body); every retry is logged so persistent resets stay visible.
 */
export async function fetchWithResetRetry(
  doFetch: () => Promise<Response>,
  opts: ResetRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? RESET_RETRY_MAX_ATTEMPTS);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.abortSignal?.aborted) throw abortError(opts.abortSignal);
    try {
      return await doFetch();
    } catch (err) {
      if (opts.abortSignal?.aborted || !isConnectionResetError(err) || attempt === attempts - 1) throw err;
      lastError = err;
      console.warn(
        `[upstream-retry] connection reset${opts.label ? ` (${opts.label})` : ""} — retrying (${attempt + 2}/${attempts})`,
      );
      await sleepWithAbort(retryBackoffDelayMs(attempt, {
        baseDelayMs: RESET_RETRY_BASE_DELAY_MS,
        maxDelayMs: RESET_RETRY_MAX_DELAY_MS,
      }), opts.abortSignal);
    }
  }
  throw lastError ?? new Error("upstream fetch failed");
}

/**
 * fetchWithResetRetry plus a transient status retry layer, PRE-STREAM only.
 *
 * Two independent layers stack over the reset layer:
 *
 *   - 5xx (500/502/503/504/520/521/522) is retried up to TRANSIENT_RETRY_MAX_ATTEMPTS
 *     times with exponential backoff (400ms → 5s) jittered, honouring Retry-After.
 *     Anything slower than `slowAttemptMs` is returned as-is (slow-502 shape).
 *   - 429 is retried up to `status429MaxAttempts` times, ALWAYS honouring the
 *     upstream's Retry-After header. With no header the wait is
 *     `status429SlotFallbackMs` so the proxy serialises the client at the
 *     declared RPM (e.g. 12s @ 5/min). A single total wall-time budget caps
 *     unattended servers against one stuck upstream.
 *
 * Layers are sequenced: a 5xx burst that exhausts its budget does not extend
 * the 429 budget, and vice-versa. Returning a Response has by definition not
 * handed any bytes to the client yet, so replaying the (string-body) request is
 * safe; every returned response keeps its body intact.
 */
export async function fetchWithTransientRetry(
  doFetch: () => Promise<Response>,
  opts: TransientRetryOptions = {},
): Promise<Response> {
  // Compute slowAttemptMs once so both layers measure the upstream's per-attempt
  // shape policy consistently. The seed `slowAttemptStartMs` is captured BEFORE
  // the 429 layer's first fetch thunk — a slow upstream that finally returns
  // either 429 or a 5xx must be reported as-is (the slow-502 incident shape),
  // not duplicated just because the layers are split across two helper calls.
  const slowAttemptMs = opts.slowAttemptMs ?? TRANSIENT_RETRY_SLOW_ATTEMPT_MS;
  const slowAttemptStartMs = Date.now();
  const after429 = await retryTransient429(doFetch, opts, slowAttemptMs, slowAttemptStartMs);
  return await retryTransient5xx(after429, doFetch, opts, slowAttemptMs, slowAttemptStartMs);
}

/** 429 throttle layer. Pre-stream: returns the passed-through Response as-is. */
async function retryTransient429(
  doFetch: () => Promise<Response>,
  opts: TransientRetryOptions,
  slowAttemptMs: number,
  slowAttemptStartMs: number,
): Promise<Response> {
  const maxAttempts = opts.status429MaxAttempts ?? TRANSIENT_429_MAX_ATTEMPTS;
  if (maxAttempts <= 0) return await doFetch();
  const slotFallbackMs = opts.status429SlotFallbackMs ?? TRANSIENT_429_SLOT_TIME_FALLBACK_MS;
  const totalBudgetMs = opts.status429TotalBudgetMs ?? TRANSIENT_429_MAX_DELAY_MS;
  // Use the host process total wall-clock budget so a stuck upstream cannot pin
  // a long-lived client past its own visibility deadline.
  const startedAt = slowAttemptStartMs;
  // Slow-attempt clock starts at the beginning of the FIRST fetch thunk so
  // that a slow upstream that finally returns 429 is reported (not retried),
  // matching the slow-502 contract of the 5xx layer below.
  let attemptStart = startedAt;
  let res = await fetchWithResetRetry(doFetch, opts);
  for (let attempt = 0; attempt < maxAttempts - 1 && res.status === 429; attempt++) {
    if (opts.abortSignal?.aborted) return res;
    if (Date.now() - attemptStart > slowAttemptMs) {
      console.warn(
        `[upstream-retry] slow 429 attempt (>${slowAttemptMs}ms)${opts.label ? ` (${opts.label})` : ""} — returning last response`,
      );
      return res;
    }
    if (totalBudgetMs > 0 && Date.now() - startedAt >= totalBudgetMs) {
      console.warn(
        `[upstream-retry] 429 budget exhausted (${totalBudgetMs}ms)${opts.label ? ` (${opts.label})` : ""} — returning last response`,
      );
      return res;
    }
    const retryAfterHint = retryAfterDelayMs(res.headers);
    const delay = retryAfterHint !== undefined
      ? retryAfterHint
      : slotFallbackMs + Math.floor(Math.random() * 500);
    const budgetLeftMs = totalBudgetMs > 0
      ? Math.max(0, totalBudgetMs - (Date.now() - startedAt))
      : Number.POSITIVE_INFINITY;
    const cappedDelay = Math.min(delay, budgetLeftMs);
    if (cappedDelay <= 0) return res;
    console.warn(
      `[upstream-retry] 429 throttled${opts.label ? ` (${opts.label})` : ""} — waiting ${Math.round(cappedDelay)}ms before attempt ${attempt + 2}/${maxAttempts}`,
    );
    cancelResponseBodyBestEffort(res);
    await sleepWithAbort(cappedDelay, opts.abortSignal);
    if (opts.abortSignal?.aborted) return res;
    attemptStart = Date.now();
    res = await fetchWithResetRetry(doFetch, opts);
  }
  return res;
}

/** 5xx retry layer. Pre-stream: returns the passed-through Response as-is. */
async function retryTransient5xx(
  initial: Response,
  doFetch: () => Promise<Response>,
  opts: TransientRetryOptions,
  slowAttemptMs: number,
  slowAttemptStartMs: number,
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? TRANSIENT_RETRY_MAX_ATTEMPTS);
  if (attempts === 1) return initial;
  // Seeded from the orchestrator so the slow-attempt window straddles BOTH
  // layers' fetch thunks (the 429 layer above may have spent 30s+ on a slow
  // upstream before a 429 finally arrived).
  let attemptStart = slowAttemptStartMs;
  let res = initial;
  for (let attempt = 0; attempt < attempts - 1; attempt++) {
    if (res.ok) return res;
    // The 429 layer handled 429s above; don't double-count them here.
    if (!isTransientUpstreamStatus(res.status) || res.status === 429) return res;
    if (opts.abortSignal?.aborted) return res;
    if (Date.now() - attemptStart > slowAttemptMs) return res;
    console.warn(
      `[upstream-retry] transient ${res.status}${opts.label ? ` (${opts.label})` : ""} — retrying (${attempt + 2}/${attempts})`,
    );
    const delay = retryBackoffDelayMs(attempt, {
      baseDelayMs: TRANSIENT_RETRY_BASE_DELAY_MS,
      maxDelayMs: TRANSIENT_RETRY_MAX_DELAY_MS,
      headers: res.headers,
    });
    cancelResponseBodyBestEffort(res);
    await sleepWithAbort(delay, opts.abortSignal);
    attemptStart = Date.now();
    res = await fetchWithResetRetry(doFetch, opts);
  }
  return res;
}
