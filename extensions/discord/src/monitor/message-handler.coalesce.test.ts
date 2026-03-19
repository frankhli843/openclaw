import type { Client } from "@buape/carbon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasControlCommand: vi.fn<(text?: string) => boolean>(),
  buildCollectPrompt: vi.fn(),
  preflightDiscordMessage: vi.fn(),
  processDiscordMessage: vi.fn(),
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

import { createCoalescedDiscordMessageHandler } from "./message-handler.coalesce.js";

describe("createCoalescedDiscordMessageHandler", () => {
  const baseParams = {
    cfg: { messages: {} },
    discordConfig: {},
    accountId: "default",
    token: "token",
    runtime: {},
    botUserId: "bot",
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
    mocks.processDiscordMessage.mockResolvedValue(undefined);
  });

  it("fast-lanes command messages and coalesces regular messages", async () => {
    mocks.hasControlCommand.mockImplementation((text?: string) =>
      String(text ?? "").startsWith("/"),
    );

    const handler = createCoalescedDiscordMessageHandler(baseParams);
    await handler(
      [
        {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m1",
          payload: { message: { content: "/status" }, author: { username: "Frank" } },
        },
        {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m2",
          payload: { message: { content: "hello" }, author: { username: "Frank" } },
        },
        {
          accountId: "default",
          channelId: "c1",
          orderingKey: "c1",
          messageId: "m3",
          payload: { message: { content: "world" }, author: { username: "Frank" } },
        },
      ],
      client,
    );

    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(2);
    expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(2);

    const firstPreflightData = mocks.preflightDiscordMessage.mock.calls[0]?.[0]?.data as {
      message?: { content?: string };
    };
    const secondPreflightData = mocks.preflightDiscordMessage.mock.calls[1]?.[0]?.data as {
      message?: { content?: string };
    };

    expect(firstPreflightData.message?.content).toBe("/status");
    expect(secondPreflightData.message?.content).toBe("COALESCED_PROMPT");
  });

  it("processes a single regular message individually", async () => {
    mocks.hasControlCommand.mockReturnValue(false);
    const handler = createCoalescedDiscordMessageHandler(baseParams);

    await handler(
      [
        {
          accountId: "default",
          channelId: "thread-1",
          orderingKey: "thread-1",
          messageId: "m1",
          payload: { message: { content: "thread message" }, author: { username: "Frank" } },
        },
      ],
      client,
    );

    expect(mocks.buildCollectPrompt).not.toHaveBeenCalled();
    expect(mocks.preflightDiscordMessage).toHaveBeenCalledTimes(1);
    const data = mocks.preflightDiscordMessage.mock.calls[0]?.[0]?.data as {
      message?: { content?: string };
    };
    expect(data.message?.content).toBe("thread message");
    expect(mocks.processDiscordMessage).toHaveBeenCalledTimes(1);
  });
});
