// frankclaw: Strip large diagnostic fields from inactive session entries
// to keep sessions.json small and reduce lock contention.
//
// Root cause (2026-04-26 incident):
// skillsSnapshot (~80KB per entry × 500 entries = 40MB) and systemPromptReport
// (3.1MB total) caused sessions.json to grow to 54MB. Every write holds a file
// lock while reading, parsing, serializing, and writing the entire file. With
// cross-process contention (gateway + CC ACP workers), the 10s lock timeout is
// easily exhausted, causing ANNOUNCE_GIVEUP delivery failures.
//
// This module strips those fields from session entries that are in a terminal
// state (done/failed/killed/timeout) since they will never be resumed and don't
// need the snapshot data. Active and running sessions keep all fields intact.

import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { SessionEntry } from "./types.js";

const log = createSubsystemLogger("sessions/store-slim");

/**
 * Fields that are large diagnostic snapshots not needed after a session completes.
 * These are safe to strip from terminal entries because:
 * - skillsSnapshot: only used during session resume/replay, terminal sessions won't resume
 * - systemPromptReport: telemetry data, already captured in the session transcript
 * - compactionCheckpoints: replay state, not needed for completed sessions
 */
const BLOAT_FIELDS: readonly (keyof SessionEntry)[] = [
  "skillsSnapshot",
  "systemPromptReport",
  "compactionCheckpoints",
];

/** Session statuses that are terminal (session will not be resumed). */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["done", "failed", "killed", "timeout"]);

/**
 * Strip large diagnostic fields from terminal session entries before serialization.
 *
 * Only strips from entries with a terminal status. Active, running, and
 * status-less entries keep all fields. The active session key (if provided)
 * is always preserved.
 *
 * Mutates the store in-place for efficiency (avoids cloning 500+ entries).
 *
 * @returns The number of entries slimmed and approximate bytes saved.
 */
export function slimSessionStoreForWrite(
  store: Record<string, SessionEntry>,
  activeSessionKey?: string,
): { slimmed: number; estimatedBytesSaved: number } {
  let slimmed = 0;
  let estimatedBytesSaved = 0;

  for (const [key, entry] of Object.entries(store)) {
    if (!entry) continue;
    // Never slim the session that's actively being written
    if (activeSessionKey && key === activeSessionKey) continue;

    const status = entry.status ?? "";
    if (!TERMINAL_STATUSES.has(status)) continue;

    let stripped = false;
    for (const field of BLOAT_FIELDS) {
      const value = entry[field];
      if (value != null) {
        // Estimate the serialized size before deleting
        try {
          estimatedBytesSaved += JSON.stringify(value).length;
        } catch {
          // Ignore serialization errors in size estimation
        }
        delete (entry as Record<string, unknown>)[field];
        stripped = true;
      }
    }
    if (stripped) {
      slimmed += 1;
    }
  }

  if (slimmed > 0) {
    log.info?.(
      `slimmed ${slimmed} terminal entries, ~${Math.round(estimatedBytesSaved / 1024)}KB saved`,
    );
  }

  return { slimmed, estimatedBytesSaved };
}
