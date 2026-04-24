/**
 * Tests WhatsApp DNR quiet hours enforcement in the outbound adapter.
 * Tests the enforceWhatsAppDnr wrapper that intercepts sends.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DNR module
const dnrMocks = vi.hoisted(() => ({
  enforceWhatsAppDnrWindow: vi.fn(),
  WhatsAppDnrSuppressedError: class WhatsAppDnrSuppressedError extends Error {
    readonly nextEligibleAtMs: number;
    constructor(nextEligibleAtMs: number) {
      super("whatsapp outbound suppressed by DNR window");
      this.name = "WhatsAppDnrSuppressedError";
      this.nextEligibleAtMs = nextEligibleAtMs;
    }
  },
}));

vi.mock("../../../src/infra/outbound/discord-dnr.js", () => ({
  enforceWhatsAppDnrWindow: dnrMocks.enforceWhatsAppDnrWindow,
  WhatsAppDnrSuppressedError: dnrMocks.WhatsAppDnrSuppressedError,
}));

// Import the enforceWhatsAppDnr function indirectly through the module
// We test the DNR enforcement via the exported outbound adapter

const sendMessageMock = vi.hoisted(() =>
  vi.fn(async () => ({ messageId: "msg-123", toJid: "jid-456" })),
);

vi.mock("./send.js", () => ({
  sendMessageWhatsApp: sendMessageMock,
  sendPollWhatsApp: vi.fn(async () => ({ messageId: "poll-1", toJid: "jid-789" })),
}));

vi.mock("openclaw/plugin-sdk/runtime-env", () => ({
  shouldLogVerbose: vi.fn(() => false),
  createSubsystemLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { whatsappOutbound } from "./outbound-adapter.js";

describe("WhatsApp outbound adapter DNR enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suppresses send when WhatsAppDnrSuppressedError is thrown", async () => {
    dnrMocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      throw new dnrMocks.WhatsAppDnrSuppressedError(Date.now() + 60_000);
    });

    // Call sendText which goes through our DNR-wrapped sendMessageWhatsApp
    const result = await whatsappOutbound.sendText!({
      cfg: {} as any,
      to: "120363421390336301@g.us",
      text: "Hello",
      accountId: "default",
    });
    // DNR suppresses: sendMessageWhatsApp returns { messageId: "", toJid: "" }
    expect(result).toMatchObject({ messageId: "" });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("proceeds with send when DNR window is not active", async () => {
    dnrMocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      // no-op, not in quiet hours
    });

    const result = await whatsappOutbound.sendText!({
      cfg: {} as any,
      to: "120363421390336301@g.us",
      text: "Hello",
      accountId: "default",
    });
    expect(sendMessageMock).toHaveBeenCalled();
    expect(result).toMatchObject({ messageId: "msg-123" });
  });

  it("re-throws non-DNR errors from enforceWhatsAppDnrWindow", async () => {
    dnrMocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      throw new Error("unexpected error");
    });

    await expect(
      whatsappOutbound.sendText!({
        cfg: {} as any,
        to: "group@g.us",
        text: "Hi",
        accountId: "default",
      }),
    ).rejects.toThrow("unexpected error");
  });
});
