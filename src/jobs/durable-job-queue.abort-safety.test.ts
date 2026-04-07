import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDurableJobQueue } from "./durable-job-queue.js";

function makeTempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-queue-abort-test-"));
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("durable queue pre-run abort safety", () => {
  it("retry-exhausted dead-letters after all attempts fail", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    // Both attempts throw, exhausting retries.
    await expect(
      queue.run({
        queue: "retry-abort",
        kind: "test",
        payload: {},
        run: async () => {
          throw new Error("always failing");
        },
        onDeadLetter,
      }),
    ).rejects.toThrow("always failing");

    expect(onDeadLetter).toHaveBeenCalledOnce();
    expect(onDeadLetter.mock.calls[0][0].reason).toBe("retry-exhausted");
    expect(onDeadLetter.mock.calls[0][0].error).toBe("always failing");

    const dead = await queue._test.listDead("retry-abort");
    expect(dead).toHaveLength(1);
    expect(dead[0]?.metadata.deadLetterReason).toBe("retry-exhausted");
    expect(dead[0]?.metadata.attempts).toBe(2);
  });

  it("excludeFromQueue bypasses queue entirely", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const result = await queue.run({
      queue: "excluded",
      kind: "test",
      payload: { x: 1 },
      excludeFromQueue: true,
      run: async (payload) => ({ value: (payload as { x: number }).x * 2 }),
    });

    expect(result).toEqual({ value: 2 });

    // No files written to queue
    const live = await queue._test.listLive("excluded");
    expect(live).toHaveLength(0);
  });

  it("verifier failure without healer goes to dead-letter", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "verify-fail",
        kind: "test",
        payload: {},
        run: async () => ({ status: "bad" }),
        verify: async () => ({ ok: false, detail: "result was bad" }),
        onDeadLetter,
      }),
    ).rejects.toThrow("verifier failed");

    expect(onDeadLetter).toHaveBeenCalledOnce();
    expect(onDeadLetter.mock.calls[0][0].reason).toBe("verifier-failed");
  });

  it("healer failure goes to dead-letter with healer-failed reason", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "heal-fail",
        kind: "test",
        payload: {},
        run: async () => ({ status: "bad" }),
        verify: async () => ({ ok: false, detail: "broken" }),
        heal: async () => ({ ok: false, detail: "healer could not fix" }),
        onDeadLetter,
      }),
    ).rejects.toThrow("healer could not fix");

    expect(onDeadLetter).toHaveBeenCalledOnce();
    expect(onDeadLetter.mock.calls[0][0].reason).toBe("healer-failed");
  });

  it("successful healer replaces result", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });

    const result = await queue.run({
      queue: "heal-replace",
      kind: "test",
      payload: {},
      run: async () => ({ status: "bad" }),
      verify: async () => ({ ok: false, detail: "not good" }),
      heal: async () => ({ ok: true, result: { status: "healed" } }),
    });

    expect(result).toEqual({ status: "healed" });
  });
});
