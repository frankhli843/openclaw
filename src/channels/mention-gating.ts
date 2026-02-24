import type { GateMode } from "../config/types.base.js";

export type { GateMode };

export type GateModeParams = {
  /** Configured gateMode for this chat (undefined = not set, use legacy fallback). */
  gateMode: GateMode | undefined;
  /** The sender's platform ID. */
  senderId: string;
  /** The owner / frank-only senders (e.g. allowFrom). */
  allowFrom: string[];
  /** Extra senders allowed in 'allowlist' mode. */
  allowedSenders: string[];
  /** Whether the bot was natively mentioned (platform @mention). */
  wasMentioned: boolean;
  /** Raw message text, for keyword matching. */
  messageText: string;
  /** Global mention keywords from agents.defaults.mentionKeywords. */
  mentionKeywords: string[];
};

export type GateModeResult = {
  /** Whether to process, skip, or process silently. */
  action: "process" | "skip" | "silent";
  /** Effective wasMentioned value (true if triggered via keyword or mention). */
  effectiveWasMentioned: boolean;
};

/**
 * Check if any mentionKeyword appears as a whole word (case-insensitive) in messageText.
 */
function matchesKeyword(messageText: string, mentionKeywords: string[]): boolean {
  if (mentionKeywords.length === 0) {
    return false;
  }
  const lower = messageText.toLowerCase();
  return mentionKeywords.some((kw) => {
    if (!kw) {
      return false;
    }
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`).test(lower);
  });
}

/**
 * Resolve the effective gate action for a message.
 *
 * Priority:
 *   explicit gateMode > legacy requireMention mapping > default (blocked)
 *
 * Legacy fallback (when gateMode is undefined):
 *   requireMention supplied externally; callers pass it as a synthesized gateMode value.
 *   If gateMode is undefined, defaults to 'blocked'.
 */
export function resolveGateMode(params: GateModeParams): GateModeResult {
  const {
    gateMode,
    senderId,
    allowFrom,
    allowedSenders,
    wasMentioned,
    messageText,
    mentionKeywords,
  } = params;

  // Default to blocked when not configured
  const effectiveMode: GateMode = gateMode ?? "blocked";

  switch (effectiveMode) {
    case "blocked":
      return { action: "skip", effectiveWasMentioned: false };

    case "silent":
      return { action: "silent", effectiveWasMentioned: false };

    case "open":
      return { action: "process", effectiveWasMentioned: true };

    case "frank-only": {
      const isOwner = allowFrom.includes(senderId);
      if (!isOwner) {
        return { action: "skip", effectiveWasMentioned: false };
      }
      const triggered = wasMentioned || matchesKeyword(messageText, mentionKeywords);
      if (!triggered) {
        return { action: "skip", effectiveWasMentioned: false };
      }
      return { action: "process", effectiveWasMentioned: true };
    }

    case "allowlist": {
      const isOwner = allowFrom.includes(senderId);
      const isAllowlisted = allowedSenders.includes(senderId);
      if (!isOwner && !isAllowlisted) {
        return { action: "skip", effectiveWasMentioned: false };
      }
      const triggered = wasMentioned || matchesKeyword(messageText, mentionKeywords);
      if (!triggered) {
        return { action: "skip", effectiveWasMentioned: false };
      }
      return { action: "process", effectiveWasMentioned: true };
    }

    default:
      return { action: "skip", effectiveWasMentioned: false };
  }
}

export type MentionGateParams = {
  requireMention: boolean;
  canDetectMention: boolean;
  wasMentioned: boolean;
  implicitMention?: boolean;
  shouldBypassMention?: boolean;
};

export type MentionGateResult = {
  effectiveWasMentioned: boolean;
  shouldSkip: boolean;
};

export type MentionGateWithBypassParams = {
  isGroup: boolean;
  requireMention: boolean;
  canDetectMention: boolean;
  wasMentioned: boolean;
  implicitMention?: boolean;
  hasAnyMention?: boolean;
  allowTextCommands: boolean;
  hasControlCommand: boolean;
  commandAuthorized: boolean;
};

export type MentionGateWithBypassResult = MentionGateResult & {
  shouldBypassMention: boolean;
};

export function resolveMentionGating(params: MentionGateParams): MentionGateResult {
  const implicit = params.implicitMention === true;
  const bypass = params.shouldBypassMention === true;
  const effectiveWasMentioned = params.wasMentioned || implicit || bypass;
  const shouldSkip = params.requireMention && params.canDetectMention && !effectiveWasMentioned;
  return { effectiveWasMentioned, shouldSkip };
}

export function resolveMentionGatingWithBypass(
  params: MentionGateWithBypassParams,
): MentionGateWithBypassResult {
  const shouldBypassMention =
    params.isGroup &&
    params.requireMention &&
    !params.wasMentioned &&
    !(params.hasAnyMention ?? false) &&
    params.allowTextCommands &&
    params.commandAuthorized &&
    params.hasControlCommand;
  return {
    ...resolveMentionGating({
      requireMention: params.requireMention,
      canDetectMention: params.canDetectMention,
      wasMentioned: params.wasMentioned,
      implicitMention: params.implicitMention,
      shouldBypassMention,
    }),
    shouldBypassMention,
  };
}
