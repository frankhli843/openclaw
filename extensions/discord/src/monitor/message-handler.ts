import type { Client } from "@buape/carbon";
import { resolveAckReaction } from "openclaw/plugin-sdk/agent-runtime";
import {
  createChannelInboundDebouncer,
  shouldDebounceTextInbound,
} from "openclaw/plugin-sdk/channel-runtime";
import { resolveOpenProviderRuntimeGroupPolicy } from "openclaw/plugin-sdk/config-runtime";
import { danger, logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { reactMessageDiscord } from "../send.reactions.js";
import { buildDiscordInboundJob } from "./inbound-job.js";
import { createDiscordInboundWorker } from "./inbound-worker.js";
import type { DiscordMessageEvent, DiscordMessageHandler } from "./listeners.js";
import { preflightDiscordMessage } from "./message-handler.preflight.js";
import type { DiscordMessagePreflightParams } from "./message-handler.preflight.types.js";
// [frankclaw] Durable worker for crash-resistant message processing.
import { createFrankclawDurableInboundWorker } from "./message-handler.worker.frankclaw.js";
import {
  hasDiscordMessageStickers,
  resolveDiscordMessageChannelId,
  resolveDiscordMessageText,
} from "./message-utils.js";
import type { DiscordMonitorStatusSink } from "./status.js";

type DiscordMessageHandlerParams = Omit<
  DiscordMessagePreflightParams,
  "ackReactionScope" | "groupPolicy" | "data" | "client"
> & {
  setStatus?: DiscordMonitorStatusSink;
  abortSignal?: AbortSignal;
  workerRunTimeoutMs?: number;
  // [frankclaw] Client reference for durable worker runtime resolution.
  client?: import("@buape/carbon").Client;
};

export type DiscordMessageHandlerWithLifecycle = DiscordMessageHandler & {
  deactivate: () => void;
};

export function createDiscordMessageHandler(
  params: DiscordMessageHandlerParams,
): DiscordMessageHandlerWithLifecycle {
  const { groupPolicy } = resolveOpenProviderRuntimeGroupPolicy({
    providerConfigPresent: params.cfg.channels?.discord !== undefined,
    groupPolicy: params.discordConfig?.groupPolicy,
    defaultGroupPolicy: params.cfg.channels?.defaults?.groupPolicy,
  });
  const ackReactionScope =
    params.discordConfig?.ackReactionScope ??
    params.cfg.messages?.ackReactionScope ??
    "group-mentions";
  // [frankclaw] Resolve ack emoji once at handler creation time for early reactions.
  // Use empty agentId — config-level overrides take priority; agent identity
  // emoji is only a last-resort fallback and is not worth a routing lookup here.
  const earlyAckEmoji = resolveAckReaction(params.cfg, "", {
    channel: "discord",
    accountId: params.accountId,
  });
  // [frankclaw] Use durable worker when client is available (crash-resistant).
  // Falls back to in-memory worker if client ref is not provided.
  const inboundWorker = params.client
    ? createFrankclawDurableInboundWorker({
        accountId: params.accountId,
        runtime: params.runtime,
        setStatus: params.setStatus,
        abortSignal: params.abortSignal,
        runTimeoutMs: params.workerRunTimeoutMs,
        resolveRuntime: () => ({
          runtime: params.runtime,
          abortSignal: params.abortSignal,
          guildHistories: params.guildHistories,
          client: params.client!,
          threadBindings: params.threadBindings,
          discordRestFetch: params.discordRestFetch,
        }),
      })
    : createDiscordInboundWorker({
        runtime: params.runtime,
        setStatus: params.setStatus,
        abortSignal: params.abortSignal,
        runTimeoutMs: params.workerRunTimeoutMs,
      });

  const { debouncer } = createChannelInboundDebouncer<{
    data: DiscordMessageEvent;
    client: Client;
    abortSignal?: AbortSignal;
  }>({
    cfg: params.cfg,
    channel: "discord",
    buildKey: (entry) => {
      const message = entry.data.message;
      const authorId = entry.data.author?.id;
      if (!message || !authorId) {
        return null;
      }
      const channelId = resolveDiscordMessageChannelId({
        message,
        eventChannelId: entry.data.channel_id,
      });
      if (!channelId) {
        return null;
      }
      return `discord:${params.accountId}:${channelId}:${authorId}`;
    },
    shouldDebounce: (entry) => {
      const message = entry.data.message;
      if (!message) {
        return false;
      }
      const baseText = resolveDiscordMessageText(message, { includeForwarded: false });
      return shouldDebounceTextInbound({
        text: baseText,
        cfg: params.cfg,
        hasMedia: Boolean(
          (message.attachments && message.attachments.length > 0) ||
          hasDiscordMessageStickers(message),
        ),
      });
    },
    onFlush: async (entries) => {
      const last = entries.at(-1);
      if (!last) {
        return;
      }
      // [frankclaw] Use the handler-level lifecycle abort signal instead of
      // per-entry abortSignal.  Per-entry signals can be stale/aborted from a
      // previous processing cycle, causing fresh messages to be silently
      // dropped (race condition: user sees 👀 ack but never gets a response).
      // Only the lifecycle signal represents genuine cancellation (gateway
      // shutdown / handler deactivation).
      const abortSignal = params.abortSignal;
      if (abortSignal?.aborted) {
        return;
      }
      if (entries.length === 1) {
        const ctx = await preflightDiscordMessage({
          ...params,
          ackReactionScope,
          groupPolicy,
          abortSignal,
          data: last.data,
          client: last.client,
        });
        if (!ctx) {
          return;
        }
        inboundWorker.enqueue(buildDiscordInboundJob(ctx));
        return;
      }
      const combinedBaseText = entries
        .map((entry) => resolveDiscordMessageText(entry.data.message, { includeForwarded: false }))
        .filter(Boolean)
        .join("\n");
      const syntheticMessage = {
        ...last.data.message,
        content: combinedBaseText,
        attachments: [],
        message_snapshots: (last.data.message as { message_snapshots?: unknown }).message_snapshots,
        messageSnapshots: (last.data.message as { messageSnapshots?: unknown }).messageSnapshots,
        rawData: {
          ...(last.data.message as { rawData?: Record<string, unknown> }).rawData,
        },
      };
      const syntheticData: DiscordMessageEvent = {
        ...last.data,
        message: syntheticMessage,
      };
      const ctx = await preflightDiscordMessage({
        ...params,
        ackReactionScope,
        groupPolicy,
        abortSignal,
        data: syntheticData,
        client: last.client,
      });
      if (!ctx) {
        return;
      }
      if (entries.length > 1) {
        const ids = entries.map((entry) => entry.data.message?.id).filter(Boolean) as string[];
        if (ids.length > 0) {
          const ctxBatch = ctx as typeof ctx & {
            MessageSids?: string[];
            MessageSidFirst?: string;
            MessageSidLast?: string;
          };
          ctxBatch.MessageSids = ids;
          ctxBatch.MessageSidFirst = ids[0];
          ctxBatch.MessageSidLast = ids[ids.length - 1];
        }
      }
      inboundWorker.enqueue(buildDiscordInboundJob(ctx));
    },
    onError: (err) => {
      params.runtime.error?.(danger(`discord debounce flush failed: ${String(err)}`));
    },
  });

  const handler: DiscordMessageHandlerWithLifecycle = async (data, client, options) => {
    try {
      if (options?.abortSignal?.aborted) {
        return;
      }
      // Filter bot-own messages before they enter the debounce queue.
      // The same check exists in preflightDiscordMessage(), but by that point
      // the message has already consumed debounce capacity and blocked
      // legitimate user messages. On active servers this causes cumulative
      // slowdown (see #15874).
      const msgAuthorId = data.message?.author?.id ?? data.author?.id;
      if (params.botUserId && msgAuthorId === params.botUserId) {
        return;
      }

      // [frankclaw] Fire ack reaction immediately - before debouncing/preflight - so
      // the user gets instant visual feedback that their message was received.
      const messageId = data.message?.id;
      const channelId = data.channel_id ?? data.message?.channel_id;
      if (
        earlyAckEmoji &&
        channelId &&
        messageId &&
        ackReactionScope !== "off" &&
        ackReactionScope !== "none"
      ) {
        void reactMessageDiscord(channelId, messageId, earlyAckEmoji, {
          rest: client.rest as never,
        }).catch((err) => {
          logVerbose(`discord early ack reaction failed: ${String(err)}`);
        });
      }

      await debouncer.enqueue({ data, client, abortSignal: options?.abortSignal });
    } catch (err) {
      params.runtime.error?.(danger(`handler failed: ${String(err)}`));
    }
  };

  handler.deactivate = inboundWorker.deactivate;

  return handler;
}
