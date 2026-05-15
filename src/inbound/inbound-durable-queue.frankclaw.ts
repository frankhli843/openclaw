/**
 * frankclaw: Generic durable inbound queue used by WhatsApp and Telegram
 * extensions (and any future channel that needs SQS-style visibility timeout
 * + retry + dead-letter on top of inbound message processing).
 *
 * This is a deliberately separate copy from the Discord-specific
 * `extensions/discord/src/monitor/inbound-durable-queue.ts` so that the
 * Discord state directory and on-disk format remain untouched while new
 * channels adopt the pattern. The two modules are intentionally near
 * duplicates; converging them is future work.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type DurableInboundChannel = "whatsapp" | "telegram";

export type DurableInboundEvent = {
  channel: DurableInboundChannel;
  accountId: string;
  /** Logical session/conversation key. Two jobs sharing this key are processed in order. */
  orderingKey: string;
  /** Channel-specific external id (WhatsApp message id, Telegram update_id, etc.). */
  externalId: string;
  /** JSON-serializable payload understood by the channel's process callback. */
  payload: unknown;
};

type DurableJobState = "queued" | "processing";

type DurableInboundJob = {
  id: string;
  dedupeKey: string;
  state: DurableJobState;
  enqueuedAt: number;
  updatedAt: number;
  claimedAt: number | null;
  leaseUntil: number | null;
  visibilityTimeoutMs: number;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  event: DurableInboundEvent;
};

export type DeadLetterReason = {
  attempts: number;
  lastError?: string;
};

export type DurableInboundQueueOptions = {
  channel: DurableInboundChannel;
  accountId: string;
  /** Optional override for tests. Defaults to resolveStateDir(). */
  stateDir?: string;
  /** SQS-style visibility timeout (ms). Defaults to 5 min. */
  visibilityTimeoutMs?: number;
  /** Maximum attempts before dead-lettering. Defaults to 3. */
  maxAttempts?: number;
  /** Maximum concurrent in-flight ordering keys. Defaults to 4. */
  maxConcurrent?: number;
  /** Custom backoff. Receives attempt count (1-indexed). */
  backoffMs?: (attempt: number) => number;
  /** Injection point for tests. */
  now?: () => number;
  /** Coalesce queued events sharing the same orderingKey into one batch. */
  coalesce?: boolean;
  /** Called when a job is dead-lettered after exhausting attempts. */
  onDeadLetter?: (event: DurableInboundEvent, reason: DeadLetterReason) => Promise<void> | void;
};

export type DurableInboundQueueStats = {
  queued: number;
  processing: number;
  dead: number;
};

const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS: readonly number[] = [2_000, 10_000, 60_000, 300_000];

function computeDefaultBackoffMs(attempt: number): number {
  if (attempt <= 0) {
    return 0;
  }
  return (
    DEFAULT_BACKOFF_MS[Math.min(attempt - 1, DEFAULT_BACKOFF_MS.length - 1)] ??
    DEFAULT_BACKOFF_MS.at(-1) ??
    0
  );
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function resolveQueueRoot(params: {
  stateDir?: string;
  channel: DurableInboundChannel;
  accountId: string;
}): string {
  const base = params.stateDir ?? resolveStateDir();
  return path.join(base, "inbound-durable-queue", params.channel, params.accountId);
}

function resolveJobPath(queueDir: string, id: string): string {
  return path.join(queueDir, `${id}.json`);
}

function resolveDeadDir(queueDir: string): string {
  return path.join(queueDir, "dead");
}

function resolveDeadPath(queueDir: string, id: string): string {
  return path.join(resolveDeadDir(queueDir), `${id}.json`);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

async function readJob(filePath: string): Promise<DurableInboundJob | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DurableInboundJob;
  } catch {
    return null;
  }
}

async function listJobFiles(queueDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(queueDir);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(queueDir, entry));
}

export type InboundDurableQueue = {
  start: (params: {
    process: (event: DurableInboundEvent) => Promise<void>;
    processBatch?: (events: DurableInboundEvent[]) => Promise<void>;
  }) => Promise<void>;
  stop: () => Promise<void>;
  enqueue: (input: {
    orderingKey: string;
    externalId: string;
    payload: unknown;
  }) => Promise<{ enqueued: boolean; dedupeKey: string; jobId?: string }>;
  recoverExpiredLeases: () => Promise<number>;
  getStats: () => Promise<DurableInboundQueueStats>;
  listLiveJobsForTest: () => Promise<DurableInboundJob[]>;
  claimBatchForTest: () => Promise<DurableInboundJob[]>;
};

export function createInboundDurableQueue(
  options: DurableInboundQueueOptions,
): InboundDurableQueue {
  const queueDir = resolveQueueRoot({
    stateDir: options.stateDir,
    channel: options.channel,
    accountId: options.accountId,
  });
  const leaseMs = options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const now = options.now ?? (() => Date.now());
  const backoffMs = options.backoffMs ?? computeDefaultBackoffMs;
  const coalesce = options.coalesce ?? false;
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4);

  let processor: ((event: DurableInboundEvent) => Promise<void>) | null = null;
  let batchProcessor: ((events: DurableInboundEvent[]) => Promise<void>) | null = null;
  let draining = false;
  let drainRequested = false;
  let activeBatches = 0;
  let wakeTimer: NodeJS.Timeout | null = null;
  const PERIODIC_RECOVERY_INTERVAL_MS = 10_000;
  let periodicRecoveryTimer: NodeJS.Timeout | null = null;

  const COMPLETED_KEY_TTL_MS = 10 * 60_000;
  const completedKeys = new Map<string, number>();

  function recordCompleted(dedupeKey: string): void {
    completedKeys.set(dedupeKey, now());
  }

  function isRecentlyCompleted(dedupeKey: string): boolean {
    const completedAt = completedKeys.get(dedupeKey);
    if (completedAt === undefined) {
      return false;
    }
    if (now() - completedAt > COMPLETED_KEY_TTL_MS) {
      completedKeys.delete(dedupeKey);
      return false;
    }
    return true;
  }

  function pruneCompletedKeys(): void {
    const cutoff = now() - COMPLETED_KEY_TTL_MS;
    for (const [key, ts] of completedKeys) {
      if (ts < cutoff) {
        completedKeys.delete(key);
      }
    }
  }

  async function ensureDirs(): Promise<void> {
    await fs.promises.mkdir(queueDir, { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(resolveDeadDir(queueDir), { recursive: true, mode: 0o700 });
  }

  async function writeJob(job: DurableInboundJob): Promise<void> {
    await writeJsonAtomically(resolveJobPath(queueDir, job.id), job);
  }

  function clearWakeTimer(): void {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  }

  function startPeriodicRecovery(): void {
    if (periodicRecoveryTimer) {
      return;
    }
    periodicRecoveryTimer = setInterval(() => {
      void (async () => {
        pruneCompletedKeys();
        const recovered = await recoverExpiredLeases();
        if (recovered > 0) {
          console.info(
            `[${options.channel}-durable-queue] periodic check: reclaimed ${recovered} expired visibility timeout(s) for reprocessing`,
          );
          void drain();
        }
      })();
    }, PERIODIC_RECOVERY_INTERVAL_MS);
    periodicRecoveryTimer.unref?.();
  }

  function stopPeriodicRecovery(): void {
    if (periodicRecoveryTimer) {
      clearInterval(periodicRecoveryTimer);
      periodicRecoveryTimer = null;
    }
  }

  function scheduleWake(delayMs: number): void {
    if (!processor) {
      return;
    }
    clearWakeTimer();
    const safeDelay = Math.max(0, delayMs);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void drain();
    }, safeDelay);
    wakeTimer.unref?.();
  }

  async function removeJob(id: string): Promise<void> {
    try {
      await fs.promises.unlink(resolveJobPath(queueDir, id));
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
      if (code !== "ENOENT") {
        throw err;
      }
    }
  }

  async function moveToDead(job: DurableInboundJob): Promise<void> {
    await ensureDirs();
    await writeJsonAtomically(resolveDeadPath(queueDir, job.id), {
      ...job,
      state: "queued",
      leaseUntil: null,
      updatedAt: now(),
    });
    await removeJob(job.id);
  }

  async function listLiveJobs(): Promise<DurableInboundJob[]> {
    const files = await listJobFiles(queueDir);
    const jobs: DurableInboundJob[] = [];
    for (const filePath of files) {
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        continue;
      }
      const job = await readJob(filePath);
      if (!job) {
        continue;
      }
      jobs.push(job);
    }
    return jobs;
  }

  async function hasDedupeKey(dedupeKey: string): Promise<boolean> {
    if (isRecentlyCompleted(dedupeKey)) {
      return true;
    }
    const jobs = await listLiveJobs();
    if (jobs.some((job) => job.dedupeKey === dedupeKey)) {
      return true;
    }
    const deadFiles = await listJobFiles(resolveDeadDir(queueDir));
    for (const filePath of deadFiles) {
      const job = await readJob(filePath);
      if (job?.dedupeKey === dedupeKey) {
        return true;
      }
    }
    return false;
  }

  async function reclaimAllProcessingJobs(): Promise<number> {
    const jobs = await listLiveJobs();
    let reclaimed = 0;
    const current = now();
    for (const job of jobs) {
      if (job.state !== "processing") {
        continue;
      }
      console.info(
        `[${options.channel}-durable-queue] startup reclaim: id=${job.id} externalId=${job.event.externalId} orderingKey=${job.event.orderingKey} attempts=${job.attempts}`,
      );
      job.state = "queued";
      job.claimedAt = null;
      job.leaseUntil = null;
      job.nextAttemptAt = Math.min(job.nextAttemptAt, current);
      job.updatedAt = current;
      await writeJob(job);
      reclaimed += 1;
    }
    return reclaimed;
  }

  async function recoverExpiredLeases(): Promise<number> {
    const jobs = await listLiveJobs();
    let recovered = 0;
    const current = now();
    for (const job of jobs) {
      if (job.state !== "processing") {
        continue;
      }
      if (job.leaseUntil && job.leaseUntil > current) {
        continue;
      }
      const expiredAgoMs = job.leaseUntil ? current - job.leaseUntil : 0;
      console.info(
        `[${options.channel}-durable-queue] reclaiming expired in-flight job: id=${job.id} externalId=${job.event.externalId} orderingKey=${job.event.orderingKey} expiredAgoMs=${expiredAgoMs} attempts=${job.attempts}`,
      );
      job.state = "queued";
      job.claimedAt = null;
      job.leaseUntil = null;
      job.nextAttemptAt = Math.min(job.nextAttemptAt, current);
      job.updatedAt = current;
      await writeJob(job);
      recovered += 1;
    }
    return recovered;
  }

  async function scheduleNextWakeFromQueue(): Promise<void> {
    if (!processor) {
      return;
    }
    const jobs = await listLiveJobs();
    const current = now();
    const nextWakeAt = jobs.reduce<number | null>((earliest, job) => {
      let candidate: number | null = null;
      if (job.state === "queued") {
        candidate = Math.max(job.nextAttemptAt, current);
      } else {
        candidate = job.leaseUntil ?? current;
      }
      if (earliest == null) {
        return candidate;
      }
      return Math.min(earliest, candidate);
    }, null);

    if (nextWakeAt == null) {
      clearWakeTimer();
      return;
    }
    scheduleWake(nextWakeAt - current);
  }

  async function claimNextJob(): Promise<DurableInboundJob | null> {
    const current = now();
    const jobs = await listLiveJobs();
    jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    for (const job of jobs) {
      if (job.state !== "queued") {
        continue;
      }
      if (job.nextAttemptAt > current) {
        continue;
      }
      const lockedByOrdering = jobs.some(
        (other) =>
          other.id !== job.id &&
          other.event.orderingKey === job.event.orderingKey &&
          other.state === "processing" &&
          (other.leaseUntil ?? 0) > current,
      );
      if (lockedByOrdering) {
        continue;
      }
      job.state = "processing";
      job.claimedAt = current;
      job.leaseUntil = current + leaseMs;
      job.visibilityTimeoutMs = leaseMs;
      job.updatedAt = current;
      await writeJob(job);
      return job;
    }

    return null;
  }

  async function claimBatch(): Promise<DurableInboundJob[]> {
    const current = now();
    const jobs = await listLiveJobs();
    jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    let firstJob: DurableInboundJob | null = null;
    for (const job of jobs) {
      if (job.state !== "queued") {
        continue;
      }
      if (job.nextAttemptAt > current) {
        continue;
      }
      const lockedByOrdering = jobs.some(
        (other) =>
          other.id !== job.id &&
          other.event.orderingKey === job.event.orderingKey &&
          other.state === "processing" &&
          (other.leaseUntil ?? 0) > current,
      );
      if (lockedByOrdering) {
        continue;
      }
      firstJob = job;
      break;
    }

    if (!firstJob) {
      return [];
    }

    const batch = [firstJob];
    const orderingKey = firstJob.event.orderingKey;
    for (const job of jobs) {
      if (job.id === firstJob.id) {
        continue;
      }
      if (job.state !== "queued") {
        continue;
      }
      if (job.event.orderingKey !== orderingKey) {
        continue;
      }
      if (job.nextAttemptAt > current) {
        continue;
      }
      batch.push(job);
    }

    for (const job of batch) {
      job.state = "processing";
      job.claimedAt = current;
      job.leaseUntil = current + leaseMs;
      job.visibilityTimeoutMs = leaseMs;
      job.updatedAt = current;
      await writeJob(job);
    }

    return batch;
  }

  async function processOne(job: DurableInboundJob): Promise<void> {
    if (!processor) {
      return;
    }
    try {
      await processor(job.event);
      if (!processor) {
        // Queue stopped while processor was running. Leave the job's on-disk
        // "processing" state untouched so the next queue instance reclaims it
        // via reclaimAllProcessingJobs() on startup.
        return;
      }
      recordCompleted(job.dedupeKey);
      await removeJob(job.id);
      return;
    } catch (err) {
      if (!processor) {
        return;
      }
      job.attempts += 1;
      job.lastError = normalizeErrorMessage(err);
      job.updatedAt = now();
      job.leaseUntil = null;
      if (job.attempts >= maxAttempts) {
        await moveToDead(job);
        if (options.onDeadLetter) {
          try {
            await Promise.resolve(
              options.onDeadLetter(job.event, {
                attempts: job.attempts,
                lastError: job.lastError,
              }),
            );
          } catch {
            // Best-effort notification.
          }
        }
        return;
      }
      job.state = "queued";
      job.nextAttemptAt = now() + Math.max(0, backoffMs(job.attempts));
      await writeJob(job);
    }
  }

  async function processBatch(batch: DurableInboundJob[]): Promise<void> {
    if (!processor) {
      return;
    }
    if (batch.length === 1) {
      return await processOne(batch[0]);
    }
    if (!batchProcessor) {
      for (const job of batch) {
        await processOne(job);
      }
      return;
    }
    try {
      await batchProcessor(batch.map((j) => j.event));
      if (!processor) {
        return;
      }
      for (const job of batch) {
        recordCompleted(job.dedupeKey);
        await removeJob(job.id);
      }
    } catch (err) {
      if (!processor) {
        return;
      }
      for (const job of batch) {
        job.attempts += 1;
        job.lastError = normalizeErrorMessage(err);
        job.updatedAt = now();
        job.leaseUntil = null;
        if (job.attempts >= maxAttempts) {
          await moveToDead(job);
          if (options.onDeadLetter) {
            try {
              await Promise.resolve(
                options.onDeadLetter(job.event, {
                  attempts: job.attempts,
                  lastError: job.lastError,
                }),
              );
            } catch {
              // Best-effort notification.
            }
          }
        } else {
          job.state = "queued";
          job.nextAttemptAt = now() + Math.max(0, backoffMs(job.attempts));
          await writeJob(job);
        }
      }
    }
  }

  async function drain(): Promise<void> {
    if (draining) {
      drainRequested = true;
      return;
    }
    draining = true;
    try {
      do {
        drainRequested = false;
        const recovered = await recoverExpiredLeases();
        if (recovered > 0) {
          console.info(`[${options.channel}-durable-queue] recovered ${recovered} expired leases`);
        }
        // eslint-disable-next-line no-unmodified-loop-condition -- processor mutated by start()/stop()
        while (processor) {
          if (activeBatches >= maxConcurrent) {
            break;
          }
          if (coalesce) {
            const batch = await claimBatch();
            if (batch.length === 0) {
              break;
            }
            activeBatches += 1;
            void processBatch(batch)
              .catch(() => {
                // handled in processBatch
              })
              .finally(() => {
                activeBatches -= 1;
                void drain();
              });
          } else {
            const job = await claimNextJob();
            if (!job) {
              break;
            }
            activeBatches += 1;
            void processOne(job).finally(() => {
              activeBatches -= 1;
              void drain();
            });
          }
        }
      } while (drainRequested && processor); // eslint-disable-line no-unmodified-loop-condition
    } finally {
      draining = false;
      await scheduleNextWakeFromQueue();
    }
  }

  return {
    async start(params) {
      processor = params.process;
      batchProcessor = params.processBatch ?? null;
      await ensureDirs();
      const startupReclaimed = await reclaimAllProcessingJobs();
      if (startupReclaimed > 0) {
        console.info(
          `[${options.channel}-durable-queue] startup: reclaimed ${startupReclaimed} in-flight job(s) from previous process`,
        );
      }
      startPeriodicRecovery();
      await drain();
    },

    async stop() {
      processor = null;
      batchProcessor = null;
      clearWakeTimer();
      stopPeriodicRecovery();
    },

    async enqueue(input) {
      await ensureDirs();
      const dedupeKey = `${options.channel}:${options.accountId}:${input.orderingKey}:${input.externalId}`;
      if (await hasDedupeKey(dedupeKey)) {
        return { enqueued: false, dedupeKey };
      }
      const timestamp = now();
      const job: DurableInboundJob = {
        id: crypto.randomUUID(),
        dedupeKey,
        state: "queued",
        enqueuedAt: timestamp,
        updatedAt: timestamp,
        claimedAt: null,
        leaseUntil: null,
        visibilityTimeoutMs: leaseMs,
        attempts: 0,
        nextAttemptAt: timestamp,
        event: {
          channel: options.channel,
          accountId: options.accountId,
          orderingKey: input.orderingKey,
          externalId: input.externalId,
          payload: input.payload,
        },
      };
      await writeJob(job);
      void drain();
      return { enqueued: true, dedupeKey, jobId: job.id };
    },

    async recoverExpiredLeases() {
      return await recoverExpiredLeases();
    },

    async getStats(): Promise<DurableInboundQueueStats> {
      const jobs = await listLiveJobs();
      const dead = (await listJobFiles(resolveDeadDir(queueDir))).length;
      const queued = jobs.filter((job) => job.state === "queued").length;
      const processing = jobs.filter((job) => job.state === "processing").length;
      return { queued, processing, dead };
    },

    async listLiveJobsForTest() {
      const jobs = await listLiveJobs();
      jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      return jobs;
    },

    async claimBatchForTest() {
      return await claimBatch();
    },
  };
}

/** @internal Test-only helpers. */
export const __testing = {
  computeDefaultBackoffMs,
  resolveQueueRoot,
};
