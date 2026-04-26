/**
 * Cron self-heal: frankclaw extension for automatic retry of recurring cron jobs
 * that fail with transient infrastructure errors.
 *
 * For recurring cron jobs (schedule.kind="cron"), transient infra failures can be
 * retried after a cooldown window. Retries are per run (deduped by the scheduled
 * run timestamp). One-shot "at" jobs are not eligible.
 */
import { parseDurationMs } from "../../cli/parse-duration.js";
import type { CronConfig } from "../../config/types.cron.js";
import type { CronJob, CronSelfHealState } from "../types.js";
import { computeJobNextRunAtMs } from "./jobs.js";
import type { CronServiceState } from "./state.js";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SELF_HEAL_RETRY_DELAY = "30m";
const DEFAULT_SELF_HEAL_MAX_ATTEMPTS_PER_RUN = 2;
const DEFAULT_SELF_HEAL_MATCHERS = [
  "rate limit",
  "too many requests",
  "429",
  "quota",
  "throttl",
  "cooldown",
  "no available auth profile",
  "auth profile",
  "announce delivery failed",
  "cron announce delivery failed",
  // Network-level transient errors (added after 2026-04-26 incident where
  // a network outage caused daily-health-security to fail without retry).
  "network",
  "fetch failed",
  "econnreset",
  "econnrefused",
  "econnaborted",
  "socket",
  "etimedout",
  "failovererror",
];

// ── Types ──────────────────────────────────────────────────────────────────

export type ResolvedCronSelfHealConfig = {
  enabled: boolean;
  retryDelayMs: number;
  maxAttemptsPerRun: number;
  matchers: string[];
};

// ── Config Resolution ──────────────────────────────────────────────────────

export function resolveCronSelfHealConfig(cronConfig?: CronConfig): ResolvedCronSelfHealConfig {
  const enabled = cronConfig?.selfHeal?.enabled !== false;
  let retryDelayMs = parseDurationMs(DEFAULT_SELF_HEAL_RETRY_DELAY, { defaultUnit: "m" });
  const rawDelay = cronConfig?.selfHeal?.retryDelay;
  if (typeof rawDelay === "string" && rawDelay.trim()) {
    try {
      retryDelayMs = parseDurationMs(rawDelay.trim(), { defaultUnit: "m" });
    } catch {
      retryDelayMs = parseDurationMs(DEFAULT_SELF_HEAL_RETRY_DELAY, { defaultUnit: "m" });
    }
  }
  const maxAttemptsRaw = cronConfig?.selfHeal?.maxAttemptsPerRun;
  const maxAttemptsPerRun =
    typeof maxAttemptsRaw === "number" && Number.isFinite(maxAttemptsRaw)
      ? Math.max(1, Math.floor(maxAttemptsRaw))
      : DEFAULT_SELF_HEAL_MAX_ATTEMPTS_PER_RUN;
  const matchersRaw = cronConfig?.selfHeal?.match;
  const matchers =
    Array.isArray(matchersRaw) && matchersRaw.length > 0
      ? matchersRaw.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x)
      : DEFAULT_SELF_HEAL_MATCHERS;
  return { enabled, retryDelayMs: Math.max(0, retryDelayMs), maxAttemptsPerRun, matchers };
}

// ── Error Matching ─────────────────────────────────────────────────────────

export function isTransientCronInfraError(
  error: string | undefined,
  cfg: ResolvedCronSelfHealConfig,
): boolean {
  if (!cfg.enabled) {
    return false;
  }
  const raw = typeof error === "string" ? error.trim() : "";
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  return cfg.matchers.some((m) => {
    const needle = m.toLowerCase();
    return needle ? lower.includes(needle) : false;
  });
}

// ── Alert Formatting ───────────────────────────────────────────────────────

export function formatCronSelfHealAlert(params: {
  job: CronJob;
  originRunAtMs: number;
  attempt: number;
  maxAttempts: number;
  error?: string;
}): string {
  const runIso = new Date(params.originRunAtMs).toISOString();
  const errText = params.error ? params.error : "<no error>";
  return `⚠️ Cron self-heal give-up: job=${params.job.id} name=${params.job.name} run=${runIso} attempt=${params.attempt}/${params.maxAttempts} error=${errText}`;
}

// ── Durable Queue Bypass ───────────────────────────────────────────────────

export function shouldBypassDurableQueueForCronJob(job: CronJob): boolean {
  return (
    job.sessionTarget === "main" && job.wakeMode === "now" && job.payload.kind === "systemEvent"
  );
}

// ── Self-Heal Integration for applyJobResult ───────────────────────────────

/**
 * Apply self-heal logic to a failed cron job. Called from applyJobResult
 * when a recurring cron job (schedule.kind="cron") fails with an error.
 *
 * Returns `true` if a self-heal retry was scheduled (caller should skip
 * normal error backoff), `false` otherwise.
 */
export function applySelfHealOnError(params: {
  state: CronServiceState;
  job: CronJob;
  result: {
    status: "error";
    error?: string;
    startedAt: number;
    endedAt: number;
    scheduledAtMs?: number;
  };
  errorBackoffMs: (consecutiveErrors: number) => number;
}): boolean {
  const { state, job, result, errorBackoffMs: getErrorBackoffMs } = params;
  const selfHealCfg = resolveCronSelfHealConfig(state.deps.cronConfig);
  const hasSelfHealState = job.state.selfHeal !== undefined;
  const selfHealState = job.state.selfHeal;

  if (job.schedule.kind !== "cron") {
    // Non-cron recurring schedules: clear stale self-heal state.
    if (hasSelfHealState) {
      job.state.selfHeal = undefined;
    }
    return false;
  }

  const transient = isTransientCronInfraError(result.error, selfHealCfg);
  const scheduledAtMs = result.scheduledAtMs;
  const isRetryAttempt =
    selfHealState !== undefined &&
    typeof scheduledAtMs === "number" &&
    typeof selfHealState.retryAtMs === "number" &&
    selfHealState.retryAtMs === scheduledAtMs;

  const originRunAtMs =
    selfHealState !== undefined && isRetryAttempt
      ? selfHealState.originRunAtMs
      : typeof scheduledAtMs === "number"
        ? scheduledAtMs
        : result.startedAt;

  // attempts = completed attempts for this origin run (including current run).
  const attempts =
    selfHealState !== undefined && isRetryAttempt
      ? Math.max(1, (selfHealState.attempts ?? 1) + 1)
      : 1;

  if (transient && attempts < selfHealCfg.maxAttemptsPerRun) {
    const retryAtMs = result.endedAt + selfHealCfg.retryDelayMs;
    job.state.selfHeal = {
      originRunAtMs,
      attempts,
      retryAtMs,
    } satisfies CronSelfHealState;
    job.state.nextRunAtMs = retryAtMs;
    state.deps.log.warn(
      {
        jobId: job.id,
        jobName: job.name,
        originRunAtMs,
        attempt: attempts,
        maxAttempts: selfHealCfg.maxAttemptsPerRun,
        retryDelayMs: selfHealCfg.retryDelayMs,
        nextRunAtMs: job.state.nextRunAtMs,
        error: result.error,
      },
      "cron: scheduling self-heal retry",
    );
    return true; // Retry scheduled — caller should skip normal error backoff.
  }

  // No retry scheduled.
  const shouldAlertGiveUp =
    isRetryAttempt || (transient && attempts >= selfHealCfg.maxAttemptsPerRun);

  if (shouldAlertGiveUp) {
    const lastAlertAtMs = selfHealState?.lastAlertAtMs;
    // De-dupe alerts per origin run.
    if (lastAlertAtMs === undefined) {
      job.state.selfHeal = {
        originRunAtMs,
        attempts,
        lastAlertAtMs: result.endedAt,
      };
      const message = formatCronSelfHealAlert({
        job,
        originRunAtMs,
        attempt: attempts,
        maxAttempts: selfHealCfg.maxAttemptsPerRun,
        error: result.error,
      });
      try {
        void Promise.resolve(state.deps.sendDeadLetterAlert?.(message));
      } catch {
        /* ignore */
      }
    }
  } else {
    // Clear stale self-heal state on non-transient failures.
    if (hasSelfHealState) {
      job.state.selfHeal = undefined;
    }
  }

  // Fall through to error backoff; but for transient infra failures, ensure
  // the next run is at least after the self-heal cooldown window.
  let normalNext: number | undefined;
  try {
    normalNext = computeJobNextRunAtMs(job, result.endedAt);
  } catch (err) {
    // Schedule expression/timezone threw — fall through to backoff-only.
    state.deps.log.warn(
      { jobId: job.id, err: String(err) },
      "cron: self-heal computeJobNextRunAtMs failed, using backoff only",
    );
  }
  const backoff = getErrorBackoffMs(job.state.consecutiveErrors ?? 1);
  const backoffNext = result.endedAt + backoff;
  const minNext = transient ? result.endedAt + selfHealCfg.retryDelayMs : backoffNext;
  job.state.nextRunAtMs =
    normalNext !== undefined
      ? Math.max(normalNext, backoffNext, minNext)
      : Math.max(backoffNext, minNext);
  state.deps.log.info(
    {
      jobId: job.id,
      consecutiveErrors: job.state.consecutiveErrors,
      backoffMs: backoff,
      nextRunAtMs: job.state.nextRunAtMs,
    },
    "cron: applying error backoff (self-heal path)",
  );

  return false;
}

/**
 * Clear self-heal state on success/skipped for a cron job.
 * Called from applyJobResult when result.status is not "error".
 */
export function clearSelfHealOnSuccess(job: CronJob): void {
  if (job.state.selfHeal !== undefined) {
    job.state.selfHeal = undefined;
  }
}
