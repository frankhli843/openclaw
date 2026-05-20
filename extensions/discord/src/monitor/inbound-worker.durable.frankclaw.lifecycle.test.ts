import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDurableDiscordInboundWorker } from "./inbound-worker.durable.frankclaw.js";

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "discord-durable-lifecycle-test-"));
}

function makeRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

function makeRuntimeRef(runtime = makeRuntime()) {
  return {
    runtime,
    abortSignal: undefined as AbortSignal | undefined,
    guildHistories: new Map(),
    client: {} as unknown,
    threadBindings: new Map(),
    discordRestFetch: undefined as unknown,
  };
}

function makeJob(overrides?: { queueKey?: string; channelId?: string; messageId?: string }) {
  const channelId = overrides?.channelId ?? "ch-" + crypto.randomUUID().slice(0, 8);
  const messageId = overrides?.messageId ?? "msg-" + crypto.randomUUID().slice(0, 8);
  const queueKey = overrides?.queueKey ?? `agent:main:discord:channel:${channelId}`;

  return {
    queueKey,
    payload: {
      messageChannelId: channelId,
      data: {
        message: {
          id: messageId,
          content: "hello",
          author: { id: "user-1" },
        },
      },
      route: { sessionKey: queueKey },
    },
  };
}

function createProgressSequence(...entries: Array<Record<string, unknown>>) {
  const queue = [...entries];
  return vi.fn(async () => {
    const next = queue.shift();
    return {
      transcriptExists: false,
      transcriptSize: 0,
      transcriptMtimeMs: 0,
      ...next,
    };
  });
}

describe("durable discord worker inbound lifecycle terminals", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("treats missing terminal lifecycle as a hard failure instead of silent success", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence({}, {}),
        processDiscordMessage: vi.fn(async () => undefined) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await vi.waitFor(
      () => {
        expect(onDeadLetter).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000, interval: 100 },
    );

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("missing terminal inbound lifecycle state"),
    );
    await worker.stop();
  });

  it("treats intentional noop as dropped_intentionally terminal state", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence({}, {}),
        processDiscordMessage: vi.fn(async (_ctx, observer) => {
          observer?.onNoop?.("empty-content");
        }) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await vi.waitFor(
      () => {
        expect(onDeadLetter).not.toHaveBeenCalled();
      },
      { timeout: 500, interval: 50 },
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("missing terminal inbound lifecycle state"),
    );
    await worker.stop();
  });

  it("treats reply delivery as terminal even without transcript progress evidence", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence({}, {}),
        processDiscordMessage: vi.fn(async (_ctx, observer) => {
          observer?.onFinalReplyDelivered?.();
        }) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onDeadLetter).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("missing terminal inbound lifecycle state"),
    );
    await worker.stop();
  });

  it("treats visible Discord error delivery as terminal to avoid dead-letter replay", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence(
          {
            sessionId: "session-123",
            sessionFile: "/tmp/session-123.jsonl",
            updatedAt: 123,
            status: "running",
            transcriptExists: true,
            transcriptSize: 1024,
            transcriptMtimeMs: 123,
          },
          {
            sessionId: "session-123",
            sessionFile: "/tmp/session-123.jsonl",
            updatedAt: 456,
            status: "done",
            transcriptExists: true,
            transcriptSize: 4096,
            transcriptMtimeMs: 456,
          },
        ),
        processDiscordMessage: vi.fn(async (_ctx, observer) => {
          observer?.onVisibleReplyDelivered?.({ isFinal: true, isError: true });
        }) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onDeadLetter).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("completed without visible reply"),
    );
    await worker.stop();
  });

  // Regression test for 2026-04-09 bug: Discord durable worker dead-lettered
  // messages when auto-thread creation moved the session to a new channel key.
  // The worker was checking progress against the original orderingKey (parent
  // channel), which never saw any session writes — the session was actually
  // recorded under the new thread's channel key. Fix: capture the resolved
  // session key via onReplyPlanResolved and check progress against it.
  it("checks progress against resolved session key when auto-thread is created", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const orderingKey = "agent:main:discord:channel:1474343755153932394"; // parent channel
    const resolvedSessionKey = "agent:main:discord:channel:1491803173252497548"; // new thread

    // captureSessionProgress returns empty for orderingKey, but populated for resolvedSessionKey.
    const captureSessionProgress = vi.fn(async (key: string) => {
      if (key === resolvedSessionKey) {
        return {
          sessionId: "session-new-thread",
          sessionFile: "/tmp/new-thread-session.jsonl",
          updatedAt: Date.now(),
          status: "done",
          transcriptExists: true,
          transcriptSize: 4096,
          transcriptMtimeMs: Date.now(),
        };
      }
      return {
        transcriptExists: false,
        transcriptSize: 0,
        transcriptMtimeMs: 0,
      };
    });

    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress,
        processDiscordMessage: vi.fn(async (_ctx, observer) => {
          // Simulate auto-thread creation: resolver fires with new sessionKey
          observer?.onReplyPlanResolved?.({
            createdThreadId: "1491803173252497548",
            sessionKey: resolvedSessionKey,
          });
          observer?.onFinalReplyDelivered?.();
          // Session write happens under the new thread key, not orderingKey
        }) as never,
      },
    });

    await worker.start();
    worker.enqueue(
      makeJob({
        queueKey: orderingKey,
        channelId: "1474343755153932394",
        messageId: "1491803173252497548",
      }) as never,
    );

    // Give the worker time to process
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The worker should NOT dead-letter — the resolved session key showed real progress
    expect(onDeadLetter).not.toHaveBeenCalled();
    expect(runtime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("missing terminal inbound lifecycle state"),
    );
    // captureSessionProgress should have been called with the resolved session key
    expect(captureSessionProgress).toHaveBeenCalledWith(resolvedSessionKey);
    await worker.stop();
  });

  it("does not treat completed tool-only transcript progress as a delivered reply", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence(
          {
            sessionId: "session-123",
            sessionFile: "/tmp/session-123.jsonl",
            updatedAt: 123,
            status: "running",
            transcriptExists: true,
            transcriptSize: 1024,
            transcriptMtimeMs: 123,
          },
          {
            sessionId: "session-123",
            sessionFile: "/tmp/session-123.jsonl",
            updatedAt: 456,
            status: "done",
            transcriptExists: true,
            transcriptSize: 4096,
            transcriptMtimeMs: 456,
          },
        ),
        processDiscordMessage: vi.fn(async () => undefined) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await vi.waitFor(
      () => {
        expect(onDeadLetter).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000, interval: 100 },
    );

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("completed without visible reply"),
    );
    await worker.stop();
  });

  it("logs session metadata exists but transcript missing for partial materialization", async () => {
    const runtime = makeRuntime();
    const runtimeRef = makeRuntimeRef(runtime);
    const onDeadLetter = vi.fn();
    const worker = createDurableDiscordInboundWorker({
      accountId: "default",
      runtime: runtime as never,
      stateDir: tmpDir,
      maxAttempts: 1,
      resolveRuntime: () => runtimeRef as never,
      onDeadLetter,
      __testing: {
        captureSessionProgress: createProgressSequence(
          {},
          {
            sessionId: "session-123",
            sessionFile: "/tmp/missing-session-123.jsonl",
            updatedAt: 123,
            status: "running",
            transcriptExists: false,
            transcriptSize: 0,
            transcriptMtimeMs: 0,
          },
        ),
        processDiscordMessage: vi.fn(async () => undefined) as never,
      },
    });

    await worker.start();
    worker.enqueue(makeJob() as never);

    await vi.waitFor(
      () => {
        expect(onDeadLetter).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000, interval: 100 },
    );

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("session metadata exists but transcript missing"),
    );
    await worker.stop();
  });
});
