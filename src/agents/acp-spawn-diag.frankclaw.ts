import { acpDiag } from "../acp/control-plane/acp-diag.frankclaw.js";
/**
 * frankclaw: ACP spawn-stage diagnostic logging + orphan-session safety net.
 *
 * Two responsibilities, kept together so a single import line in upstream
 * acp-spawn.ts threads both spawn-stage observability and the safety-net
 * cleanup that closes the "patch succeeded server-side after client timeout"
 * race window.
 *
 * Observability: emits ACP_SPAWN_* lines into state/acp-diag.log so the
 * existing detector and human investigators can see exactly which spawn stage
 * a flow died in.  The detector parses TURN_THROW lines today and is unchanged
 * by this addition.
 *
 * Safety net: when the spawn flow falls into a catch block, the upstream
 * cleanupFailedAcpSpawn only attempts sessions.delete if the local
 * `sessionCreated` flag is true.  That flag is set only AFTER
 * `callGateway({ method: "sessions.patch" })` returns, so a 10s client-side
 * timeout that fires while the gateway has already persisted the patch leaves
 * an orphaned ACP-keyed registry entry (no acp meta, no transcript).  This
 * helper unconditionally re-issues sessions.delete with a longer timeout to
 * close that race.  sessions.delete is idempotent (returns deleted:false when
 * the key is unknown), so calling it again after a successful upstream
 * cleanup is harmless.
 */
import { callGateway } from "../gateway/call.js";

const SAFETY_NET_TIMEOUT_MS = 30_000;

export type AcpSpawnStage =
  | "ENTER"
  | "PATCH_START"
  | "PATCH_OK"
  | "INIT_START"
  | "INIT_OK"
  | "BIND_START"
  | "BIND_OK"
  | "MARKER_OK"
  | "DISPATCH_START"
  | "DISPATCH_OK"
  | "ACCEPTED"
  | "CATCH_PRECREATE"
  | "CATCH_INIT"
  | "CATCH_DISPATCH"
  | "SAFETY_NET_DELETE"
  | "SAFETY_NET_DELETE_OK"
  | "SAFETY_NET_DELETE_FAIL";

export function acpSpawnDiag(
  stage: AcpSpawnStage,
  sessionKey: string,
  extra: Record<string, string | number | boolean | undefined> = {},
): void {
  const parts = [`ACP_SPAWN_${stage}`, `session=${sessionKey || "<unset>"}`];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) {
      continue;
    }
    parts.push(`${key}=${String(value)}`);
  }
  acpDiag(parts.join(" "));
}

/**
 * Unconditional safety-net delete used after an ACP spawn fails.  Closes the
 * race where sessions.patch completed server-side after the client timed out
 * (cleanupFailedAcpSpawn would otherwise skip the delete because its
 * shouldDeleteSession flag mirrors a client-only optimistic flag).
 *
 * Always best-effort: returns void, never throws.  Logs both success and
 * failure to state/acp-diag.log so detectors and investigators can see what
 * happened.
 */
export async function forceDeleteOrphanAcpSession(params: {
  sessionKey: string;
  reason: string;
  errorSummary?: string;
}): Promise<void> {
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  acpSpawnDiag("SAFETY_NET_DELETE", sessionKey, {
    reason: params.reason,
    error: params.errorSummary,
  });
  try {
    const response = (await callGateway({
      method: "sessions.delete",
      params: {
        key: sessionKey,
        deleteTranscript: true,
        emitLifecycleHooks: false,
      },
      timeoutMs: SAFETY_NET_TIMEOUT_MS,
    })) as { deleted?: boolean } | undefined;
    acpSpawnDiag("SAFETY_NET_DELETE_OK", sessionKey, {
      reason: params.reason,
      deleted: response?.deleted ?? "unknown",
    });
  } catch (err) {
    acpSpawnDiag("SAFETY_NET_DELETE_FAIL", sessionKey, {
      reason: params.reason,
      error: String(err),
    });
  }
}
