import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDurableJobQueue } from "./durable-job-queue.js";

function makeTempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-queue-diag-test-"));
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

describe("durable queue pre-process diagnostics", () => {
  it("onDeadLetter receives diagnostic metadata on retry-exhausted", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "diag-test",
        kind: "discord-announce",
        payload: { message: "hello" },
        run: async () => {
          throw new Error("connection refused");
        },
        onDeadLetter,
      }),
    ).rejects.toThrow("connection refused");

    expect(onDeadLetter).toHaveBeenCalledOnce();
    const call = onDeadLetter.mock.calls[0][0];
    expect(call.queue).toBe("diag-test");
    expect(call.kind).toBe("discord-announce");
    expect(call.reason).toBe("retry-exhausted");
    expect(call.error).toBe("connection refused");
    expect(call.metadata).toBeDefined();
    expect(call.metadata.attempts).toBeGreaterThan(0);
  });

  it("metadata tracks firstStartAt and lastAttemptAt", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    let clock = 1000;
    const queue = createDurableJobQueue({
      stateDir,
      now: () => clock,
    });
    const onDeadLetter = vi.fn();
    let attempt = 0;

    await expect(
      queue.run({
        queue: "timing-test",
        kind: "test",
        payload: {},
        run: async () => {
          attempt += 1;
          clock += 100; // advance clock per attempt
          throw new Error("fail");
        },
        onDeadLetter,
      }),
    ).rejects.toThrow();

    const metadata = onDeadLetter.mock.calls[0][0].metadata;
    expect(typeof metadata.firstStartAt).toBe("number");
    expect(typeof metadata.lastAttemptAt).toBe("number");
    expect(metadata.lastAttemptAt).toBeGreaterThanOrEqual(metadata.firstStartAt);
  });

  it("verifier detail is captured in metadata", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "verify-diag",
        kind: "test",
        payload: {},
        run: async () => ({ status: "ok" }),
        verify: async () => ({ ok: false, detail: "missing response body" }),
        onDeadLetter,
      }),
    ).rejects.toThrow();

    const metadata = onDeadLetter.mock.calls[0][0].metadata;
    expect(metadata.verifier.status).toBe("failed");
    expect(metadata.verifier.detail).toBe("missing response body");
  });

  it("dedupeKey is forwarded to onDeadLetter", async () => {
    const stateDir = makeTempStateDir();
    cleanupDirs.push(stateDir);

    const queue = createDurableJobQueue({ stateDir });
    const onDeadLetter = vi.fn();

    await expect(
      queue.run({
        queue: "dedupe-diag",
        kind: "test",
        dedupeKey: "unique-key-123",
        payload: {},
        run: async () => {
          throw new Error("boom");
        },
        onDeadLetter,
      }),
    ).rejects.toThrow();

    expect(onDeadLetter.mock.calls[0][0].dedupeKey).toBe("unique-key-123");
  });
});
