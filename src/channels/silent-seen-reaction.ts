/**
 * Silent-seen reaction: when the agent replies NO_REPLY, place a 👀 on the
 * triggering message and remove any previous 👀 from the same conversation.
 *
 * This gives users visual feedback that the agent saw their message even when
 * it chose not to reply.  The reaction "roams" — only the latest silent message
 * in each conversation carries the 👀.
 *
 * Channel-agnostic: each channel provides an adapter with add/remove helpers.
 */

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

// ─── State ───────────────────────────────────────────────────────────────────

/** conversationId → messageId of the last 👀'd message */
const lastSeenByConversation = new Map<string, string>();

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

  const previousMessageId = lastSeenByConversation.get(conversationId);

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
    lastSeenByConversation.set(conversationId, messageId);
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
  const previousMessageId = lastSeenByConversation.get(options.conversationId);

  if (previousMessageId) {
    lastSeenByConversation.delete(options.conversationId);
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
  return lastSeenByConversation.get(conversationId);
}

/** @internal — for tests only */
export function _clearAllTracking(): void {
  lastSeenByConversation.clear();
}
