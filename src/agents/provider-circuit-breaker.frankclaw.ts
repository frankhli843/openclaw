/**
 * frankclaw: Process-level provider circuit breaker.
 *
 * Tracks consecutive timeout failures per provider across all sessions.
 * When a provider hits the failure threshold, it enters a "tripped" state
 * for a cooldown window, causing the fallback chain to skip it and go
 * directly to the next candidate (e.g. OpenAI → Gemini).
 *
 * This prevents the durable queue from backing up when a provider is
 * having a sustained outage: instead of every queued message burning
 * 300s+ on the same failing provider, they skip straight to the fallback.
 *
 * The breaker auto-resets after the cooldown window, and one probe
 * attempt is allowed per window to detect recovery.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("provider-circuit-breaker");

interface BreakerState {
  consecutiveFailures: number;
  lastFailureAt: number;
  trippedAt: number | null;
  probeAllowedAfter: number;
}

// frankclaw: configurable thresholds
const FAILURE_THRESHOLD = 3; // trip after 3 consecutive timeouts
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown when tripped
const PROBE_INTERVAL_MS = 60 * 1000; // allow one probe per 60s during cooldown
const STATE_TTL_MS = 30 * 60 * 1000; // forget providers after 30 min of silence
const MAX_PROVIDERS = 32;

const state = new Map<string, BreakerState>();

function pruneStale(now: number): void {
  for (const [key, s] of state) {
    if (now - s.lastFailureAt > STATE_TTL_MS) {
      state.delete(key);
    }
  }
  while (state.size > MAX_PROVIDERS) {
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [key, s] of state) {
      if (s.lastFailureAt < oldestTs) {
        oldestKey = key;
        oldestTs = s.lastFailureAt;
      }
    }
    if (oldestKey) {
      state.delete(oldestKey);
    }
  }
}

function getOrCreate(provider: string): BreakerState {
  let s = state.get(provider);
  if (!s) {
    s = {
      consecutiveFailures: 0,
      lastFailureAt: 0,
      trippedAt: null,
      probeAllowedAfter: 0,
    };
    state.set(provider, s);
  }
  return s;
}

/**
 * Record a timeout failure for a provider. If the threshold is reached,
 * the breaker trips.
 */
export function recordProviderTimeoutFailure(provider: string): void {
  const now = Date.now();
  pruneStale(now);
  const s = getOrCreate(provider);
  s.consecutiveFailures += 1;
  s.lastFailureAt = now;

  if (s.consecutiveFailures >= FAILURE_THRESHOLD && !s.trippedAt) {
    s.trippedAt = now;
    s.probeAllowedAfter = now + PROBE_INTERVAL_MS;
    log.info(
      `Circuit breaker TRIPPED for ${provider} after ${s.consecutiveFailures} consecutive timeouts. ` +
        `Cooldown: ${COOLDOWN_MS / 1000}s. Next probe allowed after ${PROBE_INTERVAL_MS / 1000}s.`,
    );
  }
}

/**
 * Record a successful response from a provider. Resets the breaker.
 */
export function recordProviderSuccess(provider: string): void {
  const s = state.get(provider);
  if (!s) {
    return;
  }
  if (s.trippedAt) {
    log.info(
      `Circuit breaker RESET for ${provider} after successful response ` +
        `(was tripped for ${Math.round((Date.now() - s.trippedAt) / 1000)}s).`,
    );
  }
  state.delete(provider);
}

/**
 * Check whether a provider should be skipped by the fallback chain.
 *
 * Returns:
 * - "ok" if the provider is healthy (use normally)
 * - "skip" if the breaker is tripped and probe isn't due yet
 * - "probe" if the breaker is tripped but a probe attempt is allowed
 */
export function checkProviderBreaker(provider: string): "ok" | "skip" | "probe" {
  const s = state.get(provider);
  if (!s || !s.trippedAt) {
    return "ok";
  }

  const now = Date.now();
  const elapsed = now - s.trippedAt;

  // Cooldown expired: auto-reset
  if (elapsed >= COOLDOWN_MS) {
    log.info(
      `Circuit breaker auto-reset for ${provider} (cooldown expired after ${Math.round(elapsed / 1000)}s).`,
    );
    state.delete(provider);
    return "ok";
  }

  // Allow periodic probes to detect recovery
  if (now >= s.probeAllowedAfter) {
    s.probeAllowedAfter = now + PROBE_INTERVAL_MS;
    return "probe";
  }

  return "skip";
}

/**
 * Reset all circuit breaker state. Used by tests to ensure isolation.
 */
export function resetCircuitBreakerState(): void {
  state.clear();
}

/**
 * Get diagnostic info for all tracked providers.
 */
export function getCircuitBreakerStatus(): Array<{
  provider: string;
  consecutiveFailures: number;
  tripped: boolean;
  trippedForMs: number | null;
}> {
  const now = Date.now();
  return Array.from(state.entries()).map(([provider, s]) => ({
    provider,
    consecutiveFailures: s.consecutiveFailures,
    tripped: s.trippedAt !== null,
    trippedForMs: s.trippedAt ? now - s.trippedAt : null,
  }));
}
