import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

type DurableQueueJobState = "queued" | "processing" | "succeeded";

type VerificationState = "pending" | "passed" | "failed" | "skipped";
type HealerState = "idle" | "running" | "succeeded" | "failed" | "skipped";

export type DurableQueueDeadLetterReason =
  | "retry-exhausted"
  | "timeout-exceeded"
  | "verifier-failed"
  | "healer-failed";

export type DurableQueueMetadata = {
  attempts: number;
  firstStartAt?: number;
  lastAttemptAt?: number;
  verifier: {
    status: VerificationState;
    detail?: string;
    checkedAt?: number;
  };
  healer: {
    status: HealerState;
    detail?: string;
    startedAt?: number;
    completedAt?: number;
  };
  selfHealGate?: {
    evaluatedAt: number;
    decision: "attempt" | "skip";
    reason: string;
    fingerprint?: string;
    priorAttemptsInWindow: number;
    windowMs: number;
  };
  deadLetterReason?: DurableQueueDeadLetterReason;
  sideEffects: {
    sentMessageKeys: string[];
  };
};

type DurableQueueJob<TPayload = unknown, TResult = unknown> = {
  id: string;
  queue: string;
  kind: string;
  dedupeKey: string;
  state: DurableQueueJobState;
  createdAt: number;
  updatedAt: number;
  leaseUntil: number | null;
  payload: TPayload;
  result?: TResult;
  lastError?: string;
  metadata: DurableQueueMetadata;
};

export type DurableJobQueueRunContext = {
  /**
   * Returns true only when the message key is newly recorded. Duplicate keys
   * are suppressed and return false.
   */
  recordMessageSend: (messageKey: string) => boolean;
  hasMessageSend: (messageKey: string) => boolean;
};

export type DurableJobQueueRunOptions<TPayload, TResult> = {
  queue: string;
  kind: string;
  payload: TPayload;
  dedupeKey?: string;
  excludeFromQueue?: boolean;
  run: (payload: TPayload, ctx: DurableJobQueueRunContext) => Promise<TResult>;
  verify?: (params: {
    payload: TPayload;
    result: TResult;
    metadata: DurableQueueMetadata;
  }) => Promise<{ ok: boolean; detail?: string }>;
  heal?: (params: {
    payload: TPayload;
    result: TResult;
    metadata: DurableQueueMetadata;
    ctx: DurableJobQueueRunContext;
  }) => Promise<{ ok: boolean; detail?: string; result?: TResult }>;
  onDeadLetter?: (params: {
    queue: string;
    kind: string;
    dedupeKey: string;
    reason: DurableQueueDeadLetterReason;
    metadata: DurableQueueMetadata;
    error?: string;
  }) => Promise<void> | void;
};

export type DurableJobQueueOptions = {
  stateDir?: string;
  now?: () => number;
  maxRuntimeMs?: number;
  leaseMs?: number;
};

const DEFAULT_MAX_RUNTIME_MS = 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 2;
const SELF_HEAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SELF_HEAL_ATTEMPTS_PER_WINDOW = 2;

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return String(err);
}

function normalizeIssueFingerprint(detail?: string): string | undefined {
  if (!detail) {
    return undefined;
  }
  const normalized = detail.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 240);
  return normalized || undefined;
}

function makeRunContext(metadata: DurableQueueMetadata): DurableJobQueueRunContext {
  const set = new Set(metadata.sideEffects.sentMessageKeys);
  return {
    recordMessageSend: (messageKey: string) => {
      const trimmed = messageKey.trim();
      if (!trimmed || set.has(trimmed)) {
        return false;
      }
      set.add(trimmed);
      metadata.sideEffects.sentMessageKeys = Array.from(set.values());
      return true;
    },
    hasMessageSend: (messageKey: string) => {
      const trimmed = messageKey.trim();
      return !!trimmed && set.has(trimmed);
    },
  };
}

function resolveQueueDir(root: string, queue: string): string {
  return path.join(root, queue);
}

function resolveLiveDir(root: string, queue: string): string {
  return path.join(resolveQueueDir(root, queue), "live");
}

function resolveDeadDir(root: string, queue: string): string {
  return path.join(resolveQueueDir(root, queue), "dead");
}

function resolveLivePath(root: string, queue: string, id: string): string {
  return path.join(resolveLiveDir(root, queue), `${id}.json`);
}

function resolveDeadPath(root: string, queue: string, id: string): string {
  return path.join(resolveDeadDir(root, queue), `${id}.json`);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.promises.rename(tmp, filePath);
}

async function readJob<TPayload = unknown, TResult = unknown>(
  filePath: string,
): Promise<DurableQueueJob<TPayload, TResult> | null> {
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DurableQueueJob<TPayload, TResult>;
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
        : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw err;
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry));
}

export function createDurableJobQueue(opts: DurableJobQueueOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const maxRuntimeMs = Math.max(1_000, opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS);
  const leaseMs = Math.max(1_000, opts.leaseMs ?? DEFAULT_LEASE_MS);
  const rootDir = path.join(opts.stateDir ?? resolveStateDir(), "durable-job-queue");

  async function ensureDirs(queue: string): Promise<void> {
    await fs.promises.mkdir(resolveLiveDir(rootDir, queue), { recursive: true, mode: 0o700 });
    await fs.promises.mkdir(resolveDeadDir(rootDir, queue), { recursive: true, mode: 0o700 });
  }

  async function writeLiveJob<TPayload, TResult>(job: DurableQueueJob<TPayload, TResult>) {
    await writeJsonAtomically(resolveLivePath(rootDir, job.queue, job.id), job);
  }

  async function removeLiveJob(queue: string, id: string): Promise<void> {
    try {
      await fs.promises.unlink(resolveLivePath(rootDir, queue, id));
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : undefined;
      if (code !== "ENOENT") {
        throw err;
      }
    }
  }

  async function moveToDead<TPayload, TResult>(
    job: DurableQueueJob<TPayload, TResult>,
    reason: DurableQueueDeadLetterReason,
    error?: string,
  ): Promise<void> {
    job.metadata.deadLetterReason = reason;
    job.updatedAt = now();
    job.lastError = error;
    await writeJsonAtomically(resolveDeadPath(rootDir, job.queue, job.id), {
      ...job,
      state: "queued",
      leaseUntil: null,
    });
    await removeLiveJob(job.queue, job.id);
  }

  async function listJobs<TPayload, TResult>(
    queue: string,
    dir: "live" | "dead",
  ): Promise<Array<DurableQueueJob<TPayload, TResult>>> {
    const folder = dir === "live" ? resolveLiveDir(rootDir, queue) : resolveDeadDir(rootDir, queue);
    const files = await listJsonFiles(folder);
    const jobs: Array<DurableQueueJob<TPayload, TResult>> = [];
    for (const file of files) {
      const parsed = await readJob<TPayload, TResult>(file);
      if (parsed) {
        jobs.push(parsed);
      }
    }
    return jobs;
  }

  async function findByDedupeKey<TPayload, TResult>(
    queue: string,
    dedupeKey: string,
  ): Promise<{ location: "live" | "dead"; job: DurableQueueJob<TPayload, TResult> } | null> {
    const live = await listJobs<TPayload, TResult>(queue, "live");
    const liveMatch = live.find((job) => job.dedupeKey === dedupeKey);
    if (liveMatch) {
      return { location: "live", job: liveMatch };
    }
    const dead = await listJobs<TPayload, TResult>(queue, "dead");
    const deadMatch = dead.find((job) => job.dedupeKey === dedupeKey);
    if (deadMatch) {
      return { location: "dead", job: deadMatch };
    }
    return null;
  }

  async function countRecentSelfHealAttempts(params: {
    queue: string;
    kind: string;
    fingerprint: string;
    excludeJobId?: string;
    nowTs: number;
    windowMs: number;
  }): Promise<number> {
    const [liveJobs, deadJobs] = await Promise.all([
      listJobs(params.queue, "live"),
      listJobs(params.queue, "dead"),
    ]);
    const floor = params.nowTs - params.windowMs;
    let count = 0;

    for (const candidate of [...liveJobs, ...deadJobs]) {
      if (candidate.id === params.excludeJobId) {
        continue;
      }
      if (candidate.kind !== params.kind) {
        continue;
      }
      const startedAt = candidate.metadata.healer.startedAt;
      if (typeof startedAt !== "number" || startedAt < floor) {
        continue;
      }
      const candidateFingerprint = normalizeIssueFingerprint(candidate.metadata.verifier.detail);
      if (!candidateFingerprint || candidateFingerprint !== params.fingerprint) {
        continue;
      }
      count += 1;
    }

    return count;
  }

  async function run<TPayload, TResult>(
    options: DurableJobQueueRunOptions<TPayload, TResult>,
  ): Promise<TResult> {
    if (options.excludeFromQueue) {
      const metadata: DurableQueueMetadata = {
        attempts: 1,
        verifier: { status: "skipped" },
        healer: { status: "skipped" },
        sideEffects: { sentMessageKeys: [] },
      };
      return await options.run(options.payload, makeRunContext(metadata));
    }

    const queue = options.queue.trim() || "default";
    const dedupeKey =
      options.dedupeKey?.trim() || `${queue}:${options.kind}:${crypto.randomUUID()}`;
    await ensureDirs(queue);

    const existing = await findByDedupeKey<TPayload, TResult>(queue, dedupeKey);
    let job: DurableQueueJob<TPayload, TResult>;
    if (existing) {
      job = existing.job;
      if (existing.location === "dead") {
        throw new Error(`durable queue job already dead-lettered: ${dedupeKey}`);
      }
      if (job.state === "succeeded") {
        if (job.result !== undefined) {
          return job.result;
        }
        throw new Error(`durable queue succeeded job is missing result: ${dedupeKey}`);
      }
    } else {
      const timestamp = now();
      job = {
        id: crypto.randomUUID(),
        queue,
        kind: options.kind,
        dedupeKey,
        state: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
        leaseUntil: null,
        payload: JSON.parse(JSON.stringify(options.payload)) as TPayload,
        metadata: {
          attempts: 0,
          verifier: { status: "pending" },
          healer: { status: "idle" },
          sideEffects: { sentMessageKeys: [] },
        },
      };
      await writeLiveJob(job);
    }

    for (;;) {
      const current =
        (await readJob<TPayload, TResult>(resolveLivePath(rootDir, queue, job.id))) ?? job;
      job = current;

      const elapsedMs =
        typeof job.metadata.firstStartAt === "number" ? now() - job.metadata.firstStartAt : 0;
      if (elapsedMs > maxRuntimeMs) {
        await moveToDead(job, "timeout-exceeded", "job exceeded maximum runtime window");
        await options.onDeadLetter?.({
          queue,
          kind: options.kind,
          dedupeKey,
          reason: "timeout-exceeded",
          metadata: job.metadata,
          error: "job exceeded maximum runtime window",
        });
        throw new Error(`durable queue timeout exceeded: ${dedupeKey}`);
      }

      if (job.metadata.attempts >= MAX_ATTEMPTS) {
        await moveToDead(job, "retry-exhausted", job.lastError);
        await options.onDeadLetter?.({
          queue,
          kind: options.kind,
          dedupeKey,
          reason: "retry-exhausted",
          metadata: job.metadata,
          error: job.lastError,
        });
        throw new Error(`durable queue attempts exhausted: ${dedupeKey}`);
      }

      const runAt = now();
      job.state = "processing";
      job.leaseUntil = runAt + leaseMs;
      job.updatedAt = runAt;
      if (typeof job.metadata.firstStartAt !== "number") {
        job.metadata.firstStartAt = runAt;
      }
      job.metadata.lastAttemptAt = runAt;
      job.metadata.attempts += 1;
      await writeLiveJob(job);

      let runResult: TResult;
      try {
        runResult = await options.run(job.payload, makeRunContext(job.metadata));
      } catch (err) {
        const message = normalizeErrorMessage(err);
        job.lastError = message;
        job.state = "queued";
        job.leaseUntil = null;
        job.updatedAt = now();
        await writeLiveJob(job);

        if (job.metadata.attempts >= MAX_ATTEMPTS) {
          await moveToDead(job, "retry-exhausted", message);
          await options.onDeadLetter?.({
            queue,
            kind: options.kind,
            dedupeKey,
            reason: "retry-exhausted",
            metadata: job.metadata,
            error: message,
          });
          throw new Error(message, { cause: err });
        }
        continue;
      }

      job.result = runResult;
      job.lastError = undefined;
      job.metadata.verifier.status = options.verify ? "pending" : "skipped";
      if (options.verify) {
        const verified = await options.verify({
          payload: job.payload,
          result: runResult,
          metadata: job.metadata,
        });
        job.metadata.verifier = {
          status: verified.ok ? "passed" : "failed",
          detail: verified.detail,
          checkedAt: now(),
        };
      }

      if (job.metadata.verifier.status === "failed") {
        const exceeded =
          typeof job.metadata.firstStartAt === "number" &&
          now() - job.metadata.firstStartAt > maxRuntimeMs;
        if (exceeded) {
          await moveToDead(job, "timeout-exceeded", job.metadata.verifier.detail);
          await options.onDeadLetter?.({
            queue,
            kind: options.kind,
            dedupeKey,
            reason: "timeout-exceeded",
            metadata: job.metadata,
            error: job.metadata.verifier.detail,
          });
          throw new Error(`durable queue timeout exceeded: ${dedupeKey}`);
        }

        if (!options.heal) {
          await moveToDead(job, "verifier-failed", job.metadata.verifier.detail);
          await options.onDeadLetter?.({
            queue,
            kind: options.kind,
            dedupeKey,
            reason: "verifier-failed",
            metadata: job.metadata,
            error: job.metadata.verifier.detail,
          });
          throw new Error(`durable queue verifier failed: ${dedupeKey}`);
        }

        const fingerprint = normalizeIssueFingerprint(job.metadata.verifier.detail);
        const nowTs = now();
        const priorSelfHealAttempts = fingerprint
          ? await countRecentSelfHealAttempts({
              queue,
              kind: options.kind,
              fingerprint,
              excludeJobId: job.id,
              nowTs,
              windowMs: SELF_HEAL_WINDOW_MS,
            })
          : 0;

        if (fingerprint && priorSelfHealAttempts >= MAX_SELF_HEAL_ATTEMPTS_PER_WINDOW) {
          const gateReason =
            `self-heal skipped: ${priorSelfHealAttempts} attempts in last 24h for same verifier issue; ` +
            "escalate to launcher for decision";
          job.metadata.selfHealGate = {
            evaluatedAt: nowTs,
            decision: "skip",
            reason: gateReason,
            fingerprint,
            priorAttemptsInWindow: priorSelfHealAttempts,
            windowMs: SELF_HEAL_WINDOW_MS,
          };
          job.metadata.healer = {
            status: "skipped",
            detail: gateReason,
            startedAt: undefined,
            completedAt: nowTs,
          };
          await moveToDead(job, "verifier-failed", gateReason);
          await options.onDeadLetter?.({
            queue,
            kind: options.kind,
            dedupeKey,
            reason: "verifier-failed",
            metadata: job.metadata,
            error: gateReason,
          });
          throw new Error(gateReason);
        }

        job.metadata.selfHealGate = {
          evaluatedAt: nowTs,
          decision: "attempt",
          reason: "self-heal allowed",
          fingerprint,
          priorAttemptsInWindow: priorSelfHealAttempts,
          windowMs: SELF_HEAL_WINDOW_MS,
        };
        job.metadata.healer.status = "running";
        job.metadata.healer.startedAt = now();
        await writeLiveJob(job);

        const healed = await options.heal({
          payload: job.payload,
          result: runResult,
          metadata: job.metadata,
          ctx: makeRunContext(job.metadata),
        });

        job.metadata.healer = {
          status: healed.ok ? "succeeded" : "failed",
          detail: healed.detail,
          startedAt: job.metadata.healer.startedAt,
          completedAt: now(),
        };
        if (!healed.ok) {
          await moveToDead(job, "healer-failed", healed.detail);
          await options.onDeadLetter?.({
            queue,
            kind: options.kind,
            dedupeKey,
            reason: "healer-failed",
            metadata: job.metadata,
            error: healed.detail,
          });
          throw new Error(healed.detail ?? `durable queue healer failed: ${dedupeKey}`);
        }

        if (healed.result !== undefined) {
          job.result = healed.result;
        }
      } else {
        job.metadata.healer = {
          status: "skipped",
          detail: job.metadata.healer.detail,
          startedAt: job.metadata.healer.startedAt,
          completedAt: now(),
        };
      }

      job.state = "succeeded";
      job.leaseUntil = null;
      job.updatedAt = now();
      await writeLiveJob(job);
      return job.result;
    }
  }

  return {
    run,
    _test: {
      async listLive(queue: string) {
        return await listJobs(queue, "live");
      },
      async listDead(queue: string) {
        return await listJobs(queue, "dead");
      },
    },
  };
}
