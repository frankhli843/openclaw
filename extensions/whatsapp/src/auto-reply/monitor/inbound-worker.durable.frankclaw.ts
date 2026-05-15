/**
 * frankclaw: Durable WhatsApp inbound worker.
 *
 * Replaces the fire-and-forget {@link runWhatsAppInboundWithTimeout} pattern
 * with an SQS-style durable queue that:
 *   - Persists each inbound message (serializable fields only) to disk before
 *     processing, so an in-flight message survives a gateway crash.
 *   - Claims jobs with a visibility timeout (lease) that always exceeds the
 *     worker timeout, ensuring the timeout fires first and aborts cleanly.
 *   - Retries with exponential backoff on failure or timeout, up to a max
 *     attempts threshold, then dead-letters with a clear diagnostic.
 *
 * Closures on the inbound {@link WebInboundMsg} (`reply`, `sendMedia`,
 * `sendComposing`) are not serializable — they are bound to the live Baileys
 * socket. We keep them in an in-memory map keyed by the durable jobId.
 * If a retry happens after gateway restart, the closures are gone and the
 * job is dead-lettered with reason="missing runtime closures after restart".
 * This is no worse than the current behavior (silent drop on timeout) and
 * provides loud diagnostics so the loss is observable.
 */

import { danger } from "../../../../../src/globals.js";
import {
  createInboundDurableQueue,
  type DeadLetterReason,
  type DurableInboundEvent,
  type InboundDurableQueue,
} from "../../../../../src/inbound/inbound-durable-queue.frankclaw.js";
import type { WebInboundMsg } from "../types.js";

/**
 * Default WhatsApp per-message worker timeout. Increased from the legacy
 * 3 min to 5 min (matches Telegram) because the Codex backend with full
 * context injection regularly exceeds 3 min and gets dead-lettered.
 */
export const WHATSAPP_DURABLE_INBOUND_TIMEOUT_MS = 5 * 60_000;

/** Buffer on top of timeout for the visibility lease. */
const LEASE_BUFFER_MS = 30_000;

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * The persisted shape of a WhatsApp inbound message. Closures (`reply`,
 * `sendMedia`, `sendComposing`) are dropped because they cannot survive
 * a JSON round trip — they live in an in-memory map instead.
 */
export type WhatsAppDurablePayload = Omit<WebInboundMsg, "reply" | "sendMedia" | "sendComposing">;

export type DurableWhatsAppInboundWorkerLog = {
  warn: (line: string) => void;
  info?: (line: string) => void;
  error?: (line: string) => void;
};

function stripClosures(msg: WebInboundMsg): WhatsAppDurablePayload {
  const { reply: _reply, sendMedia: _sendMedia, sendComposing: _sendComposing, ...rest } = msg;
  return rest;
}

function deriveOrderingKey(msg: WebInboundMsg): string {
  return `${msg.accountId}:${msg.conversationId ?? msg.from}`;
}

function deriveExternalId(msg: WebInboundMsg, fallback: () => string): string {
  return msg.id?.trim() || fallback();
}

export type DurableWhatsAppInboundWorkerParams = {
  accountId: string;
  log: DurableWhatsAppInboundWorkerLog;
  /** Fresh runtime processor — invoked per-attempt with the original closures. */
  processOne: (msg: WebInboundMsg) => Promise<void>;
  timeoutMs?: number;
  visibilityTimeoutMs?: number;
  maxAttempts?: number;
  stateDir?: string;
  backoffMs?: (attempt: number) => number;
  onDeadLetter?: (event: DurableInboundEvent, reason: DeadLetterReason) => void;
};

export type DurableWhatsAppInboundWorker = {
  enqueue: (msg: WebInboundMsg) => Promise<{ enqueued: boolean; dedupeKey: string }>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Re-attach in-memory closures for a new socket cycle (used on reconnect). */
  rebindClosures?: (msg: WebInboundMsg) => void;
};

function resolveLeaseMs(timeoutMs: number | undefined): number {
  if (!timeoutMs) {
    return 60 * 60_000;
  }
  return timeoutMs + LEASE_BUFFER_MS;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && String((error as { name?: unknown }).name) === "AbortError";
}

async function runProcessWithTimeout(params: {
  msg: WebInboundMsg;
  processOne: (msg: WebInboundMsg) => Promise<void>;
  timeoutMs?: number;
  log: { warn: (line: string) => void };
}): Promise<{ timedOut: boolean }> {
  if (!params.timeoutMs) {
    await params.processOne(params.msg);
    return { timedOut: false };
  }

  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const runPromise = params.processOne(params.msg).catch((error) => {
    if (timedOut && isAbortError(error)) {
      return;
    }
    if (timedOut) {
      params.log.warn(
        `whatsapp durable worker: message processing failed after timeout: ${String(error)}`,
      );
      return;
    }
    throw error;
  });

  try {
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), params.timeoutMs);
      timeoutHandle.unref?.();
    });
    const result = await Promise.race([
      runPromise.then(() => "completed" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      timedOut = true;
      return { timedOut: true };
    }
    return { timedOut: false };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createDurableWhatsAppInboundWorker(
  params: DurableWhatsAppInboundWorkerParams,
): DurableWhatsAppInboundWorker {
  const timeoutMs = params.timeoutMs ?? WHATSAPP_DURABLE_INBOUND_TIMEOUT_MS;
  const visibilityTimeoutMs = params.visibilityTimeoutMs ?? resolveLeaseMs(timeoutMs);
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // In-memory closure cache. Key = dedupeKey (channel:account:ordering:external).
  // We keep the LIVE msg so its closures stay bound to the current socket.
  const closureCache = new Map<string, WebInboundMsg>();
  let fallbackCounter = 0;

  const queue: InboundDurableQueue = createInboundDurableQueue({
    channel: "whatsapp",
    accountId: params.accountId,
    visibilityTimeoutMs,
    maxAttempts,
    stateDir: params.stateDir,
    ...(params.backoffMs ? { backoffMs: params.backoffMs } : {}),
    onDeadLetter: (event, reason) => {
      params.log.warn(
        danger(
          `whatsapp durable worker: dead-lettered after ${reason.attempts} attempts ` +
            `accountId=${event.accountId} orderingKey=${event.orderingKey} externalId=${event.externalId}` +
            (reason.lastError ? `: ${reason.lastError}` : ""),
        ),
      );
      closureCache.delete(`whatsapp:${event.accountId}:${event.orderingKey}:${event.externalId}`);
      params.onDeadLetter?.(event, reason);
    },
  });

  async function processEvent(event: DurableInboundEvent): Promise<void> {
    const dedupeKey = `whatsapp:${event.accountId}:${event.orderingKey}:${event.externalId}`;
    const liveMsg = closureCache.get(dedupeKey);
    if (!liveMsg) {
      // Closures are gone (gateway restart, reconnect, or stale entry).
      // Throw so the queue dead-letters with a clear reason — this is loud
      // observable failure, replacing the prior silent drop.
      throw new Error(
        `whatsapp durable worker: missing in-memory closures (likely gateway restart since enqueue) ` +
          `accountId=${event.accountId} orderingKey=${event.orderingKey} externalId=${event.externalId}`,
      );
    }

    const chatLabel =
      liveMsg.chatType === "group"
        ? `group:${liveMsg.from}`
        : (liveMsg.from ?? liveMsg.conversationId ?? "unknown");

    const startedAt = Date.now();
    const { timedOut } = await runProcessWithTimeout({
      msg: liveMsg,
      processOne: params.processOne,
      timeoutMs,
      log: params.log,
    });

    if (timedOut) {
      params.log.warn(
        `whatsapp durable worker: message processing timed out after ${Math.round(timeoutMs / 1000)}s` +
          ` chat=${chatLabel} msgId=${liveMsg.id ?? "-"}` +
          ` — durable queue will retry`,
      );
      throw new Error(
        `whatsapp durable worker: timeout after ${Math.round(timeoutMs / 1000)}s chat=${chatLabel}`,
      );
    }

    // Success — drop the closure cache entry to free memory.
    closureCache.delete(dedupeKey);
    params.log.info?.(
      `whatsapp durable worker: message processed ok chat=${chatLabel} msgId=${liveMsg.id ?? "-"} elapsedMs=${Date.now() - startedAt}`,
    );
  }

  return {
    async enqueue(msg) {
      const orderingKey = deriveOrderingKey(msg);
      const externalId = deriveExternalId(msg, () => {
        fallbackCounter += 1;
        return `synthetic-${Date.now()}-${fallbackCounter}`;
      });
      const dedupeKey = `whatsapp:${params.accountId}:${orderingKey}:${externalId}`;

      // Always refresh the in-memory closures to the latest msg instance (which
      // is tied to the current socket).
      closureCache.set(dedupeKey, msg);

      const result = await queue.enqueue({
        orderingKey,
        externalId,
        payload: stripClosures(msg),
      });
      if (!result.enqueued) {
        // Already in flight/dead — keep the closure cache fresh so retries
        // pick up the newest socket binding.
        params.log.info?.(
          `whatsapp durable worker: duplicate inbound msgId=${msg.id ?? "-"} dedupeKey=${result.dedupeKey} — refreshing closure cache`,
        );
      }
      return result;
    },

    async start() {
      await queue.start({
        process: processEvent,
      });
      params.log.info?.(
        `whatsapp durable worker started accountId=${params.accountId} timeoutMs=${timeoutMs} leaseMs=${visibilityTimeoutMs} maxAttempts=${maxAttempts}`,
      );
    },

    async stop() {
      await queue.stop();
      closureCache.clear();
    },

    rebindClosures(msg) {
      const orderingKey = deriveOrderingKey(msg);
      const externalId = msg.id?.trim();
      if (!externalId) {
        return;
      }
      const dedupeKey = `whatsapp:${params.accountId}:${orderingKey}:${externalId}`;
      if (closureCache.has(dedupeKey)) {
        closureCache.set(dedupeKey, msg);
      }
    },
  };
}

/** @internal Exposed for unit tests only. */
export const __testing = {
  resolveLeaseMs,
  stripClosures,
  deriveOrderingKey,
  deriveExternalId,
};
