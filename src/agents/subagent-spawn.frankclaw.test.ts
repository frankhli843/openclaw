import { afterEach, describe, expect, it, vi } from "vitest";

// The module captures the queue at import time. We need the mock to be
// set up so the factory function defers to a shared reference we can control.
// Use vi.hoisted to create the mock fn before vi.mock runs.
const mockQueueRun = vi.hoisted(() => vi.fn());

vi.mock("../jobs/durable-job-queue.js", () => ({
  createDurableJobQueue: () => ({
    run: mockQueueRun,
    _test: { listLive: vi.fn(), listDead: vi.fn() },
  }),
}));

// Mock the gateway call used by sendSubagentDeadLetterAlert
vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

import { runSpawnSubagentWithDurableQueue } from "./subagent-spawn.frankclaw.js";
import type {
  SpawnSubagentParams,
  SpawnSubagentContext,
  SpawnSubagentResult,
} from "./subagent-spawn.js";

afterEach(() => {
  mockQueueRun.mockReset();
});

describe("runSpawnSubagentWithDurableQueue", () => {
  const baseParams: SpawnSubagentParams = { task: "do something" };
  const baseCtx: SpawnSubagentContext = {};

  it("routes normal tasks through the durable queue", async () => {
    const expected: SpawnSubagentResult = {
      status: "accepted",
      childSessionKey: "agent:main:subagent:abc",
      runId: "run-1",
    };
    mockQueueRun.mockImplementation(
      async (opts: {
        run: (payload: {
          params: SpawnSubagentParams;
          ctx: SpawnSubagentContext;
        }) => Promise<SpawnSubagentResult>;
      }) => {
        return await opts.run({ params: baseParams, ctx: baseCtx });
      },
    );
    const runCore = vi.fn().mockResolvedValue(expected);

    await runSpawnSubagentWithDurableQueue({
      params: baseParams,
      ctx: baseCtx,
      runCore,
    });

    expect(mockQueueRun).toHaveBeenCalledOnce();
    expect(mockQueueRun.mock.calls[0][0]).toMatchObject({
      queue: "subagent-spawn-jobs",
      kind: "subagent-spawn",
    });
  });

  it("bypasses queue for excluded tasks (verifier)", async () => {
    const verifierParams: SpawnSubagentParams = { task: "Run the verifier check" };
    const expected: SpawnSubagentResult = { status: "accepted", runId: "r1" };
    const runCore = vi.fn().mockResolvedValue(expected);

    const result = await runSpawnSubagentWithDurableQueue({
      params: verifierParams,
      ctx: baseCtx,
      runCore,
    });

    expect(mockQueueRun).not.toHaveBeenCalled();
    expect(runCore).toHaveBeenCalledWith(verifierParams, baseCtx);
    expect(result.status).toBe("accepted");
  });

  it("bypasses queue when label contains healer", async () => {
    const healerParams: SpawnSubagentParams = { task: "fix it", label: "Healer task" };
    const runCore = vi.fn().mockResolvedValue({ status: "accepted", runId: "r2" });

    await runSpawnSubagentWithDurableQueue({
      params: healerParams,
      ctx: baseCtx,
      runCore,
    });

    expect(mockQueueRun).not.toHaveBeenCalled();
    expect(runCore).toHaveBeenCalledOnce();
  });

  it("bypasses queue when task contains checkup", async () => {
    const checkupParams: SpawnSubagentParams = { task: "run Checkup now" };
    const runCore = vi.fn().mockResolvedValue({ status: "accepted", runId: "r3" });

    await runSpawnSubagentWithDurableQueue({
      params: checkupParams,
      ctx: baseCtx,
      runCore,
    });

    expect(mockQueueRun).not.toHaveBeenCalled();
  });

  it("returns error status when queue throws", async () => {
    mockQueueRun.mockRejectedValue(new Error("queue exploded"));
    const runCore = vi.fn();

    const result = await runSpawnSubagentWithDurableQueue({
      params: baseParams,
      ctx: baseCtx,
      runCore,
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe("queue exploded");
  });

  it("verify callback rejects spawn without runId", async () => {
    let capturedVerify:
      | ((p: { result: SpawnSubagentResult }) => Promise<{ ok: boolean; detail?: string }>)
      | undefined;
    mockQueueRun.mockImplementation(
      async (opts: {
        verify?: (p: { result: SpawnSubagentResult }) => Promise<{ ok: boolean; detail?: string }>;
        run: (payload: {
          params: SpawnSubagentParams;
          ctx: SpawnSubagentContext;
        }) => Promise<SpawnSubagentResult>;
      }) => {
        capturedVerify = opts.verify;
        return await opts.run({ params: baseParams, ctx: baseCtx });
      },
    );
    const runCore = vi.fn().mockResolvedValue({ status: "accepted" });

    await runSpawnSubagentWithDurableQueue({
      params: baseParams,
      ctx: baseCtx,
      runCore,
    });

    expect(capturedVerify).toBeDefined();
    const verifyResult = await capturedVerify!({ result: { status: "accepted" } });
    expect(verifyResult.ok).toBe(false);
    expect(verifyResult.detail).toContain("missing run id");
  });

  it("verify callback accepts forbidden status", async () => {
    let capturedVerify:
      | ((p: { result: SpawnSubagentResult }) => Promise<{ ok: boolean; detail?: string }>)
      | undefined;
    mockQueueRun.mockImplementation(
      async (opts: {
        verify?: (p: { result: SpawnSubagentResult }) => Promise<{ ok: boolean; detail?: string }>;
        run: (payload: {
          params: SpawnSubagentParams;
          ctx: SpawnSubagentContext;
        }) => Promise<SpawnSubagentResult>;
      }) => {
        capturedVerify = opts.verify;
        return await opts.run({ params: baseParams, ctx: baseCtx });
      },
    );
    const runCore = vi.fn().mockResolvedValue({ status: "forbidden", error: "not allowed" });

    await runSpawnSubagentWithDurableQueue({
      params: baseParams,
      ctx: baseCtx,
      runCore,
    });

    const verifyResult = await capturedVerify!({
      result: { status: "forbidden", error: "not allowed" },
    });
    expect(verifyResult.ok).toBe(true);
  });

  it("onDeadLetter callback is provided and sends alert", async () => {
    let capturedOnDeadLetter:
      | ((p: { reason: string; error?: string }) => Promise<void>)
      | undefined;
    mockQueueRun.mockImplementation(
      async (opts: {
        onDeadLetter?: (p: { reason: string; error?: string }) => Promise<void>;
        run: (payload: {
          params: SpawnSubagentParams;
          ctx: SpawnSubagentContext;
        }) => Promise<SpawnSubagentResult>;
      }) => {
        capturedOnDeadLetter = opts.onDeadLetter;
        return await opts.run({ params: baseParams, ctx: baseCtx });
      },
    );
    const runCore = vi.fn().mockResolvedValue({ status: "accepted", runId: "r1" });

    await runSpawnSubagentWithDurableQueue({
      params: baseParams,
      ctx: baseCtx,
      runCore,
    });

    expect(capturedOnDeadLetter).toBeDefined();
    // The dead letter handler calls callGateway (mocked) - should not throw
    await expect(
      capturedOnDeadLetter!({ reason: "retry-exhausted", error: "connection failed" }),
    ).resolves.toBeUndefined();
  });
});
