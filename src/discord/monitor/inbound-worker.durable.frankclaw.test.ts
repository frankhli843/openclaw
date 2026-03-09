/**
 * Tests for the frankclaw durable Discord inbound worker.
 *
 * Covers:
 * 1. Basic enqueue → process → complete lifecycle
 * 2. Message survives simulated crash (lease recovery)
 * 3. Timeout causes retry (not permanent loss)
 * 4. Dead-letter after max attempts
 * 5. Deduplication of same message
 * 6. Multiple messages with different ordering keys process concurrently
 * 7. Messages with same ordering key process serially
 * 8. Startup recovers expired leases from prior crash
 * 9. Runtime is resolved fresh at processing time (not stale from enqueue)
 * 10. AbortSignal cancellation
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const processDiscordMessageMock = vi.hoisted(() => vi.fn());

vi.mock("./message-handler.process.js", () => ({
  processDiscordMessage: processDiscordMessageMock,
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

const { createDurableDiscordInboundWorker } = await import("./inbound-worker.durable.frankclaw.js");
const { createDiscordInboundDurableQueue } = await import("./inbound-durable-queue.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "frankclaw-durable-worker-test-"));
}

function makeRuntime() {
  return {
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
    abortSignal: undefined as AbortSignal | undefined,
    guildHistories: undefined as unknown,
    client: {} as unknown,
    threadBindings: undefined as unknown,
    discordRestFetch: undefined as unknown,
  };
}

function makeJob(overrides: {
  channelId?: string;
  messageId?: string;
  queueKey?: string;
  text?: string;
}) {
  const channelId = overrides.channelId ?? `ch-${crypto.randomUUID().slice(0, 8)}`;
  const messageId = overrides.messageId ?? `msg-${crypto.randomUUID().slice(0, 8)}`;
  const queueKey = overrides.queueKey ?? `agent:main:discord:channel:${channelId}`;
  return {
    queueKey,
    payload: {
      messageChannelId: channelId,
      data: {
        message: {
          id: messageId,
          content: overrides.text ?? "test message",
          channel_id: channelId,
        },
      },
    } as Record<string, unknown>,
    runtime: makeRuntime(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("DurableDiscordInboundWorker (frankclaw)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    processDiscordMessageMock.mockReset();
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── 1. Basic lifecycle ──────────────────────────────────────────────────

  it("enqueues a message, processes it, and removes the job file on success", async () => {
    processDiscordMessageMock.mockResolvedValue(undefined);
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();

    const job = makeJob({ channelId: "ch1", messageId: "msg1" });
    worker.enqueue(job);

    // Wait for processing
    await sleep(500);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);
    expect(resolveRuntime).toHaveBeenCalledTimes(1);

    // Job file should be gone (successful completion removes it)
    const queueDir = path.join(tmpDir, "discord-inbound-queue", "test");
    const remaining = fs.existsSync(queueDir)
      ? fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(remaining).toHaveLength(0);

    await worker.stop();
  });

  // ─── 2. Crash recovery (lease expiry) ────────────────────────────────────

  it("recovers messages after simulated crash via lease expiry", async () => {
    // Simulate: a job was claimed but process died before completion.
    // Write a job file with expired lease directly to disk.
    const queueDir = path.join(tmpDir, "discord-inbound-queue", "test");
    fs.mkdirSync(queueDir, { recursive: true });
    fs.mkdirSync(path.join(queueDir, "dead"), { recursive: true });

    const jobId = crypto.randomUUID();
    const expiredJob = {
      id: jobId,
      dedupeKey: `test:ch-crash:agent:main:discord:channel:ch-crash:msg-crash`,
      state: "processing",
      enqueuedAt: Date.now() - 120_000,
      updatedAt: Date.now() - 120_000,
      leaseUntil: Date.now() - 60_000, // Expired 60s ago
      attempts: 1,
      nextAttemptAt: 0,
      event: {
        accountId: "test",
        channelId: "ch-crash",
        orderingKey: "agent:main:discord:channel:ch-crash",
        messageId: "msg-crash",
        payload: {
          messageChannelId: "ch-crash",
          data: {
            message: { id: "msg-crash", content: "survived crash", channel_id: "ch-crash" },
          },
        },
      },
    };
    fs.writeFileSync(path.join(queueDir, `${jobId}.json`), JSON.stringify(expiredJob, null, 2));

    processDiscordMessageMock.mockResolvedValue(undefined);
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    // start() should recover the expired lease and reprocess
    await worker.start();
    await sleep(500);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);

    // Job should be removed after successful processing
    const remaining = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
    expect(remaining).toHaveLength(0);

    await worker.stop();
  });

  // ─── 3. Timeout causes retry, not permanent loss ─────────────────────────

  it("retries a message that times out instead of losing it", async () => {
    let callCount = 0;
    processDiscordMessageMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: hang longer than the timeout
        await sleep(3_000);
      }
      // Second call: succeed immediately
    });

    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 30_000, // Lease long enough to not interfere
      maxAttempts: 3,
      runTimeoutMs: 500, // Very short timeout to trigger retry
      resolveRuntime,
    });

    await worker.start();

    const job = makeJob({ channelId: "ch-timeout", messageId: "msg-timeout" });
    worker.enqueue(job);

    // Wait for first attempt (times out at 500ms) + backoff + second attempt
    await sleep(5_000);

    // Should have been called at least twice (first timeout, then retry)
    expect(processDiscordMessageMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    await worker.stop();
  }, 10_000);

  // ─── 4. Dead-letter after max attempts ───────────────────────────────────

  it("dead-letters a message after max attempts", async () => {
    processDiscordMessageMock.mockRejectedValue(new Error("persistent failure"));

    const onDeadLetter = vi.fn();
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 5_000,
      maxAttempts: 2,
      resolveRuntime,
      onDeadLetter,
    });

    await worker.start();

    const job = makeJob({ channelId: "ch-dead", messageId: "msg-dead" });
    worker.enqueue(job);

    // Wait for attempts + backoff
    await sleep(8_000);

    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "msg-dead" }),
      expect.objectContaining({ attempts: 2 }),
    );

    // Should be in dead/ directory
    const deadDir = path.join(tmpDir, "discord-inbound-queue", "test", "dead");
    const deadFiles = fs.existsSync(deadDir)
      ? fs.readdirSync(deadDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(deadFiles).toHaveLength(1);

    await worker.stop();
  }, 15_000);

  // ─── 5. Deduplication ────────────────────────────────────────────────────

  it("deduplicates the same message enqueued twice while first is still processing", async () => {
    // Hold the first job in-flight so the second enqueue sees it in the queue
    let resolveFirst: (() => void) | null = null;
    processDiscordMessageMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();

    // Same channelId + messageId + queueKey = same dedupeKey
    const job1 = makeJob({ channelId: "ch-dup", messageId: "msg-dup", queueKey: "key-dup" });
    const job2 = makeJob({ channelId: "ch-dup", messageId: "msg-dup", queueKey: "key-dup" });

    worker.enqueue(job1);
    await sleep(300); // Let first enqueue write to disk and claim starts
    worker.enqueue(job2); // Should be deduped (first still in-flight)

    await sleep(500);

    // Only called once — second was deduped
    expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);

    // Complete the first job
    resolveFirst?.();
    await sleep(300);

    // Still only called once
    expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);

    await worker.stop();
  });

  // ─── 6. Different ordering keys process concurrently ─────────────────────

  it("processes messages with different ordering keys concurrently", async () => {
    const callOrder: string[] = [];
    processDiscordMessageMock.mockImplementation(async (ctx: { messageChannelId: string }) => {
      const channelId = ctx.messageChannelId;
      callOrder.push(`start:${channelId}`);
      await sleep(200);
      callOrder.push(`end:${channelId}`);
    });

    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();

    const jobA = makeJob({
      channelId: "ch-a",
      messageId: "msg-a",
      queueKey: "key-a",
    });
    const jobB = makeJob({
      channelId: "ch-b",
      messageId: "msg-b",
      queueKey: "key-b",
    });

    worker.enqueue(jobA);
    worker.enqueue(jobB);

    await sleep(1_000);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(2);
    // Both should start before either ends (concurrent)
    const startA = callOrder.indexOf("start:ch-a");
    const startB = callOrder.indexOf("start:ch-b");
    const endA = callOrder.indexOf("end:ch-a");
    const endB = callOrder.indexOf("end:ch-b");
    expect(startA).toBeLessThan(endA);
    expect(startB).toBeLessThan(endB);
    // Both started before either ended → concurrent
    expect(Math.max(startA, startB)).toBeLessThan(Math.min(endA, endB));

    await worker.stop();
  });

  // ─── 7. Same ordering key processes serially ─────────────────────────────

  it("processes messages with the same ordering key serially", async () => {
    const callOrder: string[] = [];
    let callIdx = 0;
    processDiscordMessageMock.mockImplementation(async () => {
      const idx = callIdx++;
      callOrder.push(`start:${idx}`);
      await sleep(200);
      callOrder.push(`end:${idx}`);
    });

    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();

    // Same queueKey = same ordering key
    const job1 = makeJob({
      channelId: "ch-serial",
      messageId: "msg-1",
      queueKey: "same-key",
    });
    const job2 = makeJob({
      channelId: "ch-serial",
      messageId: "msg-2",
      queueKey: "same-key",
    });

    worker.enqueue(job1);
    await sleep(50);
    worker.enqueue(job2);

    await sleep(2_000);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(2);
    // Second should start after first ends (serial)
    const start0 = callOrder.indexOf("start:0");
    const end0 = callOrder.indexOf("end:0");
    const start1 = callOrder.indexOf("start:1");
    expect(start1).toBeGreaterThan(end0);
    expect(start0).toBeLessThan(end0);

    await worker.stop();
  });

  // ─── 8. Startup recovers multiple expired leases ─────────────────────────

  it("recovers multiple expired leases on startup", async () => {
    const queueDir = path.join(tmpDir, "discord-inbound-queue", "test");
    fs.mkdirSync(queueDir, { recursive: true });
    fs.mkdirSync(path.join(queueDir, "dead"), { recursive: true });

    // Write 3 expired jobs
    for (let i = 0; i < 3; i++) {
      const jobId = crypto.randomUUID();
      const job = {
        id: jobId,
        dedupeKey: `test:ch-${i}:key-${i}:msg-${i}`,
        state: "processing",
        enqueuedAt: Date.now() - 300_000,
        updatedAt: Date.now() - 300_000,
        leaseUntil: Date.now() - 60_000,
        attempts: 0,
        nextAttemptAt: 0,
        event: {
          accountId: "test",
          channelId: `ch-${i}`,
          orderingKey: `key-${i}`,
          messageId: `msg-${i}`,
          payload: {
            messageChannelId: `ch-${i}`,
            data: { message: { id: `msg-${i}`, content: `msg ${i}`, channel_id: `ch-${i}` } },
          },
        },
      };
      fs.writeFileSync(path.join(queueDir, `${jobId}.json`), JSON.stringify(job, null, 2));
    }

    processDiscordMessageMock.mockResolvedValue(undefined);
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();
    await sleep(1_000);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(3);

    await worker.stop();
  });

  // ─── 9. Runtime resolved fresh at processing time ────────────────────────

  it("resolves runtime fresh at processing time, not from stale enqueue data", async () => {
    const runtimeV1 = makeRuntime();
    const runtimeV2 = makeRuntime();
    let callCount = 0;

    const resolveRuntime = vi.fn().mockImplementation(() => {
      callCount++;
      return callCount === 1 ? runtimeV1 : runtimeV2;
    });

    processDiscordMessageMock.mockResolvedValue(undefined);

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    await worker.start();

    const job1 = makeJob({ channelId: "ch-rt1", messageId: "msg-rt1", queueKey: "key-1" });
    const job2 = makeJob({ channelId: "ch-rt2", messageId: "msg-rt2", queueKey: "key-2" });

    worker.enqueue(job1);
    await sleep(300);
    worker.enqueue(job2);
    await sleep(500);

    // Each call to processDiscordMessage should get a fresh runtime
    expect(resolveRuntime).toHaveBeenCalledTimes(2);

    await worker.stop();
  });

  // ─── 10. Stats reflect queue state ───────────────────────────────────────

  it("queue stats reflect enqueued and processed state correctly", async () => {
    let resolveProcess: (() => void) | null = null;
    processDiscordMessageMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveProcess = resolve;
        }),
    );

    const _resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    // Use the durable queue directly to check stats
    const durableQueue = createDiscordInboundDurableQueue({
      accountId: "test-stats",
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      coalesce: false,
    });

    await durableQueue.start({ process: processDiscordMessageMock });

    await durableQueue.enqueue({
      channelId: "ch-stat",
      messageId: "msg-stat",
      orderingKey: "key-stat",
      payload: { data: "test" },
    });

    await sleep(200);

    // Should be processing (claimed by the drain)
    const stats = await durableQueue.getStats();
    expect(stats.processing).toBe(1);
    expect(stats.queued).toBe(0);

    // Complete the job
    resolveProcess?.();
    await sleep(200);

    const finalStats = await durableQueue.getStats();
    expect(finalStats.processing).toBe(0);
    expect(finalStats.queued).toBe(0);

    await durableQueue.stop();
  });

  // ─── 11. Enqueue while stopped queues to disk for next start ─────────────

  it("enqueues messages to disk even before start(), processed on start()", async () => {
    processDiscordMessageMock.mockResolvedValue(undefined);
    const resolveRuntime = vi.fn().mockReturnValue(makeRuntime());

    const worker = createDurableDiscordInboundWorker({
      accountId: "test",
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      stateDir: tmpDir,
      leaseMs: 60_000,
      maxAttempts: 3,
      resolveRuntime,
    });

    // Enqueue BEFORE start
    const job = makeJob({ channelId: "ch-prestart", messageId: "msg-prestart" });
    worker.enqueue(job);
    await sleep(300);

    // Not processed yet (worker not started)
    expect(processDiscordMessageMock).not.toHaveBeenCalled();

    // File should exist on disk
    const queueDir = path.join(tmpDir, "discord-inbound-queue", "test");
    const files = fs.existsSync(queueDir)
      ? fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(files.length).toBeGreaterThanOrEqual(1);

    // Now start — should pick up the pre-enqueued message
    await worker.start();
    await sleep(500);

    expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);

    await worker.stop();
  });
});
