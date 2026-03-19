import type { DiscordMessagePreflightContext } from "./message-handler.preflight.types.js";

type DiscordInboundJobRuntimeField =
  | "runtime"
  | "abortSignal"
  | "guildHistories"
  | "client"
  | "threadBindings"
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
};

export function resolveDiscordInboundJobQueueKey(ctx: DiscordMessagePreflightContext): string {
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

export function buildDiscordInboundJob(ctx: DiscordMessagePreflightContext): DiscordInboundJob {
  const {
    runtime,
    abortSignal,
    guildHistories,
    client,
    threadBindings,
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
      discordRestFetch,
    },
  };
}

export function materializeDiscordInboundJob(
  job: DiscordInboundJob,
  abortSignal?: AbortSignal,
): DiscordMessagePreflightContext {
  return {
    ...job.payload,
    ...job.runtime,
    abortSignal: abortSignal ?? job.runtime.abortSignal,
  };
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
  return {
    id: threadChannel.id,
    name: threadChannel.name,
    parentId: threadChannel.parentId,
    parent: threadChannel.parent
      ? {
          id: threadChannel.parent.id,
          name: threadChannel.parent.name,
        }
      : undefined,
    ownerId: threadChannel.ownerId,
  };
}

/**
 * After JSON round-trip through the durable queue, Carbon Message getter fields
 * (attachments, embeds, content, …) live only inside `_rawData`.
 * Hoist them so downstream code that reads `message.attachments` works.
 */
export function rehydrateCarbonMessage(message: any): void {
  if (!message || typeof message !== "object") {
    return;
  }
  const raw = message._rawData ?? message.rawData;
  if (!raw || typeof raw !== "object") {
    return;
  }
  const fields = ["attachments", "embeds", "content", "author", "member", "mentions", "sticker_items"];
  for (const field of fields) {
    if (raw[field] !== undefined && message[field] === undefined) {
      message[field] = raw[field];
    }
  }
}
