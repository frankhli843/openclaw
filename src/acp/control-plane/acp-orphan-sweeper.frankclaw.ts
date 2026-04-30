/**
 * frankclaw: ACP orphan-session sweeper.
 *
 * Defensive recovery layer that deletes registry entries for ACP-style
 * session keys that were left half-created by a failed sessions_spawn.
 *
 * An orphan looks like this:
 *   - Session key matches the ACP shape (e.g. "agent:claude:acp:<uuid>")
 *   - Registry entry exists (loadable from the per-agent session store)
 *   - Entry has NO `acp` field (metadata never persisted)
 *   - Transcript file is missing or zero-length (no work was performed)
 *
 * This is the defense-in-depth layer that catches orphans the eager safety
 * net in acp-spawn-diag.frankclaw.ts missed (e.g. gateway crashed mid-spawn,
 * sessions.delete also timed out).
 *
 * Usage:
 *   - At startup (one-shot scan after the existing identity reconcile)
 *   - Periodic timer (every N minutes, see scheduleAcpOrphanSweeper)
 *   - CLI / manual trigger
 *
 * Safety:
 *   - Skips entries < ORPHAN_MIN_AGE_MS old (avoid racing with in-flight
 *     spawns whose meta has not been written yet inside withSessionActor).
 *   - Skips entries whose transcript exists and is non-empty (treat any
 *     non-empty transcript as evidence the session did real work).
 *   - Routes deletion through callGateway sessions.delete so registry write
 *     order, lifecycle hooks, and binding cleanup go through the gateway.
 */
import { promises as fsp } from "node:fs";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { loadSessionStore } from "../../config/sessions/store-load.js";
import { resolveAllAgentSessionStoreTargets } from "../../config/sessions/targets.js";
import { resolveSessionTranscriptFile } from "../../config/sessions/transcript.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { callGateway } from "../../gateway/call.js";
import { isAcpSessionKey } from "../../routing/session-key.js";
import { acpDiag } from "./acp-diag.frankclaw.js";

const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const ORPHAN_DELETE_TIMEOUT_MS = 30_000;

export type AcpOrphanCandidate = {
  sessionKey: string;
  storePath: string;
  ageMs: number;
  hadAcpMeta: boolean;
  transcriptExists: boolean;
  transcriptBytes: number;
};

export type AcpOrphanSweepResult = {
  scanned: number;
  candidates: number;
  deleted: number;
  failed: number;
  skipped: number;
};

/**
 * Find ACP-style session keys whose registry entry has no `acp` meta and no
 * transcript content.  Pure read-only.
 */
export async function findAcpOrphanCandidates(params: {
  cfg: OpenClawConfig;
  now?: number;
  minAgeMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<AcpOrphanCandidate[]> {
  const cfg = params.cfg;
  const now = params.now ?? Date.now();
  const minAgeMs = params.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const targets = await resolveAllAgentSessionStoreTargets(
    cfg,
    params.env ? { env: params.env } : undefined,
  );

  const candidates: AcpOrphanCandidate[] = [];
  for (const target of targets) {
    let store: Record<string, SessionEntry>;
    try {
      store = loadSessionStore(target.storePath);
    } catch {
      continue;
    }
    for (const [sessionKey, entry] of Object.entries(store)) {
      if (!isAcpSessionKey(sessionKey)) {
        continue;
      }
      if (entry?.acp) {
        continue;
      }
      const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : 0;
      const ageMs = updatedAt > 0 ? now - updatedAt : Number.POSITIVE_INFINITY;
      if (ageMs < minAgeMs) {
        continue;
      }
      let transcriptExists = false;
      let transcriptBytes = 0;
      try {
        const sessionId = entry?.sessionId ?? sessionKey;
        const { sessionFile } = await resolveSessionTranscriptFile({
          sessionId,
          sessionKey,
          sessionEntry: entry,
          sessionStore: store,
          storePath: target.storePath,
          agentId: target.agentId,
        });
        const stat = await fsp.stat(sessionFile);
        transcriptExists = true;
        transcriptBytes = stat.size;
      } catch {
        transcriptExists = false;
      }
      if (transcriptBytes > 0) {
        // Non-empty transcript means the session did real work. Leave alone.
        continue;
      }
      candidates.push({
        sessionKey,
        storePath: target.storePath,
        ageMs,
        hadAcpMeta: false,
        transcriptExists,
        transcriptBytes,
      });
    }
  }
  return candidates;
}

/**
 * Run a single orphan sweep: find candidates and delete them via the gateway.
 * Logs each step to state/acp-diag.log for observability.
 */
export async function runAcpOrphanSweep(params: {
  cfg: OpenClawConfig;
  now?: number;
  minAgeMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Test hook: override the gateway delete call. */
  deleteFn?: (sessionKey: string) => Promise<{ deleted?: boolean } | undefined>;
}): Promise<AcpOrphanSweepResult> {
  const result: AcpOrphanSweepResult = {
    scanned: 0,
    candidates: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
  };

  let candidates: AcpOrphanCandidate[];
  try {
    candidates = await findAcpOrphanCandidates({
      cfg: params.cfg,
      now: params.now,
      minAgeMs: params.minAgeMs,
      env: params.env,
    });
  } catch (err) {
    acpDiag(`ACP_ORPHAN_SWEEP_SCAN_FAIL error=${String(err)}`);
    return result;
  }

  result.candidates = candidates.length;
  if (candidates.length === 0) {
    return result;
  }
  acpDiag(`ACP_ORPHAN_SWEEP_START candidates=${candidates.length}`);

  const doDelete =
    params.deleteFn ??
    (async (sessionKey: string) =>
      (await callGateway({
        method: "sessions.delete",
        params: {
          key: sessionKey,
          deleteTranscript: true,
          emitLifecycleHooks: false,
        },
        timeoutMs: ORPHAN_DELETE_TIMEOUT_MS,
      })) as { deleted?: boolean } | undefined);

  for (const candidate of candidates) {
    result.scanned += 1;
    try {
      const response = await doDelete(candidate.sessionKey);
      const deleted = response?.deleted === true;
      if (deleted) {
        result.deleted += 1;
        acpDiag(
          `ACP_ORPHAN_SWEEP_DELETED session=${candidate.sessionKey} ageMs=${Math.round(candidate.ageMs)} transcript=${candidate.transcriptExists ? candidate.transcriptBytes : "missing"}`,
        );
      } else {
        result.skipped += 1;
        acpDiag(`ACP_ORPHAN_SWEEP_NOOP session=${candidate.sessionKey}`);
      }
    } catch (err) {
      result.failed += 1;
      acpDiag(`ACP_ORPHAN_SWEEP_FAIL session=${candidate.sessionKey} error=${String(err)}`);
    }
  }
  acpDiag(
    `ACP_ORPHAN_SWEEP_DONE candidates=${result.candidates} deleted=${result.deleted} failed=${result.failed} skipped=${result.skipped}`,
  );
  return result;
}

/**
 * Schedule the orphan sweep on a recurring timer.  Returns a stop function
 * that cancels the timer.
 */
export function scheduleAcpOrphanSweeper(params: {
  cfg: OpenClawConfig;
  intervalMs?: number;
  /** When true, runs an immediate sweep before scheduling the next tick. */
  runImmediately?: boolean;
}): () => void {
  const interval = Math.max(60_000, params.intervalMs ?? SWEEP_INTERVAL_MS);
  let stopped = false;

  const runOne = async () => {
    if (stopped) return;
    try {
      await runAcpOrphanSweep({ cfg: params.cfg });
    } catch (err) {
      acpDiag(`ACP_ORPHAN_SWEEP_TICK_FAIL error=${String(err)}`);
    }
  };

  if (params.runImmediately) {
    void runOne();
  }

  const timer = setInterval(() => {
    void runOne();
  }, interval);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// Sole exported constants reused by tests and CLI tooling.
export const ACP_ORPHAN_SWEEPER_CONSTANTS = {
  ORPHAN_MIN_AGE_MS,
  SWEEP_INTERVAL_MS,
  ORPHAN_DELETE_TIMEOUT_MS,
} as const;
