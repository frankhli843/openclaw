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
    return e;
  });
}
