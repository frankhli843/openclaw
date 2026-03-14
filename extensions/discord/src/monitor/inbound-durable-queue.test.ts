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

  it("replays jobs whose processing lease is still active at startup", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "discord-inbound-queue", "default");
    const leasedJobPath = path.join(queueDir, "leased-job.json");
    await fs.promises.mkdir(queueDir, { recursive: true });
    await fs.promises.writeFile(
      leasedJobPath,
      JSON.stringify({
        id: "leased-job",
        dedupeKey: "default:c1:m-lease",
        state: "processing",
        enqueuedAt: Date.now() - 10_000,
        updatedAt: Date.now() - 10_000,
        leaseUntil: Date.now() + 120,
        attempts: 0,
        nextAttemptAt: Date.now() - 10_000,
        event: {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m-lease",
          payload: { channel_id: "c1", message: { id: "m-lease" } },
        },
      }),
      "utf-8",
    );

    const processed: string[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      leaseMs: 100,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        processed.push(event.messageId);
      },
    });

    await waitFor(async () => processed.includes("m-lease"), 3_000);

    const stats = await queue.getStats();
    expect(stats.queued).toBe(0);
    expect(stats.processing).toBe(0);
    expect(processed).toEqual(["m-lease"]);
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

  it("accepts payloads with circular references by dropping non-serializable links", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const captured: unknown[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        captured.push(event.payload);
      },
    });

    const payload: Record<string, unknown> = {
      channel_id: "c1",
      message: { id: "m1" },
    };
    payload.client = { payload };

    await queue.enqueue({
      channelId: "c1",
      messageId: "m1",
      orderingKey: "c1",
      payload,
    });

    await waitFor(async () => captured.length === 1);
    expect(captured[0]).toEqual({
      channel_id: "c1",
      message: { id: "m1" },
    });
  });

  it("handles realistic Discord.js Client → GatewayPlugin → client circular ref", async () => {
    // Reproduces the exact circular reference from the production error:
    //   Client.plugins[0].plugin (GatewayPlugin) → .client → Client
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const captured: unknown[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        captured.push(event.payload);
      },
    });

    // Build a realistic Carbon/Discord.js message event structure
    const fakeClient: Record<string, unknown> = {
      options: { clientId: "1474345882878214185", token: "fake-token" },
      rest: { token: "fake-token" },
    };
    const gatewayPlugin: Record<string, unknown> = {
      id: "gateway",
      isConnected: true,
      client: fakeClient, // circular: GatewayPlugin → Client
    };
    fakeClient.plugins = [{ id: "gateway", plugin: gatewayPlugin }]; // circular: Client → GatewayPlugin → Client

    const payload: Record<string, unknown> = {
      guild_id: "1474343754482847766",
      channel_id: "1474343755153932394",
      author: { id: "123456", username: "testuser", bot: false },
      member: { roles: ["role1"] },
      message: {
        id: "m-circular",
        content: "test message",
        channel: { id: "1474343755153932394", client: fakeClient }, // Carbon attaches client to channel
        client: fakeClient, // Carbon attaches client to message
        mentionedUsers: [],
        attachments: [],
      },
      guild: {
        id: "1474343754482847766",
        name: "test-server",
        client: fakeClient, // Carbon attaches client to guild
      },
    };

    // Verify JSON.stringify would throw (old code path)
    expect(() => JSON.stringify(payload)).toThrow(/circular/i);

    // But enqueue should succeed with toSerializableObject
    const result = await queue.enqueue({
      channelId: "1474343755153932394",
      messageId: "m-circular",
      orderingKey: "1474343755153932394",
      payload,
    });

    expect(result.enqueued).toBe(true);
    await waitFor(async () => captured.length === 1);

    // Verify the payload was serialized with client refs stripped
    const processed = captured[0] as Record<string, unknown>;
    expect(processed).toBeDefined();
    expect(processed.guild_id).toBe("1474343754482847766");
    expect(processed.channel_id).toBe("1474343755153932394");
    expect((processed.author as Record<string, unknown>)?.username).toBe("testuser");
    const msg = processed.message as Record<string, unknown>;
    expect(msg?.content).toBe("test message");
    // client keys should be stripped
    expect(msg?.client).toBeUndefined();
    expect((processed.guild as Record<string, unknown>)?.client).toBeUndefined();
  });

  it("rejects non-object payloads even after serialization", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({ process: async () => {} });

    await expect(
      queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: "not-an-object",
      }),
    ).rejects.toThrow(/object payload/);

    await expect(
      queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: null,
      }),
    ).rejects.toThrow(/object payload/);
  });

  it("serializes Map/Collection attachments as arrays instead of empty objects", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const captured: unknown[] = [];
    const queue = createDiscordInboundDurableQueue({
      accountId: "default",
      stateDir,
      backoffMs: () => 0,
    });

    await queue.start({
      process: async (event) => {
        captured.push(event.payload);
      },
    });

    // Simulate Discord.js Collection (extends Map) for attachments
    const attachmentsMap = new Map<
      string,
      { id: string; url: string; filename: string; content_type: string }
    >();
    attachmentsMap.set("att1", {
      id: "att1",
      url: "https://cdn.discordapp.com/attachments/123/456/image.png",
      filename: "image.png",
      content_type: "image/png",
    });
    attachmentsMap.set("att2", {
      id: "att2",
      url: "https://cdn.discordapp.com/attachments/123/789/photo.jpg",
      filename: "photo.jpg",
      content_type: "image/jpeg",
    });

    const payload: Record<string, unknown> = {
      channel_id: "c1",
      message: {
        id: "m-map",
        content: "here are some images",
        attachments: attachmentsMap,
      },
    };

    // Verify that JSON.stringify would lose the Map data (the bug)
    const naiveJson = JSON.parse(JSON.stringify(payload));
    expect(naiveJson.message.attachments).toEqual({});

    // But our queue should convert Map to array
    const result = await queue.enqueue({
      channelId: "c1",
      messageId: "m-map",
      orderingKey: "c1",
      payload,
    });

    expect(result.enqueued).toBe(true);
    await waitFor(async () => captured.length === 1);

    const processed = captured[0] as Record<string, unknown>;
    const msg = processed.message as Record<string, unknown>;
    const attachments = msg.attachments as Array<{ id: string; url: string }>;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments).toHaveLength(2);
    expect(attachments[0].id).toBe("att1");
    expect(attachments[0].url).toContain("image.png");
    expect(attachments[1].id).toBe("att2");
    expect(attachments[1].url).toContain("photo.jpg");
  });

  describe("message coalescing", () => {
    it("claimBatch grabs single message when only one is queued", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1", content: "hello" } },
      });

      const batch = await queue.claimBatchForTest();
      expect(batch).toHaveLength(1);
      expect(batch[0].event.messageId).toBe("m1");
      expect(batch[0].state).toBe("processing");
    });

    it("claimBatch grabs all messages with same orderingKey", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      // Enqueue multiple messages with same orderingKey
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1", content: "hello" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2", content: "world" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m3",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m3", content: "!" } },
      });

      const batch = await queue.claimBatchForTest();
      expect(batch).toHaveLength(3);
      expect(batch.map((j) => j.event.messageId).toSorted()).toEqual(["m1", "m2", "m3"]);
      expect(batch.every((j) => j.state === "processing")).toBe(true);
    });

    it("claimBatch doesn't mix different orderingKeys", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      // Enqueue messages with different orderingKeys
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c2",
        messageId: "m2",
        orderingKey: "c2",
        payload: { channel_id: "c2", message: { id: "m2" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m3",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m3" } },
      });

      const batch = await queue.claimBatchForTest();
      // Should get the earliest orderingKey's batch (c1 has m1 and m3)
      expect(batch).toHaveLength(2);
      expect(batch.every((j) => j.event.orderingKey === "c1")).toBe(true);
      expect(batch.map((j) => j.event.messageId).toSorted()).toEqual(["m1", "m3"]);
    });

    it("claimBatch isolates parent-channel and thread ordering keys", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      // Parent channel and thread should batch separately.
      await queue.enqueue({
        channelId: "chan-1",
        messageId: "p1",
        orderingKey: "chan-1",
        payload: { channel_id: "chan-1", message: { id: "p1" } },
      });
      await queue.enqueue({
        channelId: "thread-9",
        messageId: "t1",
        orderingKey: "thread-9",
        payload: { channel_id: "thread-9", message: { id: "t1" } },
      });
      await queue.enqueue({
        channelId: "chan-1",
        messageId: "p2",
        orderingKey: "chan-1",
        payload: { channel_id: "chan-1", message: { id: "p2" } },
      });

      const parentBatch = await queue.claimBatchForTest();
      expect(parentBatch.map((j) => j.event.messageId).toSorted()).toEqual(["p1", "p2"]);
      expect(parentBatch.every((j) => j.event.orderingKey === "chan-1")).toBe(true);

      // Next claim should get only thread messages.
      const threadBatch = await queue.claimBatchForTest();
      expect(threadBatch).toHaveLength(1);
      expect(threadBatch[0]?.event.messageId).toBe("t1");
      expect(threadBatch[0]?.event.orderingKey).toBe("thread-9");
    });

    it("processBatch falls through to processOne for single message", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const processed: string[] = [];
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      await queue.start({
        process: async (event) => {
          processed.push(`single:${event.messageId}`);
        },
        processBatch: async (events) => {
          processed.push(`batch:${events.length}`);
        },
      });

      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });

      await waitFor(async () => processed.length === 1);
      expect(processed).toEqual(["single:m1"]);
    });

    it("processBatch calls batch processor for multiple messages", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const processed: string[] = [];
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      // Enqueue multiple messages before starting processor (so they batch together)
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2" } },
      });

      await queue.start({
        process: async (event) => {
          processed.push(`single:${event.messageId}`);
        },
        processBatch: async (events) => {
          processed.push(`batch:${events.length}:${events.map((e) => e.messageId).join(",")}`);
        },
      });

      await waitFor(async () => processed.length === 1);
      expect(processed[0]).toMatch(/^batch:2:m[12],m[12]$/);
    });

    it("processBatch falls back to individual processing when no batch processor provided", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const processed: string[] = [];
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      await queue.start({
        process: async (event) => {
          processed.push(`single:${event.messageId}`);
        },
        // No processBatch callback provided
      });

      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2" } },
      });

      await waitFor(async () => processed.length === 2);
      expect(processed.toSorted()).toEqual(["single:m1", "single:m2"]);
    });

    it("processBatch handles batch processing errors by returning all jobs to queued", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      let batchAttempts = 0;
      let singleAttempts = 0;
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        maxAttempts: 2,
        backoffMs: () => 0,
      });

      // Enqueue messages before starting processor (so they batch together)
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2" } },
      });

      await queue.start({
        process: async () => {
          singleAttempts += 1;
          throw new Error("single processing failed");
        },
        processBatch: async () => {
          batchAttempts += 1;
          throw new Error("batch processing failed");
        },
      });

      await waitFor(async () => {
        const stats = await queue.getStats();
        return stats.dead === 2;
      });

      expect(batchAttempts).toBe(2); // 2 attempts for the batch
      expect(singleAttempts).toBe(0); // No single processing since batched
      const stats = await queue.getStats();
      expect(stats.queued).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.dead).toBe(2);
    });

    it("drain uses claimBatch when coalesce is enabled", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const processedBatches: number[] = [];
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: true,
        backoffMs: () => 0,
      });

      // Add multiple messages before starting processor
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2" } },
      });

      await queue.start({
        process: async () => {
          processedBatches.push(1);
        },
        processBatch: async (events) => {
          processedBatches.push(events.length);
        },
      });

      await waitFor(async () => processedBatches.length > 0);
      expect(processedBatches[0]).toBe(2); // Should be processed as a batch
    });

    it("drain uses claimNextJob when coalesce is disabled", async () => {
      const stateDir = await makeTmpDir();
      cleanupDirs.push(stateDir);

      const processedItems: number[] = [];
      const queue = createDiscordInboundDurableQueue({
        accountId: "default",
        stateDir,
        coalesce: false, // Explicitly disabled
        backoffMs: () => 0,
      });

      await queue.start({
        process: async () => {
          processedItems.push(1);
        },
        processBatch: async (events) => {
          processedItems.push(events.length);
        },
      });

      // Add multiple messages
      await queue.enqueue({
        channelId: "c1",
        messageId: "m1",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m1" } },
      });
      await queue.enqueue({
        channelId: "c1",
        messageId: "m2",
        orderingKey: "c1",
        payload: { channel_id: "c1", message: { id: "m2" } },
      });

      await waitFor(async () => processedItems.length === 2);
      expect(processedItems).toEqual([1, 1]); // Should be processed individually
    });
  });
});
