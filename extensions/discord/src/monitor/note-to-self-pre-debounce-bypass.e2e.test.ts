/**
 * E2E test for "Note-to-self pre-debounce bypass" feature.
 *
 * Verifies that bot-self messages with the note-to-self prefix bypass the
 * pre-debounce filter and reach preflight, while regular bot-self messages
 * are still dropped. This exercises the full handler chain wiring.
 */
import { describe, expect, it } from "vitest";
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

function createBotMessage(content: string, channelId = "ch-e2e") {
  return {
    author: { id: DEFAULT_DISCORD_BOT_USER_ID, bot: true },
    message: {
      id: "msg-e2e-1",
      author: { id: DEFAULT_DISCORD_BOT_USER_ID, bot: true },
      content,
      channel_id: channelId,
    },
    channel_id: channelId,
  };
}

describe("Note-to-self pre-debounce bypass (e2e)", () => {
  it("canonical prefix bypasses debounce and reaches preflight", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();
    preflightDiscordMessageMock.mockImplementation(
      async (params: { data: { channel_id: string } }) =>
        createDiscordPreflightContext(params.data.channel_id),
    );

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createBotMessage("[Doramon note to self] Background check completed");

    await handler(data as never, {} as never);
    await flushAsyncWork();

    expect(preflightDiscordMessageMock).toHaveBeenCalledTimes(1);
  });

  it("legacy prefix bypasses debounce and reaches preflight", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();
    preflightDiscordMessageMock.mockImplementation(
      async (params: { data: { channel_id: string } }) =>
        createDiscordPreflightContext(params.data.channel_id),
    );

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createBotMessage("[doramon you forgot to answer!]: recovery message");

    await handler(data as never, {} as never);
    await flushAsyncWork();

    expect(preflightDiscordMessageMock).toHaveBeenCalledTimes(1);
  });

  it("bot-self message without prefix is still blocked pre-debounce", async () => {
    preflightDiscordMessageMock.mockReset();
    processDiscordMessageMock.mockReset();

    const handler = createDiscordMessageHandler(createDiscordHandlerParams());
    const data = createBotMessage("regular bot echo");

    await handler(data as never, {} as never);
    await flushAsyncWork();

    expect(preflightDiscordMessageMock).not.toHaveBeenCalled();
    expect(processDiscordMessageMock).not.toHaveBeenCalled();
  });
});
