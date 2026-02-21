import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscordInboundDurableQueue } from "./inbound-durable-queue.js";

async function makeTmpDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "discord-inbound-queue-"));
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

describe("discord inbound durable queue", () => {
  it("persists enqueue before processing starts", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let sawPersistedJob = false;

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        const jobs = await queue.listLiveJobsForTest();
        sawPersistedJob = jobs.some((job) => job.state === "processing");
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    expect(sawPersistedJob).toBe(true);
  });

  it("acks successful jobs by removing them", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {},
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    expect(await queue.listLiveJobsForTest()).toHaveLength(0);
  });

  it("recovers stale processing jobs on startup", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "discord-inbound-queue", "default");
    const staleJobPath = path.join(queueDir, "stale-job.json");
    await fs.promises.mkdir(queueDir, { recursive: true });
    await fs.promises.writeFile(
      staleJobPath,
      JSON.stringify({
        id: "stale-job",
        dedupeKey: "default:c1:m1",
        state: "processing",
        enqueuedAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
        leaseUntil: Date.now() - 5_000,
        attempts: 0,
        nextAttemptAt: Date.now() - 10_000,
        event: {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m1",
          payload: { channel_id: "c1", message: { id: "m1" } },
        },
      }),
      "utf-8",
    );

    const processed: string[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        processed.push(event.messageId);
      },
    });

    await waitFor(async () => processed.includes("m1"));

    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(processed).toEqual(["m1"]);
  });

  it("dedupes repeated inbound messages by idempotency key", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let callCount = 0;
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        callCount += 1;
      },
    });

    const first = await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    const second = await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    await waitFor(async () => callCount === 1);

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(callCount).toBe(1);
  });

  it("retries with backoff and dead-letters after max failures", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let attempts = 0;
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      maxAttempts: 2,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        attempts += 1;
        throw new Error("boom");
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.dead === 1;
    });

    expect(attempts).toBe(2);
    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.dead).toBe(1);
  });

  it("sends dead-letter callback when max retries are exhausted", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const deadEvents: Array<{ messageId: string; attempts: number; lastError?: string }> = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      maxAttempts: 2,
      backoffMs: () => 0,
      onDeadLetter: (event, reason) => {
        deadEvents.push({
          messageId: event.messageId,
          attempts: reason.attempts,
          lastError: reason.lastError,
        });
      },
    });

    await queue.start({
      process: async () => {
        throw new Error("final-failure");
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m-dead",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m-dead" } },
    });

    await waitFor(async () => deadEvents.length === 1);
    expect(deadEvents[0]).toMatchObject({
      messageId: "m-dead",
      attempts: 2,
      lastError: "final-failure",
    });
  });

  it("preserves FIFO ordering for same ordering key", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const processed: string[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        processed.push(event.messageId);
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "thread:a",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });
    await queue.enqueue({
      channelId: "c1",
      messageId: "m2",
      orderingKey: "thread:a",
      payload: { channel_id: "c1", message: { id: "m2" } },
    });

    await waitFor(async () => processed.length === 2);
    expect(processed).toEqual(["m1", "m2"]);
  });
});
