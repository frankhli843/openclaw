/**
 * Frankclaw-specific coalesce tests.
 * Upstream coalesce tests live in message-handler.coalesce.test.ts.
 * These tests focus on frankclaw-specific behavior:
 *   - Bot self-message filtering
 *   - Merged mention metadata deduplication
 *   - Coalesced body format with author/timestamp
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../internal/discord.js";

const mocks = vi.hoisted(() => ({
  hasControlCommand: vi.fn<(text?: string) => boolean>(),
  buildCollectPrompt: vi.fn(),
  preflightDiscordMessage: vi.fn(),
  processDiscordMessage: vi.fn(),
}));

vi.mock("../../../../src/auto-reply/command-detection.js", () => ({
  hasControlCommand: mocks.hasControlCommand,
}));

vi.mock("../../../../src/utils/queue-helpers.js", () => ({
  buildCollectPrompt: mocks.buildCollectPrompt,
}));

vi.mock("./message-handler.preflight.js", () => ({
  preflightDiscordMessage: mocks.preflightDiscordMessage,
}));

vi.mock("./message-handler.process.js", () => ({
  processDiscordMessage: mocks.processDiscordMessage,
}));

import { createCoalescedDiscordMessageHandler } from "./message-handler.coalesce.js";

describe("frankclaw coalesce extensions", () => {
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
    mocks.hasControlCommand.mockReset();
    mocks.buildCollectPrompt.mockReset();
    mocks.preflightDiscordMessage.mockReset();
    mocks.processDiscordMessage.mockReset();

    mocks.buildCollectPrompt.mockReturnValue("COALESCED_PROMPT");
    mocks.preflightDiscordMessage.mockImplementation(async (params: { data: unknown }) => {
      return { payload: params.data };
    });
  });

  it("filters out bot-self messages from regular batch", async () => {
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const events = [
      {
        channelId: "ch1",
        payload: {
          message: { id: "m1", content: "user msg", _rawData: {} },
          author: { id: "user1" },
        },
      },
      {
        channelId: "ch1",
        payload: {
          message: { id: "m2", content: "bot reply", _rawData: {} },
          author: { id: "bot123" },
        },
      },
    ] as any;

    await handler(events, client);

    // Only the user message should go through preflight (bot message filtered)
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const calledData = mocks.preflightDiscordMessage.mock.calls[0][0].data;
    expect(calledData.message.id).toBe("m1");
  });

  it("skips entire batch when all events are bot-self messages", async () => {
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const events = [
      {
        channelId: "ch1",
        payload: {
          message: { id: "m1", content: "bot msg", _rawData: {} },
          author: { id: "bot123" },
        },
      },
    ] as any;

    await handler(events, client);

    expect(mocks.preflightDiscordMessage).not.toHaveBeenCalled();
    expect(mocks.processDiscordMessage).not.toHaveBeenCalled();
  });

  it("merges mentionedUsers from all events in a multi-message batch", async () => {
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const events = [
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m1",
            content: "hello",
            _rawData: {},
            mentionedUsers: [{ id: "u1", username: "alice" }],
            mentionedRoles: [],
          },
          author: { id: "user1", username: "alice" },
        },
      },
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m2",
            content: "world",
            _rawData: {},
            mentionedUsers: [{ id: "u2", username: "bob" }],
            mentionedRoles: [{ id: "r1", name: "admin" }],
          },
          author: { id: "user2", username: "bob" },
        },
      },
    ] as any;

    await handler(events, client);

    // Should be called with synthetic data containing merged mentions
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const calledData = mocks.preflightDiscordMessage.mock.calls[0][0].data;
    expect(calledData.message.mentionedUsers).toHaveLength(2);
    expect(calledData.message.mentionedRoles).toHaveLength(1);
  });

  it("deduplicates mentionedUsers by id across events", async () => {
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const events = [
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m1",
            content: "msg1",
            _rawData: {},
            mentionedUsers: [{ id: "u1", username: "alice" }],
            mentionedRoles: [],
          },
          author: { id: "user1" },
        },
      },
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m2",
            content: "msg2",
            _rawData: {},
            mentionedUsers: [{ id: "u1", username: "alice" }],
            mentionedRoles: [],
          },
          author: { id: "user2" },
        },
      },
    ] as any;

    await handler(events, client);

    const calledData = mocks.preflightDiscordMessage.mock.calls[0][0].data;
    expect(calledData.message.mentionedUsers).toHaveLength(1);
    expect(calledData.message.mentionedUsers[0].id).toBe("u1");
  });

  it("preserves referencedMessage from earliest event", async () => {
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const refMsg = { id: "ref1", content: "original" };
    const events = [
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m1",
            content: "reply",
            _rawData: {},
            referencedMessage: refMsg,
            mentionedUsers: [],
            mentionedRoles: [],
          },
          author: { id: "user1" },
        },
      },
      {
        channelId: "ch1",
        payload: {
          message: {
            id: "m2",
            content: "follow up",
            _rawData: {},
            mentionedUsers: [],
            mentionedRoles: [],
          },
          author: { id: "user2" },
        },
      },
    ] as any;

    await handler(events, client);

    const calledData = mocks.preflightDiscordMessage.mock.calls[0][0].data;
    expect(calledData.message.referencedMessage).toBe(refMsg);
  });

  it("throws COALESCE_PREFLIGHT_REJECTED when batch preflight fails", async () => {
    mocks.preflightDiscordMessage.mockResolvedValue(null);

    const handler = createCoalescedDiscordMessageHandler(baseParams);

    const events = [
      {
        channelId: "ch1",
        payload: {
          message: { id: "m1", content: "a", _rawData: {}, mentionedUsers: [], mentionedRoles: [] },
          author: { id: "user1" },
        },
      },
      {
        channelId: "ch1",
        payload: {
          message: { id: "m2", content: "b", _rawData: {}, mentionedUsers: [], mentionedRoles: [] },
          author: { id: "user2" },
        },
      },
    ] as any;

    await expect(handler(events, client)).rejects.toThrow("COALESCE_PREFLIGHT_REJECTED");
  });
});
