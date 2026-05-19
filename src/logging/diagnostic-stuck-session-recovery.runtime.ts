import { resolveEmbeddedSessionLane } from "../agents/pi-embedded-runner/lanes.js";
import {
  abortAndDrainEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunHandleActive,
  resolveActiveEmbeddedRunSessionId,
  resolveActiveEmbeddedRunHandleSessionId,
} from "../agents/pi-embedded-runner/runs.js";
import { getCommandLaneSnapshot, resetCommandLane } from "../process/command-queue.js";
import { forceClearDiagnosticSessionActivity } from "./diagnostic-run-activity.js";
import { diagnosticLogger as diag } from "./diagnostic-runtime.js";
import {
  formatStoppedCronSessionDiagnosticFields,
  resolveCronSessionDiagnosticContext,
} from "./diagnostic-session-context.js";
import {
  formatRecoveryOutcome,
  type StuckSessionRecoveryOutcome,
  type StuckSessionRecoveryRequest,
} from "./diagnostic-session-recovery.js";
import { isDiagnosticSessionStateCurrent } from "./diagnostic-session-state.js";
import { logStuckToolCallRecovery } from "./frankclaw-diag.frankclaw.js";

const STUCK_SESSION_ABORT_SETTLE_MS = 15_000;
const recoveriesInFlight = new Set<string>();

export type StuckSessionRecoveryParams = StuckSessionRecoveryRequest;

function recoveryKey(params: StuckSessionRecoveryParams): string | undefined {
  return params.sessionKey?.trim() || params.sessionId?.trim() || undefined;
}

function formatRecoveryContext(
  params: StuckSessionRecoveryParams,
  extra?: { activeSessionId?: string; lane?: string; activeCount?: number; queuedCount?: number },
): string {
  const fields = [
    `sessionId=${params.sessionId ?? extra?.activeSessionId ?? "unknown"}`,
    `sessionKey=${params.sessionKey ?? "unknown"}`,
    `age=${Math.round(params.ageMs / 1000)}s`,
    `queueDepth=${params.queueDepth ?? 0}`,
  ];
  if (extra?.activeSessionId) {
    fields.push(`activeSessionId=${extra.activeSessionId}`);
  }
  if (extra?.lane) {
    fields.push(`lane=${extra.lane}`);
  }
  if (extra?.activeCount !== undefined) {
    fields.push(`laneActive=${extra.activeCount}`);
  }
  if (extra?.queuedCount !== undefined) {
    fields.push(`laneQueued=${extra.queuedCount}`);
  }
  return fields.join(" ");
}

export async function recoverStuckDiagnosticSession(
  params: StuckSessionRecoveryParams,
): Promise<StuckSessionRecoveryOutcome> {
  const key = recoveryKey(params);
  if (!key || recoveriesInFlight.has(key)) {
    return {
      status: "skipped",
      action: "observe_only",
      reason: key ? "already_in_flight" : "missing_session_ref",
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    };
  }

  recoveriesInFlight.add(key);
  try {
    if (
      !isDiagnosticSessionStateCurrent({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        generation: params.stateGeneration,
        state: params.expectedState ?? "processing",
      })
    ) {
      // frankclaw: also try clearing stale tool markers even for non-processing sessions,
      // because idle sessions can retain stale activityByRef entries that confuse the
      // liveness warning and prevent the stalled diagnostic from recognising clean recovery.
      if (
        params.activeWorkKind === "tool_call" &&
        (params.classification === "blocked_tool_call" ||
          params.classification === "stale_completed_tool_call")
      ) {
        const cleared = forceClearDiagnosticSessionActivity({
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          reason: `recovery_non_processing:${params.classification}`,
        });
        if (cleared > 0) {
          diag.warn(
            `stuck session recovery: cleared ${cleared} stale tool marker(s) from non-processing session` +
              ` sessionId=${params.sessionId ?? "unknown"} sessionKey=${params.sessionKey ?? "unknown"}` +
              ` classification=${params.classification} ageMs=${Math.round(params.ageMs / 1000)}s`,
          );
          logStuckToolCallRecovery({
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            ageMs: params.ageMs,
            classification: params.classification ?? "blocked_tool_call",
            action: "clear_non_processing",
            cleared,
          });
        }
      }
      return {
        status: "skipped",
        action: "observe_only",
        reason: "stale_session_state",
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
      };
    }

    // frankclaw: for stuck tool_call sessions, force-clear the stale tool markers
    // from the in-memory activityByRef map. The tool's completion event was dropped or
    // misrouted, so the tool is perpetually "active" in diagnostic tracking even though
    // the underlying operation has long since ended. Clearing allows the diagnostic
    // heartbeat to see the session as unstuck and lets the queue drain.
    if (
      params.activeWorkKind === "tool_call" &&
      (params.classification === "blocked_tool_call" ||
        params.classification === "stale_completed_tool_call")
    ) {
      const cleared = forceClearDiagnosticSessionActivity({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        reason: `stuck_recovery:${params.classification}`,
      });
      diag.warn(
        `stuck session recovery: cleared ${cleared} stale tool marker(s)` +
          ` sessionId=${params.sessionId ?? "unknown"} sessionKey=${params.sessionKey ?? "unknown"}` +
          ` classification=${params.classification} ageMs=${Math.round(params.ageMs / 1000)}s`,
      );
      if (cleared > 0) {
        const clearOutcome: StuckSessionRecoveryOutcome = {
          status: "released",
          action: "release_lane",
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          released: cleared,
        };
        diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(clearOutcome)}`);
        // frankclaw: emit to frankclaw-diag.log for the heartbeat detector.
        // DNR is a separate outbound path and is not referenced here.
        logStuckToolCallRecovery({
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          toolName: undefined, // not available at recovery time
          toolCallId: undefined,
          ageMs: params.ageMs,
          classification: params.classification ?? "blocked_tool_call",
          action: "release_lane",
          cleared,
        });
        return clearOutcome;
      }
    }

    const fallbackActiveSessionId =
      params.sessionId && isEmbeddedPiRunHandleActive(params.sessionId)
        ? params.sessionId
        : undefined;
    let activeSessionId = params.sessionKey
      ? (resolveActiveEmbeddedRunHandleSessionId(params.sessionKey) ?? fallbackActiveSessionId)
      : fallbackActiveSessionId;
    const activeWorkSessionId = params.sessionKey
      ? (resolveActiveEmbeddedRunSessionId(params.sessionKey) ?? params.sessionId)
      : params.sessionId;
    const laneKey = params.sessionKey?.trim() || params.sessionId?.trim();
    const sessionLane = laneKey ? resolveEmbeddedSessionLane(laneKey) : null;
    let aborted = false;
    let drained = true;
    let forceCleared = false;

    if (activeSessionId) {
      if (params.allowActiveAbort !== true) {
        const outcome: StuckSessionRecoveryOutcome = {
          status: "skipped",
          action: "observe_only",
          reason: "active_embedded_run",
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          activeSessionId,
          activeWorkKind: "embedded_run",
        };
        diag.warn(
          `stuck session recovery skipped: ${formatRecoveryContext(params, { activeSessionId })}`,
        );
        diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(outcome)}`);
        return outcome;
      }
      const result = await abortAndDrainEmbeddedPiRun({
        sessionId: activeSessionId,
        sessionKey: params.sessionKey,
        settleMs: STUCK_SESSION_ABORT_SETTLE_MS,
        forceClear: true,
        reason: "stuck_recovery",
      });
      aborted = result.aborted;
      drained = result.drained;
      forceCleared = result.forceCleared;
    }

    if (!activeSessionId && activeWorkSessionId && isEmbeddedPiRunActive(activeWorkSessionId)) {
      if (params.allowActiveAbort === true) {
        const result = await abortAndDrainEmbeddedPiRun({
          sessionId: activeWorkSessionId,
          sessionKey: params.sessionKey,
          settleMs: STUCK_SESSION_ABORT_SETTLE_MS,
          forceClear: true,
          reason: "stuck_recovery",
        });
        aborted = result.aborted;
        drained = result.drained;
        forceCleared = result.forceCleared;
        activeSessionId = activeWorkSessionId;
      } else {
        const outcome: StuckSessionRecoveryOutcome = {
          status: "skipped",
          action: "keep_lane",
          reason: "active_reply_work",
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          activeSessionId: activeWorkSessionId,
          activeWorkKind: "embedded_run",
        };
        diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(outcome)}`);
        return outcome;
      }
    }

    if (!activeSessionId && sessionLane) {
      const laneSnapshot = getCommandLaneSnapshot(sessionLane);
      if (laneSnapshot.activeCount > 0) {
        const outcome: StuckSessionRecoveryOutcome = {
          status: "skipped",
          action: "keep_lane",
          reason: "active_lane_task",
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          lane: sessionLane,
          activeCount: laneSnapshot.activeCount,
          queuedCount: laneSnapshot.queuedCount,
        };
        diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(outcome)}`);
        return outcome;
      }
    }

    const queuedCount = sessionLane ? getCommandLaneSnapshot(sessionLane).queuedCount : 0;
    const released =
      sessionLane && (!activeSessionId || !aborted || !drained) ? resetCommandLane(sessionLane) : 0;

    const clearStaleQueuedSession = !aborted && released === 0 && (params.queueDepth ?? 0) > 0;

    if (aborted || forceCleared || released > 0 || clearStaleQueuedSession) {
      const action = aborted || forceCleared ? "abort_embedded_run" : "release_lane";
      const stoppedFields = formatStoppedCronSessionDiagnosticFields(
        resolveCronSessionDiagnosticContext({ sessionKey: params.sessionKey, activeSessionId }),
      );
      diag.warn(
        `stuck session recovery: sessionId=${params.sessionId ?? activeSessionId ?? "unknown"} sessionKey=${
          params.sessionKey ?? "unknown"
        } age=${Math.round(params.ageMs / 1000)}s action=${action} aborted=${aborted} drained=${drained} released=${released}${
          stoppedFields ? ` ${stoppedFields}` : ""
        }`,
      );
      const outcome: StuckSessionRecoveryOutcome =
        aborted || forceCleared
          ? {
              status: "aborted",
              action: "abort_embedded_run",
              sessionId: params.sessionId,
              sessionKey: params.sessionKey,
              activeSessionId,
              activeWorkKind: "embedded_run",
              aborted,
              drained,
              forceCleared,
              released,
              lane: sessionLane ?? undefined,
              ...(queuedCount > 0 ? { queuedCount } : {}),
            }
          : {
              status: "released",
              action: "release_lane",
              sessionId: params.sessionId,
              sessionKey: params.sessionKey,
              released,
              lane: sessionLane ?? undefined,
            };
      diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(outcome)}`);
      return outcome;
    }
    const outcome: StuckSessionRecoveryOutcome = {
      status: "noop",
      action: "none",
      reason: "no_active_work",
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      lane: sessionLane ?? undefined,
    };
    diag.warn(`stuck session recovery outcome: ${formatRecoveryOutcome(outcome)}`);
    return outcome;
  } catch (err) {
    const outcome: StuckSessionRecoveryOutcome = {
      status: "failed",
      action: "none",
      reason: "exception",
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      error: String(err),
    };
    diag.warn(
      `stuck session recovery failed: sessionId=${params.sessionId ?? "unknown"} sessionKey=${
        params.sessionKey ?? "unknown"
      } err=${String(err)}`,
    );
    return outcome;
  } finally {
    recoveriesInFlight.delete(key);
  }
}

export const testing = {
  resetRecoveriesInFlight(): void {
    recoveriesInFlight.clear();
  },
};
export { testing as __testing };
