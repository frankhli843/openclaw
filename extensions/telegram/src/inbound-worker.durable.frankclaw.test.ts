import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  createDurableTelegramInboundWorker,
  TELEGRAM_DURABLE_INBOUND_TIMEOUT_MS,
} from "./inbound-worker.durable.frankclaw.js";

function makeLog() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

function makeFakeBot(handler: (update: unknown) => Promise<void>) {
  return {
    handleUpdate: handler,
    api: { dummy: true },
    stop: vi.fn(),
  };
}

describe("Telegram durable inbound worker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-durable-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exposes a default 5-min timeout constant", () => {
    expect(TELEGRAM_DURABLE_INBOUND_TIMEOUT_MS).toBe(5 * 60_000);
  });

  it("derives externalId from update_id", () => {
    expect(__testing.deriveExternalId({ update_id: 12345 }, () => "fallback")).toBe("12345");
    expect(__testing.deriveExternalId({}, () => "fallback")).toBe("fallback");
  });

  it("enqueues and processes a Telegram update via the wrapped bot", async () => {
    const log = makeLog();
    const seen: unknown[] = [];
    const bot = makeFakeBot(async (update) => {
      seen.push(update);
    });
    const worker = createDurableTelegramInboundWorker({
      accountId: "tg-ok",
      log,
      timeoutMs: 500,
      stateDir: tmpDir,
    });
    const wrappedBot = worker.wrapBot(bot);
    await worker.start();
    try {
      const update = { update_id: 1, message: { text: "hi" } };
      await wrappedBot.handleUpdate(update);
      // Wait for drain
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(update);
    } finally {
      await worker.stop();
    }
  });

  it("retries on timeout and dead-letters after maxAttempts", async () => {
    const log = makeLog();
    let attempts = 0;
    const deadLettered: unknown[] = [];
    const bot = makeFakeBot(
      () =>
        new Promise<void>(() => {
          attempts += 1;
          // never resolve
        }),
    );
    const worker = createDurableTelegramInboundWorker({
      accountId: "tg-timeout",
      log,
      timeoutMs: 30,
      maxAttempts: 2,
      stateDir: tmpDir,
      backoffMs: () => 1,
      onDeadLetter: (event) => {
        deadLettered.push(event);
      },
    });
    const wrappedBot = worker.wrapBot(bot);
    await worker.start();
    try {
      await wrappedBot.handleUpdate({ update_id: 42 });
      // Wait for the timeouts + backoff + dead-letter
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(deadLettered.length).toBe(1);
    } finally {
      await worker.stop();
    }
  });

  it("passes non-handleUpdate methods through unmodified", () => {
    const log = makeLog();
    const stopSpy = vi.fn();
    const bot = {
      handleUpdate: vi.fn(),
      api: { config: { use: vi.fn() } },
      stop: stopSpy,
    };
    const worker = createDurableTelegramInboundWorker({
      accountId: "passthrough",
      log,
      stateDir: tmpDir,
    });
    const wrappedBot = worker.wrapBot(bot);
    wrappedBot.stop();
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(wrappedBot.api).toBe(bot.api);
  });

  it("supports rebinding to a fresh bot across reconnects", async () => {
    const log = makeLog();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const botA = makeFakeBot(async (u) => {
      seenA.push(u);
    });
    const botB = makeFakeBot(async (u) => {
      seenB.push(u);
    });

    const worker = createDurableTelegramInboundWorker({
      accountId: "rebind",
      log,
      timeoutMs: 500,
      stateDir: tmpDir,
    });
    const wrappedA = worker.wrapBot(botA);
    await worker.start();
    try {
      await wrappedA.handleUpdate({ update_id: 100 });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(seenA).toHaveLength(1);

      // Reconnect: rebind to a fresh bot.
      worker.rebindBot(botB);
      await worker.enqueue({ update_id: 101 });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(seenB).toHaveLength(1);
    } finally {
      await worker.stop();
    }
  });
});
