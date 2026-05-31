import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { callGateway } from "../gateway/call.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agents/acp-spawn-logs");

// frankclaw addition: Discord #logs channel for ACP spawn kickoff messages
const DISCORD_LOGS_CHANNEL_ID = "1474420675933638847";

/**
 * Determines whether an ACP thread-bound spawn from Discord should be
 * redirected to #logs instead of creating a visible thread in the
 * originating channel.
 *
 * Only applies to mode="run" ACP spawns from Discord. Session-mode spawns
 * keep their thread because the thread IS the interactive interface.
 */
export function shouldRedirectAcpSpawnToLogs(params: {
  channel?: string;
  spawnMode: "run" | "session";
  threadRequested: boolean;
}): boolean {
  if (!params.threadRequested) {
    return false;
  }
  const channel = normalizeOptionalString(params.channel)?.toLowerCase();
  return channel === "discord" && params.spawnMode === "run";
}

/**
 * Posts a kickoff log message to Discord #logs when an ACP spawn is
 * redirected away from the originating channel.
 */
export async function postAcpSpawnKickoffLog(params: {
  childSessionKey: string;
  runId: string;
  agentId: string;
  label?: string;
  task: string;
  originChannel?: string;
  originTo?: string;
  originThreadId?: string | number;
  originAccountId?: string;
}): Promise<void> {
  const labelPart = params.label?.trim() ? ` label=\`${params.label.trim()}\`` : "";
  const taskPreview = params.task.slice(0, 200).replace(/\n/g, " ");

  // Build origin context line
  const originParts: string[] = [];
  if (params.originChannel) {
    originParts.push(`channel=${params.originChannel}`);
  }
  const originTo = normalizeOptionalString(params.originTo);
  if (originTo) {
    // Extract channel ID from "channel:123456" format for Discord permalink
    const channelMatch = originTo.match(/^channel:(\d+)$/);
    if (channelMatch) {
      originParts.push(`<#${channelMatch[1]}>`);
    } else {
      originParts.push(`to=${originTo}`);
    }
  }
  const threadId = params.originThreadId != null ? String(params.originThreadId).trim() : undefined;
  if (threadId) {
    originParts.push(`thread=<#${threadId}>`);
  }
  const originLine = originParts.length > 0 ? `\norigin: ${originParts.join(" ")}` : "";

  const message =
    `🚀 ACP worker spawned: agent=\`${params.agentId}\`${labelPart}` +
    `\nrun=\`${params.runId}\` session=\`${params.childSessionKey.slice(0, 60)}\`` +
    originLine +
    `\ntask: ${taskPreview}`;

  try {
    await callGateway({
      method: "send",
      params: {
        channel: "discord",
        to: DISCORD_LOGS_CHANNEL_ID,
        message,
        // Deterministic idempotency key to avoid duplicate kickoff logs on retries.
        idempotencyKey: `acp-spawn-log:${params.childSessionKey}:${params.runId}`,
      },
      timeoutMs: 10_000,
    });
  } catch (err) {
    log.warn("Failed to post ACP spawn kickoff log to Discord #logs", { err });
  }
}
