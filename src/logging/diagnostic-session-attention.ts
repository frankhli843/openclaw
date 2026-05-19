import type { DiagnosticSessionActiveWorkKind } from "../infra/diagnostic-events.js";
import type { DiagnosticSessionActivitySnapshot } from "./diagnostic-run-activity.js";

export type SessionAttentionClassification =
  | {
      eventType: "session.long_running";
      reason: string;
      classification: "long_running";
      activeWorkKind?: DiagnosticSessionActiveWorkKind;
      recoveryEligible: false;
    }
  | {
      eventType: "session.stalled";
      reason: string;
      // frankclaw: stale_completed_tool_call = impossible state where lastProgress shows :ended
      // but the tool is still in activeTools (completion event was dropped/misrouted).
      // recoveryEligible is true so the recovery loop can force-clear the stale marker.
      classification: "blocked_tool_call" | "stalled_agent_run" | "stale_completed_tool_call";
      activeWorkKind?: DiagnosticSessionActiveWorkKind;
      recoveryEligible: boolean;
    }
  | {
      eventType: "session.stuck";
      reason: string;
      classification: "stale_session_state";
      activeWorkKind?: undefined;
      recoveryEligible: true;
    };

/**
 * frankclaw: minimum age in ms before a blocked_tool_call becomes recovery-eligible.
 * After this threshold, the tool has been stuck long enough that waiting longer
 * cannot help — clear the stale marker and let the queue drain.
 */
export const BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS = 10 * 60_000; // 10 minutes

/**
 * Returns true when lastProgressReason indicates a tool-ended event whose
 * completion did not clear the tool from activeTools (impossible state).
 */
function isStaleCompletedToolCall(activity: DiagnosticSessionActivitySnapshot): boolean {
  const reason = activity.lastProgressReason ?? "";
  // lastProgress like "tool:web_fetch:ended" means a tool completion was recorded,
  // but activeWorkKind is still "tool_call" — the delete(toolKey) silently failed
  // because start and end events used mismatched keys (runId vs sessionId/sessionKey).
  return activity.activeWorkKind === "tool_call" && /^tool:[^:]+:ended$/.test(reason);
}

export function classifySessionAttention(params: {
  queueDepth: number;
  activity: DiagnosticSessionActivitySnapshot;
  staleMs: number;
  ageMs?: number;
}): SessionAttentionClassification {
  if (params.activity.activeWorkKind) {
    if (
      params.activity.activeWorkKind === "tool_call" &&
      (params.activity.activeToolAgeMs ?? 0) > params.staleMs &&
      (params.activity.lastProgressAgeMs ?? 0) > params.staleMs
    ) {
      // Impossible state: tool shows as ended in lastProgress but is still in
      // activeTools. The tool completion event was dropped or misrouted.
      // Always eligible for recovery — this state cannot heal itself.
      if (isStaleCompletedToolCall(params.activity)) {
        return {
          eventType: "session.stalled",
          reason: "stale_completed_tool_call",
          classification: "stale_completed_tool_call",
          activeWorkKind: params.activity.activeWorkKind,
          recoveryEligible: true,
        };
      }

      // Standard blocked tool call: eligible for recovery after 10-minute threshold
      // so genuinely stuck calls are cleared without waiting indefinitely.
      const ageMs = params.ageMs ?? 0;
      const recoveryEligible = ageMs >= BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS;
      return {
        eventType: "session.stalled",
        reason: "blocked_tool_call",
        classification: "blocked_tool_call",
        activeWorkKind: params.activity.activeWorkKind,
        recoveryEligible,
      };
    }
    if (
      params.queueDepth > 0 &&
      params.activity.activeWorkKind === "embedded_run" &&
      isTerminalDiagnosticProgressReason(params.activity.lastProgressReason)
    ) {
      return {
        eventType: "session.stalled",
        reason: "queued_behind_terminal_active_work",
        classification: "stalled_agent_run",
        activeWorkKind: params.activity.activeWorkKind,
        recoveryEligible: false,
      };
    }
    if ((params.activity.lastProgressAgeMs ?? 0) > params.staleMs) {
      return {
        eventType: "session.stalled",
        reason: "active_work_without_progress",
        classification: "stalled_agent_run",
        activeWorkKind: params.activity.activeWorkKind,
        recoveryEligible: false,
      };
    }
    return {
      eventType: "session.long_running",
      reason: params.queueDepth > 0 ? "queued_behind_active_work" : "active_work",
      classification: "long_running",
      activeWorkKind: params.activity.activeWorkKind,
      recoveryEligible: false,
    };
  }

  return {
    eventType: "session.stuck",
    reason: params.queueDepth > 0 ? "queued_work_without_active_run" : "stale_session_state",
    classification: "stale_session_state",
    recoveryEligible: true,
  };
}

export function isTerminalDiagnosticProgressReason(reason: string | undefined): boolean {
  if (!reason) {
    return false;
  }
  return (
    reason === "run:completed" ||
    reason === "embedded_run:ended" ||
    reason.includes("response.completed") ||
    reason.includes("rawResponseItem/completed") ||
    reason.includes("raw_response_item.completed") ||
    reason.includes("output_item.done")
  );
}
