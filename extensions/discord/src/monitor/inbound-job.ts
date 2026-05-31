import {
  resolveDiscordChannelIdSafe,
  resolveDiscordChannelInfoSafe,
  resolveDiscordChannelNameSafe,
  resolveDiscordChannelParentSafe,
} from "./channel-access.js";
import type { DiscordMessagePreflightContext } from "./message-handler.preflight.types.js";

type DiscordInboundJobRuntimeField =
  | "runtime"
  | "abortSignal"
  | "guildHistories"
  | "client"
  | "threadBindings"
  // Function-backed feedback stays runtime-only; payload must remain
  // materializable data so queued jobs cannot accidentally serialize it.
  | "replyTypingFeedback"
  | "discordRestFetch";

export type DiscordInboundJobRuntime = Pick<
  DiscordMessagePreflightContext,
  DiscordInboundJobRuntimeField
>;

export type DiscordInboundJobPayload = Omit<
  DiscordMessagePreflightContext,
  DiscordInboundJobRuntimeField
>;

export type DiscordInboundJob = {
  queueKey: string;
  payload: DiscordInboundJobPayload;
  runtime: DiscordInboundJobRuntime;
  replayKeys?: string[];
};

export function resolveDiscordInboundJobQueueKey(ctx: DiscordMessagePreflightContext): string {
  // This key is both the run-queue serialization key and the typing prestart
  // dedupe key, so keep it aligned with the eventual session route.
  const sessionKey = ctx.route.sessionKey?.trim();
  if (sessionKey) {
    return sessionKey;
  }
  const baseSessionKey = ctx.baseSessionKey?.trim();
  if (baseSessionKey) {
    return baseSessionKey;
  }
  return ctx.messageChannelId;
}

export function buildDiscordInboundJob(
  ctx: DiscordMessagePreflightContext,
  options?: { replayKeys?: readonly string[] },
): DiscordInboundJob {
  const {
    runtime,
    abortSignal,
    guildHistories,
    client,
    threadBindings,
    replyTypingFeedback,
    discordRestFetch,
    message,
    data,
    threadChannel,
    ...payload
  } = ctx;

  const sanitizedMessage = sanitizeDiscordInboundMessage(message);
  return {
    queueKey: resolveDiscordInboundJobQueueKey(ctx),
    payload: {
      ...payload,
      message: sanitizedMessage,
      data: {
        ...data,
        message: sanitizedMessage,
      },
      threadChannel: normalizeDiscordThreadChannel(threadChannel),
    },
    runtime: {
      runtime,
      abortSignal,
      guildHistories,
      client,
      threadBindings,
      replyTypingFeedback,
      discordRestFetch,
    },
    replayKeys: options?.replayKeys ? [...options.replayKeys] : undefined,
  };
}

export function materializeDiscordInboundJob(
  job: DiscordInboundJob,
  abortSignal?: AbortSignal,
): DiscordMessagePreflightContext {
  const ctx = {
    ...job.payload,
    ...job.runtime,
    abortSignal: abortSignal ?? job.runtime.abortSignal,
  };

  // [frankclaw] After JSON round-trip through the durable queue, Carbon Message
  // instances become plain objects. Carbon getter fields (attachments, content,
  // embeds, mentions, etc.) only exist in _rawData. Hoist them so downstream
  // code that reads message.attachments etc. works correctly.
  if (ctx.message) {
    rehydrateCarbonMessage(ctx.message);
  }
  if (ctx.data?.message && ctx.data.message !== ctx.message) {
    rehydrateCarbonMessage(ctx.data.message);
  }

  return ctx;
}

function sanitizeDiscordInboundMessage<T extends object>(message: T): T {
  const descriptors = Object.getOwnPropertyDescriptors(message);
  delete descriptors.channel;
  return Object.create(Object.getPrototypeOf(message), descriptors) as T;
}

function normalizeDiscordThreadChannel(
  threadChannel: DiscordMessagePreflightContext["threadChannel"],
): DiscordMessagePreflightContext["threadChannel"] {
  if (!threadChannel) {
    return null;
  }
  const channelInfo = resolveDiscordChannelInfoSafe(threadChannel);
  const parent = resolveDiscordChannelParentSafe(threadChannel);
  return {
    id: threadChannel.id,
    name: channelInfo.name,
    parentId: channelInfo.parentId,
    parent: parent
      ? {
          id: resolveDiscordChannelIdSafe(parent),
          name: resolveDiscordChannelNameSafe(parent),
        }
      : undefined,
    ownerId: channelInfo.ownerId,
  };
}

/**
 * After JSON round-trip through the durable queue, Carbon Message getter fields
 * (attachments, embeds, content, …) live only inside `_rawData`.
 * Hoist them so downstream code that reads `message.attachments` works.
 */
export function rehydrateCarbonMessage(message: unknown): void {
  if (!message || typeof message !== "object") {
    return;
  }

  const mutableMessage = message as Record<string, unknown>;

  // Skip live Carbon Message instances whose prototype getters already resolve
  if (Object.getPrototypeOf(mutableMessage) !== Object.prototype) {
    return;
  }

  const rawValue = mutableMessage._rawData ?? mutableMessage.rawData;
  const raw =
    rawValue && typeof rawValue === "object" ? (rawValue as Record<string, unknown>) : null;
  if (!raw) {
    return;
  }

  // Hoist all raw fields that are not already own properties
  for (const field of Object.keys(raw)) {
    if (raw[field] !== undefined && !Object.prototype.hasOwnProperty.call(mutableMessage, field)) {
      mutableMessage[field] = raw[field];
    }
  }

  // Create camelCase aliases that Carbon Message getters would normally provide
  const camelAliases: Record<string, string> = {
    mentions: "mentionedUsers",
    mention_roles: "mentionedRoles",
    mention_everyone: "mentionedEveryone",
    referenced_message: "referencedMessage",
    edited_timestamp: "editedTimestamp",
    sticker_items: "stickerItems",
  };
  for (const [snake, camel] of Object.entries(camelAliases)) {
    if (mutableMessage[snake] !== undefined && mutableMessage[camel] === undefined) {
      mutableMessage[camel] = mutableMessage[snake];
    }
  }
}
