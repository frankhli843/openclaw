import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDeferredRetryDurableQueue } from "./deferred-retry-durable-queue.js";

async function makeTmpDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "deferred-retry-queue-"));
}

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await condition();
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("deferred retry durable queue", () => {
  it("processes due jobs and removes them", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const processed: string[] = [];
    const queue = createDeferredRetryDurableQueue({
      stateDir,
      queueName: "test",
    });

    await queue.start({
      process: async (event) => {
        processed.push(event.dedupeKey);
      },
    });

    await queue.enqueue({
      dedupeKey: "session:msg1",
      nextAttemptAt: Date.now(),
      followupRun: { prompt: "hello" },
    });

    await waitFor(() => processed.length === 1);
    expect(processed).toEqual(["session:msg1"]);

    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);

    await queue.stop();
  });

  it("recovers expired leases on startup", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "auto-reply", "deferred-retry", "recover");
    await fs.promises.mkdir(queueDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(queueDir, "stale.json"),
      JSON.stringify({
        id: "stale",
        dedupeKey: "session:stale",
        state: "processing",
        enqueuedAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
        leaseUntil: Date.now() - 2_000,
        attempts: 0,
        nextAttemptAt: Date.now() - 5_000,
        event: {
          dedupeKey: "session:stale",
          followupRun: { prompt: "recover" },
        },
      }),
      "utf-8",
    );

    const processed: string[] = [];
    const queue = createDeferredRetryDurableQueue({ stateDir, queueName: "recover" });

    await queue.start({
      process: async (event) => {
        processed.push(event.dedupeKey);
      },
    });

    await waitFor(() => processed.includes("session:stale"));
    expect(processed).toEqual(["session:stale"]);

    await queue.stop();
  });

  it("replays jobs after startup when processing lease expires later", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "auto-reply", "deferred-retry", "recover-active-lease");
    await fs.promises.mkdir(queueDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(queueDir, "leased.json"),
      JSON.stringify({
        id: "leased",
        dedupeKey: "session:leased",
        state: "processing",
        enqueuedAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
        leaseUntil: Date.now() + 120,
        attempts: 0,
        nextAttemptAt: Date.now() - 5_000,
        event: {
          dedupeKey: "session:leased",
          followupRun: { prompt: "recover later" },
        },
      }),
      "utf-8",
    );

    const processed: string[] = [];
    const queue = createDeferredRetryDurableQueue({ stateDir, queueName: "recover-active-lease" });

    await queue.start({
      process: async (event) => {
        processed.push(event.dedupeKey);
      },
    });

    await waitFor(() => processed.includes("session:leased"), 3_000);
    expect(processed).toEqual(["session:leased"]);

    await queue.stop();
  });

  it("dedupes duplicate deferred jobs by key", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let calls = 0;
    const queue = createDeferredRetryDurableQueue({
      stateDir,
      queueName: "dedupe",
    });

    await queue.start({
      process: async () => {
        calls += 1;
      },
    });

    const first = await queue.enqueue({
      dedupeKey: "session:msg2",
      nextAttemptAt: Date.now(),
      followupRun: { prompt: "one" },
    });
    const second = await queue.enqueue({
      dedupeKey: "session:msg2",
      nextAttemptAt: Date.now(),
      followupRun: { prompt: "one" },
    });

    await waitFor(() => calls === 1);

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(calls).toBe(1);

    await queue.stop();
  });

  it("survives restart and processes delayed jobs when due", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const processed: string[] = [];
    const queueA = createDeferredRetryDurableQueue({
      stateDir,
      queueName: "restart",
    });

    await queueA.start({
      process: async (event) => {
        processed.push(`A:${event.dedupeKey}`);
      },
    });

    await queueA.enqueue({
      dedupeKey: "session:msg3",
      nextAttemptAt: Date.now() + 150,
      followupRun: { prompt: "delayed" },
    });

    await queueA.stop();

    const queueB = createDeferredRetryDurableQueue({
      stateDir,
      queueName: "restart",
    });

    await queueB.start({
      process: async (event) => {
        processed.push(`B:${event.dedupeKey}`);
      },
    });

    await waitFor(() => processed.includes("B:session:msg3"), 3_000);
    expect(processed).toEqual(["B:session:msg3"]);

    await queueB.stop();
  });
});
