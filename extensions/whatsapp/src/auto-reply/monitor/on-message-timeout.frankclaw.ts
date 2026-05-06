/**
 * frankclaw: Per-message inbound worker timeout for WhatsApp.
 *
 * Mirrors Discord's 3-minute durable-worker timeout (inbound-worker.durable.frankclaw.ts).
 * Without this, a single WhatsApp turn that makes a slow or hung tool call (e.g. web_fetch
 * that never resolves) blocks the entire group chat session indefinitely. The diagnostic
 * heartbeat eventually detects it as blocked_tool_call, but only after many minutes and
 * only fires recovery starting at BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS (10 min).
 *
 * This timeout fires sooner (3 min default) and at the inbound layer, giving the session
 * a chance to abort cleanly and the next queued message a chance to proceed.
 */

import type { pino } from "openclaw/plugin-sdk/runtime-env";
import type { WebInboundMsg } from "../types.js";

/** Default per-message timeout: 3 minutes, matching Discord's inbound durable worker. */
export const WHATSAPP_INBOUND_WORKER_TIMEOUT_MS = 3 * 60_000;

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && String((error as { name?: unknown }).name) === "AbortError";
}

export async function runWhatsAppInboundWithTimeout(params: {
  msg: WebInboundMsg;
  run: () => Promise<void>;
  timeoutMs?: number;
  log: { warn: pino.LogFn };
}): Promise<void> {
  const { timeoutMs } = params;
  if (!timeoutMs) {
    await params.run();
    return;
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const runPromise = params.run().catch((error) => {
    if (timedOut && isAbortError(error)) {
      return; // expected: run was aborted after timeout
    }
    if (timedOut) {
      // Run threw after timeout — log but don't propagate (the timeout already returned).
      params.log.warn(
        `whatsapp inbound: message processing failed after timeout: ${String(error)}`,
      );
      return;
    }
    throw error;
  });

  try {
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), timeoutMs);
      timeoutHandle.unref?.();
    });
    const result = await Promise.race([
      runPromise.then(() => "completed" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      timedOut = true;
      controller.abort();
      const chatId = params.msg.from ?? params.msg.conversationId ?? "unknown";
      const senderLabel = params.msg.chatType === "group" ? `group:${chatId}` : chatId;
      params.log.warn(
        `whatsapp inbound: message processing timed out after ${Math.round(timeoutMs / 1000)}s` +
          ` chat=${senderLabel} msgId=${params.msg.id ?? "-"}` +
          ` — aborting turn to unblock queue`,
      );
      // Do not throw: the next message in the coalesce queue should proceed normally.
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
