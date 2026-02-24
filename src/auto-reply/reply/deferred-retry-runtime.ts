import crypto from "node:crypto";
import { defaultRuntime } from "../../runtime.js";
import type { ReplyPayload } from "../types.js";
import { createDeferredRetryDurableQueue } from "./deferred-retry-durable-queue.js";
import { createFollowupRunner } from "./followup-runner.js";
import type { FollowupRun } from "./queue.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import type { TypingController } from "./typing.js";

export const DEFERRED_RETRY_DELAY_MS = 30 * 60 * 1000;

const queue = createDeferredRetryDurableQueue({
  queueName: "followup-final-retry",
  onDeadLetter: async (event, reason) => {
    const followupRun = coerceFollowupRun(event.followupRun);
    if (!followupRun) {
      return;
    }
    const message =
      reason.lastError?.trim() ||
      event.failureMessage?.trim() ||
      "deferred retry failed for unknown reason";
    await sendProgrammaticRetryUpdate(
      followupRun,
      `⚠️ Dead letter: deferred retry failed after 30m. Last error: ${message}`,
    );
  },
});

let started = false;
let startPromise: Promise<void> | null = null;

function buildDedupeKey(run: FollowupRun): string {
  const sessionKey = run.run.sessionKey?.trim();
  const sessionPart = sessionKey || run.run.sessionId;
  const messageId = run.messageId?.trim();
  const routePart = [
    run.originatingChannel ?? "",
    run.originatingTo ?? "",
    run.originatingAccountId ?? "",
    run.originatingThreadId != null ? String(run.originatingThreadId) : "",
  ].join("|");

  if (messageId) {
    return `${sessionPart}:${messageId}:${routePart}`;
  }

  const promptHash = crypto.createHash("sha256").update(run.prompt).digest("hex").slice(0, 16);
  return `${sessionPart}:prompt:${promptHash}:${routePart}`;
}

function createNoopTypingController(): TypingController {
  return {
    onReplyStart: async () => {},
    startTypingLoop: async () => {},
    startTypingOnText: async () => {},
    refreshTypingTtl: () => {},
    isActive: () => false,
    markRunComplete: () => {},
    markDispatchIdle: () => {},
    cleanup: () => {},
  };
}

function coerceFollowupRun(value: unknown): FollowupRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as FollowupRun;
}

async function sendProgrammaticRetryUpdate(followupRun: FollowupRun, text: string): Promise<void> {
  const payload: ReplyPayload = { text, isError: true };
  const channel = followupRun.originatingChannel;
  const to = followupRun.originatingTo;
  if (isRoutableChannel(channel) && to) {
    const result = await routeReply({
      payload,
      channel,
      to,
      sessionKey: followupRun.run.sessionKey,
      accountId: followupRun.originatingAccountId,
      threadId: followupRun.originatingThreadId,
      cfg: followupRun.run.config,
    });
    if (result.ok) {
      return;
    }
    defaultRuntime.error?.(`retry update route failed: ${result.error ?? "unknown"}`);
    return;
  }
  defaultRuntime.error?.(`retry update dropped (unroutable): ${text}`);
}

async function processDeferredRetry(event: { followupRun: unknown; failureMessage?: string }) {
  const followupRun = coerceFollowupRun(event.followupRun);
  if (!followupRun) {
    throw new Error("invalid deferred retry payload");
  }

  const runFollowupTurn = createFollowupRunner({
    typing: createNoopTypingController(),
    typingMode: "instant",
    defaultModel: followupRun.run.model,
  });

  try {
    await runFollowupTurn(followupRun);
    return;
  } catch (err) {
    const fallbackMessage = event.failureMessage?.trim() || "unknown deferred retry error";
    const errMessage = err instanceof Error ? err.message.trim() : String(err).trim();
    throw new Error(errMessage || fallbackMessage, { cause: err });
  }
}

export async function ensureDeferredRetryWorkerStarted(): Promise<void> {
  if (started) {
    return;
  }
  if (startPromise) {
    await startPromise;
    return;
  }
  startPromise = (async () => {
    await queue.start({
      process: async (event) => {
        await processDeferredRetry({
          followupRun: event.followupRun,
          failureMessage: event.failureMessage,
        });
      },
    });
    started = true;
  })().finally(() => {
    startPromise = null;
  });
  await startPromise;
}

export async function enqueueDeferredRetry(followupRun: FollowupRun, failureMessage?: string) {
  await ensureDeferredRetryWorkerStarted();
  return await queue.enqueue({
    dedupeKey: buildDedupeKey(followupRun),
    nextAttemptAt: Date.now() + DEFERRED_RETRY_DELAY_MS,
    failureMessage,
    followupRun,
  });
}

export async function __stopDeferredRetryWorkerForTest(): Promise<void> {
  await queue.stop();
  started = false;
  startPromise = null;
}
