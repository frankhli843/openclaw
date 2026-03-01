/**
 * Test suite: Discord coalesce — mention metadata must be merged from ALL events.
 *
 * These tests assert the CORRECT behavior. They currently FAIL because the
 * coalesced handler builds syntheticData from `...lastData`, losing mention
 * metadata from earlier messages.
 *
 * When the fix is applied, these tests should pass.
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
        referencedMessage: overrides.referencedMessage ?? null,
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

describe("coalesce mention merge (correct behavior)", () => {
  /**
   * Helper: captures the syntheticData.message passed to preflightDiscordMessage.
   */
  function capturePreflightMessage() {
    mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
      return { payload: params.data };
    });
  }

  function getPreflightMessage(): Record<string, unknown> {
    const call = mocks.preflightDiscordMessage.mock.calls[0]?.[0] as {
      data: { message?: Record<string, unknown> };
    };
    return call.data.message ?? {};
  }

  describe("mentionedUsers", () => {
    it("bot mention in first message, no mention in last → bot mention preserved", async () => {
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "<@bot123> do X",
            mentionedUsers: [{ id: "bot123" }],
          }),
          makeEvent({
            messageId: "m2",
            content: "also do Y",
            mentionedUsers: [],
          }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      const users = msg.mentionedUsers as Array<{ id: string }>;
      expect(users.some((u) => u.id === "bot123")).toBe(true);
    });

    it("bot mention in middle message only → bot mention preserved", async () => {
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({ messageId: "m1", content: "hello", mentionedUsers: [] }),
          makeEvent({
            messageId: "m2",
            content: "<@bot123> do X",
            mentionedUsers: [{ id: "bot123" }],
          }),
          makeEvent({ messageId: "m3", content: "thanks", mentionedUsers: [] }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      const users = msg.mentionedUsers as Array<{ id: string }>;
      expect(users.some((u) => u.id === "bot123")).toBe(true);
    });

    it("multiple users mentioned across messages → all preserved, deduplicated", async () => {
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "<@bot123> <@user2>",
            mentionedUsers: [{ id: "bot123" }, { id: "user2" }],
          }),
          makeEvent({
            messageId: "m2",
            content: "<@bot123> <@user3>",
            mentionedUsers: [{ id: "bot123" }, { id: "user3" }],
          }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      const users = msg.mentionedUsers as Array<{ id: string }>;
      const ids = users.map((u) => u.id);

      expect(ids).toContain("bot123");
      expect(ids).toContain("user2");
      expect(ids).toContain("user3");
      // No duplicates
      expect(ids.filter((id) => id === "bot123")).toHaveLength(1);
    });
  });

  describe("mentionedRoles", () => {
    it("role mention in first message, none in last → role preserved", async () => {
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "<@&role1> check this",
            mentionedRoles: [{ id: "role1" }],
          }),
          makeEvent({
            messageId: "m2",
            content: "details here",
            mentionedRoles: [],
          }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      const roles = msg.mentionedRoles as Array<{ id: string }>;
      expect(roles.some((r) => r.id === "role1")).toBe(true);
    });
  });

  describe("mentionedEveryone", () => {
    it("@everyone in first message, not in last → flag preserved as true", async () => {
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "@everyone look",
            mentionedEveryone: true,
          }),
          makeEvent({
            messageId: "m2",
            content: "details",
            mentionedEveryone: false,
          }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      expect(msg.mentionedEveryone).toBe(true);
    });
  });

  describe("referencedMessage (implicit mention via reply)", () => {
    it("reply-to-bot in first message, plain follow-up last → referencedMessage preserved", async () => {
      /**
       * Preflight checks message.referencedMessage?.author?.id === botId for
       * implicit mention. If user replies to bot in msg1 then sends plain msg2,
       * the synthetic message loses the referencedMessage from msg1.
       */
      capturePreflightMessage();
      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "yes do it",
            referencedMessage: { author: { id: "bot123" }, id: "bot-prev-msg" },
          }),
          makeEvent({
            messageId: "m2",
            content: "and also this other thing",
          }),
        ],
        client,
      );

      const msg = getPreflightMessage();
      const ref = msg.referencedMessage as { author?: { id: string } } | undefined;
      // The reply-to-bot context from msg1 should survive in the synthetic message
      expect(ref?.author?.id).toBe("bot123");
    });
  });

  describe("combined scenario — real-world reproduction", () => {
    it("user @mentions bot then sends follow-up → batch is processed, not dropped", async () => {
      /**
       * Real-world scenario from WWSA Discord group:
       * 1. Chris sends "@Doraemon thanks" (has bot mention)
       * 2. Chris sends "Can we run a report..." (no mention)
       * 3. Both arrive in debounce window → coalesced
       * 4. Synthetic message built from msg2 (lastData)
       * 5. BUG: preflight sees no mention on synthetic → drops ENTIRE batch
       *
       * With fix: mention from msg1 merged into synthetic → preflight passes.
       */
      let preflightCallCount = 0;
      mocks.preflightDiscordMessage.mockImplementation(
        async (params: { data: { message?: { mentionedUsers?: Array<{ id: string }> } } }) => {
          preflightCallCount++;
          // Simulate mention-gating: only pass if bot is mentioned
          const users = params.data.message?.mentionedUsers ?? [];
          const botMentioned = users.some((u) => u.id === "bot123");
          if (!botMentioned) {
            return null; // dropped by mention gate
          }
          return { payload: params.data };
        },
      );

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "<@bot123> thanks",
            authorId: "chris",
            authorUsername: "Chris",
            mentionedUsers: [{ id: "bot123" }],
          }),
          makeEvent({
            messageId: "m2",
            content: "Can we run a report to determine which products sales are trending?",
            authorId: "chris",
            authorUsername: "Chris",
            mentionedUsers: [],
          }),
        ],
        client,
      );

      // The batch should NOT be dropped — the merged mention should pass preflight
      expect(preflightCallCount).toBe(1);
      expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);
    });

    it("reply-to-bot + plain follow-up in mention-gated channel → not dropped", async () => {
      /**
       * Real scenario: user clicks "Reply" on bot message (implicit mention),
       * then sends a second plain message before bot responds. Both coalesced.
       * Synthetic message loses referencedMessage → implicit mention lost →
       * preflight drops batch.
       */
      let preflightCallCount = 0;
      mocks.preflightDiscordMessage.mockImplementation(
        async (params: {
          data: {
            message?: {
              mentionedUsers?: Array<{ id: string }>;
              referencedMessage?: { author?: { id: string } };
            };
          };
        }) => {
          preflightCallCount++;
          // Simulate: pass if bot explicitly mentioned OR replied to
          const users = params.data.message?.mentionedUsers ?? [];
          const botMentioned = users.some((u) => u.id === "bot123");
          const repliedToBot = params.data.message?.referencedMessage?.author?.id === "bot123";
          if (!botMentioned && !repliedToBot) {
            return null; // dropped
          }
          return { payload: params.data };
        },
      );

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "yes please proceed",
            referencedMessage: { author: { id: "bot123" }, id: "prev-bot-msg" },
            mentionedUsers: [],
          }),
          makeEvent({
            messageId: "m2",
            content: "oh and also check the inventory report",
            mentionedUsers: [],
          }),
        ],
        client,
      );

      expect(preflightCallCount).toBe(1);
      expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);
    });

    it("three rapid messages: mention, plain, plain → all three in coalesced body, not dropped", async () => {
      /**
       * User rapidly sends 3 messages in a mention-gated guild channel.
       * Only first has @bot mention. All 3 should be coalesced and processed.
       */
      mocks.preflightDiscordMessage.mockImplementation(
        async (params: { data: { message?: { mentionedUsers?: Array<{ id: string }> } } }) => {
          const users = params.data.message?.mentionedUsers ?? [];
          if (!users.some((u) => u.id === "bot123")) {
            return null;
          }
          return { payload: params.data };
        },
      );

      const handler = createCoalescedDiscordMessageHandler(baseParams);

      await handler(
        [
          makeEvent({
            messageId: "m1",
            content: "<@bot123> I need three things",
            mentionedUsers: [{ id: "bot123" }],
          }),
          makeEvent({
            messageId: "m2",
            content: "first check the sales data",
            mentionedUsers: [],
          }),
          makeEvent({
            messageId: "m3",
            content: "then generate the monthly report",
            mentionedUsers: [],
          }),
        ],
        client,
      );

      expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);
      // Verify all 3 messages were passed to buildCollectPrompt
      const promptArgs = mocks.buildCollectPrompt.mock.calls[0]?.[0] as { items: unknown[] };
      expect(promptArgs.items).toHaveLength(3);
    });
  });
});
