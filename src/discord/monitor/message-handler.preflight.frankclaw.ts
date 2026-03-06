/**
 * Frankclaw extension for Discord preflight message handler.
 *
 * Implements gateMode check for Discord guild messages:
 * - Resolves per-channel gateMode configuration
 * - Applies owner/allowlist/mention filters
 * - Sends blocked notifications for unknown groups
 * - Returns approval status for downstream mention gating bypass
 *
 * Also provides session-existence fallback for thread binding recovery
 * after gateway restarts (resolveSessionExistsFallback).
 */
import { notifyBlocked } from "../../channels/gate-notify.js";
import { resolveGateMode } from "../../channels/mention-gating.js";
import { resolveDiscordGroupGateMode } from "../../channels/plugins/group-mentions.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";

export type DiscordGateModeCheckParams = {
  cfg: OpenClawConfig;
  isGuildMessage: boolean;
  messageChannelId: string;
  channelName: string | undefined;
  channelInfo?: { name?: string; topic?: string; parentId?: string };
  guildData?: { guild?: { id?: string; name?: string }; guild_id?: string };
  discordConfig?: {
    allowFrom?: Array<string | number>;
    dm?: { allowFrom?: Array<string | number> };
  };
  senderId: string;
  senderName?: string;
  senderTag?: string;
  wasMentioned: boolean;
  baseText: string;
  logDebug: (msg: string) => void;
  recordHistory: () => void;
};

export type DiscordGateModeCheckResult = {
  /** Whether gateMode approved this message (skip legacy mention gating). */
  approved: boolean;
  /** Effective wasMentioned from gateMode. */
  effectiveMention: boolean;
  /** Whether to drop the message entirely. */
  shouldDrop: boolean;
};

/**
 * Run gateMode check for a Discord guild message.
 * Returns whether the message was approved, should be dropped, or was not gated.
 */
export function resolveDiscordGateModeCheck(
  params: DiscordGateModeCheckParams,
): DiscordGateModeCheckResult {
  const noGate: DiscordGateModeCheckResult = {
    approved: false,
    effectiveMention: false,
    shouldDrop: false,
  };

  if (!params.isGuildMessage) {
    return noGate;
  }

  const gateModeResult = resolveDiscordGroupGateMode({
    cfg: params.cfg,
    groupId: params.messageChannelId,
    groupChannel: params.channelName,
    groupSpace: params.guildData?.guild?.id,
  });

  if (!gateModeResult?.gateMode) {
    return noGate;
  }

  const mentionKeywords = params.cfg.agents?.defaults?.mentionKeywords ?? [];
  // Use the DM-level allowFrom (owner identities) for gateMode owner checks.
  // Fall back to guild-level users lists only if DM allowFrom is not configured.
  const dmAllowFrom = params.discordConfig?.allowFrom
    ? params.discordConfig.allowFrom.map(String)
    : (params.discordConfig?.dm?.allowFrom ?? []).map(String);
  const allowFrom =
    dmAllowFrom.length > 0
      ? dmAllowFrom
      : params.cfg.channels?.discord?.guilds
        ? Object.values(params.cfg.channels.discord.guilds).flatMap((g) => {
            const users: string[] = [];
            if (g && typeof g === "object" && "users" in g && Array.isArray(g.users)) {
              users.push(...g.users.map(String));
            }
            return users;
          })
        : [];

  const gateModeAction = resolveGateMode({
    gateMode: gateModeResult.gateMode,
    senderId: params.senderId,
    allowFrom,
    allowedSenders: gateModeResult.allowedSenders.map(String),
    wasMentioned: params.wasMentioned,
    messageText: params.baseText || "",
    mentionKeywords,
  });

  if (gateModeAction.action === "skip") {
    params.logDebug(`[discord-preflight] drop: gateMode=${gateModeResult.gateMode}`);
    // Only send gate-notify for truly "blocked" groups (unknown/new).
    if (gateModeResult.gateMode === "blocked") {
      notifyBlocked({
        platform: "discord",
        chatName: params.channelName ?? params.messageChannelId,
        chatId: params.messageChannelId,
        senderId: params.senderId,
        isGroup: true,
        preview: (params.baseText || "").slice(0, 100),
        metadata: {
          Workspace: params.guildData?.guild?.name ?? params.guildData?.guild_id,
          "Workspace ID": params.guildData?.guild?.id ?? params.guildData?.guild_id,
          Channel: params.channelName ?? params.channelInfo?.name,
          "Channel ID": params.messageChannelId,
          "Channel Topic": params.channelInfo?.topic,
          "Parent Channel ID": params.channelInfo?.parentId,
          Sender: params.senderName,
          "Sender Tag": params.senderTag,
        },
      });
    }
    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  if (gateModeAction.action === "silent") {
    params.logDebug(`[discord-preflight] silent: gateMode=${gateModeResult.gateMode}`);
    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  // action === "process" — mark approved so legacy mention gate is skipped
  return {
    approved: true,
    effectiveMention: gateModeAction.effectiveWasMentioned,
    shouldDrop: false,
  };
}

// ============================================================================
// Session-existence fallback for thread binding recovery after gateway restart
// ============================================================================

/**
 * Check whether a session already exists in the session store for a given
 * Discord thread channel ID.
 *
 * After a gateway restart, in-memory thread bindings are lost. This fallback
 * checks the persisted session store (which is cached in-memory with a 45s TTL,
 * so no extra disk IO per message) for a session key matching the pattern
 * `agent:<agentId>:discord:channel:<channelId>`.
 *
 * If a matching session exists, the thread previously had a conversation and
 * should be treated as "bound" — no @mention required.
 */
export function resolveSessionExistsFallback(params: {
  channelId: string;
  isThread: boolean;
  agentId?: string;
}): boolean {
  if (!params.isThread || !params.channelId) {
    return false;
  }

  try {
    const storePath = resolveStorePath(undefined, { agentId: params.agentId });
    const store = loadSessionStore(storePath);

    // Session keys for Discord channels follow the pattern:
    // agent:<agentId>:discord:channel:<channelId>
    // We check for any key containing discord:channel:<channelId> to be robust
    // across agent IDs.
    const suffix = `:discord:channel:${params.channelId}`;
    for (const key of Object.keys(store)) {
      if (key.endsWith(suffix)) {
        logVerbose(
          `discord: thread session fallback hit for channel ${params.channelId} (key=${key})`,
        );
        return true;
      }
    }
  } catch {
    // If session store is unreadable, don't block — just return false
  }

  return false;
}
