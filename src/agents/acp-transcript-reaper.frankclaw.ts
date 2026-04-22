/**
 * frankclaw: Periodic reaper for stale 0-byte ACP transcript files.
 *
 * Scans ACP session transcripts and writes a diagnostic marker to any 0-byte
 * file that has been untouched for longer than the stale threshold.  This
 * makes "enqueue-drop" failures visible to monitors and prevents false
 * positives from sessions that are legitimately still starting up.
 *
 * This runs as a best-effort helper: it never throws, and skips files that
 * might still be in the startup window.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/acp-transcript-reaper");

/** Minimum age (ms) before a 0-byte file is considered stale. */
const STALE_THRESHOLD_MS = 10 * 60_000; // 10 minutes

export type ReaperResult = {
  scanned: number;
  marked: number;
  errors: number;
};

/**
 * Scan the sessions directory for 0-byte transcript files older than the
 * stale threshold and write a diagnostic marker to each.
 */
export async function reapStaleZeroByteTranscripts(params: {
  sessionsDir: string;
  nowMs?: number;
  staleThresholdMs?: number;
}): Promise<ReaperResult> {
  const now = params.nowMs ?? Date.now();
  const threshold = params.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const result: ReaperResult = { scanned: 0, marked: 0, errors: 0 };

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(params.sessionsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) {
      continue;
    }
    if (entry.name.includes(".deleted.")) {
      continue;
    }
    // Skip sessions.json itself
    if (entry.name === "sessions.json") {
      continue;
    }

    const filePath = path.join(params.sessionsDir, entry.name);
    result.scanned++;

    try {
      const stat = await fs.stat(filePath);
      if (stat.size !== 0) {
        continue;
      }

      const ageMs = now - stat.mtimeMs;
      if (ageMs < threshold) {
        continue;
      }

      // This file is 0-byte and stale.  Write a diagnostic marker.
      const sessionId = entry.name.replace(".jsonl", "");
      const marker = JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `[ACP transcript reaper: file was 0-byte for ${Math.round(ageMs / 60_000)}min, marking as stale enqueue-drop]`,
            },
          ],
        },
        acp_lifecycle: "reaper_stale_marker",
        sessionId,
        timestamp: now,
      });

      await fs.writeFile(filePath, marker + "\n", { mode: 0o600 });
      result.marked++;
    } catch (error) {
      result.errors++;
      log.warn(`Reaper failed for ${entry.name}: ${String(error)}`);
    }
  }

  if (result.marked > 0) {
    log.info(`ACP transcript reaper: marked ${result.marked} stale 0-byte files`);
  }

  return result;
}
