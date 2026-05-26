/**
 * frankclaw: WhatsApp status-440 session conflict stop guard.
 *
 * When WhatsApp rejects the connection with status 440 (session conflict),
 * the gateway must stop further reconnect attempts and alert Frank so he can
 * clear stale linked-device sessions from his phone and relink via QR.
 *
 * Root cause this fixes (2026-05-26): after multiple crash/restart cycles,
 * stale linked-device sessions fill the 4-device limit. Each new connection
 * attempt gets status 440. Without this guard the channel lifecycle
 * auto-restarts (up to MAX_RESTART_ATTEMPTS=10) and the health monitor resets
 * the counter indefinitely, causing 440 cycling until human intervention.
 *
 * Integration points (see channel.ts and channel-health-monitor.ts):
 *   - markWhatsAppSessionConflict440: called from statusSink on first conflict
 *   - clearWhatsAppSessionConflict440: called from statusSink on reconnect
 *   - isWhatsAppSessionConflict440: polled by health monitor to skip restarts
 */

import { spawn } from "node:child_process";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";

/** Accounts currently in session-conflict (440) state. */
const conflicted = new Set<string>();

/** True if the account is blocked from health-monitor restarts due to 440. */
export function isWhatsAppSessionConflict440(accountId: string): boolean {
  return conflicted.has(accountId);
}

/**
 * Record a session-conflict event for this account.
 * On the FIRST conflict, posts a durable Discord alert with the re-link
 * command. Subsequent calls for the same account are no-ops (no duplicate
 * alerts during the auto-restart cycle).
 */
export function markWhatsAppSessionConflict440(accountId: string, runtime: RuntimeEnv): void {
  const isFirst = !conflicted.has(accountId);
  conflicted.add(accountId);

  const relinkCmd = "openclaw channels login --channel whatsapp";
  const alertMsg = [
    `⚠️ WhatsApp session conflict (status 440) detected for account ${JSON.stringify(accountId)}.`,
    `Multiple stale linked-device sessions are blocking new connections.`,
    `**To fix:** open WhatsApp → Settings → Linked Devices → remove ALL sessions,`,
    `then relink: \`${relinkCmd}\``,
  ].join(" ");

  runtime.error(
    `WhatsApp session conflict (440): stale linked-device sessions are blocking new connections. ` +
      `Clear all linked devices from your phone, then run: ${relinkCmd}`,
  );

  if (isFirst) {
    spawnFireAndForget("openclaw", [
      "message",
      "send",
      "--channel",
      "discord",
      "--target",
      "channel:1474420675933638847",
      "-m",
      alertMsg,
    ]);
  }
}

/** Clear the conflict state when the account successfully reconnects. */
export function clearWhatsAppSessionConflict440(accountId: string): void {
  conflicted.delete(accountId);
}

function spawnFireAndForget(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // best-effort
  }
}
