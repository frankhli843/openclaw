/**
 * frankclaw: Guard against task-registry-maintenance close-retry spam, and
 * rate-limit the startup burst so the event loop stays responsive.
 *
 * Two failure modes this guards against:
 *
 * 1. Close-retry spam. When task-registry-maintenance tries to close a terminal
 *    ACP session and the backend doesn't support the close control
 *    (ACP_BACKEND_UNSUPPORTED_CONTROL), it logs a warning and moves on, but the
 *    session entry stays in the store, so the next sweep tries again, producing
 *    ~400 warnings/hour. We cache non-retryable failures and skip them on
 *    subsequent sweeps. The cache resets when the gateway restarts.
 *
 * 2. Startup burst. After a gateway restart, the first maintenance sweep finds
 *    every stale ACP session at once (300+ in production). The cache is empty,
 *    so every entry hits the real close path. Each attempt does meaningful
 *    sync+async work (resolveSession, evictIdleRuntimeHandles, withSessionActor,
 *    ensureRuntimeHandle) before failing fast with ACP_BACKEND_UNSUPPORTED_CONTROL.
 *    Without yielding, the resulting microtask chain saturates the event loop
 *    (P99 latency spikes to 4-6s, utilization 1.0) for the duration of the sweep.
 *    We rate-limit by capping concurrent in-flight close attempts and yielding
 *    to the event loop after each one finishes. Cached (already-failed) calls
 *    bypass the limiter entirely and return immediately.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("frankclaw/task-maintenance-close-guard");

// Session keys that failed close with a non-retryable error.
// Reset on gateway restart (this is a process-level cache).
const failedCloseSessionKeys = new Map<string, { error: string; failedAt: number }>();

// Max entries to prevent unbounded growth
const MAX_ENTRIES = 500;

// Cap how many real (cache-miss) close attempts can be in flight at once.
// The upstream call site is sequential, so this is mainly a defensive ceiling
// in case any caller batches close attempts in parallel.
const DEFAULT_MAX_CONCURRENT_CLOSE_ATTEMPTS = 3;

let maxConcurrentCloseAttempts = DEFAULT_MAX_CONCURRENT_CLOSE_ATTEMPTS;
let inFlightCloseAttempts = 0;
let peakInFlightCloseAttempts = 0;
const closeAttemptQueue: Array<() => void> = [];

// Override the yield mechanism in tests; defaults to setImmediate.
let yieldImpl: () => Promise<void> = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

function acquireCloseSlot(): Promise<void> {
  if (inFlightCloseAttempts < maxConcurrentCloseAttempts) {
    inFlightCloseAttempts += 1;
    if (inFlightCloseAttempts > peakInFlightCloseAttempts) {
      peakInFlightCloseAttempts = inFlightCloseAttempts;
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    closeAttemptQueue.push(resolve);
  });
}

function releaseCloseSlot(): void {
  const next = closeAttemptQueue.shift();
  if (next) {
    // Hand off the slot directly; the awaiting caller becomes the new in-flight holder.
    next();
    return;
  }
  inFlightCloseAttempts = Math.max(0, inFlightCloseAttempts - 1);
}

/**
 * Wraps a closeAcpSession function to suppress repeated close attempts
 * for sessions where the backend doesn't support the close control,
 * and to rate-limit the burst that fires on the first sweep after restart.
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

    await acquireCloseSlot();
    let shouldYield = true;
    try {
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
            const oldest = [...failedCloseSessionKeys.entries()].toSorted(
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

        // Retryable errors: rethrow so the caller can log and retry next sweep.
        // Don't yield in this case; the caller will handle scheduling.
        shouldYield = false;
        throw error;
      }
    } finally {
      releaseCloseSlot();
      if (shouldYield) {
        // Yield back to the event loop after each real close attempt so a burst
        // of cache-miss closes can't starve other I/O. Cached calls return
        // before reaching here, so they keep their fast path.
        await yieldImpl();
      }
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

/**
 * Test-only helpers. Not exported through the public surface; consumed by
 * task-maintenance-close-guard.frankclaw.test.ts.
 */
export const __testing__ = {
  reset(): void {
    failedCloseSessionKeys.clear();
    inFlightCloseAttempts = 0;
    peakInFlightCloseAttempts = 0;
    closeAttemptQueue.length = 0;
    maxConcurrentCloseAttempts = DEFAULT_MAX_CONCURRENT_CLOSE_ATTEMPTS;
    yieldImpl = () =>
      new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
  },
  setMaxConcurrent(value: number): void {
    maxConcurrentCloseAttempts = Math.max(1, value);
  },
  setYieldImpl(impl: () => Promise<void>): void {
    yieldImpl = impl;
  },
  getInFlight(): number {
    return inFlightCloseAttempts;
  },
  getPeakInFlight(): number {
    return peakInFlightCloseAttempts;
  },
  getQueueLength(): number {
    return closeAttemptQueue.length;
  },
};
