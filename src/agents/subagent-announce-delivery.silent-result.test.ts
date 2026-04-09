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

  it("treats NO_REPLY completion output as delivered (gateway call succeeded)", async () => {
    // [frankclaw] The gateway call succeeded — the parent session received and
    // processed the completion.  Whether it produces a user-facing reply is the
    // parent's decision.  Treating this as "not delivered" caused futile retries.
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

    expect(result).toEqual({ delivered: true, path: "direct" });
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

  // Regression test for 2026-04-09: when the parent session produces no
  // user-facing reply to a subagent completion announce, fall back to direct
  // delivery of the trigger message to the external channel so Frank at least
  // sees the subagent's output. Previously it was silently dropped.
  it("falls back to direct message.send when parent reply is empty and external target is available", async () => {
    // First call = agent dispatch (empty reply), second call = fallback message.send
    callGateway.mockResolvedValueOnce({ reply: { text: "NO_REPLY" } });
    callGateway.mockResolvedValueOnce({ ok: true, messageId: "test-msg-1" });

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "Subagent investigation complete: found 3 bugs in task registry.",
      directIdempotencyKey: "announce:test:empty-reply-fallback",
      completionDirectOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
      },
      directOrigin: { channel: "discord", to: "channel:123", accountId: "default" },
      requesterSessionOrigin: { channel: "discord", to: "channel:123", accountId: "default" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
    // Verify the fallback actually called message.send with the trigger content
    expect(callGateway).toHaveBeenCalledTimes(2);
    expect(callGateway.mock.calls[1][0]).toMatchObject({
      method: "message.send",
      params: expect.objectContaining({
        channel: "discord",
        to: "channel:123",
        message: "Subagent investigation complete: found 3 bugs in task registry.",
      }),
    });
  });

  it("swallows fallback delivery errors without rethrowing to avoid retry loop", async () => {
    callGateway.mockResolvedValueOnce({ reply: { text: "NO_REPLY" } });
    callGateway.mockRejectedValueOnce(new Error("message.send unavailable"));

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "worker finished",
      directIdempotencyKey: "announce:test:fallback-fail",
      completionDirectOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
      },
      directOrigin: { channel: "discord", to: "channel:123", accountId: "default" },
      requesterSessionOrigin: { channel: "discord", to: "channel:123", accountId: "default" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    // Still reports delivered — fallback failure is logged but doesn't block
    expect(result).toEqual({ delivered: true, path: "direct" });
  });
});
