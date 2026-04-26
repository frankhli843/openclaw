// frankclaw: Throttle session store maintenance to reduce lock hold time.
//
// Full maintenance (prune + cap + archive + rotate + disk budget) can take
// 5-10 seconds inside the file lock for large session stores. By throttling
// maintenance to run at most once per interval, most writes complete in
// under 100ms (serialize + atomic write only).
//
// This dramatically reduces cross-process lock contention between the gateway
// and CC ACP workers, preventing ANNOUNCE_GIVEUP delivery failures.
//
// Maintenance is only skipped within the throttle window; it still runs
// periodically to keep the store healthy. The first write always runs
// maintenance (cold start), and explicit maintenance requests bypass the
// throttle.

import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("sessions/maintenance-throttle");

const DEFAULT_THROTTLE_MS = 30_000; // 30 seconds

/** Per-store-path last maintenance timestamp. */
const lastMaintenanceByStore = new Map<string, number>();

/**
 * Returns true if maintenance should run for this store path.
 * Returns false if maintenance ran recently and should be skipped.
 *
 * The throttle interval can be tuned via the
 * `OPENCLAW_SESSION_MAINTENANCE_THROTTLE_MS` environment variable.
 * Set to `0` to disable throttling (run maintenance on every write).
 */
export function shouldRunMaintenance(storePath: string): boolean {
  const envMs = Number(process.env.OPENCLAW_SESSION_MAINTENANCE_THROTTLE_MS);
  const throttleMs = Number.isFinite(envMs) && envMs >= 0 ? envMs : DEFAULT_THROTTLE_MS;

  // Throttle disabled
  if (throttleMs === 0) {
    return true;
  }

  const now = Date.now();
  const last = lastMaintenanceByStore.get(storePath) ?? 0;

  if (now - last < throttleMs) {
    return false;
  }

  lastMaintenanceByStore.set(storePath, now);
  return true;
}

/**
 * Record that maintenance ran for a store path (called after maintenance completes).
 * This is separate from shouldRunMaintenance to handle the case where maintenance
 * is triggered by an external caller (e.g., explicit maintenance command).
 */
export function recordMaintenanceRan(storePath: string): void {
  lastMaintenanceByStore.set(storePath, Date.now());
}

/** Reset throttle state (for tests). */
export function resetMaintenanceThrottle(): void {
  lastMaintenanceByStore.clear();
}
