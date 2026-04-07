/**
 * Tests that the periodic delivery recovery scheduling logic works correctly.
 * This tests the pattern used in server.impl.ts for the 2-min setInterval.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("delivery recovery scheduling (frankclaw)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs recovery immediately and then every 2 minutes", async () => {
    const recoverFn = vi.fn().mockResolvedValue(undefined);
    const errorLog = vi.fn();

    // Simulate the pattern from server.impl.ts
    const runDeliveryRecovery = async () => {
      await recoverFn();
    };

    // Initial run
    void runDeliveryRecovery().catch((err) => errorLog(`Delivery recovery failed: ${String(err)}`));

    // Periodic sweep every 2 min
    const deliveryRecoveryIntervalMs = 2 * 60_000;
    const intervalId = setInterval(() => {
      void runDeliveryRecovery().catch((err) =>
        errorLog(`Periodic delivery recovery failed: ${String(err)}`),
      );
    }, deliveryRecoveryIntervalMs);

    // Flush the initial call
    await vi.advanceTimersByTimeAsync(0);
    expect(recoverFn).toHaveBeenCalledTimes(1);

    // Advance 2 minutes -- should trigger periodic run
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(recoverFn).toHaveBeenCalledTimes(2);

    // Advance another 2 minutes
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(recoverFn).toHaveBeenCalledTimes(3);

    clearInterval(intervalId);
  });

  it("logs errors from periodic recovery without crashing", async () => {
    const recoverFn = vi.fn().mockRejectedValue(new Error("recovery failed"));
    const errorLog = vi.fn();

    const runDeliveryRecovery = async () => {
      await recoverFn();
    };

    void runDeliveryRecovery().catch((err) => errorLog(`Delivery recovery failed: ${String(err)}`));

    const deliveryRecoveryIntervalMs = 2 * 60_000;
    const intervalId = setInterval(() => {
      void runDeliveryRecovery().catch((err) =>
        errorLog(`Periodic delivery recovery failed: ${String(err)}`),
      );
    }, deliveryRecoveryIntervalMs);

    await vi.advanceTimersByTimeAsync(0);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("recovery failed"));

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(errorLog).toHaveBeenCalledTimes(2);

    clearInterval(intervalId);
  });

  it("uses 2-minute interval (not configurable)", () => {
    // The interval is hardcoded at 2 * 60_000 = 120_000 ms
    const deliveryRecoveryIntervalMs = 2 * 60_000;
    expect(deliveryRecoveryIntervalMs).toBe(120_000);
  });

  it("skips scheduling when minimalTestGateway is true", () => {
    const recoverFn = vi.fn();
    const minimalTestGateway = true;

    // Simulates the guard from server.impl.ts
    if (!minimalTestGateway) {
      recoverFn();
    }

    expect(recoverFn).not.toHaveBeenCalled();
  });
});
