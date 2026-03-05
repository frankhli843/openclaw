import { describe, expect, it } from "vitest";
import { createNoopLogger, createRunningCronServiceState } from "./service.test-harness.js";
import { applyJobResult } from "./service/timer.js";
import type { CronJob } from "./types.js";

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
