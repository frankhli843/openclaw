import EventEmitter from "node:events";
import { logVerbose } from "../globals.js";

export type BlockedMessageInfo = {
  /** Channel name (e.g. "whatsapp", "telegram", "discord"). */
  platform: string;
  /** Chat name (display name if available, else the chat ID). */
  chatName: string;
  /** Chat identifier. */
  chatId: string;
  /** Sender platform ID. */
  senderId: string;
  /** Whether the chat is a group. */
  isGroup: boolean;
  /** Message text preview (truncated to 100 chars). */
  preview: string;
  /** Optional best-effort metadata for easier source identification. */
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type BlockedNotificationEvent = {
  info: BlockedMessageInfo;
};

const THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/** In-memory map from chatId to last notification timestamp. */
const lastNotifiedAt = new Map<string, number>();

/** EventEmitter for blocked message notifications. */
export const gateNotifier = new EventEmitter();

/**
 * Called when a message is blocked by gateMode.
 * Emits a 'blocked' event at most once per hour per chat.
 */
export function notifyBlocked(info: BlockedMessageInfo): void {
  const key = `${info.platform}:${info.chatId}`;
  const now = Date.now();
  const last = lastNotifiedAt.get(key) ?? 0;
  if (now - last < THROTTLE_MS) {
    console.debug(`[gate-notify] throttled for ${key} (${Math.round((THROTTLE_MS - (now - last)) / 1000)}s remaining)`);
    return;
  }
  lastNotifiedAt.set(key, now);
  const listenerCount = gateNotifier.listenerCount("blocked");
  console.info(`[gate-notify] Emitting blocked event for ${key} (${listenerCount} listeners)`);
  const event: BlockedNotificationEvent = { info };
  logVerbose(`[gate-notify] ${formatBlockedNotification(info)}`);
  gateNotifier.emit("blocked", event);
}

/**
 * Register a listener for blocked message notifications.
 * The listener receives a BlockedNotificationEvent.
 */
export function onBlockedNotification(
  listener: (event: BlockedNotificationEvent) => void,
): () => void {
  gateNotifier.on("blocked", listener);
  return () => {
    gateNotifier.off("blocked", listener);
  };
}

/**
 * Format the notification message for a blocked chat.
 * Matches the format described in the plan document.
 */
export function formatBlockedNotification(
  info: BlockedMessageInfo,
  options?: { ownerMention?: string },
): string {
  const preview = info.preview.length > 100 ? `${info.preview.slice(0, 100)}...` : info.preview;
  const chatType = info.isGroup ? "group" : "dm";
  const metadataLines = Object.entries(info.metadata ?? {})
    .filter(([, value]) => value !== undefined && value !== null && `${value}`.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`);

  return [
    `🔒 Blocked message: ${info.chatName}, ${preview}`,
    `Platform: ${info.platform}`,
    `Chat: "${info.chatName}" (${info.chatId})`,
    `Sender: ${info.senderId}`,
    `Type: ${chatType}`,
    ...(metadataLines.length > 0 ? ["", "Metadata:", ...metadataLines] : []),
    ``,
    `Reply with: \`set ${info.chatId} to <mode>\``,
    `Modes: \`silent\` · \`frank-only\` · \`allowlist\` · \`mention\` · \`open\``,
    ``,
    `📖 Agent: read skills/gate-control/SKILL.md for gateMode docs before making changes.`,
  ].join("\n");
}

/**
 * Reset notification throttle state (for testing).
 */
export function resetBlockedNotificationThrottle(): void {
  lastNotifiedAt.clear();
}
