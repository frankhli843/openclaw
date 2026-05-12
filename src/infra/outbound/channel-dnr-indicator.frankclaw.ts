/**
 * frankclaw: Channel-specific DNR bed emoji reaction indicator.
 *
 * When an outbound message is deferred by the DNR quiet-hours window, this
 * adds a 🛏️ reaction to the trigger message so Frank knows it was received
 * but will deliver once quiet hours end.
 *
 * - WhatsApp: sendReactionWhatsApp with bed emoji on the replyToId message.
 * - Telegram: reactMessageTelegram with bed emoji on the replyToId message.
 *
 * If replyToId is null/undefined, silently no-ops — can't react without a
 * message ID. All errors are swallowed — best-effort, must NEVER block the
 * deferDelivery() call that follows.
 *
 * NOT called during delivery-queue recovery (queueId is null there), so
 * this cannot re-trigger on replay after DNR ends.
 */

import type { OpenClawConfig } from "../../config/types.openclaw.js";

const BED_EMOJI = "🛏️";

/**
 * Add a bed-emoji DNR reaction to the trigger message on `channel`.
 * Silently no-ops if replyToId is missing or if any error occurs.
 */
export async function sendChannelDnrBedIndicator(params: {
  cfg: OpenClawConfig;
  channel: string;
  to: string;
  accountId?: string | null;
  replyToId?: string | null;
  nextEligibleAtMs: number;
}): Promise<void> {
  const { cfg, channel, to, accountId, replyToId } = params;
  if (!replyToId) return; // Can't react without a message ID.

  try {
    if (channel === "whatsapp") {
      const { sendReactionWhatsApp } = await import("../../../extensions/whatsapp/src/send.js");
      await sendReactionWhatsApp(to, replyToId, BED_EMOJI, {
        verbose: false,
        fromMe: false,
        accountId: accountId ?? undefined,
        cfg,
      });
    } else if (channel === "telegram") {
      const { reactMessageTelegram } = await import("../../../extensions/telegram/src/send.js");
      await reactMessageTelegram(to, replyToId, BED_EMOJI, {
        cfg,
        accountId: accountId ?? undefined,
        verbose: false,
      });
    }
  } catch {
    // Best-effort indicator; never block the deferral flow.
  }
}
