import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as deliveryTesting } from "./subagent-announce-delivery.js";

describe("completion result visibility classification", () => {
  // hasVisibleGatewayAgentPayload checks { result: { payloads: [...] } } format
  it("treats empty payloads as non-visible", () => {
    expect(deliveryTesting.hasVisibleGatewayAgentPayload({ result: { payloads: [] } })).toBe(false);
  });

  it("treats missing payloads as non-visible", () => {
    expect(deliveryTesting.hasVisibleGatewayAgentPayload({ result: {} })).toBe(false);
    expect(deliveryTesting.hasVisibleGatewayAgentPayload({})).toBe(false);
    expect(deliveryTesting.hasVisibleGatewayAgentPayload(null)).toBe(false);
  });

  it("treats payloads with empty text as non-visible", () => {
    expect(
      deliveryTesting.hasVisibleGatewayAgentPayload({
        result: { payloads: [{ text: "" }] },
      }),
    ).toBe(false);
  });

  it("accepts payloads with visible text", () => {
    expect(
      deliveryTesting.hasVisibleGatewayAgentPayload({
        result: { payloads: [{ text: "Done, the routing fix is live." }] },
      }),
    ).toBe(true);
  });

  it("accepts payloads with media", () => {
    expect(
      deliveryTesting.hasVisibleGatewayAgentPayload({
        result: { payloads: [{ mediaUrl: "file:///tmp/output.png" }] },
      }),
    ).toBe(true);
  });

  it("accepts payloads with presentation data", () => {
    expect(
      deliveryTesting.hasVisibleGatewayAgentPayload({
        result: { payloads: [{ presentation: { type: "card" } }] },
      }),
    ).toBe(true);
  });
});

describe("completion direct announce delivery gating", () => {
  const callGateway = vi.fn();
  const sendMessage = vi.fn();

  beforeEach(() => {
    callGateway.mockReset();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    deliveryTesting.setDepsForTest({
      callGateway,
      loadConfig: () => ({}) as never,
      sendMessage,
    });
  });

  afterEach(() => {
    deliveryTesting.setDepsForTest();
  });

  it("treats gateway success with visible payload as delivered", async () => {
    callGateway.mockResolvedValueOnce({
      result: { payloads: [{ text: "Cache rebuild completed." }] },
    });

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "worker finished",
      directIdempotencyKey: "announce:test:visible",
      completionDirectOrigin: { channel: "discord", to: "channel:123" },
      directOrigin: { channel: "discord", to: "channel:123" },
      requesterSessionOrigin: { channel: "discord", to: "channel:123" },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct" });
    // No fallback needed when payload is visible
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to thread completion when no visible payload and completion has events", async () => {
    // Gateway call succeeds but no visible payload
    callGateway.mockResolvedValueOnce({ result: { payloads: [] } });
    sendMessage.mockResolvedValueOnce(undefined);

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "Subagent investigation complete: found 3 bugs in task registry.",
      internalEvents: [
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey: "agent:main:acp:child-1",
          announceType: "completion",
          taskLabel: "bug investigation",
          statusLabel: "completed",
          result: "Found 3 bugs",
          status: "ok",
          replyInstruction: "",
        },
      ],
      directIdempotencyKey: "announce:test:empty-reply-fallback",
      completionDirectOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:456",
      },
      directOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:456",
      },
      requesterSessionOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:456",
      },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    expect(result).toEqual({ delivered: true, path: "direct-thread-fallback" });
    // sendMessage should have been called for the thread fallback
    expect(sendMessage).toHaveBeenCalled();
  });

  it("swallows fallback delivery errors without rethrowing to avoid retry loop", async () => {
    // Gateway call throws
    callGateway.mockRejectedValueOnce(new Error("agent method unavailable"));
    // Thread fallback also fails (sendMessage throws)
    sendMessage.mockRejectedValueOnce(new Error("send failed"));

    const result = await deliveryTesting.sendSubagentAnnounceDirectly({
      targetRequesterSessionKey: "agent:main:discord:channel:123",
      triggerMessage: "worker finished",
      internalEvents: [
        {
          type: "task_completion",
          source: "subagent",
          childSessionKey: "agent:main:acp:child-1",
          announceType: "completion",
          taskLabel: "task",
          statusLabel: "done",
          result: "finished",
          status: "ok",
          replyInstruction: "",
        },
      ],
      directIdempotencyKey: "announce:test:fallback-fail",
      completionDirectOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:789",
      },
      directOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:789",
      },
      requesterSessionOrigin: {
        channel: "discord",
        to: "channel:123",
        accountId: "default",
        threadId: "thread:789",
      },
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
    });

    // Should report failure, not throw
    expect(result.delivered).toBe(false);
  });
});
