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

const DEFAULT_WINDOW: DiscordDnrWindow = {
  timeZone: "America/Toronto",
  start: "19:00",
  end: "09:00",
};

const TARGET_THREAD_IDS = new Set(["1479083833830801520"]);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

export function isDiscordDnrTarget(ctx: DiscordDnrContext): boolean {
  if (ctx.channel !== "discord") {
    return false;
  }
  const threadId = resolveCandidateThreadId(ctx);
  if (!threadId) {
    return false;
  }
  return TARGET_THREAD_IDS.has(threadId);
}

export function isWithinDiscordDnrWindow(
  nowMs: number,
  window: DiscordDnrWindow = DEFAULT_WINDOW,
): boolean {
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

export function resolveNextDiscordDnrReleaseMs(
  nowMs: number,
  window: DiscordDnrWindow = DEFAULT_WINDOW,
): number {
  if (!isWithinDiscordDnrWindow(nowMs, window)) {
    return nowMs;
  }
  const minuteMs = 60_000;
  const searchLimit = 48 * 60;
  const start = Math.floor(nowMs / minuteMs) * minuteMs + minuteMs;
  for (let step = 0; step < searchLimit; step += 1) {
    const ts = start + step * minuteMs;
    if (!isWithinDiscordDnrWindow(ts, window)) {
      return ts;
    }
  }
  return nowMs + 12 * 60 * 60 * 1000;
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
  if (!isDiscordDnrTarget(ctx)) {
    return;
  }
  if (!isWithinDiscordDnrWindow(nowMs)) {
    return;
  }
  throw new DiscordDnrSuppressedError(resolveNextDiscordDnrReleaseMs(nowMs));
}

export function inspectDiscordDnrWindow(nowMs = Date.now()): {
  active: boolean;
  nextEligibleAtMs: number;
  window: DiscordDnrWindow;
} {
  return {
    active: isWithinDiscordDnrWindow(nowMs),
    nextEligibleAtMs: resolveNextDiscordDnrReleaseMs(nowMs),
    window: DEFAULT_WINDOW,
  };
}
