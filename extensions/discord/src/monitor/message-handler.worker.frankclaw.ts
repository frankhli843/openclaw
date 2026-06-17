/**
 * frankclaw overlay: Durable Discord inbound worker factory.
 *
 * Creates a durable (disk-persisted) inbound worker that survives gateway
 * restarts and provider reconnects. Wraps the DurableDiscordInboundWorker
 * with the standard DiscordInboundWorker interface (enqueue + deactivate)
 * so the message handler can swap it in with minimal changes.
 *
 * Includes RunStateMachine integration for status tracking and graceful
 * deactivation, matching the behavior of the upstream in-memory worker.
 */

import {
  deferDelivery,
  DiscordDnrSuppressedError,
  enforceDiscordDnrWindow,
  enqueueDelivery,
} from "openclaw/plugin-sdk/infra-runtime";
import { captureSubagentCompletionReply } from "../../../../src/agents/subagent-announce-output.js";
import { createRunStateMachine } from "../../../../src/channels/run-state-machine.js";
import type { DiscordInboundJob, DiscordInboundJobRuntime } from "./inbound-job.js";
import {
  createDurableDiscordInboundWorker,
  type DurableDiscordInboundWorkerParams,
  type UndeliveredFinalReplyContext,
} from "./inbound-worker.durable.frankclaw.js";
import type { RuntimeEnv } from "./message-handler.preflight.types.js";
import type { DiscordMonitorStatusSink } from "./status.js";

type DiscordInboundWorker = {
  enqueue: (job: DiscordInboundJob) => void;
  deactivate: () => void;
};

export type FrankclawDurableInboundWorkerParams = {
  accountId: string;
  runtime: RuntimeEnv;
  setStatus?: DiscordMonitorStatusSink;
  abortSignal?: AbortSignal;
  runTimeoutMs?: number;
  leaseMs?: number;
  maxAttempts?: number;
  stateDir?: string;
  /**
   * Resolve fresh runtime dependencies for processing persisted jobs.
   * Called each time a job is drained from the durable queue — both for
   * normal flow and crash-recovery after restart.
   * Must return a valid runtime with a live client reference.
   */
  resolveRuntime: () => DiscordInboundJobRuntime;
  onDeadLetter?: DurableDiscordInboundWorkerParams["onDeadLetter"];
};

/**
 * Last-resort recovery: when a session completes without producing a visible
 * Discord reply (timeout or missing terminal), read the final assistant text
 * from the completed transcript and enqueue it for durable delivery. If the
 * DNR window is active, the delivery is deferred automatically.
 *
 * Returns true only when an outbound delivery record was successfully created
 * so the caller can mark the inbound job as terminal instead of dead-lettering.
 */
async function recoverUndeliveredFinalReply(
  accountId: string,
  ctx: UndeliveredFinalReplyContext,
): Promise<boolean> {
  const channelId = ctx.event.channelId;
  if (!channelId) return false;

  let replyText: string | undefined;
  try {
    replyText = await captureSubagentCompletionReply(ctx.sessionKey, {
      sessionFile: ctx.sessionFile,
    });
  } catch {
    return false;
  }
  if (!replyText?.trim()) return false;

  const target = `channel:${channelId}`;
  let queueId: string | undefined;
  try {
    queueId = await enqueueDelivery({
      channel: "discord",
      to: target,
      payloads: [{ text: replyText }],
      accountId,
    });
  } catch {
    return false;
  }
  if (!queueId) return false;

  // If DNR is active now, defer the freshly-created queue entry.
  try {
    enforceDiscordDnrWindow({ channel: "discord", to: target });
  } catch (dnrErr) {
    if (dnrErr instanceof DiscordDnrSuppressedError) {
      await deferDelivery(queueId, dnrErr.nextEligibleAtMs, "discord-dnr-window").catch(() => {});
    }
  }

  return true;
}

/**
 * Create a durable Discord inbound worker wrapped in the standard
 * DiscordInboundWorker interface. The returned worker:
 *
 * - Persists messages to disk before processing (crash-safe)
 * - Integrates with RunStateMachine for status tracking
 * - Supports graceful deactivation via `.deactivate()`
 * - Auto-starts the durable queue on creation
 *
 * Drop-in replacement for `createDiscordInboundWorker()` in the message
 * handler — same enqueue/deactivate interface, but disk-backed.
 */
export function createFrankclawDurableInboundWorker(
  params: FrankclawDurableInboundWorkerParams,
): DiscordInboundWorker {
  const runState = createRunStateMachine({
    setStatus: params.setStatus,
    abortSignal: params.abortSignal,
  });

  const durableWorker = createDurableDiscordInboundWorker({
    accountId: params.accountId,
    runtime: params.runtime,
    setStatus: params.setStatus,
    abortSignal: params.abortSignal,
    runTimeoutMs: params.runTimeoutMs,
    leaseMs: params.leaseMs,
    maxAttempts: params.maxAttempts,
    stateDir: params.stateDir,
    resolveRuntime: params.resolveRuntime,
    onDeadLetter: params.onDeadLetter,
    onUndeliveredFinalReply: (ctx) => recoverUndeliveredFinalReply(params.accountId, ctx),
    onProcessStart: () => {
      runState.onRunStart();
    },
    onProcessEnd: () => {
      runState.onRunEnd();
    },
  });

  // Fire-and-forget start — errors are logged by the durable queue.
  void durableWorker.start().catch((err) => {
    params.runtime.error?.(`frankclaw durable worker start failed: ${String(err)}`);
  });

  return {
    enqueue(job: DiscordInboundJob) {
      if (!runState.isActive()) {
        return;
      }
      durableWorker.enqueue(job);
    },

    deactivate() {
      runState.deactivate();
      void durableWorker.stop();
    },
  };
}
