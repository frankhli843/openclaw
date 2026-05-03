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

describe("cron retry/backoff behavior", () => {
  it("applies cron backoff and clears retry state once a later run succeeds", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:00:00.000Z");

    const job = createDueCronIsolatedJob({ id: "cron-backoff", nowMs: dueAt, nextRunAtMs: dueAt });
    await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs: [job] }, null, 2), "utf-8");

    let now = dueAt;
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "429 rate limit reached" })
      .mockResolvedValueOnce({ status: "ok", summary: "ok" });

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
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert: vi.fn(),
    });

    await onTimer(state);

    const storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.state.lastStatus).toBe("error");
    expect(storedJob?.state.consecutiveErrors).toBe(1);
    // Self-heal should schedule a retry (transient "rate limit" matches)
    expect(storedJob?.state.selfHeal).toBeDefined();
    expect(storedJob?.state.selfHeal?.attempts).toBe(1);
    // nextRunAtMs should be endedAt + 30m (self-heal retry delay)
    expect(storedJob?.state.nextRunAtMs).toBeGreaterThan(dueAt + 60_000);

    now = storedJob?.state.nextRunAtMs ?? dueAt + 60_000;
    await onTimer(state);

    const afterSuccess = state.store?.jobs.find((j) => j.id === job.id);
    expect(afterSuccess?.state.lastStatus).toBe("ok");
    expect(afterSuccess?.state.consecutiveErrors).toBe(0);
    // Self-heal state should be cleared on success
    expect(afterSuccess?.state.selfHeal).toBeUndefined();
  });

  it("increments consecutiveErrors across repeated cron failures", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:10:00.000Z");

    const job = createDueCronIsolatedJob({
      id: "cron-repeated-errors",
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
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert,
    });

    await onTimer(state);
    let storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.state.consecutiveErrors).toBe(1);

    now = storedJob?.state.nextRunAtMs ?? dueAt + 60_000;
    await onTimer(state);

    storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.state.lastStatus).toBe("error");
    expect(storedJob?.state.consecutiveErrors).toBe(2);
    // Self-heal should send a give-up alert after maxAttemptsPerRun exhausted
    expect(sendDeadLetterAlert).toHaveBeenCalledTimes(1);
  });

  it("retries one-shot at jobs on transient errors", async () => {
    const storePath = await makeStorePath();
    const dueAt = Date.parse("2026-02-25T15:20:00.000Z");

    const job = createDueAtIsolatedJob({ id: "one-shot-at", nowMs: dueAt, nextRunAtMs: dueAt });
    await fs.writeFile(storePath, JSON.stringify({ version: 1, jobs: [job] }, null, 2), "utf-8");

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
      nowMs: () => dueAt,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: runner,
      sendDeadLetterAlert: vi.fn(),
    });

    await onTimer(state);

    const storedJob = state.store?.jobs.find((j) => j.id === job.id);
    expect(storedJob?.enabled).toBe(true);
    expect(storedJob?.state.nextRunAtMs).toBe(dueAt + 30_000);
    expect(storedJob?.state.consecutiveErrors).toBe(1);
  });
});
