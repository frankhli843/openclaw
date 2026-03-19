/**
 * Frankclaw extension for Telegram bot message context.
 *
 * Implements gateMode check for Telegram group messages.
 */
import { notifyBlocked } from "../../../src/channels/gate-notify.js";
import { resolveGateMode } from "../../../src/channels/mention-gating.js";
import { resolveTelegramGroupGateMode } from "../../../src/channels/plugins/group-mentions.js";
import type { OpenClawConfig } from "../../../src/config/config.js";

export type TelegramGateModeCheckParams = {
  cfg: OpenClawConfig;
  isGroup: boolean;
  chatId: number;
  chatTitle?: string;
  chatUsername?: string;
  chatType?: string;
  senderId: string;
  senderName?: string;
  senderUsername?: string;
  wasMentioned: boolean;
  rawBody: string;
};

export type TelegramGateModeCheckResult = {
  approved: boolean;
  effectiveMention: boolean;
  shouldDrop: boolean;
};

/**
 * Run gateMode check for a Telegram group message.
 */
export function resolveTelegramGateModeCheck(
  params: TelegramGateModeCheckParams,
): TelegramGateModeCheckResult {
  const noGate: TelegramGateModeCheckResult = {
    approved: false,
    effectiveMention: false,
    shouldDrop: false,
  };

  if (!params.isGroup) {
    return noGate;
  }

  const gateModeResult = resolveTelegramGroupGateMode({
    cfg: params.cfg,
    groupId: String(params.chatId),
  });

  if (!gateModeResult?.gateMode) {
    return noGate;
  }

  const mentionKeywords = params.cfg.agents?.defaults?.mentionKeywords ?? [];
  const tgAllowFrom = (params.cfg.channels?.telegram?.allowFrom ?? []).map(String);

  const gateModeAction = resolveGateMode({
    gateMode: gateModeResult.gateMode,
    senderId: params.senderId,
    allowFrom: tgAllowFrom,
    allowedSenders: gateModeResult.allowedSenders,
    wasMentioned: params.wasMentioned,
    messageText: params.rawBody ?? "",
    mentionKeywords,
  });

  if (gateModeAction.action === "skip") {
    if (gateModeResult.gateMode === "blocked") {
      notifyBlocked({
        platform: "telegram",
        chatName: params.chatTitle ?? String(params.chatId),
        chatId: String(params.chatId),
        senderId: params.senderId,
        isGroup: true,
        preview: (params.rawBody ?? "").slice(0, 100),
        metadata: {
          "Chat Title": params.chatTitle,
          "Chat Username": params.chatUsername,
          "Chat Type": params.chatType,
          "Sender Name": params.senderName,
          "Sender Username": params.senderUsername,
        },
      });
    }
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  if (gateModeAction.action === "silent") {
    return { approved: false, effectiveMention: false, shouldDrop: true };
  }

  return {
    approved: true,
    effectiveMention: gateModeAction.effectiveWasMentioned,
    shouldDrop: false,
  };
}
