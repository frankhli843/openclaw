/**
 * frankclaw: Tests for channel-agnostic DNR bed indicator.
 * Verifies that sendChannelDnrBedIndicator calls adapter.sendText with the
 * correct bed emoji text, uses runWithDirectAction, and swallows errors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendText = vi.fn().mockResolvedValue({ messageId: "m1" });
const mockAdapter = { sendText: mockSendText, deliveryMode: "gateway" as const };
let mockLoadReturn: unknown = mockAdapter;

vi.mock("../../channels/plugins/outbound/load.js", () => ({
  loadChannelOutboundAdapter: vi.fn().mockImplementation(() => Promise.resolve(mockLoadReturn)),
}));

// runWithDirectAction: just call fn() so indicator can send through.
vi.mock("./direct-action-context.frankclaw.js", () => ({
  runWithDirectAction: vi.fn().mockImplementation((fn: () => unknown) => fn()),
}));

const { loadChannelOutboundAdapter } = await import("../../channels/plugins/outbound/load.js");
const { runWithDirectAction } = await import("./direct-action-context.frankclaw.js");

describe("sendChannelDnrBedIndicator", () => {
  const cfg = {} as import("../../config/types.openclaw.js").OpenClawConfig;
  const nextEligibleAtMs = new Date("2026-05-12T12:30:00Z").getTime();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadReturn = mockAdapter;
  });

  it("calls sendText on the adapter with bed emoji and delivery time", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await sendChannelDnrBedIndicator({
      cfg,
      channel: "whatsapp",
      to: "120363025@g.us",
      accountId: "default",
      nextEligibleAtMs,
    });

    expect(loadChannelOutboundAdapter).toHaveBeenCalledWith("whatsapp");
    expect(runWithDirectAction).toHaveBeenCalledOnce();
    expect(mockSendText).toHaveBeenCalledOnce();
    const callArgs = mockSendText.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof callArgs.text).toBe("string");
    expect(callArgs.text).toContain("🛏️");
    expect(callArgs.to).toBe("120363025@g.us");
    expect(callArgs.cfg).toBe(cfg);
  });

  it("works for telegram channel", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await sendChannelDnrBedIndicator({
      cfg,
      channel: "telegram",
      to: "-1001234567890",
      nextEligibleAtMs,
    });

    expect(loadChannelOutboundAdapter).toHaveBeenCalledWith("telegram");
    expect(mockSendText).toHaveBeenCalledOnce();
    const text = (mockSendText.mock.calls[0][0] as Record<string, unknown>).text as string;
    expect(text).toContain("🛏️");
    expect(text).toContain("quiet hours");
  });

  it("silently no-ops when adapter has no sendText", async () => {
    mockLoadReturn = { deliveryMode: "gateway" }; // no sendText
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({ cfg, channel: "whatsapp", to: "x@g.us", nextEligibleAtMs }),
    ).resolves.toBeUndefined();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("silently no-ops when adapter is not found", async () => {
    mockLoadReturn = undefined;
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({ cfg, channel: "whatsapp", to: "x@g.us", nextEligibleAtMs }),
    ).resolves.toBeUndefined();
    expect(mockSendText).not.toHaveBeenCalled();
  });

  it("swallows errors from sendText", async () => {
    mockSendText.mockRejectedValueOnce(new Error("network failure"));
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await expect(
      sendChannelDnrBedIndicator({
        cfg,
        channel: "whatsapp",
        to: "x@g.us",
        nextEligibleAtMs,
      }),
    ).resolves.toBeUndefined();
  });

  it("indicator text includes 'quiet hours' and bed emoji", async () => {
    const { sendChannelDnrBedIndicator } = await import("./channel-dnr-indicator.frankclaw.js");

    await sendChannelDnrBedIndicator({
      cfg,
      channel: "whatsapp",
      to: "x@g.us",
      nextEligibleAtMs,
    });

    const text = (mockSendText.mock.calls[0][0] as Record<string, unknown>).text as string;
    expect(text).toMatch(/🛏️/);
    expect(text).toMatch(/quiet hours/);
    expect(text).toMatch(/will deliver at/);
  });
});
