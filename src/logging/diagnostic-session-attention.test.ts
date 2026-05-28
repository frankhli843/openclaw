import { describe, expect, it } from "vitest";
import {
  BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS,
  classifySessionAttention,
} from "./diagnostic-session-attention.js";

describe("classifySessionAttention", () => {
  it.each([
    {
      name: "stale state without queued work",
      queueDepth: 0,
      activity: {},
      expected: {
        eventType: "session.stuck",
        reason: "stale_session_state",
        classification: "stale_session_state",
        recoveryEligible: true,
      },
    },
    {
      name: "queued stale state without active work",
      queueDepth: 1,
      activity: {},
      expected: {
        eventType: "session.stuck",
        reason: "queued_work_without_active_run",
        classification: "stale_session_state",
        recoveryEligible: true,
      },
    },
    {
      name: "active embedded run making progress",
      queueDepth: 0,
      activity: {
        activeWorkKind: "embedded_run" as const,
        lastProgressAgeMs: 10_000,
      },
      expected: {
        eventType: "session.long_running",
        reason: "active_work",
        classification: "long_running",
        activeWorkKind: "embedded_run",
        recoveryEligible: false,
      },
    },
    {
      name: "queued behind active work",
      queueDepth: 1,
      activity: {
        activeWorkKind: "embedded_run" as const,
        lastProgressAgeMs: 10_000,
      },
      expected: {
        eventType: "session.long_running",
        reason: "queued_behind_active_work",
        classification: "long_running",
        activeWorkKind: "embedded_run",
        recoveryEligible: false,
      },
    },
    {
      name: "queued behind terminal embedded progress",
      queueDepth: 1,
      activity: {
        activeWorkKind: "embedded_run" as const,
        lastProgressAgeMs: 100,
        lastProgressReason: "codex_app_server:notification:rawResponseItem/completed",
      },
      expected: {
        eventType: "session.stalled",
        reason: "queued_behind_terminal_active_work",
        classification: "stalled_agent_run",
        activeWorkKind: "embedded_run",
        recoveryEligible: false,
      },
    },
    {
      name: "active work without progress",
      queueDepth: 0,
      activity: {
        activeWorkKind: "model_call" as const,
        lastProgressAgeMs: 31_000,
      },
      expected: {
        eventType: "session.stalled",
        reason: "active_work_without_progress",
        classification: "stalled_agent_run",
        activeWorkKind: "model_call",
        recoveryEligible: false,
      },
    },
    {
      name: "blocked tool call",
      queueDepth: 0,
      activity: {
        activeWorkKind: "tool_call" as const,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
      },
      expected: {
        eventType: "session.stalled",
        reason: "blocked_tool_call",
        classification: "blocked_tool_call",
        activeWorkKind: "tool_call",
        recoveryEligible: false,
      },
    },
    {
      name: "blocked tool call is not recovery eligible before 10-min threshold",
      queueDepth: 0,
      ageMs: BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS - 1,
      activity: {
        activeWorkKind: "tool_call" as const,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
      },
      expected: {
        eventType: "session.stalled",
        reason: "blocked_tool_call",
        classification: "blocked_tool_call",
        activeWorkKind: "tool_call",
        recoveryEligible: false,
      },
    },
    {
      name: "blocked tool call is recovery eligible at 10-min threshold",
      queueDepth: 0,
      ageMs: BLOCKED_TOOL_CALL_RECOVERY_THRESHOLD_MS,
      activity: {
        activeWorkKind: "tool_call" as const,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
      },
      expected: {
        eventType: "session.stalled",
        reason: "blocked_tool_call",
        classification: "blocked_tool_call",
        activeWorkKind: "tool_call",
        recoveryEligible: true,
      },
    },
    {
      // frankclaw: impossible state — lastProgress shows tool ended but tool still in activeTools
      // This state is always recovery eligible regardless of session age.
      name: "stale completed tool call is always recovery eligible",
      queueDepth: 0,
      ageMs: 0,
      activity: {
        activeWorkKind: "tool_call" as const,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
        lastProgressReason: "tool:web_fetch:ended",
      },
      expected: {
        eventType: "session.stalled",
        reason: "stale_completed_tool_call",
        classification: "stale_completed_tool_call",
        activeWorkKind: "tool_call",
        recoveryEligible: true,
      },
    },
    {
      name: "stale completed tool call: matches any tool name in pattern",
      queueDepth: 1,
      ageMs: 0,
      activity: {
        activeWorkKind: "tool_call" as const,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
        lastProgressReason: "tool:bash:ended",
      },
      expected: {
        eventType: "session.stalled",
        reason: "stale_completed_tool_call",
        classification: "stale_completed_tool_call",
        activeWorkKind: "tool_call",
        recoveryEligible: true,
      },
    },
    {
      name: "idle queued stale model activity without active embedded run",
      state: "idle" as const,
      queueDepth: 1,
      activity: {
        activeWorkKind: "model_call" as const,
        hasActiveEmbeddedRun: false,
        lastProgressAgeMs: 31_000,
        lastProgressReason: "model_call:started",
      },
      expected: {
        eventType: "session.stuck",
        reason: "queued_work_without_active_run",
        classification: "stale_session_state",
        recoveryEligible: true,
      },
    },
    {
      name: "idle queued stale tool_call activity without active embedded run",
      state: "idle" as const,
      queueDepth: 1,
      activity: {
        activeWorkKind: "tool_call" as const,
        hasActiveEmbeddedRun: false,
        activeToolAgeMs: 31_000,
        lastProgressAgeMs: 31_000,
        lastProgressReason: "tool:shell:started",
      },
      expected: {
        eventType: "session.stuck",
        reason: "queued_work_without_active_run",
        classification: "stale_session_state",
        recoveryEligible: true,
      },
    },
    {
      name: "processing session with orphaned activity is not recoverable",
      state: "processing" as const,
      queueDepth: 1,
      activity: {
        activeWorkKind: "model_call" as const,
        hasActiveEmbeddedRun: false,
        lastProgressAgeMs: 31_000,
      },
      expected: {
        eventType: "session.stalled",
        reason: "active_work_without_progress",
        classification: "stalled_agent_run",
        activeWorkKind: "model_call",
        recoveryEligible: false,
      },
    },
  ])("$name", ({ activity, expected, queueDepth, state = "processing" as const, ageMs = 0 }) => {
    expect(
      classifySessionAttention({
        state,
        queueDepth,
        activity,
        staleMs: 30_000,
        ageMs,
      }),
    ).toEqual(expected);
  });
});
