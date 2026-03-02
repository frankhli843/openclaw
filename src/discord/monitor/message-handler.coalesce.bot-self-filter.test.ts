/**
 * Test suite: Discord message coalescing — bot-self message filtering
 *
 * Reproduces the bug where the bot's own outgoing messages (received back
 * via MESSAGE_CREATE) enter the durable queue and poison coalesced batches.
 *
 * When the bot's message is the last event in a batch, the synthetic
 * coalesced message inherits the bot's author, causing preflight to drop
 * the entire batch (including valid user messages).
 *
 * Fix: filter out bot-self messages in the coalesce handler before building
 * the synthetic message.
 */
import type { Client } from "@buape/carbon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasControlCommand: vi.fn<(text?: string) => boolean>(),
  buildCollectPrompt: vi.fn(),
  preflightDiscordMessage: vi.fn(),
  processDiscordMessage: vi.fn(),
  resolveDiscordMessageText: vi.fn<(message: unknown, opts?: unknown) => string>(),
}));

vi.mock("../../auto-reply/command-detection.js", () => ({
  hasControlCommand: mocks.hasControlCommand,
}));

vi.mock("../../utils/queue-helpers.js", () => ({
  buildCollectPrompt: mocks.buildCollectPrompt,
}));

vi.mock("./message-handler.preflight.js", () => ({
  preflightDiscordMessage: mocks.preflightDiscordMessage,
}));

vi.mock("./message-handler.process.js", () => ({
  processDiscordMessage: mocks.processDiscordMessage,
}));

vi.mock("./message-utils.js", () => ({
  resolveDiscordMessageText: mocks.resolveDiscordMessageText,
}));

import type { DurableDiscordInboundEvent } from "./inbound-durable-queue.js";
import { createCoalescedDiscordMessageHandler } from "./message-handler.coalesce.js";

type CoalescedParams = Parameters<typeof createCoalescedDiscordMessageHandler>[0];

const BOT_USER_ID = "bot-123";
const USER_ID = "user-456";

function makeEvent(overrides: {
  messageId: string;
  content: string;
  authorId?: string;
  authorUsername?: string;
  mentionedUsers?: Array<{ id: string }>;
  mentionedEveryone?: boolean;
  mentionedRoles?: Array<{ id: string }>;
  attachments?: unknown[];
  referencedMessage?: unknown;
  timestamp?: string;
  authorBot?: boolean;
}): DurableDiscordInboundEvent {
  return {
    accountId: "default",
    channelId: "ch1",
    orderingKey: "ch1",
    messageId: overrides.messageId,
    payload: {
      message: {
        id: overrides.messageId,
        content: overrides.content,
        mentionedUsers: overrides.mentionedUsers ?? [],
        mentionedEveryone: overrides.mentionedEveryone ?? false,
        mentionedRoles: overrides.mentionedRoles ?? [],
        attachments: overrides.attachments ?? [],
        referencedMessage: overrides.referencedMessage,
        timestamp: overrides.timestamp ?? new Date().toISOString(),
      },
      author: {
        id: overrides.authorId ?? USER_ID,
        username: overrides.authorUsername ?? "testuser",
        bot: overrides.authorBot ?? false,
      },
    },
  };
}

function createHandler() {
  return createCoalescedDiscordMessageHandler({
    cfg: { messages: { ackReactionScope: "group-mentions" } } as unknown,
    accountId: "test-account",
    runtime: {} as unknown,
    botUserId: BOT_USER_ID,
    guildEntries: {} as unknown,
  } as unknown as CoalescedParams);
}

const fakeClient = {} as Client;

describe("coalesced message handler — bot-self message filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasControlCommand.mockReturnValue(false);
    mocks.resolveDiscordMessageText.mockImplementation((msg: unknown) => {
      if (msg && typeof msg === "object" && "content" in msg) {
        const content = (msg as { content?: unknown }).content;
        return typeof content === "string" ? content : "";
      }
      return "";
    });
    mocks.buildCollectPrompt.mockReturnValue("coalesced body");
    mocks.preflightDiscordMessage.mockResolvedValue({
      wasMentioned: true,
      effectiveWasMentioned: true,
    });
  });

  it("should filter out bot-self messages from a batch, processing only user messages", async () => {
    const handler = createHandler();

    const events = [
      makeEvent({ messageId: "msg1", content: "user question 1", authorId: USER_ID }),
      makeEvent({ messageId: "msg2", content: "user question 2", authorId: USER_ID }),
      makeEvent({
        messageId: "msg3",
        content: "bot response",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    // Preflight should be called with a synthetic message NOT from the bot
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const preflightCall = mocks.preflightDiscordMessage.mock.calls[0][0];
    // The author should be from user messages, not the bot
    expect(preflightCall.data.author.id).not.toBe(BOT_USER_ID);
    expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);
  });

  it("should skip entirely when batch contains only bot-self messages", async () => {
    const handler = createHandler();

    const events = [
      makeEvent({
        messageId: "msg1",
        content: "bot response 1",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
      makeEvent({
        messageId: "msg2",
        content: "bot response 2",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    expect(mocks.preflightDiscordMessage).not.toHaveBeenCalled();
    expect(mocks.processDiscordMessage).not.toHaveBeenCalled();
  });

  it("should process single user message when bot message is filtered from batch of 2", async () => {
    const handler = createHandler();

    const events = [
      makeEvent({ messageId: "msg1", content: "user question", authorId: USER_ID }),
      makeEvent({
        messageId: "msg2",
        content: "bot response",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    // After filtering, only 1 user message remains → single-message path
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const preflightCall = mocks.preflightDiscordMessage.mock.calls[0][0];
    expect(preflightCall.data.author.id).toBe(USER_ID);
    expect(preflightCall.data.message.content).toBe("user question");
  });

  it("should preserve user messages even when bot message is last in batch (the poisoning scenario)", async () => {
    // This is the exact production scenario: user sends 3 msgs while agent
    // is busy, agent responds, response enters queue as 4th event.
    // Without the fix, lastData=bot → preflight drops all 4.
    const handler = createHandler();

    const events = [
      makeEvent({
        messageId: "msg1",
        content: "Does the AI know about skills?",
        authorId: USER_ID,
      }),
      makeEvent({ messageId: "msg2", content: "Does it require other skills?", authorId: USER_ID }),
      makeEvent({ messageId: "msg3", content: "It shouldn't SSH directly", authorId: USER_ID }),
      makeEvent({
        messageId: "msg4",
        content: "Yes! It's showing as ready in the skills list...",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    // All 3 user messages should be processed; bot message filtered out
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);

    // buildCollectPrompt should receive 3 items (not 4)
    expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
    const collectArgs = mocks.buildCollectPrompt.mock.calls[0][0];
    expect(collectArgs.items).toHaveLength(3);
    expect(
      collectArgs.items.map(
        (i: unknown) => (i as { data: { message: { id: string } } }).data.message.id,
      ),
    ).toEqual(["msg1", "msg2", "msg3"]);
  });

  it("should not filter messages when botUserId is not set", async () => {
    const handler = createCoalescedDiscordMessageHandler({
      cfg: { messages: { ackReactionScope: "group-mentions" } } as unknown,
      accountId: "test-account",
      runtime: {} as unknown,
      botUserId: undefined,
      guildEntries: {} as unknown,
    } as unknown as CoalescedParams);

    const events = [
      makeEvent({ messageId: "msg1", content: "user msg", authorId: USER_ID }),
      makeEvent({
        messageId: "msg2",
        content: "bot msg",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    // Without botUserId, no filtering occurs — both messages processed
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    // buildCollectPrompt gets both items
    expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
    const collectArgs = mocks.buildCollectPrompt.mock.calls[0][0];
    expect(collectArgs.items).toHaveLength(2);
  });

  it("should filter bot messages from command events too", async () => {
    mocks.hasControlCommand.mockImplementation((text?: string) => text?.startsWith("/") ?? false);

    const handler = createHandler();

    const events = [
      makeEvent({ messageId: "msg1", content: "/status", authorId: BOT_USER_ID, authorBot: true }),
      makeEvent({ messageId: "msg2", content: "user question", authorId: USER_ID }),
    ];

    await handler(events, fakeClient);

    // Bot command should be filtered; only user question processed
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const preflightCall = mocks.preflightDiscordMessage.mock.calls[0][0];
    expect(preflightCall.data.author.id).toBe(USER_ID);
  });

  it("should correctly set lastData to last user message after filtering", async () => {
    const handler = createHandler();

    const events = [
      makeEvent({
        messageId: "msg1",
        content: "first user msg",
        authorId: USER_ID,
        mentionedUsers: [{ id: BOT_USER_ID }],
      }),
      makeEvent({ messageId: "msg2", content: "second user msg", authorId: USER_ID }),
      makeEvent({
        messageId: "msg3",
        content: "bot response",
        authorId: BOT_USER_ID,
        authorBot: true,
      }),
    ];

    await handler(events, fakeClient);

    // The synthetic message should use the last USER message as lastData
    const preflightCall = mocks.preflightDiscordMessage.mock.calls[0][0];
    expect(preflightCall.data.author.id).toBe(USER_ID);
    // Mention from msg1 should still be merged in
    expect(preflightCall.data.message.mentionedUsers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: BOT_USER_ID })]),
    );
  });
});
