/**
 * frankclaw: Channel-agnostic DNR bed indicator.
 *
 * When an outbound message is deferred by the DNR quiet-hours window, this
 * sends a brief 🛏️ text reply to the same target so Frank knows the message
 * was received but will deliver once quiet hours end.
 *
 * Uses loadChannelOutboundAdapter + runWithDirectAction so the indicator
 * itself bypasses DNR enforcement (it IS the intentional bypass — the
 * notification that DNR is active).
 *
 * - WhatsApp: text reply (no native bot reactions).
 * - Telegram: text reply (reactions require the original message ID; outbound
 *   DNR fires before the message is sent so there is no message to react to).
 *
 * All errors are swallowed — the indicator is best-effort and must NEVER
 * block the deferDelivery() call that follows.
 *
 * NOT called during delivery-queue recovery (queueId is null there), so
 * this cannot re-trigger on replay after DNR ends.
 */

import { loadChannelOutboundAdapter } from "../../channels/plugins/outbound/load.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { runWithDirectAction } from "./direct-action-context.frankclaw.js";

const BED_EMOJI = "🛏️";

/** Format nextEligibleAtMs as a human-readable local time. */
function formatResumeTime(nextEligibleAtMs: number): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(nextEligibleAtMs));
  } catch {
    // Fallback to ISO HH:MM UTC.
    return new Date(nextEligibleAtMs).toISOString().slice(11, 16) + " UTC";
  }
}

/**
 * Send a bed-emoji DNR indicator to `to` on `channel`.
 * Silently no-ops if the adapter has no sendText or if any error occurs.
 */
export async function sendChannelDnrBedIndicator(params: {
  cfg: OpenClawConfig;
  channel: string;
  to: string;
  accountId?: string | null;
  nextEligibleAtMs: number;
}): Promise<void> {
  const { cfg, channel, to, accountId, nextEligibleAtMs } = params;
  const resumeTime = formatResumeTime(nextEligibleAtMs);
  const text = `${BED_EMOJI} quiet hours — will deliver at ${resumeTime}`;

  try {
    const adapter = await loadChannelOutboundAdapter(channel);
    if (!adapter?.sendText) {
      return; // Channel adapter has no sendText; skip silently.
    }
    await runWithDirectAction(() =>
      adapter.sendText!({
        cfg,
        to,
        text,
        accountId: accountId ?? undefined,
      }),
    );
  } catch {
    // Best-effort indicator; never block the deferral flow.
  }
}
