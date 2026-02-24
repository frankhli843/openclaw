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
      const ctx = await preflightDiscordMessage({
        ...params,
        ackReactionScope,
        groupPolicy,
        data: singleData,
        client,
      });
      if (ctx) {
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

    const syntheticData: DiscordMessageEvent = {
      ...lastData,
      message: {
        ...lastData.message,
        content: coalescedBody,
        attachments: mergedAttachments,
      },
    };

    const ctx = await preflightDiscordMessage({
      ...params,
      ackReactionScope,
      groupPolicy,
      data: syntheticData,
      client,
    });

    if (ctx) {
      await processDiscordMessage(ctx);
    }
  };
}
