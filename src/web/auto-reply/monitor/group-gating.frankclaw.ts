/**
 * Frankclaw extension for WhatsApp/web group gating.
 *
 * Implements gateMode check for web-channel group messages (WhatsApp, Signal, etc.).
 */
import { getChannelDock } from "../../../../../src/channels/dock.js";
import { notifyBlocked } from "../../../../../src/channels/gate-notify.js";
import { resolveGateMode } from "../../../../../src/channels/mention-gating.js";
import type { OpenClawConfig } from "../../../../../src/config/config.js";
import { normalizeE164 } from "../../../../../src/utils.js";
import type { WebInboundMsg } from "../types.js";
import { formatGroupMembers } from "./group-members.js";
import { maybeMarkWhatsAppRoamingSeen } from "./roaming-seen.js";

export type WebGroupGateModeCheckParams = {
  cfg: OpenClawConfig;
  channel: string;
  conversationId: string;
  msg: WebInboundMsg;
  groupHistoryKey: string;
  groupMemberNames: Map<string, Map<string, string>>;
  logVerbose: (msg: string) => void;
  verbose: boolean;
  accountId?: string;
  recordHistory: () => void;
};

export type WebGroupGateModeCheckResult = {
  approved: boolean;
  effectiveMention: boolean;
  shouldDrop: boolean;
};

/**
 * Run gateMode check for a web-channel group message (WhatsApp, Signal, etc.).
 */
export function resolveWebGroupGateModeCheck(
  params: WebGroupGateModeCheckParams,
): WebGroupGateModeCheckResult {
  const noGate: WebGroupGateModeCheckResult = {
    approved: false,
    effectiveMention: false,
    shouldDrop: false,
  };

  const channelId = params.channel ?? "whatsapp";
  const dock = getChannelDock(channelId as Parameters<typeof getChannelDock>[0]);
  const gateModeResult = dock?.groups?.resolveGateMode?.({
    cfg: params.cfg,
    groupId: params.conversationId,
    accountId: undefined,
  });

  if (!gateModeResult?.gateMode) {
    return noGate;
  }

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
        verbose: params.verbose,
        accountId: params.accountId,
      });
    }

    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  if (gateModeAction.action === "silent") {
    params.logVerbose(
      `Group message silent by gateMode=${gateModeResult.gateMode} in ${params.conversationId}`,
    );
    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  // action === "process"
  return {
    approved: true,
    effectiveMention: gateModeAction.effectiveWasMentioned,
    shouldDrop: false,
  };
}
