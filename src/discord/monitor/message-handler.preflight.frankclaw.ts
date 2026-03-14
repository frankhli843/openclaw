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
 *
 * Also provides webhookRelay resolution: messages from configured webhook
 * bot IDs are rewritten as if they came from the owner user, enabling
 * voice-to-Discord pipelines (e.g. Google Assistant → Zapier → webhook).
 */
import { notifyBlocked } from "../../../../src/channels/gate-notify.js";
import { resolveGateMode } from "../../../../src/channels/mention-gating.js";
import { resolveDiscordGroupGateMode } from "../../../../src/channels/plugins/group-mentions.js";
import type { OpenClawConfig } from "../../../../src/config/config.js";
import { loadSessionStore, resolveStorePath } from "../../../../src/config/sessions.js";
import { logVerbose } from "../../../../src/globals.js";

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

// ============================================================================
// Webhook Relay: rewrite webhook bot messages as owner messages
// ============================================================================

export type WebhookRelayResult = {
  /** Whether this message matched a webhook relay entry. */
  matched: boolean;
  /** The owner user ID to impersonate. */
  ownerUserId?: string;
  /** The message text after stripping the configured prefix (if any). */
  rewrittenText?: string;
};

/**
 * Check if an incoming message is from a configured webhook relay bot.
 * If matched, returns the owner user ID and optionally stripped message text.
 *
 * This enables voice-to-Discord pipelines where external services (Zapier,
 * IFTTT, etc.) post via Discord webhooks and the agent treats those messages
 * as if the owner sent them.
 */
type WebhookRelayEntry = {
  webhookBotId: string;
  ownerUserId: string;
  stripPrefix?: string;
};

function loadWebhookRelayEntries(): WebhookRelayEntry[] {
  // Optional JSON override: FRANKCLAW_DISCORD_WEBHOOK_RELAY='[{...}]'
  const raw = process.env.FRANKCLAW_DISCORD_WEBHOOK_RELAY?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
          .map((v) => ({
            webhookBotId: String((v.webhookBotId as string) ?? "").trim(),
            ownerUserId: String((v.ownerUserId as string) ?? "").trim(),
            stripPrefix: typeof v.stripPrefix === "string" ? v.stripPrefix : undefined,
          }))
          .filter((v) => v.webhookBotId && v.ownerUserId);
      }
    } catch {
      // fall through to default
    }
  }

  // frankclaw default: Doraemon Voice Bridge webhook → Frank
  // Zapier posts the raw Google Tasks title, e.g. "[DORA] How are you doing?"
  // We strip the [DORA] tag so the agent sees clean text.
  return [
    {
      webhookBotId: "1480933997193461782",
      ownerUserId: "257595674042826753",
      stripPrefix: "[DORA]",
    },
  ];
}

export function resolveWebhookRelay(params: {
  authorId: string;
  authorBot: boolean;
  messageText: string;
}): WebhookRelayResult {
  const noMatch: WebhookRelayResult = { matched: false };

  if (!params.authorBot) {
    return noMatch;
  }

  const relayEntries = loadWebhookRelayEntries();
  if (!relayEntries.length) {
    return noMatch;
  }

  const entry = relayEntries.find((e) => e.webhookBotId === params.authorId);
  if (!entry) {
    return noMatch;
  }

  let text = params.messageText;
  if (entry.stripPrefix) {
    const variants = [entry.stripPrefix, `📝 ${entry.stripPrefix}`];
    for (const prefix of variants) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length).trim();
        break;
      }
    }
  }

  logVerbose(`discord: webhook relay matched bot=${params.authorId} → owner=${entry.ownerUserId}`);

  return {
    matched: true,
    ownerUserId: entry.ownerUserId,
    rewrittenText: text,
  };
}
