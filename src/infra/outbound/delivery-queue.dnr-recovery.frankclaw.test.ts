/**
 * Tests that delivery-queue-recovery.ts pre-checks DNR for WhatsApp and Telegram
 * channels, deferring entries in active windows instead of attempting delivery.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueDelivery, recoverPendingDeliveries } from "./delivery-queue.js";
import {
  asDeliverFn,
  createRecoveryLog,
  installDeliveryQueueTmpDirHooks,
} from "./delivery-queue.test-helpers.js";

// Mock the DNR module used by checkRecoveryDnr via require()
const dnrMocks = vi.hoisted(() => ({
  enforceDiscordDnrWindow: vi.fn(),
  enforceWhatsAppDnrWindow: vi.fn(),
}));

vi.mock("./discord-dnr.js", () => ({
  enforceDiscordDnrWindow: dnrMocks.enforceDiscordDnrWindow,
  enforceWhatsAppDnrWindow: dnrMocks.enforceWhatsAppDnrWindow,
}));

function makeDnrError(name: string, nextEligibleAtMs: number): Error {
  return Object.assign(new Error(`suppressed by DNR window`), { name, nextEligibleAtMs });
}

describe("recovery DNR pre-check — WhatsApp and Telegram", () => {
  const { tmpDir } = installDeliveryQueueTmpDirHooks();
  const baseCfg = {};

  beforeEach(() => {
    vi.clearAllMocks();
    dnrMocks.enforceDiscordDnrWindow.mockReturnValue(undefined);
    dnrMocks.enforceWhatsAppDnrWindow.mockReturnValue(undefined);
  });

  async function enqueueEntry(channel: string, to: string, text: string): Promise<string> {
    const id = await enqueueDelivery(
      { channel: channel as "discord", to, payloads: [{ text }] },
      tmpDir(),
    );
    // Back-date enqueuedAt so MIN_ENTRY_AGE_MS is satisfied.
    const entryPath = path.join(tmpDir(), "delivery-queue", `${id}.json`);
    const entry = JSON.parse(fs.readFileSync(entryPath, "utf-8"));
    entry.enqueuedAt = Date.now() - 120_000;
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));
    return id;
  }

  function readEntry(id: string): Record<string, unknown> {
    const entryPath = path.join(tmpDir(), "delivery-queue", `${id}.json`);
    return JSON.parse(fs.readFileSync(entryPath, "utf-8"));
  }

  it("defers a WhatsApp entry when DNR window is active during recovery", async () => {
    const nextEligibleAtMs = Date.now() + 3_600_000;
    dnrMocks.enforceWhatsAppDnrWindow.mockImplementation(() => {
      throw makeDnrError("WhatsAppDnrSuppressedError", nextEligibleAtMs);
    });

    const id = await enqueueEntry("whatsapp", "120363421390336301@g.us", "hello");
    const deliver = vi.fn();

    const result = await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Delivery must NOT be attempted
    expect(deliver).not.toHaveBeenCalled();
    // Entry must be re-deferred with correct deferUntilMs and holdReason
    const saved = readEntry(id);
    expect(saved.deferUntilMs).toBe(nextEligibleAtMs);
    expect(saved.holdReason).toBe("whatsapp-dnr-window");
    expect(result.deferredBackoff).toBe(1);
    expect(result.recovered).toBe(0);
  });

  it("defers a Telegram entry when DNR window is active during recovery", async () => {
    const nextEligibleAtMs = Date.now() + 7_200_000;
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw makeDnrError("DiscordDnrSuppressedError", nextEligibleAtMs);
    });

    const id = await enqueueEntry("telegram", "telegram-chat-123", "test message");
    const deliver = vi.fn();

    const result = await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliver).not.toHaveBeenCalled();
    const saved = readEntry(id);
    expect(saved.deferUntilMs).toBe(nextEligibleAtMs);
    expect(saved.holdReason).toBe("telegram-dnr-window");
    expect(result.deferredBackoff).toBe(1);
  });

  it("delivers a WhatsApp entry after deferUntilMs has elapsed", async () => {
    // DNR is no longer active
    dnrMocks.enforceWhatsAppDnrWindow.mockReturnValue(undefined);

    const id = await enqueueEntry("whatsapp", "120363421390336301@g.us", "belated");
    // Set deferUntilMs in the past to simulate a held entry whose window passed.
    const entryPath = path.join(tmpDir(), "delivery-queue", `${id}.json`);
    const entry = JSON.parse(fs.readFileSync(entryPath, "utf-8"));
    entry.deferUntilMs = Date.now() - 1_000;
    entry.holdReason = "whatsapp-dnr-window";
    fs.writeFileSync(entryPath, JSON.stringify(entry, null, 2));

    const deliver = vi.fn(async () => {});

    const result = await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(result.recovered).toBe(1);
  });

  it("Discord entry is still deferred by DNR (regression check)", async () => {
    const nextEligibleAtMs = Date.now() + 1_800_000;
    dnrMocks.enforceDiscordDnrWindow.mockImplementation(() => {
      throw makeDnrError("DiscordDnrSuppressedError", nextEligibleAtMs);
    });

    const id = await enqueueEntry("discord", "discord-channel-1", "not yet");
    const deliver = vi.fn();

    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    expect(deliver).not.toHaveBeenCalled();
    const saved = readEntry(id);
    expect(saved.deferUntilMs).toBe(nextEligibleAtMs);
    expect(saved.holdReason).toBe("discord-dnr-window");
  });

  it("non-DNR-channel entries skip the DNR pre-check entirely", async () => {
    const id = await enqueueEntry("sms", "+16135551234", "test");
    const deliver = vi.fn(async () => {});

    await recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: baseCfg,
      stateDir: tmpDir(),
    });

    // Delivery was attempted — no pre-check blocks it
    expect(deliver).toHaveBeenCalledTimes(1);
    // DNR functions must not have been called
    expect(dnrMocks.enforceWhatsAppDnrWindow).not.toHaveBeenCalled();
  });
});
