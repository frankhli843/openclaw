/**
 * Frankclaw extension for WhatsApp/web group gating.
 *
 * Implements gateMode check for web-channel group messages (WhatsApp, Signal, etc.).
 */
import {
  notifyBlocked,
  onBlockedNotification,
  formatBlockedNotification,
} from "../../../../../src/channels/gate-notify.js";
import { resolveGateMode } from "../../../../../src/channels/mention-gating.js";
import type { OpenClawConfig } from "../../../../../src/config/config.js";
import { loadConfig } from "../../../../../src/config/config.js";
import { resolveChannelGroupGateMode } from "../../../../../src/config/group-policy.js";
import { deliverOutboundPayloads } from "../../../../../src/infra/outbound/deliver.js";
import { runWithDirectAction } from "../../../../../src/infra/outbound/direct-action-context.frankclaw.js"; // frankclaw: gate-notify bypasses DNR
import { normalizeE164 } from "../../../../../src/utils.js";

// [frankclaw] Register gate-notify → Discord delivery from the SAME module context
// that fires notifyBlocked events. This avoids the dual-module-instance problem
// where dist and src get separate EventEmitter instances.
let gateNotifyRegistered = false;
function ensureGateNotifyDiscord() {
  if (gateNotifyRegistered) {
    return;
  }
  gateNotifyRegistered = true;

  onBlockedNotification(async (event) => {
    let cfg: OpenClawConfig;
    try {
      cfg = loadConfig();
    } catch (err) {
      console.error(`[gate-notify-ext] loadConfig failed: ${String(err)}`);
      return;
    }
    const gateChannel = (cfg.agents?.defaults as Record<string, unknown>)?.gateNotifyChannel as
      | string
      | undefined;
    const gateOwner = (cfg.agents?.defaults as Record<string, unknown>)?.gateNotifyOwner as
      | string
      | undefined;
    if (!gateChannel) {
      console.warn(`[gate-notify-ext] No gateNotifyChannel configured, skipping`);
      return;
    }

    const ownerMention = gateOwner ? `<@${gateOwner}>` : undefined;
    const message = formatBlockedNotification(event.info, { ownerMention });
    console.info(`[gate-notify-ext] Delivering to Discord channel ${gateChannel}...`);
    try {
      // frankclaw: wrap in directAction context so gate-notify bypasses DNR quiet hours
      await runWithDirectAction(() =>
        deliverOutboundPayloads({
          cfg,
          channel: "discord",
          to: `channel:${gateChannel}`,
          accountId: "default",
          payloads: [{ text: message }],
        }),
      );
      console.info(`[gate-notify-ext] Delivered successfully`);
    } catch (err) {
      console.error(`[gate-notify-ext] Delivery failed: ${String(err)}`);
    }
  });
}
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
  // Ensure Discord delivery is registered from the same module context
  ensureGateNotifyDiscord();

  const channelId = params.channel ?? "whatsapp";
  const gateModeResult = resolveChannelGroupGateMode({
    cfg: params.cfg,
    channel: channelId as Parameters<typeof resolveChannelGroupGateMode>[0]["channel"],
    groupId: params.conversationId,
    accountId: params.accountId,
  });

  params.logVerbose(
    `[gate-control-debug] conversationId=${params.conversationId} gateMode=${gateModeResult?.gateMode ?? "undefined"}`,
  );

  if (!gateModeResult?.gateMode) {
    // Unknown group (not in channel-policy): notify gate-control and drop
    notifyBlocked({
      platform: channelId,
      chatName: params.msg.groupSubject ?? params.conversationId,
      chatId: params.conversationId,
      senderId: normalizeE164(params.msg.senderE164 ?? "") || params.msg.senderJid || "unknown",
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
    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  const mentionKeywords = params.cfg.agents?.defaults?.mentionKeywords ?? [];
  const senderE164 = normalizeE164(params.msg.senderE164 ?? "");
  const allowFrom = (params.cfg.channels?.whatsapp?.allowFrom ?? [])
    .map((e) => normalizeE164(e))
    .filter((e): e is string => Boolean(e));

  const gateModeAction = resolveGateMode({
    gateMode: gateModeResult.gateMode,
    senderId: senderE164,
    allowFrom,
    allowedSenders: gateModeResult.allowedSenders
      .map((s) => normalizeE164(s))
      .filter((s): s is string => Boolean(s)),
    wasMentioned: params.msg.wasMentioned ?? false,
    messageText: params.msg.body ?? "",
    mentionKeywords,
  });

  if (gateModeAction.action === "skip") {
    params.logVerbose(
      `Group message blocked by gateMode=${gateModeResult.gateMode} in ${params.conversationId}`,
    );
    // [frankclaw] Always log gated group messages at info level for diagnostics
    console.log(
      `[whatsapp] [gate] skip gateMode=${gateModeResult.gateMode} group=${params.conversationId} sender=${senderE164 || "unknown"} body=${(params.msg.body ?? "").slice(0, 60)}`,
    );
    // Notify for ALL blocked groups, including unknown groups that default to "blocked"
    // This ensures new groups always trigger a gate-control notification
    if (gateModeResult.gateMode === "blocked" || !gateModeResult.gateMode) {
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
    // [frankclaw] Always log silent gate for diagnostics
    console.log(
      `[whatsapp] [gate] silent gateMode=${gateModeResult.gateMode} group=${params.conversationId} sender=${senderE164 || "unknown"} body=${(params.msg.body ?? "").slice(0, 60)}`,
    );
    params.recordHistory();
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  // action === "process"
  // [frankclaw] Log when message passes gating
  console.log(
    `[whatsapp] [gate] process gateMode=${gateModeResult.gateMode} group=${params.conversationId} sender=${senderE164 || "unknown"} mentioned=${gateModeAction.effectiveWasMentioned}`,
  );
  return {
    approved: true,
    effectiveMention: gateModeAction.effectiveWasMentioned,
    shouldDrop: false,
  };
}
