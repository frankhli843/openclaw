import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isRestartEnabled } from "../../config/commands.js";
import { readBestEffortConfig, resolveGatewayPort } from "../../config/config.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { probeGateway } from "../../gateway/probe.js";
import {
  findVerifiedGatewayListenerPidsOnPortSync,
  formatGatewayPidList,
  signalVerifiedGatewayPidSync,
} from "../../infra/gateway-processes.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { formatCliCommand } from "../command-format.js";
import {
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
} from "./lifecycle-core.js";
import {
  DEFAULT_RESTART_HEALTH_ATTEMPTS,
  DEFAULT_RESTART_HEALTH_DELAY_MS,
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
} from "./restart-selfheal.frankclaw.js";
import { parsePortFromArgs, renderGatewayServiceStartHints } from "./shared.js";
import type { DaemonLifecycleOptions } from "./types.js";

const POST_RESTART_HEALTH_ATTEMPTS = DEFAULT_RESTART_HEALTH_ATTEMPTS;
const POST_RESTART_HEALTH_DELAY_MS = DEFAULT_RESTART_HEALTH_DELAY_MS;

/**
 * Dry-run the self-heal script to validate it's functional before restart.
 * Returns true if the script passes all checks.
 */
function dryRunSelfHealScript(reasonFilePath: string, json: boolean): boolean {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ?? resolve(process.env.HOME ?? "/root", ".openclaw/workspace");
  const script = resolve(workspace, "scripts/gateway-selfheal.sh");

  if (!existsSync(script)) {
    if (!json) {
      defaultRuntime.log(theme.warn(`Self-heal script not found: ${script}`));
    }
    return false;
  }

  try {
    const output = execSync(`bash "${script}" --dry-run --reason-file "${reasonFilePath}"`, {
      timeout: 150_000,
      stdio: "pipe",
      env: { ...process.env },
    }).toString();
    if (!json) {
      defaultRuntime.log(theme.muted(output.trim()));
    }
    return true;
  } catch (err: unknown) {
    if (!json) {
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? ((err as { stderr: Buffer }).stderr?.toString?.() ?? "")
          : "";
      const stdout =
        err && typeof err === "object" && "stdout" in err
          ? ((err as { stdout: Buffer }).stdout?.toString?.() ?? "")
          : "";
      defaultRuntime.log(theme.error(`Self-heal dry-run failed:\n${stdout}\n${stderr}`));
    }
    return false;
  }
}

/**
 * Schedule the standalone self-heal bash script via `at`.
 * Runs 2 minutes after restart, completely outside the gateway process.
 * The script checks health and only triggers repair if gateway is down.
 */
function scheduleSelfHealCheck(reasonFilePath: string, json: boolean): void {
  const workspace =
    process.env.OPENCLAW_WORKSPACE ?? resolve(process.env.HOME ?? "/root", ".openclaw/workspace");
  const script = resolve(workspace, "scripts/gateway-selfheal.sh");
  const log = resolve("/tmp", "gateway-selfheal.log");

  if (!existsSync(script)) {
    if (!json) {
      defaultRuntime.log(
        theme.warn(`Self-heal script not found: ${script}. Skipping self-heal scheduling.`),
      );
    }
    return;
  }

  try {
    execSync(
      `echo 'bash "${script}" --reason-file "${reasonFilePath}" >> "${log}" 2>&1' | at now + 2 minutes`,
      { stdio: "pipe", timeout: 10_000 },
    );
    if (!json) {
      defaultRuntime.log(
        theme.muted("Self-heal check scheduled via `at` (runs in 2 min if needed)"),
      );
    }
  } catch (err: unknown) {
    // `at` not available — warn but don't block restart
    if (!json) {
      const msg = err instanceof Error ? err.message : String(err);
      defaultRuntime.log(theme.warn(`Could not schedule self-heal via at: ${msg}`));
    }
  }
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
  const probe = await probeGateway({
    url: `ws://127.0.0.1:${port}`,
    auth: {
      token: process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || undefined,
      password: process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() || undefined,
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

async function restartGatewayWithoutServiceManager(port: number) {
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
  return await runServiceStart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
  });
}

export async function runDaemonStop(opts: DaemonLifecycleOptions = {}) {
  const service = resolveGatewayService();
  const gatewayPort = await resolveGatewayLifecyclePort(service).catch(() =>
    resolveGatewayPortFallback(),
  );
  return await runServiceStop({
    serviceNoun: "Gateway",
    service,
    opts,
    onNotLoaded: async () => stopGatewayWithoutServiceManager(gatewayPort),
  });
}

/**
 * Restart the gateway service service.
 * @returns `true` if restart succeeded, `false` if the service was not loaded.
 * Throws/exits on check or restart failures.
 *
 * frankclaw: requires --reason <file> for self-heal context.
 * If health check fails after restart, spawns Claude Code (Gemini backup) to fix.
 */
export async function runDaemonRestart(opts: DaemonLifecycleOptions = {}): Promise<boolean> {
  const json = Boolean(opts.json);

  // --- frankclaw: validate reason file ---
  const reasonFilePath = opts.reason ?? getReasonFilePath();
  try {
    validateReasonFile(reasonFilePath);
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

  // Dry-run the self-heal script to validate it works BEFORE restarting.
  // If it fails, abort restart and ask the agent to fix the script first.
  const dryRunOk = dryRunSelfHealScript(reasonFilePath, json);
  if (!dryRunOk) {
    if (!json) {
      defaultRuntime.log(
        theme.error(
          "Self-heal script dry-run failed. Fix the script before restarting.\n" +
            "Script: scripts/gateway-selfheal.sh\n" +
            "Run: bash scripts/gateway-selfheal.sh --dry-run --reason-file state/restart-reason.md",
        ),
      );
    } else {
      defaultRuntime.log(JSON.stringify({ error: "Self-heal script dry-run failed" }));
    }
    process.exit(2);
  }

  // Schedule standalone self-heal script via `at` BEFORE restart.
  // This ensures the self-heal runs even if the binary itself is broken
  // after restart. The script checks health independently and only
  // triggers repair if the gateway is actually down.
  scheduleSelfHealCheck(reasonFilePath, json);
  // --- end frankclaw reason validation + self-heal scheduling ---

  const service = resolveGatewayService();
  let restartedWithoutServiceManager = false;
  const restartPort = await resolveGatewayLifecyclePort(service).catch(() =>
    resolveGatewayPortFallback(),
  );
  const restartWaitMs = POST_RESTART_HEALTH_ATTEMPTS * POST_RESTART_HEALTH_DELAY_MS;
  const restartWaitSeconds = Math.round(restartWaitMs / 1000);

  return await runServiceRestart({
    serviceNoun: "Gateway",
    service,
    renderStartHints: renderGatewayServiceStartHints,
    opts,
    checkTokenDrift: true,
    onNotLoaded: async () => {
      const handled = await restartGatewayWithoutServiceManager(restartPort);
      if (handled) {
        restartedWithoutServiceManager = true;
      }
      return handled;
    },
    postRestartCheck: async ({ warnings, fail, stdout }) => {
      if (restartedWithoutServiceManager) {
        const health = await waitForGatewayHealthyListener({
          port: restartPort,
          attempts: POST_RESTART_HEALTH_ATTEMPTS,
          delayMs: POST_RESTART_HEALTH_DELAY_MS,
        });
        if (health.healthy) {
          return;
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
      }

      let health = await waitForGatewayHealthyRestart({
        service,
        port: restartPort,
        attempts: POST_RESTART_HEALTH_ATTEMPTS,
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
          attempts: POST_RESTART_HEALTH_ATTEMPTS,
          delayMs: POST_RESTART_HEALTH_DELAY_MS,
          includeUnknownListenersAsStale: process.platform === "win32",
        });
      }

      if (health.healthy) {
        // --- frankclaw: clear reason file on success ---
        clearReasonFile();
        return;
      }

      const diagnostics = renderRestartDiagnostics(health);
      const timeoutLine = `Timed out after ${restartWaitSeconds}s waiting for gateway port ${restartPort} to become healthy.`;
      const runningNoPortLine =
        health.runtime.status === "running" && health.portUsage.status === "free"
          ? `Gateway process is running but port ${restartPort} is still free (startup hang/crash loop or very slow VM startup).`
          : null;
      if (!json) {
        defaultRuntime.log(theme.warn(timeoutLine));
        if (runningNoPortLine) {
          defaultRuntime.log(theme.warn(runningNoPortLine));
        }
        for (const line of diagnostics) {
          defaultRuntime.log(theme.muted(line));
        }
      } else {
        warnings.push(timeoutLine);
        if (runningNoPortLine) {
          warnings.push(runningNoPortLine);
        }
        warnings.push(...diagnostics);
      }

      // --- frankclaw: self-heal is already scheduled via `at` (pre-restart) ---
      // The standalone bash script will check health independently and
      // spawn Claude Code / Gemini if the gateway doesn't come back.
      if (!json) {
        defaultRuntime.log(
          theme.warn(
            "Self-heal script was pre-scheduled via `at`. It will run shortly and attempt repair.",
          ),
        );
      }
      // --- end frankclaw self-heal ---

      fail(`Gateway restart failed. Self-heal attempted but gateway is still unhealthy.`, [
        formatCliCommand("openclaw gateway status --deep"),
        formatCliCommand("openclaw doctor"),
        `Check self-heal log: cat /tmp/gateway-selfheal.log`,
      ]);
    },
  });
}
