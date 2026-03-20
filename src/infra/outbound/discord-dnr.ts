import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type DiscordDnrContext = {
  channel: string;
  to: string;
  threadId?: string | number | null;
};

export type DiscordDnrWindow = {
  timeZone: string;
  start: string;
  end: string;
};

type DiscordDnrRecurringPolicy = {
  id: string;
  threadId: string;
  enabled?: boolean;
  window: DiscordDnrWindow;
};

type DiscordDnrOneOffPolicy = {
  id: string;
  threadId: string;
  startAtMs: number;
  endAtMs: number;
  /** Optional explicit expiry (auto-pruned when expired). */
  expiresAtMs?: number;
};

type DiscordDnrPolicyStore = {
  version: 1;
  recurring?: DiscordDnrRecurringPolicy[];
  oneOff?: DiscordDnrOneOffPolicy[];
};

// ── WhatsApp DNR policy types (frankclaw extension) ──

export type WhatsAppDnrRecurringPolicy = {
  id: string;
  channel: "whatsapp";
  groupId: string;
  enabled?: boolean;
  window: DiscordDnrWindow;
};

type WhatsAppDnrOneOffPolicy = {
  id: string;
  channel: "whatsapp";
  groupId: string;
  startAtMs: number;
  endAtMs: number;
  expiresAtMs?: number;
};

/**
 * Channel-agnostic DNR policy store. Lives at `state/channel-dnr-policies.json`.
 * Separate from the Discord-only file to avoid migration complexity.
 */
type ChannelDnrPolicyStore = {
  version: 1;
  whatsapp?: {
    recurring?: WhatsAppDnrRecurringPolicy[];
    oneOff?: WhatsAppDnrOneOffPolicy[];
  };
};

const DEFAULT_RECURRING: DiscordDnrRecurringPolicy[] = [
  {
    id: "discord-all-default",
    threadId: "*",
    enabled: true,
    window: {
      timeZone: "America/Toronto",
      start: "17:00",
      end: "08:30",
    },
  },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const POLICY_CACHE_TTL_MS = 60_000;

let cache: {
  loadedAtMs: number;
  recurring: DiscordDnrRecurringPolicy[];
  oneOff: DiscordDnrOneOffPolicy[];
} | null = null;

let whatsappCache: {
  loadedAtMs: number;
  recurring: WhatsAppDnrRecurringPolicy[];
  oneOff: WhatsAppDnrOneOffPolicy[];
} | null = null;

export function __resetDiscordDnrPolicyCacheForTests(): void {
  cache = null;
  whatsappCache = null;
}

function resolveOpenClawHome(): string {
  const envHome = process.env.OPENCLAW_HOME?.trim();
  if (envHome) {
    return envHome;
  }
  return path.join(os.homedir(), ".openclaw");
}

function resolvePolicyPath(): string {
  return path.join(resolveOpenClawHome(), "state", "discord-dnr-policies.json");
}

function resolveChannelDnrPolicyPath(): string {
  return path.join(resolveOpenClawHome(), "state", "channel-dnr-policies.json");
}

function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim();
  const match = TIME_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

function resolveMinutesInZone(nowMs: number, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        map[part.type] = part.value;
      }
    }
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return null;
    }
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function resolveCandidateThreadId(ctx: DiscordDnrContext): string | null {
  if (ctx.threadId != null) {
    const id = String(ctx.threadId).trim();
    if (id) {
      return id;
    }
  }
  const to = ctx.to.trim();
  if (to.startsWith("channel:")) {
    const id = to.slice("channel:".length).trim();
    if (id) {
      return id;
    }
  }
  return null;
}

function isWithinWindow(nowMs: number, window: DiscordDnrWindow): boolean {
  const startMin = parseMinutes(window.start);
  const endMin = parseMinutes(window.end);
  if (startMin === null || endMin === null || startMin === endMin) {
    return false;
  }
  const currentMin = resolveMinutesInZone(nowMs, window.timeZone);
  if (currentMin === null) {
    return false;
  }
  if (endMin > startMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  return currentMin >= startMin || currentMin < endMin;
}

function resolveNextReleaseMs(nowMs: number, window: DiscordDnrWindow): number {
  if (!isWithinWindow(nowMs, window)) {
    return nowMs;
  }
  const minuteMs = 60_000;
  const searchLimit = 48 * 60;
  const start = Math.floor(nowMs / minuteMs) * minuteMs + minuteMs;
  for (let step = 0; step < searchLimit; step += 1) {
    const ts = start + step * minuteMs;
    if (!isWithinWindow(ts, window)) {
      return ts;
    }
  }
  return nowMs + 12 * 60 * 60 * 1000;
}

function readPolicyStore(nowMs: number): {
  recurring: DiscordDnrRecurringPolicy[];
  oneOff: DiscordDnrOneOffPolicy[];
} {
  if (cache && nowMs - cache.loadedAtMs < POLICY_CACHE_TTL_MS) {
    return { recurring: cache.recurring, oneOff: cache.oneOff };
  }

  const recurring = [...DEFAULT_RECURRING];
  let oneOff: DiscordDnrOneOffPolicy[] = [];

  const policyPath = resolvePolicyPath();
  try {
    const raw = fs.readFileSync(policyPath, "utf-8");
    const parsed = JSON.parse(raw) as DiscordDnrPolicyStore;
    if (Array.isArray(parsed.recurring)) {
      for (const p of parsed.recurring) {
        if (!p || typeof p !== "object") {
          continue;
        }
        const threadId = String(p.threadId ?? "").trim();
        if (!threadId) {
          continue;
        }
        if (!p.window || typeof p.window !== "object") {
          continue;
        }
        recurring.push({
          id: String(p.id ?? `recurring-${threadId}`),
          threadId,
          enabled: p.enabled !== false,
          window: {
            timeZone: String(p.window.timeZone ?? "America/Toronto"),
            start: String(p.window.start ?? "18:00"),
            end: String(p.window.end ?? "08:00"),
          },
        });
      }
    }

    let hadPruned = false;
    if (Array.isArray(parsed.oneOff)) {
      for (const p of parsed.oneOff) {
        if (!p || typeof p !== "object") {
          continue;
        }
        const threadId = String(p.threadId ?? "").trim();
        const startAtMs = Number(p.startAtMs);
        const endAtMs = Number(p.endAtMs);
        const expiresAtMs = p.expiresAtMs === undefined ? undefined : Number(p.expiresAtMs);
        const invalid =
          !threadId ||
          !Number.isFinite(startAtMs) ||
          !Number.isFinite(endAtMs) ||
          endAtMs <= startAtMs;
        if (invalid) {
          hadPruned = true;
          continue;
        }
        const isExpiredByEnd = endAtMs <= nowMs;
        const isExpiredByExplicit =
          typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
        if (isExpiredByEnd || isExpiredByExplicit) {
          hadPruned = true;
          continue;
        }
        oneOff.push({
          id: String(p.id ?? `oneoff-${threadId}-${startAtMs}`),
          threadId,
          startAtMs,
          endAtMs,
          ...(typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)
            ? { expiresAtMs }
            : {}),
        });
      }
    }

    // Self-clean old one-off policies on load.
    if (hadPruned) {
      try {
        fs.mkdirSync(path.dirname(policyPath), { recursive: true });
        const nextStore: DiscordDnrPolicyStore = {
          version: 1,
          recurring: parsed.recurring,
          oneOff,
        };
        fs.writeFileSync(policyPath, JSON.stringify(nextStore, null, 2));
      } catch {
        // best effort cleanup only
      }
    }
  } catch {
    // no file -> defaults only
  }

  cache = {
    loadedAtMs: nowMs,
    recurring,
    oneOff,
  };
  return { recurring, oneOff };
}

function resolveEffectiveRule(
  ctx: DiscordDnrContext,
  nowMs: number,
): {
  active: boolean;
  nextEligibleAtMs: number;
  window?: DiscordDnrWindow;
} {
  if (ctx.channel !== "discord") {
    return { active: false, nextEligibleAtMs: nowMs };
  }

  const threadId = resolveCandidateThreadId(ctx);
  const { recurring, oneOff } = readPolicyStore(nowMs);

  // One-off policies take precedence.
  for (const p of oneOff) {
    const appliesToAllDiscord = p.threadId === "*";
    const appliesToTarget = !!threadId && p.threadId === threadId;
    if (!appliesToAllDiscord && !appliesToTarget) {
      continue;
    }
    if (nowMs >= p.startAtMs && nowMs < p.endAtMs) {
      return {
        active: true,
        nextEligibleAtMs: p.endAtMs,
      };
    }
  }

  for (const p of recurring) {
    const appliesToAllDiscord = p.threadId === "*";
    const appliesToTarget = !!threadId && p.threadId === threadId;
    if (!p.enabled || (!appliesToAllDiscord && !appliesToTarget)) {
      continue;
    }
    if (isWithinWindow(nowMs, p.window)) {
      return {
        active: true,
        nextEligibleAtMs: resolveNextReleaseMs(nowMs, p.window),
        window: p.window,
      };
    }
  }

  return { active: false, nextEligibleAtMs: nowMs };
}

export function isDiscordDnrTarget(ctx: DiscordDnrContext): boolean {
  if (ctx.channel !== "discord") {
    return false;
  }
  const threadId = resolveCandidateThreadId(ctx);
  const nowMs = Date.now();
  const { recurring, oneOff } = readPolicyStore(nowMs);
  return (
    recurring.some(
      (p) => p.enabled !== false && (p.threadId === "*" || (!!threadId && p.threadId === threadId)),
    ) || oneOff.some((p) => p.threadId === "*" || (!!threadId && p.threadId === threadId))
  );
}

export function isWithinDiscordDnrWindow(
  nowMs: number,
  window: DiscordDnrWindow = DEFAULT_RECURRING[0].window,
): boolean {
  return isWithinWindow(nowMs, window);
}

export function resolveNextDiscordDnrReleaseMs(
  nowMs: number,
  window: DiscordDnrWindow = DEFAULT_RECURRING[0].window,
): number {
  return resolveNextReleaseMs(nowMs, window);
}

export class DiscordDnrSuppressedError extends Error {
  readonly nextEligibleAtMs: number;

  constructor(nextEligibleAtMs: number) {
    super("discord outbound suppressed by DNR window");
    this.name = "DiscordDnrSuppressedError";
    this.nextEligibleAtMs = nextEligibleAtMs;
  }
}

export function enforceDiscordDnrWindow(ctx: DiscordDnrContext, nowMs = Date.now()): void {
  const effective = resolveEffectiveRule(ctx, nowMs);
  if (!effective.active) {
    return;
  }
  throw new DiscordDnrSuppressedError(effective.nextEligibleAtMs);
}

export function inspectDiscordDnrWindow(nowMs = Date.now()): {
  active: boolean;
  nextEligibleAtMs: number;
  window: DiscordDnrWindow;
} {
  // Keep script behavior stable for the primary target
  const ctx: DiscordDnrContext = {
    channel: "discord",
    to: "channel:1479083833830801520",
  };
  const effective = resolveEffectiveRule(ctx, nowMs);
  return {
    active: effective.active,
    nextEligibleAtMs: effective.nextEligibleAtMs,
    window: effective.window ?? DEFAULT_RECURRING[0].window,
  };
}

// ── WhatsApp DNR (frankclaw extension) ──

function readWhatsAppPolicyStore(nowMs: number): {
  recurring: WhatsAppDnrRecurringPolicy[];
  oneOff: WhatsAppDnrOneOffPolicy[];
} {
  if (whatsappCache && nowMs - whatsappCache.loadedAtMs < POLICY_CACHE_TTL_MS) {
    return { recurring: whatsappCache.recurring, oneOff: whatsappCache.oneOff };
  }

  const recurring: WhatsAppDnrRecurringPolicy[] = [];
  let oneOff: WhatsAppDnrOneOffPolicy[] = [];
  const policyPath = resolveChannelDnrPolicyPath();

  try {
    const raw = fs.readFileSync(policyPath, "utf-8");
    const parsed = JSON.parse(raw) as ChannelDnrPolicyStore;
    const wa = parsed.whatsapp;
    if (!wa) {
      whatsappCache = { loadedAtMs: nowMs, recurring, oneOff };
      return { recurring, oneOff };
    }

    if (Array.isArray(wa.recurring)) {
      for (const p of wa.recurring) {
        if (!p || typeof p !== "object") continue;
        const groupId = String(p.groupId ?? "").trim();
        if (!groupId) continue;
        if (!p.window || typeof p.window !== "object") continue;
        recurring.push({
          id: String(p.id ?? `wa-recurring-${groupId}`),
          channel: "whatsapp",
          groupId,
          enabled: p.enabled !== false,
          window: {
            timeZone: String(p.window.timeZone ?? "America/Toronto"),
            start: String(p.window.start ?? "18:00"),
            end: String(p.window.end ?? "08:00"),
          },
        });
      }
    }

    let hadPruned = false;
    if (Array.isArray(wa.oneOff)) {
      for (const p of wa.oneOff) {
        if (!p || typeof p !== "object") continue;
        const groupId = String(p.groupId ?? "").trim();
        const startAtMs = Number(p.startAtMs);
        const endAtMs = Number(p.endAtMs);
        const expiresAtMs = p.expiresAtMs === undefined ? undefined : Number(p.expiresAtMs);
        const invalid =
          !groupId ||
          !Number.isFinite(startAtMs) ||
          !Number.isFinite(endAtMs) ||
          endAtMs <= startAtMs;
        if (invalid) {
          hadPruned = true;
          continue;
        }
        const isExpiredByEnd = endAtMs <= nowMs;
        const isExpiredByExplicit =
          typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
        if (isExpiredByEnd || isExpiredByExplicit) {
          hadPruned = true;
          continue;
        }
        oneOff.push({
          id: String(p.id ?? `wa-oneoff-${groupId}-${startAtMs}`),
          channel: "whatsapp",
          groupId,
          startAtMs,
          endAtMs,
          ...(typeof expiresAtMs === "number" && Number.isFinite(expiresAtMs)
            ? { expiresAtMs }
            : {}),
        });
      }
    }

    if (hadPruned) {
      try {
        fs.mkdirSync(path.dirname(policyPath), { recursive: true });
        const nextStore: ChannelDnrPolicyStore = {
          version: 1,
          whatsapp: { recurring: wa.recurring, oneOff },
        };
        fs.writeFileSync(policyPath, JSON.stringify(nextStore, null, 2));
      } catch {
        // best effort cleanup only
      }
    }
  } catch {
    // no file -> no whatsapp policies
  }

  whatsappCache = { loadedAtMs: nowMs, recurring, oneOff };
  return { recurring, oneOff };
}

type WhatsAppDnrContext = {
  channel: "whatsapp";
  groupId: string;
};

function resolveWhatsAppEffectiveRule(
  ctx: WhatsAppDnrContext,
  nowMs: number,
): {
  active: boolean;
  nextEligibleAtMs: number;
  window?: DiscordDnrWindow;
} {
  const { recurring, oneOff } = readWhatsAppPolicyStore(nowMs);

  // One-off policies take precedence.
  for (const p of oneOff) {
    const appliesToAll = p.groupId === "*";
    const appliesToTarget = p.groupId === ctx.groupId;
    if (!appliesToAll && !appliesToTarget) continue;
    if (nowMs >= p.startAtMs && nowMs < p.endAtMs) {
      return { active: true, nextEligibleAtMs: p.endAtMs };
    }
  }

  for (const p of recurring) {
    const appliesToAll = p.groupId === "*";
    const appliesToTarget = p.groupId === ctx.groupId;
    if (!p.enabled || (!appliesToAll && !appliesToTarget)) continue;
    if (isWithinWindow(nowMs, p.window)) {
      return {
        active: true,
        nextEligibleAtMs: resolveNextReleaseMs(nowMs, p.window),
        window: p.window,
      };
    }
  }

  return { active: false, nextEligibleAtMs: nowMs };
}

export class WhatsAppDnrSuppressedError extends Error {
  readonly nextEligibleAtMs: number;

  constructor(nextEligibleAtMs: number) {
    super("whatsapp outbound suppressed by DNR window");
    this.name = "WhatsAppDnrSuppressedError";
    this.nextEligibleAtMs = nextEligibleAtMs;
  }
}

/**
 * Enforce WhatsApp DNR quiet window. Throws WhatsAppDnrSuppressedError if
 * the target group is within a configured quiet window.
 */
export function enforceWhatsAppDnrWindow(groupId: string, nowMs = Date.now()): void {
  const effective = resolveWhatsAppEffectiveRule(
    { channel: "whatsapp", groupId },
    nowMs,
  );
  if (!effective.active) return;
  throw new WhatsAppDnrSuppressedError(effective.nextEligibleAtMs);
}

/**
 * Check if a WhatsApp group has any DNR policy (recurring or one-off).
 */
export function isWhatsAppDnrTarget(groupId: string): boolean {
  const nowMs = Date.now();
  const { recurring, oneOff } = readWhatsAppPolicyStore(nowMs);
  return (
    recurring.some(
      (p) => p.enabled !== false && (p.groupId === "*" || p.groupId === groupId),
    ) || oneOff.some((p) => p.groupId === "*" || p.groupId === groupId)
  );
}

/**
 * Inspect the current WhatsApp DNR state for a specific group.
 */
export function inspectWhatsAppDnrWindow(
  groupId: string,
  nowMs = Date.now(),
): {
  active: boolean;
  nextEligibleAtMs: number;
  window?: DiscordDnrWindow;
} {
  return resolveWhatsAppEffectiveRule({ channel: "whatsapp", groupId }, nowMs);
}
