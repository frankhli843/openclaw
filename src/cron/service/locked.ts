import fs from "node:fs";
import path from "node:path";
import type { CronServiceState } from "./state.js";

const storeLocks = new Map<string, Promise<void>>();

const FILE_LOCK_WAIT_MS = 15_000;
const FILE_LOCK_STALE_MS = 2 * 60_000;
const FILE_LOCK_RETRY_BASE_MS = 25;

const resolveChain = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    () => undefined,
  );

export async function locked<T>(state: CronServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(async () => {
    // frankclaw: cron mutations are read-modify-write operations on a file
    // that can also be touched by direct-file recovery scripts or another
    // gateway process. The in-process promise chain is not enough for that
    // class of writer. Hold a same-directory lock file while the caller runs
    // ensureLoaded(...forceReload) + mutate + persist, so patched writers
    // serialize across processes instead of racing jobs.json.
    const release = await acquireFileLock(state, storePath);
    try {
      return await fn();
    } finally {
      await release();
    }
  });

  // Keep the chain alive even when the operation fails.
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);

  return (await next) as T;
}

async function acquireFileLock(
  state: CronServiceState,
  storePath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${storePath}.lock`;
  const startedAt = Date.now();
  let attempts = 0;
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });

  for (;;) {
    try {
      const handle = await fs.promises.open(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAtMs: Date.now(), storePath }) + "\n",
          "utf-8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        await fs.promises.rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") {
        throw err;
      }
    }

    const now = Date.now();
    try {
      const stat = await fs.promises.stat(lockPath);
      if (now - stat.mtimeMs > FILE_LOCK_STALE_MS) {
        state.deps.log.warn(
          { storePath, lockPath, staleMs: Math.round(now - stat.mtimeMs) },
          "cron: removing stale jobs.json lock",
        );
        await fs.promises.rm(lockPath, { force: true });
        continue;
      }
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") {
        continue;
      }
      throw err;
    }

    if (now - startedAt > FILE_LOCK_WAIT_MS) {
      const error = new Error(
        `cron: timed out waiting for jobs.json lock after ${FILE_LOCK_WAIT_MS}ms (${lockPath})`,
      );
      (error as Error & { code?: string; details?: Record<string, unknown> }).code =
        "CRON_JOBS_JSON_LOCK_TIMEOUT";
      (error as Error & { details?: Record<string, unknown> }).details = {
        storePath,
        lockPath,
        waitMs: now - startedAt,
      };
      throw error;
    }

    attempts += 1;
    const delayMs = Math.min(FILE_LOCK_RETRY_BASE_MS * 2 ** Math.min(attempts, 5), 500);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
