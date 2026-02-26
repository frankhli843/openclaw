type WatchdogStatus = "sent" | "deferred" | "exhausted";

export type NoProgressWatchdogOptions = {
  softTimeoutMs: number;
  graceTimeoutMs: number;
  rateLimitGraceMs: number;
  onSoftTimeout?: () => Promise<void> | void;
  onHardTimeout: () => Promise<void> | void;
};

export type NoProgressWatchdog = {
  touch: () => void;
  noteRateLimitDelay: (text: string | undefined | null) => void;
  markStatus: (status: WatchdogStatus) => void;
  getStatus: () => WatchdogStatus;
  stop: () => void;
};

const RATE_LIMIT_HINT_RE = /(rate\s*limit|cooldown|retry\s*after|too\s*many\s*requests|429)/i;

function clampMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

export function createNoProgressWatchdog(options: NoProgressWatchdogOptions): NoProgressWatchdog {
  const softTimeoutMs = clampMs(options.softTimeoutMs, 120_000);
  const graceTimeoutMs = clampMs(options.graceTimeoutMs, 45_000);
  const rateLimitGraceMs = clampMs(options.rateLimitGraceMs, 45_000);

  let softTimer: NodeJS.Timeout | null = null;
  let hardTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let softTriggered = false;
  let sawRateLimitDelay = false;
  let status: WatchdogStatus = "sent";

  const clearTimers = () => {
    if (softTimer) {
      clearTimeout(softTimer);
      softTimer = null;
    }
    if (hardTimer) {
      clearTimeout(hardTimer);
      hardTimer = null;
    }
  };

  const arm = () => {
    if (stopped) {
      return;
    }
    clearTimers();
    softTimer = setTimeout(() => {
      if (stopped || softTriggered) {
        return;
      }
      softTriggered = true;
      status = "deferred";
      void Promise.resolve(options.onSoftTimeout?.()).catch(() => {});

      const extra = sawRateLimitDelay ? rateLimitGraceMs : 0;
      hardTimer = setTimeout(() => {
        if (stopped) {
          return;
        }
        status = "exhausted";
        void Promise.resolve(options.onHardTimeout()).catch(() => {});
      }, graceTimeoutMs + extra);
      hardTimer.unref?.();
    }, softTimeoutMs);
    softTimer.unref?.();
  };

  arm();

  return {
    touch: () => {
      if (stopped) {
        return;
      }
      softTriggered = false;
      arm();
    },
    noteRateLimitDelay: (text) => {
      if (!text) {
        return;
      }
      if (RATE_LIMIT_HINT_RE.test(text)) {
        sawRateLimitDelay = true;
      }
    },
    markStatus: (next) => {
      status = next;
    },
    getStatus: () => status,
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTimers();
    },
  };
}
