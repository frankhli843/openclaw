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
      await deliverOutboundPayloads({
        cfg,
        channel: "discord",
        to: `channel:${discordChannelId}`,
        accountId: "default",
        payloads: [{ text: message }],
      });
    } catch (err) {
      logVerbose(`[gate-notify-discord] Failed to send blocked notification: ${String(err)}`);
    }
  });
}
