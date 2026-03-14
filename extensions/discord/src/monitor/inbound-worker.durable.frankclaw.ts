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

import { danger } from "../../../../src/globals.js";
import { formatDurationSeconds } from "../../../../src/infra/format-time/format-duration.ts";
import {
  createDiscordInboundDurableQueue,
  type DeadLetterReason,
  type DurableDiscordInboundEvent,
} from "./inbound-durable-queue.js";
import type { DiscordInboundJob, DiscordInboundJobPayload } from "./inbound-job.js";
import { materializeDiscordInboundJob } from "./inbound-job.js";
import type { RuntimeEnv } from "./message-handler.preflight.types.js";
import { processDiscordMessage } from "./message-handler.process.js";
import type { DiscordMonitorStatusSink } from "./status.js";
import { normalizeDiscordInboundWorkerTimeoutMs, runDiscordTaskWithTimeout } from "./timeouts.js";

/**
 * Default lease duration for Discord durable queue jobs.
 * Must be longer than the typical LLM run to prevent premature re-queuing.
 * 10 minutes gives generous headroom over the default 30-minute worker timeout
 * (the worker timeout fires first and aborts the run; the lease is a safety net
 * for hard crashes where the timeout can't fire).
 */
const DISCORD_DURABLE_LEASE_MS = 10 * 60_000;

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
};

export type DurableDiscordInboundWorker = {
  enqueue: (job: DiscordInboundJob) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

function formatContextSuffix(event: DurableDiscordInboundEvent): string {
  const channelId = event.channelId?.trim();
  const messageId = event.messageId?.trim();
  const details = [
    channelId ? `channelId=${channelId}` : null,
    messageId ? `messageId=${messageId}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return details.length > 0 ? ` (${details.join(", ")})` : "";
}

export function createDurableDiscordInboundWorker(
  params: DurableDiscordInboundWorkerParams,
): DurableDiscordInboundWorker {
  const leaseMs = params.leaseMs ?? DISCORD_DURABLE_LEASE_MS;
  const maxAttempts = params.maxAttempts ?? DISCORD_DURABLE_MAX_ATTEMPTS;
  const timeoutMs = normalizeDiscordInboundWorkerTimeoutMs(params.runTimeoutMs);

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
      const didTimeout = await runDiscordTaskWithTimeout({
        run: async (abortSignal) => {
          await processDiscordMessage({ ...ctx, abortSignal });
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
      await durableQueue.start({
        process: processEvent,
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
