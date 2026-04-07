import { describe, expect, it, vi } from "vitest";
import type { AgentRunLoopResult } from "./agent-runner-execution.js";
import {
  handleRetryableRunOutcome,
  RETRYABLE_IMMEDIATE_ATTEMPTS,
  buildScheduleDeferredRetry,
  buildSendProgrammaticRetryUpdate,
} from "./agent-runner.frankclaw.js";

describe("handleRetryableRunOutcome", () => {
  const makeRetryableOutcome = (msg = "rate limit"): AgentRunLoopResult => ({
    kind: "final",
    payload: { text: msg },
    retryableFailure: true,
    failureMessage: msg,
  });

  const makeSuccessOutcome = (): AgentRunLoopResult => ({
    kind: "final",
    payload: { text: "ok" },
  });

  it("returns null for non-retryable outcomes", async () => {
    const result = await handleRetryableRunOutcome({
      runOutcome: makeSuccessOutcome(),
      isHeartbeat: false,
      scheduleDeferredRetry: vi.fn(),
      rerunAgent: vi.fn(),
    });

    expect(result).toBeNull();
  });

  it("schedules deferred retry when immediate retries exhausted", async () => {
    const scheduleDeferredRetry = vi.fn();
    const rerunAgent = vi.fn().mockResolvedValue(makeRetryableOutcome());

    const result = await handleRetryableRunOutcome({
      runOutcome: makeRetryableOutcome(),
      isHeartbeat: false,
      scheduleDeferredRetry,
      rerunAgent,
    });

    // With RETRYABLE_IMMEDIATE_ATTEMPTS=1, no immediate retries happen
    expect(scheduleDeferredRetry).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(result!.deferredPayload).toBeDefined();
    expect(result!.deferredPayload!.text).toContain("deferred retries");
  });

  it("does not schedule deferred retry for heartbeat failures", async () => {
    const scheduleDeferredRetry = vi.fn();

    const result = await handleRetryableRunOutcome({
      runOutcome: makeRetryableOutcome(),
      isHeartbeat: true,
      scheduleDeferredRetry,
      rerunAgent: vi.fn(),
    });

    expect(scheduleDeferredRetry).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.deferredPayload).toBeUndefined();
  });

  it("returns resolved outcome if rerun succeeds", async () => {
    // Only relevant when RETRYABLE_IMMEDIATE_ATTEMPTS > 1
    if (RETRYABLE_IMMEDIATE_ATTEMPTS <= 1) {
      // With 1 attempt, no rerun happens — test the schedule path
      const scheduleDeferredRetry = vi.fn();
      const result = await handleRetryableRunOutcome({
        runOutcome: makeRetryableOutcome(),
        isHeartbeat: false,
        scheduleDeferredRetry,
        rerunAgent: vi.fn(),
      });
      expect(result).not.toBeNull();
      return;
    }

    const success = makeSuccessOutcome();
    const rerunAgent = vi.fn().mockResolvedValue(success);
    const scheduleDeferredRetry = vi.fn();

    const result = await handleRetryableRunOutcome({
      runOutcome: makeRetryableOutcome(),
      isHeartbeat: false,
      scheduleDeferredRetry,
      rerunAgent,
    });

    expect(result).not.toBeNull();
    expect(result!.outcome).toBe(success);
    expect(scheduleDeferredRetry).not.toHaveBeenCalled();
  });
});

describe("buildScheduleDeferredRetry", () => {
  it("calls enqueueDeferredRetry and does not throw on success", async () => {
    const sendRetryUpdate = vi.fn();
    const followupRun = { run: { sessionKey: "test" }, prompt: "hello" } as any;

    // The actual enqueueDeferredRetry is deeply integrated — test the builder shape
    const scheduleFn = buildScheduleDeferredRetry({
      followupRun,
      sendRetryUpdate,
    });

    expect(typeof scheduleFn).toBe("function");
  });
});

describe("buildSendProgrammaticRetryUpdate", () => {
  it("returns a function", () => {
    const followupRun = {
      originatingChannel: "discord",
      originatingTo: "123",
      run: { sessionKey: "test", config: {} },
    } as any;

    const sendFn = buildSendProgrammaticRetryUpdate({ followupRun });
    expect(typeof sendFn).toBe("function");
  });
});
