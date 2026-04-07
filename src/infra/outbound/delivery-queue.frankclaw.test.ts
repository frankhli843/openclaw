/**
 * Frankclaw: Tests for deferDelivery function.
 * Validates that deferDelivery reads an existing queue entry, adds defer/hold
 * fields, and writes it back atomically without incrementing retry counters.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/paths.js", () => ({
  resolveStateDir: () => "/tmp/frankclaw-defer-test-state",
}));

describe("deferDelivery", () => {
  let tmpDir: string;
  let queueDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  async function setupQueueEntry(id: string, entry: Record<string, unknown>): Promise<string> {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "defer-test-"));
    queueDir = path.join(tmpDir, "delivery-queue");
    fs.mkdirSync(queueDir, { recursive: true });
    const filePath = path.join(queueDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    return filePath;
  }

  it("adds deferUntilMs and holdReason without incrementing retryCount", async () => {
    const id = "test-entry-1";
    const originalEntry = {
      id,
      channel: "discord",
      to: "channel:123",
      payloads: [{ text: "hello" }],
      enqueuedAt: Date.now() - 5000,
      retryCount: 0,
    };
    const filePath = await setupQueueEntry(id, originalEntry);

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");

    const deferUntilMs = Date.now() + 60_000;
    await deferDelivery(id, deferUntilMs, "discord-dnr-window", tmpDir);

    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
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
    const id = "test-entry-2";
    await setupQueueEntry(id, {
      id,
      channel: "discord",
      to: "channel:456",
      payloads: [],
      enqueuedAt: Date.now(),
      retryCount: 1,
    });

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");

    // Pass a deferUntilMs in the past
    const pastMs = Date.now() - 10_000;
    await deferDelivery(id, pastMs, "test-reason", tmpDir);

    const filePath = path.join(queueDir, `${id}.json`);
    const saved = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    // deferUntilMs should be at least Date.now() (floored)
    expect(saved.deferUntilMs).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it("throws ENOENT when queue entry does not exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "defer-test-"));
    const qDir = path.join(tmpDir, "delivery-queue");
    fs.mkdirSync(qDir, { recursive: true });

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");

    await expect(deferDelivery("nonexistent", Date.now() + 60_000, "test", tmpDir)).rejects.toThrow(
      /ENOENT/,
    );
  });
});
