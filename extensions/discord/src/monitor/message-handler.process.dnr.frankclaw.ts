import type { RequestClient } from "../internal/discord.js";
// frankclaw: bed-emoji reactor for DNR (do-not-reply / quiet-hours) on Discord.
// Kept in a separate file so the bed-emoji wiring point in process.ts is a
// single import + single call, minimizing merge-conflict surface area when the
// upstream channel-lifecycle / kernel-dispatcher code shifts around.
import { reactMessageDiscord } from "../send.js";

const DNR_BED_EMOJI = "🛏️";

export async function reactDiscordDnrBedEmoji(params: {
  channelId: string;
  messageId: string;
  rest: RequestClient;
}): Promise<void> {
  await reactMessageDiscord(params.channelId, params.messageId, DNR_BED_EMOJI, {
    rest: params.rest,
  }).catch(() => {});
}
