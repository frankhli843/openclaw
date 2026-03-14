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

import { createRunStateMachine } from "../../../../src/channels/run-state-machine.js";
import type { DiscordInboundJob, DiscordInboundJobRuntime } from "./inbound-job.js";
import {
  createDurableDiscordInboundWorker,
  type DurableDiscordInboundWorkerParams,
} from "./inbound-worker.durable.frankclaw.js";
import type { DiscordInboundWorker } from "./inbound-worker.js";
import type { RuntimeEnv } from "./message-handler.preflight.types.js";
import type { DiscordMonitorStatusSink } from "./status.js";

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
