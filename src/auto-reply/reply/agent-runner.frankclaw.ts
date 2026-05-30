/**
 * Frankclaw extension for agent-runner.ts
 *
 * Handles:
 * - Deferred retry worker initialization
 * - Post-compaction audit tracking
 * - Retry constants
 * - sendProgrammaticRetryUpdate and scheduleDeferredRetry builders
 * - Immediate retry loop and deferred retry scheduling on final failure
 */
import { defaultRuntime } from "../../runtime.js";
import type { ReplyPayload } from "../types.js";
import type { AgentRunLoopResult } from "./agent-runner-execution.js";
import {
  ensureDeferredRetryWorkerStarted,
  enqueueDeferredRetry,
} from "./deferred-retry-runtime.js";
import type { FollowupRun } from "./queue.js";
import { isRoutableChannel, routeReply } from "./route-reply.js";

// ── Module-level initialization ────────────────────────────────────────────

/** Track sessions pending post-compaction read audit (Layer 3). */
export const pendingPostCompactionAudits = new Map<string, boolean>();

/** Number of immediate retry attempts for retryable failures (1 = no retry). */
export const RETRYABLE_IMMEDIATE_ATTEMPTS = 1;
/** Backoff delays (ms) for immediate retries (empty = no delays). */
export const RETRYABLE_IMMEDIATE_BACKOFF_MS: readonly number[] = [];

/**
 * Ensure the deferred retry worker is initialized.
 * Called at module load and at the start of each runReplyAgent call.
 */
export async function initDeferredRetryWorker(): Promise<void> {
  try {
    await ensureDeferredRetryWorkerStarted();
  } catch (err) {
    defaultRuntime.error?.(`failed to start deferred retry worker: ${String(err)}`);
  }
}

// Fire-and-forget at module load
void initDeferredRetryWorker();

// ── Retry Update + Schedule ────────────────────────────────────────────────

/**
 * Build a function that sends programmatic retry status updates back to the
 * originating channel.
 */
export function buildSendProgrammaticRetryUpdate(params: {
  followupRun: FollowupRun;
  onBlockReply?: (payload: ReplyPayload) => void | Promise<void>;
}): (text: string) => Promise<void> {
  return async (text: string) => {
    const payload: ReplyPayload = { text, isError: true };
    const channel = params.followupRun.originatingChannel;
    const to = params.followupRun.originatingTo;
    if (isRoutableChannel(channel) && to) {
      const result = await routeReply({
        payload,
        channel,
        to,
        sessionKey: params.followupRun.run.sessionKey,
        accountId: params.followupRun.originatingAccountId,
        threadId: params.followupRun.originatingThreadId,
        cfg: params.followupRun.run.config,
        replyKind: "final",
      });
      if (result.ok) {
        return;
      }
      defaultRuntime.error?.(`retry update route failed: ${result.error ?? "unknown"}`);
    }
    if (params.onBlockReply) {
      await params.onBlockReply(payload);
    }
  };
}

/**
 * Build a function that schedules a deferred retry for a failed run.
 */
export function buildScheduleDeferredRetry(params: {
  followupRun: FollowupRun;
  sendRetryUpdate: (text: string) => Promise<void>;
}): (message: string) => Promise<void> {
  return async (message: string) => {
    try {
      await enqueueDeferredRetry(params.followupRun, message);
    } catch (err) {
      defaultRuntime.error?.(`failed to enqueue deferred retry: ${String(err)}`);
      await params.sendRetryUpdate(
        `⚠️ Deferred retry enqueue failed. Last error: ${message}. Please retry manually.`,
      );
    }
  };
}

// ── Post-run Retry Handling ────────────────────────────────────────────────

/**
 * Handle retryable failure after agent run. Performs immediate retries and
 * schedules deferred retries if all immediate attempts fail.
 *
 * Returns the final payload to send if the failure was handled (deferred retry
 * scheduled), or null if the outcome was resolved (no longer a failure).
 */
export async function handleRetryableRunOutcome(params: {
  runOutcome: AgentRunLoopResult;
  isHeartbeat: boolean;
  scheduleDeferredRetry: (message: string) => Promise<void>;
  rerunAgent: () => Promise<AgentRunLoopResult>;
}): Promise<{
  outcome: AgentRunLoopResult;
  deferredPayload?: ReplyPayload;
} | null> {
  let { runOutcome } = params;

  if (runOutcome.kind !== "final" || !runOutcome.retryableFailure) {
    return null; // Not retryable — caller handles normally.
  }

  // Immediate retry loop
  for (let attempt = 2; attempt <= RETRYABLE_IMMEDIATE_ATTEMPTS; attempt += 1) {
    const backoffMs = RETRYABLE_IMMEDIATE_BACKOFF_MS[attempt - 2] ?? 0;
    if (backoffMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
    }
    runOutcome = await params.rerunAgent();
    if (runOutcome.kind !== "final" || !runOutcome.retryableFailure) {
      return { outcome: runOutcome };
    }
  }

  // All immediate retries exhausted — schedule deferred retry
  if (runOutcome.kind === "final" && runOutcome.retryableFailure && !params.isHeartbeat) {
    await params.scheduleDeferredRetry(
      runOutcome.failureMessage ?? runOutcome.payload.text ?? "unknown error",
    );
    return {
      outcome: runOutcome,
      deferredPayload: {
        text: "⚠️ Provider temporarily unavailable. I queued deferred retries at 5s, 10s, 30s, 1m, 5m, and 10m. I will post the outcome here.",
        isError: true,
      },
    };
  }

  return { outcome: runOutcome };
}
