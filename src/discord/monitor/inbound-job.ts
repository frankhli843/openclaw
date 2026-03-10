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
  const ctx = {
    ...job.payload,
    ...job.runtime,
    abortSignal: abortSignal ?? job.runtime.abortSignal,
  };

  // After a JSON round-trip through the durable queue, Carbon `Message`
  // instances become plain objects.  Carbon exposes many API fields
  // (attachments, embeds, content, sticker_items, …) via prototype getters
  // that read from `_rawData`.  Those getters are lost during serialisation,
  // so downstream code that reads `message.attachments` gets `undefined`.
  //
  // Fix: hoist the most-used _rawData fields onto the plain object so the
  // rest of the pipeline works identically for both live and durable paths.
  if (ctx.message) {
    rehydrateCarbonMessage(ctx.message);
  }
  if (ctx.data?.message && ctx.data.message !== ctx.message) {
    rehydrateCarbonMessage(ctx.data.message);
  }

  return ctx;
}

/**
 * Hoist Carbon `_rawData` getter-backed fields onto a plain object so they
 * are accessible as own properties after JSON round-trip.  No-ops if the
 * message is still a live Carbon instance (getters already work).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rehydrateCarbonMessage(message: any): void {
  if (!message || typeof message !== "object") {
    return;
  }

  // Skip if this is still a live Carbon Message (has prototype getters)
  const proto = Object.getPrototypeOf(message);
  if (proto && proto.constructor?.name === "Message") {
    return;
  }

  const raw = message._rawData;
  if (!raw || typeof raw !== "object") {
    return;
  }

  // Fields that Carbon exposes via getters and the downstream pipeline reads.
  const CARBON_GETTER_FIELDS = [
    "attachments",
    "content",
    "embeds",
    "components",
    "sticker_items",
    "flags",
    "pinned",
    "tts",
    "type",
    "mention_everyone",
    "mentions",
    "mention_roles",
    "edited_timestamp",
    "position",
  ] as const;

  for (const field of CARBON_GETTER_FIELDS) {
    if (!(field in message) && field in raw) {
      message[field] = raw[field];
    }
  }
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
