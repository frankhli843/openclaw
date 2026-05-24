// frankclaw: Discord thread history injection (2026-05-23).
// Fetches prior messages from a Discord thread and formats them as historyBody
// so the agent has context when starting a new thread session.
// Mirrors the Slack plugin's thread history feature.

import { formatInboundEnvelope } from "openclaw/plugin-sdk/channel-inbound";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { listChannelMessages, type Client } from "../internal/discord.js";
import { resolveTimestampMs } from "./format.js";

const DISCORD_THREAD_HISTORY_LIMIT = 20;

export async function resolveDiscordThreadHistoryBody(params: {
  client: Client;
  threadChannelId: string;
  currentMessageId: string;
  botUserId: string | undefined;
  envelopeOptions: ReturnType<
    typeof import("openclaw/plugin-sdk/channel-inbound").resolveEnvelopeFormatOptions
  >;
}): Promise<string | undefined> {
  const { client, threadChannelId, currentMessageId, botUserId, envelopeOptions } = params;
  try {
    const messages = await listChannelMessages(client.rest, threadChannelId, {
      before: currentMessageId,
      limit: DISCORD_THREAD_HISTORY_LIMIT,
    });
    if (!messages || messages.length === 0) {
      return undefined;
    }
    // Discord returns newest first; reverse to chronological order
    const chronological = [...messages].reverse();
    const parts: string[] = [];
    for (const msg of chronological) {
      const text = msg.content;
      if (!text) {
        continue;
      }
      const authorId = msg.author?.id;
      const isBot = authorId === botUserId || Boolean(msg.author?.bot);
      const role = isBot ? "assistant" : "user";
      const senderName = isBot
        ? "Bot (this assistant)"
        : (msg.author?.global_name ?? msg.author?.username ?? "Unknown");
      parts.push(
        formatInboundEnvelope({
          channel: "Discord",
          from: `${senderName} (${role})`,
          timestamp: resolveTimestampMs(msg.timestamp),
          body: `${text}\n[discord message id: ${msg.id} channel: ${threadChannelId}]`,
          chatType: "channel",
          envelope: envelopeOptions,
        }),
      );
    }
    if (parts.length === 0) {
      return undefined;
    }
    logVerbose(`discord: populated thread history with ${parts.length} messages for new session`);
    return parts.join("\n\n");
  } catch (err) {
    logVerbose(`discord: failed to fetch thread history: ${err}`);
    return undefined;
  }
}
