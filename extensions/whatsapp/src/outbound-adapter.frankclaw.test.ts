/**
 * Tests WhatsApp DNR quiet hours enforcement in the outbound adapter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceWhatsAppDnrWindow: vi.fn(),
  WhatsAppDnrSuppressedError: class WhatsAppDnrSuppressedError extends Error {
    readonly nextEligibleAtMs: number;
    constructor(nextEligibleAtMs: number) {
      super("whatsapp outbound suppressed by DNR window");
      this.name = "WhatsAppDnrSuppressedError";
      this.nextEligibleAtMs = nextEligibleAtMs;
    }
  },
  createEmptyChannelResult: vi.fn(() => ({ channel: "whatsapp", results: [] })),
  createAttachedChannelResultAdapter: vi.fn(() => ({
    sendText: vi.fn(),
    sendMedia: vi.fn(),
    sendPoll: vi.fn(),
  })),
  sanitizeForPlainText: vi.fn((t: string) => t),
  resolveOutboundSendDep: vi.fn(),
  resolveSendableOutboundReplyParts: vi.fn(() => ({ hasMedia: false })),
  sendTextMediaPayload: vi.fn(),
  chunkText: vi.fn(),
  shouldLogVerbose: vi.fn(() => false),
  createSubsystemLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  resolveWhatsAppOutboundTarget: vi.fn(),
  sendPollWhatsApp: vi.fn(),
}));

vi.mock("../../../src/infra/outbound/discord-dnr.js", () => ({
  enforceWhatsAppDnrWindow: mocks.enforceWhatsAppDnrWindow,
  WhatsAppDnrSuppressedError: mocks.WhatsAppDnrSuppressedError,
}));

vi.mock("openclaw/plugin-sdk/channel-send-result", () => ({
  createAttachedChannelResultAdapter: mocks.createAttachedChannelResultAdapter,
  createEmptyChannelResult: mocks.createEmptyChannelResult,
}));

vi.mock("openclaw/plugin-sdk/outbound-runtime", () => ({
  resolveOutboundSendDep: mocks.resolveOutboundSendDep,
  sanitizeForPlainText: mocks.sanitizeForPlainText,
}));

vi.mock("openclaw/plugin-sdk/reply-payload", () => ({
  resolveSendableOutboundReplyParts: mocks.resolveSendableOutboundReplyParts,
  sendTextMediaPayload: mocks.sendTextMediaPayload,
}));

vi.mock("openclaw/plugin-sdk/reply-runtime", () => ({
  chunkText: mocks.chunkText,
}));

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  shouldLogVerbose: mocks.shouldLogVerbose,
  createSubsystemLogger: mocks.createSubsystemLogger,
}));

vi.mock("./outbound-send-deps.js", () => ({
  WHATSAPP_LEGACY_OUTBOUND_SEND_DEP_KEYS: [],
}));

vi.mock("./runtime-api.js", () => ({
  resolveWhatsAppOutboundTarget: mocks.resolveWhatsAppOutboundTarget,
}));

vi.mock("./send.js", () => ({
  sendPollWhatsApp: mocks.sendPollWhatsApp,
  sendMessageWhatsApp: vi.fn(),
}));

import { whatsappOutbound } from "./outbound-adapter.js";

describe("WhatsApp outbound adapter DNR enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when WhatsAppDnrSuppressedError is thrown", async () => {
    mocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      throw new mocks.WhatsAppDnrSuppressedError(Date.now() + 60_000);
    });

    const ctx = {
      to: "120363421390336301@g.us",
      payload: { text: "Hello" },
    } as any;

    const result = await whatsappOutbound.sendPayload!(ctx);
    expect(result).toEqual({ channel: "whatsapp", results: [] });
    expect(mocks.sendTextMediaPayload).not.toHaveBeenCalled();
  });

  it("proceeds with send when DNR window is not active", async () => {
    mocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      // no-op, not in quiet hours
    });
    mocks.sendTextMediaPayload.mockResolvedValue({ channel: "whatsapp", results: [{ ok: true }] });

    const ctx = {
      to: "120363421390336301@g.us",
      payload: { text: "Hello" },
    } as any;

    await whatsappOutbound.sendPayload!(ctx);
    expect(mocks.sendTextMediaPayload).toHaveBeenCalled();
  });

  it("re-throws non-DNR errors from enforceWhatsAppDnrWindow", async () => {
    mocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      throw new Error("unexpected error");
    });

    const ctx = {
      to: "group@g.us",
      payload: { text: "Hi" },
    } as any;

    await expect(whatsappOutbound.sendPayload!(ctx)).rejects.toThrow("unexpected error");
  });

  it("returns empty result for empty text and no media", async () => {
    const ctx = {
      to: "group@g.us",
      payload: { text: "" },
    } as any;

    const result = await whatsappOutbound.sendPayload!(ctx);
    expect(result).toEqual({ channel: "whatsapp", results: [] });
    expect(mocks.enforceWhatsAppDnrWindow).not.toHaveBeenCalled();
  });
});
