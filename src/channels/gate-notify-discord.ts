import { createThreadDiscord } from "../../extensions/discord/src/send.js";
/**
 * Wires the gateMode blocked-message notifier to Discord delivery.
 * Import this module once during gateway startup to activate.
 */
import { loadConfig } from "../config/config.js";
import { logVerbose } from "../globals.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { formatBlockedNotification, onBlockedNotification } from "./gate-notify.js";

let registered = false;

/**
 * Register the blocked-notification → Discord delivery listener.
 * Safe to call multiple times; only registers once.
 */
export function registerGateNotifyDiscord(params: {
  /** Discord channel ID to post notifications to (e.g. #config channel). */
  discordChannelId: string;
  /** Discord user ID to @mention in notifications (e.g. "257595674042826753"). */
  ownerDiscordId?: string;
}): void {
  if (registered) {
    return;
  }
  registered = true;

  const { discordChannelId, ownerDiscordId } = params;
  const ownerMention = ownerDiscordId ? `<@${ownerDiscordId}>` : undefined;

  onBlockedNotification(async (event) => {
    const message = formatBlockedNotification(event.info, { ownerMention });
    try {
      const cfg = loadConfig();
      const results = await deliverOutboundPayloads({
        cfg,
        channel: "discord",
        to: `channel:${discordChannelId}`,
        accountId: "default",
        payloads: [{ text: message }],
      });

      // Create a thread from the posted message and tag the owner inside it
      // so it appears in their Discord sidebar.
      const messageId = results?.[0]?.messageId;
      if (messageId && ownerDiscordId) {
        try {
          const chatName = event.info.chatName || event.info.chatId;
          await createThreadDiscord(
            discordChannelId,
            {
              messageId,
              name: `${chatName} blocked`,
              content: `<@${ownerDiscordId}> New blocked message from ${event.info.platform}: "${chatName}" (${event.info.chatId}). Reply here to set a gate mode.`,
            },
            { cfg, accountId: "default" },
          );
        } catch (threadErr) {
          logVerbose(
            `[gate-notify-discord] Thread creation failed (non-fatal): ${String(threadErr)}`,
          );
        }
      }
    } catch (err) {
      logVerbose(`[gate-notify-discord] Failed to send blocked notification: ${String(err)}`);
    }
  });
}
