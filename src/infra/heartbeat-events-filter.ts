import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";

// Build a dynamic prompt for cron events by embedding the actual event content.
// This ensures the model sees the reminder text directly instead of relying on
// "shown in the system messages above" which may not be visible in context.
export function buildCronEventPrompt(
  pendingEvents: string[],
  opts?: {
    deliverToUser?: boolean;
  },
): string {
  const deliverToUser = opts?.deliverToUser ?? true;
  const eventText = pendingEvents.join("\n").trim();
  if (!eventText) {
    if (!deliverToUser) {
      return (
        "A scheduled cron event was triggered, but no event content was found. " +
        "Handle this internally and reply HEARTBEAT_OK when nothing needs user-facing follow-up."
      );
    }
    return (
      "A scheduled cron event was triggered, but no event content was found. " +
      "Reply HEARTBEAT_OK."
    );
  }
  if (!deliverToUser) {
    return (
      "A scheduled reminder has been triggered. The reminder content is:\n\n" +
      eventText +
      "\n\nHandle this reminder internally. Do not relay it to the user unless explicitly requested."
    );
  }
  return (
    "A scheduled reminder has been triggered. The reminder content is:\n\n" +
    eventText +
    "\n\nPlease relay this reminder to the user in a helpful and friendly way."
  );
}

export function buildExecEventPrompt(opts?: { deliverToUser?: boolean }): string {
  const deliverToUser = opts?.deliverToUser ?? true;
  if (!deliverToUser) {
    return (
      "An async command you ran earlier has completed. The result is shown in the system messages above. " +
      "Handle the result internally. Do not relay it to the user unless explicitly requested."
    );
  }
  return (
    "An async command you ran earlier has completed. The result is shown in the system messages above. " +
    "Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. " +
    "If it failed, explain what went wrong."
  );
}

const HEARTBEAT_OK_PREFIX = HEARTBEAT_TOKEN.toLowerCase();

function normalizeSystemEventText(evt: string): string {
  const trimmed = evt.trim();
  if (!trimmed) {
    return "";
  }
  const withoutSystemPrefix = trimmed.replace(/^system(?:\s*\(untrusted\))?:\s*/i, "");
  const withoutTimestamp = withoutSystemPrefix.replace(/^\[[^\]]+\]\s*/, "");
  return withoutTimestamp.trim().toLowerCase();
}

// Detect heartbeat-specific noise so cron reminders don't trigger on non-reminder events.
function isHeartbeatAckEvent(evt: string): boolean {
  const lower = normalizeSystemEventText(evt);
  if (!lower || !lower.startsWith(HEARTBEAT_OK_PREFIX)) {
    return false;
  }
  const suffix = lower.slice(HEARTBEAT_OK_PREFIX.length);
  if (suffix.length === 0) {
    return true;
  }
  return !/[a-z0-9_]/.test(suffix[0]);
}

function isHeartbeatNoiseEvent(evt: string): boolean {
  const lower = normalizeSystemEventText(evt);
  if (!lower) {
    return false;
  }
  return (
    isHeartbeatAckEvent(lower) ||
    lower.includes("heartbeat poll") ||
    lower.includes("heartbeat wake")
  );
}

function isHeartbeatInstructionLeak(evt: string): boolean {
  return normalizeSystemEventText(evt).includes("read heartbeat.md");
}

export function isExecCompletionEvent(evt: string): boolean {
  const lower = normalizeSystemEventText(evt);
  return lower.includes("exec finished") || lower.includes("exec completed");
}

export function isSuppressedSystemEvent(evt: string): boolean {
  if (!evt.trim()) {
    return true;
  }
  return (
    isHeartbeatNoiseEvent(evt) || isExecCompletionEvent(evt) || isHeartbeatInstructionLeak(evt)
  );
}

// Returns true when a system event should be treated as real cron reminder content.
export function isCronSystemEvent(evt: string) {
  return !isSuppressedSystemEvent(evt);
}
