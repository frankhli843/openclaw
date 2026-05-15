/**
 * frankclaw: Durable Telegram inbound worker.
 *
 * Wraps a grammy Bot so that `bot.handleUpdate(update)` enqueues each update
 * to a disk-backed SQS-style durable queue instead of running it inline. A
 * background worker drains the queue, calling the ORIGINAL handleUpdate (via
 * the un-wrapped reference) with a 5-min timeout. On timeout or error the
 * update is retried with exponential backoff up to maxAttempts, then
 * dead-lettered with a diagnostic log.
 *
 * Because Telegram updates are pure JSON (no closures), the entire payload
 * survives gateway restarts. Unlike WhatsApp this gives real durable delivery,
 * not just retry-within-lifetime.
 *
 * Polling cycles recreate the underlying grammy bot on reconnect. The worker
 * supports `rebindBot(newBot)` so the same on-disk queue continues across
 * bot recreations.
 */

import { danger } from "../../../src/globals.js";
import {
  createInboundDurableQueue,
  type DeadLetterReason,
  type DurableInboundEvent,
  type InboundDurableQueue,
} from "../../../src/inbound/inbound-durable-queue.frankclaw.js";
import { getTelegramSequentialKey } from "./sequential-key.js";

/**
 * Default Telegram per-update worker timeout. Matches WhatsApp at 5 min — the
 * Codex backend with full context injection regularly exceeds 3 min when the
 * gateway is under concurrent load.
 */
export const TELEGRAM_DURABLE_INBOUND_TIMEOUT_MS = 5 * 60_000;

const LEASE_BUFFER_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Structural shape needed from a grammy Bot. We deliberately type the update
 * parameter as `any` so concrete grammy types like
 * `Bot<Context, Api<RawApi>>` (whose handleUpdate accepts `Update`) satisfy
 * this contract. Function parameters are contravariant in TS, so a stricter
 * `unknown` here would reject the real grammy Bot type.
 */
// biome-ignore lint/suspicious/noExplicitAny: see jsdoc above.
type TelegramBotLike = { handleUpdate: (update: any, errorHandler?: any) => Promise<unknown> };

export type DurableTelegramInboundWorkerLog = {
  warn: (line: string) => void;
  info?: (line: string) => void;
  error?: (line: string) => void;
};

export type DurableTelegramInboundWorkerParams = {
  accountId: string;
  log: DurableTelegramInboundWorkerLog;
  /** Bot info (botInfo) for sequential key derivation. Optional. */
  botInfo?: Parameters<typeof getTelegramSequentialKey>[0]["me"];
  timeoutMs?: number;
  visibilityTimeoutMs?: number;
  maxAttempts?: number;
  stateDir?: string;
  backoffMs?: (attempt: number) => number;
  onDeadLetter?: (event: DurableInboundEvent, reason: DeadLetterReason) => void;
};

export type DurableTelegramInboundWorker = {
  /**
   * Wrap a bot so its `handleUpdate` enqueues to the durable queue. Returns
   * the wrapped bot which can be passed to grammy's runner / spool drainer.
   * Pass `newBot` as `null` to clear the binding (e.g. on shutdown).
   */
  wrapBot: <TBot extends TelegramBotLike>(bot: TBot) => TBot;
  /** Re-point the worker at a fresh bot (used on polling cycle reconnect). */
  rebindBot: (bot: TelegramBotLike | null) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Direct enqueue helper for callers that don't have a wrapped bot. */
  enqueue: (update: unknown) => Promise<{ enqueued: boolean; dedupeKey: string }>;
};

function resolveLeaseMs(timeoutMs: number | undefined): number {
  if (!timeoutMs) {
    return 60 * 60_000;
  }
  return timeoutMs + LEASE_BUFFER_MS;
}

function deriveExternalId(update: unknown, fallback: () => string): string {
  if (update && typeof update === "object" && "update_id" in update) {
    const value = (update as { update_id?: unknown }).update_id;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback();
}

function deriveOrderingKey(
  update: unknown,
  botInfo: DurableTelegramInboundWorkerParams["botInfo"],
  fallback: () => string,
): string {
  try {
    const key = getTelegramSequentialKey({
      update: update as Parameters<typeof getTelegramSequentialKey>[0]["update"],
      ...(botInfo ? { me: botInfo } : {}),
    });
    if (typeof key === "string" && key.trim().length > 0) {
      return key;
    }
  } catch {
    // fall through to fallback
  }
  return fallback();
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && String((error as { name?: unknown }).name) === "AbortError";
}

async function runWithTimeout(params: {
  run: () => Promise<void>;
  timeoutMs?: number;
  log: { warn: (line: string) => void };
}): Promise<{ timedOut: boolean }> {
  if (!params.timeoutMs) {
    await params.run();
    return { timedOut: false };
  }
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const runPromise = params.run().catch((error) => {
    if (timedOut && isAbortError(error)) {
      return;
    }
    if (timedOut) {
      params.log.warn(
        `telegram durable worker: update processing failed after timeout: ${String(error)}`,
      );
      return;
    }
    throw error;
  });
  try {
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), params.timeoutMs);
      timeoutHandle.unref?.();
    });
    const result = await Promise.race([
      runPromise.then(() => "completed" as const),
      timeoutPromise,
    ]);
    if (result === "timeout") {
      timedOut = true;
      return { timedOut: true };
    }
    return { timedOut: false };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createDurableTelegramInboundWorker(
  params: DurableTelegramInboundWorkerParams,
): DurableTelegramInboundWorker {
  const timeoutMs = params.timeoutMs ?? TELEGRAM_DURABLE_INBOUND_TIMEOUT_MS;
  const visibilityTimeoutMs = params.visibilityTimeoutMs ?? resolveLeaseMs(timeoutMs);
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let fallbackCounter = 0;
  let currentHandleUpdate: TelegramBotLike["handleUpdate"] | null = null;

  const queue: InboundDurableQueue = createInboundDurableQueue({
    channel: "telegram",
    accountId: params.accountId,
    visibilityTimeoutMs,
    maxAttempts,
    stateDir: params.stateDir,
    ...(params.backoffMs ? { backoffMs: params.backoffMs } : {}),
    onDeadLetter: (event, reason) => {
      params.log.warn(
        danger(
          `telegram durable worker: dead-lettered after ${reason.attempts} attempts ` +
            `accountId=${event.accountId} orderingKey=${event.orderingKey} externalId=${event.externalId}` +
            (reason.lastError ? `: ${reason.lastError}` : ""),
        ),
      );
      params.onDeadLetter?.(event, reason);
    },
  });

  async function processEvent(event: DurableInboundEvent): Promise<void> {
    const handler = currentHandleUpdate;
    if (!handler) {
      // No bot is currently bound (likely between reconnect cycles). Throw so
      // the queue defers via backoff — the next cycle will install a fresh
      // bot and the retry will succeed.
      throw new Error(
        `telegram durable worker: no bot currently bound for accountId=${event.accountId}`,
      );
    }
    const update = event.payload;
    const startedAt = Date.now();
    const { timedOut } = await runWithTimeout({
      run: async () => {
        await handler(update);
      },
      timeoutMs,
      log: params.log,
    });
    if (timedOut) {
      params.log.warn(
        `telegram durable worker: update processing timed out after ${Math.round(timeoutMs / 1000)}s ` +
          `accountId=${event.accountId} orderingKey=${event.orderingKey} externalId=${event.externalId} ` +
          `— durable queue will retry`,
      );
      throw new Error(
        `telegram durable worker: timeout after ${Math.round(timeoutMs / 1000)}s orderingKey=${event.orderingKey}`,
      );
    }
    params.log.info?.(
      `telegram durable worker: update processed ok accountId=${event.accountId} orderingKey=${event.orderingKey} externalId=${event.externalId} elapsedMs=${Date.now() - startedAt}`,
    );
  }

  async function enqueueUpdate(update: unknown): Promise<{ enqueued: boolean; dedupeKey: string }> {
    const externalId = deriveExternalId(update, () => {
      fallbackCounter += 1;
      return `synthetic-${Date.now()}-${fallbackCounter}`;
    });
    const orderingKey = deriveOrderingKey(update, params.botInfo, () => {
      return `telegram:${params.accountId}:fallback`;
    });
    const result = await queue.enqueue({
      orderingKey,
      externalId,
      payload: update,
    });
    return { enqueued: result.enqueued, dedupeKey: result.dedupeKey };
  }

  return {
    wrapBot<TBot extends TelegramBotLike>(bot: TBot): TBot {
      currentHandleUpdate = bot.handleUpdate.bind(bot);
      return new Proxy(bot, {
        get(target, prop, receiver) {
          if (prop === "handleUpdate") {
            return async (update: unknown, _errorHandler?: unknown) => {
              await enqueueUpdate(update);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
      }) as TBot;
    },

    rebindBot(bot) {
      currentHandleUpdate = bot ? bot.handleUpdate.bind(bot) : null;
    },

    async start() {
      await queue.start({
        process: processEvent,
      });
      params.log.info?.(
        `telegram durable worker started accountId=${params.accountId} timeoutMs=${timeoutMs} leaseMs=${visibilityTimeoutMs} maxAttempts=${maxAttempts}`,
      );
    },

    async stop() {
      await queue.stop();
      currentHandleUpdate = null;
    },

    enqueue: enqueueUpdate,
  };
}

/** @internal Exposed for unit tests only. */
export const __testing = {
  resolveLeaseMs,
  deriveExternalId,
  deriveOrderingKey,
};
