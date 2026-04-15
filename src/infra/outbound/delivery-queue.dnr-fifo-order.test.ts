import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  _isRecoveryInProgress,
  enqueueDelivery,
  recoverPendingDeliveries,
} from "./delivery-queue.js";
import {
  asDeliverFn,
  createRecoveryLog,
  installDeliveryQueueTmpDirHooks,
} from "./delivery-queue.test-helpers.js";

describe("DNR replay FIFO ordering", () => {
  const { tmpDir } = installDeliveryQueueTmpDirHooks();
  const baseCfg = {};

  /**
   * Helper: enqueue N entries with distinct enqueuedAt timestamps and optional
   * deferUntilMs (simulating DNR-held messages).  Returns the IDs in enqueue order.
   */
  async function enqueueDnrEntries(
    count: number,
    opts: { target?: string; deferUntilMs?: number; channel?: string } = {},
  ): Promise<string[]> {
    const ids: string[] = [];
    const baseTime = Date.now() - 120_000; // well past MIN_ENTRY_AGE_MS
    const target = opts.target ?? "discord-channel-1";
    const channel = opts.channel ?? "discord";
    for (let i = 0; i < count; i++) {
      const id = await enqueueDelivery(
        { channel: channel as "discord", to: target, payloads: [{ text: `msg-${i}` }] },
        tmpDir(),
      );
      // Set ascending enqueuedAt so ordering is deterministic
      const entryPath = path.join(tmpDir(), "delivery-queue", `${id}.json`);
      const entry = JSON.parse(fs.readFileSync(entryPath, "utf-8"));
      entry.enqueuedAt = baseTime + i * 1000;
      if (opts.deferUntilMs !== undefined) {
        entry.deferUntilMs = opts.deferUntilMs;
        entry.holdReason = "discord-dnr-window";
      }
      fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
      ids.push(id);
    }
    return ids;
  }

  it("replays multiple DNR-held messages to the same channel in FIFO order", async () => {
    const deferUntilMs = Date.now() - 1000; // already eligible
    await enqueueDnrEntries(5, { deferUntilMs });

    const deliveredTexts: string[] = [];
    const deliver = vi.fn(async (params: { payloads: Array<{ text: string }> }) => {
      deliveredTexts.push(params.payloads[0]?.text ?? "");
    });

    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliver).toHaveBeenCalledTimes(5);
    expect(deliveredTexts).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
  });

  it("messages queued across different channels can replay independently but each channel preserves local FIFO", async () => {
    const deferUntilMs = Date.now() - 1000;
    // Enqueue to two different channels, interleaved in time
    const baseTime = Date.now() - 120_000;
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const target = i % 2 === 0 ? "channel-A" : "channel-B";
      const id = await enqueueDelivery(
        { channel: "discord", to: target, payloads: [{ text: `${target}-${Math.floor(i / 2)}` }] },
        tmpDir(),
      );
      const entryPath = path.join(tmpDir(), "delivery-queue", `${id}.json`);
      const entry = JSON.parse(fs.readFileSync(entryPath, "utf-8"));
      entry.enqueuedAt = baseTime + i * 1000;
      entry.deferUntilMs = deferUntilMs;
      entry.holdReason = "discord-dnr-window";
      fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
      ids.push(id);
    }

    const deliveredTexts: string[] = [];
    const deliver = vi.fn(async (params: { payloads: Array<{ text: string }> }) => {
      deliveredTexts.push(params.payloads[0]?.text ?? "");
    });

    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliver).toHaveBeenCalledTimes(6);
    // Global order is by enqueuedAt (interleaved across channels)
    expect(deliveredTexts).toEqual([
      "channel-A-0",
      "channel-B-0",
      "channel-A-1",
      "channel-B-1",
      "channel-A-2",
      "channel-B-2",
    ]);
    // Per-channel FIFO preserved
    const channelA = deliveredTexts.filter((t) => t.startsWith("channel-A"));
    const channelB = deliveredTexts.filter((t) => t.startsWith("channel-B"));
    expect(channelA).toEqual(["channel-A-0", "channel-A-1", "channel-A-2"]);
    expect(channelB).toEqual(["channel-B-0", "channel-B-1", "channel-B-2"]);
  });

  it("after restart, ordering is preserved based on original enqueuedAt", async () => {
    const deferUntilMs = Date.now() - 1000;
    await enqueueDnrEntries(3, { deferUntilMs });

    // Simulate a restart: just call recoverPendingDeliveries again (entries were persisted to disk)
    const deliveredTexts: string[] = [];
    const deliver = vi.fn(async (params: { payloads: Array<{ text: string }> }) => {
      deliveredTexts.push(params.payloads[0]?.text ?? "");
    });

    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliveredTexts).toEqual(["msg-0", "msg-1", "msg-2"]);
  });

  it("concurrent recovery sweeps are serialized by re-entrancy guard", async () => {
    const deferUntilMs = Date.now() - 1000;
    await enqueueDnrEntries(3, { deferUntilMs });

    let resolveFirst: () => void;
    const firstDeliverBlocks = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const deliver = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Block the first delivery to simulate a slow sweep
        await firstDeliverBlocks;
      }
    });
    const log1 = createRecoveryLog();
    const log2 = createRecoveryLog();

    // Start first sweep (will block on first delivery)
    const sweep1 = recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: log1,
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Wait for first delivery call to be in-flight
    await vi.waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1);
    });

    // Start second sweep while first is blocked
    const sweep2Result = await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: log2,
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Second sweep should have been skipped
    expect(sweep2Result).toEqual({
      recovered: 0,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 0,
    });
    expect(log2.info).toHaveBeenCalledWith(expect.stringContaining("already in progress"));

    // Unblock first sweep
    resolveFirst!();
    const sweep1Result = await sweep1;
    expect(sweep1Result.recovered).toBe(3);
  });

  it("recovery guard is released after completion so next sweep runs", async () => {
    await enqueueDnrEntries(1, { deferUntilMs: Date.now() - 1000 });

    const deliver = vi.fn(async () => {});

    // First sweep completes
    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });
    expect(deliver).toHaveBeenCalledTimes(1);

    // Enqueue more entries
    await enqueueDnrEntries(1, { deferUntilMs: Date.now() - 1000 });

    // Second sweep should NOT be blocked
    const log2 = createRecoveryLog();
    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: log2,
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Should have delivered the new entry
    expect(deliver).toHaveBeenCalledTimes(2);
    // Should NOT have logged "already in progress"
    expect(log2.info).not.toHaveBeenCalledWith(expect.stringContaining("already in progress"));
  });

  it("recovery guard is released even if sweep throws", async () => {
    await enqueueDnrEntries(1, { deferUntilMs: Date.now() - 1000 });

    const deliver = vi.fn(async () => {
      throw new Error("boom");
    });

    // First sweep fails
    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Guard should be released: next sweep should proceed
    expect(_isRecoveryInProgress()).toBe(false);
  });
});
