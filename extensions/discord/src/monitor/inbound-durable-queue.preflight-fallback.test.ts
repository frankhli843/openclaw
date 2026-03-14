import fs from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Test: when the batch processor throws COALESCE_PREFLIGHT_REJECTED,
 * the durable queue falls back to processing each message individually.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiscordInboundDurableQueue } from "./inbound-durable-queue.js";

describe("durable queue: preflight rejection fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durable-queue-preflight-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("falls back to individual processing when batch processor throws COALESCE_PREFLIGHT_REJECTED", async () => {
    const processedMessages: string[] = [];
    const batchAttempts: number[] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
    });

    // Enqueue messages BEFORE starting processor so they batch together
    await queue.enqueue({
      channelId: "ch1",
      messageId: "msg1",
      orderingKey: "ch1",
      payload: { message: { id: "msg1", content: "first" } },
    });
    await queue.enqueue({
      channelId: "ch1",
      messageId: "msg2",
      orderingKey: "ch1",
      payload: { message: { id: "msg2", content: "second" } },
    });
    await queue.enqueue({
      channelId: "ch1",
      messageId: "msg3",
      orderingKey: "ch1",
      payload: { message: { id: "msg3", content: "third" } },
    });

    // Now start the processor — all 3 are queued, will be claimed as one batch
    await queue.start({
      process: async (event) => {
        processedMessages.push(event.messageId);
      },
      processBatch: async (events) => {
        batchAttempts.push(events.length);
        const err = new Error("COALESCE_PREFLIGHT_REJECTED") as Error & { code: string };
        err.code = "COALESCE_PREFLIGHT_REJECTED";
        throw err;
      },
    });

    await new Promise((r) => setTimeout(r, 300));

    // Batch processor should have been called with all 3
    expect(batchAttempts).toEqual([3]);
    // Fallback should have processed each individually
    expect(processedMessages.toSorted()).toEqual(["msg1", "msg2", "msg3"]);

    await queue.stop();
  });

  it("does NOT fall back for other errors (normal retry/backoff)", async () => {
    const processedMessages: string[] = [];
    let batchCallCount = 0;

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxAttempts: 2,
      backoffMs: () => 50,
    });

    // Enqueue before starting
    await queue.enqueue({
      channelId: "ch1",
      messageId: "msg1",
      orderingKey: "ch1",
      payload: { message: { id: "msg1", content: "first" } },
    });
    await queue.enqueue({
      channelId: "ch1",
      messageId: "msg2",
      orderingKey: "ch1",
      payload: { message: { id: "msg2", content: "second" } },
    });

    await queue.start({
      process: async (event) => {
        processedMessages.push(event.messageId);
      },
      processBatch: async () => {
        batchCallCount++;
        throw new Error("some transient failure");
      },
    });

    await new Promise((r) => setTimeout(r, 500));

    // Regular errors should NOT fall back to individual processing
    expect(processedMessages).toHaveLength(0);
    // Should have retried
    expect(batchCallCount).toBeGreaterThanOrEqual(2);

    await queue.stop();
  });

  it("real-world: first msg solo, follow-ups batch-rejected then individually processed", async () => {
    const processedMessages: string[] = [];
    let batchRejections = 0;

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
    });

    await queue.start({
      process: async (event) => {
        processedMessages.push(event.messageId);
        // First message takes time (simulates agent processing)
        if (event.messageId === "msg1") {
          await new Promise((r) => setTimeout(r, 100));
        }
      },
      processBatch: async () => {
        batchRejections++;
        const err = new Error("COALESCE_PREFLIGHT_REJECTED") as Error & { code: string };
        err.code = "COALESCE_PREFLIGHT_REJECTED";
        throw err;
      },
    });

    // First message arrives alone
    await queue.enqueue({
      channelId: "thread1",
      messageId: "msg1",
      orderingKey: "thread1",
      payload: { message: { id: "msg1", content: "Does wwsai ai know the skill exists?" } },
    });

    // Wait for first message to start processing
    await new Promise((r) => setTimeout(r, 50));

    // Follow-ups arrive while agent is busy
    await queue.enqueue({
      channelId: "thread1",
      messageId: "msg2",
      orderingKey: "thread1",
      payload: { message: { id: "msg2", content: "Does it require any other skills?" } },
    });
    await queue.enqueue({
      channelId: "thread1",
      messageId: "msg3",
      orderingKey: "thread1",
      payload: { message: { id: "msg3", content: "Of course it shouldn't be SSH" } },
    });

    await new Promise((r) => setTimeout(r, 500));

    // msg1 processed individually (batch size 1 → processOne)
    // msg2+msg3 batch rejected → fall back to individual
    expect(processedMessages).toContain("msg1");
    expect(processedMessages).toContain("msg2");
    expect(processedMessages).toContain("msg3");
    expect(processedMessages).toHaveLength(3);
    expect(batchRejections).toBe(1);

    await queue.stop();
  });
});
