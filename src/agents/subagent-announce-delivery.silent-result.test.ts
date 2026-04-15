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
  const readLatestAssistantReply = vi.fn();

  beforeEach(() => {
    callGateway.mockReset();
    readLatestAssistantReply.mockReset();
    // Default: session store has no fresh reply (legacy behavior).  Individual
    // tests can override via .mockResolvedValueOnce() to exercise the
    // session-store fallback path.
    readLatestAssistantReply.mockResolvedValue(undefined);
    deliveryTesting.setDepsForTest({
      callGateway,
      loadConfig: () => ({}) as never,
      readLatestAssistantReply,
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
      method: "send",
      params: expect.objectContaining({
        channel: "discord",
        to: "channel:123",
        message: "Subagent investigation complete: found 3 bugs in task registry.",
      }),
    });
  });

  // Regression test for 2026-04-15 outage: when the parent session DID
  // produce a full user-facing reply but `agentResult` from `method: "agent"`
  // does not expose it in a shape the walker can detect (observed with
  // openai-codex/gpt-5.2 return shape), the fallback should read
  // `chat.history` via `readLatestAssistantReply` and deliver the real reply
  // text instead of the sanitized "task done" stub.
  it("prefers the parent session's stored assistant reply over the sanitized trigger summary", async () => {
    // First call = agent dispatch (walker sees no reply in agentResult).
    // Second call = fallback `send`.
    callGateway.mockResolvedValueOnce({ status: "ok", runId: "run-xyz" });
    callGateway.mockResolvedValueOnce({ ok: true, messageId: "test-msg-session-reply" });
    // Session store has the real reply that the walker missed.
    readLatestAssistantReply.mockResolvedValueOnce(
      "Yep, fixed. Added a re-entrancy guard to recoverPendingDeliveries and a FIFO replay test suite. Landed on main as commit fbc68a9a0c.",
    );

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:1493924684969017457",
      triggerMessage:
        "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\n[Internal task completion event]\nsource: subagent\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
      directIdempotencyKey: "announce:test:session-store-reply",
      completionDirectOrigin: {
        channel: "discord",
        to: "channel:1493924684969017457",
        accountId: "default",
      },
      directOrigin: {
        channel: "discord",
        to: "channel:1493924684969017457",
        accountId: "default",
      },
      requesterSessionOrigin: {
        channel: "discord",
        to: "channel:1493924684969017457",
        accountId: "default",
      },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
    expect(readLatestAssistantReply).toHaveBeenCalledTimes(1);
    expect(readLatestAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:discord:channel:1493924684969017457",
      }),
    );
    expect(callGateway).toHaveBeenCalledTimes(2);
    // The fallback send must carry the real session-store reply, NOT the
    // sanitized trigger summary.  Before the fix, this field was
    // "A background task completed." for any trigger that stripped to
    // internal-context-only.
    const sendCall = callGateway.mock.calls[1][0];
    expect(sendCall).toMatchObject({
      method: "send",
      params: expect.objectContaining({
        channel: "discord",
        to: "channel:1493924684969017457",
        idempotencyKey: "announce:test:session-store-reply:fallback",
      }),
    });
    expect(sendCall.params.message).toContain("Yep, fixed");
    expect(sendCall.params.message).toContain("fbc68a9a0c");
    expect(sendCall.params.message).not.toContain("BEGIN_OPENCLAW_INTERNAL_CONTEXT");
  });

  it("falls through to sanitized summary when session store has no fresh reply", async () => {
    callGateway.mockResolvedValueOnce({ status: "ok" });
    callGateway.mockResolvedValueOnce({ ok: true });
    // Default mock already returns undefined from readLatestAssistantReply
    // (simulates a session where the parent LLM genuinely chose not to
    // reply).  Make it explicit here for readability.
    readLatestAssistantReply.mockResolvedValueOnce(undefined);

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:789",
      triggerMessage: "Worker lost: runner crashed after 2 minutes.",
      directIdempotencyKey: "announce:test:session-store-empty",
      completionDirectOrigin: { channel: "discord", to: "channel:789", accountId: "default" },
      directOrigin: { channel: "discord", to: "channel:789", accountId: "default" },
      requesterSessionOrigin: { channel: "discord", to: "channel:789", accountId: "default" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
    const sendCall = callGateway.mock.calls[1][0];
    // When the session store has nothing, the sanitized-trigger fallback
    // path kicks in (triggerMessage has no internal context so it passes
    // through unchanged).
    expect(sendCall.params.message).toBe("Worker lost: runner crashed after 2 minutes.");
  });

  it("swallows readLatestAssistantReply errors and still delivers the sanitized fallback", async () => {
    callGateway.mockResolvedValueOnce({ status: "ok" });
    callGateway.mockResolvedValueOnce({ ok: true });
    // chat.history is unavailable for whatever reason (gateway error,
    // timeout, permission issue).  We must not crash the announce path.
    readLatestAssistantReply.mockRejectedValueOnce(new Error("chat.history timeout"));

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:456",
      triggerMessage: "Worker done: cache rebuild finished.",
      directIdempotencyKey: "announce:test:session-store-error",
      completionDirectOrigin: { channel: "discord", to: "channel:456", accountId: "default" },
      directOrigin: { channel: "discord", to: "channel:456", accountId: "default" },
      requesterSessionOrigin: { channel: "discord", to: "channel:456", accountId: "default" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
    const sendCall = callGateway.mock.calls[1][0];
    expect(sendCall.params.message).toBe("Worker done: cache rebuild finished.");
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
