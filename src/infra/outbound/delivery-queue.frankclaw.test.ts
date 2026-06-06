/**
 * Frankclaw: Tests for deferDelivery function.
 * Validates that deferDelivery reads an existing queue entry, adds defer/hold
 * fields, and writes it back atomically without incrementing retry counters.
 */
import { describe, expect, it } from "vitest";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { enqueueDelivery } from "./delivery-queue.js";
import {
  installDeliveryQueueTmpDirHooks,
  readQueuedEntry,
  setQueuedEntryState,
} from "./delivery-queue.test-helpers.js";

function readQueuedEntryColumns(
  tmpDir: string,
  id: string,
): { recovery_state: string | null; platform_send_started_at: number | null } {
  const { db } = openOpenClawStateDatabase({ env: { ...process.env, OPENCLAW_STATE_DIR: tmpDir } });
  const row = db
    .prepare(
      "SELECT recovery_state, platform_send_started_at FROM delivery_queue_entries WHERE queue_name = 'outbound' AND id = ?",
    )
    .get(id) as
    | { recovery_state: string | null; platform_send_started_at: number | bigint | null }
    | undefined;
  if (!row) {
    throw new Error(`Missing queued entry ${id}`);
  }
  return {
    recovery_state: row.recovery_state,
    platform_send_started_at:
      row.platform_send_started_at == null ? null : Number(row.platform_send_started_at),
  };
}

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

  it("clears in-flight send markers so the recovery loop replays a DNR-deferred entry", async () => {
    // Regression: a one-shot Discord send during quiet hours marks the durable
    // queue row recoveryState=send_attempt_started (platform send begins) and
    // THEN the adapter throws DiscordDnrSuppressedError before any actual API
    // call. If deferDelivery leaves recoveryState set, the delivery-recovery loop
    // refuses a "blind replay without adapter reconciliation" once the window
    // closes and marks the never-sent message FAILED — losing it. deferDelivery
    // must clear those markers because no platform send ever happened.
    const id = await enqueueDelivery(
      { channel: "discord", to: "channel:789", payloads: [{ text: "deferred" }] },
      tmpDir(),
    );
    setQueuedEntryState(tmpDir(), id, {
      retryCount: 0,
      recoveryState: "send_attempt_started",
      platformSendStartedAt: Date.now(),
    });
    // Precondition: the in-flight markers are set before deferral.
    expect(readQueuedEntryColumns(tmpDir(), id).recovery_state).toBe("send_attempt_started");

    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");
    await deferDelivery(id, Date.now() + 60_000, "discord-dnr-window", tmpDir());

    const saved = readQueuedEntry(tmpDir(), id);
    expect(saved.recoveryState).toBeUndefined();
    expect(saved.platformSendStartedAt).toBeUndefined();
    expect(saved.deferUntilMs).toBeGreaterThan(0);
    // Both the column and the serialized JSON must be cleared, since the recovery
    // loop reads recoveryState from the column (falling back to entry_json).
    const cols = readQueuedEntryColumns(tmpDir(), id);
    expect(cols.recovery_state).toBeNull();
    expect(cols.platform_send_started_at).toBeNull();
  });

  it("throws ENOENT when queue entry does not exist", async () => {
    const { deferDelivery } = await import("./delivery-queue.frankclaw.js");

    await expect(
      deferDelivery("nonexistent", Date.now() + 60_000, "test", tmpDir()),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
