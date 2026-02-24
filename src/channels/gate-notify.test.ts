import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBlockedNotification,
  notifyBlocked,
  onBlockedNotification,
  resetBlockedNotificationThrottle,
  type BlockedMessageInfo,
} from "./gate-notify.js";

function makeInfo(overrides: Partial<BlockedMessageInfo> = {}): BlockedMessageInfo {
  return {
    platform: "whatsapp",
    chatName: "Canada Family",
    chatId: "120363396955454814@g.us",
    senderId: "+14165551234",
    isGroup: true,
    preview: "Hey everyone, are we still on for dinner tomorrow?",
    ...overrides,
  };
}

describe("notifyBlocked", () => {
  beforeEach(() => {
    resetBlockedNotificationThrottle();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a blocked event on first notification", () => {
    const received: unknown[] = [];
    const off = onBlockedNotification((ev) => received.push(ev));
    notifyBlocked(makeInfo());
    expect(received).toHaveLength(1);
    off();
  });

  it("does not emit a second event within 1 hour for the same chat", () => {
    const received: unknown[] = [];
    const off = onBlockedNotification((ev) => received.push(ev));
    const info = makeInfo();
    notifyBlocked(info);
    notifyBlocked(info); // second call same chat, same hour
    expect(received).toHaveLength(1);
    off();
  });

  it("emits again after 1 hour has elapsed", () => {
    const received: unknown[] = [];
    const off = onBlockedNotification((ev) => received.push(ev));
    const info = makeInfo();
    notifyBlocked(info);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    notifyBlocked(info);
    expect(received).toHaveLength(2);
    off();
  });

  it("emits for different chats independently", () => {
    const received: unknown[] = [];
    const off = onBlockedNotification((ev) => received.push(ev));
    notifyBlocked(makeInfo({ chatId: "chat1" }));
    notifyBlocked(makeInfo({ chatId: "chat2" }));
    expect(received).toHaveLength(2);
    off();
  });

  it("throttles each platform:chatId key independently", () => {
    const received: unknown[] = [];
    const off = onBlockedNotification((ev) => received.push(ev));
    const wa = makeInfo({ platform: "whatsapp", chatId: "chat1" });
    const tg = makeInfo({ platform: "telegram", chatId: "chat1" });
    notifyBlocked(wa);
    notifyBlocked(tg); // same chatId but different platform
    expect(received).toHaveLength(2);
    off();
  });
});

describe("formatBlockedNotification", () => {
  it("formats correctly", () => {
    const info = makeInfo();
    const text = formatBlockedNotification(info);
    expect(text).toContain("🔒 Blocked message");
    expect(text).toContain("Platform: whatsapp");
    expect(text).toContain(`Chat: "${info.chatName}" (${info.chatId})`);
    expect(text).toContain(`Sender: ${info.senderId}`);
    expect(text).toContain("Type: group");
    expect(text).toContain(`To configure, tell me: "set ${info.chatId} to frank-only"`);
  });

  it("truncates preview at 100 chars", () => {
    const longPreview = "a".repeat(200);
    const text = formatBlockedNotification(makeInfo({ preview: longPreview }));
    expect(text).toContain(`"${"a".repeat(100)}..."`);
  });

  it("does not truncate short previews", () => {
    const shortPreview = "Hello!";
    const text = formatBlockedNotification(makeInfo({ preview: shortPreview }));
    expect(text).toContain(`"${shortPreview}"`);
    expect(text).not.toContain("...");
  });

  it("labels DM chats correctly", () => {
    const text = formatBlockedNotification(makeInfo({ isGroup: false }));
    expect(text).toContain("Type: dm");
  });
});
