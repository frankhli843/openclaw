import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiscordInboundDurableQueue } from "./inbound-durable-queue.js";

async function makeTmpDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "discord-visibility-timeout-"));
}

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 3_000,
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

describe("visibility timeout", () => {
  it("uses visibilityTimeoutMs option as the lease duration", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let claimedLeaseUntil = 0;
    let claimedAt = 0;
    const TIMEOUT_MS = 2_000;

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      visibilityTimeoutMs: TIMEOUT_MS,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        const jobs = await queue.listLiveJobsForTest();
        const job = jobs.find((j) => j.state === "processing");
        claimedLeaseUntil = job?.leaseUntil ?? 0;
        claimedAt = job?.claimedAt ?? 0;
        // Hang until lease expires
        await new Promise<void>((resolve) => setTimeout(resolve, TIMEOUT_MS + 200));
      },
    });

    const before = Date.now();
    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    await waitFor(async () => claimedAt > 0);

    expect(claimedAt).toBeGreaterThanOrEqual(before);
    expect(claimedLeaseUntil).toBeGreaterThan(claimedAt);
    expect(claimedLeaseUntil - claimedAt).toBeCloseTo(TIMEOUT_MS, -2); // within 100ms
  });

  it("claimedAt is null for queued jobs and set when claimed", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    // Enqueue without starting the processor so jobs stay queued
    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    const jobs = await queue.listLiveJobsForTest();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].claimedAt).toBeNull();
    expect(jobs[0].state).toBe("queued");
  });

  it("sets claimedAt and visibilityTimeoutMs on the job when claimed", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const TIMEOUT_MS = 500;
    let capturedClaimedAt: number | null = null;
    let capturedVisibilityTimeoutMs: number | null = null;

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      visibilityTimeoutMs: TIMEOUT_MS,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        const jobs = await queue.listLiveJobsForTest();
        const job = jobs.find((j) => j.state === "processing");
        capturedClaimedAt = job?.claimedAt ?? null;
        capturedVisibilityTimeoutMs = job?.visibilityTimeoutMs ?? null;
      },
    });

    const beforeEnqueue = Date.now();
    await queue.enqueue({
      channelId: "c1",
      messageId: "m2",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m2" } },
    });

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    expect(capturedClaimedAt).not.toBeNull();
    expect(capturedClaimedAt).toBeGreaterThanOrEqual(beforeEnqueue);
    expect(capturedVisibilityTimeoutMs).toBe(TIMEOUT_MS);
  });

  it("job is deleted after successful completion (not just after visibility timeout)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      visibilityTimeoutMs: 60_000,
      backoffMs: () => 0,
    });

    await queue.start({ process: async () => {} });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m-complete",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m-complete" } },
    });

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    // Job should be fully deleted — not just lease-expired
    const jobs = await queue.listLiveJobsForTest();
    expect(jobs).toHaveLength(0);
  });

  it("expired visibility timeout causes job to be re-enqueued for reprocessing", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Write a pre-expired in-flight job directly (simulates a crash mid-processing)
    const queueDir = path.join(stateDir, "discord-inbound-queue", "default");
    await fs.promises.mkdir(queueDir, { recursive: true });
    const now = Date.now();
    await fs.promises.writeFile(
      path.join(queueDir, "crashed-job.json"),
      JSON.stringify({
        id: "crashed-job",
        dedupeKey: "default:c1:c1:m-crash",
        state: "processing",
        enqueuedAt: now - 400_000,
        updatedAt: now - 350_000,
        claimedAt: now - 350_000,
        leaseUntil: now - 50_000, // expired 50s ago
        visibilityTimeoutMs: 300_000,
        attempts: 0,
        nextAttemptAt: now - 400_000,
        event: {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m-crash",
          payload: { channel_id: "c1", message: { id: "m-crash" } },
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

    await waitFor(async () => processed.includes("m-crash"));

    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(processed).toEqual(["m-crash"]);
  });

  it("message is NOT deleted on timeout — only on explicit completion", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Controllable deferred: first call hangs, second succeeds
    const firstCallDone = { value: false };
    let processCallCount = 0;

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      visibilityTimeoutMs: 200,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async () => {
        processCallCount += 1;
        if (processCallCount === 1) {
          // Simulate a long run that outlasts the visibility timeout
          await new Promise<void>((resolve) => setTimeout(resolve, 400));
          firstCallDone.value = true;
          // After returning, the job should NOT be deleted since the lease expired.
          // The durable queue will have already re-queued it.
        }
        // Second call completes immediately — job is deleted.
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m-timeout-job",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m-timeout-job" } },
    });

    // Wait for the second process call (recovery after lease expiry)
    await waitFor(async () => processCallCount >= 2, 3_000);

    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(processCallCount).toBeGreaterThanOrEqual(2);
  });

  it("default visibilityTimeoutMs is 5 minutes (300000ms)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    let capturedVisibilityTimeoutMs: number | null = null;

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
      // No visibilityTimeoutMs or leaseMs — should default to 300_000
    });

    await queue.start({
      process: async () => {
        const jobs = await queue.listLiveJobsForTest();
        const job = jobs.find((j) => j.state === "processing");
        capturedVisibilityTimeoutMs = job?.visibilityTimeoutMs ?? null;
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m-default",
      orderingKey: "c1",
      payload: { channel_id: "c1", message: { id: "m-default" } },
    });

    await waitFor(async () => capturedVisibilityTimeoutMs !== null);
    expect(capturedVisibilityTimeoutMs).toBe(300_000);
  });

  it("recoverExpiredLeases resets claimedAt to null on recovered jobs", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "discord-inbound-queue", "default");
    await fs.promises.mkdir(queueDir, { recursive: true });
    const ts = Date.now();

    await fs.promises.writeFile(
      path.join(queueDir, "expired-job.json"),
      JSON.stringify({
        id: "expired-job",
        dedupeKey: "default:c1:c1:m-exp",
        state: "processing",
        enqueuedAt: ts - 600_000,
        updatedAt: ts - 300_000,
        claimedAt: ts - 300_000,
        leaseUntil: ts - 1_000, // expired 1s ago
        visibilityTimeoutMs: 300_000,
        attempts: 0,
        nextAttemptAt: ts - 600_000,
        event: {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m-exp",
          payload: { channel_id: "c1", message: { id: "m-exp" } },
        },
      }),
      "utf-8",
    );

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    const recovered = await queue.recoverExpiredLeases();
    expect(recovered).toBe(1);

    const jobs = await queue.listLiveJobsForTest();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state).toBe("queued");
    expect(jobs[0].claimedAt).toBeNull();
    expect(jobs[0].leaseUntil).toBeNull();

    // Cleanup: stop without starting so no further processing happens
    await queue.stop();
  });
});
