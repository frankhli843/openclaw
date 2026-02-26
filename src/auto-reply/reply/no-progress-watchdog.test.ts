import { describe, expect, it, vi } from "vitest";
import { createNoProgressWatchdog } from "./no-progress-watchdog.js";

describe("no-progress watchdog", () => {
  it("emits soft then hard timeout", async () => {
    vi.useFakeTimers();
    const soft = vi.fn();
    const hard = vi.fn();
    const watchdog = createNoProgressWatchdog({
      softTimeoutMs: 100,
      graceTimeoutMs: 50,
      rateLimitGraceMs: 100,
      onSoftTimeout: soft,
      onHardTimeout: hard,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(soft).toHaveBeenCalledTimes(1);
    expect(watchdog.getStatus()).toBe("deferred");

    await vi.advanceTimersByTimeAsync(49);
    expect(hard).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(hard).toHaveBeenCalledTimes(1);
    expect(watchdog.getStatus()).toBe("exhausted");

    watchdog.stop();
    vi.useRealTimers();
  });

  it("extends hard timeout when rate-limit signals are seen", async () => {
    vi.useFakeTimers();
    const hard = vi.fn();
    const watchdog = createNoProgressWatchdog({
      softTimeoutMs: 100,
      graceTimeoutMs: 50,
      rateLimitGraceMs: 120,
      onHardTimeout: hard,
    });

    watchdog.noteRateLimitDelay("429 too many requests, retry after 30s");
    await vi.advanceTimersByTimeAsync(100 + 50 + 119);
    expect(hard).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(hard).toHaveBeenCalledTimes(1);

    watchdog.stop();
    vi.useRealTimers();
  });
});
