import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type DurableDiscordInboundEvent = {
  accountId: string;
  channelId: string;
  orderingKey: string;
  messageId: string;
  payload: unknown;
};

type DurableJobState = "queued" | "processing";

type DurableDiscordInboundJob = {
  id: string;
  dedupeKey: string;
  state: DurableJobState;
  enqueuedAt: number;
  updatedAt: number;
  leaseUntil: number | null;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  event: DurableDiscordInboundEvent;
};

export type DeadLetterReason = {
  attempts: number;
  lastError?: string;
};

export type DurableDiscordInboundQueueOptions = {
  accountId: string;
  stateDir?: string;
  leaseMs?: number;
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
  now?: () => number;
  coalesce?: boolean;
  onDeadLetter?: (
    event: DurableDiscordInboundEvent,
    reason: DeadLetterReason,
  ) => Promise<void> | void;
};

export type DurableDiscordInboundQueueStats = {
  queued: number;
  processing: number;
  dead: number;
};

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 5;
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

function ensureJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toSerializableObject(value: unknown): Record<string, unknown> | null {
  // Carbon's MessageCreateListener spreads the raw API data (`...data`) at the
  // root AND stores the *same* `data` object inside `message._rawData`.  A global
  // "seen" WeakSet (used previously) treated the second encounter of shared
  // arrays/objects (e.g. `attachments`, `embeds`, `author`) as duplicates and
  // dropped them, which caused `message._rawData.attachments` to vanish and
  // image-only messages to be misclassified as empty.
  //
  // Circular references in the Discord/Carbon object graph originate from
  // `client` properties (every Carbon Base subclass stores a back-reference to
  // the Client).  Filtering `key === "client"` breaks all known cycles, so we
  // no longer need a blanket "seen" guard.  If an unforeseen circular reference
  // exists, JSON.stringify will throw a TypeError which we catch and return null.
  try {
    const json = JSON.stringify(value, (_key, nextValue) => {
      if (_key === "client") {
        return undefined;
      }
      if (nextValue && typeof nextValue === "object") {
        // Discord.js Collection extends Map — JSON.stringify serializes Map as {}.
        // Convert Map-like objects (Collection, Map) to arrays of their values so
        // attachments, embeds, etc. survive the JSON round-trip through the durable queue.
        if (
          typeof (nextValue as { values?: unknown }).values === "function" &&
          nextValue instanceof Map
        ) {
          return Array.from((nextValue as Map<unknown, unknown>).values());
        }
      }
      return nextValue;
    });
    return ensureJsonObject(JSON.parse(json));
  } catch {
    // Fallback: if an unexpected circular reference causes JSON.stringify to
    // throw, fall back to the stricter "seen" approach that at least produces
    // *some* output rather than failing entirely.
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, nextValue) => {
      if (_key === "client") {
        return undefined;
      }
      if (nextValue && typeof nextValue === "object") {
        if (seen.has(nextValue as object)) {
          return undefined;
        }
        seen.add(nextValue as object);
        if (
          typeof (nextValue as { values?: unknown }).values === "function" &&
          nextValue instanceof Map
        ) {
          return Array.from((nextValue as Map<unknown, unknown>).values());
        }
      }
      return nextValue;
    });
    return ensureJsonObject(JSON.parse(json));
  }
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function resolveQueueRoot(params: { stateDir?: string; accountId: string }): string {
  const base = params.stateDir ?? resolveStateDir();
  return path.join(base, "discord-inbound-queue", params.accountId);
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

async function readJob(filePath: string): Promise<DurableDiscordInboundJob | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DurableDiscordInboundJob;
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

export function createDiscordInboundDurableQueue(options: DurableDiscordInboundQueueOptions) {
  const queueDir = resolveQueueRoot({ stateDir: options.stateDir, accountId: options.accountId });
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const now = options.now ?? (() => Date.now());
  const backoffMs = options.backoffMs ?? computeDefaultBackoffMs;
  const coalesce = options.coalesce ?? false;

  let processor: ((event: DurableDiscordInboundEvent) => Promise<void>) | null = null;
  let batchProcessor: ((events: DurableDiscordInboundEvent[]) => Promise<void>) | null = null;
  let draining = false;
  let wakeTimer: NodeJS.Timeout | null = null;

  async function ensureDirs(): Promise<void> {
    await fs.promises.mkdir(queueDir, { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(resolveDeadDir(queueDir), { recursive: true, mode: 0o700 });
  }

  async function writeJob(job: DurableDiscordInboundJob): Promise<void> {
    await writeJsonAtomically(resolveJobPath(queueDir, job.id), job);
  }

  function clearWakeTimer(): void {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
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

  async function moveToDead(job: DurableDiscordInboundJob): Promise<void> {
    await ensureDirs();
    await writeJsonAtomically(resolveDeadPath(queueDir, job.id), {
      ...job,
      state: "queued",
      leaseUntil: null,
      updatedAt: now(),
    });
    await removeJob(job.id);
  }

  async function listLiveJobs(): Promise<DurableDiscordInboundJob[]> {
    const files = await listJobFiles(queueDir);
    const jobs: DurableDiscordInboundJob[] = [];
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
      job.state = "queued";
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

  async function claimNextJob(): Promise<DurableDiscordInboundJob | null> {
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
      job.leaseUntil = current + leaseMs;
      job.updatedAt = current;
      await writeJob(job);
      return job;
    }

    return null;
  }

  async function claimBatch(): Promise<DurableDiscordInboundJob[]> {
    const current = now();
    const jobs = await listLiveJobs();
    jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);

    // Find first eligible job (same logic as claimNextJob)
    let firstJob: DurableDiscordInboundJob | null = null;
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

    // Grab all other queued jobs with the same orderingKey
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

    // Lease all jobs in the batch
    for (const job of batch) {
      job.state = "processing";
      job.leaseUntil = current + leaseMs;
      job.updatedAt = current;
      await writeJob(job);
    }

    return batch;
  }

  async function processOne(job: DurableDiscordInboundJob): Promise<void> {
    if (!processor) {
      return;
    }
    try {
      await processor(job.event);
      await removeJob(job.id);
      return;
    } catch (err) {
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
            // Best-effort notification path; dead-lettering itself has already succeeded.
          }
        }
        return;
      }
      job.state = "queued";
      job.nextAttemptAt = now() + Math.max(0, backoffMs(job.attempts));
      await writeJob(job);
    }
  }

  async function processBatch(batch: DurableDiscordInboundJob[]): Promise<void> {
    if (!processor) {
      return;
    }
    if (batch.length === 1) {
      // Single message — no coalescing needed
      return await processOne(batch[0]);
    }
    if (!batchProcessor) {
      // No batch processor available, fall back to individual processing
      for (const job of batch) {
        await processOne(job);
      }
      return;
    }
    try {
      // Pass all events to the batch processor
      await batchProcessor(batch.map((j) => j.event));
      // On success, remove all jobs
      for (const job of batch) {
        await removeJob(job.id);
      }
    } catch (err) {
      // On failure, release all jobs back to queued with backoff
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
              // Best-effort notification path; dead-lettering itself has already succeeded.
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
      return;
    }
    draining = true;
    try {
      // Lease recovery happens before each drain cycle, including startup.
      await recoverExpiredLeases();
      while (processor) {
        if (coalesce) {
          const batch = await claimBatch();
          if (batch.length === 0) {
            break;
          }
          await processBatch(batch);
        } else {
          const job = await claimNextJob();
          if (!job) {
            break;
          }
          await processOne(job);
        }
      }
    } finally {
      draining = false;
      await scheduleNextWakeFromQueue();
    }
  }

  return {
    async start(params: {
      process: (event: DurableDiscordInboundEvent) => Promise<void>;
      processBatch?: (events: DurableDiscordInboundEvent[]) => Promise<void>;
    }) {
      processor = params.process;
      batchProcessor = params.processBatch ?? null;
      await ensureDirs();
      await recoverExpiredLeases();
      await drain();
    },

    async stop() {
      processor = null;
      batchProcessor = null;
      clearWakeTimer();
    },

    async enqueue(input: {
      channelId: string;
      messageId: string;
      orderingKey: string;
      payload: unknown;
    }): Promise<{ enqueued: boolean; dedupeKey: string }> {
      await ensureDirs();
      const dedupeKey = `${options.accountId}:${input.channelId}:${input.messageId}`;
      if (await hasDedupeKey(dedupeKey)) {
        return { enqueued: false, dedupeKey };
      }

      // Ensure payload is serializable and object-like to avoid writing unusable jobs.
      // Discord event payloads can include circular references (for example message.client).
      const normalizedPayload = toSerializableObject(input.payload);
      if (!normalizedPayload) {
        throw new Error("discord durable inbound queue requires an object payload");
      }

      const timestamp = now();
      const job: DurableDiscordInboundJob = {
        id: crypto.randomUUID(),
        dedupeKey,
        state: "queued",
        enqueuedAt: timestamp,
        updatedAt: timestamp,
        leaseUntil: null,
        attempts: 0,
        nextAttemptAt: timestamp,
        event: {
          accountId: options.accountId,
          channelId: input.channelId,
          orderingKey: input.orderingKey,
          messageId: input.messageId,
          payload: normalizedPayload,
        },
      };

      await writeJob(job);
      void drain();
      return { enqueued: true, dedupeKey };
    },

    async recoverExpiredLeases() {
      return await recoverExpiredLeases();
    },

    async getStats(): Promise<DurableDiscordInboundQueueStats> {
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
