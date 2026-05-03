import { markSilentSeen } from "../../../../../src/channels/silent-seen-reaction.js";
import type { loadConfig } from "../../../../../src/config/config.js";
import { sendReactionWhatsApp } from "../../send.js";
import type { WebInboundMsg } from "../types.js";

export function maybeMarkWhatsAppRoamingSeen(params: {
  cfg: ReturnType<typeof loadConfig>;
  msg: WebInboundMsg;
  verbose: boolean;
  accountId?: string;
}) {
  if (!params.msg.id || !params.msg.chatId) {
    return;
  }

  // Respect ackReaction disable settings (direct / group)
  const ackCfg = params.cfg.channels?.whatsapp?.ackReaction;
  const isGroup = params.msg.chatId.endsWith("@g.us");
  if (isGroup && ackCfg?.group === "never") {
    return;
  }
  if (!isGroup && ackCfg?.direct === false) {
    return;
  }

  const configuredEmoji = (ackCfg?.emoji ?? "").trim();
  const emoji = configuredEmoji || "👀";

  const waConversationId = `wa:${params.msg.chatId}`;
  void markSilentSeen({
    conversationId: waConversationId,
    messageId: params.msg.id,
    emoji,
    adapter: {
      addReaction: async (msgId, emojiToAdd) => {
        await sendReactionWhatsApp(params.msg.chatId, msgId, emojiToAdd, {
          verbose: params.verbose,
          fromMe: false,
          participant: params.msg.senderJid,
          accountId: params.accountId,
          cfg: params.cfg,
        });
      },
      removeReaction: async (msgId, _emojiToRemove) => {
        await sendReactionWhatsApp(params.msg.chatId, msgId, "", {
          verbose: params.verbose,
          fromMe: false,
          participant: params.msg.senderJid,
          accountId: params.accountId,
          cfg: params.cfg,
        });
      },
    },
  });
}
