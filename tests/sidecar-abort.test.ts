import { afterEach, describe, expect, test } from "bun:test";
import { runWebSearch } from "../src/web-search/executor";
import { describeImage } from "../src/vision/describe";
import type { OcxProviderConfig } from "../src/types";

const originalFetch = globalThis.fetch;

const forwardProvider: OcxProviderConfig = {
  adapter: "openai-responses",
  baseUrl: "https://chatgpt.test",
  authMode: "forward",
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installAbortAwareFetch(): () => AbortSignal {
  let seenSignal: AbortSignal | undefined;
  globalThis.fetch = ((_, init) => {
    seenSignal = init?.signal as AbortSignal | undefined;
    return new Promise<Response>((_, reject) => {
      seenSignal?.addEventListener("abort", () => reject(new Error("aborted by turn")), { once: true });
    });
  }) as typeof fetch;
  return () => {
    if (!seenSignal) throw new Error("fetch was not called");
    return seenSignal;
  };
}

describe("sidecar abort propagation", () => {
  test("web-search sidecar fetch observes the WebSocket turn abort signal", async () => {
    const getSignal = installAbortAwareFetch();
    const turn = new AbortController();
    const outcome = runWebSearch(
      "current docs",
      { type: "web_search" },
      forwardProvider,
      new Headers({ authorization: "Bearer token" }),
      { model: "gpt-5.4-mini", reasoning: "low", timeoutMs: 30_000 },
      turn.signal,
    );

    const signal = getSignal();
    expect(signal.aborted).toBe(false);
    turn.abort("replacement turn");
    expect(signal.aborted).toBe(true);
    expect((await outcome).error).toBe("aborted by turn");
  });

  test("vision sidecar fetch observes the WebSocket turn abort signal", async () => {
    const getSignal = installAbortAwareFetch();
    const turn = new AbortController();
    const outcome = describeImage(
      "data:image/png;base64,iVBORw0KGgo=",
      "high",
      "inspect screenshot",
      forwardProvider,
      new Headers({ authorization: "Bearer token" }),
      { model: "gpt-5.4-mini", timeoutMs: 30_000 },
      turn.signal,
    );

    const signal = getSignal();
    expect(signal.aborted).toBe(false);
    turn.abort("replacement turn");
    expect(signal.aborted).toBe(true);
    expect((await outcome).error).toBe("aborted by turn");
  });
});
