// Whatsapp plugin module implements group gating behavior.
import type { BuildMentionRegexesOptions } from "openclaw/plugin-sdk/channel-mention-gating";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveChannelGroupGateMode } from "../../../../../src/config/group-policy.js";
import { resolveWhatsAppGroupsConfigPath } from "../../group-config-path.js";
import {
  getPrimaryIdentityId,
  getReplyContext,
  getSelfIdentity,
  getSenderIdentity,
  identitiesOverlap,
} from "../../identity.js";
import { resolveWhatsAppInboundPolicy } from "../../inbound-policy.js";
import { requireWhatsAppInboundAdmission } from "../../inbound/admission.js";
import type { AdmittedWebInboundMessage } from "../../inbound/types.js";
import type { MentionConfig } from "../mentions.js";
import { buildMentionConfig, debugMention, resolveOwnerList } from "../mentions.js";
import { stripMentionsForCommand } from "./commands.js";
import { resolveGroupActivationFor } from "./group-activation.js";
import { resolveWebGroupGateModeCheck } from "./group-gating.frankclaw.js";
import {
  hasControlCommand,
  implicitMentionKindWhen,
  normalizeE164,
  parseActivationCommand,
  createChannelHistoryWindow,
  resolveInboundMentionDecision,
} from "./group-gating.runtime.js";
import { noteGroupMember } from "./group-members.js";

export type GroupHistoryEntry = {
  sender: string;
  body: string;
  timestamp?: number;
  id?: string;
  senderJid?: string;
  /** Absolute path to saved media file (frankclaw addition: propagate media through gated history). */
  mediaPath?: string;
  /** MIME type of the media (frankclaw addition). */
  mediaType?: string;
};

type ApplyGroupGatingParams = {
  cfg: OpenClawConfig;
  msg: AdmittedWebInboundMessage;
  mentionText?: string;
  deferMissingMention?: boolean;
  groupHistoryKey: string;
  agentId: string;
  sessionKey: string;
  baseMentionConfig: MentionConfig;
  providerMentionPatterns?: BuildMentionRegexesOptions["providerPolicy"];
  authDir?: string;
  groupHistories: Map<string, GroupHistoryEntry[]>;
  groupHistoryLimit: number;
  groupMemberNames: Map<string, Map<string, string>>;
  selfChatMode?: boolean;
  logVerbose: (msg: string) => void;
  replyLogger: {
    debug: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
  };
  /** Channel identifier (e.g. "whatsapp", "signal") for gateMode resolution. */
  channel?: string;
  verbose?: boolean;
  accountId?: string;
};

const MAX_GROUP_DROP_WARNINGS = 100;
const groupDropWarned = new Set<string>();

export function resetGroupDropWarningsForTests() {
  groupDropWarned.clear();
}

function shouldWarnForGroupDrop(warnKey: string): boolean {
  if (groupDropWarned.has(warnKey)) {
    return false;
  }
  groupDropWarned.add(warnKey);
  while (groupDropWarned.size > MAX_GROUP_DROP_WARNINGS) {
    const oldest = groupDropWarned.values().next().value;
    if (!oldest) {
      break;
    }
    groupDropWarned.delete(oldest);
  }
  return true;
}

function isOwnerSender(baseMentionConfig: MentionConfig, msg: AdmittedWebInboundMessage) {
  const sender = normalizeE164(getSenderIdentity(msg).e164 ?? "");
  if (!sender) {
    return false;
  }
  const owners = resolveOwnerList(baseMentionConfig, getSelfIdentity(msg).e164 ?? undefined);
  return owners.includes(sender);
}

function recordPendingGroupHistoryEntry(params: {
  msg: AdmittedWebInboundMessage;
  body?: string;
  groupHistories: Map<string, GroupHistoryEntry[]>;
  groupHistoryKey: string;
  groupHistoryLimit: number;
}) {
  const senderIdentity = getSenderIdentity(params.msg);
  const sender =
    senderIdentity.name && senderIdentity.e164
      ? `${senderIdentity.name} (${senderIdentity.e164})`
      : (senderIdentity.name ??
        senderIdentity.e164 ??
        getPrimaryIdentityId(senderIdentity) ??
        "Unknown");
  // frankclaw addition: propagate media context through gated history so a later
  // mention/reply can attach the original media — but ONLY when the stored body is the
  // message's own body. When the body has been overridden (e.g. an audio voice note
  // whose placeholder is replaced by its transcript text), the entry is plain text and
  // must not carry the now-stale audio media path/type.
  const bodyOverridden = params.body !== undefined;
  createChannelHistoryWindow({ historyMap: params.groupHistories }).record({
    historyKey: params.groupHistoryKey,
    limit: params.groupHistoryLimit,
    entry: {
      sender,
      body: params.body ?? params.msg.payload.body,
      timestamp: params.msg.event.timestamp,
      id: params.msg.event.id,
      senderJid: senderIdentity.jid ?? params.msg.platform.senderJid,
      ...(bodyOverridden
        ? {}
        : { mediaPath: params.msg.mediaPath, mediaType: params.msg.mediaType }),
    },
  });
}

function skipGroupMessageAndStoreHistory(
  params: ApplyGroupGatingParams,
  verboseMessage: string,
  body?: string,
) {
  params.logVerbose(verboseMessage);
  recordPendingGroupHistoryEntry({
    msg: params.msg,
    body,
    groupHistories: params.groupHistories,
    groupHistoryKey: params.groupHistoryKey,
    groupHistoryLimit: params.groupHistoryLimit,
  });
  return { shouldProcess: false } as const;
}

export async function applyGroupGating(params: ApplyGroupGatingParams) {
  const sender = getSenderIdentity(params.msg);
  const self = getSelfIdentity(params.msg, params.authDir);
  const admission = requireWhatsAppInboundAdmission(params.msg);
  const conversationId = admission.conversation.id;
  const inboundPolicy = resolveWhatsAppInboundPolicy({
    cfg: params.cfg,
    accountId: admission.accountId,
    selfE164: self.e164 ?? null,
  });
  const conversationGroupPolicy = inboundPolicy.resolveConversationGroupPolicy(conversationId);
  if (conversationGroupPolicy.allowlistEnabled && !conversationGroupPolicy.allowed) {
    const accountId = inboundPolicy.account.accountId;
    const warnKey = `${accountId}:${conversationId}`;
    if (shouldWarnForGroupDrop(warnKey)) {
      const groupsPath = resolveWhatsAppGroupsConfigPath({ cfg: params.cfg, accountId });
      params.replyLogger.warn(
        { conversationId, accountId, groupsPath },
        `WhatsApp group ${conversationId} not in ${groupsPath} — inbound dropped. Add the group JID to ${groupsPath} (or add "*" there to admit all groups). Sender authorization still applies.`,
      );
    }
    params.logVerbose(
      `Dropping message from unregistered WhatsApp group ${conversationId}. Add the group JID to channels.whatsapp.groups, or add "*" there to admit all groups. Sender authorization still applies.`,
    );
    return { shouldProcess: false };
  }

  const mentionDebug = debugMention(
    params.msg,
    buildMentionConfig(params.cfg, params.agentId),
    params.authDir,
  );
  params.msg.wasMentioned = mentionDebug.wasMentioned;
  params.replyLogger.debug(
    {
      conversationId,
      wasMentioned: mentionDebug.wasMentioned,
      ...mentionDebug.details,
    },
    "group mention debug",
  );

  // [frankclaw] gateMode check (takes priority over legacy requireMention WHEN CONFIGURED).
  // Only short-circuit through gate-control when a gateMode is actually configured for this
  // group (either per-group or via the "*" wildcard default). When no gateMode is configured
  // `resolveChannelGroupGateMode` returns undefined; in that case we fall through to the legacy
  // mention/activation gating below, which supports audio-preflight deferral (deferMissingMention
  // / mentionText transcript re-evaluation). Deployments that set a "*" gateMode default (the
  // common case) always resolve a gateMode, so this is a no-op for them.
  const configuredGateMode = resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: (params.channel ?? "whatsapp") as Parameters<
      typeof resolveChannelGroupGateMode
    >[0]["channel"],
    groupId: conversationId,
    accountId: params.accountId,
  }).gateMode;
  if (configuredGateMode !== undefined) {
    const gateModeCheck = resolveWebGroupGateModeCheck({
      cfg: params.cfg,
      channel: params.channel ?? "whatsapp",
      conversationId,
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
    params.replyLogger.debug({ conversationId, gateModeCheck }, "gateModeCheck result");
    if (gateModeCheck.shouldDrop) {
      return { shouldProcess: false };
    }
    if (gateModeCheck.approved) {
      params.msg.wasMentioned = gateModeCheck.effectiveMention;
      return { shouldProcess: true };
    }
  }

  noteGroupMember(
    params.groupMemberNames,
    params.groupHistoryKey,
    sender.e164 ?? undefined,
    sender.name ?? undefined,
  );

  const baseMentionConfig = {
    ...params.baseMentionConfig,
    allowFrom: inboundPolicy.configuredAllowFrom,
  };
  const mentionConfig = {
    ...buildMentionConfig(params.cfg, params.agentId, {
      provider: "whatsapp",
      conversationId,
      providerPolicy: params.providerMentionPatterns,
    }),
    allowFrom: inboundPolicy.configuredAllowFrom,
  };
  const mentionMsg: AdmittedWebInboundMessage =
    params.mentionText !== undefined
      ? { ...params.msg, payload: { ...params.msg.payload, body: params.mentionText } }
      : params.msg;
  // [frankclaw audio-preflight] When a transcript override is supplied (voice note whose
  // original body was the "<media:audio>" placeholder), re-run mention detection against the
  // transcript text. The initial debugMention above ran on the placeholder body and can never
  // see a spoken mention, so without this an audio message that says the bot's name would
  // never satisfy mention gating.
  const mentionDebugForGating =
    params.mentionText !== undefined
      ? debugMention(mentionMsg, mentionConfig, params.authDir)
      : mentionDebug;
  const commandBody = stripMentionsForCommand(
    mentionMsg.payload.body,
    mentionConfig.mentionRegexes,
    self.e164,
  );
  const activationCommand = parseActivationCommand(commandBody);
  const owner = isOwnerSender(baseMentionConfig, params.msg);
  const shouldBypassMention = owner && hasControlCommand(commandBody, params.cfg);

  if (activationCommand.hasCommand && !owner) {
    return skipGroupMessageAndStoreHistory(
      params,
      `Ignoring /activation from non-owner in group ${conversationId}`,
    );
  }

  const wasMentioned = mentionDebugForGating.wasMentioned;
  const activation = await resolveGroupActivationFor({
    cfg: params.cfg,
    accountId: inboundPolicy.account.accountId,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    conversationId,
  });
  const requireMention = activation !== "always";
  const replyContext = getReplyContext(params.msg, params.authDir);
  const sharedNumberSelfChat = params.selfChatMode === true;
  // Detect reply-to-bot: compare JIDs, LIDs, and E.164 numbers.
  // WhatsApp may report the quoted message sender as either a phone JID
  // (xxxxx@s.whatsapp.net) or a LID (xxxxx@lid), so we compare both.
  // But in shared-number/selfChatMode setups, replies from the same self number
  // should not count as implicit bot mentions unless the message explicitly
  // mentioned the bot in text.
  const implicitReplyToSelf = sharedNumberSelfChat && identitiesOverlap(self, sender);
  const implicitMentionKinds = implicitMentionKindWhen(
    "quoted_bot",
    !implicitReplyToSelf && identitiesOverlap(self, replyContext?.sender),
  );
  const mentionDecision = resolveInboundMentionDecision({
    facts: {
      canDetectMention: true,
      wasMentioned,
      implicitMentionKinds,
    },
    policy: {
      isGroup: true,
      requireMention,
      allowTextCommands: false,
      hasControlCommand: false,
      commandAuthorized: false,
    },
  });
  const effectiveWasMentioned = mentionDecision.effectiveWasMentioned || shouldBypassMention;
  params.msg.wasMentioned = effectiveWasMentioned;
  if (!shouldBypassMention && requireMention && mentionDecision.shouldSkip) {
    if (params.deferMissingMention === true) {
      params.logVerbose(
        `Deferring group mention skip until audio preflight completes in ${conversationId}`,
      );
      return { shouldProcess: false, needsMentionText: true } as const;
    }
    return skipGroupMessageAndStoreHistory(
      params,
      `Group message stored for context (no mention detected) in ${conversationId}: ${mentionMsg.payload.body}`,
      params.mentionText,
    );
  }

  return { shouldProcess: true };
}
