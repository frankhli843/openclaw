/**
 * Frankclaw extension for agent-runner-execution.ts
 *
 * Handles:
 * - Error redirect to FRANKCLAW_LOGS_GROUP WhatsApp group
 * - Retryable failure detection for deferred retry system
 * - Context overflow silent reset
 */
import { sendWebChannelMessage } from "../../plugins/runtime/runtime-web-channel-plugin.js";
import { defaultRuntime } from "../../runtime.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import type { ReplyPayload } from "../types.js";

// ── Error Redirect ─────────────────────────────────────────────────────────

/**
 * If FRANKCLAW_LOGS_GROUP is configured, redirect agent errors there instead
 * of showing them to the user. Returns a silent payload if redirected, or
 * null if no redirect was configured.
 */
export async function maybeRedirectErrorToLogsGroup(params: {
  fallbackText: string;
  sessionKey?: string;
  isContextOverflow: boolean;
  retryableFailure: boolean;
  failureMessage?: string;
  resetSession?: (message: string) => Promise<boolean>;
}): Promise<{
  kind: "final";
  payload: ReplyPayload;
  retryableFailure?: boolean;
  failureMessage?: string;
} | null> {
  const logsGroup = process.env.FRANKCLAW_LOGS_GROUP;
  if (!logsGroup) {
    return null;
  }

  const sessionInfo = params.sessionKey ?? "unknown session";
  const logMessage = `⚠️ Error in ${sessionInfo}\n${params.fallbackText}`;
  sendWebChannelMessage(logsGroup, logMessage, { verbose: false }).catch((err) => {
    defaultRuntime.error(`Failed to send error to logs group: ${err}`);
  });

  // Auto-reset on context overflow so next message works
  if (params.isContextOverflow && params.resetSession) {
    await params.resetSession("context overflow auto-reset").catch(() => {});
  }

  return {
    kind: "final",
    payload: { text: SILENT_REPLY_TOKEN },
    retryableFailure: params.retryableFailure,
    failureMessage: params.failureMessage,
  };
}

/**
 * Redirect compaction failure reset notification to logs group.
 * Returns a silent payload if redirected, or null if no redirect.
 */
export function maybeRedirectCompactionResetToLogsGroup(params: {
  resetText: string;
  sessionKey?: string;
}): { kind: "final"; payload: ReplyPayload } | null {
  const logsGroup = process.env.FRANKCLAW_LOGS_GROUP;
  if (!logsGroup) {
    return null;
  }

  sendWebChannelMessage(
    logsGroup,
    `${params.resetText}\nSession: ${params.sessionKey ?? "unknown"}`,
    { verbose: false },
  ).catch(() => {});

  return { kind: "final", payload: { text: SILENT_REPLY_TOKEN } };
}

// ── Retryable Failure Detection ────────────────────────────────────────────

/**
 * Determine if a failure is retryable based on error characteristics.
 */
export function isRetryableAgentFailure(params: {
  isTransientHttp: boolean;
  errorMessage: string;
  fallbackAttempts: Array<{ reason?: string; status?: number }>;
  isRateLimitError: (msg: string) => boolean;
}): boolean {
  return (
    params.isTransientHttp ||
    params.isRateLimitError(params.errorMessage) ||
    params.fallbackAttempts.some(
      (attempt) =>
        attempt.reason === "rate_limit" ||
        attempt.reason === "timeout" ||
        (typeof attempt.status === "number" && attempt.status >= 500),
    )
  );
}
