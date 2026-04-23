// frankclaw addition: last-resort fallback delivery when all announce retries
// are exhausted. Sends the child's frozen result text directly to the original
// delivery channel (Discord, WhatsApp, etc.) so Frank at least sees the output,
// even if the parent session can't process it.
//
// Root cause this solves (2026-04-22 incident):
// Parent cron session (one-shot, delete-after-run) was cleaned up before the
// ACP child worker completed. All 6 announce retries failed immediately
// (session not found), and the child's result was silently lost. The only
// trace was a dead-letter alert in Discord #logs.

import { callGateway } from "../gateway/call.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const log = createSubsystemLogger("agents/subagent-announce-giveup-fallback");

export interface GiveUpFallbackResult {
  recovered: boolean;
  deliveryPath?: string;
  error?: string;
}

/**
 * Attempt last-resort direct delivery of the child's result to the original
 * channel when all announce retries are exhausted. Returns `{ recovered: true }`
 * if the delivery succeeded, in which case the caller should skip the
 * ANNOUNCE_GIVEUP log (since the result was delivered, just not via the parent).
 *
 * Safe to call from any context; failures are caught and returned, never thrown.
 */
export async function attemptGiveUpFallbackDelivery(
  entry: SubagentRunRecord,
): Promise<GiveUpFallbackResult> {
  // Only attempt fallback for completion messages with result text.
  if (!entry.expectsCompletionMessage) {
    return { recovered: false };
  }

  const resultText = entry.frozenResultText || entry.fallbackFrozenResultText;
  if (!resultText?.trim()) {
    log.warn?.(
      `give-up fallback skipped (no frozen result): run=${entry.runId} child=${entry.childSessionKey}`,
    );
    return { recovered: false };
  }

  const origin = entry.requesterOrigin;
  const channel = normalizeOptionalString(origin?.channel);
  const to = normalizeOptionalString(origin?.to);

  if (!channel || !to) {
    log.warn?.(
      `give-up fallback skipped (no delivery target): run=${entry.runId} channel=${channel ?? "none"} to=${to ?? "none"}`,
    );
    return { recovered: false };
  }

  const threadId =
    origin?.threadId != null && String(origin.threadId).trim()
      ? String(origin.threadId).trim()
      : undefined;

  const label = entry.label?.trim() || entry.childSessionKey;
  const message = `[Announce fallback] Sub-agent \`${label}\` completed but parent session was unavailable. Result:\n\n${resultText.trim()}`;

  try {
    await callGateway({
      method: "send",
      params: {
        channel,
        to,
        threadId,
        accountId: origin?.accountId,
        message,
        idempotencyKey: `announce-giveup-fallback:${entry.runId}`,
      },
      timeoutMs: 30_000,
    });
    log.info?.(
      `give-up fallback delivered: run=${entry.runId} child=${entry.childSessionKey} -> ${channel}:${to}`,
    );
    return { recovered: true, deliveryPath: `${channel}:${to}` };
  } catch (err) {
    log.warn?.(`give-up fallback delivery failed: run=${entry.runId} err=${String(err)}`);
    return { recovered: false, error: String(err) };
  }
}
