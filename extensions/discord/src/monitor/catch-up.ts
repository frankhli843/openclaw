import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../../../src/config/paths.js";
import { formatErrorMessage } from "../../../../src/infra/errors.js";
import { createSubsystemLogger } from "../../../../src/logging/subsystem.js";

const logger = createSubsystemLogger("discord/catch-up");

const LAST_SEEN_DIR = "discord-last-seen";
const CATCH_UP_MAX_MESSAGES = 100;
const CATCH_UP_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

const DISCORD_API_BASE = "https://discord.com/api/v10";

type LastSeenMarker = {
  messageId: string;
  updatedAt: string;
};

type DiscordRestMessage = {
  id: string;
  channel_id: string;
  author: { id: string; bot?: boolean; username?: string };
  content?: string;
  timestamp: string;
  thread?: { id: string };
  thread_id?: string;
  attachments?: unknown[];
  embeds?: unknown[];
  [key: string]: unknown;
};

export type DiscordInboundQueueRef = {
  enqueue(input: {
    channelId: string;
    messageId: string;
    orderingKey: string;
    payload: unknown;
  }): Promise<{ enqueued: boolean; dedupeKey: string }>;
};

export type RunDiscordCatchUpParams = {
  token: string;
  botUserId?: string;
  queue: DiscordInboundQueueRef;
  stateDir?: string;
  restFetch?: typeof fetch;
  now?: () => number;
};

export type RunDiscordCatchUpResult = {
  recovered: number;
  channels: number;
};

function resolveLastSeenDir(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(), LAST_SEEN_DIR);
}

function resolveLastSeenPath(channelId: string, stateDir?: string): string {
  return path.join(resolveLastSeenDir(stateDir), `${channelId}.json`);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

/**
 * Atomically write a last-seen marker file for a channel.
 */
export async function updateLastSeenMessage(
  channelId: string,
  messageId: string,
  stateDir?: string,
): Promise<void> {
  const filePath = resolveLastSeenPath(channelId, stateDir);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const marker: LastSeenMarker = {
    messageId,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(filePath, marker);
}

/**
 * Load all last-seen marker files from the state directory.
 * Returns a Map of channelId → messageId.
 */
export async function loadLastSeenMessages(stateDir?: string): Promise<Map<string, string>> {
  const dir = resolveLastSeenDir(stateDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return new Map();
    }
    throw err;
  }

  const result = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const channelId = entry.slice(0, -5); // remove .json suffix
    const filePath = path.join(dir, entry);
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { messageId?: unknown };
      const messageId = typeof parsed.messageId === "string" ? parsed.messageId : null;
      if (messageId) {
        result.set(channelId, messageId);
      }
    } catch {
      // Corrupt or unreadable marker file — skip silently
    }
  }
  return result;
}

/**
 * Fetch missed Discord messages for all tracked channels and enqueue them into
 * the durable inbound queue. Called on READY and RESUMED gateway events.
 */
export async function runDiscordCatchUp(
  params: RunDiscordCatchUpParams,
): Promise<RunDiscordCatchUpResult> {
  const { token, botUserId, queue, stateDir, restFetch = fetch, now = () => Date.now() } = params;

  const markers = await loadLastSeenMessages(stateDir);
  if (markers.size === 0) {
    return { recovered: 0, channels: 0 };
  }

  let totalRecovered = 0;
  let channelsWithRecovery = 0;
  const cutoffMs = now() - CATCH_UP_MAX_AGE_MS;

  for (const [channelId, lastMessageId] of markers) {
    try {
      const url = `${DISCORD_API_BASE}/channels/${channelId}/messages?after=${lastMessageId}&limit=${CATCH_UP_MAX_MESSAGES}`;
      let response: Response;
      try {
        response = await restFetch(url, {
          headers: {
            Authorization: `Bot ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (err) {
        logger.warn(
          `catch-up: network error fetching channel ${channelId}: ${formatErrorMessage(err)}`,
        );
        continue;
      }

      if (response.status === 404 || response.status === 403) {
        // Channel deleted or bot lacks access — skip without error
        continue;
      }

      if (!response.ok) {
        logger.warn(`catch-up: failed to fetch channel ${channelId}: HTTP ${response.status}`);
        continue;
      }

      let messages: unknown;
      try {
        messages = await response.json();
      } catch (err) {
        logger.warn(
          `catch-up: failed to parse response for channel ${channelId}: ${formatErrorMessage(err)}`,
        );
        continue;
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }

      const rawMessages = messages as DiscordRestMessage[];

      // Filter: skip bot's own messages and messages beyond the age cutoff
      const eligible = rawMessages.filter((msg) => {
        if (!msg || typeof msg !== "object") {
          return false;
        }
        if (botUserId && msg.author?.id === botUserId) {
          return false;
        }
        if (msg.author?.bot === true) {
          return false;
        }
        const ts = Date.parse(msg.timestamp);
        if (Number.isNaN(ts) || ts < cutoffMs) {
          return false;
        }
        return true;
      });

      // Sort oldest first (API returns newest first with `after` param)
      eligible.sort((a, b) => {
        if (a.id < b.id) {
          return -1;
        }
        if (a.id > b.id) {
          return 1;
        }
        return 0;
      });

      // Track the newest message ID we've seen (even if filtered out)
      const newestFromApi = rawMessages.reduce(
        (max, msg) => (msg.id > max ? msg.id : max),
        lastMessageId,
      );

      let channelRecovered = 0;

      for (const msg of eligible) {
        const threadId = msg.thread?.id ?? msg.thread_id;
        const orderingKey = threadId ? `${channelId}:${threadId}` : channelId;

        // Construct a payload that matches the shape the message handler expects
        const payload = {
          channel_id: channelId,
          message: {
            id: msg.id,
            channel_id: channelId,
            author: msg.author,
            content: msg.content,
            timestamp: msg.timestamp,
            attachments: msg.attachments ?? [],
            embeds: msg.embeds ?? [],
            thread: msg.thread,
            thread_id: msg.thread_id,
            rawData: { ...msg },
          },
          author: msg.author,
          rawMessage: { ...msg },
          rawAuthor: msg.author,
        };

        try {
          const result = await queue.enqueue({
            channelId,
            messageId: msg.id,
            orderingKey,
            payload,
          });
          if (result.enqueued) {
            channelRecovered++;
            totalRecovered++;
          }
        } catch (err) {
          logger.warn(
            `catch-up: failed to enqueue message ${msg.id} in channel ${channelId}: ${formatErrorMessage(err)}`,
          );
        }
      }

      // Advance the marker to the newest message we saw from the API
      if (newestFromApi > lastMessageId) {
        try {
          await updateLastSeenMessage(channelId, newestFromApi, stateDir);
        } catch (err) {
          logger.warn(
            `catch-up: failed to update marker for channel ${channelId}: ${formatErrorMessage(err)}`,
          );
        }
      }

      if (channelRecovered > 0) {
        channelsWithRecovery++;
      }
    } catch (err) {
      logger.warn(`catch-up: error processing channel ${channelId}: ${formatErrorMessage(err)}`);
    }
  }

  if (totalRecovered > 0) {
    logger.info(
      `catch-up: recovered ${totalRecovered} messages across ${channelsWithRecovery} channels`,
    );
  }

  return { recovered: totalRecovered, channels: channelsWithRecovery };
}
