import type { Client } from "@buape/carbon";
/**
 * Discord thread history fetcher.
 *
 * Fetches thread messages from a Discord thread channel and formats a compact
 * "thread start" context block for prompt injection. Analogous to Slack's
 * `resolveSlackThreadHistory` but uses Discord's channel messages endpoint.
 *
 * Output policy: include only the original thread message and the first reply
 * (oldest two messages), wrapped in <thread_starting_messages> tags.
 */
import { Routes } from "discord-api-types/v10";
import {
  formatInboundEnvelope,
  type EnvelopeFormatOptions,
} from "../../../../src/auto-reply/envelope.js";
import { logVerbose } from "../../../../src/globals.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscordThreadMessage = {
  id: string;
  content: string;
  authorName: string;
  authorId: string;
  isBot: boolean;
  timestamp: number | undefined;
};

export type DiscordThreadHistoryResult = {
  messages: DiscordThreadMessage[];
  threadHistoryBody: string | undefined;
};

// Raw shape returned by Discord REST API (subset of fields we use)
type RawDiscordMessage = {
  id: string;
  content?: string | null;
  author?: {
    id?: string | null;
    username?: string | null;
    discriminator?: string | null;
    bot?: boolean;
    global_name?: string | null;
  };
  member?: {
    nick?: string | null;
    displayName?: string | null;
  };
  timestamp?: string | null;
  embeds?: Array<{ title?: string | null; description?: string | null }>;
  type?: number;
};

// ---------------------------------------------------------------------------
// Cache (short TTL to avoid hammering Discord API on rapid messages)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000; // 30 seconds
const CACHE_MAX_ENTRIES = 200;

type CacheEntry = {
  messages: DiscordThreadMessage[];
  updatedAt: number;
};

const threadHistoryCache = new Map<string, CacheEntry>();

export function __resetDiscordThreadHistoryCacheForTest(): void {
  threadHistoryCache.clear();
}

function getCached(threadId: string, now: number): DiscordThreadMessage[] | undefined {
  const entry = threadHistoryCache.get(threadId);
  if (!entry) {
    return undefined;
  }
  if (now - entry.updatedAt > CACHE_TTL_MS) {
    threadHistoryCache.delete(threadId);
    return undefined;
  }
  return entry.messages;
}

function setCache(threadId: string, messages: DiscordThreadMessage[], now: number): void {
  threadHistoryCache.delete(threadId); // refresh LRU position
  threadHistoryCache.set(threadId, { messages, updatedAt: now });
  while (threadHistoryCache.size > CACHE_MAX_ENTRIES) {
    const first = threadHistoryCache.keys().next();
    if (first.done) {
      break;
    }
    threadHistoryCache.delete(first.value);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Include only the thread starter + first reply for prompt context. */
const THREAD_STARTING_MESSAGES_MAX = 2;

/** Discord API max per page. */
const DISCORD_FETCH_LIMIT = 100;

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch all messages from a Discord thread channel, oldest first.
 * Optionally excludes a specific message (by `excludeMessageId`).
 */
export async function fetchDiscordThreadMessages(params: {
  client: Client;
  threadChannelId: string;
  excludeMessageId?: string;
  botUserId?: string;
}): Promise<DiscordThreadMessage[]> {
  const { client, threadChannelId } = params;
  const excludeMessageId = params.excludeMessageId;
  const allMessages: RawDiscordMessage[] = [];

  try {
    // Fetch pages of messages. Discord returns newest-first, so we use
    // `before` cursor to paginate backwards through the thread.
    let beforeId: string | undefined;
    let done = false;

    while (!done) {
      const query = new URLSearchParams({ limit: String(DISCORD_FETCH_LIMIT) });
      if (beforeId) {
        query.set("before", beforeId);
      }

      const url = `${Routes.channelMessages(threadChannelId)}?${query.toString()}`;
      const page = (await client.rest.get(url)) as RawDiscordMessage[];

      if (!Array.isArray(page) || page.length === 0) {
        done = true;
        break;
      }

      allMessages.push(...page);
      beforeId = page[page.length - 1]?.id;

      // If we got fewer than the limit, we've reached the beginning.
      if (page.length < DISCORD_FETCH_LIMIT) {
        done = true;
      }

      // Safety: cap at 500 messages total to avoid runaway fetches.
      if (allMessages.length >= 500) {
        done = true;
      }
    }
  } catch (err) {
    logVerbose?.(
      `discord thread-history: failed to fetch messages for thread ${threadChannelId}: ${String(err)}`,
    );
    return [];
  }

  // Discord returns newest first; reverse to get chronological order.
  allMessages.reverse();

  // Filter and map
  const result: DiscordThreadMessage[] = [];
  for (const msg of allMessages) {
    if (!msg || typeof msg !== "object") {
      continue;
    }
    // Skip the current inbound message
    if (excludeMessageId && msg.id === excludeMessageId) {
      continue;
    }
    // Skip thread-created system messages (type 21)
    if (msg.type === 21) {
      continue;
    }

    const content = msg.content?.trim() ?? "";
    const embedText = resolveEmbedText(msg.embeds);
    const text = content || embedText;
    // Skip messages with no text content
    if (!text) {
      continue;
    }

    const authorName = resolveAuthorName(msg);
    const authorId = msg.author?.id ?? "unknown";
    const isBot = msg.author?.bot === true;
    const timestamp = msg.timestamp ? Date.parse(msg.timestamp) : undefined;

    result.push({
      id: msg.id,
      content: text,
      authorName,
      authorId,
      isBot,
      timestamp: timestamp && !Number.isNaN(timestamp) ? timestamp : undefined,
    });
  }

  return result;
}

function resolveEmbedText(
  embeds?: Array<{ title?: string | null; description?: string | null }>,
): string {
  if (!embeds || embeds.length === 0) {
    return "";
  }
  const first = embeds[0];
  const parts = [first.title, first.description].filter(Boolean);
  return parts.join("\n");
}

function resolveAuthorName(msg: RawDiscordMessage): string {
  return (
    msg.member?.nick ??
    msg.member?.displayName ??
    msg.author?.global_name ??
    msg.author?.username ??
    msg.author?.id ??
    "Unknown"
  );
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

export function selectThreadStartingMessages(
  messages: DiscordThreadMessage[],
): DiscordThreadMessage[] {
  return messages.slice(0, THREAD_STARTING_MESSAGES_MAX);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format thread messages into a string suitable for `ThreadHistoryBody`.
 */
export function formatDiscordThreadHistory(params: {
  messages: DiscordThreadMessage[];
  envelopeOptions?: EnvelopeFormatOptions;
  botUserId?: string;
}): string | undefined {
  const { messages, envelopeOptions, botUserId } = params;
  if (messages.length === 0) {
    return undefined;
  }

  const kept = selectThreadStartingMessages(messages);

  const parts: string[] = [];
  for (const msg of kept) {
    const isBot = msg.isBot || (botUserId != null && msg.authorId === botUserId);
    const role = isBot ? "assistant" : "user";
    const senderLabel = `${msg.authorName} (${role})`;

    parts.push(
      formatInboundEnvelope({
        channel: "Discord",
        from: senderLabel,
        timestamp: msg.timestamp,
        body: `${msg.content}\n[discord message id: ${msg.id}]`,
        chatType: "channel",
        senderLabel,
        envelope: envelopeOptions,
      }),
    );
  }

  const body = parts.join("\n\n");
  return `<thread_starting_messages>\n${body}\n</thread_starting_messages>`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Resolve full thread history for a Discord thread channel.
 * Called on every message in a thread to ensure the agent always has
 * full thread context (older session history may be pruned from context window).
 *
 * Uses a short TTL cache to avoid excessive API calls on rapid messages.
 */
export async function resolveDiscordThreadHistory(params: {
  client: Client;
  threadChannelId: string;
  currentMessageId: string;
  botUserId?: string;
  envelopeOptions?: EnvelopeFormatOptions;
}): Promise<string | undefined> {
  const { client, threadChannelId, currentMessageId, botUserId, envelopeOptions } = params;
  const now = Date.now();

  // Check cache first — cache stores ALL messages (unfiltered)
  let allMessages = getCached(threadChannelId, now);
  if (!allMessages) {
    allMessages = await fetchDiscordThreadMessages({
      client,
      threadChannelId,
      // Do NOT exclude here — cache needs the full set
      botUserId,
    });
    setCache(threadChannelId, allMessages, now);
  }

  // Filter out the current inbound message
  const messages = allMessages.filter((m) => m.id !== currentMessageId);

  if (messages.length === 0) {
    return undefined;
  }

  return formatDiscordThreadHistory({
    messages,
    envelopeOptions,
    botUserId,
  });
}
