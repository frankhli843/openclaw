import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDurableJobQueue } from "./durable-job-queue.js";

function makeTempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-job-queue-test-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("durable-job-queue", () => {
  it("success path", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });

    const result = await queue.run({
      queue: "cron-jobs",
      kind: "cron",
      payload: { text: "ok" },
      run: async () => ({ status: "ok" as const }),
      verify: async () => ({ ok: true }),
    });

    expect(result.status).toBe("ok");
    const live = await queue._test.listLive("cron-jobs");
    expect(live).toHaveLength(1);
    expect(live[0]?.state).toBe("succeeded");
    expect(live[0]?.metadata.attempts).toBe(1);
    expect(live[0]?.metadata.verifier.status).toBe("passed");
  });

  it("first failure then single retry success", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });

    let attempts = 0;
    const result = await queue.run({
      queue: "cron-jobs",
      kind: "cron",
      payload: { text: "retry" },
      run: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("boom");
        }
        return { status: "ok" as const };
      },
      verify: async () => ({ ok: true }),
    });

    expect(result.status).toBe("ok");
    expect(attempts).toBe(2);
    const live = await queue._test.listLive("cron-jobs");
    expect(live[0]?.metadata.attempts).toBe(2);
  });

  it("retry exhausted -> dead-letter", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "cron-jobs",
        kind: "cron",
        payload: { text: "fail" },
        run: async () => {
          throw new Error("still failing");
        },
        onDeadLetter,
      }),
    ).rejects.toThrow("still failing");

    const dead = await queue._test.listDead("cron-jobs");
    expect(dead).toHaveLength(1);
    expect(dead[0]?.metadata.deadLetterReason).toBe("retry-exhausted");
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it("verifier detects silent failure -> healer run", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });
    const healer = vi.fn(async () => ({ ok: true, result: { status: "ok" as const } }));

    const result = await queue.run({
      queue: "cron-jobs",
      kind: "cron",
      payload: { text: "silent" },
      run: async () => ({ status: "ok" as const }),
      verify: async () => ({ ok: false, detail: "silent failure" }),
      heal: healer,
    });

    expect(result.status).toBe("ok");
    expect(healer).toHaveBeenCalledTimes(1);
    const live = await queue._test.listLive("cron-jobs");
    expect(live[0]?.metadata.verifier.status).toBe("failed");
    expect(live[0]?.metadata.healer.status).toBe("succeeded");
  });

  it("healer timeout >1h -> dead-letter + alert path", async () => {
    const stateDir = makeTempStateDir();
    let now = 1_000;
    const queue = createDurableJobQueue({ stateDir, now: () => now, maxRuntimeMs: 3_600_000 });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "cron-jobs",
        kind: "cron",
        payload: { text: "timeout" },
        run: async () => ({ status: "ok" as const }),
        verify: async () => {
          now = 1_000 + 3_600_001;
          return { ok: false, detail: "incomplete" };
        },
        heal: async () => ({ ok: false, detail: "not reached" }),
        onDeadLetter,
      }),
    ).rejects.toThrow("timeout exceeded");

    const dead = await queue._test.listDead("cron-jobs");
    expect(dead).toHaveLength(1);
    expect(dead[0]?.metadata.deadLetterReason).toBe("timeout-exceeded");
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it("skips healer after 2 attempts in last 24h for same verifier issue", async () => {
    const stateDir = makeTempStateDir();
    let now = 10_000;
    const queue = createDurableJobQueue({ stateDir, now: () => now });
    const healer = vi.fn(async () => ({ ok: false, detail: "gateway timeout" }));

    const runFail = async () =>
      await queue.run({
        queue: "subagent-spawn-jobs",
        kind: "subagent-spawn",
        payload: { text: "same" },
        run: async () => ({ status: "error" as const }),
        verify: async () => ({ ok: false, detail: "gateway timeout after 10000ms" }),
        heal: healer,
      });

    await expect(runFail()).rejects.toThrow("gateway timeout");
    now += 1_000;
    await expect(runFail()).rejects.toThrow("gateway timeout");
    now += 1_000;

    const onDeadLetter = vi.fn();
    await expect(
      queue.run({
        queue: "subagent-spawn-jobs",
        kind: "subagent-spawn",
        payload: { text: "third" },
        run: async () => ({ status: "error" as const }),
        verify: async () => ({ ok: false, detail: "gateway timeout after 10000ms" }),
        heal: healer,
        onDeadLetter,
      }),
    ).rejects.toThrow("self-heal skipped");

    expect(healer).toHaveBeenCalledTimes(2);
    const dead = await queue._test.listDead("subagent-spawn-jobs");
    expect(dead).toHaveLength(3);
    const latest = dead.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
    expect(latest?.metadata.selfHealGate?.decision).toBe("skip");
    expect(latest?.metadata.selfHealGate?.priorAttemptsInWindow).toBe(2);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
  });

  it("exclusion of verifier/healer/checkup jobs from queueing", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });

    const result = await queue.run({
      queue: "subagent-spawn-jobs",
      kind: "subagent-spawn",
      payload: { task: "verifier" },
      excludeFromQueue: true,
      run: async () => ({ status: "accepted" as const }),
    });

    expect(result.status).toBe("accepted");
    const live = await queue._test.listLive("subagent-spawn-jobs");
    expect(live).toHaveLength(0);
  });

  it("duplicate-send protection", async () => {
    const stateDir = makeTempStateDir();
    const queue = createDurableJobQueue({ stateDir });

    let duplicateSuppressed = false;
    const result = await queue.run({
      queue: "cron-jobs",
      kind: "cron",
      payload: { text: "dedupe" },
      run: async (_payload, ctx) => {
        expect(ctx.recordMessageSend("discord:general:abc")).toBe(true);
        return { status: "ok" as const };
      },
      verify: async () => ({ ok: false, detail: "force healer" }),
      heal: async ({ ctx }) => {
        duplicateSuppressed = !ctx.recordMessageSend("discord:general:abc");
        const sentFresh = ctx.recordMessageSend("discord:general:def");
        return sentFresh ? { ok: true } : { ok: false, detail: "fresh send rejected" };
      },
    });

    expect(result.status).toBe("ok");
    expect(duplicateSuppressed).toBe(true);
    const live = await queue._test.listLive("cron-jobs");
    expect(live[0]?.metadata.sideEffects.sentMessageKeys).toEqual([
      "discord:general:abc",
      "discord:general:def",
    ]);
  });
});
