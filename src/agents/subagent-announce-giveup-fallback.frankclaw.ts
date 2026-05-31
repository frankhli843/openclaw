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
//
// Extended (2026-04-25): when completion.resultText is empty (common for ACP
// sessions whose chat.history is unavailable at freeze time), attempt a
// last-resort capture from the child session before giving up. Also used by
// the model-failure direct-delivery bypass when announce retries all fail
// due to FallbackSummaryError (all LLM providers down).

import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { callGateway } from "../gateway/call.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const log = createSubsystemLogger("agents/subagent-announce-giveup-fallback");

export interface GiveUpFallbackResult {
  recovered: boolean;
  deliveryPath?: string;
  error?: string;
}

/**
 * Attempt to capture the child's result text one last time when the
 * frozenResultText is empty. For ACP sessions, the chat.history gateway
 * method may not have been available when freezeRunResultAtCompletion ran
 * (the ACP process was still shutting down or the session file hadn't been
 * flushed). By the time we reach give-up (several minutes later), the data
 * is more likely to be available.
 */
async function attemptLastResortResultCapture(
  entry: SubagentRunRecord,
): Promise<string | undefined> {
  const childSessionKey = entry.childSessionKey?.trim();
  if (!childSessionKey) {
    return undefined;
  }

  try {
    const history = await callGateway({
      method: "chat.history",
      params: { sessionKey: childSessionKey, limit: 100 },
      timeoutMs: 15_000,
    });
    const messages = Array.isArray((history as { messages?: unknown })?.messages)
      ? ((history as { messages: unknown[] }).messages as Array<{
          role?: string;
          content?: unknown;
        }>)
      : [];
    // Walk messages in reverse to find the last assistant reply with content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") {
        continue;
      }
      if (msg.role !== "assistant") {
        continue;
      }
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        log.info?.(
          `last-resort capture succeeded via chat.history: run=${entry.runId} child=${childSessionKey} len=${content.trim().length}`,
        );
        return content.trim();
      }
      // Handle structured content (array of blocks)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object" && "text" in block) {
            const text = (block as { text?: string }).text;
            if (typeof text === "string" && text.trim()) {
              log.info?.(
                `last-resort capture succeeded via chat.history (structured): run=${entry.runId} child=${childSessionKey} len=${text.trim().length}`,
              );
              return text.trim();
            }
          }
        }
      }
    }
  } catch (err) {
    log.warn?.(
      `last-resort capture via chat.history failed: run=${entry.runId} child=${childSessionKey} err=${String(err)}`,
    );
  }

  // Fallback: try reading the latest assistant reply directly
  try {
    const latestReply = await callGateway({
      method: "chat.history",
      params: { sessionKey: childSessionKey, limit: 5 },
      timeoutMs: 10_000,
    });
    const msgs = Array.isArray((latestReply as { messages?: unknown })?.messages)
      ? ((latestReply as { messages: unknown[] }).messages as Array<{
          role?: string;
          content?: unknown;
        }>)
      : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i];
      if (!msg || typeof msg !== "object") {
        continue;
      }
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        return content.trim();
      }
    }
  } catch {
    // Best effort
  }

  return undefined;
}

/**
 * Attempt last-resort direct delivery of the child's result to the original
 * channel when all announce retries are exhausted. Returns `{ recovered: true }`
 * if the delivery succeeded, in which case the caller should skip the
 * ANNOUNCE_GIVEUP log (since the result was delivered, just not via the parent).
 *
 * When frozenResultText is empty, attempts a last-resort capture from the
 * child session before giving up (2026-04-25 fix for ACP sessions).
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

  let resultText = entry.completion?.resultText || entry.completion?.fallbackResultText;

  // frankclaw: when resultText is empty (common for ACP sessions),
  // attempt one last capture before giving up. By this point several minutes
  // have passed since the child completed, making it more likely the session
  // data is available.
  if (!resultText?.trim()) {
    log.info?.(
      `give-up fallback: resultText empty, attempting last-resort capture: run=${entry.runId} child=${entry.childSessionKey}`,
    );
    const captured = await attemptLastResortResultCapture(entry);
    if (captured) {
      resultText = captured;
      // Persist the captured text so it's available for future retries
      if (entry.completion) {
        entry.completion.resultText = captured;
      }
    }
  }

  if (!resultText?.trim()) {
    // Even without result text, provide a meaningful notification that the
    // worker finished, so the parent's human at least knows work was done.
    const outcomeStatus = entry.outcome?.status ?? "unknown";
    const outcomeError = entry.outcome?.error?.trim();
    const label = entry.label?.trim() || entry.childSessionKey;
    if (outcomeStatus === "error" && outcomeError) {
      resultText = `Worker \`${label}\` failed: ${outcomeError}`;
    } else if (outcomeStatus === "ok") {
      resultText = `Worker \`${label}\` completed successfully, but its output could not be captured.`;
    } else {
      log.warn?.(
        `give-up fallback skipped (no frozen result after last-resort capture): run=${entry.runId} child=${entry.childSessionKey}`,
      );
      return { recovered: false };
    }
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

/**
 * Direct delivery of a child's result to the original channel, bypassing the
 * LLM formatting step entirely. Used when announce delivery repeatedly fails
 * because all LLM providers are down (FallbackSummaryError).
 *
 * This is similar to attemptGiveUpFallbackDelivery but is called earlier in
 * the retry loop (after detecting model failures), not just at give-up time.
 */
export async function attemptModelFailureDirectDelivery(
  entry: SubagentRunRecord,
): Promise<GiveUpFallbackResult> {
  if (!entry.expectsCompletionMessage) {
    return { recovered: false };
  }

  let resultText = entry.completion?.resultText || entry.completion?.fallbackResultText;
  if (!resultText?.trim()) {
    const captured = await attemptLastResortResultCapture(entry);
    if (captured) {
      resultText = captured;
      if (entry.completion) {
        entry.completion.resultText = captured;
      }
    }
  }

  if (!resultText?.trim()) {
    return { recovered: false };
  }

  const origin = entry.requesterOrigin;
  const channel = normalizeOptionalString(origin?.channel);
  const to = normalizeOptionalString(origin?.to);
  if (!channel || !to) {
    return { recovered: false };
  }

  const threadId =
    origin?.threadId != null && String(origin.threadId).trim()
      ? String(origin.threadId).trim()
      : undefined;

  const label = entry.label?.trim() || entry.childSessionKey;
  const message = `[Worker result] Sub-agent \`${label}\` completed (delivered directly due to model outage):\n\n${resultText.trim()}`;

  try {
    await callGateway({
      method: "send",
      params: {
        channel,
        to,
        threadId,
        accountId: origin?.accountId,
        message,
        idempotencyKey: `announce-model-failure-bypass:${entry.runId}`,
      },
      timeoutMs: 30_000,
    });
    log.info?.(
      `model-failure direct delivery succeeded: run=${entry.runId} child=${entry.childSessionKey} -> ${channel}:${to}`,
    );
    return { recovered: true, deliveryPath: `${channel}:${to}` };
  } catch (err) {
    log.warn?.(`model-failure direct delivery failed: run=${entry.runId} err=${String(err)}`);
    return { recovered: false, error: String(err) };
  }
}
