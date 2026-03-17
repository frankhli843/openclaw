import { resolveMentionGating } from "openclaw/plugin-sdk/channel-runtime";
import type { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { hasControlCommand } from "openclaw/plugin-sdk/reply-runtime";
import { parseActivationCommand } from "openclaw/plugin-sdk/reply-runtime";
import { recordPendingHistoryEntryIfEnabled } from "openclaw/plugin-sdk/reply-runtime";
import { normalizeE164 } from "openclaw/plugin-sdk/text-runtime";
import type { MentionConfig } from "../mentions.js";
import { buildMentionConfig, debugMention, resolveOwnerList } from "../mentions.js";
import type { WebInboundMsg } from "../types.js";
import { checkChannelPolicy } from "../../../../../src/frankclaw/channel-policy.js";
import { notifyBlocked } from "../../../../../src/channels/gate-notify.js";
import { stripMentionsForCommand } from "./commands.js";
import { resolveGroupActivationFor, resolveGroupPolicyFor } from "./group-activation.js";
import { resolveWebGroupGateModeCheck } from "./group-gating.frankclaw.js";
import { noteGroupMember } from "./group-members.js";

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
  // [frankclaw] Channel-policy gate: notify about unknown groups
  const channelKey = `whatsapp:${params.conversationId}`;
  const policyDecision = checkChannelPolicy(
    params.channel ?? "whatsapp",
    params.conversationId,
    params.msg.wasMentioned,
  );
  if (policyDecision.action === "ask") {
    // Unknown group — notify owner and block
    notifyBlocked({
      platform: params.channel ?? "whatsapp",
      chatName: params.msg.groupSubject ?? params.conversationId,
      chatId: params.conversationId,
      senderId: params.msg.senderE164 ?? params.msg.senderJid ?? "unknown",
      isGroup: true,
      preview: (params.msg.body ?? "").slice(0, 100),
      metadata: {
        "Group Subject": params.msg.groupSubject,
        "Sender Name": params.msg.senderName,
        "Channel Key": channelKey,
      },
    });
    params.logVerbose(`Unknown group ${params.conversationId} — gate notification sent`);
    return { shouldProcess: false };
  }
  if (policyDecision.action === "block") {
    params.logVerbose(`Group ${params.conversationId} blocked by channel-policy`);
    return { shouldProcess: false };
  }
  if (policyDecision.action === "view-only") {
    recordPendingGroupHistoryEntry({
      msg: params.msg,
      groupHistories: params.groupHistories,
      groupHistoryKey: params.groupHistoryKey,
      groupHistoryLimit: params.groupHistoryLimit,
    });
    return { shouldProcess: false };
  }

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

  // [frankclaw] gateMode check (takes priority over legacy requireMention when configured)
  const gateModeCheck = resolveWebGroupGateModeCheck({
    cfg: params.cfg,
    channel: params.channel ?? "whatsapp",
    conversationId: params.conversationId,
    msg: params.msg,
    groupHistoryKey: params.groupHistoryKey,
    groupMemberNames: params.groupMemberNames,
    logVerbose: params.logVerbose,
    verbose: params.verbose ?? false,
    accountId: params.accountId,
    recordHistory: () =>
      recordPendingGroupHistoryEntry({
        msg: params.msg,
        groupHistories: params.groupHistories,
        groupHistoryKey: params.groupHistoryKey,
        groupHistoryLimit: params.groupHistoryLimit,
      }),
  });
  if (gateModeCheck.shouldDrop) {
    return { shouldProcess: false };
  }
  if (gateModeCheck.approved) {
    params.msg.wasMentioned = gateModeCheck.effectiveMention;
    return { shouldProcess: true };
  }

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
