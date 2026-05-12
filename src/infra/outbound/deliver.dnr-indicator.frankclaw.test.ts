/**
 * frankclaw: Integration tests verifying that deliver.ts calls sendChannelDnrBedIndicator
 * before deferDelivery when WhatsApp or Telegram DNR suppresses an outbound message.
 * Also verifies that the indicator is NOT called for Discord outbound DNR (different path).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DiscordDnrSuppressedError, WhatsAppDnrSuppressedError } from "./discord-dnr.js";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const indicatorMock = vi.hoisted(() => ({ sendChannelDnrBedIndicator: vi.fn(async () => {}) }));
const deferMock = vi.hoisted(() => ({ deferDelivery: vi.fn(async () => {}) }));
const queueMocks = vi.hoisted(() => ({
  enqueueDelivery: vi.fn(async () => "mock-queue-id"),
  ackDelivery: vi.fn(async () => {}),
  failDelivery: vi.fn(async () => {}),
  withActiveDeliveryClaim: vi.fn(async (_id: string, fn: () => Promise<unknown>) => ({
    status: "claimed" as const,
    value: await fn(),
  })),
}));

// We intercept the outbound adapter to throw a DNR error.
let adapterSendTextThrows: (() => unknown) | null = null;
const adapterMock = {
  deliveryMode: "gateway" as const,
  chunkerMode: "text" as const,
  sendText: vi.fn(async () => {
    if (adapterSendTextThrows) adapterSendTextThrows();
    return { messageId: "m1" };
  }),
  resolveTarget: vi.fn(({ to }: { to?: string }) => ({ ok: true as const, to: to ?? "" })),
};

vi.mock("./channel-dnr-indicator.frankclaw.js", () => indicatorMock);
vi.mock("./delivery-queue.frankclaw.js", () => deferMock);
vi.mock("./delivery-queue.js", () => queueMocks);
vi.mock("../../channels/plugins/outbound/load.js", () => ({
  loadChannelOutboundAdapter: vi.fn(async () => adapterMock),
}));
vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => {
    const l = () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => l()),
    });
    return l();
  },
}));
vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: vi.fn(),
  triggerInternalHook: vi.fn(async () => {}),
}));
vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: vi.fn(() => false),
    runMessageSending: vi.fn(async () => undefined),
    runMessageSent: vi.fn(async () => {}),
  }),
}));
vi.mock("../../config/sessions/transcript.runtime.js", async () => {
  const a = await vi.importActual("../../config/sessions/transcript.runtime.js");
  return {
    ...(a as object),
    appendAssistantMessageToSessionTranscript: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock("../../config/sessions/transcript.js", async () => {
  const a = await vi.importActual("../../config/sessions/transcript.js");
  return {
    ...(a as object),
    appendAssistantMessageToSessionTranscript: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock("../../media/read-capability.js", () => ({
  resolveAgentScopedOutboundMediaAccess: vi.fn(() => ({})),
}));
vi.mock("../../infra/diagnostic-events.js", () => ({
  emitDiagnosticEvent: vi.fn(),
}));
vi.mock("../diagnostic-events.js", () => ({
  emitDiagnosticEvent: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────────────────

const cfg = {} as import("../../config/types.openclaw.js").OpenClawConfig;
const nextEligibleAtMs = Date.now() + 30_000;

describe("deliver.ts DNR bed indicator integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterSendTextThrows = null;
    queueMocks.enqueueDelivery.mockResolvedValue("mock-queue-id");
    queueMocks.withActiveDeliveryClaim.mockImplementation(
      async (_id: string, fn: () => Promise<unknown>) => ({ status: "claimed", value: await fn() }),
    );
  });

  it("calls sendChannelDnrBedIndicator when WhatsApp DNR suppresses delivery", async () => {
    adapterSendTextThrows = () => {
      throw new WhatsAppDnrSuppressedError(nextEligibleAtMs);
    };

    const { deliverOutboundPayloads } = await import("./deliver.js");

    const result = await deliverOutboundPayloads({
      cfg,
      channel: "whatsapp",
      to: "120363025@g.us",
      payloads: [{ text: "hello" }],
    });

    expect(result).toEqual([]);
    expect(indicatorMock.sendChannelDnrBedIndicator).toHaveBeenCalledOnce();
    expect(indicatorMock.sendChannelDnrBedIndicator).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "whatsapp",
        to: "120363025@g.us",
        nextEligibleAtMs,
      }),
    );
    expect(deferMock.deferDelivery).toHaveBeenCalledWith(
      "mock-queue-id",
      nextEligibleAtMs,
      "whatsapp-dnr-window",
    );
  });

  it("calls sendChannelDnrBedIndicator for Telegram (DiscordDnrSuppressedError + channel=telegram)", async () => {
    adapterSendTextThrows = () => {
      throw new DiscordDnrSuppressedError(nextEligibleAtMs);
    };

    const { deliverOutboundPayloads } = await import("./deliver.js");

    const result = await deliverOutboundPayloads({
      cfg,
      channel: "telegram",
      to: "-1001234567890",
      payloads: [{ text: "hi" }],
    });

    expect(result).toEqual([]);
    expect(indicatorMock.sendChannelDnrBedIndicator).toHaveBeenCalledOnce();
    expect(indicatorMock.sendChannelDnrBedIndicator).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "telegram", to: "-1001234567890", nextEligibleAtMs }),
    );
    expect(deferMock.deferDelivery).toHaveBeenCalledWith(
      "mock-queue-id",
      nextEligibleAtMs,
      "telegram-dnr-window",
    );
  });

  it("does NOT call sendChannelDnrBedIndicator for Discord outbound DNR", async () => {
    adapterSendTextThrows = () => {
      throw new DiscordDnrSuppressedError(nextEligibleAtMs);
    };

    const { deliverOutboundPayloads } = await import("./deliver.js");

    const result = await deliverOutboundPayloads({
      cfg,
      channel: "discord",
      to: "channel:123456789",
      payloads: [{ text: "hi" }],
    });

    expect(result).toEqual([]);
    expect(indicatorMock.sendChannelDnrBedIndicator).not.toHaveBeenCalled();
    expect(deferMock.deferDelivery).toHaveBeenCalledWith(
      "mock-queue-id",
      nextEligibleAtMs,
      "discord-dnr-window",
    );
  });

  it("does NOT call indicator when delivery succeeds", async () => {
    // No DNR throw — delivery succeeds.
    const { deliverOutboundPayloads } = await import("./deliver.js");

    await deliverOutboundPayloads({
      cfg,
      channel: "whatsapp",
      to: "120363025@g.us",
      payloads: [{ text: "hello" }],
    });

    expect(indicatorMock.sendChannelDnrBedIndicator).not.toHaveBeenCalled();
    expect(deferMock.deferDelivery).not.toHaveBeenCalled();
  });

  it("does NOT call indicator when delivery is recovery (skipQueue=true)", async () => {
    // skipQueue=true means queueId=null; DNR indicator branch is inside if(queueId).
    adapterSendTextThrows = () => {
      throw new WhatsAppDnrSuppressedError(nextEligibleAtMs);
    };

    const { deliverOutboundPayloads } = await import("./deliver.js");

    // With skipQueue=true, queueId is null, so neither indicator nor deferDelivery fires.
    await expect(
      deliverOutboundPayloads({
        cfg,
        channel: "whatsapp",
        to: "120363025@g.us",
        payloads: [{ text: "replay" }],
        skipQueue: true,
      }),
    ).rejects.toBeInstanceOf(WhatsAppDnrSuppressedError);

    expect(indicatorMock.sendChannelDnrBedIndicator).not.toHaveBeenCalled();
    expect(deferMock.deferDelivery).not.toHaveBeenCalled();
  });
});
