/**
 * frankclaw: Write early transcript markers for ACP turns so the session
 * file becomes non-empty before runTurn() completes.  This prevents
 * monitors from falsely detecting 0-byte transcripts as "enqueue-drop"
 * when a turn simply takes a long time.
 *
 * Also writes a failure marker if the turn errors out, so the transcript
 * distinguishes "never started" from "started but failed."
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveSessionTranscriptFile } from "../../config/sessions/transcript.js";
import type { SessionEntry } from "../../config/sessions/types.js";

/**
 * Resolve the session transcript file path and write a minimal session
 * header so the file is no longer 0 bytes.  Returns the resolved path for
 * use in a later writeAcpTurnFailedMarker call.
 *
 * The header is compatible with SessionManager: when
 * persistAcpTurnTranscript runs after the turn, prepareSessionManagerForRun
 * detects "hadSessionFile + header + no assistant" and resets the file
 * cleanly before writing the full user + assistant exchange.
 */
export async function markAcpTurnStarted(params: {
  sessionId: string;
  sessionKey: string;
  sessionEntry: SessionEntry | undefined;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  sessionAgentId: string;
  cwd: string;
}): Promise<string | undefined> {
  try {
    const { sessionFile } = await resolveSessionTranscriptFile({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      agentId: params.sessionAgentId,
    });
    await fs.mkdir(path.dirname(sessionFile), { recursive: true, mode: 0o700 });
    const header = JSON.stringify({
      type: "session",
      id: params.sessionId,
      cwd: params.cwd,
    });
    // Overwrite: the file was materialized as 0-byte during spawn.
    // prepareSessionManagerForRun will reset it when the full turn persists.
    await fs.writeFile(sessionFile, header + "\n", { mode: 0o600 });
    return sessionFile;
  } catch {
    // Best-effort: don't break the ACP turn if the marker write fails.
    return undefined;
  }
}

/**
 * Append a failure record to the transcript so monitoring and future agents
 * can distinguish "worker died silently" from "worker started and failed."
 *
 * Writes a message-type entry with role "assistant" so that
 * sessionFileHasContent() returns true, allowing monitors to detect that
 * the session DID start (just errored).
 */
export async function markAcpTurnFailed(params: {
  sessionFile: string | undefined;
  error: string;
  runId: string;
}): Promise<void> {
  if (!params.sessionFile) {
    return;
  }
  try {
    const record = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `[ACP turn failed: ${params.error}]` }],
      },
      acp_lifecycle: "turn_failed",
      runId: params.runId,
      timestamp: Date.now(),
    });
    await fs.appendFile(params.sessionFile, record + "\n", { mode: 0o600 });
  } catch {
    // Best-effort only.
  }
}
