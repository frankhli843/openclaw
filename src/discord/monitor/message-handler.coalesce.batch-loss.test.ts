/**
 * Test suite: Discord message coalescing — batch loss scenarios
 *
 * Reproduces the bug where the agent ignores some batched requests
 * when multiple messages arrive while it's busy.
 *
 * Two categories of issues:
 *
 * 1. **Mention metadata loss** — The synthetic coalesced message is built
 *    from `lastData` only. If an earlier message had `mentionedUsers` with
 *    the bot but the last message didn't, the merged message loses the
 *    mention. Preflight mention-gating then drops the ENTIRE batch.
 *
 * 2. **Attachment metadata loss** — Similar to mentions, `mentionedRoles`,
 *    `mentionedEveryone`, and reply-reference context from earlier messages
 *    are silently lost in the synthetic message.
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
        id: overrides.authorId ?? "user1",
        username: overrides.authorUsername ?? "Frank",
        globalName: overrides.authorUsername ?? "Frank",
      },
      timestamp: overrides.timestamp ?? new Date().toISOString(),
    },
  };
}

describe("coalesced message batch loss scenarios", () => {
  const baseParams = {
    cfg: { messages: {} },
    discordConfig: {},
    accountId: "default",
    token: "token",
    runtime: {},
    botUserId: "bot123",
    guildHistories: new Map(),
    historyLimit: 10,
    mediaMaxBytes: 5_000_000,
    textLimit: 2000,
    replyToMode: "always",
    dmEnabled: true,
    groupDmEnabled: true,
    groupDmChannels: [],
    allowFrom: [],
    guildEntries: {},
  } as unknown as Parameters<typeof createCoalescedDiscordMessageHandler>[0];

  const client = {} as Client;

  beforeEach(() => {
    mocks.hasControlCommand.mockReset().mockReturnValue(false);
    mocks.buildCollectPrompt.mockReset().mockReturnValue("COALESCED_PROMPT");
    mocks.preflightDiscordMessage.mockReset();
    mocks.processDiscordMessage.mockReset().mockResolvedValue(undefined);
    mocks.resolveDiscordMessageText.mockReset().mockImplementation((msg: unknown) => {
      const m = msg as { content?: string } | undefined;
      return m?.content ?? "";
    });
  });

  describe("Bug: mention metadata lost in coalesced synthetic message", () => {
    it("should preserve mentionedUsers from ALL events, not just the last one", async () => {
      /**
       * Scenario:
       * 1. User sends message B that @mentions the bot ("@bot do X")
       * 2. User quickly sends follow-up C without mention ("also do Y")
       * 3. Both messages are coalesced — synthetic message built from C (last)
       * 4. BUG: synthetic message.mentionedUsers = C's mentionedUsers = []
       *    → preflight sees no mention → drops the entire batch
       *
       * Expected: mentionedUsers should be merged from all events.
       */
      mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
        return { payload: params.data };
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const eventWithMention = makeEvent({
        messageId: "m1",
        content: "<@bot123> do task X",
        mentionedUsers: [{ id: "bot123" }],
      });

      const eventWithoutMention = makeEvent({
        messageId: "m2",
        content: "also do task Y please",
        mentionedUsers: [],
      });

      await handler([eventWithMention, eventWithoutMention], client);

      // Should have been called once with the coalesced message
      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      const preflightCall = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
        data: {
          message?: {
            mentionedUsers?: Array<{ id: string }>;
          };
        };
      };

      // FIXED: The synthetic message now merges mentions from ALL events.
      const syntheticMentionedUsers = preflightCall.data.message?.mentionedUsers ?? [];
      const botMentioned = syntheticMentionedUsers.some((u: { id: string }) => u.id === "bot123");

      expect(botMentioned).toBe(true); // bot mention preserved from earlier event
    });

    it("should preserve mentionedRoles from earlier events", async () => {
      mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
        return { payload: params.data };
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const eventWithRoleMention = makeEvent({
        messageId: "m1",
        content: "<@&role123> check this",
        mentionedRoles: [{ id: "role123" }],
      });

      const followUpEvent = makeEvent({
        messageId: "m2",
        content: "and also this",
        mentionedRoles: [],
      });

      await handler([eventWithRoleMention, followUpEvent], client);

      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      const preflightCall = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
        data: {
          message?: {
            mentionedRoles?: Array<{ id: string }>;
          };
        };
      };

      const syntheticRoles = preflightCall.data.message?.mentionedRoles ?? [];
      const hasRoleMention = syntheticRoles.some((r: { id: string }) => r.id === "role123");

      // FIXED: role mention from first message is preserved
      expect(hasRoleMention).toBe(true);
    });

    it("should preserve mentionedEveryone when any event in the batch has it", async () => {
      mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
        return { payload: params.data };
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const eventWithEveryone = makeEvent({
        messageId: "m1",
        content: "@everyone look at this",
        mentionedEveryone: true,
      });

      const normalFollowup = makeEvent({
        messageId: "m2",
        content: "here are the details",
        mentionedEveryone: false,
      });

      await handler([eventWithEveryone, normalFollowup], client);

      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      const preflightCall = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
        data: {
          message?: {
            mentionedEveryone?: boolean;
          };
        };
      };

      // FIXED: @everyone flag from first message is preserved
      expect(preflightCall.data.message?.mentionedEveryone).toBe(true);
    });
  });

  describe("Coalesced prompt completeness", () => {
    it("all regular messages appear in buildCollectPrompt items", async () => {
      mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
        return { payload: params.data };
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const events = [
        makeEvent({ messageId: "m1", content: "request A" }),
        makeEvent({ messageId: "m2", content: "request B" }),
        makeEvent({ messageId: "m3", content: "request C" }),
      ];

      await handler(events, client);

      // buildCollectPrompt should receive ALL 3 events
      expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
      const callArgs = mocks.buildCollectPrompt.mock.calls[0]?.[0] as {
        items: unknown[];
        renderItem: (item: unknown, idx: number) => string;
      };

      expect(callArgs.items).toHaveLength(3);

      // Verify each message's content is rendered
      const rendered = callArgs.items.map((item, idx) => callArgs.renderItem(item, idx));
      expect(rendered[0]).toContain("request A");
      expect(rendered[1]).toContain("request B");
      expect(rendered[2]).toContain("request C");
    });

    it("command messages are NOT lost — they process individually before the batch", async () => {
      mocks.hasControlCommand.mockImplementation((text?: string) =>
        String(text ?? "").startsWith("/"),
      );
      mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
        return { payload: params.data };
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const events = [
        makeEvent({ messageId: "m1", content: "/status" }),
        makeEvent({ messageId: "m2", content: "do task A" }),
        makeEvent({ messageId: "m3", content: "/reset" }),
        makeEvent({ messageId: "m4", content: "do task B" }),
      ];

      await handler(events, client);

      // Commands processed individually: /status, /reset
      // Regular messages coalesced: task A + task B
      // Total preflight calls: 3 (command, command, coalesced)
      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(3);
      expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(3);

      // Verify command messages went through individually
      const firstData = mocks.preflightDiscordMessage.mock.calls[0]?.[0]?.data as {
        message?: { content?: string };
      };
      expect(firstData.message?.content).toBe("/status");

      const secondData = mocks.preflightDiscordMessage.mock.calls[1]?.[0]?.data as {
        message?: { content?: string };
      };
      expect(secondData.message?.content).toBe("/reset");

      // Third call is the coalesced regular messages
      const thirdData = mocks.preflightDiscordMessage.mock.calls[2]?.[0]?.data as {
        message?: { content?: string };
      };
      expect(thirdData.message?.content).toBe("COALESCED_PROMPT");

      // Verify buildCollectPrompt received both regular messages
      expect(mocks.buildCollectPrompt).toHaveBeenCalledTimes(1);
      const promptArgs = mocks.buildCollectPrompt.mock.calls[0]?.[0] as {
        items: unknown[];
      };
      expect(promptArgs.items).toHaveLength(2);
    });
  });

  describe("Durable queue round-trip: _rawData rehydration", () => {
    /**
     * After JSON round-trip through the durable queue, Carbon Message
     * instances become plain objects.  Getter-backed fields like
     * `mentionedUsers`, `attachments`, `content` only exist inside
     * `_rawData`.  The coalescing handler must rehydrate these so merging
     * works correctly.
     */
    function makeDurableEvent(overrides: {
      messageId: string;
      content: string;
      mentionedUsers?: Array<{ id: string }>;
      attachments?: unknown[];
    }): DurableDiscordInboundEvent {
      return {
        accountId: "default",
        channelId: "ch1",
        orderingKey: "ch1",
        messageId: overrides.messageId,
        payload: {
          message: {
            // After JSON round-trip: no own properties except _rawData
            _rawData: {
              id: overrides.messageId,
              content: overrides.content,
              mentions: overrides.mentionedUsers ?? [],
              mention_roles: [],
              mention_everyone: false,
              attachments: overrides.attachments ?? [],
              type: 0,
            },
          },
          author: {
            id: "user1",
            username: "Frank",
            globalName: "Frank",
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    it("should rehydrate mentions from _rawData and merge across events", async () => {
      mocks.preflightDiscordMessage.mockResolvedValue({
        message: { id: "m2" },
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);
      const events = [
        makeDurableEvent({
          messageId: "m1",
          content: "<@bot123> do task A",
          mentionedUsers: [{ id: "bot123" }],
        }),
        makeDurableEvent({
          messageId: "m2",
          content: "also do task B",
        }),
      ];

      await handler(events, client);

      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      const preflightArgs = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
        data: { message: { mentionedUsers: unknown[] } };
      };
      // Bot mention from m1 should be preserved in the merged synthetic message
      expect(preflightArgs.data.message.mentionedUsers).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "bot123" })]),
      );
    });

    it("should rehydrate attachments from _rawData and merge across events", async () => {
      mocks.preflightDiscordMessage.mockResolvedValue({
        message: { id: "m2" },
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);
      const events = [
        makeDurableEvent({
          messageId: "m1",
          content: "image attached",
          attachments: [
            { id: "att-1", url: "https://cdn.example.com/img.png", filename: "img.png" },
          ],
        }),
        makeDurableEvent({
          messageId: "m2",
          content: "text only follow-up",
        }),
      ];

      await handler(events, client);

      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      const preflightArgs = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
        data: { message: { attachments: unknown[] } };
      };
      // Attachment from m1 should be preserved in merged message
      expect(preflightArgs.data.message.attachments).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "att-1" })]),
      );
    });

    it("should rehydrate content from _rawData for text resolution", async () => {
      mocks.preflightDiscordMessage.mockResolvedValue({
        message: { id: "m1" },
      });

      const handler = createCoalescedDiscordMessageHandler(baseParams);
      const events = [
        makeDurableEvent({
          messageId: "m1",
          content: "first request",
        }),
      ];

      await handler(events, client);

      // resolveDiscordMessageText should have been called with a message
      // that has content accessible (either as own property or via _rawData)
      expect(mocks.resolveDiscordMessageText).toHaveBeenCalled();
    });
  });

  describe("Preflight filtering drops coalesced batch", () => {
    it("when preflight returns null for coalesced batch, throws COALESCE_PREFLIGHT_REJECTED for fallback", async () => {
      /**
       * FIXED: Previously, preflight rejection silently dropped ALL messages.
       * Now the coalesced handler throws COALESCE_PREFLIGHT_REJECTED so the
       * durable queue can fall back to processing each message individually
       * through the single-message path (which handles thread context correctly).
       */
      mocks.preflightDiscordMessage.mockResolvedValue(null); // preflight rejects

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      const events = [
        makeEvent({
          messageId: "m1",
          content: "<@bot123> do task A",
          mentionedUsers: [{ id: "bot123" }],
        }),
        makeEvent({
          messageId: "m2",
          content: "and also do task B",
          mentionedUsers: [],
        }),
      ];

      // Should throw so the durable queue can fall back to individual processing
      await expect(handler(events, client)).rejects.toThrow("COALESCE_PREFLIGHT_REJECTED");

      // Preflight was called but returned null → processDiscordMessage never called
      expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
      expect(mocks.processDiscordMessage).not.toHaveBeenCalled();
    });
  });
});
