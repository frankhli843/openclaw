/**
 * frankclaw: High-signal diagnostic log for channel session events.
 *
 * Writes bounded, rotated entries to state/frankclaw-diag.log so the heartbeat
 * detector can distinguish stuck-session recovery, DNR deferral, and other
 * channel-session lifecycle signals without reading raw journal output.
 *
 * Log format (one JSON-like line per event):
 *   [ISO] EVENT sessionKey=... channel=... toolName=... toolCallId=... ageS=... action=... cleared=...
 *
 * Rotation: file rotated to .old at 2MB, same strategy as acp-diag.frankclaw.ts.
 * Test isolation: VITEST env redirects to a tmp file; OPENCLAW_FRANKCLAW_DIAG_LOG overrides.
 */

import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const FRANKCLAW_DIAG_LOG =
  process.env.OPENCLAW_FRANKCLAW_DIAG_LOG ||
  (process.env.VITEST || process.env.VITEST_WORKER_ID
    ? join(tmpdir(), `frankclaw-diag-vitest-${process.pid}.log`)
    : join(
        process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace"),
        "state",
        "frankclaw-diag.log",
      ));

const FRANKCLAW_DIAG_MAX_BYTES = 2 * 1024 * 1024; // 2MB

/** Derive channel name from a session key like "agent:main:whatsapp:group:..." */
function channelFromSessionKey(sessionKey?: string): string {
  if (!sessionKey) return "unknown";
  const parts = sessionKey.split(":");
  // agent:main:whatsapp:group:... → index 2 = "whatsapp"
  // agent:main:discord:... → index 2 = "discord"
  return parts[2] ?? "unknown";
}

export function franklawDiag(msg: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    mkdirSync(dirname(FRANKCLAW_DIAG_LOG), { recursive: true });
    try {
      const st = statSync(FRANKCLAW_DIAG_LOG);
      if (st.size > FRANKCLAW_DIAG_MAX_BYTES) {
        try {
          unlinkSync(FRANKCLAW_DIAG_LOG + ".old");
        } catch {
          // .old may not exist yet
        }
        renameSync(FRANKCLAW_DIAG_LOG, FRANKCLAW_DIAG_LOG + ".old");
      }
    } catch {
      // file does not exist yet
    }
    appendFileSync(FRANKCLAW_DIAG_LOG, line);
  } catch {
    // never crash the gateway for a log write
  }
}

/** Log a stuck-session tool_call recovery event with all relevant fields. */
export function logStuckToolCallRecovery(params: {
  sessionKey?: string;
  sessionId?: string;
  toolName?: string;
  toolCallId?: string;
  ageMs: number;
  classification: string;
  action: string;
  cleared: number;
}): void {
  const channel = channelFromSessionKey(params.sessionKey);
  const ageS = Math.round(params.ageMs / 1000);
  const fields = [
    `STUCK_TOOL_CALL_RECOVERY`,
    `channel=${channel}`,
    `sessionKey=${params.sessionKey ?? "unknown"}`,
    `sessionId=${params.sessionId ?? "unknown"}`,
    `toolName=${params.toolName ?? "unknown"}`,
    `toolCallId=${params.toolCallId ?? "unknown"}`,
    `ageS=${ageS}`,
    `classification=${params.classification}`,
    `action=${params.action}`,
    `cleared=${params.cleared}`,
    // DNR is a separate outbound path; recovery here does not suppress or defer output.
    // The downstream delivery queue handles DNR deferral independently.
    `dnrNote=deferred_by_outbound_if_quiet_hours`,
  ];
  franklawDiag(fields.join(" "));
}

export const __testing = {
  FRANKCLAW_DIAG_LOG,
};
