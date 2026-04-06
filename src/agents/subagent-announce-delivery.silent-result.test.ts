import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as deliveryTesting } from "./subagent-announce-delivery.js";

describe("completion result visibility classification", () => {
  it("treats NO_REPLY completion results as non-deliverable", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({ reply: { text: "NO_REPLY" } }),
    ).toBe(false);
  });

  it("treats raw internal-context completion results as non-deliverable", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({
        text: [
          "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>",
          "OpenClaw runtime context (internal):",
          "[Internal task completion event]",
          "<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
        ].join("\n"),
      }),
    ).toBe(false);
  });

  it("accepts visible completion text", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({
        reply: { text: "Done, the routing fix is live." },
      }),
    ).toBe(true);
  });

  it("accepts media-only completion results", () => {
    expect(
      deliveryTesting.hasDeliverableCompletionFinalResult({
        payloads: [{ text: "NO_REPLY", mediaUrl: "file:///tmp/output.png" }],
      }),
    ).toBe(true);
  });
});

describe("completion direct announce delivery gating", () => {
  const callGateway = vi.fn();

  beforeEach(() => {
    callGateway.mockReset();
    deliveryTesting.setDepsForTest({
      callGateway,
      loadConfig: () => ({}) as never,
    });
  });

  afterEach(() => {
    deliveryTesting.setDepsForTest();
  });

  it("does not count NO_REPLY completion output as delivered", async () => {
    callGateway.mockResolvedValueOnce({ reply: { text: "NO_REPLY" } });

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "worker finished",
      directIdempotencyKey: "announce:test:no-reply",
      completionDirectOrigin: { channel: "discord", to: "channel:123" },
      directOrigin: { channel: "discord", to: "channel:123" },
      requesterSessionOrigin: { channel: "discord", to: "channel:123" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({
      delivered: false,
      path: "direct",
      error: "completion update produced no user-facing reply",
    });
  });

  it("counts explicit safe fallback text as delivered", async () => {
    callGateway.mockResolvedValueOnce({
      reply: { text: "Cache rebuild completed, but the worker did not return a usable summary." },
    });

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "worker finished",
      directIdempotencyKey: "announce:test:fallback",
      completionDirectOrigin: { channel: "discord", to: "channel:123" },
      directOrigin: { channel: "discord", to: "channel:123" },
      requesterSessionOrigin: { channel: "discord", to: "channel:123" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
  });
});
