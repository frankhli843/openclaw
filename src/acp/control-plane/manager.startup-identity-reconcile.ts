import {
  identityHasStableSessionId,
  isSessionIdentityPending,
  resolveSessionIdentityFromMeta,
} from "@openclaw/acp-core/runtime/session-identity";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { logVerbose } from "../../globals.js";
import type {
  AcpSessionManagerDeps,
  AcpStartupIdentityReconcileResult,
  EnsureManagerRuntimeHandle,
  ReconcileManagerRuntimeSessionIdentifiers,
  ResolveManagerSession,
  WithManagerSessionActor,
} from "./manager.types.js";

/** Resolves pending ACP session identities opportunistically during manager startup. */
export async function runManagerStartupIdentityReconcile(params: {
  cfg: OpenClawConfig;
  deps: Pick<AcpSessionManagerDeps, "listAcpSessions" | "requireRuntimeBackend">;
  withSessionActor: WithManagerSessionActor;
  resolveSession: ResolveManagerSession;
  ensureRuntimeHandle: EnsureManagerRuntimeHandle;
  reconcileRuntimeSessionIdentifiers: ReconcileManagerRuntimeSessionIdentifiers;
}): Promise<AcpStartupIdentityReconcileResult> {
  let checked = 0;
  let resolved = 0;
  let failed = 0;

  let acpSessions: Awaited<ReturnType<AcpSessionManagerDeps["listAcpSessions"]>>;
  try {
    acpSessions = await params.deps.listAcpSessions({
      cfg: params.cfg,
    });
  } catch (error) {
    logVerbose(`acp-manager: startup identity scan failed: ${String(error)}`);
    return { checked, resolved, failed: failed + 1 };
  }

  // frankclaw: wait for ACP runtime backend to become healthy before iterating.
  // The ACPX plugin registers its backend during startup with healthy=false, then
  // probeAvailability() sets healthy=true asynchronously. Without this wait, all
  // sessions fail with ACP_BACKEND_UNAVAILABLE because the probe hasn't completed yet.
  const BACKEND_WAIT_TIMEOUT_MS = 30_000;
  const BACKEND_POLL_INTERVAL_MS = 500;
  const isBackendReady = () => {
    try {
      params.deps.requireRuntimeBackend(params.cfg.acp?.backend);
      return true;
    } catch {
      return false;
    }
  };
  const waitStart = Date.now();
  while (!isBackendReady() && Date.now() - waitStart < BACKEND_WAIT_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, BACKEND_POLL_INTERVAL_MS));
  }
  if (!isBackendReady()) {
    logVerbose(
      `acp-manager: startup identity reconcile skipped — no healthy ACP runtime backend after ${BACKEND_WAIT_TIMEOUT_MS}ms`,
    );
    return { checked: 0, resolved: 0, failed: 0 };
  }

  for (const session of acpSessions) {
    if (!session.acp || !session.sessionKey) {
      continue;
    }
    const currentIdentity = resolveSessionIdentityFromMeta(session.acp);
    if (
      !isSessionIdentityPending(currentIdentity) ||
      !identityHasStableSessionId(currentIdentity)
    ) {
      continue;
    }

    checked += 1;
    try {
      const becameResolved = await params.withSessionActor(session.sessionKey, async () => {
        const resolution = params.resolveSession({
          cfg: params.cfg,
          sessionKey: session.sessionKey,
        });
        if (resolution.kind !== "ready") {
          return false;
        }
        const { runtime, handle, meta } = await params.ensureRuntimeHandle({
          cfg: params.cfg,
          sessionKey: session.sessionKey,
          meta: resolution.meta,
        });
        const reconciled = await params.reconcileRuntimeSessionIdentifiers({
          cfg: params.cfg,
          sessionKey: session.sessionKey,
          runtime,
          handle,
          meta,
          failOnStatusError: false,
        });
        return !isSessionIdentityPending(resolveSessionIdentityFromMeta(reconciled.meta));
      });
      if (becameResolved) {
        resolved += 1;
      }
    } catch (error) {
      failed += 1;
      logVerbose(
        `acp-manager: startup identity reconcile failed for ${session.sessionKey}: ${String(error)}`,
      );
    }
  }

  return { checked, resolved, failed };
}
