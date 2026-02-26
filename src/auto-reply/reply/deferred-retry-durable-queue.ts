import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type DurableDeferredRetryEvent = {
  dedupeKey: string;
  failureMessage?: string;
  followupRun: unknown;
  baseDedupeKey?: string;
  attemptIndex?: number;
  firstEnqueuedAt?: number;
  scheduledDelayMs?: number;
};

type DurableDeferredRetryJobState = "queued" | "processing";

type DurableDeferredRetryJob = {
  id: string;
  dedupeKey: string;
  state: DurableDeferredRetryJobState;
  enqueuedAt: number;
  updatedAt: number;
  leaseUntil: number | null;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  event: DurableDeferredRetryEvent;
};

export type DurableDeferredRetryDeadLetterReason = {
  attempts: number;
  lastError?: string;
};

export type DurableDeferredRetryQueueOptions = {
  stateDir?: string;
  queueName?: string;
  leaseMs?: number;
  now?: () => number;
  onDeadLetter?: (
    event: DurableDeferredRetryEvent,
    reason: DurableDeferredRetryDeadLetterReason,
  ) => Promise<void> | void;
};

export type DurableDeferredRetryQueueStats = {
  queued: number;
  processing: number;
  dead: number;
};

const DEFAULT_LEASE_MS = 60_000;

function resolveQueueRoot(params: { stateDir?: string; queueName: string }): string {
  const base = params.stateDir ?? resolveStateDir();
  return path.join(base, "auto-reply", "deferred-retry", params.queueName);
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

async function readJob(filePath: string): Promise<DurableDeferredRetryJob | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DurableDeferredRetryJob;
  } catch {
    return null;
  }
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dirPath);
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
    .map((entry) => path.join(dirPath, entry));
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function normalizeSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createDeferredRetryDurableQueue(options: DurableDeferredRetryQueueOptions = {}) {
  const queueName = options.queueName?.trim() || "default";
  const queueDir = resolveQueueRoot({ stateDir: options.stateDir, queueName });
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const now = options.now ?? (() => Date.now());

  let processor: ((event: DurableDeferredRetryEvent) => Promise<void>) | null = null;
  let draining = false;
  let wakeTimer: NodeJS.Timeout | null = null;

  async function ensureDirs(): Promise<void> {
    await fs.promises.mkdir(queueDir, { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(resolveDeadDir(queueDir), { recursive: true, mode: 0o700 });
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

  async function writeJob(job: DurableDeferredRetryJob): Promise<void> {
    await writeJsonAtomically(resolveJobPath(queueDir, job.id), job);
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

  async function moveToDead(job: DurableDeferredRetryJob): Promise<void> {
    await ensureDirs();
    await writeJsonAtomically(resolveDeadPath(queueDir, job.id), {
      ...job,
      state: "queued",
      leaseUntil: null,
      updatedAt: now(),
    });
    await removeJob(job.id);
  }

  async function listLiveJobs(): Promise<DurableDeferredRetryJob[]> {
    const files = await listJsonFiles(queueDir);
    const jobs: DurableDeferredRetryJob[] = [];
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
    const deadFiles = await listJsonFiles(resolveDeadDir(queueDir));
    for (const filePath of deadFiles) {
      const deadJob = await readJob(filePath);
      if (deadJob?.dedupeKey === dedupeKey) {
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

  async function claimNextDueJob(): Promise<DurableDeferredRetryJob | null> {
    const current = now();
    const jobs = await listLiveJobs();
    jobs.sort((a, b) => {
      if (a.nextAttemptAt !== b.nextAttemptAt) {
        return a.nextAttemptAt - b.nextAttemptAt;
      }
      return a.enqueuedAt - b.enqueuedAt;
    });

    for (const job of jobs) {
      if (job.state !== "queued") {
        continue;
      }
      if (job.nextAttemptAt > current) {
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

  async function processOne(job: DurableDeferredRetryJob): Promise<void> {
    if (!processor) {
      return;
    }
    try {
      await processor(job.event);
      await removeJob(job.id);
    } catch (err) {
      job.attempts += 1;
      job.lastError = normalizeErrorMessage(err);
      job.updatedAt = now();
      job.leaseUntil = null;
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
          // Best effort callback.
        }
      }
    }
  }

  async function scheduleNextWakeFromQueue(): Promise<void> {
    if (!processor) {
      return;
    }
    const jobs = await listLiveJobs();
    const current = now();
    const nextDue = jobs.reduce<number | null>((earliest, job) => {
      const candidate =
        job.state === "queued" ? Math.max(job.nextAttemptAt, current) : (job.leaseUntil ?? current);
      if (earliest == null) {
        return candidate;
      }
      return Math.min(earliest, candidate);
    }, null);
    if (nextDue == null) {
      clearWakeTimer();
      return;
    }
    scheduleWake(nextDue - current);
  }

  async function drain(): Promise<void> {
    if (draining) {
      return;
    }
    draining = true;
    try {
      await recoverExpiredLeases();
      while (processor) {
        const job = await claimNextDueJob();
        if (!job) {
          break;
        }
        await processOne(job);
      }
    } finally {
      draining = false;
      await scheduleNextWakeFromQueue();
    }
  }

  return {
    async start(params: { process: (event: DurableDeferredRetryEvent) => Promise<void> }) {
      processor = params.process;
      await ensureDirs();
      await recoverExpiredLeases();
      await drain();
    },

    async stop() {
      processor = null;
      clearWakeTimer();
    },

    async enqueue(input: {
      dedupeKey: string;
      nextAttemptAt: number;
      failureMessage?: string;
      followupRun: unknown;
      baseDedupeKey?: string;
      attemptIndex?: number;
      firstEnqueuedAt?: number;
      scheduledDelayMs?: number;
    }): Promise<{ enqueued: boolean; dedupeKey: string }> {
      await ensureDirs();
      const dedupeKey = input.dedupeKey.trim();
      if (!dedupeKey) {
        throw new Error("deferred retry durable queue requires dedupeKey");
      }
      if (await hasDedupeKey(dedupeKey)) {
        return { enqueued: false, dedupeKey };
      }

      const event: DurableDeferredRetryEvent = {
        dedupeKey,
        failureMessage: input.failureMessage,
        followupRun: normalizeSerializable(input.followupRun),
        baseDedupeKey: input.baseDedupeKey,
        attemptIndex: input.attemptIndex,
        firstEnqueuedAt: input.firstEnqueuedAt,
        scheduledDelayMs: input.scheduledDelayMs,
      };
      const timestamp = now();
      const job: DurableDeferredRetryJob = {
        id: crypto.randomUUID(),
        dedupeKey,
        state: "queued",
        enqueuedAt: timestamp,
        updatedAt: timestamp,
        leaseUntil: null,
        attempts: 0,
        nextAttemptAt: Math.max(timestamp, input.nextAttemptAt),
        event,
      };

      await writeJob(job);
      void drain();
      return { enqueued: true, dedupeKey };
    },

    async recoverExpiredLeases() {
      return await recoverExpiredLeases();
    },

    async getStats(): Promise<DurableDeferredRetryQueueStats> {
      const jobs = await listLiveJobs();
      const dead = (await listJsonFiles(resolveDeadDir(queueDir))).length;
      const queued = jobs.filter((job) => job.state === "queued").length;
      const processing = jobs.filter((job) => job.state === "processing").length;
      return { queued, processing, dead };
    },

    async listLiveJobsForTest() {
      const jobs = await listLiveJobs();
      jobs.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      return jobs;
    },
  };
}
