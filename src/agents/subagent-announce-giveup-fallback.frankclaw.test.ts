import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock callGateway before importing the module under test.
const callGateway = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGateway(...args),
}));

import {
  attemptGiveUpFallbackDelivery,
  attemptModelFailureDirectDelivery,
} from "./subagent-announce-giveup-fallback.frankclaw.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

function makeEntry(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "run-test-1",
    childSessionKey: "agent:claude:acp:child-1",
    requesterSessionKey: "agent:main:cron:parent-1",
    requesterDisplayKey: "cron:parent-1",
    task: "test task",
    cleanup: "keep",
    createdAt: Date.now() - 60_000,
    endedAt: Date.now() - 5_000,
    expectsCompletionMessage: true,
    frozenResultText: "Task completed successfully. Here are the results.",
    requesterOrigin: {
      channel: "discord",
      to: "1474343755153932394",
      threadId: "1234567890",
      accountId: "bot-account",
    },
    ...overrides,
  };
}

describe("attemptGiveUpFallbackDelivery", () => {
  beforeEach(() => {
    callGateway.mockReset();
  });

  it("delivers frozen result text to the original channel when parent session is gone", async () => {
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptGiveUpFallbackDelivery(makeEntry());

    expect(result.recovered).toBe(true);
    expect(result.deliveryPath).toBe("discord:1474343755153932394");
    expect(callGateway).toHaveBeenCalledTimes(1);
    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.method).toBe("send");
    expect(callArgs.params.channel).toBe("discord");
    expect(callArgs.params.to).toBe("1474343755153932394");
    expect(callArgs.params.threadId).toBe("1234567890");
    expect(callArgs.params.message).toContain("Task completed successfully");
    expect(callArgs.params.message).toContain("[Announce fallback]");
    expect(callArgs.params.idempotencyKey).toContain("announce-giveup-fallback:run-test-1");
  });

  it("uses fallbackFrozenResultText when frozenResultText is empty", async () => {
    // First call = last-resort capture (chat.history) returns empty
    callGateway.mockResolvedValueOnce({ messages: [] });
    // Second call = retry with limit 5, returns empty
    callGateway.mockResolvedValueOnce({ messages: [] });
    // Third call = send delivery
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: "Fallback result from session store.",
      }),
    );

    expect(result.recovered).toBe(true);
    const sendCall = callGateway.mock.calls.find((c) => c[0].method === "send");
    expect(sendCall).toBeDefined();
    expect(sendCall![0].params.message).toContain("Fallback result from session store.");
  });

  it("skips fallback for non-completion messages", async () => {
    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({ expectsCompletionMessage: false }),
    );

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("attempts last-resort capture when frozenResultText is empty", async () => {
    // Last-resort capture via chat.history returns a result
    callGateway.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "do the task" },
        { role: "assistant", content: "Here is the captured result from ACP session." },
      ],
    });
    // send delivery
    callGateway.mockResolvedValueOnce(undefined);

    const entry = makeEntry({
      frozenResultText: null,
      fallbackFrozenResultText: undefined,
    });
    const result = await attemptGiveUpFallbackDelivery(entry);

    expect(result.recovered).toBe(true);
    // The frozenResultText should be updated on the entry
    expect(entry.frozenResultText).toBe("Here is the captured result from ACP session.");
    const sendCall = callGateway.mock.calls.find((c) => c[0].method === "send");
    expect(sendCall).toBeDefined();
    expect(sendCall![0].params.message).toContain("Here is the captured result from ACP session.");
  });

  it("handles structured content blocks in last-resort capture", async () => {
    callGateway.mockResolvedValueOnce({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Structured block result." }],
        },
      ],
    });
    callGateway.mockResolvedValueOnce(undefined);

    const entry = makeEntry({ frozenResultText: null });
    const result = await attemptGiveUpFallbackDelivery(entry);

    expect(result.recovered).toBe(true);
    expect(entry.frozenResultText).toBe("Structured block result.");
  });

  it("synthesizes error notification when no result can be captured but outcome is error", async () => {
    // chat.history returns empty
    callGateway.mockResolvedValueOnce({ messages: [] });
    // retry with limit 5 returns empty
    callGateway.mockResolvedValueOnce({ messages: [] });
    // send delivery
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: undefined,
        outcome: { status: "error", error: "claude-agent-acp crashed" },
      }),
    );

    expect(result.recovered).toBe(true);
    const sendCall = callGateway.mock.calls.find((c) => c[0].method === "send");
    expect(sendCall![0].params.message).toContain("failed");
    expect(sendCall![0].params.message).toContain("claude-agent-acp crashed");
  });

  it("synthesizes ok notification when result cannot be captured but outcome is ok", async () => {
    callGateway.mockResolvedValueOnce({ messages: [] });
    callGateway.mockResolvedValueOnce({ messages: [] });
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: undefined,
        outcome: { status: "ok" },
      }),
    );

    expect(result.recovered).toBe(true);
    const sendCall = callGateway.mock.calls.find((c) => c[0].method === "send");
    expect(sendCall![0].params.message).toContain("completed successfully");
    expect(sendCall![0].params.message).toContain("output could not be captured");
  });

  it("gives up when no result, no capture, and outcome is unknown", async () => {
    callGateway.mockResolvedValueOnce({ messages: [] });
    callGateway.mockResolvedValueOnce({ messages: [] });

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: undefined,
        outcome: { status: "unknown" },
      }),
    );

    expect(result.recovered).toBe(false);
  });

  it("skips fallback when there is no delivery channel", async () => {
    const result = await attemptGiveUpFallbackDelivery(makeEntry({ requesterOrigin: undefined }));

    expect(result.recovered).toBe(false);
  });

  it("skips fallback when channel has no 'to' target", async () => {
    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        requesterOrigin: { channel: "discord" },
      }),
    );

    expect(result.recovered).toBe(false);
  });

  it("returns recovered:false when callGateway throws on send", async () => {
    callGateway.mockRejectedValueOnce(new Error("channel not available"));

    const result = await attemptGiveUpFallbackDelivery(makeEntry());

    expect(result.recovered).toBe(false);
    expect(result.error).toContain("channel not available");
  });

  it("includes the label in the fallback message when available", async () => {
    callGateway.mockResolvedValueOnce(undefined);

    await attemptGiveUpFallbackDelivery(makeEntry({ label: "my-task-label" }));

    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.params.message).toContain("my-task-label");
  });

  it("omits threadId when origin has no threadId", async () => {
    callGateway.mockResolvedValueOnce(undefined);

    await attemptGiveUpFallbackDelivery(
      makeEntry({
        requesterOrigin: {
          channel: "discord",
          to: "1474343755153932394",
        },
      }),
    );

    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.params.threadId).toBeUndefined();
  });

  it("uses a 30s timeout for the fallback delivery", async () => {
    callGateway.mockResolvedValueOnce(undefined);

    await attemptGiveUpFallbackDelivery(makeEntry());

    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.timeoutMs).toBe(30_000);
  });

  it("handles chat.history failure gracefully during last-resort capture", async () => {
    // chat.history throws
    callGateway.mockRejectedValueOnce(new Error("session not found"));
    // retry with limit 5 also throws
    callGateway.mockRejectedValueOnce(new Error("session not found"));

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: undefined,
        outcome: { status: "unknown" },
      }),
    );

    expect(result.recovered).toBe(false);
  });
});

describe("attemptModelFailureDirectDelivery", () => {
  beforeEach(() => {
    callGateway.mockReset();
  });

  it("delivers frozen result text directly to the channel", async () => {
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptModelFailureDirectDelivery(makeEntry());

    expect(result.recovered).toBe(true);
    expect(result.deliveryPath).toBe("discord:1474343755153932394");
    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.method).toBe("send");
    expect(callArgs.params.message).toContain("[Worker result]");
    expect(callArgs.params.message).toContain("model outage");
    expect(callArgs.params.message).toContain("Task completed successfully");
    expect(callArgs.params.idempotencyKey).toContain("announce-model-failure-bypass:run-test-1");
  });

  it("attempts last-resort capture when frozenResultText is empty", async () => {
    // chat.history returns a result
    callGateway.mockResolvedValueOnce({
      messages: [{ role: "assistant", content: "Captured at retry time." }],
    });
    // send delivery
    callGateway.mockResolvedValueOnce(undefined);

    const entry = makeEntry({ frozenResultText: null });
    const result = await attemptModelFailureDirectDelivery(entry);

    expect(result.recovered).toBe(true);
    expect(entry.frozenResultText).toBe("Captured at retry time.");
  });

  it("skips for non-completion messages", async () => {
    const result = await attemptModelFailureDirectDelivery(
      makeEntry({ expectsCompletionMessage: false }),
    );

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("skips when no result text and no capture possible", async () => {
    callGateway.mockResolvedValueOnce({ messages: [] });
    callGateway.mockResolvedValueOnce({ messages: [] });

    const result = await attemptModelFailureDirectDelivery(
      makeEntry({ frozenResultText: null, fallbackFrozenResultText: undefined }),
    );

    expect(result.recovered).toBe(false);
  });

  it("skips when no delivery target", async () => {
    const result = await attemptModelFailureDirectDelivery(
      makeEntry({ requesterOrigin: undefined }),
    );

    expect(result.recovered).toBe(false);
  });

  it("returns recovered:false on send failure", async () => {
    callGateway.mockRejectedValueOnce(new Error("network error"));

    const result = await attemptModelFailureDirectDelivery(makeEntry());

    expect(result.recovered).toBe(false);
    expect(result.error).toContain("network error");
  });
});
