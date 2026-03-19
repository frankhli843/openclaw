import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadLastSeenMessages,
  runDiscordCatchUp,
  updateLastSeenMessage,
  type DiscordInboundQueueRef,
} from "./catch-up.js";

async function makeTmpDir(): Promise<string> {
  return await fs.promises.mkdtemp(path.join(os.tmpdir(), "discord-catch-up-test-"));
}

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirs.splice(0).map(async (dir) => {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }),
  );
});

function makeMessage(
  overrides: Partial<{
    id: string;
    channel_id: string;
    author: { id: string; bot?: boolean; username?: string };
    content: string;
    timestamp: string;
  }> = {},
) {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? "1000000000000000001",
    channel_id: overrides.channel_id ?? "channel1",
    author: overrides.author ?? { id: "user1", username: "testuser" },
    content: overrides.content ?? "hello",
    timestamp: overrides.timestamp ?? now,
    attachments: [],
    embeds: [],
  };
}

function makeMockFetch(
  responses: Array<{
    status?: number;
    ok?: boolean;
    body?: unknown;
    throws?: Error;
  }>,
) {
  let callIndex = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const responseSpec = responses[callIndex++];
    if (!responseSpec) {
      throw new Error("Unexpected fetch call");
    }
    if (responseSpec.throws) {
      throw responseSpec.throws;
    }
    const status = responseSpec.status ?? 200;
    const ok = responseSpec.ok ?? (status >= 200 && status < 300);
    return {
      status,
      ok,
      json: async () => responseSpec.body ?? [],
    } as Response;
  });
}

function makeMockQueue(): DiscordInboundQueueRef & {
  enqueued: Array<{ channelId: string; messageId: string; orderingKey: string; payload: unknown }>;
} {
  const enqueued: Array<{
    channelId: string;
    messageId: string;
    orderingKey: string;
    payload: unknown;
  }> = [];
  return {
    enqueued,
    async enqueue(input) {
      enqueued.push(input);
      return { enqueued: true, dedupeKey: `key:${input.messageId}` };
    },
  };
}

// ── updateLastSeenMessage ─────────────────────────────────────────────────────

describe("updateLastSeenMessage", () => {
  it("creates the marker file atomically", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("channelA", "msg123", stateDir);

    const markerPath = path.join(stateDir, "discord-last-seen", "channelA.json");
    const raw = await fs.promises.readFile(markerPath, "utf-8");
    const parsed = JSON.parse(raw) as { messageId: string; updatedAt: string };
    expect(parsed.messageId).toBe("msg123");
    expect(parsed.updatedAt).toBeTruthy();
  });

  it("creates the directory if it does not exist", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Directory does not exist yet
    await updateLastSeenMessage("channel1", "msg1", stateDir);

    const dir = path.join(stateDir, "discord-last-seen");
    const stat = await fs.promises.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("overwrites an existing marker with the new message ID", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("c1", "msgOld", stateDir);
    await updateLastSeenMessage("c1", "msgNew", stateDir);

    const markerPath = path.join(stateDir, "discord-last-seen", "c1.json");
    const raw = await fs.promises.readFile(markerPath, "utf-8");
    const parsed = JSON.parse(raw) as { messageId: string };
    expect(parsed.messageId).toBe("msgNew");
  });

  it("handles different channels independently", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "msg-a", stateDir);
    await updateLastSeenMessage("ch2", "msg-b", stateDir);

    const path1 = path.join(stateDir, "discord-last-seen", "ch1.json");
    const path2 = path.join(stateDir, "discord-last-seen", "ch2.json");
    const parsed1 = JSON.parse(await fs.promises.readFile(path1, "utf-8")) as { messageId: string };
    const parsed2 = JSON.parse(await fs.promises.readFile(path2, "utf-8")) as { messageId: string };
    expect(parsed1.messageId).toBe("msg-a");
    expect(parsed2.messageId).toBe("msg-b");
  });

  it("does not leave a .tmp file behind on success", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("chan", "msgX", stateDir);

    const dir = path.join(stateDir, "discord-last-seen");
    const entries = await fs.promises.readdir(dir);
    const tmpFiles = entries.filter((e) => e.endsWith(".tmp"));
    expect(tmpFiles).toHaveLength(0);
  });
});

// ── loadLastSeenMessages ──────────────────────────────────────────────────────

describe("loadLastSeenMessages", () => {
  it("returns empty map when directory does not exist", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(0);
  });

  it("returns empty map when directory is empty", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await fs.promises.mkdir(path.join(stateDir, "discord-last-seen"), { recursive: true });
    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(0);
  });

  it("loads all marker files correctly", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "msg1", stateDir);
    await updateLastSeenMessage("ch2", "msg2", stateDir);
    await updateLastSeenMessage("ch3", "msg3", stateDir);

    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(3);
    expect(result.get("ch1")).toBe("msg1");
    expect(result.get("ch2")).toBe("msg2");
    expect(result.get("ch3")).toBe("msg3");
  });

  it("skips non-JSON files in the directory", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const dir = path.join(stateDir, "discord-last-seen");
    await fs.promises.mkdir(dir, { recursive: true });
    // Create a non-JSON file
    await fs.promises.writeFile(path.join(dir, "notes.txt"), "some text");
    await updateLastSeenMessage("realchan", "realMsg", stateDir);

    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(1);
    expect(result.get("realchan")).toBe("realMsg");
  });

  it("skips corrupt/invalid JSON files without throwing", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const dir = path.join(stateDir, "discord-last-seen");
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, "corrupt.json"), "NOT VALID JSON {{");
    await updateLastSeenMessage("goodchan", "goodMsg", stateDir);

    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(1);
    expect(result.get("goodchan")).toBe("goodMsg");
  });

  it("skips marker files without a valid messageId field", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const dir = path.join(stateDir, "discord-last-seen");
    await fs.promises.mkdir(dir, { recursive: true });
    // Write a JSON file missing the messageId field
    await fs.promises.writeFile(
      path.join(dir, "badformat.json"),
      JSON.stringify({ updatedAt: "2024-01-01" }),
    );
    await updateLastSeenMessage("ok", "ok-msg", stateDir);

    const result = await loadLastSeenMessages(stateDir);
    expect(result.size).toBe(1);
    expect(result.get("ok")).toBe("ok-msg");
    expect(result.has("badformat")).toBe(false);
  });
});

// ── runDiscordCatchUp ─────────────────────────────────────────────────────────

describe("runDiscordCatchUp", () => {
  it("returns zeros and makes no API calls when there are no marker files", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    const mockFetch = makeMockFetch([]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "bot-token",
      botUserId: "bot123",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(0);
    expect(result.channels).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(queue.enqueued).toHaveLength(0);
  });

  it("fetches messages from Discord REST API using the correct URL", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = makeMessage({ id: "1001", channel_id: "ch1" });
    const mockFetch = makeMockFetch([{ body: [msg] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "my-token",
      botUserId: "bot123",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/ch1/messages?after=1000&limit=100");
    expect((init.headers as Record<string, string>)?.Authorization).toBe("Bot my-token");
  });

  it("enqueues missed messages into the durable queue", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg1 = makeMessage({ id: "1001", channel_id: "ch1", content: "first" });
    const msg2 = makeMessage({ id: "1002", channel_id: "ch1", content: "second" });
    const mockFetch = makeMockFetch([{ body: [msg2, msg1] }]); // API returns newest first
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(2);
    expect(result.channels).toBe(1);
    expect(queue.enqueued).toHaveLength(2);
    // Oldest first ordering
    expect(queue.enqueued[0].messageId).toBe("1001");
    expect(queue.enqueued[1].messageId).toBe("1002");
  });

  it("skips the bot's own messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const botMsg = makeMessage({ id: "1001", author: { id: "bot123", username: "mybot" } });
    const userMsg = makeMessage({ id: "1002", author: { id: "user1", username: "human" } });
    const mockFetch = makeMockFetch([{ body: [userMsg, botMsg] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      botUserId: "bot123",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(1);
    expect(queue.enqueued[0].messageId).toBe("1002");
  });

  it("skips messages from any bot (author.bot = true)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const otherBot = makeMessage({ id: "1001", author: { id: "otherbot", bot: true } });
    const humanMsg = makeMessage({ id: "1002", author: { id: "human1" } });
    const mockFetch = makeMockFetch([{ body: [humanMsg, otherBot] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(1);
    expect(queue.enqueued[0].messageId).toBe("1002");
  });

  it("skips messages older than 1 hour", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const now = Date.now();
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();

    const oldMsg = makeMessage({ id: "1001", timestamp: twoHoursAgo });
    const recentMsg = makeMessage({ id: "1002", timestamp: tenMinutesAgo });
    const mockFetch = makeMockFetch([{ body: [recentMsg, oldMsg] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
      now: () => now,
    });

    expect(result.recovered).toBe(1);
    expect(queue.enqueued[0].messageId).toBe("1002");
  });

  it("respects the 100 message limit in the URL", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ body: [] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("limit=100");
  });

  it("handles API 404 gracefully (channel deleted)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ status: 404, ok: false }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("handles API 403 gracefully (missing permissions)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ status: 403, ok: false }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("handles non-2xx API errors gracefully without crashing", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);
    await updateLastSeenMessage("ch2", "2000", stateDir);

    const msg = makeMessage({ id: "2001", channel_id: "ch2" });
    const mockFetch = makeMockFetch([
      { status: 500, ok: false }, // ch1 fails
      { body: [msg] }, // ch2 succeeds
    ]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(1);
    expect(queue.enqueued[0].messageId).toBe("2001");
  });

  it("handles network errors gracefully without crashing", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ throws: new Error("Network unreachable") }]);
    const queue = makeMockQueue();

    await expect(
      runDiscordCatchUp({
        token: "tok",
        queue,
        stateDir,
        restFetch: mockFetch as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ recovered: 0 });
  });

  it("updates the marker to the newest message ID after catch-up", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg1 = makeMessage({ id: "1001", channel_id: "ch1" });
    const msg2 = makeMessage({ id: "1002", channel_id: "ch1" });
    const msg3 = makeMessage({ id: "1003", channel_id: "ch1" });
    // API returns newest first
    const mockFetch = makeMockFetch([{ body: [msg3, msg2, msg1] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    const markers = await loadLastSeenMessages(stateDir);
    expect(markers.get("ch1")).toBe("1003");
  });

  it("updates marker even when messages are filtered (e.g. all bot messages)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const botMsg1 = makeMessage({ id: "1001", author: { id: "bot1", bot: true } });
    const botMsg2 = makeMessage({ id: "1002", author: { id: "bot2", bot: true } });
    const mockFetch = makeMockFetch([{ body: [botMsg2, botMsg1] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    // No messages enqueued, but marker should advance
    expect(queue.enqueued).toHaveLength(0);
    const markers = await loadLastSeenMessages(stateDir);
    expect(markers.get("ch1")).toBe("1002");
  });

  it("does not update marker when API returns no messages", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ body: [] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    const markers = await loadLastSeenMessages(stateDir);
    expect(markers.get("ch1")).toBe("1000"); // unchanged
  });

  it("processes multiple channels independently", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);
    await updateLastSeenMessage("ch2", "2000", stateDir);

    const msgCh1 = makeMessage({ id: "1001", channel_id: "ch1" });
    const msgCh2 = makeMessage({ id: "2001", channel_id: "ch2" });
    const mockFetch = makeMockFetch([{ body: [msgCh1] }, { body: [msgCh2] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(2);
    expect(result.channels).toBe(2);
    expect(queue.enqueued.map((e) => e.messageId).toSorted()).toEqual(["1001", "2001"]);
  });

  it("constructs correct payload shape for the durable queue", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = {
      id: "1001",
      channel_id: "ch1",
      author: { id: "user42", username: "alice" },
      content: "hello world",
      timestamp: new Date().toISOString(),
      attachments: [],
      embeds: [],
    };
    const mockFetch = makeMockFetch([{ body: [msg] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(queue.enqueued).toHaveLength(1);
    const enqueued = queue.enqueued[0];
    expect(enqueued.channelId).toBe("ch1");
    expect(enqueued.messageId).toBe("1001");
    expect(enqueued.orderingKey).toBe("ch1");

    const payload = enqueued.payload as {
      channel_id: string;
      message: { id: string; channel_id: string; rawData: unknown };
      author: { id: string };
    };
    expect(payload.channel_id).toBe("ch1");
    expect(payload.message.id).toBe("1001");
    expect(payload.message.channel_id).toBe("ch1");
    expect(payload.message.rawData).toMatchObject({ id: "1001" });
    expect(payload.author.id).toBe("user42");
  });

  it("uses thread ordering key when message has a thread", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = {
      id: "1001",
      channel_id: "ch1",
      author: { id: "user1" },
      content: "thread reply",
      timestamp: new Date().toISOString(),
      thread: { id: "thread99" },
      attachments: [],
      embeds: [],
    };
    const mockFetch = makeMockFetch([{ body: [msg] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(queue.enqueued[0].orderingKey).toBe("ch1:thread99");
  });

  it("uses thread_id ordering key when message has thread_id field", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = {
      id: "1001",
      channel_id: "ch1",
      author: { id: "user1" },
      content: "thread reply via thread_id",
      timestamp: new Date().toISOString(),
      thread_id: "thread77",
      attachments: [],
      embeds: [],
    };
    const mockFetch = makeMockFetch([{ body: [msg] }]);
    const queue = makeMockQueue();

    await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(queue.enqueued[0].orderingKey).toBe("ch1:thread77");
  });

  it("handles dedup: already-queued messages are not recovered again", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = makeMessage({ id: "1001" });
    const mockFetch = makeMockFetch([{ body: [msg] }]);

    // Queue that always returns enqueued: false (simulates dedup)
    const dedupQueue: DiscordInboundQueueRef = {
      async enqueue() {
        return { enqueued: false, dedupeKey: "dup" };
      },
    };

    const result = await runDiscordCatchUp({
      token: "tok",
      queue: dedupQueue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    // Message was not counted as recovered (dedup rejected it)
    expect(result.recovered).toBe(0);
    expect(result.channels).toBe(0);
  });

  it("still advances marker even if all messages are deduped", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const msg = makeMessage({ id: "1001" });
    const mockFetch = makeMockFetch([{ body: [msg] }]);

    const dedupQueue: DiscordInboundQueueRef = {
      async enqueue() {
        return { enqueued: false, dedupeKey: "dup" };
      },
    };

    await runDiscordCatchUp({
      token: "tok",
      queue: dedupQueue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    // Marker should advance to 1001 (newest seen from API)
    const markers = await loadLastSeenMessages(stateDir);
    expect(markers.get("ch1")).toBe("1001");
  });

  it("handles empty array response gracefully", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = makeMockFetch([{ body: [] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(0);
    expect(result.channels).toBe(0);
  });

  it("handles invalid JSON response gracefully", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);

    const mockFetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("SyntaxError: invalid JSON");
      },
    })) as unknown as typeof fetch;
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch,
    });

    expect(result.recovered).toBe(0);
  });

  it("processes channels even when some fail", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);
    await updateLastSeenMessage("ch2", "2000", stateDir);

    const goodMsg = makeMessage({ id: "2001", channel_id: "ch2" });
    const mockFetch = makeMockFetch([
      { throws: new Error("timeout") }, // ch1 errors
      { body: [goodMsg] }, // ch2 succeeds
    ]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    // ch2 messages recovered despite ch1 error
    expect(result.recovered).toBe(1);
  });

  it("correctly reports channels count (only channels with recovery)", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    await updateLastSeenMessage("ch1", "1000", stateDir);
    await updateLastSeenMessage("ch2", "2000", stateDir);

    const msg = makeMessage({ id: "2001", channel_id: "ch2" });
    const mockFetch = makeMockFetch([
      { body: [] }, // ch1: no new messages
      { body: [msg] }, // ch2: one new message
    ]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(1);
    expect(result.channels).toBe(1);
  });

  it("marker messageId is the latest: marker equals last seen, nothing to catch up", async () => {
    const stateDir = await makeTmpDir();
    cleanupDirs.push(stateDir);

    // Marker already points to the latest message
    await updateLastSeenMessage("ch1", "9999", stateDir);

    // API returns empty (no messages after 9999)
    const mockFetch = makeMockFetch([{ body: [] }]);
    const queue = makeMockQueue();

    const result = await runDiscordCatchUp({
      token: "tok",
      queue,
      stateDir,
      restFetch: mockFetch as unknown as typeof fetch,
    });

    expect(result.recovered).toBe(0);
    expect(result.channels).toBe(0);
    // Marker should remain unchanged
    const markers = await loadLastSeenMessages(stateDir);
    expect(markers.get("ch1")).toBe("9999");
  });
});
