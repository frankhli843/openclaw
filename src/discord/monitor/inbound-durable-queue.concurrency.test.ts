/**
 * Test suite: Concurrent drain across multiple ordering keys
 *
 * Verifies the fix for the drain starvation bug where one slow LLM call
 * on ordering key A would block all other ordering keys from processing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiscordInboundDurableQueue } from "./inbound-durable-queue.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-queue-concurrency-"));
}

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
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

describe("durable queue concurrency", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("processes multiple ordering keys concurrently", async () => {
    /**
     * Core starvation fix test:
     * - Enqueue messages for 3 different ordering keys
     * - Make each processor take some time
     * - Verify all 3 are being processed at the same time (concurrently)
     */
    let peakConcurrent = 0;
    let currentConcurrent = 0;
    const processedKeys: string[] = [];
    const resolvers: Map<string, () => void> = new Map();

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxConcurrent: 4,
    });

    await queue.start({
      process: async (event) => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        // Wait until explicitly resolved
        await new Promise<void>((resolve) => {
          resolvers.set(event.orderingKey, resolve);
        });
        processedKeys.push(event.orderingKey);
        currentConcurrent--;
      },
    });

    // Enqueue messages for 3 different ordering keys
    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "key-A",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });
    await queue.enqueue({
      channelId: "c2",
      messageId: "m2",
      orderingKey: "key-B",
      payload: { channel_id: "c2", message: { id: "m2" } },
    });
    await queue.enqueue({
      channelId: "c3",
      messageId: "m3",
      orderingKey: "key-C",
      payload: { channel_id: "c3", message: { id: "m3" } },
    });

    // Wait for all 3 to be in-flight concurrently
    await waitFor(() => currentConcurrent === 3);
    expect(peakConcurrent).toBe(3);

    // Release them
    resolvers.get("key-A")?.();
    resolvers.get("key-B")?.();
    resolvers.get("key-C")?.();

    await waitFor(() => processedKeys.length === 3);
    await queue.stop();

    expect(processedKeys).toContain("key-A");
    expect(processedKeys).toContain("key-B");
    expect(processedKeys).toContain("key-C");
  });

  it("same ordering key is still serialized (not processed in parallel)", async () => {
    /**
     * Messages with the same ordering key must still be processed one at a time.
     * The lockedByOrdering check prevents double-processing.
     */
    let maxConcurrentSameKey = 0;
    let currentSameKey = 0;
    const processOrder: string[] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: false, // Disable coalescing so each message is processed individually
      maxConcurrent: 4,
    });

    await queue.start({
      process: async (event) => {
        currentSameKey++;
        maxConcurrentSameKey = Math.max(maxConcurrentSameKey, currentSameKey);
        processOrder.push(event.messageId);
        // Small delay to allow overlap if serialization is broken
        await new Promise((r) => setTimeout(r, 50));
        currentSameKey--;
      },
    });

    // Enqueue 3 messages all with the same ordering key
    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "same-key",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });
    await queue.enqueue({
      channelId: "c1",
      messageId: "m2",
      orderingKey: "same-key",
      payload: { channel_id: "c1", message: { id: "m2" } },
    });
    await queue.enqueue({
      channelId: "c1",
      messageId: "m3",
      orderingKey: "same-key",
      payload: { channel_id: "c1", message: { id: "m3" } },
    });

    await waitFor(() => processOrder.length === 3, 5_000);
    await queue.stop();

    // Should never have more than 1 concurrent for the same ordering key
    expect(maxConcurrentSameKey).toBe(1);
    // FIFO order preserved
    expect(processOrder).toEqual(["m1", "m2", "m3"]);
  });

  it("respects maxConcurrent limit", async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;
    const resolvers: Map<string, () => void> = new Map();

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxConcurrent: 2, // Only allow 2 concurrent
    });

    await queue.start({
      process: async (event) => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        await new Promise<void>((resolve) => {
          resolvers.set(event.orderingKey, resolve);
        });
        currentConcurrent--;
      },
    });

    // Enqueue 4 different ordering keys
    for (let i = 1; i <= 4; i++) {
      await queue.enqueue({
        channelId: `c${i}`,
        messageId: `m${i}`,
        orderingKey: `key-${i}`,
        payload: { channel_id: `c${i}`, message: { id: `m${i}` } },
      });
    }

    // Wait for 2 to be in-flight (the max)
    await waitFor(() => currentConcurrent === 2);
    // Give it a bit more time to see if it illegally starts a 3rd
    await new Promise((r) => setTimeout(r, 100));
    expect(peakConcurrent).toBe(2);

    // Release one, which should allow the 3rd to start
    resolvers.get("key-1")?.();
    await waitFor(() => currentConcurrent === 2); // back to 2 after one finishes and one starts
    // Peak should still be 2
    expect(peakConcurrent).toBe(2);

    // Release rest
    resolvers.get("key-2")?.();
    await waitFor(() => resolvers.has("key-3"));
    resolvers.get("key-3")?.();
    await waitFor(() => resolvers.has("key-4"));
    resolvers.get("key-4")?.();

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    await queue.stop();
    expect(peakConcurrent).toBe(2);
  });

  it("failed batch properly releases and allows retry", async () => {
    let attempt = 0;
    const processedBatches: string[][] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxConcurrent: 4,
      maxAttempts: 3,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        attempt++;
        if (attempt === 1) {
          throw new Error("transient error");
        }
        processedBatches.push([event.messageId]);
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "key-A",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    // Wait for successful retry
    await waitFor(() => processedBatches.length === 1, 3_000);
    await queue.stop();

    expect(processedBatches[0]).toEqual(["m1"]);
    expect(attempt).toBe(2); // first attempt failed, second succeeded
  });

  it("drain re-triggers after batch completion to pick up remaining items", async () => {
    /**
     * When a batch for ordering key A completes, drain should re-trigger
     * and pick up any newly queued items for key A (or other keys).
     */
    const processed: string[] = [];

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxConcurrent: 1, // Force serial to test re-trigger clearly
      backoffMs: () => 0,
    });

    let firstDone = false;
    await queue.start({
      process: async (event) => {
        processed.push(event.messageId);
        if (!firstDone) {
          firstDone = true;
          // While processing m1, enqueue m2 for a different key
          await queue.enqueue({
            channelId: "c2",
            messageId: "m2",
            orderingKey: "key-B",
            payload: { channel_id: "c2", message: { id: "m2" } },
          });
        }
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "key-A",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    // m2 should be picked up after m1 completes (via drain re-trigger)
    await waitFor(() => processed.length === 2, 3_000);
    await queue.stop();

    expect(processed).toContain("m1");
    expect(processed).toContain("m2");
  });

  it("slow key A does not block key B (the starvation bug fix)", async () => {
    /**
     * This is THE test for the original bug:
     * - Key A starts processing and takes a long time (simulates slow LLM call)
     * - Key B is enqueued after
     * - Key B should start processing WITHOUT waiting for key A to finish
     */
    const startTimes: Map<string, number> = new Map();
    let resolveA: (() => void) | undefined;

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: true,
      maxConcurrent: 4,
    });

    await queue.start({
      process: async (event) => {
        startTimes.set(event.orderingKey, Date.now());
        if (event.orderingKey === "key-A") {
          // Simulate slow LLM call
          await new Promise<void>((resolve) => {
            resolveA = resolve;
          });
        }
      },
    });

    // Enqueue key A first
    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "key-A",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });

    // Wait for key A to start processing
    await waitFor(() => startTimes.has("key-A"));

    // Enqueue key B while key A is still processing
    await queue.enqueue({
      channelId: "c2",
      messageId: "m2",
      orderingKey: "key-B",
      payload: { channel_id: "c2", message: { id: "m2" } },
    });

    // Key B should start processing even though key A is still busy
    await waitFor(() => startTimes.has("key-B"), 2_000);

    // Now release key A
    resolveA?.();

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    await queue.stop();

    // Both should have been processed
    expect(startTimes.has("key-A")).toBe(true);
    expect(startTimes.has("key-B")).toBe(true);
  });

  it("non-coalesce mode also processes different ordering keys concurrently", async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;
    const resolvers: Map<string, () => void> = new Map();

    const queue = createDiscordInboundDurableQueue({
      accountId: "test",
      stateDir: tmpDir,
      coalesce: false,
      maxConcurrent: 4,
    });

    await queue.start({
      process: async (event) => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        await new Promise<void>((resolve) => {
          resolvers.set(event.orderingKey, resolve);
        });
        currentConcurrent--;
      },
    });

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "key-A",
      payload: { channel_id: "c1", message: { id: "m1" } },
    });
    await queue.enqueue({
      channelId: "c2",
      messageId: "m2",
      orderingKey: "key-B",
      payload: { channel_id: "c2", message: { id: "m2" } },
    });

    await waitFor(() => currentConcurrent === 2);
    expect(peakConcurrent).toBe(2);

    resolvers.get("key-A")?.();
    resolvers.get("key-B")?.();

    await waitFor(async () => {
      const stats = await queue.getStats();
      return stats.queued === 0 && stats.processing === 0;
    });

    await queue.stop();
  });
});
