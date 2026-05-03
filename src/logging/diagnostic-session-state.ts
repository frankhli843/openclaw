export type SessionStateValue = "idle" | "processing" | "waiting";

export type SessionState = {
  sessionId?: string;
  sessionKey?: string;
  lastActivity: number;
  lastStuckWarnAgeMs?: number;
  state: SessionStateValue;
  queueDepth: number;
  toolCallHistory?: ToolCallRecord[];
  toolLoopWarningBuckets?: Map<string, number>;
  commandPollCounts?: Map<string, { count: number; lastPollAt: number }>;
};

export type ToolCallRecord = {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  runId?: string;
  resultHash?: string;
  unknownToolName?: string;
  timestamp: number;
};

export type SessionRef = {
  sessionId?: string;
  sessionKey?: string;
};

export const diagnosticSessionStates = new Map<string, SessionState>();

const SESSION_STATE_TTL_MS = 30 * 60 * 1000;
const SESSION_STATE_PRUNE_INTERVAL_MS = 60 * 1000;
const SESSION_STATE_MAX_ENTRIES = 2000;

let lastSessionPruneAt = 0;

export function pruneDiagnosticSessionStates(now = Date.now(), force = false): void {
  const shouldPruneForSize = diagnosticSessionStates.size > SESSION_STATE_MAX_ENTRIES;
  if (!force && !shouldPruneForSize && now - lastSessionPruneAt < SESSION_STATE_PRUNE_INTERVAL_MS) {
    return;
  }
  lastSessionPruneAt = now;

  for (const [key, state] of diagnosticSessionStates.entries()) {
    const ageMs = now - state.lastActivity;
    const isIdle = state.state === "idle";
    if (isIdle && state.queueDepth <= 0 && ageMs > SESSION_STATE_TTL_MS) {
      diagnosticSessionStates.delete(key);
    }
  }

  if (diagnosticSessionStates.size <= SESSION_STATE_MAX_ENTRIES) {
    return;
  }
  const excess = diagnosticSessionStates.size - SESSION_STATE_MAX_ENTRIES;
  const ordered = Array.from(diagnosticSessionStates.entries()).toSorted(
    (a, b) => a[1].lastActivity - b[1].lastActivity,
  );
  for (let i = 0; i < excess; i += 1) {
    const key = ordered[i]?.[0];
    if (!key) {
      break;
    }
    diagnosticSessionStates.delete(key);
  }
}

function resolveSessionKey({ sessionKey, sessionId }: SessionRef) {
  return sessionKey ?? sessionId ?? "unknown";
}

function findStateBySessionId(sessionId: string): SessionState | undefined {
  for (const state of diagnosticSessionStates.values()) {
    if (state.sessionId === sessionId) {
      return state;
    }
  }
  return undefined;
}

export function getDiagnosticSessionState(ref: SessionRef): SessionState {
  pruneDiagnosticSessionStates();
  const key = resolveSessionKey(ref);
  const directMatch = diagnosticSessionStates.get(key);
  if (directMatch) {
    if (ref.sessionId) {
      directMatch.sessionId = ref.sessionId;
    }
    if (ref.sessionKey) {
      directMatch.sessionKey = ref.sessionKey;
    }
    return directMatch;
  }
  // When found via sessionId fallback, do NOT mutate the existing entry's
  // sessionKey. The fallback entry belongs to a different session key (e.g.,
  // a WhatsApp group session) and mutating it would cause misleading stuck-
  // session diagnostics (the original session key would be overwritten by
  // the new caller's key). Instead, create a fresh entry for the new key.
  // See: heartbeat poll routed into WhatsApp DaHong session key incident.
  const fallback = ref.sessionId ? findStateBySessionId(ref.sessionId) : undefined;
  if (fallback && fallback.sessionKey && ref.sessionKey && fallback.sessionKey !== ref.sessionKey) {
    const created: SessionState = {
      sessionId: ref.sessionId,
      sessionKey: ref.sessionKey,
      lastActivity: Date.now(),
      state: "idle",
      queueDepth: 0,
    };
    diagnosticSessionStates.set(key, created);
    pruneDiagnosticSessionStates(Date.now(), true);
    return created;
  }
  if (fallback) {
    if (ref.sessionId) {
      fallback.sessionId = ref.sessionId;
    }
    if (ref.sessionKey) {
      fallback.sessionKey = ref.sessionKey;
    }
    return fallback;
  }
  const created: SessionState = {
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    lastActivity: Date.now(),
    state: "idle",
    queueDepth: 0,
  };
  diagnosticSessionStates.set(key, created);
  pruneDiagnosticSessionStates(Date.now(), true);
  return created;
}

export function getDiagnosticSessionStateCountForTest(): number {
  return diagnosticSessionStates.size;
}

export function resetDiagnosticSessionStateForTest(): void {
  diagnosticSessionStates.clear();
  lastSessionPruneAt = 0;
}
