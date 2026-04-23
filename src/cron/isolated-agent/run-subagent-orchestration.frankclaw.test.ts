import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_ORCHESTRATION_FOLLOWUPS,
  runOrchestrationLoop,
  type OrchestrationContext,
} from "./run-subagent-orchestration.frankclaw.js";

// Mock the lazy-loaded runtime modules
const waitForDescendantSubagentSummaryMock = vi.fn().mockResolvedValue(undefined);
const readDescendantSubagentFallbackReplyMock = vi.fn().mockResolvedValue(undefined);
const countActiveDescendantRunsMock = vi.fn().mockReturnValue(0);
const listDescendantRunsForRequesterMock = vi.fn().mockReturnValue([]);
const findTaskByRunIdMock = vi.fn().mockReturnValue(undefined);

vi.mock("./subagent-followup.runtime.js", () => ({
  waitForDescendantSubagentSummary: (...args: unknown[]) =>
    waitForDescendantSubagentSummaryMock(...args),
  readDescendantSubagentFallbackReply: (...args: unknown[]) =>
    readDescendantSubagentFallbackReplyMock(...args),
}));

vi.mock("./run-subagent-registry.runtime.js", () => ({
  countActiveDescendantRuns: (...args: unknown[]) => countActiveDescendantRunsMock(...args),
  listDescendantRunsForRequester: (...args: unknown[]) =>
    listDescendantRunsForRequesterMock(...args),
}));

vi.mock("./run-task-registry.runtime.js", () => ({
  findTaskByRunId: (...args: unknown[]) => findTaskByRunIdMock(...args),
}));

vi.mock("../../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({ info: undefined, warn: undefined }),
}));

function makeCtx(overrides?: Partial<OrchestrationContext>): OrchestrationContext {
  const runResult = { payloads: [{ text: "On it" }], meta: {} };
  return {
    agentSessionKey: "agent:main:cron:test-session",
    runStartedAt: Date.now() - 10_000,
    timeoutMs: 300_000,
    sessionFilePath: undefined,
    isAborted: () => false,
    runPrompt: vi.fn().mockResolvedValue(undefined),
    getRunResult: () => ({ runResult }),
    ...overrides,
  };
}

describe("runOrchestrationLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countActiveDescendantRunsMock.mockReturnValue(0);
    listDescendantRunsForRequesterMock.mockReturnValue([]);
    findTaskByRunIdMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when no descendants and output is substantive", async () => {
    const ctx = makeCtx();
    const checkInterim = () => false; // Not interim
    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(0);
    expect(ctx.runPrompt).not.toHaveBeenCalled();
  });

  it("retries once when interim output and no descendants", async () => {
    const ctx = makeCtx();
    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // First call: interim
      .mockReturnValueOnce(false); // After retry: substantive
    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);
    expect(ctx.runPrompt).toHaveBeenCalledTimes(1);
    expect((ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "previous response was only an acknowledgement",
    );
  });

  it("waits for active descendants and feeds output back", async () => {
    // Simulate: model spawns a child, yields with interim text
    const runStartedAt = Date.now() - 10_000;
    let turn = 0;
    const ctx = makeCtx({
      runStartedAt,
      getRunResult: () => ({
        runResult: {
          payloads: [{ text: turn === 0 ? "On it" : "All done, 4 batches completed." }],
          meta: {},
        },
      }),
    });

    // First call: 1 active descendant, 1 fresh descendant
    // Second call (after wait): 0 active, 0 fresh
    countActiveDescendantRunsMock
      .mockReturnValueOnce(1) // first check in loop
      .mockReturnValueOnce(0) // after wait
      .mockReturnValueOnce(0); // next iteration check
    listDescendantRunsForRequesterMock
      .mockReturnValueOnce([{ startedAt: runStartedAt + 1000, createdAt: runStartedAt + 1000 }])
      .mockReturnValueOnce([]);
    waitForDescendantSubagentSummaryMock.mockResolvedValue(undefined);
    readDescendantSubagentFallbackReplyMock.mockResolvedValueOnce(
      "Batch 1 complete: 23 files processed",
    );

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // First: interim
      .mockReturnValueOnce(false); // After feeding back: substantive

    (ctx.runPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      turn++;
      return Promise.resolve();
    });

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);
    expect(ctx.runPrompt).toHaveBeenCalledTimes(1);
    expect((ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "Batch 1 complete: 23 files processed",
    );
    expect(waitForDescendantSubagentSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("loops multiple times for multi-batch orchestration", async () => {
    const runStartedAt = Date.now() - 10_000;
    let turn = 0;

    const ctx = makeCtx({
      runStartedAt,
      getRunResult: () => ({
        runResult: { payloads: [{ text: turn < 3 ? "On it" : "Final summary" }], meta: {} },
      }),
    });

    // Simulate 3 batches of children
    countActiveDescendantRunsMock
      // Turn 0: check active (1) -> wait -> check still (0) -> next iter
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0)
      // Turn 1: check active (1) -> wait -> check still (0) -> next iter
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0)
      // Turn 2: check active (1) -> wait -> check still (0) -> next iter
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0)
      // Turn 3: no descendants
      .mockReturnValueOnce(0);

    listDescendantRunsForRequesterMock
      .mockReturnValueOnce([{ startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 }])
      .mockReturnValueOnce([{ startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 }])
      .mockReturnValueOnce([{ startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 }])
      .mockReturnValueOnce([]);

    readDescendantSubagentFallbackReplyMock
      .mockResolvedValueOnce("Batch 1 done")
      .mockResolvedValueOnce("Batch 2 done")
      .mockResolvedValueOnce("Batch 3 done");

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // batch 1 interim
      .mockReturnValueOnce(true) // batch 2 interim
      .mockReturnValueOnce(true) // batch 3 interim
      .mockReturnValueOnce(false); // final output

    (ctx.runPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      turn++;
      return Promise.resolve();
    });

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(3);
    expect(ctx.runPrompt).toHaveBeenCalledTimes(3);
    expect(waitForDescendantSubagentSummaryMock).toHaveBeenCalledTimes(3);
  });

  it("respects MAX_ORCHESTRATION_FOLLOWUPS limit", async () => {
    const runStartedAt = Date.now() - 10_000;
    const ctx = makeCtx({ runStartedAt });

    // Always have active descendants and always interim
    countActiveDescendantRunsMock.mockReturnValue(1);
    listDescendantRunsForRequesterMock.mockReturnValue([
      { startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 },
    ]);
    readDescendantSubagentFallbackReplyMock.mockResolvedValue("batch done");
    // After wait, report 0 active so loop continues to next turn
    let callCount = 0;
    countActiveDescendantRunsMock.mockImplementation(() => {
      callCount++;
      // Alternate: active then drained
      return callCount % 2 === 1 ? 1 : 0;
    });

    const checkInterim = () => true; // Always interim

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(MAX_ORCHESTRATION_FOLLOWUPS);
  });

  it("stops when aborted", async () => {
    const runStartedAt = Date.now() - 10_000;
    let aborted = false;

    const ctx = makeCtx({
      runStartedAt,
      isAborted: () => aborted,
    });

    countActiveDescendantRunsMock.mockReturnValue(1);
    listDescendantRunsForRequesterMock.mockReturnValue([
      { startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 },
    ]);
    readDescendantSubagentFallbackReplyMock.mockResolvedValue("done");
    // After wait, 0 active
    let callCount = 0;
    countActiveDescendantRunsMock.mockImplementation(() => {
      callCount++;
      return callCount % 2 === 1 ? 1 : 0;
    });

    const checkInterim = () => true;

    (ctx.runPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      aborted = true; // Abort after first retry
      return Promise.resolve();
    });

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);
  });

  it("handles descendant with no output gracefully", async () => {
    const runStartedAt = Date.now() - 10_000;
    const ctx = makeCtx({ runStartedAt });

    countActiveDescendantRunsMock
      .mockReturnValueOnce(1) // active
      .mockReturnValueOnce(0) // after wait
      .mockReturnValueOnce(0); // next iter

    listDescendantRunsForRequesterMock.mockReturnValue([
      { startedAt: runStartedAt + 1, createdAt: runStartedAt + 1 },
    ]);
    readDescendantSubagentFallbackReplyMock.mockResolvedValueOnce(undefined);

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // interim
      .mockReturnValueOnce(false); // after retry

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);
    expect((ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "produced no readable output",
    );
  });

  it("detects blocked descendant (progress checkpoint) and warns parent to retry", async () => {
    // Regression test for 2026-04-23 heartbeat incident: ACP worker returned
    // HEARTBEAT_OK without running tools, was marked terminalOutcome="blocked",
    // but the orchestrator accepted the output as valid and stopped.
    const runStartedAt = Date.now() - 10_000;
    let turn = 0;

    const ctx = makeCtx({
      runStartedAt,
      getRunResult: () => ({
        runResult: {
          payloads: [{ text: turn === 0 ? "On it" : "Spawned a new worker to retry." }],
          meta: {},
        },
      }),
    });

    const childRunId = "run-blocked-heartbeat";
    const childLabel = "heartbeat-1776947387-f96acd";

    // Descendant completed but blocked at progress checkpoint
    countActiveDescendantRunsMock
      .mockReturnValueOnce(1) // first check: 1 active
      .mockReturnValueOnce(0) // after wait: drained
      .mockReturnValueOnce(0); // next iter

    listDescendantRunsForRequesterMock.mockReturnValue([
      {
        runId: childRunId,
        label: childLabel,
        startedAt: runStartedAt + 1000,
        createdAt: runStartedAt + 1000,
        endedAt: runStartedAt + 5000,
        childSessionKey: "agent:claude:acp:test-blocked",
      },
    ]);

    // Worker returned HEARTBEAT_OK text but was blocked
    readDescendantSubagentFallbackReplyMock.mockResolvedValueOnce("HEARTBEAT_OK");

    // Task registry shows this run was blocked at a progress checkpoint
    findTaskByRunIdMock.mockImplementation((runId: string) => {
      if (runId === childRunId) {
        return {
          taskId: "task-blocked-test",
          runId: childRunId,
          status: "succeeded",
          terminalOutcome: "blocked",
          terminalSummary: "ACP run stopped at a progress checkpoint instead of a terminal result.",
        };
      }
      return undefined;
    });

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // interim (parent ack)
      .mockReturnValueOnce(false); // after retry: substantive

    (ctx.runPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      turn++;
      return Promise.resolve();
    });

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);
    expect(ctx.runPrompt).toHaveBeenCalledTimes(1);

    // The continuation prompt should warn about blocked worker, not just pass output through
    const prompt = (ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("WARNING");
    expect(prompt).toContain("progress checkpoint");
    expect(prompt).toContain("did NOT complete the task");
    expect(prompt).toContain(childLabel);
    expect(prompt).toContain("spawn a new worker to retry");
    // Should NOT say "completed" — the worker was blocked
    expect(prompt).not.toContain("Your spawned background worker completed. Here is its output:");
  });

  it("switches to direct-execution fallback after 2 consecutive blocked attempts", async () => {
    // frankclaw: when ACP workers checkpoint-stop repeatedly, the orchestration
    // should stop telling the model to spawn new workers and instead instruct
    // it to execute the task directly.
    const runStartedAt = Date.now() - 10_000;
    let turn = 0;

    const ctx = makeCtx({
      runStartedAt,
      getRunResult: () => ({
        runResult: {
          payloads: [
            {
              text:
                turn === 0
                  ? "On it"
                  : turn === 1
                    ? "Spawned retry worker"
                    : "Final check result: all OK",
            },
          ],
          meta: {},
        },
      }),
    });

    const childRunId1 = "run-blocked-1";
    const childRunId2 = "run-blocked-2";
    const childLabel1 = "heartbeat-blocked-1";
    const childLabel2 = "heartbeat-blocked-2";

    // Two rounds of descendants, both blocked.
    // Note: listDescendantRunsForRequesterMock is called both in the main loop
    // AND inside resolveBlockedDescendantLabels, so we need values for all calls.
    const child1Entry = {
      runId: childRunId1,
      label: childLabel1,
      startedAt: runStartedAt + 1000,
      createdAt: runStartedAt + 1000,
      endedAt: runStartedAt + 5000,
    };
    const child2Entry = {
      runId: childRunId2,
      label: childLabel2,
      startedAt: runStartedAt + 6000,
      createdAt: runStartedAt + 6000,
      endedAt: runStartedAt + 10000,
    };

    countActiveDescendantRunsMock
      // Round 1: blocked descendant
      .mockReturnValueOnce(1) // main loop: active check
      .mockReturnValueOnce(0) // main loop: stillActive after wait
      // Round 2: another blocked descendant
      .mockReturnValueOnce(1) // main loop: active check
      .mockReturnValueOnce(0) // main loop: stillActive after wait
      // Round 3: no descendants (model executed directly)
      .mockReturnValueOnce(0);

    listDescendantRunsForRequesterMock
      // Round 1: main loop freshDescendants check
      .mockReturnValueOnce([child1Entry])
      // Round 1: resolveBlockedDescendantLabels check
      .mockReturnValueOnce([child1Entry])
      // Round 2: main loop freshDescendants check
      .mockReturnValueOnce([child2Entry])
      // Round 2: resolveBlockedDescendantLabels check
      .mockReturnValueOnce([child2Entry])
      // Round 3: main loop freshDescendants check (no more)
      .mockReturnValueOnce([]);

    readDescendantSubagentFallbackReplyMock
      .mockResolvedValueOnce("HEARTBEAT_OK")
      .mockResolvedValueOnce("HEARTBEAT_OK");

    // Both runs blocked
    findTaskByRunIdMock.mockImplementation((runId: string) => {
      if (runId === childRunId1 || runId === childRunId2) {
        return {
          taskId: `task-${runId}`,
          runId,
          status: "succeeded",
          terminalOutcome: "blocked",
          terminalSummary: "ACP run completed with zero tool calls.",
        };
      }
      return undefined;
    });

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // round 1: interim
      .mockReturnValueOnce(true) // round 2: still interim (spawned another)
      .mockReturnValueOnce(false); // round 3: direct execution worked

    (ctx.runPrompt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      turn++;
      return Promise.resolve();
    });

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(2);
    expect(ctx.runPrompt).toHaveBeenCalledTimes(2);

    // First prompt: warning to retry with new worker
    const prompt1 = (ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt1).toContain("WARNING");
    expect(prompt1).toContain("spawn a new worker to retry");

    // Second prompt: auto-fallback to direct execution
    const prompt2 = (ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(prompt2).toContain("CRITICAL");
    expect(prompt2).toContain("DO NOT spawn another background worker");
    expect(prompt2).toContain("DIRECTLY in this session");
    expect(prompt2).toContain("failed 2 consecutive times");
  });

  it("does not warn for non-blocked descendants", async () => {
    // When the task registry shows succeeded (no blocked outcome), the
    // continuation prompt should be the normal "completed" message.
    const runStartedAt = Date.now() - 10_000;
    const ctx = makeCtx({ runStartedAt });

    const childRunId = "run-ok-heartbeat";

    countActiveDescendantRunsMock
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0);

    listDescendantRunsForRequesterMock.mockReturnValue([
      {
        runId: childRunId,
        label: "heartbeat-ok-label",
        startedAt: runStartedAt + 1000,
        createdAt: runStartedAt + 1000,
        endedAt: runStartedAt + 5000,
        childSessionKey: "agent:claude:acp:test-ok",
      },
    ]);

    readDescendantSubagentFallbackReplyMock.mockResolvedValueOnce(
      "HEARTBEAT_OK. All checks passed.",
    );

    // Task registry shows normal successful completion (no blocked)
    findTaskByRunIdMock.mockImplementation((runId: string) => {
      if (runId === childRunId) {
        return {
          taskId: "task-ok-test",
          runId: childRunId,
          status: "succeeded",
          terminalOutcome: undefined, // NOT blocked
        };
      }
      return undefined;
    });

    const checkInterim = vi
      .fn()
      .mockReturnValueOnce(true) // interim
      .mockReturnValueOnce(false); // after feeding back

    const turns = await runOrchestrationLoop(ctx, checkInterim);
    expect(turns).toBe(1);

    const prompt = (ctx.runPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).toContain("Your spawned background worker completed. Here is its output:");
    expect(prompt).not.toContain("WARNING");
  });
});
