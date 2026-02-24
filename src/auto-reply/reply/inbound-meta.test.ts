import { describe, expect, it } from "vitest";
import type { TemplateContext } from "../templating.js";
import { buildInboundMetaSystemPrompt, buildInboundUserContextPrefix } from "./inbound-meta.js";

function parseInboundMetaPayload(text: string): Record<string, unknown> {
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("missing inbound meta json block");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function parseConversationInfoPayload(text: string): Record<string, unknown> {
  const match = text.match(/Conversation info \(untrusted metadata\):\n```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("missing conversation info json block");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function parseThreadContextPayload(text: string): Record<string, unknown> {
  const match = text.match(/Thread context \(untrusted metadata\):\n```json\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    throw new Error("missing thread context json block");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("buildInboundMetaSystemPrompt", () => {
  it("includes session-stable routing fields", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "123",
      MessageSidFull: "123",
      ReplyToId: "99",
      OriginatingTo: "telegram:5494292670",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "direct",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["schema"]).toBe("openclaw.inbound_meta.v1");
    expect(payload["chat_id"]).toBe("telegram:5494292670");
    expect(payload["channel"]).toBe("telegram");
  });

  it("does not include per-turn message identifiers (cache stability)", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "123",
      MessageSidFull: "123",
      ReplyToId: "99",
      SenderId: "289522496",
      OriginatingTo: "telegram:5494292670",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "direct",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["message_id"]).toBeUndefined();
    expect(payload["message_id_full"]).toBeUndefined();
    expect(payload["reply_to_id"]).toBeUndefined();
    expect(payload["sender_id"]).toBeUndefined();
  });

  it("omits sender_id when blank", () => {
    const prompt = buildInboundMetaSystemPrompt({
      MessageSid: "458",
      SenderId: "   ",
      OriginatingTo: "telegram:-1001249586642",
      OriginatingChannel: "telegram",
      Provider: "telegram",
      Surface: "telegram",
      ChatType: "group",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    expect(payload["sender_id"]).toBeUndefined();
  });

  it("marks trusted metadata with is_thread when ThreadLabel is present", () => {
    const prompt = buildInboundMetaSystemPrompt({
      OriginatingTo: "discord:thread:123",
      OriginatingChannel: "discord",
      Provider: "discord",
      Surface: "discord",
      ChatType: "channel",
      ThreadLabel: "Discord thread #ops › Incident",
    } as TemplateContext);

    const payload = parseInboundMetaPayload(prompt);
    const flags = (payload["flags"] ?? {}) as Record<string, unknown>;
    expect(flags["is_thread"]).toBe(true);
  });
});

describe("buildInboundUserContextPrefix", () => {
  it("omits conversation label block for direct chats", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      ConversationLabel: "openclaw-tui",
    } as TemplateContext);

    expect(text).toBe("");
  });

  it("keeps conversation label for group chats", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      ConversationLabel: "ops-room",
    } as TemplateContext);

    expect(text).toContain("Conversation info (untrusted metadata):");
    expect(text).toContain('"conversation_label": "ops-room"');
  });

  it("includes sender identifier in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      SenderE164: " +15551234567 ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender"]).toBe("+15551234567");
  });

  it("includes message_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "  msg-123  ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("msg-123");
  });

  it("includes message_id_full when it differs from message_id", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      MessageSid: "short-id",
      MessageSidFull: "full-provider-message-id",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("short-id");
    expect(conversationInfo["message_id_full"]).toBe("full-provider-message-id");
  });

  it("omits message_id_full when it matches message_id", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "same-id",
      MessageSidFull: "same-id",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["message_id"]).toBe("same-id");
    expect(conversationInfo["message_id_full"]).toBeUndefined();
  });

  it("includes reply_to_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "msg-200",
      ReplyToId: "msg-199",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["reply_to_id"]).toBe("msg-199");
  });

  it("includes sender_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      MessageSid: "msg-456",
      SenderId: "289522496",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender_id"]).toBe("289522496");
  });

  it("trims sender_id in conversation info", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      MessageSid: "msg-457",
      SenderId: "  289522496  ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender_id"]).toBe("289522496");
  });

  it("falls back to SenderId when sender phone is missing", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "direct",
      SenderId: " user@example.com ",
    } as TemplateContext);

    const conversationInfo = parseConversationInfoPayload(text);
    expect(conversationInfo["sender"]).toBe("user@example.com");
  });

  it("injects a dedicated thread context block when ThreadLabel is present", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "channel",
      ConversationLabel: "Guild #ops channel id:1",
      GroupChannel: "#ops",
      GroupSpace: "workspace-1",
      ThreadLabel: "Discord thread #ops › Incident triage",
      ThreadStarterBody: "starter message",
    } as TemplateContext);

    const threadContext = parseThreadContextPayload(text);
    expect(threadContext["in_thread"]).toBe(true);
    expect(threadContext["thread_label"]).toBe("Discord thread #ops › Incident triage");
    expect(threadContext["parent_group_channel"]).toBe("#ops");
    expect(threadContext["has_thread_starter"]).toBe(true);
  });

  it("does not inject thread context block when ThreadLabel is missing", () => {
    const text = buildInboundUserContextPrefix({
      ChatType: "group",
      ConversationLabel: "ops-room",
    } as TemplateContext);

    expect(text).not.toContain("Thread context (untrusted metadata):");
  });
});
