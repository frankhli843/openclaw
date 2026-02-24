import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

import { callGateway } from "../gateway/call.js";
import {
  enqueueScheduledAgent,
  getScheduledAgentDbPath,
  markDispatched,
  markFailed,
  pollReadyMessages,
  startScheduledAgentPoller,
  stopScheduledAgentPoller,
} from "./scheduled-agent.js";

const mockCallGateway = vi.mocked(callGateway);

async function makeTmpDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "scheduled-agent-"));
}

async function waitFor(
  condition: () => Promise<boolean> | boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  stopScheduledAgentPoller();
  mockCallGateway.mockReset();
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }),
  );
});

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

describe("enqueueScheduledAgent", () => {
  it("creates a message with correct fields", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const before = Date.now();
    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "hello agent",
      deliver: true,
      canReadBy: Date.now() + 10_000,
    });
    const after = Date.now();

    const queueDir = path.join(stateDir, "scheduled-agent");
    const files = await fs.promises.readdir(queueDir);
    expect(files).toHaveLength(1);
    const raw = await fs.promises.readFile(path.join(queueDir, files[0]), "utf-8");
    const msg = JSON.parse(raw) as Record<string, unknown>;

    expect(msg["id"]).toBe(id);
    expect(msg["sessionKey"]).toBe("session:test");
    expect(msg["message"]).toBe("hello agent");
    expect(msg["deliver"]).toBe(true);
    expect(msg["status"]).toBe("pending");
    expect(typeof msg["canReadBy"]).toBe("number");
    expect(msg["createdAt"] as number).toBeGreaterThanOrEqual(before);
    expect(msg["createdAt"] as number).toBeLessThanOrEqual(after);
  });

  it("enqueue with group deduplicates - removes older pending in same group", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const { id: id1 } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "first",
      deliver: true,
      canReadBy: Date.now() + 10_000,
      group: "restart",
    });
    const { id: id2 } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "second",
      deliver: true,
      canReadBy: Date.now() + 10_000,
      group: "restart",
    });

    const queueDir = path.join(stateDir, "scheduled-agent");
    const files = await fs.promises.readdir(queueDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(`${id2}.json`);
    expect(id1).not.toBe(id2);

    const raw = await fs.promises.readFile(path.join(queueDir, files[0]), "utf-8");
    const msg = JSON.parse(raw) as { message: string };
    expect(msg.message).toBe("second");
  });

  it("does not deduplicate messages without a group", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:a",
      message: "msg a",
      deliver: true,
      canReadBy: Date.now() + 10_000,
    });
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:b",
      message: "msg b",
      deliver: true,
      canReadBy: Date.now() + 10_000,
    });

    const queueDir = path.join(stateDir, "scheduled-agent");
    const files = await fs.promises.readdir(queueDir);
    expect(files).toHaveLength(2);
  });

  it("does not deduplicate messages with different groups", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "group-a",
      deliver: true,
      canReadBy: Date.now() + 10_000,
      group: "groupA",
    });
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "group-b",
      deliver: true,
      canReadBy: Date.now() + 10_000,
      group: "groupB",
    });

    const queueDir = path.join(stateDir, "scheduled-agent");
    const files = await fs.promises.readdir(queueDir);
    expect(files).toHaveLength(2);
  });
});

describe("pollReadyMessages", () => {
  it("returns messages where canReadBy <= now", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const now = Date.now();
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "ready",
      deliver: true,
      canReadBy: now - 1_000,
    });

    const messages = await pollReadyMessages(now, stateDir);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe("ready");
  });

  it("does not return future messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const now = Date.now();
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "future",
      deliver: true,
      canReadBy: now + 60_000,
    });

    const messages = await pollReadyMessages(now, stateDir);
    expect(messages).toHaveLength(0);
  });

  it("does not return already-dispatched messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const now = Date.now();
    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "dispatched",
      deliver: true,
      canReadBy: now - 1_000,
    });
    await markDispatched(id, stateDir);

    const messages = await pollReadyMessages(now, stateDir);
    expect(messages).toHaveLength(0);
  });

  it("does not return failed messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const now = Date.now();
    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "failed",
      deliver: true,
      canReadBy: now - 1_000,
    });
    await markFailed(id, "some error", stateDir);

    const messages = await pollReadyMessages(now, stateDir);
    expect(messages).toHaveLength(0);
  });

  it("returns multiple messages sorted by canReadBy ascending", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const now = Date.now();
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "later",
      deliver: true,
      canReadBy: now - 100,
    });
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "earlier",
      deliver: true,
      canReadBy: now - 1_000,
    });

    const messages = await pollReadyMessages(now, stateDir);
    expect(messages).toHaveLength(2);
    expect(messages[0].message).toBe("earlier");
    expect(messages[1].message).toBe("later");
  });
});

describe("markDispatched", () => {
  it("updates status to dispatched", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "test",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });
    await markDispatched(id, stateDir);

    const queueDir = path.join(stateDir, "scheduled-agent");
    const raw = await fs.promises.readFile(path.join(queueDir, `${id}.json`), "utf-8");
    const msg = JSON.parse(raw) as { status: string };
    expect(msg.status).toBe("dispatched");
  });

  it("is idempotent when called on a missing id", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Should not throw even if id doesn't exist
    await expect(markDispatched("nonexistent-id", stateDir)).resolves.toBeUndefined();
  });
});

describe("markFailed", () => {
  it("updates status to failed with the error string", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "test",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });
    await markFailed(id, "gateway timeout", stateDir);

    const queueDir = path.join(stateDir, "scheduled-agent");
    const raw = await fs.promises.readFile(path.join(queueDir, `${id}.json`), "utf-8");
    const msg = JSON.parse(raw) as { status: string; lastError: string };
    expect(msg.status).toBe("failed");
    expect(msg.lastError).toBe("gateway timeout");
  });
});

// ---------------------------------------------------------------------------
// Poller tests
// ---------------------------------------------------------------------------

describe("startScheduledAgentPoller", () => {
  it("dispatches ready messages immediately on start", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "hello",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    startScheduledAgentPoller({ stateDir });

    await waitFor(() => mockCallGateway.mock.calls.length > 0);
    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          sessionKey: "session:test",
          message: "hello",
          deliver: true,
          channel: "last",
        }),
      }),
    );
  });

  it("dispatches with deliver: true and channel: last", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:mykey",
      message: "agent wake",
      deliver: true,
      canReadBy: Date.now() - 1,
    });

    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    const call = mockCallGateway.mock.calls[0][0];
    expect(call.params).toMatchObject({
      deliver: true,
      channel: "last",
    });
  });

  it("dispatches with explicit reply channel/target when provided", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:mykey",
      message: "agent wake",
      deliver: true,
      canReadBy: Date.now() - 1,
      replyChannel: "discord",
      replyTo: "channel:1474343755153932394",
      threadId: "thread-123",
    });

    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    const call = mockCallGateway.mock.calls[0][0];
    expect(call.params).toMatchObject({
      deliver: true,
      channel: "discord",
      replyChannel: "discord",
      replyTo: "channel:1474343755153932394",
      threadId: "thread-123",
    });
  });

  it("skips future messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "future",
      deliver: true,
      canReadBy: Date.now() + 60_000,
    });

    startScheduledAgentPoller({ stateDir, intervalMs: 50 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(mockCallGateway).not.toHaveBeenCalled();
  });

  it("marks dispatched so messages are not re-dispatched on subsequent polls", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "once",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    startScheduledAgentPoller({ stateDir, intervalMs: 50 });

    // Wait for at least 2 poll cycles
    await waitFor(() => mockCallGateway.mock.calls.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Should only have been dispatched once
    expect(mockCallGateway.mock.calls.length).toBe(1);
  });

  it("handles callGateway errors gracefully and marks as failed without crashing", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockRejectedValue(new Error("gateway error"));

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "will fail",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    startScheduledAgentPoller({ stateDir });

    await waitFor(async () => {
      const queueDir = path.join(stateDir, "scheduled-agent");
      const raw = await fs.promises
        .readFile(path.join(queueDir, `${id}.json`), "utf-8")
        .catch(() => null);
      if (!raw) {
        return false;
      }
      const msg = JSON.parse(raw) as { status: string };
      return msg.status === "failed";
    });

    expect(mockCallGateway).toHaveBeenCalled();
  });

  it("the idempotencyKey matches the message id", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "idempotent",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          idempotencyKey: id,
        }),
      }),
    );
  });
});

describe("stopScheduledAgentPoller", () => {
  it("stops the interval so no further dispatches occur", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    startScheduledAgentPoller({ stateDir, intervalMs: 50 });
    stopScheduledAgentPoller();

    // Allow immediate dispatch to complete (queue was empty at start)
    await new Promise((resolve) => setTimeout(resolve, 50));

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "not dispatched",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    // Wait for what would be multiple poll cycles
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mockCallGateway).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Delivery context tests
// ---------------------------------------------------------------------------

describe("delivery context routing", () => {
  it("dispatches with sessionKey so agent can route to the bound channel", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    const sessionKey = "telegram:user123";
    await enqueueScheduledAgent({
      stateDir,
      sessionKey,
      message: "wake up",
      deliver: true,
      canReadBy: Date.now() - 1,
    });

    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          sessionKey,
          deliver: true,
          channel: "last",
        }),
      }),
    );
  });

  it("dispatches with deliver: true so the reply routes to the bound channel", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "discord:server:channel",
      message: "deliver this",
      deliver: true,
      canReadBy: Date.now() - 1,
    });

    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    const call = mockCallGateway.mock.calls[0][0];
    expect((call.params as Record<string, unknown>)["deliver"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Restart integration tests
// ---------------------------------------------------------------------------

describe("restart integration", () => {
  it("after restart, a scheduled message is enqueued with group 'restart'", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "gateway restarted",
      deliver: true,
      canReadBy: Date.now() + 30_000,
      group: "restart",
    });

    const queueDir = path.join(stateDir, "scheduled-agent");
    const raw = await fs.promises.readFile(path.join(queueDir, `${id}.json`), "utf-8");
    const msg = JSON.parse(raw) as { group: string; status: string };
    expect(msg.group).toBe("restart");
    expect(msg.status).toBe("pending");
  });

  it("rapid restarts (2x within 30s) result in only ONE pending message (dedup by group)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "restart 1",
      deliver: true,
      canReadBy: Date.now() + 30_000,
      group: "restart",
    });
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "restart 2",
      deliver: true,
      canReadBy: Date.now() + 30_000,
      group: "restart",
    });

    const queueDir = path.join(stateDir, "scheduled-agent");
    const files = await fs.promises.readdir(queueDir);
    expect(files).toHaveLength(1);

    // Only the latest message survives
    const raw = await fs.promises.readFile(path.join(queueDir, files[0]), "utf-8");
    const msg = JSON.parse(raw) as { message: string };
    expect(msg.message).toBe("restart 2");
  });

  it("30s delay means message is not dispatched immediately", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "restart notification",
      deliver: true,
      canReadBy: Date.now() + 30_000,
      group: "restart",
    });

    const messages = await pollReadyMessages(Date.now(), stateDir);
    expect(messages).toHaveLength(0);
  });

  it("after 30s, message is visible to poller as a full agent turn", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    // Simulate a message that was enqueued 30s ago (already past its canReadBy)
    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "restart notification",
      deliver: true,
      canReadBy: Date.now() - 30_000,
      group: "restart",
    });

    const messages = await pollReadyMessages(Date.now(), stateDir);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe("restart notification");

    // Poller picks it up and dispatches as a full agent turn
    startScheduledAgentPoller({ stateDir });
    await waitFor(() => mockCallGateway.mock.calls.length > 0);

    expect(mockCallGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent",
        params: expect.objectContaining({
          message: "restart notification",
          deliver: true,
          channel: "last",
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("empty queue does not cause errors", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const messages = await pollReadyMessages(Date.now(), stateDir);
    expect(messages).toEqual([]);
  });

  it("queue directory is created if it does not exist", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const queueDir = path.join(stateDir, "scheduled-agent");
    await expect(fs.promises.access(queueDir)).rejects.toThrow();

    await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "creates dir",
      deliver: true,
      canReadBy: Date.now(),
    });

    await expect(fs.promises.access(queueDir)).resolves.toBeUndefined();
  });

  it("polling a non-existent queue directory returns empty array", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Don't create the queue dir - just poll
    const messages = await pollReadyMessages(Date.now(), stateDir);
    expect(messages).toEqual([]);
  });

  it("concurrent polls do not double-dispatch (status check prevents re-dispatch)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);
    mockCallGateway.mockResolvedValue({});

    const { id } = await enqueueScheduledAgent({
      stateDir,
      sessionKey: "session:test",
      message: "dispatch once",
      deliver: true,
      canReadBy: Date.now() - 1_000,
    });

    // Simulate concurrent polls by marking dispatched in between
    const poll1 = pollReadyMessages(Date.now(), stateDir);
    const poll2 = pollReadyMessages(Date.now(), stateDir);
    const [msgs1, msgs2] = await Promise.all([poll1, poll2]);

    // Both polls see the pending message; the dispatch protection
    // is that we mark dispatched immediately before calling gateway
    expect(msgs1).toHaveLength(1);
    expect(msgs2).toHaveLength(1);

    // After marking dispatched, future polls return nothing
    await markDispatched(id, stateDir);
    const msgs3 = await pollReadyMessages(Date.now(), stateDir);
    expect(msgs3).toHaveLength(0);
  });

  it("getScheduledAgentDbPath resolves based on stateDir", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const dbPath = getScheduledAgentDbPath(stateDir);
    expect(dbPath).toContain(stateDir);
    expect(dbPath).toContain("scheduled-agent");
  });
});
