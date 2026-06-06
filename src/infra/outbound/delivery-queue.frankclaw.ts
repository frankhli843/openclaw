/**
 * Frankclaw: deferDelivery function for DNR quiet window support.
 * Defers a queue entry without incrementing retry counters.
 */
import { updateDeliveryQueueEntry } from "../delivery-queue-sqlite.js";
import type { QueuedDelivery } from "./delivery-queue-storage.js";

/** Frankclaw-extended queue entry with defer/hold fields */
interface FrankcawQueuedDelivery extends QueuedDelivery {
  deferUntilMs?: number;
  holdReason?: string;
}

/** Defer a queue entry without incrementing retry counters (suppression/hold behavior). */
export async function deferDelivery(
  id: string,
  deferUntilMs: number,
  reason: string,
  stateDir?: string,
): Promise<void> {
  updateDeliveryQueueEntry("outbound", id, stateDir, (entry) => {
    const e = entry as FrankcawQueuedDelivery;
    e.lastAttemptAt = Date.now();
    e.deferUntilMs = Math.max(Date.now(), Math.floor(deferUntilMs));
    e.holdReason = reason;
    e.lastError = reason;
    // frankclaw: a DNR / quiet-hours deferral happens BEFORE any platform send —
    // the outbound adapter throws DiscordDnrSuppressedError at the DNR check,
    // before calling the platform API — so this entry was never actually sent.
    // Clear the in-flight "send started" markers so the delivery-recovery loop
    // replays it cleanly once deferUntilMs elapses. Without this, recovery sees
    // recoveryState=send_attempt_started and refuses a "blind replay without
    // adapter reconciliation", marking the (never-sent) message FAILED and losing
    // it — defeating the whole point of deferring instead of dropping.
    e.recoveryState = undefined;
    e.platformSendStartedAt = undefined;
    return e;
  });
}
