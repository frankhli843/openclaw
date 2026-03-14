import { describe, expect, it } from "vitest";
import { rehydrateCarbonMessage, materializeDiscordInboundJob } from "./inbound-job.js";
import type {
  DiscordInboundJob,
  DiscordInboundJobPayload,
  DiscordInboundJobRuntime,
} from "./inbound-job.js";

describe("rehydrateCarbonMessage", () => {
  it("hoists _rawData fields onto a plain object", () => {
    const message = {
      _rawData: {
        attachments: [
          { id: "att-1", url: "https://cdn.example.com/image.png", filename: "image.png" },
        ],
        content: "hello world",
        embeds: [{ title: "embed" }],
        sticker_items: [{ id: "sticker-1" }],
        flags: 0,
        type: 0,
      },
    };

    rehydrateCarbonMessage(message);

    expect((message as Record<string, unknown>).attachments).toEqual([
      { id: "att-1", url: "https://cdn.example.com/image.png", filename: "image.png" },
    ]);
    expect((message as Record<string, unknown>).content).toBe("hello world");
    expect((message as Record<string, unknown>).embeds).toEqual([{ title: "embed" }]);
    expect((message as Record<string, unknown>).sticker_items).toEqual([{ id: "sticker-1" }]);
    expect((message as Record<string, unknown>).flags).toBe(0);
    expect((message as Record<string, unknown>).type).toBe(0);
  });

  it("creates camelCase aliases for Carbon getter names", () => {
    const message = {
      _rawData: {
        mentions: [{ id: "user-1", username: "frank" }],
        mention_roles: [{ id: "role-1", name: "admin" }],
        mention_everyone: true,
        referenced_message: { id: "ref-msg-1", content: "parent" },
        edited_timestamp: "2026-03-10T12:00:00Z",
        sticker_items: [{ id: "sticker-1" }],
      },
    };

    rehydrateCarbonMessage(message);

    // Raw snake_case names should be hoisted
    expect((message as Record<string, unknown>).mentions).toEqual([
      { id: "user-1", username: "frank" },
    ]);
    expect((message as Record<string, unknown>).mention_roles).toEqual([
      { id: "role-1", name: "admin" },
    ]);
    expect((message as Record<string, unknown>).mention_everyone).toBe(true);
    expect((message as Record<string, unknown>).referenced_message).toEqual({
      id: "ref-msg-1",
      content: "parent",
    });

    // CamelCase Carbon aliases should also exist
    expect((message as Record<string, unknown>).mentionedUsers).toEqual([
      { id: "user-1", username: "frank" },
    ]);
    expect((message as Record<string, unknown>).mentionedRoles).toEqual([
      { id: "role-1", name: "admin" },
    ]);
    expect((message as Record<string, unknown>).mentionedEveryone).toBe(true);
    expect((message as Record<string, unknown>).referencedMessage).toEqual({
      id: "ref-msg-1",
      content: "parent",
    });
    expect((message as Record<string, unknown>).editedTimestamp).toBe("2026-03-10T12:00:00Z");
    expect((message as Record<string, unknown>).stickerItems).toEqual([{ id: "sticker-1" }]);
  });

  it("does not overwrite existing own properties", () => {
    const message = {
      attachments: [{ id: "own-att" }],
      content: "own content",
      _rawData: {
        attachments: [{ id: "raw-att" }],
        content: "raw content",
      },
    };

    rehydrateCarbonMessage(message);

    // Own properties should NOT be overwritten
    expect((message as Record<string, unknown>).attachments).toEqual([{ id: "own-att" }]);
    expect((message as Record<string, unknown>).content).toBe("own content");
  });

  it("no-ops on null/undefined/non-object", () => {
    expect(() => rehydrateCarbonMessage(null)).not.toThrow();
    expect(() => rehydrateCarbonMessage(undefined)).not.toThrow();
    expect(() => rehydrateCarbonMessage("string")).not.toThrow();
    expect(() => rehydrateCarbonMessage(42)).not.toThrow();
  });

  it("no-ops when _rawData is missing", () => {
    const message = { id: "msg-1" };
    rehydrateCarbonMessage(message);
    expect((message as Record<string, unknown>).attachments).toBeUndefined();
  });

  it("skips live Carbon Message instances (prototype check)", () => {
    class Message {
      _rawData: Record<string, unknown>;
      constructor() {
        this._rawData = { attachments: [{ id: "raw" }], content: "raw" };
      }
      get attachments() {
        return this._rawData.attachments;
      }
      get content() {
        return this._rawData.content;
      }
    }
    const msg = new Message();
    rehydrateCarbonMessage(msg);
    // Should NOT add own properties (getters already work)
    expect(Object.getOwnPropertyDescriptor(msg, "attachments")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(msg, "content")).toBeUndefined();
    // Getters still work
    expect(msg.attachments).toEqual([{ id: "raw" }]);
  });
});

describe("materializeDiscordInboundJob rehydrates message", () => {
  it("rehydrates message attachments from _rawData after durable round-trip", () => {
    // Simulate what the durable queue produces: a plain object with _rawData
    const job: DiscordInboundJob = {
      queueKey: "test-key",
      payload: {
        message: {
          id: "msg-1",
          _rawData: {
            id: "msg-1",
            attachments: [
              {
                id: "att-1",
                url: "https://cdn.discord.com/image.png",
                filename: "image.png",
                content_type: "image/png",
                size: 12345,
              },
            ],
            content: "test message",
            embeds: [],
            type: 0,
          },
        } as unknown,
        data: {
          message: {
            id: "msg-1",
            _rawData: {
              id: "msg-1",
              attachments: [
                {
                  id: "att-1",
                  url: "https://cdn.discord.com/image.png",
                  filename: "image.png",
                  content_type: "image/png",
                  size: 12345,
                },
              ],
              content: "test message",
              embeds: [],
              type: 0,
            },
          },
        } as unknown,
        messageChannelId: "ch-1",
      } as unknown as DiscordInboundJobPayload,
      runtime: {
        runtime: {} as unknown,
        abortSignal: undefined as unknown,
        guildHistories: undefined as unknown,
        client: undefined as unknown,
        threadBindings: undefined as unknown,
        discordRestFetch: undefined as unknown,
      } as unknown as DiscordInboundJobRuntime,
    };

    const ctx = materializeDiscordInboundJob(job);

    // After materialization, message.attachments should be accessible
    expect((ctx.message as Record<string, unknown>).attachments).toEqual([
      {
        id: "att-1",
        url: "https://cdn.discord.com/image.png",
        filename: "image.png",
        content_type: "image/png",
        size: 12345,
      },
    ]);
    expect((ctx.message as Record<string, unknown>).content).toBe("test message");
    // data.message should also be rehydrated
    expect(
      ((ctx.data as Record<string, unknown>).message as Record<string, unknown>).attachments,
    ).toEqual([
      {
        id: "att-1",
        url: "https://cdn.discord.com/image.png",
        filename: "image.png",
        content_type: "image/png",
        size: 12345,
      },
    ]);
  });

  it("handles message without _rawData gracefully", () => {
    const job: DiscordInboundJob = {
      queueKey: "test-key",
      payload: {
        message: { id: "msg-1", attachments: [{ id: "existing" }] } as unknown,
        data: { message: { id: "msg-1", attachments: [{ id: "existing" }] } } as unknown,
        messageChannelId: "ch-1",
      } as unknown as DiscordInboundJobPayload,
      runtime: {
        runtime: {} as unknown,
        abortSignal: undefined as unknown,
        guildHistories: undefined as unknown,
        client: undefined as unknown,
        threadBindings: undefined as unknown,
        discordRestFetch: undefined as unknown,
      } as unknown as DiscordInboundJobRuntime,
    };

    const ctx = materializeDiscordInboundJob(job);
    // Existing own properties preserved
    expect((ctx.message as Record<string, unknown>).attachments).toEqual([{ id: "existing" }]);
  });
});
