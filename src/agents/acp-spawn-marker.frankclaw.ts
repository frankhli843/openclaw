/**
 * frankclaw: Write an early spawn marker to ACP transcript files so they become
 * non-zero immediately after runtime initialization, BEFORE the async agent
 * dispatch.  This closes the race window where the fire-and-forget
 * `callGateway({ method: "agent" })` can fail silently, leaving behind a 0-byte
 * transcript with no diagnostic info.
 *
 * The marker is a valid JSONL session-type entry.  When the agent turn actually
 * starts, `markAcpTurnStarted()` (in acp-transcript-lifecycle.frankclaw.ts)
 * overwrites it with the proper session header.  If the dispatch never fires,
 * the marker stays — making the file non-zero and diagnosable by monitors.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveSessionTranscriptFile } from "../config/sessions/transcript.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/acp-spawn-marker");

/**
 * Write a spawn marker to the transcript file so it becomes non-zero before
 * the async agent dispatch.  Returns the resolved transcript file path (or
 * undefined on failure).  Best-effort: never throws.
 */
export async function writeAcpSpawnMarker(params: {
  sessionId: string;
  sessionKey: string;
  sessionEntry: SessionEntry | undefined;
  sessionStore: Record<string, SessionEntry>;
  storePath: string;
  agentId: string;
  label?: string;
}): Promise<string | undefined> {
  try {
    const { sessionFile } = await resolveSessionTranscriptFile({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      agentId: params.agentId,
    });

    await fs.mkdir(path.dirname(sessionFile), { recursive: true, mode: 0o700 });

    const marker = JSON.stringify({
      type: "session",
      id: params.sessionId,
      acp_lifecycle: "spawn_marker",
      sessionKey: params.sessionKey,
      label: params.label,
      timestamp: Date.now(),
    });

    await fs.writeFile(sessionFile, marker + "\n", { mode: 0o600 });
    return sessionFile;
  } catch (error) {
    log.warn(`Failed to write ACP spawn marker for ${params.sessionKey}: ${String(error)}`);
    return undefined;
  }
}

/**
 * Write a dispatch-failure marker to the transcript when the fire-and-forget
 * agent dispatch promise rejects.  Called from dispatchAgentRunFromGateway's
 * catch block.  Best-effort: never throws.
 */
export async function writeAcpDispatchFailureMarker(params: {
  sessionKey: string;
  agentId: string;
  runId: string;
  error: string;
}): Promise<void> {
  try {
    // Resolve the transcript file from the session store.
    const { resolveStorePath } = await import("../config/sessions/paths.js");
    const { loadSessionStore } = await import("../config/sessions/store.js");
    const storePath = resolveStorePath(undefined, { agentId: params.agentId });
    const store = loadSessionStore(storePath);
    const entry = store[params.sessionKey];
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      return;
    }

    const { sessionFile } = await resolveSessionTranscriptFile({
      sessionId,
      sessionKey: params.sessionKey,
      sessionEntry: entry,
      sessionStore: store,
      storePath,
      agentId: params.agentId,
    });

    const marker = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `[ACP dispatch failed: ${params.error}]`,
          },
        ],
      },
      acp_lifecycle: "dispatch_failed",
      runId: params.runId,
      timestamp: Date.now(),
    });

    await fs.appendFile(sessionFile, marker + "\n", { mode: 0o600 });
  } catch {
    // Best-effort only.  The primary error is already logged by the caller.
  }
}
