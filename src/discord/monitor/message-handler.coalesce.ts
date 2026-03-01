import type { Client } from "@buape/carbon";
import { hasControlCommand } from "../../auto-reply/command-detection.js";
import { buildCollectPrompt } from "../../utils/queue-helpers.js";
import type { DurableDiscordInboundEvent } from "./inbound-durable-queue.js";
import { preflightDiscordMessage } from "./message-handler.preflight.js";
import type {
  DiscordMessageEvent,
  DiscordMessagePreflightParams,
} from "./message-handler.preflight.types.js";
import { processDiscordMessage } from "./message-handler.process.js";
import { resolveDiscordMessageText } from "./message-utils.js";

/** Deduplicate an array of objects with an `id` field, keeping first occurrence. */
function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

type CoalescedMessageHandlerParams = Omit<
  DiscordMessagePreflightParams,
  "ackReactionScope" | "groupPolicy" | "data" | "client"
>;

function toDiscordMessageEvent(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const candidate = payload as { message?: unknown };
  if (!candidate.message || typeof candidate.message !== "object") {
    return null;
  }
  return payload as Record<string, unknown>;
}

export function createCoalescedDiscordMessageHandler(params: CoalescedMessageHandlerParams) {
  const groupPolicy = params.discordConfig?.groupPolicy ?? "open";
  const ackReactionScope = params.cfg.messages?.ackReactionScope ?? "group-mentions";

  return async function processCoalescedDiscordMessages(
    events: DurableDiscordInboundEvent[],
    client: Client,
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const commandEvents: Array<{ event: DurableDiscordInboundEvent; data: DiscordMessageEvent }> =
      [];
    const regularEvents: Array<{ event: DurableDiscordInboundEvent; data: DiscordMessageEvent }> =
      [];

    for (const event of events) {
      const parsed = toDiscordMessageEvent(event.payload);
      if (!parsed) {
        continue;
      }
      const data = parsed as DiscordMessageEvent;
      const text = resolveDiscordMessageText(data.message, { includeForwarded: false });
      if (hasControlCommand(text, params.cfg)) {
        commandEvents.push({ event, data });
      } else {
        regularEvents.push({ event, data });
      }
    }

    // Fast-lane commands: process individually first.
    for (const { data } of commandEvents) {
      const ctx = await preflightDiscordMessage({
        ...params,
        ackReactionScope,
        groupPolicy,
        data,
        client,
      });
      if (ctx) {
        await processDiscordMessage(ctx);
      }
    }

    if (regularEvents.length === 0) {
      return;
    }

    if (regularEvents.length === 1) {
      const singleData = regularEvents[0].data;
      const msgId = singleData.message?.id ?? "unknown";
      const channelId = events[0]?.channelId ?? singleData.channel_id ?? "unknown";
      console.info(
        `[coalesce-diag] single message: msgId=${msgId} channelId=${channelId} content="${resolveDiscordMessageText(singleData.message, { includeForwarded: false }).slice(0, 80)}"`,
      );
      const ctx = await preflightDiscordMessage({
        ...params,
        ackReactionScope,
        groupPolicy,
        data: singleData,
        client,
      });
      if (!ctx) {
        console.info(`[coalesce-diag] DROPPED at preflight: msgId=${msgId} channelId=${channelId}`);
      } else {
        console.info(
          `[coalesce-diag] preflight passed: msgId=${msgId} channelId=${channelId} wasMentioned=${ctx.wasMentioned} effectiveMentioned=${ctx.effectiveWasMentioned}`,
        );
        await processDiscordMessage(ctx);
      }
      return;
    }

    const lastData = regularEvents.at(-1)?.data;
    if (!lastData) {
      return;
    }

    const coalescedBody = buildCollectPrompt({
      title: "[Queued messages while agent was busy]",
      items: regularEvents,
      renderItem: (item, index) => {
        const text = resolveDiscordMessageText(item.data.message, {
          includeForwarded: false,
        }).trim();
        const author = item.data.author;
        const timestamp = item.data.message?.timestamp || item.data.timestamp;
        const authorName =
          author?.globalName || author?.username || `user:${author?.id ?? "unknown"}`;
        const timeLabel =
          typeof timestamp === "string" || typeof timestamp === "number"
            ? new Date(timestamp).toISOString()
            : "unknown-time";
        return `Queued #${index + 1} (${authorName} @ ${timeLabel})\n${text}`;
      },
    });

    const mergedAttachments = regularEvents.flatMap(({ data }) => {
      const attachments = data.message?.attachments;
      if (Array.isArray(attachments)) {
        return attachments;
      }
      if (
        attachments &&
        typeof (attachments as { values?: () => Iterable<unknown> }).values === "function"
      ) {
        return Array.from((attachments as { values: () => Iterable<unknown> }).values());
      }
      return [];
    });

    // Merge mention metadata from ALL events (not just lastData).
    // Without this, mentions from earlier messages are silently lost and
    // preflight mention-gating can drop the entire coalesced batch.
    const mergedMentionedUsers = deduplicateById(
      regularEvents.flatMap(({ data }) => {
        const users = data.message?.mentionedUsers;
        return Array.isArray(users) ? users : [];
      }),
    );
    const mergedMentionedRoles = deduplicateById(
      regularEvents.flatMap(({ data }) => {
        const roles = data.message?.mentionedRoles;
        return Array.isArray(roles) ? roles : [];
      }),
    );
    const mergedMentionedEveryone = regularEvents.some(
      ({ data }) => data.message?.mentionedEveryone === true,
    );
    // Preserve the first referencedMessage found (for implicit mention via reply-to-bot).
    const mergedReferencedMessage =
      regularEvents.find(({ data }) => data.message?.referencedMessage)?.data.message
        ?.referencedMessage ?? lastData.message?.referencedMessage;

    const syntheticData: DiscordMessageEvent = {
      ...lastData,
      message: {
        ...lastData.message,
        content: coalescedBody,
        attachments: mergedAttachments,
        mentionedUsers: mergedMentionedUsers,
        mentionedRoles: mergedMentionedRoles,
        mentionedEveryone: mergedMentionedEveryone,
        referencedMessage: mergedReferencedMessage,
      },
    };

    console.info(
      `[coalesce-diag] batch: ${regularEvents.length} msgs channelId=${events[0]?.channelId ?? "?"} msgIds=[${regularEvents.map((e) => e.data.message?.id ?? "?").join(",")}]`,
    );

    const ctx = await preflightDiscordMessage({
      ...params,
      ackReactionScope,
      groupPolicy,
      data: syntheticData,
      client,
    });

    if (!ctx) {
      console.info(
        `[coalesce-diag] DROPPED batch at preflight: ${regularEvents.length} msgs channelId=${events[0]?.channelId ?? "?"}`,
      );
    } else {
      console.info(
        `[coalesce-diag] batch preflight passed: ${regularEvents.length} msgs wasMentioned=${ctx.wasMentioned} effectiveMentioned=${ctx.effectiveWasMentioned}`,
      );
      await processDiscordMessage(ctx);
    }
  };
}
