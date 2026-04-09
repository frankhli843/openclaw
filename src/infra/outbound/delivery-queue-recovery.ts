import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { formatErrorMessage } from "../errors.js";
import {
  ackDelivery,
  failDelivery,
  loadPendingDeliveries,
  moveToFailed,
  type QueuedDelivery,
  type QueuedDeliveryPayload,
} from "./delivery-queue-storage.js";

const QUEUE_DIRNAME = "delivery-queue";

export type RecoverySummary = {
  recovered: number;
  failed: number;
  skippedMaxRetries: number;
  deferredBackoff: number;
};

export type DeliverFn = (
  params: {
    cfg: OpenClawConfig;
  } & QueuedDeliveryPayload & {
      skipQueue?: boolean;
    },
) => Promise<unknown>;

export interface RecoveryLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const MAX_RETRIES = 5;

/**
 * [frankclaw] Minimum age in ms an entry must have before recovery considers it.
 * This prevents race conditions where the normal delivery path is still in-flight
 * and the periodic recovery sweep picks up the same entry concurrently, causing
 * duplicate messages. 30s is generous enough to let any normal send finish.
 */
const MIN_ENTRY_AGE_MS = 30_000;
/** Backoff delays in milliseconds indexed by retry count (1-based). */
const BACKOFF_MS: readonly number[] = [
  5_000, // retry 1: 5s
  25_000, // retry 2: 25s
  120_000, // retry 3: 2m
  600_000, // retry 4: 10m
];

const PERMANENT_ERROR_PATTERNS: readonly RegExp[] = [
  /no conversation reference found/i,
  /chat not found/i,
  /user not found/i,
  /bot.*not.*member/i,
  /bot was blocked by the user/i,
  /forbidden: bot was kicked/i,
  /chat_id is empty/i,
  /recipient is not a valid/i,
  /outbound not configured for channel/i,
  /ambiguous .* recipient/i,
  /User .* not in room/i,
];

const NO_LISTENER_ERROR_RE = /No active WhatsApp Web listener/i;

const drainInProgress = new Map<string, boolean>();
const entriesInProgress = new Set<string>();

type DeliverRuntimeModule = typeof import("./deliver-runtime.js");

let deliverRuntimePromise: Promise<DeliverRuntimeModule> | null = null;

function loadDeliverRuntime() {
  deliverRuntimePromise ??= import("./deliver-runtime.js");
  return deliverRuntimePromise;
}

function normalizeQueueAccountId(accountId?: string): string {
  return (accountId ?? "").trim() || "default";
}

function getErrnoCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code)
    : null;
}

function createEmptyRecoverySummary(): RecoverySummary {
  return {
    recovered: 0,
    failed: 0,
    skippedMaxRetries: 0,
    deferredBackoff: 0,
  };
}

function claimRecoveryEntry(entryId: string): boolean {
  if (entriesInProgress.has(entryId)) {
    return false;
  }
  entriesInProgress.add(entryId);
  return true;
}

function releaseRecoveryEntry(entryId: string): void {
  entriesInProgress.delete(entryId);
}

function buildRecoveryDeliverParams(entry: QueuedDelivery, cfg: OpenClawConfig) {
  return {
    cfg,
    channel: entry.channel,
    to: entry.to,
    accountId: entry.accountId,
    payloads: entry.payloads,
    threadId: entry.threadId,
    replyToId: entry.replyToId,
    bestEffort: entry.bestEffort,
    gifPlayback: entry.gifPlayback,
    forceDocument: entry.forceDocument,
    silent: entry.silent,
    mirror: entry.mirror,
    gatewayClientScopes: entry.gatewayClientScopes,
    skipQueue: true, // Prevent re-enqueueing during recovery.
  } satisfies Parameters<DeliverFn>[0];
}

async function moveEntryToFailedWithLogging(
  entryId: string,
  log: RecoveryLogger,
  stateDir?: string,
): Promise<void> {
  try {
    await moveToFailed(entryId, stateDir);
  } catch (err) {
    log.error(`Failed to move entry ${entryId} to failed/: ${String(err)}`);
  }
}

/**
 * [frankclaw] Check if a Discord delivery target is currently in a DNR quiet window.
 * Returns { nextEligibleAtMs } if suppressed, or null if delivery is allowed.
 * Uses dynamic import to avoid circular dependency with discord-dnr module.
 */
function checkRecoveryDnr(target: string): { nextEligibleAtMs: number } | null {
  try {
    const { enforceDiscordDnrWindow } = require("../outbound/discord-dnr.js") as {
      enforceDiscordDnrWindow: (ctx: { channel: "discord"; to: string }) => void;
    };
    enforceDiscordDnrWindow({ channel: "discord", to: target });
    return null;
  } catch (err) {
    if (err && typeof err === "object" && "nextEligibleAtMs" in err) {
      return { nextEligibleAtMs: (err as { nextEligibleAtMs: number }).nextEligibleAtMs };
    }
    // Not a DNR error — let delivery proceed and handle normally
    return null;
  }
}

async function deferRemainingEntriesForBudget(
  _entries: readonly QueuedDelivery[],
  _stateDir: string | undefined,
): Promise<void> {
  // [frankclaw] No-op: leave remaining entries untouched for the next sweep.
  // Previously this called failDelivery() to increment retryCount, but that
  // caused entries to hit MAX_RETRIES and be permanently lost even though no
  // delivery was ever attempted — especially harmful for DNR-deferred Discord
  // entries and during MODULE_NOT_FOUND transient infrastructure errors.
  // The 2-minute periodic sweep will pick them up next time.
}

/** Compute the backoff delay in ms for a given retry count. */
export function computeBackoffMs(retryCount: number): number {
  if (retryCount <= 0) {
    return 0;
  }
  return BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1) ?? 0;
}

export function isEntryEligibleForRecoveryRetry(
  entry: QueuedDelivery,
  now: number,
): { eligible: true } | { eligible: false; remainingBackoffMs: number } {
  // Frankclaw: respect deferUntilMs from DNR quiet window.
  // When deferUntilMs is set, it IS the intended delivery time — skip backoff entirely
  // once it has elapsed.  Without this, the exponential backoff from retryCount
  // (incremented by failed recovery attempts during quiet hours) can delay delivery
  // well past the DNR end time.
  const deferUntilMs = (entry as { deferUntilMs?: number }).deferUntilMs;
  if (typeof deferUntilMs === "number" && Number.isFinite(deferUntilMs)) {
    if (now < deferUntilMs) {
      return { eligible: false, remainingBackoffMs: deferUntilMs - now };
    }
    // deferUntilMs has elapsed — immediately eligible, bypass backoff
    return { eligible: true };
  }
  const backoff = computeBackoffMs(entry.retryCount + 1);
  if (backoff <= 0) {
    return { eligible: true };
  }
  const firstReplayAfterCrash = entry.retryCount === 0 && entry.lastAttemptAt === undefined;
  if (firstReplayAfterCrash) {
    // [frankclaw] Guard against racing with in-flight normal delivery.
    // Only consider a fresh entry eligible if it was enqueued at least
    // MIN_ENTRY_AGE_MS ago. Entries younger than that are likely still
    // being delivered by the normal path and picking them up here would
    // cause duplicate sends.
    const entryAgeMs = now - entry.enqueuedAt;
    if (entryAgeMs < MIN_ENTRY_AGE_MS) {
      return { eligible: false, remainingBackoffMs: MIN_ENTRY_AGE_MS - entryAgeMs };
    }
    return { eligible: true };
  }
  const hasAttemptTimestamp =
    typeof entry.lastAttemptAt === "number" &&
    Number.isFinite(entry.lastAttemptAt) &&
    entry.lastAttemptAt > 0;
  const baseAttemptAt = hasAttemptTimestamp
    ? (entry.lastAttemptAt ?? entry.enqueuedAt)
    : entry.enqueuedAt;
  const nextEligibleAt = baseAttemptAt + backoff;
  if (now >= nextEligibleAt) {
    return { eligible: true };
  }
  return { eligible: false, remainingBackoffMs: nextEligibleAt - now };
}

export function isPermanentDeliveryError(error: string): boolean {
  return PERMANENT_ERROR_PATTERNS.some((re) => re.test(error));
}

export async function drainReconnectQueue(opts: {
  accountId: string;
  cfg: OpenClawConfig;
  log: RecoveryLogger;
  stateDir?: string;
  deliver?: DeliverFn;
}): Promise<void> {
  if (drainInProgress.get(opts.accountId)) {
    opts.log.info(
      `WhatsApp reconnect drain: already in progress for account ${opts.accountId}, skipping`,
    );
    return;
  }

  drainInProgress.set(opts.accountId, true);
  try {
    const matchingEntries = (await loadPendingDeliveries(opts.stateDir))
      .filter(
        (entry) =>
          entry.channel === "whatsapp" &&
          normalizeQueueAccountId(entry.accountId) === opts.accountId &&
          typeof entry.lastError === "string" &&
          NO_LISTENER_ERROR_RE.test(entry.lastError),
      )
      .toSorted((a, b) => a.enqueuedAt - b.enqueuedAt);

    if (matchingEntries.length === 0) {
      return;
    }

    opts.log.info(
      `WhatsApp reconnect drain: ${matchingEntries.length} pending message(s) for account ${opts.accountId}`,
    );

    const deliver = opts.deliver ?? (await loadDeliverRuntime()).deliverOutboundPayloads;

    for (const entry of matchingEntries) {
      if (!claimRecoveryEntry(entry.id)) {
        opts.log.info(`WhatsApp reconnect drain: entry ${entry.id} is already being recovered`);
        continue;
      }

      if (entry.retryCount >= MAX_RETRIES) {
        try {
          await moveToFailed(entry.id, opts.stateDir);
        } catch (err) {
          if (getErrnoCode(err) === "ENOENT") {
            opts.log.info(`reconnect drain: entry ${entry.id} already gone, skipping`);
            continue;
          }
          throw err;
        } finally {
          releaseRecoveryEntry(entry.id);
        }
        opts.log.warn(
          `WhatsApp reconnect drain: entry ${entry.id} exceeded max retries and was moved to failed/`,
        );
        continue;
      }

      try {
        await deliver(buildRecoveryDeliverParams(entry, opts.cfg));
        await ackDelivery(entry.id, opts.stateDir);
      } catch (err) {
        const errMsg = formatErrorMessage(err);
        if (isPermanentDeliveryError(errMsg)) {
          await moveToFailed(entry.id, opts.stateDir).catch(() => {});
        } else {
          await failDelivery(entry.id, errMsg, opts.stateDir).catch(() => {});
        }
      } finally {
        releaseRecoveryEntry(entry.id);
      }
    }
  } finally {
    drainInProgress.delete(opts.accountId);
  }
}

/**
 * On gateway startup, scan the delivery queue and retry any pending entries.
 * Uses exponential backoff and moves entries that exceed MAX_RETRIES to failed/.
 */
export async function recoverPendingDeliveries(opts: {
  deliver: DeliverFn;
  log: RecoveryLogger;
  cfg: OpenClawConfig;
  stateDir?: string;
  /** Maximum wall-clock time for recovery in ms. Remaining entries are deferred to next startup. Default: 60 000. */
  maxRecoveryMs?: number;
}): Promise<RecoverySummary> {
  const pending = await loadPendingDeliveries(opts.stateDir);
  if (pending.length === 0) {
    return createEmptyRecoverySummary();
  }

  pending.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  opts.log.info(`Found ${pending.length} pending delivery entries — starting recovery`);

  const deadline = Date.now() + (opts.maxRecoveryMs ?? 60_000);
  const summary = createEmptyRecoverySummary();

  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    const now = Date.now();
    if (now >= deadline) {
      opts.log.warn(`Recovery time budget exceeded — remaining entries deferred to next startup`);
      await deferRemainingEntriesForBudget(pending.slice(i), opts.stateDir);
      break;
    }
    if (entry.retryCount >= MAX_RETRIES) {
      if (!claimRecoveryEntry(entry.id)) {
        opts.log.info(`Recovery skipped for delivery ${entry.id}: already being processed`);
        continue;
      }
      try {
        opts.log.warn(
          `Delivery ${entry.id} exceeded max retries (${entry.retryCount}/${MAX_RETRIES}) — moving to failed/`,
        );
        await moveEntryToFailedWithLogging(entry.id, opts.log, opts.stateDir);
        summary.skippedMaxRetries += 1;
      } finally {
        releaseRecoveryEntry(entry.id);
      }
      continue;
    }

    const retryEligibility = isEntryEligibleForRecoveryRetry(entry, now);
    if (!retryEligibility.eligible) {
      summary.deferredBackoff += 1;
      opts.log.info(
        `Delivery ${entry.id} not ready for retry yet — backoff ${retryEligibility.remainingBackoffMs}ms remaining`,
      );
      continue;
    }

    if (!claimRecoveryEntry(entry.id)) {
      opts.log.info(`Recovery skipped for delivery ${entry.id}: already being processed`);
      continue;
    }

    // [frankclaw] Pre-check DNR before attempting delivery.  Without this,
    // the outbound adapter silently drops DNR-suppressed messages during
    // recovery (returns empty result, not an error), and the entry gets
    // ackDelivery'd — lost forever.  By checking DNR here, we defer the
    // entry with the correct deferUntilMs and skip the deliver call entirely.
    if (entry.channel === "discord") {
      const dnrResult = checkRecoveryDnr(entry.to);
      if (dnrResult) {
        const frankcawEntry = entry as { deferUntilMs?: number; holdReason?: string };
        frankcawEntry.deferUntilMs = dnrResult.nextEligibleAtMs;
        frankcawEntry.holdReason = "discord-dnr-window";
        entry.lastAttemptAt = Date.now();
        entry.lastError = "discord-dnr-window";
        const filePath = path.join(
          opts.stateDir ?? resolveStateDir(),
          QUEUE_DIRNAME,
          `${entry.id}.json`,
        );
        await fs.promises.writeFile(filePath, JSON.stringify(entry, null, 2), {
          encoding: "utf-8",
          mode: 0o600,
        });
        summary.deferredBackoff += 1;
        opts.log.info(
          `Delivery ${entry.id} DNR-active — deferred until ${new Date(dnrResult.nextEligibleAtMs).toISOString()}`,
        );
        releaseRecoveryEntry(entry.id);
        continue;
      }
    }

    try {
      await opts.deliver(buildRecoveryDeliverParams(entry, opts.cfg));
      await ackDelivery(entry.id, opts.stateDir);
      summary.recovered += 1;
      opts.log.info(`Recovered delivery ${entry.id} to ${entry.channel}:${entry.to}`);
    } catch (err) {
      const errMsg = formatErrorMessage(err);
      if (isPermanentDeliveryError(errMsg)) {
        opts.log.warn(`Delivery ${entry.id} hit permanent error — moving to failed/: ${errMsg}`);
        await moveEntryToFailedWithLogging(entry.id, opts.log, opts.stateDir);
        summary.failed += 1;
        continue;
      }
      try {
        await failDelivery(entry.id, errMsg, opts.stateDir);
      } catch {
        // Best-effort update.
      }
      summary.failed += 1;
      opts.log.warn(`Retry failed for delivery ${entry.id}: ${errMsg}`);
    } finally {
      releaseRecoveryEntry(entry.id);
    }
  }

  opts.log.info(
    `Delivery recovery complete: ${summary.recovered} recovered, ${summary.failed} failed, ${summary.skippedMaxRetries} skipped (max retries), ${summary.deferredBackoff} deferred (backoff)`,
  );
  return summary;
}

export { MAX_RETRIES };
