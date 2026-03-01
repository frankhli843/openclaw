import { markSilentSeen } from "../../../channels/silent-seen-reaction.js";
import type { loadConfig } from "../../../config/config.js";
import { sendReactionWhatsApp } from "../../outbound.js";
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

  const configuredEmoji = (params.cfg.channels?.whatsapp?.ackReaction?.emoji ?? "").trim();
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
        });
      },
      removeReaction: async (msgId, _emojiToRemove) => {
        await sendReactionWhatsApp(params.msg.chatId, msgId, "", {
          verbose: params.verbose,
          fromMe: false,
          participant: params.msg.senderJid,
          accountId: params.accountId,
        });
      },
    },
  });
}
