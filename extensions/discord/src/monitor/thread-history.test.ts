import type { Client } from "@buape/carbon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiscordThreadHistoryCacheForTest,
  fetchDiscordThreadMessages,
  formatDiscordThreadHistory,
  resolveDiscordThreadHistory,
  selectThreadStartingMessages,
  type DiscordThreadMessage,
} from "./thread-history.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRawMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "msg-1",
    content: overrides.content ?? "hello",
    author: {
      id: overrides.authorId ?? "user-1",
      username: overrides.username ?? "alice",
      discriminator: "0",
      bot: overrides.bot ?? false,
      global_name: overrides.global_name ?? null,
    },
    member: overrides.member ?? undefined,
    timestamp: overrides.timestamp ?? "2026-03-04T12:00:00.000Z",
    embeds: overrides.embeds ?? [],
    type: overrides.type ?? 0,
  };
}

function makeThreadMsg(overrides: Partial<DiscordThreadMessage> = {}): DiscordThreadMessage {
  return {
    id: overrides.id ?? "msg-1",
    content: overrides.content ?? "hello",
    authorName: overrides.authorName ?? "alice",
    authorId: overrides.authorId ?? "user-1",
    isBot: overrides.isBot ?? false,
    timestamp: overrides.timestamp ?? 1709553600000,
  };
}

function makeMockClient(pages: unknown[][]): Client {
  let callCount = 0;
  const get = vi.fn().mockImplementation(() => {
    const page = pages[callCount] ?? [];
    callCount++;
    return Promise.resolve(page);
  });
  return { rest: { get } } as unknown as Client;
}

// ---------------------------------------------------------------------------
// fetchDiscordThreadMessages
// ---------------------------------------------------------------------------

describe("fetchDiscordThreadMessages", () => {
  it("returns messages in chronological order (oldest first)", async () => {
    // Discord API returns newest first
    const client = makeMockClient([
      [
        makeRawMsg({ id: "3", content: "third" }),
        makeRawMsg({ id: "2", content: "second" }),
        makeRawMsg({ id: "1", content: "first" }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("1");
    expect(result[0].content).toBe("first");
    expect(result[1].id).toBe("2");
    expect(result[2].id).toBe("3");
  });

  it("excludes the current inbound message", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "3", content: "current" }),
        makeRawMsg({ id: "2", content: "previous" }),
        makeRawMsg({ id: "1", content: "first" }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
      excludeMessageId: "3",
    });

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("skips system messages (type 21 = thread created)", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "2", content: "real message" }),
        makeRawMsg({ id: "1", content: "", type: 21 }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("skips messages with no text content", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "2", content: "has text" }),
        makeRawMsg({ id: "1", content: "   ", embeds: [] }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("has text");
  });

  it("falls back to embed text when content is empty", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({
          id: "1",
          content: "",
          embeds: [{ title: "Alert", description: "Something happened" }],
        }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Alert\nSomething happened");
  });

  it("paginates through multiple pages", async () => {
    // First page: 100 messages (ids 200..101), second page: 100 (ids 100..1), third: empty
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeRawMsg({ id: String(200 - i), content: `msg-${200 - i}` }),
    );
    const page2 = Array.from({ length: 100 }, (_, i) =>
      makeRawMsg({ id: String(100 - i), content: `msg-${100 - i}` }),
    );
    const client = makeMockClient([page1, page2, []]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toHaveLength(200);
    // Should be chronological
    expect(result[0].id).toBe("1");
    expect(result[199].id).toBe("200");
  });

  it("resolves author name from member nick", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({
          id: "1",
          content: "hi",
          member: { nick: "Frankie", displayName: null },
          username: "frank123",
        }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result[0].authorName).toBe("Frankie");
  });

  it("resolves author name from global_name when no nick", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({
          id: "1",
          content: "hi",
          global_name: "FrankGlobal",
          username: "frank123",
        }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result[0].authorName).toBe("FrankGlobal");
  });

  it("marks bot messages correctly", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "2", content: "bot msg", bot: true }),
        makeRawMsg({ id: "1", content: "user msg", bot: false }),
      ],
    ]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result[0].isBot).toBe(false);
    expect(result[1].isBot).toBe(true);
  });

  it("returns empty array on API error", async () => {
    const client = {
      rest: {
        get: vi.fn().mockRejectedValue(new Error("403 Forbidden")),
      },
    } as unknown as Client;

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toEqual([]);
  });

  it("handles empty thread", async () => {
    const client = makeMockClient([[]]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result).toEqual([]);
  });

  it("caps at 500 messages to prevent runaway fetches", async () => {
    // 6 pages of 100 = 600, should cap at 500
    const pages = Array.from({ length: 6 }, (_, pageIdx) =>
      Array.from({ length: 100 }, (_, i) =>
        makeRawMsg({
          id: String(600 - pageIdx * 100 - i),
          content: `msg`,
        }),
      ),
    );
    const client = makeMockClient([...pages, []]);

    const result = await fetchDiscordThreadMessages({
      client,
      threadChannelId: "thread-1",
    });

    expect(result.length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// selectThreadStartingMessages
// ---------------------------------------------------------------------------

describe("selectThreadStartingMessages", () => {
  it("returns only the first two chronological messages", () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeThreadMsg({ id: `msg-${i}`, content: `message ${i}` }),
    );
    const result = selectThreadStartingMessages(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("msg-0");
    expect(result[1]?.id).toBe("msg-1");
  });

  it("handles empty and short arrays", () => {
    expect(selectThreadStartingMessages([])).toHaveLength(0);
    expect(selectThreadStartingMessages([makeThreadMsg({ id: "only" })])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// formatDiscordThreadHistory
// ---------------------------------------------------------------------------

describe("formatDiscordThreadHistory", () => {
  it("returns undefined for empty messages", () => {
    const result = formatDiscordThreadHistory({ messages: [] });
    expect(result).toBeUndefined();
  });

  it("formats messages with sender labels including role", () => {
    const result = formatDiscordThreadHistory({
      messages: [
        makeThreadMsg({ authorName: "frank", isBot: false, content: "hello" }),
        makeThreadMsg({ authorName: "Doreamon", isBot: true, content: "hi back" }),
      ],
    });

    expect(result).toBeDefined();
    expect(result).toContain("frank (user)");
    expect(result).toContain("Doreamon (assistant)");
    expect(result).toContain("hello");
    expect(result).toContain("hi back");
  });

  it("uses botUserId to identify assistant messages even if isBot is false", () => {
    const result = formatDiscordThreadHistory({
      messages: [
        makeThreadMsg({ authorId: "bot-123", isBot: false, authorName: "Bot", content: "hi" }),
      ],
      botUserId: "bot-123",
    });

    expect(result).toContain("Bot (assistant)");
  });

  it("includes discord message id in each entry", () => {
    const result = formatDiscordThreadHistory({
      messages: [makeThreadMsg({ id: "msg-42", content: "test" })],
    });

    expect(result).toContain("[discord message id: msg-42]");
  });

  it("keeps only starter + first reply and wraps in thread_starting_messages tags", () => {
    const msgs = Array.from({ length: 5 }, (_, i) =>
      makeThreadMsg({ id: `msg-${i}`, content: `message ${i}` }),
    );

    const result = formatDiscordThreadHistory({ messages: msgs });

    expect(result).toBeDefined();
    expect(result).toContain("<thread_starting_messages>");
    expect(result).toContain("</thread_starting_messages>");
    expect(result).toContain("message 0");
    expect(result).toContain("message 1");
    expect(result).not.toContain("message 2");
  });
});

// ---------------------------------------------------------------------------
// resolveDiscordThreadHistory (integration)
// ---------------------------------------------------------------------------

describe("resolveDiscordThreadHistory", () => {
  beforeEach(() => {
    __resetDiscordThreadHistoryCacheForTest();
  });

  it("fetches and formats thread history", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "2", content: "second", bot: true }),
        makeRawMsg({ id: "1", content: "first" }),
      ],
    ]);

    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "3",
    });

    expect(result).toBeDefined();
    expect(result).toContain("first");
    expect(result).toContain("second");
  });

  it("excludes current message from output", async () => {
    const client = makeMockClient([
      [
        makeRawMsg({ id: "2", content: "current msg" }),
        makeRawMsg({ id: "1", content: "old msg" }),
      ],
    ]);

    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "2",
    });

    expect(result).toBeDefined();
    expect(result).toContain("old msg");
    expect(result).not.toContain("current msg");
  });

  it("returns undefined when thread is empty", async () => {
    const client = makeMockClient([[]]);

    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "1",
    });

    expect(result).toBeUndefined();
  });

  it("uses cache on subsequent calls within TTL", async () => {
    const get = vi.fn().mockResolvedValue([makeRawMsg({ id: "1", content: "cached" })]);
    const client = { rest: { get } } as unknown as Client;

    // First call fetches
    await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "99",
    });
    expect(get).toHaveBeenCalledTimes(1);

    // Second call uses cache
    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "99",
    });
    expect(get).toHaveBeenCalledTimes(1); // no additional call
    expect(result).toContain("cached");
  });

  it("cache still filters out current message even with different currentMessageId", async () => {
    const get = vi
      .fn()
      .mockResolvedValue([
        makeRawMsg({ id: "3", content: "msg three" }),
        makeRawMsg({ id: "2", content: "msg two" }),
        makeRawMsg({ id: "1", content: "msg one" }),
      ]);
    const client = { rest: { get } } as unknown as Client;

    // First call with currentMessageId "3"
    const result1 = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "3",
    });
    expect(result1).toBeDefined();
    expect(result1).not.toContain("[discord message id: 3]");
    expect(result1).toContain("msg one");
    expect(result1).toContain("msg two");

    // Second call with currentMessageId "2" — uses cache but filters differently
    const result2 = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "2",
    });
    expect(get).toHaveBeenCalledTimes(1); // still cached
    expect(result2).toBeDefined();
    expect(result2).not.toContain("[discord message id: 2]");
    expect(result2).toContain("msg one");
    expect(result2).toContain("msg three");
  });

  it("identifies bot messages via botUserId parameter", async () => {
    const client = makeMockClient([
      [makeRawMsg({ id: "1", content: "bot says hi", bot: false, authorId: "bot-id" })],
    ]);

    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "99",
      botUserId: "bot-id",
    });

    expect(result).toContain("(assistant)");
  });

  it("returns undefined when only the current message exists", async () => {
    const client = makeMockClient([[makeRawMsg({ id: "1", content: "only message" })]]);

    const result = await resolveDiscordThreadHistory({
      client,
      threadChannelId: "thread-1",
      currentMessageId: "1",
    });

    expect(result).toBeUndefined();
  });
});
