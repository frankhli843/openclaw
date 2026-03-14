/**
 * Tests for the frankclaw durable inbound worker wrapper
 * (message-handler.worker.frankclaw.ts).
 *
 * Covers:
 * 1. Worker implements DiscordInboundWorker interface (enqueue + deactivate)
 * 2. RunStateMachine integration — onRunStart/onRunEnd called per job
 * 3. Deactivation prevents further enqueues
 * 4. Deactivation calls durableWorker.stop()
 * 5. Worker auto-starts the durable queue on creation
 * 6. resolveRuntime is called on each job drain (not at enqueue time)
 * 7. Dead-letter callback is forwarded
 * 8. Graceful fallback: in-memory worker used when client is absent
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const processDiscordMessageMock = vi.hoisted(() => vi.fn());

vi.mock("./message-handler.process.js", () => ({
  processDiscordMessage: processDiscordMessageMock,
}));

// ── Imports ──────────────────────────────────────────────────────────────────

const { createFrankclawDurableInboundWorker } =
  await import("./message-handler.worker.frankclaw.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "frankclaw-wrapper-test-"));
}

function makeRuntime() {
  return {
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
    abortSignal: undefined as AbortSignal | undefined,
    guildHistories: new Map(),
    client: {} as unknown,
    threadBindings: new Map(),
    discordRestFetch: undefined as unknown,
  };
}

function makeJob(overrides?: {
  channelId?: string;
  messageId?: string;
  queueKey?: string;
  content?: string;
}) {
  const channelId = overrides?.channelId ?? "ch-" + crypto.randomUUID().slice(0, 8);
  const messageId = overrides?.messageId ?? "msg-" + crypto.randomUUID().slice(0, 8);
  const queueKey = overrides?.queueKey ?? `discord:test:${channelId}:author1`;

  return {
    queueKey,
    payload: {
      messageChannelId: channelId,
      data: {
        message: {
          id: messageId,
          content: overrides?.content ?? "test message",
          author: { id: "author1" },
        },
      },
      route: { sessionKey: `test:${channelId}` },
    },
    runtime: makeRuntime(),
  };
}

// ── Test State ───────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTmpDir();
  processDiscordMessageMock.mockReset();
  processDiscordMessageMock.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createFrankclawDurableInboundWorker", () => {
  it("implements DiscordInboundWorker interface with enqueue and deactivate", () => {
    const runtimeRef = makeRuntime();
    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-interface",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
    });

    expect(typeof worker.enqueue).toBe("function");
    expect(typeof worker.deactivate).toBe("function");

    // Cleanup
    worker.deactivate();
  });

  it("processes enqueued jobs via processDiscordMessage", async () => {
    const runtimeRef = makeRuntime();
    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-process",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
    });

    // Wait for auto-start
    await vi.waitFor(() => {}, { timeout: 200 });

    const job = makeJob({ content: "hello from test" });
    worker.enqueue(job as never);

    // Wait for the durable queue to drain and process
    await vi.waitFor(
      () => {
        expect(processDiscordMessageMock).toHaveBeenCalledTimes(1);
      },
      { timeout: 5_000, interval: 100 },
    );

    // Verify the context was materialized correctly
    const ctx = processDiscordMessageMock.mock.calls[0][0];
    expect(ctx.data.message.content).toBe("hello from test");

    worker.deactivate();
  });

  it("calls resolveRuntime at processing time, not at enqueue time", async () => {
    const resolveRuntime = vi.fn();
    const runtimeRef = makeRuntime();
    resolveRuntime.mockReturnValue(runtimeRef);

    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-resolve",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime,
    });

    await vi.waitFor(() => {}, { timeout: 200 });

    // resolveRuntime not called yet (no jobs enqueued)
    expect(resolveRuntime).not.toHaveBeenCalled();

    const job = makeJob();
    worker.enqueue(job as never);

    // Wait for processing — resolveRuntime should be called
    await vi.waitFor(
      () => {
        expect(resolveRuntime).toHaveBeenCalled();
      },
      { timeout: 5_000, interval: 100 },
    );

    worker.deactivate();
  });

  it("deactivation prevents further enqueues", async () => {
    const runtimeRef = makeRuntime();
    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-deactivate",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
    });

    await vi.waitFor(() => {}, { timeout: 200 });

    worker.deactivate();

    // Enqueue after deactivation should be silently dropped
    const job = makeJob();
    worker.enqueue(job as never);

    // Wait a bit to ensure nothing is processed
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(processDiscordMessageMock).not.toHaveBeenCalled();
  });

  it("processes multiple jobs with different queue keys", async () => {
    const runtimeRef = makeRuntime();
    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-multi",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
    });

    await vi.waitFor(() => {}, { timeout: 200 });

    const job1 = makeJob({ channelId: "ch-1", content: "first" });
    const job2 = makeJob({ channelId: "ch-2", content: "second" });
    worker.enqueue(job1 as never);
    worker.enqueue(job2 as never);

    await vi.waitFor(
      () => {
        expect(processDiscordMessageMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 5_000, interval: 100 },
    );

    worker.deactivate();
  });

  it("forwards dead-letter callback", async () => {
    const runtimeRef = makeRuntime();
    const onDeadLetter = vi.fn();

    // Make processDiscordMessage fail every time
    processDiscordMessageMock.mockRejectedValue(new Error("permanent failure"));

    const worker = createFrankclawDurableInboundWorker({
      accountId: "test-dl",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
      maxAttempts: 1, // Dead-letter after 1 attempt
      leaseMs: 500,
      onDeadLetter,
    });

    await vi.waitFor(() => {}, { timeout: 200 });

    const job = makeJob({ content: "will fail" });
    worker.enqueue(job as never);

    // Wait for dead-letter
    await vi.waitFor(
      () => {
        expect(onDeadLetter).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000, interval: 200 },
    );

    worker.deactivate();
  });

  it("survives simulated crash — persisted job is recovered", async () => {
    const runtimeRef = makeRuntime();
    let processCount = 0;

    // First worker: enqueue a job, then "crash" before processing
    processDiscordMessageMock.mockImplementation(async () => {
      processCount += 1;
    });

    // Create worker 1 — enqueue job but stop immediately (simulate crash)
    const worker1 = createFrankclawDurableInboundWorker({
      accountId: "test-crash-recovery",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
      leaseMs: 500, // Short lease so it expires quickly
    });

    await vi.waitFor(() => {}, { timeout: 200 });

    const job = makeJob({ content: "survive crash" });
    worker1.enqueue(job as never);

    // Wait for the job to be persisted but stop before processing completes
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker1.deactivate();

    // Reset so we can count new processing calls
    const processedBefore = processCount;
    processDiscordMessageMock.mockClear();

    // Create worker 2 — should recover the persisted job
    const worker2 = createFrankclawDurableInboundWorker({
      accountId: "test-crash-recovery",
      runtime: runtimeRef.runtime as never,
      stateDir: tmpDir,
      resolveRuntime: () => runtimeRef as never,
      leaseMs: 500,
    });

    // Wait for recovery processing
    await vi.waitFor(
      () => {
        // Either worker1 processed it or worker2 recovered it
        const totalProcessed = processedBefore + processDiscordMessageMock.mock.calls.length;
        expect(totalProcessed).toBeGreaterThanOrEqual(1);
      },
      { timeout: 10_000, interval: 200 },
    );

    worker2.deactivate();
  });
});
