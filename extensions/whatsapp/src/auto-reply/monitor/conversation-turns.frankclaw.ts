/**
 * Frankclaw extension: Rolling conversation turn memory for WhatsApp.
 *
 * Maintains a per-chat record of recent user+assistant exchanges so that
 * follow-up messages (e.g. "Nope just this one") can be interpreted in
 * the context of the prior conversation, even after the group history
 * buffer has been cleared.
 *
 * This is separate from groupHistories (which stores gated/skipped messages
 * between bot replies). conversationTurns stores completed exchanges where
 * the bot actually replied.
 */

// frankclaw: conversation turn memory

export const CONVERSATION_TURNS_MARKER = "[Recent conversation history - for context]";
export const CONVERSATION_TURNS_END_MARKER = "[/Recent conversation history]";

export type ConversationTurn = {
  /** The user's original message text (combined body sent to agent) */
  userMessage: string;
  /** The bot's reply text (concatenated if chunked) */
  botReply: string;
  /** Timestamp of the exchange */
  timestamp: number;
  /** Sender display name for the user message */
  senderLabel?: string;
};

/** Default maximum number of conversation turns to retain per chat. */
export const DEFAULT_MAX_CONVERSATION_TURNS = 5;

/** Maximum number of chat keys to track (LRU eviction). */
const MAX_CONVERSATION_TURN_KEYS = 500;

/**
 * In-memory store of conversation turns, keyed by groupHistoryKey (same
 * key space used for groupHistories so lookups are consistent).
 */
const conversationTurnsMap = new Map<string, ConversationTurn[]>();

/**
 * Record a completed conversation turn (user message + bot reply).
 * Called after the bot has finished replying.
 */
export function recordConversationTurn(params: {
  chatKey: string;
  userMessage: string;
  botReply: string;
  timestamp: number;
  senderLabel?: string;
  maxTurns?: number;
}): void {
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_CONVERSATION_TURNS;
  if (maxTurns <= 0) {
    return;
  }

  const turns = conversationTurnsMap.get(params.chatKey) ?? [];
  turns.push({
    userMessage: params.userMessage,
    botReply: params.botReply,
    timestamp: params.timestamp,
    senderLabel: params.senderLabel,
  });

  // Evict oldest turns if over limit
  while (turns.length > maxTurns) {
    turns.shift();
  }

  // Refresh insertion order for LRU
  if (conversationTurnsMap.has(params.chatKey)) {
    conversationTurnsMap.delete(params.chatKey);
  }
  conversationTurnsMap.set(params.chatKey, turns);

  // Evict oldest chat keys if map exceeds max size
  if (conversationTurnsMap.size > MAX_CONVERSATION_TURN_KEYS) {
    const keysToDelete = conversationTurnsMap.size - MAX_CONVERSATION_TURN_KEYS;
    const iterator = conversationTurnsMap.keys();
    for (let i = 0; i < keysToDelete; i++) {
      const key = iterator.next().value;
      if (key !== undefined) {
        conversationTurnsMap.delete(key);
      }
    }
  }
}

/**
 * Retrieve stored conversation turns for a chat.
 */
export function getConversationTurns(chatKey: string): ConversationTurn[] {
  return conversationTurnsMap.get(chatKey) ?? [];
}

/**
 * Clear conversation turns for a chat (e.g. on session reset).
 */
export function clearConversationTurns(chatKey: string): void {
  conversationTurnsMap.delete(chatKey);
}

/**
 * Format conversation turns into a context block that can be prepended
 * to the inbound message body for the agent.
 */
export function buildConversationTurnsContext(params: {
  turns: ConversationTurn[];
  formatUserMessage?: (turn: ConversationTurn) => string;
  formatBotReply?: (turn: ConversationTurn) => string;
}): string {
  const { turns } = params;
  if (turns.length === 0) {
    return "";
  }

  const lines: string[] = [CONVERSATION_TURNS_MARKER];
  for (const turn of turns) {
    const userLine = params.formatUserMessage
      ? params.formatUserMessage(turn)
      : `${turn.senderLabel ?? "User"}: ${turn.userMessage}`;
    const botLine = params.formatBotReply
      ? params.formatBotReply(turn)
      : `Assistant: ${turn.botReply}`;
    lines.push(userLine);
    lines.push(botLine);
    lines.push("");
  }
  lines.push(CONVERSATION_TURNS_END_MARKER);

  return lines.join("\n");
}

/**
 * Prepend conversation turns context to a message body.
 * Returns the original body if there are no turns.
 */
export function prependConversationTurnsToBody(params: {
  chatKey: string;
  currentBody: string;
  formatUserMessage?: (turn: ConversationTurn) => string;
  formatBotReply?: (turn: ConversationTurn) => string;
}): string {
  const turns = getConversationTurns(params.chatKey);
  if (turns.length === 0) {
    return params.currentBody;
  }

  const turnsContext = buildConversationTurnsContext({
    turns,
    formatUserMessage: params.formatUserMessage,
    formatBotReply: params.formatBotReply,
  });

  return `${turnsContext}\n\n${params.currentBody}`;
}

/** Exposed for testing: get the raw Map instance. */
export function __getConversationTurnsMap(): Map<string, ConversationTurn[]> {
  return conversationTurnsMap;
}

/** Exposed for testing: clear all conversation turns across all chats. */
export function __clearAllConversationTurns(): void {
  conversationTurnsMap.clear();
}
