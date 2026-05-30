import crypto from "node:crypto";
import { defaultRuntime } from "../../runtime.js";
import type { ReplyPayload } from "../types.js";
import { getSoonestCooldownExpiryAcrossAllProviders } from "./deferred-retry-cooldown-helpers.js";
import { createDeferredRetryDurableQueue } from "./deferred-retry-durable-queue.js";
import { createFollowupRunner } from "./followup-runner.js";
import type { FollowupRun } from "./queue.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";
import type { TypingController } from "./typing.js";

export const DEFERRED_RETRY_SCHEDULE_MS = [
  5_000,
  10_000,
  30_000,
  60_000,
  5 * 60_000,
  10 * 60_000,
] as const;
/** Extra buffer added to soonest cooldown expiry (ms). */
const COOLDOWN_RETRY_BUFFER_MS = 2 * 60_000;
const RETRY_FAILURE_ALERT_CHANNEL = "1474343755153932394";
const RETRY_LOG_CHANNEL = "1474343755153932394";

function getDeferredRetryDelayMs(attemptIndex: number): number | null {
  return DEFERRED_RETRY_SCHEDULE_MS[attemptIndex] ?? null;
}

function formatRetrySchedule(): string {
  return DEFERRED_RETRY_SCHEDULE_MS.map((delayMs) => {
    if (delayMs < 60_000) {
      return `${Math.round(delayMs / 1000)}s`;
    }
    return `${Math.round(delayMs / 60_000)}m`;
  }).join(", ");
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
    const nextAttempt = currentAttempt + 1;
    const nextDelayMs = getDeferredRetryDelayMs(nextAttempt);

    if (nextDelayMs != null) {
      const retryFailureMessage =
        reason.lastError?.trim() ||
        event.failureMessage?.trim() ||
        "deferred retry failed for unknown reason";
      const dedupeKey = buildAttemptDedupeKey(baseDedupeKey, nextAttempt);
      await queue.enqueue({
        dedupeKey,
        baseDedupeKey,
        attemptIndex: nextAttempt,
        firstEnqueuedAt,
        scheduledDelayMs: nextDelayMs,
        nextAttemptAt: Date.now() + nextDelayMs,
        failureMessage: retryFailureMessage,
        followupRun,
      });
      await sendRetryLogPost(
        followupRun,
        `🧾 Deferred retry queued (attempt ${nextAttempt + 1}/${DEFERRED_RETRY_SCHEDULE_MS.length})`,
        [
          `schedule: ${formatRetrySchedule()}`,
          `next retry in: ${Math.round(nextDelayMs / 1000)}s`,
          `dedupe key: ${dedupeKey}`,
          `last error: ${retryFailureMessage}`,
        ],
      );
      return;
    }

    // Fixed schedule exhausted. Check if any provider has a known cooldown
    // expiry we can wait for (cooldown-aware final retry).
    const errorMessage =
      reason.lastError?.trim() ||
      event.failureMessage?.trim() ||
      "deferred retry failed for unknown reason";
    const isCooldownError =
      errorMessage.includes("cooldown") ||
      errorMessage.includes("rate_limit") ||
      errorMessage.includes("rate limit") ||
      errorMessage.includes("all profiles unavailable");

    if (isCooldownError) {
      const soonestExpiry = getSoonestCooldownExpiryAcrossAllProviders(
        followupRun.run.config,
        followupRun.run.agentDir,
      );
      if (soonestExpiry != null) {
        const cooldownDelayMs = Math.max(0, soonestExpiry - Date.now()) + COOLDOWN_RETRY_BUFFER_MS;
        const cooldownAttempt = nextAttempt;
        const dedupeKey = buildAttemptDedupeKey(baseDedupeKey, cooldownAttempt);
        await queue.enqueue({
          dedupeKey,
          baseDedupeKey,
          attemptIndex: cooldownAttempt,
          firstEnqueuedAt,
          scheduledDelayMs: cooldownDelayMs,
          nextAttemptAt: Date.now() + cooldownDelayMs,
          failureMessage: errorMessage,
          followupRun,
        });
        const retryInMin = Math.round(cooldownDelayMs / 60_000);
        await sendProgrammaticRetryUpdate(
          followupRun,
          `⏳ Fixed retry schedule exhausted but provider cooldown detected. Scheduling cooldown-aware retry in ~${retryInMin}m (2 min after soonest provider recovery).`,
        );
        await sendRetryLogPost(
          followupRun,
          `🧾 Cooldown-aware retry queued (after fixed schedule exhausted)`,
          [
            `soonest provider recovery: ${new Date(soonestExpiry).toISOString()}`,
            `retry scheduled in: ~${retryInMin}m`,
            `dedupe key: ${dedupeKey}`,
            `last error: ${errorMessage}`,
          ],
        );
        return;
      }
    }

    const message = errorMessage;
    const schedule = formatRetrySchedule();
    await sendProgrammaticRetryUpdate(
      followupRun,
      `⚠️ Deferred retry exhausted after ${schedule}. Last error: ${message}`,
    );
    await sendRetryLogPost(followupRun, "🧾 Deferred retry exhausted", [
      `schedule: ${schedule}`,
      `last error: ${message}`,
      `base dedupe key: ${baseDedupeKey}`,
    ]);
    await sendRetryFailureAlert(followupRun, message);
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
      replyKind: "final",
    });
    if (result.ok) {
      return;
    }
    defaultRuntime.error?.(`retry update route failed: ${result.error ?? "unknown"}`);
    return;
  }
  defaultRuntime.error?.(`retry update dropped (unroutable): ${text}`);
}

async function sendRetryLogPost(followupRun: FollowupRun, summary: string, details: string[]) {
  const payload: ReplyPayload = {
    text: `${summary}\n\nRead more:\n${details.map((line) => `- ${line}`).join("\n")}`,
    isError: true,
  };
  const result = await routeReply({
    payload,
    channel: "discord",
    to: RETRY_LOG_CHANNEL,
    sessionKey: followupRun.run.sessionKey,
    cfg: followupRun.run.config,
    mirror: false,
    replyKind: "final",
  });
  if (!result.ok) {
    defaultRuntime.error?.(`retry log route failed: ${result.error ?? "unknown"}`);
  }
}

async function sendRetryFailureAlert(
  followupRun: FollowupRun,
  errorMessage: string,
): Promise<void> {
  const schedule = formatRetrySchedule();
  const alertPayload: ReplyPayload = {
    text: `⚠️ Deferred retry still failing after ${schedule} for session ${followupRun.run.sessionKey ?? followupRun.run.sessionId}. Last error: ${errorMessage}`,
    isError: true,
  };
  const result = await routeReply({
    payload: alertPayload,
    channel: "discord",
    to: RETRY_FAILURE_ALERT_CHANNEL,
    sessionKey: followupRun.run.sessionKey,
    cfg: followupRun.run.config,
    mirror: false,
    replyKind: "final",
  });
  if (!result.ok) {
    defaultRuntime.error?.(`retry failure alert route failed: ${result.error ?? "unknown"}`);
  }
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
  if (scheduledDelayMs == null) {
    throw new Error("deferred retry schedule is empty");
  }
  const dedupeKey = buildAttemptDedupeKey(baseDedupeKey, attemptIndex);
  const enqueueResult = await queue.enqueue({
    dedupeKey,
    baseDedupeKey,
    attemptIndex,
    firstEnqueuedAt,
    scheduledDelayMs,
    nextAttemptAt: firstEnqueuedAt + scheduledDelayMs,
    failureMessage,
    followupRun,
  });
  if (enqueueResult.enqueued) {
    await sendRetryLogPost(
      followupRun,
      `🧾 Deferred retry queued (attempt 1/${DEFERRED_RETRY_SCHEDULE_MS.length})`,
      [
        `schedule: ${formatRetrySchedule()}`,
        `next retry in: ${Math.round(scheduledDelayMs / 1000)}s`,
        `dedupe key: ${dedupeKey}`,
        `initial error: ${failureMessage?.trim() || "unknown"}`,
      ],
    );
  }
  return enqueueResult;
}

export async function __stopDeferredRetryWorkerForTest(): Promise<void> {
  await queue.stop();
  started = false;
  startPromise = null;
}
