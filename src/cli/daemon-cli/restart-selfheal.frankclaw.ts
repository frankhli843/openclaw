/**
 * restart-selfheal.frankclaw.ts
 *
 * Self-heal logic for gateway restarts. When the gateway fails to come back
 * after restart, spawns Claude Code (Gemini CLI fallback) to diagnose and fix,
 * with notifications to the operator throughout.
 *
 * Notification targets are resolved from environment variables or config:
 *   SELFHEAL_NOTIFY_CHANNEL  - channel name (telegram, discord, etc.)
 *   SELFHEAL_NOTIFY_TARGET   - target id (chat id, channel id, etc.)
 * If not set, falls back to the first configured channel's allowFrom[0].
 *
 * Enforced at code level in `openclaw gateway restart`.
 *
 * Reason file contract:
 *   - Fixed path: <workspace>/state/restart-reason.md
 *   - Must exist and contain a datetime line (ISO 8601 or common formats)
 *   - Datetime must be within the last 30 minutes (freshness check)
 *   - If stale/missing/no datetime → restart aborts with instructions
 *
 * Kept in a single .frankclaw.ts file to minimize upstream merge conflicts.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { theme } from "@openclaw/terminal-core/theme";
import { loadConfig } from "../../config/config.js";
import { defaultRuntime } from "../../runtime.js";

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------

const WORKSPACE =
  process.env.OPENCLAW_WORKSPACE ?? resolve(process.env.HOME ?? "/root", ".openclaw/workspace");
const REASON_FILE = resolve(WORKSPACE, "state/restart-reason.md");
const SELFHEAL_LOG = "/tmp/gateway-selfheal.log";

/** How fresh the datetime in the reason file must be (ms). */
const REASON_FRESHNESS_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Notification target resolution
// ---------------------------------------------------------------------------

interface NotifyTarget {
  channel: string;
  target: string;
}

const CHANNEL_KEYS = [
  "telegram",
  "discord",
  "whatsapp",
  "slack",
  "googlechat",
  "signal",
  "irc",
  "imessage",
] as const;

/**
 * Resolve notification targets. Priority:
 *   1. Environment variables (SELFHEAL_NOTIFY_CHANNEL + SELFHEAL_NOTIFY_TARGET)
 *   2. First configured channel with an allowFrom entry
 *   3. null (notifications disabled — log only)
 *
 * Exported for testing.
 */
export function resolveNotifyTarget(): NotifyTarget | null {
  // 1. Explicit env vars
  const envChannel = process.env.SELFHEAL_NOTIFY_CHANNEL;
  const envTarget = process.env.SELFHEAL_NOTIFY_TARGET;
  if (envChannel && envTarget) {
    return { channel: envChannel, target: envTarget };
  }

  // 2. Auto-detect from config
  try {
    const config = loadConfig();
    const channels = (config as Record<string, unknown>).channels as
      | Record<string, unknown>
      | undefined;
    if (channels) {
      for (const key of CHANNEL_KEYS) {
        const ch = channels[key] as Record<string, unknown> | undefined;
        if (!ch) {
          continue;
        }
        const allowFrom = ch.allowFrom as Array<string | number> | undefined;
        if (allowFrom && allowFrom.length > 0) {
          return { channel: key, target: String(allowFrom[0]) };
        }
      }
    }
  } catch {
    /* config load failure is fine — we're in a degraded state */
  }

  return null;
}

// ---------------------------------------------------------------------------
// Datetime parsing
// ---------------------------------------------------------------------------

/**
 * Common datetime patterns we accept in the reason file.
 * We look for the FIRST match on any line.
 */
const DATETIME_PATTERNS = [
  // ISO 8601: 2026-03-04T10:50:00Z or 2026-03-04T10:50:00-05:00 or 2026-03-04T10:50:00
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.\d]*)?(?:Z|[+-]\d{2}:\d{2})?/,
  // Date + time: 2026-03-04 10:50:00 (with optional timezone abbrev)
  /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?(?:\s+[A-Z]{2,5})?/,
];

/**
 * Extract the first datetime string from the content.
 * Returns the parsed Date or null if no valid datetime found.
 *
 * Exported for testing.
 */
export function extractDatetime(content: string): Date | null {
  for (const line of content.split("\n")) {
    for (const pattern of DATETIME_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const parsed = new Date(match[0]);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reason file validation
// ---------------------------------------------------------------------------

export function getReasonFilePath(): string {
  return REASON_FILE;
}

/**
 * Validate the reason file:
 *   1. File must exist
 *   2. File must not be empty
 *   3. File must contain a parseable datetime
 *   4. Datetime must be within the last 30 minutes
 *
 * Returns the file content on success, throws with instructions on failure.
 *
 * @param reasonPath  Override path (for testing). Defaults to REASON_FILE.
 * @param now         Override current time (for testing). Defaults to Date.now().
 */
export function validateReasonFile(reasonPath?: string, now?: number): string {
  const filePath = reasonPath ?? REASON_FILE;
  const currentMs = now ?? Date.now();

  // 1. Existence
  if (!existsSync(filePath)) {
    throw new ReasonFileError(
      "missing",
      `Restart reason file not found: ${filePath}\n\n` + instructionBlock(filePath),
    );
  }

  // 2. Non-empty
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) {
    throw new ReasonFileError(
      "empty",
      `Restart reason file is empty: ${filePath}\n\n` + instructionBlock(filePath),
    );
  }

  // 3. Datetime present
  const dt = extractDatetime(content);
  if (!dt) {
    throw new ReasonFileError(
      "no_datetime",
      `Restart reason file has no datetime: ${filePath}\n\n` +
        `The file must include a datetime so we know it was freshly written.\n` +
        `Accepted formats: ISO 8601 (2026-03-04T10:50:00Z) or YYYY-MM-DD HH:MM:SS\n\n` +
        instructionBlock(filePath),
    );
  }

  // 4. Freshness (within 30 minutes)
  const ageMs = currentMs - dt.getTime();
  if (ageMs > REASON_FRESHNESS_MS) {
    const ageMin = Math.round(ageMs / 60_000);
    throw new ReasonFileError(
      "stale",
      `Restart reason file is stale (${ageMin} minutes old): ${filePath}\n\n` +
        `The datetime in the file must be within the last 30 minutes.\n` +
        `Please rewrite the file with fresh context and a current datetime.\n\n` +
        instructionBlock(filePath),
    );
  }

  return content;
}

export class ReasonFileError extends Error {
  constructor(
    public readonly code: "missing" | "empty" | "no_datetime" | "stale",
    message: string,
  ) {
    super(message);
    this.name = "ReasonFileError";
  }
}

function instructionBlock(filePath: string): string {
  const now = new Date().toISOString();
  return (
    `Please write your restart context to:\n  ${filePath}\n\n` +
    `The file MUST include:\n` +
    `  1. A datetime (e.g. ${now})\n` +
    `  2. What changes were made recently\n` +
    `  3. Why the restart is needed\n` +
    `  4. Any relevant error messages or context\n\n` +
    `Example:\n` +
    `  datetime: ${now}\n` +
    `  reason: Merged upstream, rebuilt dist with new plugin-sdk bundles\n` +
    `  changes: Updated tsdown.config.ts, ran pnpm tsdown\n\n` +
    `Then run: openclaw gateway restart`
  );
}

/**
 * Clear/reset the reason file after a successful restart.
 */
export function clearReasonFile(): void {
  const dir = dirname(REASON_FILE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(REASON_FILE, "", "utf-8");
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

function logSelfHeal(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    appendFileSync(SELFHEAL_LOG, line);
  } catch {
    /* best effort */
  }
  defaultRuntime.log(theme.muted(`[self-heal] ${msg}`));
}

function sendMessage(channel: "telegram" | "discord", target: string, message: string): boolean {
  try {
    execSync(
      `openclaw message send --channel ${channel} --target "${target}" --message ${JSON.stringify(message)}`,
      { timeout: 30_000, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Cached target — resolved once per process. */
let _notifyTarget: NotifyTarget | null | undefined;

function notifyOperator(message: string) {
  if (_notifyTarget === undefined) {
    _notifyTarget = resolveNotifyTarget();
  }
  if (!_notifyTarget) {
    logSelfHeal(
      `[notify-skip] No notification target configured. Message: ${message.slice(0, 200)}`,
    );
    return;
  }
  sendMessage(_notifyTarget.channel as "telegram" | "discord", _notifyTarget.target, message);
}

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function runAgent(
  command: string,
  args: string[],
  taskPrompt: string,
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  return new Promise((res) => {
    let output = "";
    let settled = false;

    const child = spawn(command, [...args, taskPrompt], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME },
    });

    child.stdout?.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      output += d.toString();
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        res({ success: false, output: output + "\n[TIMEOUT]" });
      }
    }, timeoutMs);

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        res({ success: code === 0, output });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        res({ success: false, output: `spawn error: ${err.message}` });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Repair prompt builder
// ---------------------------------------------------------------------------

function buildRepairPrompt(reasonContent: string): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  return `# Gateway Self-Heal Task

OpenClaw gateway is DOWN after restart.

## Restart context (from operator)
${reasonContent}

## Diagnosis steps
1. Check gateway status: \`openclaw gateway status\`
2. Check logs: \`journalctl --user -u openclaw-gateway -n 80 --no-pager\`
3. Check file logs: \`tail -100 /tmp/openclaw/openclaw-${dateStr}.log\`
4. Run an end-to-end gateway probe, not just a service check: \`openclaw agent --session-id gateway-selfheal-probe --message "Reply with ONLY: GATEWAY_OK" --thinking off --timeout 30 --json\`
5. Check recent git changes: \`cd ${WORKSPACE}/code/frankclaw && git log --oneline -5\`

## Fix attempts (most common first)

**a) Stale dist (most common after code changes/merges):**
\`\`\`bash
cd ${WORKSPACE}/code/frankclaw
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm tsdown 2>&1
\`\`\`

**b) Config/schema changes:** Check if new required config fields were added.

**c) Port conflict:** \`lsof -i :18789\` — kill stale process if needed.

**d) Node module issues:**
\`\`\`bash
cd ${WORKSPACE}/code/frankclaw
rm -rf node_modules/.cache
pnpm install && pnpm tsdown
\`\`\`

**e) Revert last commit (last resort):**
\`\`\`bash
cd ${WORKSPACE}/code/frankclaw
git revert HEAD --no-edit
pnpm install && pnpm tsdown
\`\`\`

## After each fix attempt
\`\`\`bash
openclaw gateway restart
sleep 20
openclaw gateway status
openclaw channels status --probe 2>&1
openclaw agent --session-id gateway-selfheal-probe --message "Reply with ONLY: GATEWAY_OK" --thinking off --timeout 30 --json
\`\`\`

Do not stop at "gateway is active". The fix is only good if the gateway can complete that probe turn and return \`GATEWAY_OK\`.

Iterate up to 5 fix rounds. If nothing works, revert to last known good state.

## When done (SUCCESS)
Send a success notification via \`openclaw message send\` to whatever channel is configured.
Example: \`openclaw message send --channel <first_available_channel> --target <operator> --message "✅ Self-heal complete. Fix: [what you did]"\`

## When done (FAILURE)
Send a failure notification: \`openclaw message send --channel <first_available_channel> --target <operator> --message "🚨 Self-heal FAILED. Error: [last error]. Manual intervention needed."\`

## Rules
- Working directory: ${WORKSPACE}/code/frankclaw
- Do NOT modify workspace files outside code/frankclaw
- Do NOT delete config files
- If you revert a commit, note it clearly
`;
}

// ---------------------------------------------------------------------------
// Self-heal orchestrator
// ---------------------------------------------------------------------------

/**
 * Injectable dependencies for runSelfHeal — allows unit testing without
 * real child processes or messaging.
 */
export interface SelfHealDeps {
  /** Check if a CLI command exists on PATH. */
  commandExists: (cmd: string) => boolean;
  /** Spawn a repair agent and wait for it to finish. */
  runAgent: (
    command: string,
    args: string[],
    prompt: string,
    timeoutMs: number,
  ) => Promise<{ success: boolean; output: string }>;
  /** Send a notification to the operator. */
  notify: (message: string) => void;
  /** Log to the self-heal log file. */
  log: (message: string) => void;
}

/** Default (real) dependencies. */
const defaultDeps: SelfHealDeps = {
  commandExists,
  runAgent,
  notify: notifyOperator,
  log: logSelfHeal,
};

/**
 * Run the self-heal flow: notify operator, spawn Claude Code (Gemini backup).
 * Called when gateway health check fails after restart.
 *
 * @param reasonContent  Content from the reason file.
 * @param deps           Injectable dependencies (for testing).
 */
export async function runSelfHeal(
  reasonContent: string,
  deps: SelfHealDeps = defaultDeps,
): Promise<boolean> {
  const { commandExists: hasCmd, runAgent: run, notify, log } = deps;

  log("Gateway failed health check. Starting self-heal...");

  notify(
    "🔧 **Self-heal in progress**\n" +
      "Gateway didn't come back after restart. Launching repair agent.\n\n" +
      `Context:\n${reasonContent.slice(0, 300)}`,
  );

  const prompt = buildRepairPrompt(reasonContent);

  // Try Claude Code first
  if (hasCmd("claude")) {
    log("Launching Claude Code for repair...");
    notify("🤖 Claude Code is diagnosing the issue...");

    const result = await run("claude", ["--dangerously-skip-permissions", "-p"], prompt, 1800_000);
    log(`Claude Code finished: success=${result.success}, output=${result.output.slice(-500)}`);

    if (result.success) {
      log("Claude Code repair completed successfully");
      return true;
    }

    const errorTail = result.output.split("\n").slice(-15).join("\n");
    notify(
      `⚠️ Claude Code couldn't fix it. Trying Gemini as backup...\n\n` +
        `Last output:\n\`\`\`\n${errorTail.slice(0, 500)}\n\`\`\``,
    );
  } else {
    log("Claude CLI not found, skipping to Gemini");
    notify("⚠️ Claude Code not available. Trying Gemini CLI...");
  }

  // Fallback: Gemini CLI
  if (hasCmd("gemini")) {
    log("Launching Gemini CLI for repair...");

    const result = await run("gemini", ["--yolo", "-p"], prompt, 1800_000);
    log(`Gemini CLI finished: success=${result.success}, output=${result.output.slice(-500)}`);

    if (result.success) {
      log("Gemini CLI repair completed successfully");
      return true;
    }

    const errorTail = result.output.split("\n").slice(-15).join("\n");
    notify(
      `🚨 **Both repair agents failed!**\n\n` +
        `Claude Code: ${hasCmd("claude") ? "failed" : "not installed"}\n` +
        `Gemini CLI: failed\n\n` +
        `Gemini last output:\n\`\`\`\n${errorTail.slice(0, 500)}\n\`\`\`\n\n` +
        `Manual intervention needed.\nCheck: \`cat ${SELFHEAL_LOG}\``,
    );
    return false;
  }

  log("Neither claude nor gemini CLI found");
  notify(
    "🚨 **Both repair agents unavailable!**\n" +
      "Neither `claude` nor `gemini` CLI found on this system.\n" +
      "Manual intervention needed.",
  );
  return false;
}
