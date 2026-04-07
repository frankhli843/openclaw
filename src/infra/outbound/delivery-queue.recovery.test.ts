import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  enqueueDelivery,
  loadPendingDeliveries,
  MAX_RETRIES,
  recoverPendingDeliveries,
} from "./delivery-queue.js";
import {
  asDeliverFn,
  createRecoveryLog,
  installDeliveryQueueTmpDirHooks,
  setQueuedEntryState,
} from "./delivery-queue.test-helpers.js";

describe("delivery-queue recovery", () => {
  const { tmpDir } = installDeliveryQueueTmpDirHooks();
  const baseCfg = {};

  const enqueueCrashRecoveryEntries = async () => {
    await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "a" }] },
      tmpDir(),
    );
    await enqueueDelivery(
      { channel: "demo-channel-b", to: "2", payloads: [{ text: "b" }] },
      tmpDir(),
    );
  };

  const runRecovery = async ({
    deliver,
    log = createRecoveryLog(),
    maxRecoveryMs,
  }: {
    deliver: ReturnType<typeof vi.fn>;
    log?: ReturnType<typeof createRecoveryLog>;
    maxRecoveryMs?: number;
  }) => {
    const result = await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log,
      cfg: baseCfg,
      stateDir: tmpDir(),
      ...(maxRecoveryMs === undefined ? {} : { maxRecoveryMs }),
    });
    return { result, log };
  };

  /** Backdate all pending entries so they pass the MIN_ENTRY_AGE_MS check. */
  const backdateAllEntries = async (ageMs = 60_000) => {
    const entries = await loadPendingDeliveries(tmpDir());
    const oldTimestamp = Date.now() - ageMs;
    for (const entry of entries) {
      setQueuedEntryState(tmpDir(), entry.id, {
        retryCount: entry.retryCount,
        enqueuedAt: oldTimestamp,
        ...(entry.lastAttemptAt !== undefined ? { lastAttemptAt: entry.lastAttemptAt } : {}),
      });
    }
  };

  it("recovers entries from a simulated crash", async () => {
    const idA = await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "a" }] },
      tmpDir(),
    );
    const idB = await enqueueDelivery(
      { channel: "demo-channel-b", to: "2", payloads: [{ text: "b" }] },
      tmpDir(),
    );
    // Backdate entries to simulate they were enqueued before a crash (>30s ago)
    const oldTimestamp = Date.now() - 60_000;
    setQueuedEntryState(tmpDir(), idA, { retryCount: 0, enqueuedAt: oldTimestamp });
    setQueuedEntryState(tmpDir(), idB, { retryCount: 0, enqueuedAt: oldTimestamp });
    const deliver = vi.fn().mockResolvedValue([]);
    const { result } = await runRecovery({ deliver });

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      recovered: 2,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 0,
    });

    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(0);
  });

  it("[frankclaw] defers recently-enqueued entries to prevent race with in-flight delivery", async () => {
    // Simulate the race: entry is enqueued by normal delivery path (just now)
    // and recovery sweep picks it up before the normal path finishes sending.
    await enqueueDelivery(
      { channel: "whatsapp", to: "120363405743307729@g.us", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    // Entry has retryCount=0, no lastAttemptAt, enqueuedAt=~now (< 30s ago)
    const deliver = vi.fn().mockResolvedValue([]);
    const { result } = await runRecovery({ deliver });

    // Should NOT deliver — entry is too fresh, likely still in-flight
    expect(deliver).not.toHaveBeenCalled();
    expect(result.deferredBackoff).toBe(1);
    expect(result.recovered).toBe(0);

    // Entry should still be in the queue (not acked or failed)
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(1);
  });

  it("moves entries that exceeded max retries to failed/", async () => {
    const id = await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "a" }] },
      tmpDir(),
    );
    setQueuedEntryState(tmpDir(), id, { retryCount: MAX_RETRIES });

    const deliver = vi.fn();
    const { result } = await runRecovery({ deliver });

    expect(deliver).not.toHaveBeenCalled();
    expect(result.skippedMaxRetries).toBe(1);
    expect(result.deferredBackoff).toBe(0);
    expect(fs.existsSync(path.join(tmpDir(), "delivery-queue", "failed", `${id}.json`))).toBe(true);
  });

  it("increments retryCount on failed recovery attempt", async () => {
    await enqueueDelivery(
      { channel: "demo-channel-c", to: "#ch", payloads: [{ text: "x" }] },
      tmpDir(),
    );
    await backdateAllEntries();

    const deliver = vi.fn().mockRejectedValue(new Error("network down"));
    const { result } = await runRecovery({ deliver });

    expect(result.failed).toBe(1);
    expect(result.recovered).toBe(0);

    const entries = await loadPendingDeliveries(tmpDir());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.retryCount).toBe(1);
    expect(entries[0]?.lastError).toBe("network down");
  });

  it("moves entries to failed/ immediately on permanent delivery errors", async () => {
    const id = await enqueueDelivery(
      { channel: "demo-channel", to: "user:abc", payloads: [{ text: "hi" }] },
      tmpDir(),
    );
    await backdateAllEntries();
    const deliver = vi
      .fn()
      .mockRejectedValue(new Error("No conversation reference found for user:abc"));
    const log = createRecoveryLog();
    const { result } = await runRecovery({ deliver, log });

    expect(result.failed).toBe(1);
    expect(result.recovered).toBe(0);
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir(), "delivery-queue", "failed", `${id}.json`))).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("permanent error"));
  });

  it("treats Matrix 'User not in room' as a permanent error", async () => {
    const id = await enqueueDelivery(
      { channel: "matrix", to: "!lowercased:matrix.example.com", payloads: [{ text: "hi" }] },
      tmpDir(),
    );
    await backdateAllEntries();
    const deliver = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "MatrixError: [403] User @bot:matrix.example.com not in room !lowercased:matrix.example.com",
        ),
      );
    const log = createRecoveryLog();
    const { result } = await runRecovery({ deliver, log });

    expect(result.failed).toBe(1);
    expect(result.recovered).toBe(0);
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir(), "delivery-queue", "failed", `${id}.json`))).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("permanent error"));
  });

  it("passes skipQueue: true to prevent re-enqueueing during recovery", async () => {
    await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "a" }] },
      tmpDir(),
    );
    await backdateAllEntries();

    const deliver = vi.fn().mockResolvedValue([]);
    await runRecovery({ deliver });

    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ skipQueue: true }));
  });

  it("replays stored delivery options during recovery", async () => {
    await enqueueDelivery(
      {
        channel: "demo-channel-a",
        to: "+1",
        payloads: [{ text: "a" }],
        bestEffort: true,
        gifPlayback: true,
        silent: true,
        gatewayClientScopes: ["operator.write"],
        mirror: {
          sessionKey: "agent:main:main",
          text: "a",
          mediaUrls: ["https://example.com/a.png"],
        },
      },
      tmpDir(),
    );
    await backdateAllEntries();

    const deliver = vi.fn().mockResolvedValue([]);
    await runRecovery({ deliver });

    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        bestEffort: true,
        gifPlayback: true,
        silent: true,
        gatewayClientScopes: ["operator.write"],
        mirror: {
          sessionKey: "agent:main:main",
          text: "a",
          mediaUrls: ["https://example.com/a.png"],
        },
      }),
    );
  });

  it("respects maxRecoveryMs time budget and bumps deferred retries", async () => {
    await enqueueCrashRecoveryEntries();
    await enqueueDelivery(
      { channel: "demo-channel-c", to: "#c", payloads: [{ text: "c" }] },
      tmpDir(),
    );

    const deliver = vi.fn().mockResolvedValue([]);
    const { result, log } = await runRecovery({
      deliver,
      maxRecoveryMs: 0,
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(result).toEqual({
      recovered: 0,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 0,
    });

    const remaining = await loadPendingDeliveries(tmpDir());
    expect(remaining).toHaveLength(3);
    // [frankclaw] Budget-exceeded deferrals no longer increment retryCount —
    // entries are left untouched for the next sweep to avoid killing entries
    // that were never actually attempted.
    expect(remaining.every((entry) => entry.retryCount === 0)).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("deferred to next startup"));
  });

  it("defers entries until backoff becomes eligible", async () => {
    const id = await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "a" }] },
      tmpDir(),
    );
    setQueuedEntryState(tmpDir(), id, { retryCount: 3, lastAttemptAt: Date.now() });

    const deliver = vi.fn().mockResolvedValue([]);
    const { result, log } = await runRecovery({
      deliver,
      maxRecoveryMs: 60_000,
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(result).toEqual({
      recovered: 0,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 1,
    });
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(1);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("not ready for retry yet"));
  });

  it("continues past high-backoff entries and recovers ready entries behind them", async () => {
    const now = Date.now();
    const blockedId = await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "blocked" }] },
      tmpDir(),
    );
    const readyId = await enqueueDelivery(
      { channel: "demo-channel-b", to: "2", payloads: [{ text: "ready" }] },
      tmpDir(),
    );

    setQueuedEntryState(tmpDir(), blockedId, {
      retryCount: 3,
      lastAttemptAt: now,
      enqueuedAt: now - 30_000,
    });
    setQueuedEntryState(tmpDir(), readyId, { retryCount: 0, enqueuedAt: now - 60_000 });

    const deliver = vi.fn().mockResolvedValue([]);
    const { result } = await runRecovery({ deliver, maxRecoveryMs: 60_000 });

    expect(result).toEqual({
      recovered: 1,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 1,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "demo-channel-b", to: "2", skipQueue: true }),
    );

    const remaining = await loadPendingDeliveries(tmpDir());
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(blockedId);
  });

  it("recovers deferred entries on a later restart once backoff elapsed", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(start);

    const id = await enqueueDelivery(
      { channel: "demo-channel-a", to: "+1", payloads: [{ text: "later" }] },
      tmpDir(),
    );
    setQueuedEntryState(tmpDir(), id, { retryCount: 3, lastAttemptAt: start.getTime() });

    const firstDeliver = vi.fn().mockResolvedValue([]);
    const firstRun = await runRecovery({ deliver: firstDeliver, maxRecoveryMs: 60_000 });
    expect(firstRun.result).toEqual({
      recovered: 0,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 1,
    });
    expect(firstDeliver).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(start.getTime() + 600_000 + 1));
    const secondDeliver = vi.fn().mockResolvedValue([]);
    const secondRun = await runRecovery({ deliver: secondDeliver, maxRecoveryMs: 60_000 });
    expect(secondRun.result).toEqual({
      recovered: 1,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 0,
    });
    expect(secondDeliver).toHaveBeenCalledTimes(1);
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(0);

    vi.useRealTimers();
  });

  it("returns zeros when queue is empty", async () => {
    const deliver = vi.fn();
    const { result } = await runRecovery({ deliver });

    expect(result).toEqual({
      recovered: 0,
      failed: 0,
      skippedMaxRetries: 0,
      deferredBackoff: 0,
    });
    expect(deliver).not.toHaveBeenCalled();
  });
});
