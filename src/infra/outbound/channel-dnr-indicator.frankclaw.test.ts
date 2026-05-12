/**
 * frankclaw: Tests for channel-specific DNR bed emoji reaction indicator.
 * Verifies that sendChannelDnrBedIndicator calls the correct native reaction
 * function for WhatsApp and Telegram, and silently no-ops when replyToId
 * is missing or when errors occur.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendReactionWhatsApp = vi.fn().mockResolvedValue(undefined);
const mockReactMessageTelegram = vi.fn().mockResolvedValue({ ok: true });

vi.mock("../../../extensions/whatsapp/src/send.js", () => ({
  sendReactionWhatsApp: mockSendReactionWhatsApp,
}));

vi.mock("../../../extensions/telegram/src/send.js", () => ({
  reactMessageTelegram: mockReactMessageTelegram,
}));

describe("sendChannelDnrBedIndicator", () => {
  const cfg = {} as import("../../config/types.openclaw.js").OpenClawConfig;
  const nextEligibleAtMs = new Date("2026-05-12T12:30:00Z").getTime();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendReactionWhatsApp with bed emoji for WhatsApp channel", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await sendChannelDnrBedIndicator({
      cfg,
      channel: "whatsapp",
      to: "120363025@g.us",
      accountId: "default",
      replyToId: "msg-id-abc123",
      nextEligibleAtMs,
    });

    expect(mockSendReactionWhatsApp).toHaveBeenCalledOnce();
    expect(mockSendReactionWhatsApp).toHaveBeenCalledWith(
      "120363025@g.us",
      "msg-id-abc123",
      "🛏️",
      expect.objectContaining({ verbose: false, fromMe: false, cfg }),
    );
    expect(mockReactMessageTelegram).not.toHaveBeenCalled();
  });

  it("calls reactMessageTelegram with bed emoji for Telegram channel", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await sendChannelDnrBedIndicator({
      cfg,
      channel: "telegram",
      to: "-1001234567890",
      replyToId: "987654",
      nextEligibleAtMs,
    });

    expect(mockReactMessageTelegram).toHaveBeenCalledOnce();
    expect(mockReactMessageTelegram).toHaveBeenCalledWith(
      "-1001234567890",
      "987654",
      "🛏️",
      expect.objectContaining({ cfg, verbose: false }),
    );
    expect(mockSendReactionWhatsApp).not.toHaveBeenCalled();
  });

  it("silently no-ops when replyToId is null", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({
        cfg,
        channel: "whatsapp",
        to: "120363025@g.us",
        replyToId: null,
        nextEligibleAtMs,
      }),
    ).resolves.toBeUndefined();

    expect(mockSendReactionWhatsApp).not.toHaveBeenCalled();
    expect(mockReactMessageTelegram).not.toHaveBeenCalled();
  });

  it("silently no-ops when replyToId is undefined", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({ cfg, channel: "whatsapp", to: "x@g.us", nextEligibleAtMs }),
    ).resolves.toBeUndefined();

    expect(mockSendReactionWhatsApp).not.toHaveBeenCalled();
  });

  it("swallows errors from sendReactionWhatsApp", async () => {
    mockSendReactionWhatsApp.mockRejectedValueOnce(new Error("network failure"));
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({
        cfg,
        channel: "whatsapp",
        to: "x@g.us",
        replyToId: "some-msg-id",
        nextEligibleAtMs,
      }),
    ).resolves.toBeUndefined();
  });

  it("silently no-ops for unknown channels", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({
        cfg,
        channel: "discord",
        to: "channel:123",
        replyToId: "msg123",
        nextEligibleAtMs,
      }),
    ).resolves.toBeUndefined();

    expect(mockSendReactionWhatsApp).not.toHaveBeenCalled();
    expect(mockReactMessageTelegram).not.toHaveBeenCalled();
  });
});
