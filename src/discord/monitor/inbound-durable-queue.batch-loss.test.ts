/**
 * Test suite: Durable queue — messages lost during batch processing
 *
 * Tests the scenario Frank described: sending multiple messages while the
 * agent is busy, where batching works but the agent ignores some messages.
 *
 * Tests the full durable queue lifecycle: enqueue → drain → batch claim →
 * coalesced processing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiscordInboundDurableQueue,
  type DurableDiscordInboundEvent,
} from "./inbound-durable-queue.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-queue-batch-loss-"));
}

function makeEvent(
  id: string,
  content: string,
  channelId = "ch1",
): {
  channelId: string;
  messageId: string;
  orderingKey: string;
  payload: unknown;
} {
  return {
    channelId,
    messageId: id,
    orderingKey: channelId,
    payload: {
      message: {
        id,
        content,
        mentionedUsers: [],
        attachments: [],
        timestamp: new Date().toISOString(),
      },
      author: { id: "user1", username: "Frank", globalName: "Frank" },
    },
  };
}

describe("durable queue batch loss scenarios", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("messages enqueued while processing are claimed in the next batch", async () => {
    /**
     * Scenario:
     * 1. Message A is enqueued and starts processing
     * 2. While A processes, messages B and C are enqueued
     * 3. After A finishes, B and C should be claimed as a batch
     */
    const processedEvents: DurableDiscordInboundEvent[][] = [];
    let resolveFirstProcessing: (() => void) | null = null;
    const firstProcessingPromise = new Promise<void>((resolve) => {
      resolveFirstProcessing = resolve;
    });

    let processCallCount = 0;
    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      now: () => Date.now(),
    });

    await queue.start({
      process: async (event) => {
        processCallCount++;
        processedEvents.push([event]);
        if (processCallCount === 1) {
          // First message: block processing while more messages arrive
          await firstProcessingPromise;
        }
      },
      processBatch: async (events) => {
        processedEvents.push(events);
      },
    });

    // Enqueue first message — starts processing immediately
    await queue.enqueue(makeEvent("m1", "request A"));
    // Wait a tick for drain to start
    await new Promise((r) => setTimeout(r, 50));

    // Enqueue two more while first is processing
    await queue.enqueue(makeEvent("m2", "request B"));
    await queue.enqueue(makeEvent("m3", "request C"));

    // Let first message finish
    resolveFirstProcessing!();
    // Wait for drain to process the batch
    await new Promise((r) => setTimeout(r, 200));

    await queue.stop();

    // First message processed individually
    expect(processedEvents[0]).toHaveLength(1);
    expect(processedEvents[0][0].messageId).toBe("m1");

    // Second batch should contain BOTH B and C
    expect(processedEvents.length).toBeGreaterThanOrEqual(2);
    const secondBatch = processedEvents[1];
    expect(secondBatch).toHaveLength(2);
    const messageIds = secondBatch.map((e) => e.messageId);
    expect(messageIds).toContain("m2");
    expect(messageIds).toContain("m3");
  });

  it("no messages are lost when many arrive during processing", async () => {
    /**
     * Stress test: enqueue 10 messages while the agent processes the first one.
     * ALL messages should eventually be processed.
     */
    const allProcessedMessageIds: string[] = [];
    let resolveBlock: (() => void) | null = null;
    const blockPromise = new Promise<void>((resolve) => {
      resolveBlock = resolve;
    });
    let firstCall = true;

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      now: () => Date.now(),
    });

    await queue.start({
      process: async (event) => {
        if (firstCall) {
          firstCall = false;
          await blockPromise;
        }
        allProcessedMessageIds.push(event.messageId);
      },
      processBatch: async (events) => {
        for (const e of events) {
          allProcessedMessageIds.push(e.messageId);
        }
      },
    });

    // First message
    await queue.enqueue(makeEvent("m0", "first request"));
    await new Promise((r) => setTimeout(r, 50));

    // Enqueue 10 more while first is processing
    for (let i = 1; i <= 10; i++) {
      await queue.enqueue(makeEvent(`m${i}`, `request ${i}`));
    }

    // Unblock
    resolveBlock!();
    await new Promise((r) => setTimeout(r, 500));

    await queue.stop();

    // ALL 11 messages should have been processed
    expect(allProcessedMessageIds).toHaveLength(11);
    for (let i = 0; i <= 10; i++) {
      expect(allProcessedMessageIds).toContain(`m${i}`);
    }
  });

  it("batch processor failure retries ALL messages in the batch", async () => {
    /**
     * When batch processing fails, all messages should be retried.
     * No message should be silently dropped due to batch failure.
     */
    let attempt = 0;
    const processedBatches: DurableDiscordInboundEvent[][] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxAttempts: 3,
      backoffMs: () => 10, // fast backoff for testing
      now: () => Date.now(),
    });

    await queue.start({
      process: async (event) => {
        processedBatches.push([event]);
      },
      processBatch: async (events) => {
        attempt++;
        if (attempt === 1) {
          throw new Error("transient failure");
        }
        processedBatches.push(events);
      },
    });

    // Enqueue messages that will be batched
    await queue.enqueue(makeEvent("m1", "task A"));
    await queue.enqueue(makeEvent("m2", "task B"));
    await new Promise((r) => setTimeout(r, 100));

    // Wait for retry
    await new Promise((r) => setTimeout(r, 500));

    await queue.stop();

    // After the failed attempt, messages should be retried
    // and eventually processed successfully
    const allProcessedIds = processedBatches.flatMap((batch) => batch.map((e) => e.messageId));

    expect(allProcessedIds).toContain("m1");
    expect(allProcessedIds).toContain("m2");
  });

  it("messages arriving between drain iterations are not lost", async () => {
    /**
     * Race condition test:
     * 1. Drain loop processes batch A
     * 2. Drain loop calls claimBatch() → returns empty
     * 3. Just before drain finishes, message D is enqueued
     * 4. D should be picked up by the next drain cycle (via scheduleNextWake)
     */
    const processedIds: string[] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      now: () => Date.now(),
    });

    await queue.start({
      process: async (event) => {
        processedIds.push(event.messageId);
        // Simulate some processing time
        await new Promise((r) => setTimeout(r, 50));
      },
      processBatch: async (events) => {
        for (const e of events) {
          processedIds.push(e.messageId);
        }
      },
    });

    // First message
    await queue.enqueue(makeEvent("m1", "first"));
    await new Promise((r) => setTimeout(r, 100));

    // Second message after first completes
    await queue.enqueue(makeEvent("m2", "second"));
    await new Promise((r) => setTimeout(r, 200));

    // Third message
    await queue.enqueue(makeEvent("m3", "third"));
    await new Promise((r) => setTimeout(r, 200));

    await queue.stop();

    expect(processedIds).toContain("m1");
    expect(processedIds).toContain("m2");
    expect(processedIds).toContain("m3");
  });
});
