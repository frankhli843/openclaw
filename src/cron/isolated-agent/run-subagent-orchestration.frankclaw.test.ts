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
});
