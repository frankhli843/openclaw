// frankclaw addition: scoped prompt enforcement for outbound/cross-channel delivery.
//
// Two use-cases:
// 1. Cron isolated agent turns with delivery targets: prepend destination
//    scoped prompts so the model sees per-channel/thread instructions even
//    when the run session key differs from the destination.
// 2. Message tool cross-session sends: preflight check that returns the
//    destination scoped prompts and asks the model to re-issue the call,
//    ensuring it has "seen" the instructions before sending.
//
// Design: all logic lives here in a *.frankclaw.ts file to minimize upstream
// merge surface. Upstream files import this with a single line + call.

import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  entryMatches,
  loadScopedPromptRegistry,
  type ScopedPromptContext,
  type ScopedPromptEntry,
} from "./scoped-prompt.frankclaw.js";

// ---------------------------------------------------------------------------
// 1. Destination scoped prompt resolution (for cron delivery injection)
// ---------------------------------------------------------------------------

const PEER_KINDS = ["group", "channel", "direct"] as const;

function stripProviderPrefix(raw: string, channel: string): string {
  const trimmed = raw.trim();
  const lowered = normalizeLowercaseStringOrEmpty(trimmed);
  const prefix = `${normalizeLowercaseStringOrEmpty(channel)}:`;
  if (lowered.startsWith(prefix)) {
    return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

function stripKindPrefix(raw: string): string {
  return raw.replace(/^(user|channel|group|conversation|room|dm):/i, "").trim();
}

function stripDiscordMentions(raw: string): string {
  return raw.replace(/^<@!?/, "").replace(/^<#/, "").replace(/>$/, "").trim();
}

function buildPeerIdCandidates(params: { channel: string; to: string }): string[] {
  const channel = normalizeLowercaseStringOrEmpty(params.channel) || "unknown";
  const raw = params.to.trim();
  if (!raw) {
    return [];
  }
  const cands = [
    raw,
    stripProviderPrefix(raw, channel),
    stripKindPrefix(stripProviderPrefix(raw, channel)),
    stripDiscordMentions(stripKindPrefix(stripProviderPrefix(raw, channel))),
  ]
    .map((v) => normalizeLowercaseStringOrEmpty(v))
    .filter(Boolean);
  return [...new Set(cands)];
}

/**
 * Build candidate session keys for a destination identified by channel + target.
 * We try all three peer kinds because at this point we may not know whether the
 * target is a group, channel, or direct chat.
 */
export function buildDestinationCandidateSessionKeys(params: {
  channel: string;
  to: string;
  agentId: string;
  threadId?: string | number;
}): string[] {
  const agentId = normalizeAgentId(params.agentId);
  const channel = normalizeLowercaseStringOrEmpty(params.channel) || "unknown";
  const peerIds = buildPeerIdCandidates({ channel, to: params.to });
  if (peerIds.length === 0) {
    return [];
  }
  const threadId =
    typeof params.threadId === "number" || typeof params.threadId === "bigint"
      ? String(params.threadId)
      : typeof params.threadId === "string"
        ? params.threadId.trim()
        : "";
  const keys: string[] = [];
  for (const peerId of peerIds) {
    for (const kind of PEER_KINDS) {
      keys.push(`agent:${agentId}:${channel}:${kind}:${peerId}`);
      if (threadId) {
        // Telegram topics show up as :topic:<id> in the session key.
        // Harmless for other channels (won't match unless explicitly scoped).
        keys.push(`agent:${agentId}:${channel}:${kind}:${peerId}:topic:${threadId}`);
      }
    }
  }
  return [...new Set(keys)];
}

/**
 * Resolve scoped prompts that match ANY of the candidate destination session
 * keys. Returns the XML block ready for prepending, or undefined if nothing
 * matches.
 */
export function resolveScopedPromptForDestination(params: {
  channel: string;
  to: string;
  agentId: string;
  threadName?: string;
  threadId?: string | number;
}): string | undefined {
  const candidates = buildDestinationCandidateSessionKeys(params);
  if (candidates.length === 0) {
    return undefined;
  }

  const registry = loadScopedPromptRegistry();
  if (registry.entries.length === 0) {
    return undefined;
  }

  // Collect unique matching entries across all candidate keys.
  const matchedIds = new Set<string>();
  const matched: ScopedPromptEntry[] = [];

  for (const candidateKey of candidates) {
    const ctx: ScopedPromptContext = {
      sessionKey: candidateKey,
      threadName: params.threadName,
    };
    for (const entry of registry.entries) {
      if (!matchedIds.has(entry.id) && entryMatches(entry, ctx)) {
        matchedIds.add(entry.id);
        matched.push(entry);
      }
    }
  }

  if (matched.length === 0) {
    return undefined;
  }

  return renderMatchedEntries(matched);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMatchedEntries(entries: ScopedPromptEntry[]): string {
  const blocks = entries.map((e) => {
    const idAttr = xmlEscape(e.id);
    const body = e.prompt.trim();
    return `<scoped_prompt id="${idAttr}">\n${body}\n</scoped_prompt>`;
  });
  if (blocks.length === 1) {
    return blocks[0];
  }
  return `<scoped_prompts>\n${blocks.join("\n")}\n</scoped_prompts>`;
}

// ---------------------------------------------------------------------------
// 2. Message tool cross-session preflight
// ---------------------------------------------------------------------------

/**
 * Tracks which (currentSessionKey, destinationKey) pairs have already been
 * shown scoped prompts during this tool instance's lifetime. Second calls
 * proceed without blocking.
 */
const preflightSeen = new Set<string>();

/**
 * Reset preflight state (for tests).
 */
export function __resetPreflightSeenForTest(): void {
  preflightSeen.clear();
}

function preflightCacheKey(currentSessionKey: string, destinationKey: string): string {
  return `${currentSessionKey}||${destinationKey}`;
}

export type MessageToolPreflightResult =
  | { proceed: true }
  | { proceed: false; scopedPromptXml: string; instruction: string };

/**
 * For cross-session message sends: checks if the destination has scoped
 * prompts the model hasn't seen yet. Returns { proceed: false, ... } with
 * the injection XML on first encounter, { proceed: true } on second call
 * or when no prompts apply.
 *
 * Same-session sends always return { proceed: true }.
 */
export function checkMessageToolScopedPromptPreflight(params: {
  currentSessionKey: string;
  destinationChannel: string;
  destinationTarget: string;
  agentId: string;
  threadName?: string;
  threadId?: string | number;
}): MessageToolPreflightResult {
  const currentNorm = normalizeLowercaseStringOrEmpty(params.currentSessionKey);

  // Build candidate destination keys.
  const candidates = buildDestinationCandidateSessionKeys({
    channel: params.destinationChannel,
    to: params.destinationTarget,
    agentId: params.agentId,
    threadId: params.threadId,
  });

  // If destination matches current session, this is a same-session send.
  if (candidates.some((c) => c === currentNorm)) {
    return { proceed: true };
  }

  // Check if preflight was already served for this destination.
  const cacheKeys = candidates.map((c) => preflightCacheKey(currentNorm, c));
  if (cacheKeys.some((k) => preflightSeen.has(k))) {
    return { proceed: true };
  }

  // Resolve destination scoped prompts.
  const scopedXml = resolveScopedPromptForDestination({
    channel: params.destinationChannel,
    to: params.destinationTarget,
    agentId: params.agentId,
    threadName: params.threadName,
    threadId: params.threadId,
  });

  if (!scopedXml) {
    // No scoped prompts for destination: proceed immediately.
    // Mark as seen so we skip the lookup next time.
    for (const k of cacheKeys) {
      preflightSeen.add(k);
    }
    return { proceed: true };
  }

  // First encounter: return the scoped prompts and block.
  for (const k of cacheKeys) {
    preflightSeen.add(k);
  }

  return {
    proceed: false,
    scopedPromptXml: scopedXml,
    instruction:
      "IMPORTANT: The destination channel/thread has scoped instructions you must follow. " +
      "Review the scoped prompts above, then re-issue the exact same message tool call. " +
      "Your message will be sent on the second attempt.",
  };
}
