import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWebhookRelay } from "./message-handler.preflight.frankclaw.js";

describe("resolveWebhookRelay", () => {
  const prev = process.env.FRANKCLAW_DISCORD_WEBHOOK_RELAY;

  beforeEach(() => {
    process.env.FRANKCLAW_DISCORD_WEBHOOK_RELAY = JSON.stringify([
      { webhookBotId: "bot-1", ownerUserId: "owner-1", stripPrefix: "Google Voice Note:" },
    ]);
  });

  afterEach(() => {
    if (prev == null) {
      delete process.env.FRANKCLAW_DISCORD_WEBHOOK_RELAY;
    } else {
      process.env.FRANKCLAW_DISCORD_WEBHOOK_RELAY = prev;
    }
  });

  it("returns no match for non-bot authors", () => {
    const result = resolveWebhookRelay({
      authorId: "bot-1",
      authorBot: false,
      messageText: "Google Voice Note: hello",
    });

    expect(result).toEqual({ matched: false });
  });

  it("matches configured webhook bot and rewrites text with stripped prefix", () => {
    const result = resolveWebhookRelay({
      authorId: "bot-1",
      authorBot: true,
      messageText: "Google Voice Note: buy milk",
    });

    expect(result).toEqual({
      matched: true,
      ownerUserId: "owner-1",
      rewrittenText: "buy milk",
    });
  });

  it("returns no match for unknown webhook bot", () => {
    const result = resolveWebhookRelay({
      authorId: "bot-2",
      authorBot: true,
      messageText: "Google Voice Note: hello",
    });

    expect(result).toEqual({ matched: false });
  });

  // ── note-to-self relay ──

  it("matches bot-authored [Doramon note to self] and returns ownerUserId without rewrittenText", () => {
    const result = resolveWebhookRelay({
      authorId: "some-bot-999",
      authorBot: true,
      messageText: "[Doramon note to self] Background task done: briefing",
    });

    expect(result).toEqual({
      matched: true,
      ownerUserId: "257595674042826753",
    });
    // rewrittenText must be absent so the prefix reaches the LLM overlay
    expect(result.rewrittenText).toBeUndefined();
  });

  it("matches lowercase note-to-self prefix", () => {
    const result = resolveWebhookRelay({
      authorId: "some-bot-999",
      authorBot: true,
      messageText: "[doramon note to self] some update",
    });

    expect(result).toEqual({
      matched: true,
      ownerUserId: "257595674042826753",
    });
    expect(result.rewrittenText).toBeUndefined();
  });

  it("matches note-to-self with leading whitespace", () => {
    const result = resolveWebhookRelay({
      authorId: "some-bot-999",
      authorBot: true,
      messageText: "   [Doramon note to self] trimmed",
    });

    expect(result).toEqual({
      matched: true,
      ownerUserId: "257595674042826753",
    });
    expect(result.rewrittenText).toBeUndefined();
  });

  it("does not match note-to-self from non-bot authors", () => {
    const result = resolveWebhookRelay({
      authorId: "human-user",
      authorBot: false,
      messageText: "[Doramon note to self] test",
    });

    expect(result).toEqual({ matched: false });
  });
});
