/**
 * Frankclaw extension for Discord preflight message handler.
 *
 * Implements gateMode check for Discord guild messages:
 * - Resolves per-channel gateMode configuration
 * - Applies owner/allowlist/mention filters
 * - Sends blocked notifications for unknown groups
 * - Returns approval status for downstream mention gating bypass
 */
import { notifyBlocked } from "../../channels/gate-notify.js";
import { resolveGateMode } from "../../channels/mention-gating.js";
import { resolveDiscordGroupGateMode } from "../../channels/plugins/group-mentions.js";
import type { OpenClawConfig } from "../../config/config.js";

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
