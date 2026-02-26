export type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
  /**
   * Deprecated legacy fallback webhook URL used only for stored jobs with notify=true.
   * Prefer per-job delivery.mode="webhook" with delivery.to.
   */
  webhook?: string;
  /** Bearer token for cron webhook POST delivery. */
  webhookToken?: string;
  /**
   * How long to retain completed cron run sessions before automatic pruning.
   * Accepts a duration string (e.g. "24h", "7d", "1h30m") or `false` to disable pruning.
   * Default: "24h".
   */
  sessionRetention?: string | false;

  /**
   * Cron self-heal retry settings.
   *
   * For recurring cron jobs (schedule.kind="cron"), when a run fails with a matching
   * transient infra error, the scheduler can automatically reschedule a bounded retry
   * after a cooldown window.
   */
  selfHeal?: {
    enabled?: boolean;
    /** Retry delay as a duration string (e.g. "30m", "1h"). Default: "30m". */
    retryDelay?: string;
    /** Maximum attempts per scheduled run (includes the original attempt). Default: 2. */
    maxAttemptsPerRun?: number;
    /** Case-insensitive substring matchers applied to the error string. */
    match?: string[];
  };
};
