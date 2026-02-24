import EventEmitter from "node:events";

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
    return;
  }
  lastNotifiedAt.set(key, now);
  const event: BlockedNotificationEvent = { info };
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
export function formatBlockedNotification(info: BlockedMessageInfo): string {
  const preview = info.preview.length > 100 ? `${info.preview.slice(0, 100)}...` : info.preview;
  const chatType = info.isGroup ? "group" : "dm";
  return [
    "🔒 Blocked message",
    `Platform: ${info.platform}`,
    `Chat: "${info.chatName}" (${info.chatId})`,
    `Sender: ${info.senderId}`,
    `Type: ${chatType}`,
    `Preview: "${preview}"`,
    ``,
    `To configure, tell me: "set ${info.chatId} to frank-only"`,
  ].join("\n");
}

/**
 * Reset notification throttle state (for testing).
 */
export function resetBlockedNotificationThrottle(): void {
  lastNotifiedAt.clear();
}
