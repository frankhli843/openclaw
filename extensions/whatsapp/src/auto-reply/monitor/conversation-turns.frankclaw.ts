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
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

/** Maximum persisted user/bot text per side. Keeps prompts and state bounded. */
const MAX_TURN_TEXT_CHARS = 6000;

const CONVERSATION_TURNS_STORE =
  process.env.OPENCLAW_WHATSAPP_CONVERSATION_TURNS_STORE ||
  (process.env.VITEST || process.env.VITEST_WORKER_ID
    ? join(tmpdir(), `whatsapp-conversation-turns-vitest-${process.pid}.jsonl`)
    : join(
        process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace"),
        "state",
        "whatsapp-conversation-turns.jsonl",
      ));

const WHATSAPP_CONTEXT_DIAG_LOG =
  process.env.OPENCLAW_WHATSAPP_CONTEXT_DIAG_LOG ||
  (process.env.VITEST || process.env.VITEST_WORKER_ID
    ? join(tmpdir(), `whatsapp-context-diag-vitest-${process.pid}.log`)
    : join(
        process.env.OPENCLAW_WORKSPACE || join(homedir(), ".openclaw", "workspace"),
        "state",
        "whatsapp-context-diag.log",
      ));

const STATE_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * In-memory store of conversation turns, keyed by groupHistoryKey (same
 * key space used for groupHistories so lookups are consistent).
 */
const conversationTurnsMap = new Map<string, ConversationTurn[]>();
let conversationTurnsLoaded = false;

type PersistedConversationTurnEvent = {
  v: 1;
  type: "turn";
  chatKey: string;
  turn: ConversationTurn;
  maxTurns?: number;
};

function hashChatKey(chatKey: string): string {
  return createHash("sha256").update(chatKey).digest("hex").slice(0, 12);
}

function whatsappContextDiag(message: string): void {
  try {
    mkdirSync(dirname(WHATSAPP_CONTEXT_DIAG_LOG), { recursive: true });
    try {
      const st = statSync(WHATSAPP_CONTEXT_DIAG_LOG);
      if (st.size > STATE_FILE_MAX_BYTES) {
        try {
          unlinkSync(`${WHATSAPP_CONTEXT_DIAG_LOG}.old`);
        } catch {
          // old log may not exist
        }
        renameSync(WHATSAPP_CONTEXT_DIAG_LOG, `${WHATSAPP_CONTEXT_DIAG_LOG}.old`);
      }
    } catch {
      // log may not exist yet
    }
    appendFileSync(WHATSAPP_CONTEXT_DIAG_LOG, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Diagnostics must never break WhatsApp replies.
  }
}

function truncateTurnText(value: string): string {
  const cleaned = value.replaceAll("\u0000", "");
  if (cleaned.length <= MAX_TURN_TEXT_CHARS) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_TURN_TEXT_CHARS)}...[truncated]`;
}

function normalizeTurn(turn: ConversationTurn): ConversationTurn {
  const normalized: ConversationTurn = {
    userMessage: truncateTurnText(turn.userMessage),
    botReply: truncateTurnText(turn.botReply),
    timestamp: turn.timestamp,
  };
  if (turn.senderLabel !== undefined) {
    normalized.senderLabel = truncateTurnText(turn.senderLabel);
  }
  return normalized;
}

function addTurnToMemory(params: {
  chatKey: string;
  turn: ConversationTurn;
  maxTurns?: number;
}): void {
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_CONVERSATION_TURNS;
  if (maxTurns <= 0) {
    return;
  }

  const turns = conversationTurnsMap.get(params.chatKey) ?? [];
  turns.push(normalizeTurn(params.turn));

  while (turns.length > maxTurns) {
    turns.shift();
  }

  // Refresh insertion order for LRU.
  if (conversationTurnsMap.has(params.chatKey)) {
    conversationTurnsMap.delete(params.chatKey);
  }
  conversationTurnsMap.set(params.chatKey, turns);

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

function persistConversationTurnsSnapshot(): void {
  mkdirSync(dirname(CONVERSATION_TURNS_STORE), { recursive: true });
  const lines: string[] = [];
  for (const [chatKey, turns] of conversationTurnsMap.entries()) {
    for (const turn of turns) {
      const event: PersistedConversationTurnEvent = {
        v: 1,
        type: "turn",
        chatKey,
        turn,
      };
      lines.push(JSON.stringify(event));
    }
  }
  const tmpPath = `${CONVERSATION_TURNS_STORE}.${process.pid}.tmp`;
  writeFileSync(tmpPath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
  renameSync(tmpPath, CONVERSATION_TURNS_STORE);
  whatsappContextDiag(`snapshot turns=${lines.length} chats=${conversationTurnsMap.size}`);
}

function appendPersistedTurn(params: {
  chatKey: string;
  turn: ConversationTurn;
  maxTurns?: number;
}): void {
  try {
    mkdirSync(dirname(CONVERSATION_TURNS_STORE), { recursive: true });
    try {
      const st = statSync(CONVERSATION_TURNS_STORE);
      if (st.size > STATE_FILE_MAX_BYTES) {
        persistConversationTurnsSnapshot();
        return;
      }
    } catch {
      // store may not exist yet
    }
    const event: PersistedConversationTurnEvent = {
      v: 1,
      type: "turn",
      chatKey: params.chatKey,
      turn: params.turn,
      maxTurns: params.maxTurns,
    };
    appendFileSync(CONVERSATION_TURNS_STORE, `${JSON.stringify(event)}\n`);
  } catch (err) {
    whatsappContextDiag(
      `persist_failed chat=${hashChatKey(params.chatKey)} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function ensureConversationTurnsLoaded(): void {
  if (conversationTurnsLoaded) {
    return;
  }
  conversationTurnsLoaded = true;
  try {
    if (!existsSync(CONVERSATION_TURNS_STORE)) {
      return;
    }
    const raw = readFileSync(CONVERSATION_TURNS_STORE, "utf8");
    let loaded = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as PersistedConversationTurnEvent).v !== 1 ||
        (parsed as PersistedConversationTurnEvent).type !== "turn"
      ) {
        continue;
      }
      const event = parsed as PersistedConversationTurnEvent;
      if (
        typeof event.chatKey !== "string" ||
        !event.turn ||
        typeof event.turn.userMessage !== "string" ||
        typeof event.turn.botReply !== "string" ||
        typeof event.turn.timestamp !== "number"
      ) {
        continue;
      }
      addTurnToMemory({
        chatKey: event.chatKey,
        turn: event.turn,
        maxTurns: event.maxTurns,
      });
      loaded += 1;
    }
    whatsappContextDiag(`load_success turns=${loaded} chats=${conversationTurnsMap.size}`);
  } catch (err) {
    whatsappContextDiag(`load_failed err=${err instanceof Error ? err.message : String(err)}`);
  }
}

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
  ensureConversationTurnsLoaded();
  if ((params.maxTurns ?? DEFAULT_MAX_CONVERSATION_TURNS) <= 0) {
    return;
  }

  const turn = normalizeTurn({
    userMessage: params.userMessage,
    botReply: params.botReply,
    timestamp: params.timestamp,
    senderLabel: params.senderLabel,
  });
  addTurnToMemory({ chatKey: params.chatKey, turn, maxTurns: params.maxTurns });
  appendPersistedTurn({ chatKey: params.chatKey, turn, maxTurns: params.maxTurns });
  whatsappContextDiag(
    `record chat=${hashChatKey(params.chatKey)} turns=${conversationTurnsMap.get(params.chatKey)?.length ?? 0}`,
  );
}

/**
 * Retrieve stored conversation turns for a chat.
 */
export function getConversationTurns(chatKey: string): ConversationTurn[] {
  ensureConversationTurnsLoaded();
  return [...(conversationTurnsMap.get(chatKey) ?? [])];
}

/**
 * Clear conversation turns for a chat (e.g. on session reset).
 */
export function clearConversationTurns(chatKey: string): void {
  ensureConversationTurnsLoaded();
  conversationTurnsMap.delete(chatKey);
  try {
    persistConversationTurnsSnapshot();
  } catch (err) {
    whatsappContextDiag(
      `clear_persist_failed chat=${hashChatKey(chatKey)} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function buildConversationTurnsHistoryEntries(
  chatKey: string,
): Array<{ sender: string; body: string; timestamp?: number }> {
  const entries: Array<{ sender: string; body: string; timestamp?: number }> = [];
  for (const turn of getConversationTurns(chatKey)) {
    entries.push({
      sender: turn.senderLabel ?? "User",
      body: turn.userMessage,
      timestamp: turn.timestamp,
    });
    entries.push({
      sender: "Doraemon",
      body: turn.botReply,
      timestamp: turn.timestamp + 1,
    });
  }
  return entries;
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

/** Exposed for testing: clear memory only so disk reload can be exercised. */
export function __clearConversationTurnsMemoryOnlyForTest(): void {
  conversationTurnsMap.clear();
  conversationTurnsLoaded = false;
}

/** Exposed for testing: clear all conversation turns across all chats. */
export function __clearAllConversationTurns(): void {
  conversationTurnsMap.clear();
  conversationTurnsLoaded = false;
  try {
    unlinkSync(CONVERSATION_TURNS_STORE);
  } catch {
    // store may not exist
  }
}
