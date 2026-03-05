import { loadConfig } from "../../config/config.js";
import { logVerbose } from "../../globals.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import type { AuthProfileFailureReason } from "./types.js";

type LongCooldownEvent = {
  profileId: string;
  providerId: string;
  reason?: AuthProfileFailureReason;
  untilMs: number;
  nowMs: number;
};

type LongCooldownListener = (event: LongCooldownEvent) => void | Promise<void>;

const listeners = new Set<LongCooldownListener>();

export function emitLongCooldownEvent(event: LongCooldownEvent): void {
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(event)).catch((err) => {
        logVerbose?.(`[auth-cooldown-notify] listener failed: ${String(err)}`);
      });
    } catch (err) {
      logVerbose?.(`[auth-cooldown-notify] listener threw: ${String(err)}`);
    }
  }
}

let registered = false;

/**
 * Wire long-cooldown auth events to Discord #logs style channel notifications.
 */
export function registerAuthCooldownNotifyDiscord(params: {
  discordChannelId: string;
  ownerDiscordId?: string;
}): void {
  if (registered) {
    return;
  }
  registered = true;

  const { discordChannelId, ownerDiscordId } = params;

  const listener: LongCooldownListener = async (event) => {
    const now = event.nowMs;
    const remainingMin = Math.max(0, Math.ceil((event.untilMs - now) / 60_000));
    const untilIso = new Date(event.untilMs).toLocaleString("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const mention = ownerDiscordId ? `<@${ownerDiscordId}>\n` : "";
    const msg =
      `${mention}⚠️ Long auth cooldown triggered\n` +
      `• profile: ${event.profileId}\n` +
      `• provider: ${event.providerId}\n` +
      `• reason: ${event.reason ?? "unknown"}\n` +
      `• until: ${untilIso} (America/Toronto)\n` +
      `• remaining: ${remainingMin} min`;

    try {
      const cfg = loadConfig();
      await deliverOutboundPayloads({
        cfg,
        channel: "discord",
        to: `channel:${discordChannelId}`,
        accountId: "default",
        payloads: [{ text: msg }],
      });
    } catch (err) {
      logVerbose?.(`[auth-cooldown-notify] Failed to send Discord notification: ${String(err)}`);
    }
  };

  listeners.add(listener);
}
