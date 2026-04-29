/**
 * frankclaw: ACP diagnostic logging with self-cleaning rotation.
 *
 * Isolated module to survive upstream merges. Logs ACP turn lifecycle events
 * to state/acp-diag.log for the check-acp-bootstrap.py detector.
 *
 * Usage from manager.turn-stream.ts and manager.core.ts:
 *   import { acpDiag } from "./acp-diag.frankclaw.js";
 *   acpDiag("TURN_START session=... req=... mode=...");
 */
import { appendFileSync, mkdirSync, statSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";

const ACP_DIAG_LOG = join(resolveStateDir(process.env), "acp-diag.log");
const ACP_DIAG_MAX_BYTES = 2 * 1024 * 1024; // 2MB max

export function acpDiag(msg: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    mkdirSync(dirname(ACP_DIAG_LOG), { recursive: true });
    try {
      const st = statSync(ACP_DIAG_LOG);
      if (st.size > ACP_DIAG_MAX_BYTES) {
        try {
          unlinkSync(ACP_DIAG_LOG + ".old");
        } catch {
          // .old may not exist
        }
        renameSync(ACP_DIAG_LOG, ACP_DIAG_LOG + ".old");
      }
    } catch {
      // file may not exist yet
    }
    appendFileSync(ACP_DIAG_LOG, line);
  } catch {
    // never crash the gateway for logging
  }
}
