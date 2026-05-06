import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebInboundMsg } from "../types.js";
import {
  runWhatsAppInboundWithTimeout,
  WHATSAPP_INBOUND_WORKER_TIMEOUT_MS,
} from "./on-message-timeout.frankclaw.js";

function makeMsg(overrides: Partial<WebInboundMsg> = {}): WebInboundMsg {
  return {
    from: overrides.from ?? "+10000000001",
    conversationId: overrides.conversationId ?? overrides.from ?? "+10000000001",
    to: "+10000000002",
    accountId: "default",
    body: overrides.body ?? "hi",
    chatType: overrides.chatType ?? "direct",
    chatId: overrides.chatId ?? overrides.from ?? "+10000000001",
    sendComposing: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    sendMedia: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as WebInboundMsg;
}

describe("runWhatsAppInboundWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes default timeout constant matching Discord inbound timeout", () => {
    expect(WHATSAPP_INBOUND_WORKER_TIMEOUT_MS).toBe(3 * 60_000);
  });

  it("runs directly when timeoutMs is falsy (no timeout wrap)", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const log = { warn: vi.fn() };

    await runWhatsAppInboundWithTimeout({ msg: makeMsg(), run, timeoutMs: 0, log });

    expect(run).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("completes normally when run finishes before timeout", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const log = { warn: vi.fn() };

    const result = runWhatsAppInboundWithTimeout({
      msg: makeMsg(),
      run,
      timeoutMs: 3_000,
      log,
    });

    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("times out and logs warning without throwing for a stuck run", async () => {
    let resolveRun!: () => void;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const run = vi.fn().mockReturnValue(runPromise);
    const log = { warn: vi.fn() };

    const result = runWhatsAppInboundWithTimeout({
      msg: makeMsg(),
      run,
      timeoutMs: 3_000,
      log,
    });

    await vi.advanceTimersByTimeAsync(3_001);
    await expect(result).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("timed out after 3s"));
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("aborting turn to unblock queue"),
    );

    // Run completes after timeout — should not throw or log again
    resolveRun();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("logs correct group label on timeout for group chat", async () => {
    const run = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    const log = { warn: vi.fn() };
    const msg = makeMsg({
      from: "120363405743307729@g.us",
      chatType: "group",
      chatId: "120363405743307729@g.us",
    });

    const result = runWhatsAppInboundWithTimeout({ msg, run, timeoutMs: 3_000, log });
    await vi.advanceTimersByTimeAsync(3_001);
    await expect(result).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("group:120363405743307729@g.us"));
  });

  it("propagates run error when run throws before timeout", async () => {
    const boom = new Error("run exploded");
    const run = vi.fn().mockRejectedValue(boom);
    const log = { warn: vi.fn() };

    await expect(
      runWhatsAppInboundWithTimeout({ msg: makeMsg(), run, timeoutMs: 3_000, log }),
    ).rejects.toThrow("run exploded");
    expect(log.warn).not.toHaveBeenCalled();
  });
});
