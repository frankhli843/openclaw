/**
 * frankclaw: Guard against task-registry-maintenance close-retry spam.
 *
 * When task-registry-maintenance tries to close a terminal ACP session and the
 * backend doesn't support the close control (ACP_BACKEND_UNSUPPORTED_CONTROL),
 * it logs a warning and moves on. But the session entry stays in the store,
 * so the next sweep tries again, producing ~400 warnings/hour.
 *
 * This module wraps the closeAcpSession function to remember which session keys
 * have failed with unsupported-control errors and skip them on subsequent sweeps.
 * The cache resets when the gateway restarts (which clears stale sessions anyway).
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("frankclaw/task-maintenance-close-guard");

// Session keys that failed close with a non-retryable error.
// Reset on gateway restart (this is a process-level cache).
const failedCloseSessionKeys = new Map<string, { error: string; failedAt: number }>();

// Max entries to prevent unbounded growth
const MAX_ENTRIES = 500;

/**
 * Wraps a closeAcpSession function to suppress repeated close attempts
 * for sessions where the backend doesn't support the close control.
 */
export function guardCloseAcpSession(
  originalClose: (params: { cfg: unknown; sessionKey: string; reason: string }) => Promise<void>,
): typeof originalClose {
  return async (params) => {
    const cached = failedCloseSessionKeys.get(params.sessionKey);
    if (cached) {
      // Already failed with a non-retryable error, skip silently
      return;
    }

    try {
      await originalClose(params);
      // Success: remove from cache if it was there
      failedCloseSessionKeys.delete(params.sessionKey);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorCode = (error as { code?: string })?.code ?? "";

      // Non-retryable errors: backend doesn't support close, or session not found
      const isNonRetryable =
        errorCode === "ACP_BACKEND_UNSUPPORTED_CONTROL" ||
        errorMsg.includes("UNSUPPORTED_CONTROL") ||
        errorMsg.includes("unsupported") ||
        errorMsg.includes("not found") ||
        errorMsg.includes("no such session");

      if (isNonRetryable) {
        // Cache the failure to prevent retry spam
        if (failedCloseSessionKeys.size >= MAX_ENTRIES) {
          // Evict oldest entry
          const oldest = [...failedCloseSessionKeys.entries()].sort(
            (a, b) => a[1].failedAt - b[1].failedAt,
          )[0];
          if (oldest) {
            failedCloseSessionKeys.delete(oldest[0]);
          }
        }
        failedCloseSessionKeys.set(params.sessionKey, {
          error: errorMsg.slice(0, 200),
          failedAt: Date.now(),
        });
        // Log once (at debug level, not warn)
        log.info(
          `Suppressing repeated close for ${params.sessionKey}: ${errorCode || errorMsg.slice(0, 80)} (will not retry)`,
        );
        return; // Swallow the error to prevent the warn spam in the caller
      }

      // Retryable errors: rethrow so the caller can log and retry next sweep
      throw error;
    }
  };
}

/**
 * Returns the number of sessions with suppressed close failures.
 * Useful for diagnostics.
 */
export function getCloseSuppressedCount(): number {
  return failedCloseSessionKeys.size;
}
