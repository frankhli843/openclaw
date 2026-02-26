import crypto from "node:crypto";
import { defaultRuntime } from "../../runtime.js";
import type { ReplyPayload } from "../types.js";
import { createDeferredRetryDurableQueue } from "./deferred-retry-durable-queue.js";
import { createFollowupRunner } from "./followup-runner.js";
import type { FollowupRun } from "./queue.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import type { TypingController } from "./typing.js";

export const DEFERRED_RETRY_MAX_WINDOW_MS = 60 * 60 * 1000;
export const DEFERRED_RETRY_FIB_BASE_DELAY_MS = 5 * 60 * 1000;
export const DEFERRED_RETRY_FIB_NEXT_DELAY_MS = 10 * 60 * 1000;

function getDeferredRetryDelayMs(attemptIndex: number): number {
  if (attemptIndex <= 0) {
    return DEFERRED_RETRY_FIB_BASE_DELAY_MS;
  }
  if (attemptIndex === 1) {
    return DEFERRED_RETRY_FIB_NEXT_DELAY_MS;
  }
  let prev = DEFERRED_RETRY_FIB_BASE_DELAY_MS;
  let curr = DEFERRED_RETRY_FIB_NEXT_DELAY_MS;
  for (let i = 2; i <= attemptIndex; i += 1) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }
  return curr;
}

function buildAttemptDedupeKey(baseDedupeKey: string, attemptIndex: number): string {
  return `${baseDedupeKey}:retry:${attemptIndex}`;
}

const queue = createDeferredRetryDurableQueue({
  queueName: "followup-final-retry",
  onDeadLetter: async (event, reason) => {
    const followupRun = coerceFollowupRun(event.followupRun);
    if (!followupRun) {
      return;
    }

    const baseDedupeKey = event.baseDedupeKey?.trim() || event.dedupeKey;
    const currentAttempt = Math.max(0, event.attemptIndex ?? 0);
    const firstEnqueuedAt = event.firstEnqueuedAt ?? Date.now();
    const elapsedMs = Math.max(0, Date.now() - firstEnqueuedAt);
    const nextAttempt = currentAttempt + 1;
    const nextDelayMs = getDeferredRetryDelayMs(nextAttempt);
    const canRetryAgain = elapsedMs + nextDelayMs <= DEFERRED_RETRY_MAX_WINDOW_MS;

    if (canRetryAgain) {
      const retryFailureMessage =
        reason.lastError?.trim() ||
        event.failureMessage?.trim() ||
        "deferred retry failed for unknown reason";
      await queue.enqueue({
        dedupeKey: buildAttemptDedupeKey(baseDedupeKey, nextAttempt),
        baseDedupeKey,
        attemptIndex: nextAttempt,
        firstEnqueuedAt,
        scheduledDelayMs: nextDelayMs,
        nextAttemptAt: Date.now() + nextDelayMs,
        failureMessage: retryFailureMessage,
        followupRun,
      });
      return;
    }

    const message =
      reason.lastError?.trim() ||
      event.failureMessage?.trim() ||
      "deferred retry failed for unknown reason";
    await sendProgrammaticRetryUpdate(
      followupRun,
      `⚠️ Deferred retry exhausted (Fibonacci backoff for up to 1 hour). Last error: ${message}`,
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
  const firstEnqueuedAt = Date.now();
  const baseDedupeKey = buildDedupeKey(followupRun);
  const attemptIndex = 0;
  const scheduledDelayMs = getDeferredRetryDelayMs(attemptIndex);
  return await queue.enqueue({
    dedupeKey: buildAttemptDedupeKey(baseDedupeKey, attemptIndex),
    baseDedupeKey,
    attemptIndex,
    firstEnqueuedAt,
    scheduledDelayMs,
    nextAttemptAt: firstEnqueuedAt + scheduledDelayMs,
    failureMessage,
    followupRun,
  });
}

export async function __stopDeferredRetryWorkerForTest(): Promise<void> {
  await queue.stop();
  started = false;
  startPromise = null;
}
