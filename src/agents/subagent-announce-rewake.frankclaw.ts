// frankclaw addition: re-wake the parent session after a subagent / ACP
// background worker reports completion.
//
// Problem this solves (2026-04-18 incident):
// An ACP worker spawned from Discord (channel 1495036867148775464,
// label `acp-kickoff-logs-1776515353-76db5c`) finished its work, posted the
// terse "Background task done: <label> (run <id>)" announce to the
// originating channel, then stopped. The parent OpenClaw session was never
// woken to (a) verify the work, (b) commit/push/PR what the worker staged,
// (c) reply to the user with a real status. Result: the user got no real
// confirmation and the work sat in the worktree, half-done.
//
// Upstream `deliverSubagentAnnouncement` enqueues / direct-sends the
// announce message but never asks the heartbeat scheduler to wake the
// parent session. During streaming, `acp-spawn-parent-stream.ts` calls
// `requestHeartbeatNow` continuously, but the announce path on completion
// has no equivalent wake. This module fills that gap.
//
// Also: when the announce delivery itself fails (transient gateway error,
// session lock, queue saturation, etc.), we record a retry marker that the
// openclaw-watchdog can pick up and re-attempt. This avoids the silent loss
// of "worker finished, no one knows" when the announce path is degraded.

import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { requestHeartbeat } from "../infra/heartbeat-wake.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { scopedHeartbeatWakeOptions } from "../routing/session-key.js";

const log = createSubsystemLogger("agents/subagent-announce-rewake");

function retryQueueDir(): string {
  // Resolved lazily so tests can override OPENCLAW_WORKSPACE per case.
  return path.join(
    process.env["OPENCLAW_WORKSPACE"] ?? "/home/frank/.openclaw/workspace",
    "state",
    "subagent-announce-retry",
  );
}

export interface RewakeAfterAnnounceParams {
  /** The parent session that should be woken to process the announce. */
  parentSessionKey: string;
  /** The child ACP / subagent that just completed. Used for log + retry context. */
  childSessionKey: string;
  /** Run id of the completed child run (best-effort). */
  childRunId?: string;
  /** Optional label for log lines. */
  label?: string;
  /** Whether the announce we just delivered actually reached its target. */
  delivered: boolean;
  /** Whether this was a completion announce vs a mid-flight one. Wake only on completion. */
  expectsCompletionMessage: boolean;
  /** When delivery failed, the error string (for the retry marker). */
  deliveryError?: string;
  /** Optional reason tag forwarded to the heartbeat scheduler. */
  reason?: string;
}

// Per-parent debounce registry: the last timestamp (ms) we woke each parent
// session. Without this, multiple ACP children completing on the same parent
// in quick succession (common: one /iterate spawns several sub-workers that
// all finish within a minute) cause N back-to-back `requestHeartbeatNow`
// calls, each producing a fresh turn that regenerates the same near-identical
// response and posts it again. Root incident: 2026-04-19 Discord thread
// 1495460242920706168 where the same "ACP deep local test sweep" paragraph
// posted 3 times within 3 minutes.
const REWAKE_DEBOUNCE_MS = 30_000;
const lastWakeByParent = new Map<string, number>();

export function __resetRewakeDebounceForTest(): void {
  lastWakeByParent.clear();
}

/**
 * Wake the parent session after a subagent completion announce so the parent
 * agent immediately processes the announce as a turn (not "next time
 * something else triggers a tick"). For completion announces only — we do
 * not wake on mid-stream announces (those already have their own wake path).
 *
 * Debounced per parent: within REWAKE_DEBOUNCE_MS of the last wake for the
 * same parent, additional completions skip the heartbeat. Those completions
 * still get processed — they're delivered as inbound [Doramon note to self]
 * messages and the note-to-self protocol tells the agent to iterate — but
 * we don't forcibly poke the scheduler for each one.
 *
 * Safe to call from any caller; failures are logged but never thrown.
 */
export function rewakeParentAfterAnnounce(params: RewakeAfterAnnounceParams): void {
  if (!params.expectsCompletionMessage) {
    return;
  }
  const parentKey = normalizeOptionalString(params.parentSessionKey);
  if (!parentKey) {
    return;
  }

  if (params.delivered) {
    const now = Date.now();
    const last = lastWakeByParent.get(parentKey) ?? 0;
    if (now - last < REWAKE_DEBOUNCE_MS) {
      log.info?.(
        `rewake skipped (debounce ${Math.round((now - last) / 1000)}s < ${REWAKE_DEBOUNCE_MS / 1000}s): parent=${parentKey} child=${params.childSessionKey.slice(0, 60)} run=${params.childRunId ?? "-"}`,
      );
      return;
    }
    try {
      requestHeartbeat(
        scopedHeartbeatWakeOptions(parentKey, {
          source: "background-task" as const,
          intent: "event" as const,
          reason: params.reason ?? "subagent:announce:completed",
        }),
      );
      lastWakeByParent.set(parentKey, now);
      log.info?.(
        `rewake parent after announce: parent=${parentKey} child=${params.childSessionKey.slice(0, 60)} run=${params.childRunId ?? "-"}`,
      );
    } catch (err) {
      log.warn?.(`rewake parent failed (heartbeat): parent=${parentKey} err=${String(err)}`);
    }
    return;
  }

  // Delivery failed — write a retry marker so the watchdog picks it up.
  // The watchdog will re-attempt the announce (and rewake) up to N times.
  recordAnnounceDeliveryFailure(params);
}

function recordAnnounceDeliveryFailure(params: RewakeAfterAnnounceParams): void {
  try {
    const queueDir = retryQueueDir();
    if (!fs.existsSync(queueDir)) {
      fs.mkdirSync(queueDir, { recursive: true });
    }
    const safeLabel = (params.label ?? params.childRunId ?? "unknown")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80);
    const filename = `${Date.now()}-${safeLabel}.json`;
    const fullPath = path.join(queueDir, filename);
    const payload = {
      schema: "subagent-announce-retry/v1",
      enqueued_at_ms: Date.now(),
      parent_session_key: params.parentSessionKey,
      child_session_key: params.childSessionKey,
      child_run_id: params.childRunId ?? null,
      label: params.label ?? null,
      delivery_error: params.deliveryError ?? null,
      attempts: 0,
    };
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2), "utf8");
    log.warn?.(
      `enqueued announce-delivery retry: parent=${params.parentSessionKey} child=${params.childSessionKey.slice(0, 60)} marker=${filename}`,
    );
  } catch (err) {
    log.error?.(`failed to enqueue announce-delivery retry: ${String(err)}`);
  }
}
