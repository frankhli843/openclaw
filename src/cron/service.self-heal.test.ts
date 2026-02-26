import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCronServiceState } from "./service/state.js";
import { onTimer } from "./service/timer.js";
import type { CronJob } from "./types.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

let fixtureRoot = "";
let caseId = 0;

async function makeStorePath() {
  const dir = path.join(fixtureRoot, `case-${caseId++}`);
  await fs.mkdir(dir, { recursive: true });
  return path.join(dir, "jobs.json");
}

function createDueCronIsolatedJob(params: {
  id: string;
  nowMs: number;
  nextRunAtMs: number;
}): CronJob {
  return {
    id: params.id,
    name: params.id,
    enabled: true,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
    schedule: { kind: "cron", expr: "* * * * *", tz: "UTC", staggerMs: 0 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: params.id },
    delivery: { mode: "none" },
    state: { nextRunAtMs: params.nextRunAtMs },
  };
}

function createDueAtIsolatedJob(params: {
  id: string;
  nowMs: number;
  nextRunAtMs: number;
}): CronJob {
  return {
    id: params.id,
    name: params.id,
    enabled: true,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
    schedule: { kind: "at", at: new Date(params.nextRunAtMs).toISOString() },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: params.id },
    delivery: { mode: "none" },
    state: { nextRunAtMs: params.nextRunAtMs },
  };
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-self-heal-"));
});

afterAll(async () => {
  if (!fixtureRoot) {
    return;
  }
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("cron self-heal", () => {
  it("schedules exactly one retry ~30m later for transient infra errors on cron jobs", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:00:00.000Z");

    const job = createDueCronIsolatedJob({ id: "self-heal-job", nowMs: dueAt, nextRunAtMs: dueAt });
    await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs: [job] }, null, 2), "utf-8");

    let now = dueAt;
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "429 rate limit reached" })
      .mockResolvedValueOnce({ status: "ok", summary: "ok" });

    const sendDeadLetterAlert = vi.fn();
    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      cronConfig: {
        selfHeal: {
          enabled: true,
          retryDelay: "30m",
          maxAttemptsPerRun: 2,
          match: ["rate limit"],
        },
      },
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert,
    });

    await onTimer(state);

    const storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.state.lastStatus).toBe("error");
    expect(storedJob?.state.selfHeal?.originRunAtMs).toBe(dueAt);
    expect(storedJob?.state.selfHeal?.attempts).toBe(1);
    expect(storedJob?.state.nextRunAtMs).toBe(dueAt + 30 * 60_000);
    expect(sendDeadLetterAlert).not.toHaveBeenCalled();

    // Retry attempt succeeds.
    now = storedJob?.state.nextRunAtMs ?? dueAt + 30 * 60_000;
    await onTimer(state);

    const storedJobAfterRetry = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJobAfterRetry?.state.lastStatus).toBe("ok");
    expect(storedJobAfterRetry?.state.selfHeal).toBeUndefined();
  });

  it("alerts when the retry fails and does not schedule further retries for the same run", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:10:00.000Z");

    const job = createDueCronIsolatedJob({
      id: "self-heal-alert",
      nowMs: dueAt,
      nextRunAtMs: dueAt,
    });
    await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs: [job] }, null, 2), "utf-8");

    let now = dueAt;
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "rate limit" })
      .mockResolvedValueOnce({ status: "error", error: "rate limit" });

    const sendDeadLetterAlert = vi.fn();

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      cronConfig: {
        selfHeal: {
          enabled: true,
          retryDelay: "30m",
          maxAttemptsPerRun: 2,
          match: ["rate limit"],
        },
      },
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert,
    });

    await onTimer(state);
    const storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.state.lastStatus).toBe("error");
    expect(storedJob?.state.selfHeal?.attempts).toBe(1);
    expect(storedJob?.state.nextRunAtMs).toBe(dueAt + 30 * 60_000);
    expect(sendDeadLetterAlert).not.toHaveBeenCalled();

    now = storedJob?.state.nextRunAtMs ?? dueAt + 30 * 60_000;
    await onTimer(state);

    const afterRetry = state.store?.jobs.find((j) => j.id === job.id);
    expect(afterRetry?.state.lastStatus).toBe("error");
    expect(sendDeadLetterAlert).toHaveBeenCalledTimes(1);
    // After giving up, ensure we cool down for at least the retry window.
    expect(afterRetry?.state.nextRunAtMs).toBe(dueAt + 60 * 60_000);
  });

  it("does not apply self-heal retries to one-shot at jobs by default", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:20:00.000Z");

    const job = createDueAtIsolatedJob({ id: "one-shot-at", nowMs: dueAt, nextRunAtMs: dueAt });
    await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs: [job] }, null, 2), "utf-8");

    let now = dueAt;
    const runner = vi.fn().mockResolvedValueOnce({ status: "error", error: "rate limit" });

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      cronConfig: {
        selfHeal: {
          enabled: true,
          retryDelay: "30m",
          maxAttemptsPerRun: 2,
          match: ["rate limit"],
        },
      },
      log: noopLogger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert: vi.fn(),
    });

    await onTimer(state);

    const storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.enabled).toBe(false);
    expect(storedJob?.state.nextRunAtMs).toBeUndefined();
    expect(storedJob?.state.selfHeal).toBeUndefined();
  });
});
