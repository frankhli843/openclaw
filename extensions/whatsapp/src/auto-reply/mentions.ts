import type { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { buildMentionRegexes, normalizeMentionText } from "openclaw/plugin-sdk/reply-runtime";
import { isSelfChatMode, jidToE164, normalizeE164 } from "openclaw/plugin-sdk/text-runtime";
import type { WebInboundMsg } from "./types.js";

export type MentionConfig = {
  mentionRegexes: RegExp[];
  allowFrom?: Array<string | number>;
};

export type MentionTargets = {
  normalizedMentions: string[];
  selfE164: string | null;
  selfJid: string | null;
};

export function buildMentionConfig(
  cfg: ReturnType<typeof loadConfig>,
  agentId?: string,
): MentionConfig {
  const mentionRegexes = buildMentionRegexes(cfg, agentId);
  return { mentionRegexes, allowFrom: cfg.channels?.whatsapp?.allowFrom };
}

export function resolveMentionTargets(msg: WebInboundMsg, authDir?: string): MentionTargets {
  const jidOptions = authDir ? { authDir } : undefined;
  const normalizedMentions = msg.mentionedJids?.length
    ? msg.mentionedJids.map((jid) => jidToE164(jid, jidOptions) ?? jid).filter(Boolean)
    : [];
  const selfE164 = msg.selfE164 ?? (msg.selfJid ? jidToE164(msg.selfJid, jidOptions) : null);
  const selfJid = msg.selfJid ? msg.selfJid.replace(/:\d+/, "") : null;
  return { normalizedMentions, selfE164, selfJid };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractJidLocalPart(jid: string | null): string | null {
  if (!jid) {
    return null;
  }
  const [local] = jid.split("@");
  return local?.trim() || null;
}

function matchesSelfIdentifierText(bodyClean: string, targets: MentionTargets): boolean {
  const candidates = new Set<string>();

  const selfDigits = targets.selfE164?.replace(/\D/g, "");
  if (selfDigits) {
    candidates.add(selfDigits);
  }

  const selfJidLocal = extractJidLocalPart(targets.selfJid);
  if (selfJidLocal) {
    candidates.add(selfJidLocal);
  }

  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    // WhatsApp often normalizes mentions to textual @<id> in body.
    // Accept both "@123" and "@+123" forms.
    if (new RegExp(`(^|\\s)@\\+?${escaped}(?=$|\\s|[.,!?;:])`, "i").test(bodyClean)) {
      return true;
    }
  }

  return false;
}

export function isBotMentionedFromTargets(
  msg: WebInboundMsg,
  mentionCfg: MentionConfig,
  targets: MentionTargets,
): boolean {
  const clean = (text: string) =>
    // Remove zero-width and directionality markers WhatsApp injects around display names
    normalizeMentionText(text);

  const isSelfChat = isSelfChatMode(targets.selfE164, mentionCfg.allowFrom);
  const bodyClean = clean(msg.body);

  const hasMentions = (msg.mentionedJids?.length ?? 0) > 0;
  if (hasMentions && !isSelfChat) {
    if (targets.selfE164 && targets.normalizedMentions.includes(targets.selfE164)) {
      return true;
    }
    if (targets.selfJid) {
      // Some mentions use the bare JID; match on E.164 to be safe.
      if (targets.normalizedMentions.includes(targets.selfJid)) {
        return true;
      }
    }
    // Some WhatsApp payloads render a real mention in text as @<numeric-id>
    // but the metadata cannot be resolved to self (e.g., unresolved @lid mapping).
    if (matchesSelfIdentifierText(bodyClean, targets)) {
      return true;
    }
    // If the message explicitly mentions someone else, do not fall back to generic regex matches.
    return false;
  } else if (hasMentions && isSelfChat) {
    // Self-chat mode: ignore WhatsApp @mention JIDs, otherwise @mentioning the owner in group chats triggers the bot.
  }

  if (mentionCfg.mentionRegexes.some((re) => re.test(bodyClean))) {
    return true;
  }

  // Fallback: detect body containing our own number (with or without +, spacing)
  if (targets.selfE164) {
    const selfDigits = targets.selfE164.replace(/\D/g, "");
    if (selfDigits) {
      const bodyDigits = bodyClean.replace(/[^\d]/g, "");
      if (bodyDigits.includes(selfDigits)) {
        return true;
      }
      const bodyNoSpace = msg.body.replace(/[\s-]/g, "");
      const pattern = new RegExp(`\\+?${selfDigits}`, "i");
      if (pattern.test(bodyNoSpace)) {
        return true;
      }
    }
  }

  if (matchesSelfIdentifierText(bodyClean, targets)) {
    return true;
  }

  return false;
}

export function debugMention(
  msg: WebInboundMsg,
  mentionCfg: MentionConfig,
  authDir?: string,
): { wasMentioned: boolean; details: Record<string, unknown> } {
  const mentionTargets = resolveMentionTargets(msg, authDir);
  const result = isBotMentionedFromTargets(msg, mentionCfg, mentionTargets);
  const details = {
    from: msg.from,
    body: msg.body,
    bodyClean: normalizeMentionText(msg.body),
    mentionedJids: msg.mentionedJids ?? null,
    normalizedMentionedJids: mentionTargets.normalizedMentions.length
      ? mentionTargets.normalizedMentions
      : null,
    selfJid: msg.selfJid ?? null,
    selfJidBare: mentionTargets.selfJid,
    selfE164: msg.selfE164 ?? null,
    resolvedSelfE164: mentionTargets.selfE164,
  };
  return { wasMentioned: result, details };
}

export function resolveOwnerList(mentionCfg: MentionConfig, selfE164?: string | null) {
  const allowFrom = mentionCfg.allowFrom;
  const raw =
    Array.isArray(allowFrom) && allowFrom.length > 0 ? allowFrom : selfE164 ? [selfE164] : [];
  return raw
    .filter((entry): entry is string => Boolean(entry && entry !== "*"))
    .map((entry) => normalizeE164(entry))
    .filter((entry): entry is string => Boolean(entry));
}
