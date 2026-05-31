import { describe, expect, it, vi } from "vitest";
import {
  createDiscordMessageHandler,
  preflightDiscordMessageMock,
  processDiscordMessageMock,
} from "./message-handler.module-test-helpers.js";
import {
  DEFAULT_DISCORD_BOT_USER_ID,
  createDiscordHandlerParams,
  createDiscordPreflightContext,
} from "./message-handler.test-helpers.js";

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

function createMessageData(authorId: string, channelId = "ch-1") {
  return {
    author: { id: authorId, bot: authorId === DEFAULT_DISCORD_BOT_USER_ID },
    message: {
      id: "msg-1",
      author: { id: authorId, bot: authorId === DEFAULT_DISCORD_BOT_USER_ID },
      content: "hello",
      channel_id: channelId,
    },
    channel_id: channelId,
  };
}

function createPreflightContext(channelId = "ch-1") {
  return createDiscordPreflightContext(channelId);
}

describe("createDiscordMessageHandler bot-self filter", () => {
  it("skips bot-own messages before the debounce queue", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());

    await expect(
      handler(createMessageData(DEFAULT_DISCORD_BOT_USER_ID) as never, {} as never),
    ).resolves.toBeUndefined();

    expect(preflightDiscordMessageMock).not.toHaveBeenCalled();
    expect(processDiscordMessageMock).not.toHaveBeenCalled();
  });

  it("allows bot-own messages with canonical [Doramon note to self] prefix through", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();
    preflightDiscordMessageMock.mockImplementation(
      async (params: { data: { channel_id: string } }) =>
        createPreflightContext(params.data.channel_id),
    );

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createMessageData(DEFAULT_DISCORD_BOT_USER_ID);
    data.message.content = "[Doramon note to self] Background task done: foo";

    await expect(handler(data as never, {} as never)).resolves.toBeUndefined();

    await flushAsyncWork();
    expect(preflightDiscordMessageMock).toHaveBeenCalledTimes(1);
  });

  it("allows bot-own messages with legacy [doramon you forgot to answer!]: prefix through", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();
    preflightDiscordMessageMock.mockImplementation(
      async (params: { data: { channel_id: string } }) =>
        createPreflightContext(params.data.channel_id),
    );

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createMessageData(DEFAULT_DISCORD_BOT_USER_ID);
    data.message.content = "[doramon you forgot to answer!]: some recovery text";

    await expect(handler(data as never, {} as never)).resolves.toBeUndefined();

    await flushAsyncWork();
    expect(preflightDiscordMessageMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks bot-own messages without a note-to-self prefix", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createMessageData(DEFAULT_DISCORD_BOT_USER_ID);
    data.message.content = "just a regular bot message";

    await expect(handler(data as never, {} as never)).resolves.toBeUndefined();

    expect(preflightDiscordMessageMock).not.toHaveBeenCalled();
    expect(processDiscordMessageMock).not.toHaveBeenCalled();
  });

  it("enqueues non-bot messages for processing", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();
    preflightDiscordMessageMock.mockImplementation(
      async (params: { data: { channel_id: string } }) => ({
        ...params,
        ...createPreflightContext(params.data.channel_id),
      }),
    );

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());

    await expect(
      handler(createMessageData("user-456") as never, {} as never),
    ).resolves.toBeUndefined();

    await flushAsyncWork();
    await vi.waitFor(() => {
      expect(preflightDiscordMessageMock).toHaveBeenCalledTimes(1);
      expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);
    });
  });
});
