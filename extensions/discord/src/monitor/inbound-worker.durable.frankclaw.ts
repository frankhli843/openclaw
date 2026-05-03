/**
 * frankclaw overlay: Durable Discord inbound worker.
 *
 * Replaces the in-memory KeyedAsyncQueue worker with the file-based
 * DurableDiscordInboundQueue so that Discord messages survive gateway
 * restarts, timeouts, and crashes — SQS-style visibility timeout.
 *
 * Messages are persisted to disk on enqueue.  On claim they get a lease
 * (visibilityTimeout).  Only after the LLM run completes successfully is
 * the job file deleted.  If the process dies mid-run the lease expires and
 * the message is automatically re-queued on the next startup or drain cycle.
 */

import fs from "node:fs";
import { danger } from "../../../../src/globals.js";
import { formatDurationSeconds } from "../../../../src/infra/format-time/format-duration.ts";
import {
  createDiscordInboundDurableQueue,
  type DeadLetterReason,
  type DurableDiscordInboundEvent,
} from "./inbound-durable-queue.js";
import type { DiscordInboundJob, DiscordInboundJobPayload } from "./inbound-job.js";
import { materializeDiscordInboundJob } from "./inbound-job.js";
import {
  createDiscordInboundLifecycleTracker,
  isDiscordInboundLifecycleTerminal,
  recoverStaleDiscordInboundLifecycleStates,
  type DiscordInboundLifecycleProgress,
} from "./inbound-lifecycle.frankclaw.js";
import type { RuntimeEnv } from "./message-handler.preflight.types.js";
import { processDiscordMessage } from "./message-handler.process.js";
import type { DiscordMonitorStatusSink } from "./status.js";
import { normalizeDiscordInboundWorkerTimeoutMs, runDiscordTaskWithTimeout } from "./timeouts.js";

/**
 * Buffer added on top of the worker timeout to derive the lease duration.
 * The lease must be longer than the worker timeout so the timeout fires first
 * and cleanly aborts the run before the lease expires. Keep this short for
 * channel responsiveness: long work belongs in background workers, not in the
 * inbound Discord delivery queue.
 */
const LEASE_BUFFER_MS = 30_000;

/**
 * Conservative fallback lease when the worker timeout is disabled (unlimited).
 * 60 minutes prevents infinite invisibility while still allowing long runs.
 */
const LEASE_FALLBACK_UNLIMITED_MS = 60 * 60_000;

/**
 * Resolve the effective lease duration for durable queue jobs.
 *
 * The lease (visibility timeout) must always exceed the worker run timeout so
 * the timeout fires first and aborts the run cleanly.  If the lease expires
 * before the timeout, the queue reclaims the job while it's still running,
 * causing duplicate executions.
 */
function resolveDiscordDurableLeaseMs(params: {
  requestedLeaseMs: number | undefined;
  timeoutMs: number | undefined;
}): number {
  // When the worker timeout is disabled, use a conservative fallback — we
  // can't derive from the timeout so pick something generous.
  if (params.timeoutMs == null) {
    return LEASE_FALLBACK_UNLIMITED_MS;
  }

  const minLease = params.timeoutMs + LEASE_BUFFER_MS;

  // If an explicit lease was provided and it's already large enough, keep it.
  if (params.requestedLeaseMs != null && params.requestedLeaseMs >= minLease) {
    return params.requestedLeaseMs;
  }

  return minLease;
}

/**
 * Maximum retry attempts before dead-lettering a message.
 */
const DISCORD_DURABLE_MAX_ATTEMPTS = 3;

export type DurableDiscordInboundWorkerParams = {
  accountId: string;
  runtime: RuntimeEnv;
  setStatus?: DiscordMonitorStatusSink;
  abortSignal?: AbortSignal;
  runTimeoutMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
  stateDir?: string;
  /**
   * Resolve runtime dependencies (client, threadBindings, etc.) at processing
   * time rather than at enqueue time.  The durable queue persists only the
   * serialisable payload; runtime refs must be provided fresh on each drain.
   */
  resolveRuntime: () => import("./inbound-job.js").DiscordInboundJobRuntime;
  onDeadLetter?: (event: DurableDiscordInboundEvent, reason: DeadLetterReason) => void;
  /** Called before each job starts processing (e.g. for RunStateMachine.onRunStart). */
  onProcessStart?: () => void;
  /** Called after each job finishes processing (success or failure, e.g. for RunStateMachine.onRunEnd). */
  onProcessEnd?: () => void;
  __testing?: {
    captureSessionProgress?: (sessionKey: string) => Promise<DurableDiscordSessionProgressSnapshot>;
    processDiscordMessage?: typeof processDiscordMessage;
  };
};

export type DurableDiscordInboundWorker = {
  enqueue: (job: DiscordInboundJob) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type DurableDiscordSessionProgressSnapshot = DiscordInboundLifecycleProgress;

async function captureDurableSessionProgressSnapshot(
  sessionKey: string,
): Promise<DurableDiscordSessionProgressSnapshot> {
  try {
    const { loadSessionEntry } = await import("../../../../src/gateway/session-utils.js");
    const loaded = loadSessionEntry(sessionKey);
    const entry = loaded.entry;
    const sessionFile =
      typeof entry?.sessionFile === "string" && entry.sessionFile.trim().length > 0
        ? entry.sessionFile.trim()
        : undefined;

    let transcriptExists = false;
    let transcriptSize = 0;
    let transcriptMtimeMs = 0;

    if (sessionFile) {
      try {
        const stat = await fs.promises.stat(sessionFile);
        if (stat.isFile()) {
          transcriptExists = true;
          transcriptSize = stat.size;
          transcriptMtimeMs = stat.mtimeMs;
        }
      } catch {
        // Missing transcript evidence is exactly what we want to detect.
      }
    }

    return {
      sessionId: typeof entry?.sessionId === "string" ? entry.sessionId : undefined,
      sessionFile,
      updatedAt: typeof entry?.updatedAt === "number" ? entry.updatedAt : undefined,
      status: typeof entry?.status === "string" ? entry.status : undefined,
      transcriptExists,
      transcriptSize,
      transcriptMtimeMs,
    };
  } catch {
    return {
      transcriptExists: false,
      transcriptSize: 0,
      transcriptMtimeMs: 0,
    };
  }
}

function didDurableSessionProgressAdvance(
  before: DurableDiscordSessionProgressSnapshot,
  after: DurableDiscordSessionProgressSnapshot,
): boolean {
  if (!before.sessionFile && after.sessionFile && after.transcriptExists) {
    return true;
  }
  if (!before.transcriptExists && after.transcriptExists) {
    return true;
  }
  if (after.transcriptSize > before.transcriptSize) {
    return true;
  }
  if (after.transcriptExists && after.transcriptMtimeMs > before.transcriptMtimeMs) {
    return true;
  }
  return false;
}

function didDurableSessionMetadataMaterialize(
  before: DurableDiscordSessionProgressSnapshot,
  after: DurableDiscordSessionProgressSnapshot,
): boolean {
  if (!before.sessionId && Boolean(after.sessionId)) {
    return true;
  }
  if (!before.sessionFile && Boolean(after.sessionFile)) {
    return true;
  }
  return false;
}

function formatDurableSessionProgressSnapshot(
  snapshot: DurableDiscordSessionProgressSnapshot,
): string {
  return [
    `sessionId=${snapshot.sessionId ?? "-"}`,
    `sessionFile=${snapshot.sessionFile ?? "-"}`,
    `updatedAt=${snapshot.updatedAt ?? "-"}`,
    `status=${snapshot.status ?? "-"}`,
    `transcriptExists=${snapshot.transcriptExists ? "true" : "false"}`,
    `transcriptSize=${snapshot.transcriptSize}`,
    `transcriptMtimeMs=${snapshot.transcriptMtimeMs}`,
  ].join(" ");
}

function formatContextSuffix(event: DurableDiscordInboundEvent): string {
  const channelId = event.channelId?.trim();
  const messageId = event.messageId?.trim();
  const details = [
    channelId ? `channelId=${channelId}` : null,
    messageId ? `messageId=${messageId}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return details.length > 0 ? ` (${details.join(", ")})` : "";
}

function createCoalescedDiscordMessageHandler(
  processEvent: (event: DurableDiscordInboundEvent) => Promise<void>,
): (events: DurableDiscordInboundEvent[]) => Promise<void> {
  return async (events) => {
    for (const event of events) {
      await processEvent(event);
    }
  };
}

export function createDurableDiscordInboundWorker(
  params: DurableDiscordInboundWorkerParams,
): DurableDiscordInboundWorker {
  const maxAttempts = params.maxAttempts ?? DISCORD_DURABLE_MAX_ATTEMPTS;
  const timeoutMs = normalizeDiscordInboundWorkerTimeoutMs(params.runTimeoutMs);
  const leaseMs = resolveDiscordDurableLeaseMs({
    requestedLeaseMs: params.leaseMs,
    timeoutMs,
  });

  const durableQueue = createDiscordInboundDurableQueue({
    accountId: params.accountId,
    stateDir: params.stateDir,
    leaseMs,
    maxAttempts,
    coalesce: true,
    onDeadLetter: (event, reason) => {
      const suffix = formatContextSuffix(event);
      params.runtime.error?.(
        danger(
          `discord durable worker: dead-lettered after ${reason.attempts} attempts${suffix}` +
            (reason.lastError ? `: ${reason.lastError}` : ""),
        ),
      );
      params.onDeadLetter?.(event, reason);
    },
  });

  async function processEvent(event: DurableDiscordInboundEvent): Promise<void> {
    params.onProcessStart?.();
    const lifecycle = createDiscordInboundLifecycleTracker({
      accountId: params.accountId,
      stateDir: params.stateDir,
      event: {
        accountId: params.accountId,
        orderingKey: event.orderingKey,
        channelId: event.channelId,
        messageId: event.messageId,
      },
    });
    try {
      const runtime = params.resolveRuntime();
      const payload = event.payload as DiscordInboundJobPayload;
      const ctx = materializeDiscordInboundJob(
        {
          queueKey: event.orderingKey,
          payload,
          runtime,
        },
        params.abortSignal,
      );

      const suffix = formatContextSuffix(event);
      // [frankclaw] Diagnostic: log session status before processing to help trace
      // cases where messages are silently consumed without starting an LLM run.
      try {
        const { loadSessionEntry } = await import("../../../../src/gateway/session-utils.js");
        const sessionEntry = loadSessionEntry(event.orderingKey);
        if (sessionEntry.entry) {
          console.info(
            `[frankclaw-durable-worker] pre-process: orderingKey=${event.orderingKey} sessionStatus=${sessionEntry.entry.status ?? "unknown"} updatedAt=${sessionEntry.entry.updatedAt ?? "?"}${suffix}`,
          );
        }
      } catch {
        // Best-effort diagnostic; do not block processing.
      }
      const captureSessionProgress =
        params.__testing?.captureSessionProgress ?? captureDurableSessionProgressSnapshot;
      const beforeProgress = await captureSessionProgress(event.orderingKey);
      await lifecycle.mark({
        stage: "claimed",
        note: "durable queue claimed inbound job",
        progress: beforeProgress,
      });
      await lifecycle.mark({
        stage: "session_init",
        note: "discord inbound job materialized for processing",
        progress: beforeProgress,
      });
      const processDiscordMessageImpl =
        params.__testing?.processDiscordMessage ?? processDiscordMessage;
      let noopReason: string | undefined;
      let finalReplyDelivered = false;
      // When autoThread fires, the reply/session moves to a new channel key.
      // Capture it so we check progress against the actual session key, not
      // the original inbound orderingKey (fixes "missing terminal inbound
      // lifecycle state" dead-letters on thread creation, 2026-04-09).
      let resolvedSessionKey: string | undefined;
      let createdThreadId: string | undefined;
      const didTimeout = await runDiscordTaskWithTimeout({
        run: async (abortSignal) => {
          await processDiscordMessageImpl(
            { ...ctx, abortSignal },
            {
              onNoop: (reason) => {
                noopReason = reason;
              },
              onFinalReplyDelivered: () => {
                finalReplyDelivered = true;
              },
              onReplyPlanResolved: ({ createdThreadId: tid, sessionKey }) => {
                if (typeof sessionKey === "string" && sessionKey.trim()) {
                  resolvedSessionKey = sessionKey.trim();
                }
                if (typeof tid === "string" && tid.trim()) {
                  createdThreadId = tid.trim();
                }
              },
            },
          );
        },
        timeoutMs,
        // Include the per-job runtime abort signal alongside the lifecycle signal.
        abortSignals: [runtime.abortSignal, params.abortSignal],
        onTimeout: (resolvedTimeoutMs) => {
          params.runtime.error?.(
            danger(
              `discord durable worker timed out after ${formatDurationSeconds(resolvedTimeoutMs, {
                decimals: 1,
                unit: "seconds",
              })}${suffix}`,
            ),
          );
        },
        onErrorAfterTimeout: (error) => {
          params.runtime.error?.(
            danger(`discord durable worker failed after timeout: ${String(error)}${suffix}`),
          );
        },
      });

      if (didTimeout) {
        // Throw so the durable queue marks the attempt as failed and applies
        // backoff / dead-letter logic instead of deleting the job.
        throw new Error(
          `discord durable worker timed out after ${formatDurationSeconds(timeoutMs ?? 0, {
            decimals: 1,
            unit: "seconds",
          })}${suffix}`,
        );
      }

      // Check progress against the resolved session key (auto-thread may have
      // moved the session to a new channel key) falling back to orderingKey.
      const progressKey = resolvedSessionKey ?? event.orderingKey;
      const afterProgress = await captureSessionProgress(progressKey);
      let terminalStage: "run_started" | "reply_delivered" | "dropped_intentionally" | undefined;

      if (noopReason) {
        terminalStage = "dropped_intentionally";
        await lifecycle.mark({
          stage: terminalStage,
          note: `intentional noop: ${noopReason}`,
          progress: afterProgress,
        });
      } else if (finalReplyDelivered) {
        terminalStage = "reply_delivered";
        await lifecycle.mark({
          stage: terminalStage,
          note: "final reply delivered to Discord",
          progress: afterProgress,
        });
      } else if (didDurableSessionProgressAdvance(beforeProgress, afterProgress)) {
        terminalStage = "run_started";
        await lifecycle.mark({
          stage: terminalStage,
          note: "session transcript advanced",
          progress: afterProgress,
        });
      } else if (didDurableSessionMetadataMaterialize(beforeProgress, afterProgress)) {
        await lifecycle.mark({
          stage: "session_metadata_persisted",
          note: "session metadata materialized without transcript progress",
          progress: afterProgress,
        });
        params.runtime.error?.(
          danger(
            `discord durable worker session metadata exists but transcript missing${suffix}: ` +
              `before=[${formatDurableSessionProgressSnapshot(beforeProgress)}] ` +
              `after=[${formatDurableSessionProgressSnapshot(afterProgress)}]`,
          ),
        );
      } else {
        await lifecycle.mark({
          stage: "handler_returned",
          note: "handler returned before a real terminal lifecycle state",
          progress: afterProgress,
        });
      }

      if (!terminalStage) {
        // frankclaw: if the session is actively running with a transcript,
        // the message was injected into session context and will be processed
        // when the current LLM turn finishes. Treat this as success rather
        // than throwing (which leads to dead-lettering after 3 retries).
        const sessionIsActivelyRunning =
          afterProgress.status === "running" &&
          afterProgress.transcriptExists &&
          afterProgress.transcriptSize > 0;
        if (sessionIsActivelyRunning) {
          terminalStage = "run_started";
          await lifecycle.mark({
            stage: terminalStage,
            note: `session actively running (transcriptSize=${afterProgress.transcriptSize}), message injected into context`,
            progress: afterProgress,
          });
          params.runtime.log?.(
            `discord durable worker: session actively running, message queued in context${suffix}`,
          );
        } else {
          params.runtime.error?.(
            danger(
              `discord durable worker missing terminal inbound lifecycle state${suffix}: ` +
                `before=[${formatDurableSessionProgressSnapshot(beforeProgress)}] ` +
                `after=[${formatDurableSessionProgressSnapshot(afterProgress)}] ` +
                `noopReason=${noopReason ?? "-"} finalReplyDelivered=${finalReplyDelivered ? "true" : "false"} ` +
                `resolvedSessionKey=${resolvedSessionKey ?? "-"} createdThreadId=${createdThreadId ?? "-"}`,
            ),
          );
          throw new Error(
            `discord durable worker missing terminal inbound lifecycle state${suffix}`,
          );
        }
      }

      const persistedLifecycle = await lifecycle.load();
      if (persistedLifecycle && !isDiscordInboundLifecycleTerminal(persistedLifecycle.stage)) {
        throw new Error(
          `discord durable worker retained non-terminal lifecycle state${suffix}: ${persistedLifecycle.stage}`,
        );
      }
      await lifecycle.clear();
    } catch (error) {
      await lifecycle.annotateError(String(error));
      throw error;
    } finally {
      params.onProcessEnd?.();
    }
  }

  return {
    enqueue(job: DiscordInboundJob) {
      const messageId = job.payload.data?.message?.id ?? job.payload.messageChannelId ?? "unknown";
      const channelId = job.payload.messageChannelId ?? "unknown";

      void durableQueue
        .enqueue({
          channelId,
          messageId,
          orderingKey: job.queueKey,
          payload: job.payload,
        })
        .then(({ enqueued, dedupeKey }) => {
          if (!enqueued) {
            console.info(
              `[frankclaw-durable-worker] deduplicated: ${dedupeKey} channelId=${channelId} messageId=${messageId}`,
            );
          }
        })
        .catch((error) => {
          params.runtime.error?.(danger(`discord durable worker enqueue failed: ${String(error)}`));
        });
    },

    async start() {
      await recoverStaleDiscordInboundLifecycleStates({
        accountId: params.accountId,
        stateDir: params.stateDir,
        log: (message) => {
          console.warn(message);
        },
      });
      await durableQueue.start({
        process: processEvent,
        processBatch: createCoalescedDiscordMessageHandler(processEvent),
      });
      console.info(
        `[frankclaw-durable-worker] started (leaseMs=${leaseMs}, maxAttempts=${maxAttempts})`,
      );
    },

    async stop() {
      await durableQueue.stop();
      console.info("[frankclaw-durable-worker] stopped");
    },
  };
}

/** @internal Exposed for unit tests only. */
export const __testing = {
  resolveDiscordDurableLeaseMs,
  didDurableSessionProgressAdvance,
  didDurableSessionMetadataMaterialize,
};
