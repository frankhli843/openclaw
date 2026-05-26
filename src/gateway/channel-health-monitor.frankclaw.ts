/**
 * frankclaw: channel health monitor extensions.
 *
 * Prevents the health monitor from auto-restarting channel accounts that are
 * in a permanent conflict state requiring manual operator intervention.
 *
 * Currently handles: WhatsApp status-440 session conflict.
 * When status 440 is received, `markWhatsAppSessionConflict440` is called
 * from the statusSink. The health monitor then skips restarts for that account
 * so Frank can clear stale linked-device sessions without the gateway cycling.
 * The flag is cleared when the account reconnects successfully.
 */

import { isWhatsAppSessionConflict440 } from "../../extensions/whatsapp/src/session-conflict-guard.frankclaw.js";

/**
 * Returns true when the health monitor should skip restarting this account
 * because it is in a permanent conflict state that requires manual intervention.
 */
export function shouldSkipHealthRestartForConflict(channelId: string, accountId: string): boolean {
  if (channelId === "whatsapp") {
    return isWhatsAppSessionConflict440(accountId);
  }
  return false;
}
