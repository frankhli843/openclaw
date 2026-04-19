// frankclaw addition: canonical [Doramon note to self] prefix.
//
// Background
// ==========
// Bot-authored messages in channels (Discord most often, but Telegram and
// WhatsApp too) are normally dropped by the inbound gate to prevent self-
// reply loops. But some bot-authored posts ARE meant to trigger the agent:
//
//   - `Background task done: <label> (run <id>)` from a finished ACP child
//     worker — the parent needs to acknowledge to the user
//   - deadletter-recover posts when a channel dropped an inbound message
//     (previously used `[doramon you forgot to answer!]:` prefix)
//   - any future producer that wants to self-nudge the agent without a real
//     user message
//
// Rather than continue adding one-off prefix allowlists per producer, we
// adopt ONE canonical prefix — `[Doramon note to self]` — that every
// channel's inbound gate knows to pass through, and every producer that
// wants to trigger an agent turn on its own output uses consistently.
//
// Agent behavior (Frank directive, 2026-04-19)
// ============================================
// When a `[Doramon note to self]` message arrives, the agent:
//   1. ALWAYS responds with a summary
//   2. If actions remain → iterates on them
//   3. If done → summarizes what has been completed
//
// The behavior is enforced by the system prompt overlay in
// `noteToSelfPromptOverlay()` (below), injected only when the prefix
// matches.
//
// Back-compat
// ===========
// The original `[doramon you forgot to answer!]:` prefix continues to work
// for now — deadletter-recover output pre-dating this unification still
// gets through.

const CANONICAL_PREFIX = "[Doramon note to self]";
const LEGACY_DEADLETTER_PREFIX = "[doramon you forgot to answer!]:";

// Accepted prefixes, case-insensitive at match time. Order matters only for
// producer default — always use CANONICAL_PREFIX in new code.
const RECOGNIZED_PREFIXES = [CANONICAL_PREFIX, LEGACY_DEADLETTER_PREFIX] as const;

/**
 * Returns true when `text` looks like a self-nudge from a producer that
 * wants the agent to process it. Passes for either the canonical or the
 * legacy deadletter prefix. Trim-tolerant.
 */
export function isNoteToSelf(text: string | undefined | null): boolean {
  if (!text) {
    return false;
  }
  const trimmed = text.replace(/^\s+/, "");
  const lower = trimmed.toLowerCase();
  for (const prefix of RECOGNIZED_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** The canonical prefix. Exposed so other files can reference it. */
export function noteToSelfPrefix(): string {
  return CANONICAL_PREFIX;
}

/**
 * Wrap `body` in the canonical prefix. Used by producers that want their
 * output to re-trigger an agent turn (Background task done announces,
 * deadletter recovery posts, scheduled nudges).
 *
 * Idempotent: passing an already-prefixed string returns it unchanged.
 */
export function wrapAsNoteToSelf(body: string): string {
  if (isNoteToSelf(body)) {
    return body;
  }
  return `${CANONICAL_PREFIX} ${body.trimStart()}`;
}

/**
 * System prompt fragment describing the agent behavior when an inbound
 * turn starts with `[Doramon note to self]`. Designed to be injected by
 * the reply pipeline only on turns that match.
 */
export function noteToSelfPromptOverlay(): string {
  return [
    "<note_to_self_protocol>",
    "This turn was triggered by a bot-authored `[Doramon note to self]` message,",
    "not a user message. Treat it as a self-nudge to act or report.",
    "",
    "ALWAYS respond with a concise user-visible summary that explains what just",
    "happened and what (if anything) is next. Specifically:",
    "  • If actions remain: summarize the state, then CONTINUE ITERATING on those",
    "    actions. Do not stop just because the nudge told you about progress.",
    "  • If everything is done: post a summary of what was completed and stop.",
    "",
    "Never reply with NO_REPLY, bed emoji, or silent tokens to a note-to-self.",
    "The whole point of the nudge is to produce a user-visible update.",
    "</note_to_self_protocol>",
  ].join("\n");
}

export const __NOTE_TO_SELF_TEST_ONLY__ = {
  CANONICAL_PREFIX,
  LEGACY_DEADLETTER_PREFIX,
  RECOGNIZED_PREFIXES,
};
