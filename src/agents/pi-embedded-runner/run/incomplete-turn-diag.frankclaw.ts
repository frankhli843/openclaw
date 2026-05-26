// frankclaw: Structured diagnostic logging for incomplete-turn events.
// When the embedded Codex harness drain timer fires after a tool result
// with no model continuation, the runner detects stopReason=undefined /
// payloads=0 and surfaces "Agent couldn't generate a response" to the user.
// This module writes a structured one-line entry to state/frankclaw-diag.log
// so operators can trace frequency, session, and tool context without needing
// a gateway restart or inline log grep.
//
// Pattern: fire-and-forget, never throws, rotates at 2MB.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIAG_LOG = path.join(
  fileURLToPath(new URL("../../../../../../..", import.meta.url)),
  "state/frankclaw-diag.log",
);
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB

export interface IncompleteTurnDiagParams {
  sessionId: string;
  runId: string;
  stopReason: string | undefined;
  payloadCount: number;
  hadPotentialSideEffects: boolean;
  lastToolName?: string | undefined;
  lastToolError?: string | null | undefined;
}

/** Write a structured INCOMPLETE_TURN entry to frankclaw-diag.log. Fire-and-forget. */
export function logIncompleteTurnDiag(params: IncompleteTurnDiagParams): void {
  void writeIncompleteTurnDiag(params).catch(() => undefined);
}

async function writeIncompleteTurnDiag(params: IncompleteTurnDiagParams): Promise<void> {
  const parts: string[] = [
    `[${new Date().toISOString()}]`,
    "INCOMPLETE_TURN",
    `sessionId=${params.sessionId}`,
    `runId=${params.runId}`,
    `stopReason=${params.stopReason ?? "undefined"}`,
    `payloads=${params.payloadCount}`,
    `hadSideEffects=${params.hadPotentialSideEffects}`,
  ];
  if (params.lastToolName) {
    parts.push(`lastTool=${params.lastToolName}`);
  }
  if (params.lastToolError) {
    parts.push(`lastToolError=${params.lastToolError.slice(0, 120).replace(/\n/g, " ")}`);
  }
  const entry = parts.join(" ") + "\n";

  try {
    const stat = await fs.stat(DIAG_LOG).catch(() => null);
    if (stat && stat.size >= MAX_LOG_BYTES) {
      await fs.rename(DIAG_LOG, DIAG_LOG + ".old").catch(() => undefined);
    }
    await fs.appendFile(DIAG_LOG, entry, "utf8");
  } catch {
    // Never throw from a diagnostic path.
  }
}
