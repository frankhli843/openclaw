import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing__,
  getCloseSuppressedCount,
  guardCloseAcpSession,
} from "./task-maintenance-close-guard.frankclaw.js";

type CloseParams = { cfg: unknown; sessionKey: string; reason: string };

function makeUnsupportedControlError(): Error & { code: string } {
  const err = new Error("ACP backend does not support control: close") as Error & {
    code: string;
  };
  err.code = "ACP_BACKEND_UNSUPPORTED_CONTROL";
  return err;
}

describe("task-maintenance-close-guard rate limiter (frankclaw)", () => {
  beforeEach(() => {
    __testing__.reset();
  });

  afterEach(() => {
    __testing__.reset();
  });

  it("caps concurrent in-flight close attempts at the configured limit", async () => {
    __testing__.setMaxConcurrent(3);

    const releasers: Array<() => void> = [];
    const original = vi.fn<(params: CloseParams) => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          releasers.push(resolve);
        }),
    );
    // Make yields no-ops so they don't reorder scheduling in the test.
    __testing__.setYieldImpl(() => Promise.resolve());

    const guarded = guardCloseAcpSession(original);

    const calls = Array.from({ length: 10 }, (_, i) =>
      guarded({ cfg: {}, sessionKey: `s-${i}`, reason: "test" }),
    );

    // Let pending microtasks settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(__testing__.getInFlight()).toBe(3);
    expect(__testing__.getQueueLength()).toBe(7);
    expect(original).toHaveBeenCalledTimes(3);

    // Drain the limiter.
    while (releasers.length > 0) {
      const next = releasers.shift();
      next?.();
      await new Promise((resolve) => setImmediate(resolve));
    }

    await Promise.all(calls);

    expect(original).toHaveBeenCalledTimes(10);
    expect(__testing__.getPeakInFlight()).toBe(3);
    expect(__testing__.getInFlight()).toBe(0);
    expect(__testing__.getQueueLength()).toBe(0);
  });

  it("yields to the event loop after each real close attempt", async () => {
    __testing__.setMaxConcurrent(2);

    const yieldSpy = vi.fn<() => Promise<void>>(() => Promise.resolve());
    __testing__.setYieldImpl(yieldSpy);

    const original = vi.fn<(params: CloseParams) => Promise<void>>(async () => {
      // Resolve synchronously so the only delay between attempts is the yield.
    });

    const guarded = guardCloseAcpSession(original);

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        guarded({ cfg: {}, sessionKey: `s-${i}`, reason: "test" }),
      ),
    );

    expect(original).toHaveBeenCalledTimes(6);
    expect(yieldSpy).toHaveBeenCalledTimes(6);
  });

  it("skips cached failures without yielding or acquiring a slot", async () => {
    __testing__.setMaxConcurrent(1);

    const yieldSpy = vi.fn<() => Promise<void>>(() => Promise.resolve());
    __testing__.setYieldImpl(yieldSpy);

    const original = vi
      .fn<(params: CloseParams) => Promise<void>>()
      .mockRejectedValueOnce(makeUnsupportedControlError());

    const guarded = guardCloseAcpSession(original);

    // First call: real attempt, cache the failure, yield once.
    await guarded({ cfg: {}, sessionKey: "stale-1", reason: "test" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(yieldSpy).toHaveBeenCalledTimes(1);
    expect(getCloseSuppressedCount()).toBe(1);

    // Subsequent calls hit the cache fast-path.
    await guarded({ cfg: {}, sessionKey: "stale-1", reason: "test" });
    await guarded({ cfg: {}, sessionKey: "stale-1", reason: "test" });
    expect(original).toHaveBeenCalledTimes(1);
    expect(yieldSpy).toHaveBeenCalledTimes(1);
    expect(__testing__.getInFlight()).toBe(0);
  });

  it("processes 300 sessions in batches without exceeding the concurrency cap", async () => {
    __testing__.setMaxConcurrent(3);

    let observedPeak = 0;
    let active = 0;
    const original = vi.fn<(params: CloseParams) => Promise<void>>(async () => {
      active += 1;
      if (active > observedPeak) {
        observedPeak = active;
      }
      // Simulate the manager.closeSession path: an async hop, then a fast failure.
      await Promise.resolve();
      active -= 1;
      throw makeUnsupportedControlError();
    });
    __testing__.setYieldImpl(() => Promise.resolve());

    const guarded = guardCloseAcpSession(original);

    // Caller fires all 300 in parallel (worst case).
    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        guarded({ cfg: {}, sessionKey: `burst-${i}`, reason: "test" }),
      ),
    );

    expect(original).toHaveBeenCalledTimes(300);
    expect(observedPeak).toBeLessThanOrEqual(3);
    expect(getCloseSuppressedCount()).toBe(300);
    expect(__testing__.getQueueLength()).toBe(0);
    expect(__testing__.getInFlight()).toBe(0);
  });

  it("does not cache or yield for retryable errors, and rethrows", async () => {
    __testing__.setMaxConcurrent(2);

    const yieldSpy = vi.fn<() => Promise<void>>(() => Promise.resolve());
    __testing__.setYieldImpl(yieldSpy);

    const transient = new Error("temporary network blip");
    const original = vi
      .fn<(params: CloseParams) => Promise<void>>()
      .mockRejectedValueOnce(transient);

    const guarded = guardCloseAcpSession(original);

    await expect(guarded({ cfg: {}, sessionKey: "transient", reason: "test" })).rejects.toBe(
      transient,
    );

    expect(yieldSpy).not.toHaveBeenCalled();
    expect(getCloseSuppressedCount()).toBe(0);
    expect(__testing__.getInFlight()).toBe(0);
  });
});
