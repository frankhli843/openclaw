import { describe, expect, it } from "vitest";
import { shouldBypassDurableQueueForCronJob } from "./service/timer.js";
import type { CronJob } from "./types.js";

function makeJob(overrides: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    name: "job",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: 1 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "hello" },
    state: { nextRunAtMs: 1 },
    ...overrides,
  };
}

describe("cron durable queue heartbeat exclusions", () => {
  it("bypasses durable queue for main-session heartbeat path jobs", () => {
    const job = makeJob({
      sessionTarget: "main",
      wakeMode: "now",
      payload: { kind: "systemEvent", text: "ping" },
    });
    expect(shouldBypassDurableQueueForCronJob(job)).toBe(true);
  });

  it("keeps durable queue for isolated jobs", () => {
    const job = makeJob({ sessionTarget: "isolated", wakeMode: "next-heartbeat" });
    expect(shouldBypassDurableQueueForCronJob(job)).toBe(false);
  });
});
