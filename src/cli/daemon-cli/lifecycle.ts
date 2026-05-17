import { isRestartEnabled } from "../../config/commands.flags.js";
import { readBestEffortConfig, resolveGatewayPort } from "../../config/config.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { callGatewayCli } from "../../gateway/call.js";
import { probeGateway } from "../../gateway/probe.js";
import {
  findVerifiedGatewayListenerPidsOnPortSync,
  formatGatewayPidList,
  signalVerifiedGatewayPidSync,
} from "../../infra/gateway-processes.js";
import type { SafeGatewayRestartRequestResult } from "../../infra/restart-coordinator.js";
import { type GatewayRestartIntent, writeGatewayRestartIntentSync } from "../../infra/restart.js";
import { defaultRuntime } from "../../runtime.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { theme } from "../../terminal/theme.js";
import { formatCliCommand } from "../command-format.js";
import { parseDurationMs } from "../parse-duration.js";
import { recoverInstalledLaunchAgent } from "./launchd-recovery.js";
import {
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
} from "./lifecycle-core.js";
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
  type GatewayRestartSnapshot,
  renderGatewayPortHealthDiagnostics,
  renderRestartDiagnostics,
  terminateStaleGatewayPids,
  waitForGatewayHealthyListener,
  waitForGatewayHealthyRestart,
} from "./restart-health.js";
import {
  validateReasonFile,
  clearReasonFile,
  getReasonFilePath,
  runSelfHeal,
} from "./restart-selfheal.frankclaw.js";
import { parsePortFromArgs, renderGatewayServiceStartHints } from "./shared.js";
import { repairLoadedGatewayServiceForStart } from "./start-repair.js";
import type { DaemonLifecycleOptions } from "./types.js";

const POST_RESTART_HEALTH_ATTEMPTS = DEFAULT_RESTART_HEALTH_ATTEMPTS;
const POST_RESTART_HEALTH_DELAY_MS = DEFAULT_RESTART_HEALTH_DELAY_MS;
const WINDOWS_POST_RESTART_HEALTH_TIMEOUT_MS = 180_000;

function postRestartHealthAttempts(): number {
  return process.platform === "win32"
    ? Math.ceil(WINDOWS_POST_RESTART_HEALTH_TIMEOUT_MS / POST_RESTART_HEALTH_DELAY_MS)
    : POST_RESTART_HEALTH_ATTEMPTS;
}

function formatRestartFailure(params: {
  health: GatewayRestartSnapshot;
  port: number;
  timeoutSeconds: number;
}): { statusLine: string; failMessage: string } {
  if (params.health.waitOutcome === "stopped-free") {
    const elapsedSeconds = Math.max(1, Math.round((params.health.elapsedMs ?? 0) / 1000));
    return {
      statusLine: `Gateway restart failed after ${elapsedSeconds}s: service stayed stopped and port ${params.port} stayed free.`,
      failMessage: `Gateway restart failed after ${elapsedSeconds}s: service stayed stopped and health checks never came up.`,
    };
  }

  return {
    statusLine: `Timed out after ${params.timeoutSeconds}s waiting for gateway port ${params.port} to become healthy.`,
    failMessage: `Gateway restart timed out after ${params.timeoutSeconds}s waiting for health checks.`,
  };
}

async function resolveGatewayLifecyclePort(service = resolveGatewayService()) {
  const command = await service.readCommand(process.env).catch(() => null);
  const serviceEnv = command?.environment ?? undefined;
  const mergedEnv = {
    ...(process.env as Record<string, string | undefined>),
    ...(serviceEnv ?? undefined),
  } as NodeJS.ProcessEnv;

  const portFromArgs = parsePortFromArgs(command?.programArguments);
  return portFromArgs ?? resolveGatewayPort(await readBestEffortConfig(), mergedEnv);
}

function resolveGatewayPortFallback(): Promise<number> {
  return readBestEffortConfig()
    .then((cfg) => resolveGatewayPort(cfg, process.env))
    .catch(() => resolveGatewayPort(undefined, process.env));
}

async function assertUnmanagedGatewayRestartEnabled(port: number): Promise<void> {
  const cfg = await readBestEffortConfig().catch(() => undefined);
  const tlsEnabled = !!cfg?.gateway?.tls?.enabled;
  const scheme = tlsEnabled ? "wss" : "ws";
  const probe = await probeGateway({
    url: `${scheme}://127.0.0.1:${port}`,
    auth: {
      token: normalizeOptionalString(process.env.OPENCLAW_GATEWAY_TOKEN),
      password: normalizeOptionalString(process.env.OPENCLAW_GATEWAY_PASSWORD),
    },
    timeoutMs: 1_000,
  }).catch(() => null);

  if (!probe?.ok) {
    return;
  }
  if (!isRestartEnabled(probe.configSnapshot as { commands?: unknown } | undefined)) {
    throw new Error(
      "Gateway restart is disabled in the running gateway config (commands.restart=false); unmanaged SIGUSR1 restart would be ignored",
    );
  }
}

function resolveVerifiedGatewayListenerPids(port: number): number[] {
  return findVerifiedGatewayListenerPidsOnPortSync(port).filter(
    (pid): pid is number => Number.isFinite(pid) && pid > 0,
  );
}

async function stopGatewayWithoutServiceManager(port: number) {
  const pids = resolveVerifiedGatewayListenerPids(port);
  if (pids.length === 0) {
    return null;
  }
  for (const pid of pids) {
    signalVerifiedGatewayPidSync(pid, "SIGTERM");
  }
  return {
    result: "stopped" as const,
    message: `Gateway stop signal sent to unmanaged process${pids.length === 1 ? "" : "es"} on port ${port}: ${formatGatewayPidList(pids)}.`,
  };
}

function resolveGatewayRestartIntentOptions(
  opts: DaemonLifecycleOptions,
): GatewayRestartIntent | undefined {
  if (opts.force && opts.wait !== undefined) {
    throw new Error("--force cannot be combined with --wait");
  }
  if (opts.force) {
    return { force: true };
  }
  if (opts.wait !== undefined) {
    return { waitMs: parseDurationMs(opts.wait) };
  }
  return undefined;
}

function formatSafeRestartWarnings(result: SafeGatewayRestartRequestResult): string[] | undefined {
  if (result.preflight.blockers.length === 0) {
    return undefined;
  }
  return [result.preflight.summary];
}

async function requestSafeGatewayRestart(opts: DaemonLifecycleOptions): Promise<boolean> {
  if (opts.force) {
    throw new Error("--safe cannot be combined with --force; omit --safe to force restart now");
  }
  if (opts.wait !== undefined) {
    throw new Error("--safe cannot be combined with --wait; safe restart uses gateway deferral");
  }
  const skipDeferral = opts.skipDeferral === true;
  const params: { reason: string; skipDeferral?: true } = { reason: "gateway.restart.safe" };
  if (skipDeferral) {
    params.skipDeferral = true;
  }
  const result = await callGatewayCli<SafeGatewayRestartRequestResult>({
    method: "gateway.restart.request",
    params,
    timeoutMs: 10_000,
  });
  const message =
    result.status === "coalesced"
      ? "safe restart request joined an existing pending gateway restart"
      : result.status === "deferred"
        ? "safe restart requested; gateway will restart after active work drains"
        : skipDeferral
          ? "safe restart requested; gateway bypassing active-work deferral"
          : "safe restart requested; gateway will restart momentarily";
  const payload = {
    ok: true,
    result: result.status,
    message,
    preflight: result.preflight,
    restart: result.restart,
    warnings: formatSafeRestartWarnings(result),
  };
  if (opts.json) {
    defaultRuntime.log(JSON.stringify(payload, null, 2));
  } else {
    defaultRuntime.log(message);
    if (result.preflight.blockers.length > 0) {
      defaultRuntime.log(theme.warn(result.preflight.summary));
    }
  }
  return true;
}

async function restartGatewayWithoutServiceManager(
  port: number,
  restartIntent?: GatewayRestartIntent,
) {
  await assertUnmanagedGatewayRestartEnabled(port);
  const pids = resolveVerifiedGatewayListenerPids(port);
  if (pids.length === 0) {
    return null;
  }
  if (pids.length > 1) {
    throw new Error(
      `multiple gateway processes are listening on port ${port}: ${formatGatewayPidList(pids)}; use "openclaw gateway status --deep" before retrying restart`,
    );
  }
  writeGatewayRestartIntentSync({
    targetPid: pids[0],
    reason: "gateway.restart",
    ...(restartIntent ? { intent: restartIntent } : {}),
  });
  signalVerifiedGatewayPidSync(pids[0], "SIGUSR1");
  return {
    result: "restarted" as const,
    message: `Gateway restart signal sent to unmanaged process on port ${port}: ${pids[0]}.`,
  };
}

export async function runDaemonUninstall(opts: DaemonLifecycleOptions = {}) {
  return await runServiceUninstall({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
    stopBeforeUninstall: true,
    assertNotLoadedAfterUninstall: true,
  });
}

export async function runDaemonStart(opts: DaemonLifecycleOptions = {}) {
  const service = resolveGatewayService();
  return await runServiceStart({
    serviceNoun: "Gateway",
    service,
    renderStartHints: renderGatewayServiceStartHints,
    onNotLoaded:
      process.platform === "darwin"
        ? async () => await recoverInstalledLaunchAgent({ result: "started" })
        : undefined,
    repairLoadedService: async ({ json, stdout, state, issues }) =>
      await repairLoadedGatewayServiceForStart({
        service,
        json,
        stdout,
        state,
        issues,
      }),
    opts,
  });
}

export async function runDaemonStop(opts: DaemonLifecycleOptions = {}) {
  const service = resolveGatewayService();
  let gatewayPortPromise: Promise<number> | undefined;
  return await runServiceStop({
    serviceNoun: "Gateway",
    service,
    opts,
    stopWhenNotLoaded: process.platform === "darwin" && Boolean(opts.disable),
    onNotLoaded: async () => {
      gatewayPortPromise ??= resolveGatewayLifecyclePort(service).catch(() =>
        resolveGatewayPortFallback(),
      );
      return await stopGatewayWithoutServiceManager(await gatewayPortPromise);
    },
  });
}

/**
 * Restart the gateway service service.
 * @returns `true` if restart succeeded, `false` if the service was not loaded.
 * Throws/exits on check or restart failures.
 */
export async function runDaemonRestart(opts: DaemonLifecycleOptions = {}): Promise<boolean> {
  if (opts.skipDeferral && !opts.safe) {
    throw new Error("--skip-deferral requires --safe");
  }
  if (opts.safe) {
    return await requestSafeGatewayRestart(opts);
  }
  const json = Boolean(opts.json);

  // --- frankclaw: validate reason file ---
  const reasonFilePath = opts.reason ?? getReasonFilePath();
  let reasonContent: string;
  try {
    reasonContent = validateReasonFile(reasonFilePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!json) {
      defaultRuntime.log(theme.error(message));
    } else {
      defaultRuntime.log(JSON.stringify({ error: message }));
    }
    process.exit(2);
  }

  if (!json) {
    defaultRuntime.log(theme.muted(`Restart reason loaded from: ${reasonFilePath}`));
  }
  // --- end frankclaw reason validation ---

  const service = resolveGatewayService();
  let restartedWithoutServiceManager = false;
  const restartIntent = resolveGatewayRestartIntentOptions(opts);
  const restartPort = await resolveGatewayLifecyclePort(service).catch(() =>
    resolveGatewayPortFallback(),
  );
  const restartHealthAttempts = postRestartHealthAttempts();
  const restartWaitMs = restartHealthAttempts * POST_RESTART_HEALTH_DELAY_MS;
  const restartWaitSeconds = Math.round(restartWaitMs / 1000);

  return await runServiceRestart({
    serviceNoun: "Gateway",
    service,
    renderStartHints: renderGatewayServiceStartHints,
    opts: {
      ...opts,
      ...(restartIntent ? { restartIntent } : {}),
    },
    checkTokenDrift: true,
    onNotLoaded: async () => {
      if (process.platform === "darwin") {
        const recovered = await recoverInstalledLaunchAgent({ result: "restarted" });
        if (recovered) {
          return recovered;
        }
      }
      const handled = await restartGatewayWithoutServiceManager(restartPort, restartIntent);
      if (handled) {
        restartedWithoutServiceManager = true;
        return handled;
      }
      return null;
    },
    postRestartCheck: async ({ warnings, fail, stdout }) => {
      if (restartedWithoutServiceManager) {
        const health = await waitForGatewayHealthyListener({
          port: restartPort,
          attempts: restartHealthAttempts,
          delayMs: POST_RESTART_HEALTH_DELAY_MS,
        });
        if (health.healthy) {
          // --- frankclaw: clear reason file on success ---
          clearReasonFile();
          return undefined;
        }

        const diagnostics = renderGatewayPortHealthDiagnostics(health);
        const timeoutLine = `Timed out after ${restartWaitSeconds}s waiting for gateway port ${restartPort} to become healthy.`;
        if (!json) {
          defaultRuntime.log(theme.warn(timeoutLine));
          for (const line of diagnostics) {
            defaultRuntime.log(theme.muted(line));
          }
        } else {
          warnings.push(timeoutLine);
          warnings.push(...diagnostics);
        }

        fail(`Gateway restart timed out after ${restartWaitSeconds}s waiting for health checks.`, [
          formatCliCommand("openclaw gateway status --deep"),
          formatCliCommand("openclaw doctor"),
        ]);
        throw new Error("unreachable after gateway restart health failure");
      }

      let health = await waitForGatewayHealthyRestart({
        service,
        port: restartPort,
        attempts: restartHealthAttempts,
        delayMs: POST_RESTART_HEALTH_DELAY_MS,
        includeUnknownListenersAsStale: process.platform === "win32",
      });

      if (!health.healthy && health.staleGatewayPids.length > 0) {
        const staleMsg = `Found stale gateway process(es): ${health.staleGatewayPids.join(", ")}.`;
        warnings.push(staleMsg);
        if (!json) {
          defaultRuntime.log(theme.warn(staleMsg));
          defaultRuntime.log(theme.muted("Stopping stale process(es) and retrying restart..."));
        }

        await terminateStaleGatewayPids(health.staleGatewayPids);
        const retryRestart = await service.restart({ env: process.env, stdout });
        if (retryRestart.outcome === "scheduled") {
          return retryRestart;
        }
        health = await waitForGatewayHealthyRestart({
          service,
          port: restartPort,
          attempts: restartHealthAttempts,
          delayMs: POST_RESTART_HEALTH_DELAY_MS,
          includeUnknownListenersAsStale: process.platform === "win32",
        });
      }

      if (health.healthy) {
        // --- frankclaw: clear reason file on success ---
        clearReasonFile();
        return undefined;
      }

      const diagnostics = renderRestartDiagnostics(health);
      const failure = formatRestartFailure({
        health,
        port: restartPort,
        timeoutSeconds: restartWaitSeconds,
      });
      const runningNoPortLine =
        health.runtime.status === "running" && health.portUsage.status === "free"
          ? `Gateway process is running but port ${restartPort} is still free (startup hang/crash loop or very slow VM startup).`
          : null;
      if (!json) {
        defaultRuntime.log(theme.warn(failure.statusLine));
        if (runningNoPortLine) {
          defaultRuntime.log(theme.warn(runningNoPortLine));
        }
        for (const line of diagnostics) {
          defaultRuntime.log(theme.muted(line));
        }
      } else {
        warnings.push(failure.statusLine);
        if (runningNoPortLine) {
          warnings.push(runningNoPortLine);
        }
        warnings.push(...diagnostics);
      }

      // --- frankclaw: self-heal on failure ---
      if (!json) {
        defaultRuntime.log(theme.warn("Launching self-heal agent..."));
      }
      const healed = await runSelfHeal(reasonContent);
      if (healed) {
        if (!json) {
          defaultRuntime.log(theme.success("Self-heal agent reports success. Verifying..."));
        }
        // Re-check health after self-heal
        const postHealHealth = await waitForGatewayHealthyRestart({
          service,
          port: restartPort,
          attempts: POST_RESTART_HEALTH_ATTEMPTS,
          delayMs: POST_RESTART_HEALTH_DELAY_MS,
          includeUnknownListenersAsStale: process.platform === "win32",
        });
        if (postHealHealth.healthy) {
          clearReasonFile();
          if (!json) {
            defaultRuntime.log(theme.success("✅ Gateway recovered via self-heal."));
          }
          return undefined;
        }
      }
      // --- end frankclaw self-heal ---

      fail(`Gateway restart failed. Self-heal attempted but gateway is still unhealthy.`, [
        formatCliCommand("openclaw gateway status --deep"),
        formatCliCommand("openclaw doctor"),
        `Check self-heal log: cat /tmp/gateway-selfheal.log`,
      ]);
      throw new Error("unreachable after gateway restart failure");
    },
  });
}
