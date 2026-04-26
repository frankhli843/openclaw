import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createNoopLogger,
  createCronStoreHarness,
  createRunningCronServiceState,
  writeCronStoreSnapshot,
} from "./service.test-harness.js";
import { resolveStuckRunMs } from "./service/jobs.js";
import { createCronServiceState } from "./service/state.js";
import { applyJobResult, onTimer } from "./service/timer.js";
import type { CronJob } from "./types.js";

const { makeStorePath } = createCronStoreHarness({ prefix: "frankclaw-timer-" });

describe("timer frankclaw merge guards", () => {
  it("keeps preserveSchedule behavior on error fallback when self-heal does not handle", () => {
    const nowMs = Date.now();
    const everyMs = 60 * 60 * 1_000;
    const previousRunAtMs = nowMs - 30 * 60 * 1_000;
    const expectedAnchoredNext = previousRunAtMs + everyMs;

    const job: CronJob = {
      id: "every-preserve-on-error",
      name: "every preserve on error",
      enabled: true,
      createdAtMs: previousRunAtMs - everyMs,
      updatedAtMs: previousRunAtMs,
      schedule: { kind: "every", everyMs, anchorMs: previousRunAtMs - everyMs },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "tick" },
      state: {
        lastRunAtMs: previousRunAtMs,
        nextRunAtMs: expectedAnchoredNext,
      },
    };

    const startedAt = nowMs;
    const endedAt = nowMs + 2_000;
    const state = createRunningCronServiceState({
      storePath: "/tmp/cron-timer-frankclaw-preserve-error-test.json",
      log: createNoopLogger(),
      nowMs: () => nowMs,
      jobs: [job],
    });

    applyJobResult(
      state,
      job,
      {
        status: "error",
        error: "synthetic failure",
        startedAt,
        endedAt,
      },
      { preserveSchedule: true },
    );

    // preserveSchedule computes against the previous cadence anchor.
    // Error backoff is 30s, so anchored next run should still dominate.
    expect(job.state.nextRunAtMs).toBe(expectedAnchoredNext);
    expect(job.state.consecutiveErrors).toBe(1);
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

function createDueJobForOverlap(params: {
  id: string;
  nowMs: number;
  nextRunAtMs: number;
  payloadKind?: "agentTurn" | "systemEvent";
  timeoutSeconds?: number;
}): CronJob {
  const payload =
    params.payloadKind === "systemEvent"
      ? { kind: "systemEvent" as const, text: "test" }
      : {
          kind: "agentTurn" as const,
          message: "test",
          ...(params.timeoutSeconds !== undefined ? { timeoutSeconds: params.timeoutSeconds } : {}),
        };
  return {
    id: params.id,
    name: params.id,
    enabled: true,
    deleteAfterRun: false,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
    schedule: { kind: "every", everyMs: 60 * 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload,
    delivery: { mode: "none" },
    state: { nextRunAtMs: params.nextRunAtMs },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

const noopLogger = createNoopLogger();

// ── Overlapping timer ticks (anti-starvation) ───────────────────────────

describe("frankclaw: overlapping timer ticks (anti-starvation)", () => {
  beforeEach(() => {
    // The cron vitest lane runs with isolate disabled. Ensure fake timers from
    // other files do not leak into this suite (this test uses real setTimeout
    // to yield the event loop).
    vi.clearAllTimers();
    vi.useRealTimers();
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("allows a second job to start while a long-running first job is still executing", async () => {
    const store = await makeStorePath();
    const baseTime = Date.parse("2026-04-24T02:00:00.000Z");
    let now = baseTime;

    const mergeJob = createDueJobForOverlap({
      id: "nightly-merge",
      nowMs: baseTime,
      nextRunAtMs: baseTime,
    });
    const briefingJob = createDueJobForOverlap({
      id: "morning-briefing",
      nowMs: baseTime,
      nextRunAtMs: Date.parse("2026-04-24T07:00:00.000Z"),
    });

    await writeCronStoreSnapshot({
      storePath: store.storePath,
      jobs: [mergeJob, briefingJob],
    });

    const mergeDeferred = createDeferred<{ status: "ok"; summary: string }>();
    const briefingDeferred = createDeferred<{ status: "ok"; summary: string }>();

    const runIsolatedAgentJob = vi.fn(async (params: { job: CronJob }) => {
      if (params.job.id === "nightly-merge") {
        return await mergeDeferred.promise;
      }
      return await briefingDeferred.promise;
    });

    const state = createCronServiceState({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });

    // Tick 1 at 02:00: picks up merge job only.
    const tick1 = onTimer(state);
    await waitUntil(() => runIsolatedAgentJob.mock.calls.length === 1);

    expect(state.activeTicks).toBe(1);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);

    // Advance time to 07:00: briefing becomes due.
    now = Date.parse("2026-04-24T07:00:00.000Z");

    // Tick 2: picks up briefing (merge still running).
    const tick2 = onTimer(state);
    await waitUntil(() => runIsolatedAgentJob.mock.calls.length === 2);

    expect(state.activeTicks).toBe(2);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(2);

    briefingDeferred.resolve({ status: "ok", summary: "briefing done" });
    mergeDeferred.resolve({ status: "ok", summary: "merge done" });

    await tick1;
    await tick2;

    expect(state.activeTicks).toBe(0);
    expect(state.running).toBe(false);

    const calledJobIds = runIsolatedAgentJob.mock.calls.map(
      ([params]: [{ job: CronJob }]) => params.job.id,
    );
    expect(calledJobIds).toContain("nightly-merge");
    expect(calledJobIds).toContain("morning-briefing");

    if (state.timer) {
      clearTimeout(state.timer);
    }
    await store.cleanup();
  });
});

// ── Per-job stuck marker threshold ──────────────────────────────────────

describe("frankclaw: per-job stuck marker threshold", () => {
  it("returns job timeout + grace for agentTurn jobs", () => {
    const job = createDueJobForOverlap({
      id: "b",
      nowMs: 0,
      nextRunAtMs: 0,
      payloadKind: "agentTurn",
    });
    expect(resolveStuckRunMs(job)).toBe(65 * 60_000);
  });

  it("returns at least STUCK_RUN_MIN_MS for short-timeout jobs", () => {
    const job = createDueJobForOverlap({
      id: "q",
      nowMs: 0,
      nextRunAtMs: 0,
      payloadKind: "systemEvent",
    });
    expect(resolveStuckRunMs(job)).toBe(15 * 60_000);
  });

  it("uses custom timeoutSeconds when set", () => {
    const job = createDueJobForOverlap({
      id: "c",
      nowMs: 0,
      nextRunAtMs: 0,
      payloadKind: "agentTurn",
      timeoutSeconds: 120,
    });
    expect(resolveStuckRunMs(job)).toBe(15 * 60_000);
  });

  it("uses custom timeoutSeconds for long-running jobs", () => {
    const job = createDueJobForOverlap({
      id: "l",
      nowMs: 0,
      nextRunAtMs: 0,
      payloadKind: "agentTurn",
      timeoutSeconds: 3600,
    });
    expect(resolveStuckRunMs(job)).toBe(65 * 60_000);
  });

  it("falls back to STUCK_RUN_MS for jobs with no timeout", () => {
    const job = createDueJobForOverlap({
      id: "n",
      nowMs: 0,
      nextRunAtMs: 0,
      payloadKind: "agentTurn",
      timeoutSeconds: 0,
    });
    expect(resolveStuckRunMs(job)).toBe(2 * 60 * 60_000);
  });
});
