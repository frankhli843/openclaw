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
