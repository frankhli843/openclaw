/**
 * Regression test for the Discord outbound DNR-window silent-drop bug.
 *
 * The bug: outbound-adapter.ts caught DiscordDnrSuppressedError internally and
 * returned an EMPTY messageId (plus a no-op deferDelivery on a synthetic queue id).
 * deliver.ts then ack'd the durable queue row as "sent" and the message was lost,
 * while the CLI printed a false "Sent via Discord. Message ID: channel:<id>".
 *
 * The fix (mirroring the WhatsApp/Telegram adapters): the adapter must let
 * DiscordDnrSuppressedError PROPAGATE so deliver.ts can deferDelivery() on the real
 * queue row and re-deliver the message when the quiet-hours window closes.
 *
 * This test asserts all three outbound methods (sendText, sendMedia, sendPayload)
 * propagate the DNR error in-window and do not call the underlying send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dnrMocks = vi.hoisted(() => ({
  enforceDiscordDnrWindow: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/infra-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/infra-runtime")>(
    "openclaw/plugin-sdk/infra-runtime",
  );
  return {
    ...actual,
    enforceDiscordDnrWindow: dnrMocks.enforceDiscordDnrWindow,
  };
});

// Pass-through the delivery retry wrapper so the happy path just runs the send fn.
vi.mock("./delivery-retry.js", () => ({
  withDiscordDeliveryRetry: vi.fn(async (args: { fn: () => Promise<unknown> }) => await args.fn()),
}));

const { DiscordDnrSuppressedError } = await import("openclaw/plugin-sdk/infra-runtime");
const { discordOutbound } = await import("./outbound-adapter.js");

const TARGET = "channel:123456789";

describe("Discord outbound adapter DNR enforcement (silent-drop regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendText propagates DiscordDnrSuppressedError when in DNR window (so deliver.ts can defer)", async () => {
    const nextEligibleAtMs = Date.now() + 3_600_000;
    const sendDiscord = vi.fn();
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw new DiscordDnrSuppressedError(nextEligibleAtMs);
    });

    await expect(
      discordOutbound.sendText!({
        cfg: {} as never,
        to: TARGET,
        text: "overnight result",
        accountId: "default",
        deps: { discord: sendDiscord },
        silent: true,
      } as never),
    ).rejects.toBeInstanceOf(DiscordDnrSuppressedError);

    // The message must NOT be sent now, and must NOT be falsely reported as success.
    expect(sendDiscord).not.toHaveBeenCalled();
  });

  it("propagated error carries nextEligibleAtMs so deliver.ts defers to the right time", async () => {
    const nextEligibleAtMs = Date.now() + 1_800_000;
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw new DiscordDnrSuppressedError(nextEligibleAtMs);
    });

    let caught: unknown;
    try {
      await discordOutbound.sendText!({
        cfg: {} as never,
        to: TARGET,
        text: "x",
        accountId: "default",
        silent: true,
      } as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscordDnrSuppressedError);
    expect((caught as InstanceType<typeof DiscordDnrSuppressedError>).nextEligibleAtMs).toBe(
      nextEligibleAtMs,
    );
  });

  it("sendMedia propagates DiscordDnrSuppressedError when in DNR window", async () => {
    const sendDiscord = vi.fn();
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw new DiscordDnrSuppressedError(Date.now() + 3_600_000);
    });

    await expect(
      discordOutbound.sendMedia!({
        cfg: {} as never,
        to: TARGET,
        text: "caption",
        mediaUrl: "https://example.com/a.png",
        accountId: "default",
        deps: { discord: sendDiscord },
        silent: true,
      } as never),
    ).rejects.toBeInstanceOf(DiscordDnrSuppressedError);
    expect(sendDiscord).not.toHaveBeenCalled();
  });

  it("sendPayload propagates DiscordDnrSuppressedError when in DNR window", async () => {
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw new DiscordDnrSuppressedError(Date.now() + 3_600_000);
    });

    await expect(
      discordOutbound.sendPayload!({
        cfg: {} as never,
        to: TARGET,
        text: "payload",
      } as never),
    ).rejects.toBeInstanceOf(DiscordDnrSuppressedError);
  });

  it("re-throws non-DNR errors from enforceDiscordDnrWindow", async () => {
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw new Error("unexpected enforcement failure");
    });
    await expect(
      discordOutbound.sendText!({
        cfg: {} as never,
        to: TARGET,
        text: "x",
        accountId: "default",
        silent: true,
      } as never),
    ).rejects.toThrow("unexpected enforcement failure");
  });

  it("sends normally when the DNR window is not active (happy path returns a message id)", async () => {
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      // not in quiet hours — no-op
    });
    const sendDiscord = vi.fn(async () => ({
      messageId: "1512806112821252147",
      channelId: TARGET,
    }));

    const result = await discordOutbound.sendText!({
      cfg: {} as never,
      to: TARGET,
      text: "daytime message",
      accountId: "default",
      deps: { discord: sendDiscord },
      silent: true,
    } as never);

    expect(sendDiscord).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ messageId: "1512806112821252147" });
  });
});
