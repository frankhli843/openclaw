// frankclaw addition: scoped prompt injections for specific channels,
// threads, groups, and regex-matched thread names.
//
// Why: default prompt context is the same everywhere, which means channel-
// specific or project-specific instructions live either in AGENTS.md (which
// bloats every turn) or nowhere (so the LLM has to infer). This registry
// lets an operator attach a short, XML-tagged instruction block to a
// specific Discord channel, Discord thread (by id or by thread-name regex),
// Telegram chat/group, or WhatsApp group, and have it prepended to every
// inbound turn for that destination.
//
// Example: "Threads named /iterate expect continuous coding iteration —
// default to coding-agent SKILL.md flow", "Work context: WWSA grinding AI
// — use v6 as baseline unless recent messages reference a newer iteration",
// "Kiwi Health group — log, don't advise".
//
// Registry location: ~/.openclaw/workspace/state/channel-prompt-injections.json
// Managed via: scripts/scoped-prompt.sh (and the scoped-prompt-injections
// skill that teaches Doraemon how to read/modify entries).

import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";

export interface ScopedPromptEntry {
  /** Stable, human-readable identifier (e.g. "wwsa-grinding-ai"). */
  id: string;
  /** When false, the entry is skipped. Default true. */
  enabled?: boolean;
  /** Optional free-text note for operators (not sent to the model). */
  note?: string;
  /**
   * Match predicate. An entry matches only when ALL specified fields match.
   * An empty match object matches everything.
   */
  match: {
    /** Channel type: "discord" | "telegram" | "whatsapp" | "slack" | etc. */
    channel?: string;
    /**
     * Exact session key match, e.g.
     *   "agent:main:discord:channel:1488885819891515494"
     *   "agent:main:telegram:direct:7918451151"
     *   "agent:main:whatsapp:group:120363405743307729@g.us"
     * Case-insensitive.
     */
    sessionKey?: string;
    /** Regex pattern tested against the session key (case-insensitive). */
    sessionKeyPattern?: string;
    /** Regex pattern tested against the Discord thread name / conversation label. */
    threadNamePattern?: string;
  };
  /** The instruction text injected into the turn (without XML tags). */
  prompt: string;
}

export interface ScopedPromptRegistry {
  schema: "channel-prompt-injections/v1";
  entries: ScopedPromptEntry[];
}

export interface ScopedPromptContext {
  sessionKey?: string;
  /** For Discord threads: the thread's name / label. */
  threadName?: string;
}

function registryPath(): string {
  return path.join(
    process.env["OPENCLAW_WORKSPACE"] ?? "/home/frank/.openclaw/workspace",
    "state",
    "channel-prompt-injections.json",
  );
}

let cache: { mtimeMs: number; registry: ScopedPromptRegistry } | null = null;

/** Read the registry with mtime-based caching. Missing file = empty registry. */
export function loadScopedPromptRegistry(): ScopedPromptRegistry {
  const p = registryPath();
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(p);
  } catch {
    cache = null;
    return { schema: "channel-prompt-injections/v1", entries: [] };
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) {
    return cache.registry;
  }
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScopedPromptRegistry>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const registry: ScopedPromptRegistry = {
      schema: "channel-prompt-injections/v1",
      entries: entries.filter(isWellFormedEntry),
    };
    cache = { mtimeMs: stat.mtimeMs, registry };
    return registry;
  } catch {
    // Malformed file: return empty so we never break prompt assembly.
    cache = null;
    return { schema: "channel-prompt-injections/v1", entries: [] };
  }
}

export function __resetScopedPromptCacheForTest(): void {
  cache = null;
}

function isWellFormedEntry(e: unknown): e is ScopedPromptEntry {
  if (!e || typeof e !== "object") {
    return false;
  }
  const x = e as Record<string, unknown>;
  if (typeof x.id !== "string" || !x.id.trim()) {
    return false;
  }
  if (typeof x.prompt !== "string" || !x.prompt.trim()) {
    return false;
  }
  if (typeof x.match !== "object" || x.match == null) {
    return false;
  }
  return true;
}

function safeRegex(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return undefined;
  }
}

/** Returns true if this entry matches the given context. */
export function entryMatches(entry: ScopedPromptEntry, ctx: ScopedPromptContext): boolean {
  if (entry.enabled === false) {
    return false;
  }
  const m = entry.match ?? {};

  if (m.channel) {
    const parsed = parseAgentSessionKey(ctx.sessionKey);
    const channel = parsed?.rest.split(":")[0];
    if (!channel || channel.toLowerCase() !== m.channel.toLowerCase()) {
      return false;
    }
  }

  if (m.sessionKey) {
    const a = (ctx.sessionKey ?? "").toLowerCase();
    const b = m.sessionKey.toLowerCase();
    if (a !== b) {
      return false;
    }
  }

  if (m.sessionKeyPattern) {
    const re = safeRegex(m.sessionKeyPattern);
    if (!re || !re.test(ctx.sessionKey ?? "")) {
      return false;
    }
  }

  if (m.threadNamePattern) {
    const re = safeRegex(m.threadNamePattern);
    if (!re || !re.test(ctx.threadName ?? "")) {
      return false;
    }
  }

  // Reject entries with ONLY channel-agnostic fields and no actual matcher
  // to avoid accidental "match everything" entries.
  const hasAnyPredicate = Boolean(
    m.channel || m.sessionKey || m.sessionKeyPattern || m.threadNamePattern,
  );
  return hasAnyPredicate;
}

/** XML-escape for embedding user text inside a <scoped_prompt> block. */
function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Resolve scoped prompts for the given context and render an XML-tagged
 * block ready to be prepended to the prompt body. Returns undefined when
 * no entries match.
 */
export function resolveScopedPromptForContext(ctx: ScopedPromptContext): string | undefined {
  const registry = loadScopedPromptRegistry();
  const matched = registry.entries.filter((e) => entryMatches(e, ctx));
  if (matched.length === 0) {
    return undefined;
  }

  const blocks = matched.map((e) => {
    const idAttr = xmlEscape(e.id);
    const body = e.prompt.trim();
    return `<scoped_prompt id="${idAttr}">\n${body}\n</scoped_prompt>`;
  });

  if (blocks.length === 1) {
    return blocks[0];
  }
  return `<scoped_prompts>\n${blocks.join("\n")}\n</scoped_prompts>`;
}
