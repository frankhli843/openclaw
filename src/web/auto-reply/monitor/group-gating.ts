import { hasControlCommand } from "../../../auto-reply/command-detection.js";
import { parseActivationCommand } from "../../../auto-reply/group-activation.js";
import { recordPendingHistoryEntryIfEnabled } from "../../../auto-reply/reply/history.js";
import { getChannelDock } from "../../../channels/dock.js";
import { notifyBlocked } from "../../../channels/gate-notify.js";
import { resolveGateMode, resolveMentionGating } from "../../../channels/mention-gating.js";
import type { loadConfig } from "../../../config/config.js";
import { normalizeE164 } from "../../../utils.js";
import type { MentionConfig } from "../mentions.js";
import { buildMentionConfig, debugMention, resolveOwnerList } from "../mentions.js";
import type { WebInboundMsg } from "../types.js";
import { stripMentionsForCommand } from "./commands.js";
import { resolveGroupActivationFor, resolveGroupPolicyFor } from "./group-activation.js";
import { formatGroupMembers, noteGroupMember } from "./group-members.js";
import { maybeMarkWhatsAppRoamingSeen } from "./roaming-seen.js";

export type GroupHistoryEntry = {
  sender: string;
  body: string;
  timestamp?: number;
  id?: string;
  senderJid?: string;
};

type ApplyGroupGatingParams = {
  cfg: ReturnType<typeof loadConfig>;
  msg: WebInboundMsg;
  conversationId: string;
  groupHistoryKey: string;
  agentId: string;
  sessionKey: string;
  baseMentionConfig: MentionConfig;
  authDir?: string;
  groupHistories: Map<string, GroupHistoryEntry[]>;
  groupHistoryLimit: number;
  groupMemberNames: Map<string, Map<string, string>>;
  logVerbose: (msg: string) => void;
  replyLogger: { debug: (obj: unknown, msg: string) => void };
  /** Channel identifier (e.g. "whatsapp", "signal") for gateMode resolution. */
  channel?: string;
  verbose?: boolean;
  accountId?: string;
};

function isOwnerSender(baseMentionConfig: MentionConfig, msg: WebInboundMsg) {
  const sender = normalizeE164(msg.senderE164 ?? "");
  if (!sender) {
    return false;
  }
  const owners = resolveOwnerList(baseMentionConfig, msg.selfE164 ?? undefined);
  return owners.includes(sender);
}

function recordPendingGroupHistoryEntry(params: {
  msg: WebInboundMsg;
  groupHistories: Map<string, GroupHistoryEntry[]>;
  groupHistoryKey: string;
  groupHistoryLimit: number;
}) {
  const sender =
    params.msg.senderName && params.msg.senderE164
      ? `${params.msg.senderName} (${params.msg.senderE164})`
      : (params.msg.senderName ?? params.msg.senderE164 ?? "Unknown");
  recordPendingHistoryEntryIfEnabled({
    historyMap: params.groupHistories,
    historyKey: params.groupHistoryKey,
    limit: params.groupHistoryLimit,
    entry: {
      sender,
      body: params.msg.body,
      timestamp: params.msg.timestamp,
      id: params.msg.id,
      senderJid: params.msg.senderJid,
    },
  });
}

function skipGroupMessageAndStoreHistory(params: ApplyGroupGatingParams, verboseMessage: string) {
  params.logVerbose(verboseMessage);
  recordPendingGroupHistoryEntry({
    msg: params.msg,
    groupHistories: params.groupHistories,
    groupHistoryKey: params.groupHistoryKey,
    groupHistoryLimit: params.groupHistoryLimit,
  });
  return { shouldProcess: false } as const;
}

export function applyGroupGating(params: ApplyGroupGatingParams) {
  const groupPolicy = resolveGroupPolicyFor(params.cfg, params.conversationId);
  if (groupPolicy.allowlistEnabled && !groupPolicy.allowed) {
    params.logVerbose(`Skipping group message ${params.conversationId} (not in allowlist)`);
    return { shouldProcess: false };
  }

  const mentionConfig = buildMentionConfig(params.cfg, params.agentId);
  const mentionDebug = debugMention(params.msg, mentionConfig, params.authDir);
  params.msg.wasMentioned = mentionDebug.wasMentioned;
  params.replyLogger.debug(
    {
      conversationId: params.conversationId,
      wasMentioned: mentionDebug.wasMentioned,
      ...mentionDebug.details,
    },
    "group mention debug",
  );

  // --- gateMode check (takes priority over legacy requireMention when configured) ---
  const channelId = params.channel ?? "whatsapp";
  const dock = getChannelDock(channelId as Parameters<typeof getChannelDock>[0]);
  const gateModeResult = dock?.groups?.resolveGateMode?.({
    cfg: params.cfg,
    groupId: params.conversationId,
    accountId: undefined,
  });
  if (gateModeResult?.gateMode) {
    const mentionKeywords = params.cfg.agents?.defaults?.mentionKeywords ?? [];
    const senderE164 = normalizeE164(params.msg.senderE164 ?? "");
    const allowFrom = (params.cfg.channels?.whatsapp?.allowFrom ?? [])
      .map((e) => normalizeE164(String(e)))
      .filter((e): e is string => Boolean(e));
    const gateModeAction = resolveGateMode({
      gateMode: gateModeResult.gateMode,
      senderId: senderE164,
      allowFrom,
      allowedSenders: gateModeResult.allowedSenders
        .map((s) => normalizeE164(String(s)))
        .filter((s): s is string => Boolean(s)),
      wasMentioned: params.msg.wasMentioned ?? false,
      messageText: params.msg.body ?? "",
      mentionKeywords,
    });

    if (gateModeAction.action === "skip") {
      params.logVerbose(
        `Group message blocked by gateMode=${gateModeResult.gateMode} in ${params.conversationId}`,
      );
      // Only send gate-notify for truly "blocked" groups (unknown/new).
      if (gateModeResult.gateMode === "blocked") {
        notifyBlocked({
          platform: channelId,
          chatName: params.msg.groupSubject ?? params.conversationId,
          chatId: params.conversationId,
          senderId: senderE164 || params.msg.senderJid || "unknown",
          isGroup: true,
          preview: (params.msg.body ?? "").slice(0, 100),
          metadata: {
            "Group Subject": params.msg.groupSubject,
            "Sender Name": params.msg.senderName,
            "Sender JID": params.msg.senderJid,
            Participants: formatGroupMembers({
              participants: params.msg.groupParticipants,
              roster: params.groupMemberNames.get(params.groupHistoryKey),
              fallbackE164: params.msg.senderE164,
            }),
          },
        });
      }

      if (channelId === "whatsapp" && gateModeResult.gateMode !== "blocked") {
        maybeMarkWhatsAppRoamingSeen({
          cfg: params.cfg,
          msg: params.msg,
          verbose: params.verbose ?? false,
          accountId: params.accountId,
        });
      }

      recordPendingGroupHistoryEntry({
        msg: params.msg,
        groupHistories: params.groupHistories,
        groupHistoryKey: params.groupHistoryKey,
        groupHistoryLimit: params.groupHistoryLimit,
      });
      return { shouldProcess: false };
    }

    if (gateModeAction.action === "silent") {
      params.logVerbose(
        `Group message silent by gateMode=${gateModeResult.gateMode} in ${params.conversationId}`,
      );
      recordPendingGroupHistoryEntry({
        msg: params.msg,
        groupHistories: params.groupHistories,
        groupHistoryKey: params.groupHistoryKey,
        groupHistoryLimit: params.groupHistoryLimit,
      });
      return { shouldProcess: false };
    }

    // action === "process" — fall through to normal processing
    params.msg.wasMentioned = gateModeAction.effectiveWasMentioned;
    return { shouldProcess: true };
  }
  // --- end gateMode check (fall through to legacy requireMention) ---

  noteGroupMember(
    params.groupMemberNames,
    params.groupHistoryKey,
    params.msg.senderE164,
    params.msg.senderName,
  );

  const commandBody = stripMentionsForCommand(
    params.msg.body,
    mentionConfig.mentionRegexes,
    params.msg.selfE164,
  );
  const activationCommand = parseActivationCommand(commandBody);
  const owner = isOwnerSender(params.baseMentionConfig, params.msg);
  const shouldBypassMention = owner && hasControlCommand(commandBody, params.cfg);

  if (activationCommand.hasCommand && !owner) {
    return skipGroupMessageAndStoreHistory(
      params,
      `Ignoring /activation from non-owner in group ${params.conversationId}`,
    );
  }

  const wasMentioned = mentionDebug.wasMentioned;
  const activation = resolveGroupActivationFor({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    conversationId: params.conversationId,
  });
  const requireMention = activation !== "always";
  const selfJid = params.msg.selfJid?.replace(/:\\d+/, "");
  const replySenderJid = params.msg.replyToSenderJid?.replace(/:\\d+/, "");
  const selfE164 = params.msg.selfE164 ? normalizeE164(params.msg.selfE164) : null;
  const replySenderE164 = params.msg.replyToSenderE164
    ? normalizeE164(params.msg.replyToSenderE164)
    : null;
  const implicitMention = Boolean(
    (selfJid && replySenderJid && selfJid === replySenderJid) ||
    (selfE164 && replySenderE164 && selfE164 === replySenderE164),
  );
  const mentionGate = resolveMentionGating({
    requireMention,
    canDetectMention: true,
    wasMentioned,
    implicitMention,
    shouldBypassMention,
  });
  params.msg.wasMentioned = mentionGate.effectiveWasMentioned;
  if (!shouldBypassMention && requireMention && mentionGate.shouldSkip) {
    return skipGroupMessageAndStoreHistory(
      params,
      `Group message stored for context (no mention detected) in ${params.conversationId}: ${params.msg.body}`,
    );
  }

  return { shouldProcess: true };
}
