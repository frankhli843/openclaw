import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInboundDurableQueue,
  type DurableInboundEvent,
} from "./inbound-durable-queue.frankclaw.js";

describe("createInboundDurableQueue", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbound-durable-queue-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("enqueues a job and persists it to disk", async () => {
    const queue = createInboundDurableQueue({
      channel: "whatsapp",
      accountId: "test-account",
      stateDir: tmpDir,
    });

    const result = await queue.enqueue({
      orderingKey: "chat-1",
      externalId: "msg-1",
      payload: { text: "hello" },
    });

    expect(result.enqueued).toBe(true);
    expect(result.dedupeKey).toBe("whatsapp:test-account:chat-1:msg-1");
    expect(result.jobId).toBeDefined();

    const queueDir = path.join(tmpDir, "inbound-durable-queue", "whatsapp", "test-account");
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
  });

  it("dedupes identical externalId enqueues", async () => {
    const queue = createInboundDurableQueue({
      channel: "telegram",
      accountId: "test",
      stateDir: tmpDir,
    });
    const first = await queue.enqueue({
      orderingKey: "chat-1",
      externalId: "msg-1",
      payload: { a: 1 },
    });
    const second = await queue.enqueue({
      orderingKey: "chat-1",
      externalId: "msg-1",
      payload: { a: 2 },
    });
    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
    expect(second.dedupeKey).toBe(first.dedupeKey);
  });

  it("processes a single queued event end to end", async () => {
    const queue = createInboundDurableQueue({
      channel: "whatsapp",
      accountId: "ok",
      stateDir: tmpDir,
      visibilityTimeoutMs: 1_000,
    });
    const seen: DurableInboundEvent[] = [];
    await queue.start({
      process: async (event) => {
        seen.push(event);
      },
    });
    await queue.enqueue({
      orderingKey: "ok",
      externalId: "msg-1",
      payload: { hi: true },
    });
    // Allow the async drain to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    await queue.stop();
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toEqual({ hi: true });
    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
  });

  it("retries on failure and dead-letters after maxAttempts", async () => {
    const queue = createInboundDurableQueue({
      channel: "whatsapp",
      accountId: "fail",
      stateDir: tmpDir,
      maxAttempts: 2,
      visibilityTimeoutMs: 200,
      backoffMs: () => 1, // near-zero backoff for fast test
    });

    let attempts = 0;
    const deadLettered: DurableInboundEvent[] = [];
    await queue.start({
      process: async (event) => {
        attempts += 1;
        throw new Error(`boom #${event.externalId}`);
      },
    });
    // Set up onDeadLetter via re-creating? Actually we have to pass it in options.
    // The current test uses no onDeadLetter; re-do:
    await queue.stop();

    const queue2 = createInboundDurableQueue({
      channel: "whatsapp",
      accountId: "fail2",
      stateDir: tmpDir,
      maxAttempts: 2,
      visibilityTimeoutMs: 200,
      backoffMs: () => 1,
      onDeadLetter: (event) => {
        deadLettered.push(event);
      },
    });
    await queue2.start({
      process: async (event) => {
        attempts += 1;
        throw new Error(`boom #${event.externalId}`);
      },
    });
    await queue2.enqueue({
      orderingKey: "dl",
      externalId: "m",
      payload: { x: 1 },
    });
    // Wait for retries to exhaust
    await new Promise((resolve) => setTimeout(resolve, 200));
    await queue2.stop();
    expect(deadLettered.length).toBe(1);
    expect(deadLettered[0].externalId).toBe("m");
    const stats = await queue2.getStats();
    expect(stats.dead).toBe(1);
  });

  it("recovers expired leases on restart", async () => {
    const queue1 = createInboundDurableQueue({
      channel: "telegram",
      accountId: "lease",
      stateDir: tmpDir,
      visibilityTimeoutMs: 5_000,
    });
    // Manually enqueue a job and let it claim, then stop without processing.
    let processStarted = false;
    const releaseRef: { fn: (() => void) | null } = { fn: null };
    await queue1.start({
      process: async () => {
        processStarted = true;
        await new Promise<void>((resolve) => {
          releaseRef.fn = resolve;
        });
      },
    });
    await queue1.enqueue({
      orderingKey: "k",
      externalId: "id",
      payload: {},
    });
    // Wait for claim
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(processStarted).toBe(true);
    // Simulate process death by stopping queue without releasing the job.
    await queue1.stop();
    // (Release the dangling promise to avoid lingering work.)
    releaseRef.fn?.();

    // Inspect on-disk state — the job should still be `processing`.
    const queueDir = path.join(tmpDir, "inbound-durable-queue", "telegram", "lease");
    const files = fs.readdirSync(queueDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const persistedJob = JSON.parse(fs.readFileSync(path.join(queueDir, files[0]), "utf-8"));
    expect(persistedJob.state).toBe("processing");

    // New queue startup should reclaim the orphaned in-flight job.
    let secondAttemptDone = false;
    const queue2 = createInboundDurableQueue({
      channel: "telegram",
      accountId: "lease",
      stateDir: tmpDir,
      visibilityTimeoutMs: 5_000,
    });
    await queue2.start({
      process: async () => {
        secondAttemptDone = true;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await queue2.stop();
    expect(secondAttemptDone).toBe(true);
  });
});
