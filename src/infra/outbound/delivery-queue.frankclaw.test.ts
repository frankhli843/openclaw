/**
 * Frankclaw: Tests for deferDelivery function.
 * Validates that deferDelivery reads an existing queue entry, adds defer/hold
 * fields, and writes it back atomically without incrementing retry counters.
 */
import { describe, expect, it } from "vitest";
import { enqueueDelivery } from "./delivery-queue.js";
import { installDeliveryQueueTmpDirHooks, readQueuedEntry } from "./delivery-queue.test-helpers.js";

describe("deferDelivery", () => {
  const { tmpDir } = installDeliveryQueueTmpDirHooks();

  it("adds deferUntilMs and holdReason without incrementing retryCount", async () => {
    const id = await enqueueDelivery(
      { channel: "discord", to: "channel:123", payloads: [{ text: "hello" }] },
      tmpDir(),
    );

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");
    const deferUntilMs = Date.now() + 60_000;
    await deferDelivery(id, deferUntilMs, "discord-dnr-window", tmpDir());

    const saved = readQueuedEntry(tmpDir(), id);
    expect(saved.retryCount).toBe(0); // Not incremented
    expect(saved.deferUntilMs).toBeGreaterThanOrEqual(Date.now() - 1000);
    expect(saved.deferUntilMs).toBeLessThanOrEqual(deferUntilMs);
    expect(saved.holdReason).toBe("discord-dnr-window");
    expect(saved.lastError).toBe("discord-dnr-window");
    expect(saved.lastAttemptAt).toBeGreaterThan(0);
    // Original fields preserved
    expect(saved.channel).toBe("discord");
    expect(saved.to).toBe("channel:123");
    expect(saved.payloads).toEqual([{ text: "hello" }]);
  });

  it("uses deferUntilMs as floor (not past time)", async () => {
    const id = await enqueueDelivery(
      { channel: "discord", to: "channel:456", payloads: [] },
      tmpDir(),
    );

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");
    const pastMs = Date.now() - 10_000;
    await deferDelivery(id, pastMs, "test-reason", tmpDir());

    const saved = readQueuedEntry(tmpDir(), id);
    // deferUntilMs should be at least Date.now() (floored)
    expect(saved.deferUntilMs).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("throws ENOENT when queue entry does not exist", async () => {
    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");

    await expect(
      deferDelivery("nonexistent", Date.now() + 60_000, "test", tmpDir()),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
