/**
 * Silent-seen reaction: when the agent replies NO_REPLY, place a 👀 on the
 * triggering message and remove any previous 👀 from the same conversation.
 *
 * This gives users visual feedback that the agent saw their message even when
 * it chose not to reply.  The reaction "roams" — only the latest silent message
 * in each conversation carries the 👀.
 *
 * Channel-agnostic: each channel provides an adapter with add/remove helpers.
 *
 * Tracking is persisted to disk so old 👀 reactions are cleaned up even after
 * a gateway restart.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { logVerbose } from "../globals.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SilentSeenAdapter = {
  /** Add a reaction emoji to a specific message. */
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  /** Remove a reaction emoji from a specific message. */
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
};

export type SilentSeenOptions = {
  /** Conversation / channel identifier (used as the tracking key). */
  conversationId: string;
  /** The message that triggered the NO_REPLY. */
  messageId: string;
  /** Channel-specific adapter for reaction add/remove. */
  adapter: SilentSeenAdapter;
  /** Emoji to use (default: 👀). */
  emoji?: string;
  /** Logging helper (default: logVerbose). */
  log?: (msg: string) => void;
};

// ─── Persistence ─────────────────────────────────────────────────────────────

/** Override for tests — when set, skip disk I/O entirely. */
let _persistenceDisabled = false;

function getTrackingFilePath(): string {
  return path.join(resolveStateDir(), "silent-seen-tracking.json");
}

function loadFromDisk(log: (msg: string) => void): Map<string, string> {
  if (_persistenceDisabled) {
    return new Map();
  }
  try {
    const filePath = getTrackingFilePath();
    if (!fs.existsSync(filePath)) {
      return new Map();
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: Record<string, string> = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (err) {
    log(`silent-seen: failed to load tracking from disk: ${String(err)}`);
    return new Map();
  }
}

function saveToDisk(map: Map<string, string>, log: (msg: string) => void): void {
  if (_persistenceDisabled) {
    return;
  }
  try {
    const filePath = getTrackingFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = Object.fromEntries(map);
    fs.writeFileSync(filePath, JSON.stringify(data), "utf-8");
  } catch (err) {
    log(`silent-seen: failed to save tracking to disk: ${String(err)}`);
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

/** conversationId → messageId of the last 👀'd message */
let lastSeenByConversation: Map<string, string> | null = null;
let _diskLoaded = false;

function getMap(log: (msg: string) => void): Map<string, string> {
  if (!_diskLoaded) {
    lastSeenByConversation = loadFromDisk(log);
    _diskLoaded = true;
  }
  return lastSeenByConversation!;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Mark a message as "silently seen" — add 👀 and remove from any previous
 * message in the same conversation.  Best-effort; failures are logged, not
 * thrown.
 */
export async function markSilentSeen(options: SilentSeenOptions): Promise<void> {
  const emoji = options.emoji ?? "👀";
  const log = options.log ?? logVerbose;
  const { conversationId, messageId, adapter } = options;

  const map = getMap(log);
  const previousMessageId = map.get(conversationId);

  log(
    `silent-seen: conversation=${conversationId} current=${messageId} previous=${previousMessageId ?? "none"}`,
  );

  // Remove from previous message (best-effort, fire-and-forget errors)
  if (previousMessageId && previousMessageId !== messageId) {
    try {
      log(`silent-seen: removing ${emoji} from previous message ${previousMessageId}`);
      await adapter.removeReaction(previousMessageId, emoji);
      log(`silent-seen: removed ${emoji} from previous message ${previousMessageId}`);
    } catch (err) {
      log(
        `silent-seen: failed to remove ${emoji} from previous message ${previousMessageId}: ${String(err)}`,
      );
    }
  }

  // Add to current message
  try {
    log(`silent-seen: adding ${emoji} to message ${messageId}`);
    await adapter.addReaction(messageId, emoji);
    map.set(conversationId, messageId);
    saveToDisk(map, log);
    log(`silent-seen: added ${emoji} to message ${messageId}`);
  } catch (err) {
    log(`silent-seen: failed to add ${emoji} to message ${messageId}: ${String(err)}`);
  }
}

/**
 * Clear tracking for a conversation (e.g. when the agent sends a real reply,
 * remove any lingering 👀).
 */
export async function clearSilentSeen(options: {
  conversationId: string;
  adapter: SilentSeenAdapter;
  emoji?: string;
  log?: (msg: string) => void;
}): Promise<void> {
  const emoji = options.emoji ?? "👀";
  const log = options.log ?? logVerbose;
  const map = getMap(log);
  const previousMessageId = map.get(options.conversationId);

  if (previousMessageId) {
    map.delete(options.conversationId);
    saveToDisk(map, log);
    try {
      await options.adapter.removeReaction(previousMessageId, emoji);
    } catch (err) {
      log(`silent-seen: failed to clear ${emoji} from ${previousMessageId}: ${String(err)}`);
    }
  }
}

// ─── Testing helpers ─────────────────────────────────────────────────────────

/** @internal — for tests only */
export function _getTrackedMessageId(conversationId: string): string | undefined {
  return getMap(logVerbose).get(conversationId);
}

/** @internal — for tests only */
export function _clearAllTracking(): void {
  if (lastSeenByConversation) {
    lastSeenByConversation.clear();
  }
  _diskLoaded = false;
}

/** @internal — for tests only: disable disk persistence */
export function _disablePersistence(): void {
  _persistenceDisabled = true;
}

/** @internal — for tests only: re-enable disk persistence */
export function _enablePersistence(): void {
  _persistenceDisabled = false;
}
