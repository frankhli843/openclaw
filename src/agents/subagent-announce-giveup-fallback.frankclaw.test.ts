import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock callGateway before importing the module under test.
const callGateway = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGateway(...args),
}));

import { attemptGiveUpFallbackDelivery } from "./subagent-announce-giveup-fallback.frankclaw.js";
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
    callGateway.mockResolvedValueOnce(undefined);

    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        frozenResultText: null,
        fallbackFrozenResultText: "Fallback result from session store.",
      }),
    );

    expect(result.recovered).toBe(true);
    const callArgs = callGateway.mock.calls[0][0];
    expect(callArgs.params.message).toContain("Fallback result from session store.");
  });

  it("skips fallback for non-completion messages", async () => {
    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({ expectsCompletionMessage: false }),
    );

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("skips fallback when there is no frozen result text", async () => {
    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({ frozenResultText: null, fallbackFrozenResultText: null }),
    );

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("skips fallback when there is no delivery channel", async () => {
    const result = await attemptGiveUpFallbackDelivery(makeEntry({ requesterOrigin: undefined }));

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("skips fallback when channel has no 'to' target", async () => {
    const result = await attemptGiveUpFallbackDelivery(
      makeEntry({
        requesterOrigin: { channel: "discord" },
      }),
    );

    expect(result.recovered).toBe(false);
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("returns recovered:false when callGateway throws", async () => {
    callGateway.mockRejectedValueOnce(new Error("channel not available"));

    const result = await attemptGiveUpFallbackDelivery(makeEntry());

    expect(result.recovered).toBe(false);
    expect(result.error).toContain("channel not available");
    expect(callGateway).toHaveBeenCalledTimes(1);
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
});
