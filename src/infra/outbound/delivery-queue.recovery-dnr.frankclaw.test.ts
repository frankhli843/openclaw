/**
 * [frankclaw] Tests for recovery DNR pre-check: Discord, WhatsApp, and Telegram.
 * Verifies that delivery-queue-recovery defers entries with deferUntilMs when
 * the target channel is in a DNR quiet window, and delivers normally when outside.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueDelivery,
  loadPendingDeliveries,
  recoverPendingDeliveries,
} from "./delivery-queue.js";
import {
  asDeliverFn,
  createRecoveryLog,
  installDeliveryQueueTmpDirHooks,
  setQueuedEntryState,
} from "./delivery-queue.test-helpers.js";
import { __resetDiscordDnrPolicyCacheForTests } from "./discord-dnr.js";

describe("[frankclaw] delivery-queue recovery DNR pre-check", () => {
  const { tmpDir } = installDeliveryQueueTmpDirHooks();
  let openclawTmp = "";

  beforeEach(() => {
    openclawTmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-dnr-rec-"));
    vi.stubEnv("OPENCLAW_HOME", openclawTmp);
    __resetDiscordDnrPolicyCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    __resetDiscordDnrPolicyCacheForTests();
    try {
      fs.rmSync(openclawTmp, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  function setupWhatsAppPolicy(groupId: string) {
    vi.stubEnv("OPENCLAW_HOME", openclawTmp);
    const stateDir = path.join(openclawTmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "channel-dnr-policies.json"),
      JSON.stringify({
        version: 1,
        whatsapp: {
          recurring: [
            {
              id: "test-wa-dnr",
              channel: "whatsapp",
              groupId,
              enabled: true,
              window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
            },
          ],
          oneOff: [],
        },
      }),
    );
  }

  const runRecovery = async (deliver: ReturnType<typeof vi.fn>) =>
    recoverPendingDeliveries({
      deliver: asDeliverFn(deliver),
      log: createRecoveryLog(),
      cfg: {},
      stateDir: tmpDir(),
    });

  const backdateEntry = (id: string, ageMs = 60_000) => {
    setQueuedEntryState(tmpDir(), id, {
      retryCount: 0,
      enqueuedAt: Date.now() - ageMs,
    });
  };

  // Evening Toronto time inside 18:00-08:00 window: 2026-03-06T01:30Z = 20:30 Toronto
  const IN_WINDOW_MS = Date.parse("2026-03-06T01:30:00.000Z");
  // Morning Toronto time outside window: 2026-03-06T15:00Z = 11:00 Toronto
  const OUT_WINDOW_MS = Date.parse("2026-03-06T15:00:00.000Z");

  // ─── WhatsApp ────────────────────────────────────────────────────────────

  it("[whatsapp] defers entry with deferUntilMs when DNR active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS);

    setupWhatsAppPolicy("120363421390336301@g.us");

    const id = await enqueueDelivery(
      { channel: "whatsapp", to: "120363421390336301@g.us", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(result.deferredBackoff).toBe(1);
    expect(result.recovered).toBe(0);

    const entries = await loadPendingDeliveries(tmpDir());
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(typeof entry.deferUntilMs).toBe("number");
    expect(entry.deferUntilMs as number).toBeGreaterThan(IN_WINDOW_MS);
    expect(entry.holdReason).toBe("whatsapp-dnr-window");
    expect(entry.lastError).toBe("whatsapp-dnr-window");
  });

  it("[whatsapp] delivers normally when DNR inactive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUT_WINDOW_MS);

    setupWhatsAppPolicy("120363421390336301@g.us");

    const id = await enqueueDelivery(
      { channel: "whatsapp", to: "120363421390336301@g.us", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(result.recovered).toBe(1);
    expect(result.deferredBackoff).toBe(0);
  });

  it("[whatsapp] does not defer non-matching group (per-group semantics)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS);

    setupWhatsAppPolicy("120363421390336301@g.us"); // policy for specific group

    const id = await enqueueDelivery(
      { channel: "whatsapp", to: "other-group@g.us", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    // Non-matching group: DNR must not fire
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(result.recovered).toBe(1);
    expect(result.deferredBackoff).toBe(0);
  });

  it("[whatsapp] wildcard groupId defers all groups", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS);

    setupWhatsAppPolicy("*"); // wildcard: all groups

    const id = await enqueueDelivery(
      { channel: "whatsapp", to: "any-group@g.us", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(result.deferredBackoff).toBe(1);

    const entries = await loadPendingDeliveries(tmpDir());
    expect((entries[0] as Record<string, unknown>).holdReason).toBe("whatsapp-dnr-window");
  });

  // ─── Telegram ────────────────────────────────────────────────────────────
  // Telegram reuses Discord DNR (17:00-08:30 Toronto hardcoded default).

  it("[telegram] defers entry with deferUntilMs when DNR active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS);

    const id = await enqueueDelivery(
      { channel: "telegram", to: "telegram-global", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(result.deferredBackoff).toBe(1);
    expect(result.recovered).toBe(0);

    const entries = await loadPendingDeliveries(tmpDir());
    expect(entries).toHaveLength(1);
    const entry = entries[0] as Record<string, unknown>;
    expect(typeof entry.deferUntilMs).toBe("number");
    expect(entry.deferUntilMs as number).toBeGreaterThan(IN_WINDOW_MS);
    expect(entry.holdReason).toBe("telegram-dnr-window");
    expect(entry.lastError).toBe("telegram-dnr-window");
  });

  it("[telegram] delivers normally when DNR inactive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(OUT_WINDOW_MS);

    const id = await enqueueDelivery(
      { channel: "telegram", to: "telegram-global", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(result.recovered).toBe(1);
    expect(result.deferredBackoff).toBe(0);
  });

  it("[telegram] re-defers on second sweep while still in window, delivers after window ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS);

    const id = await enqueueDelivery(
      { channel: "telegram", to: "telegram-global", payloads: [{ text: "hello" }] },
      tmpDir(),
    );
    backdateEntry(id);

    // First recovery sweep: in window, defer
    const deliver1 = vi.fn().mockResolvedValue([]);
    await runRecovery(deliver1);
    expect(deliver1).not.toHaveBeenCalled();

    const afterFirst = await loadPendingDeliveries(tmpDir());
    expect(afterFirst).toHaveLength(1);
    const deferUntilMs = (afterFirst[0] as Record<string, unknown>).deferUntilMs as number;
    expect(deferUntilMs).toBeGreaterThan(IN_WINDOW_MS);

    // Second recovery sweep: outside window, should deliver
    vi.setSystemTime(OUT_WINDOW_MS);
    __resetDiscordDnrPolicyCacheForTests(); // flush DNR cache so new time takes effect

    const deliver2 = vi.fn().mockResolvedValue([]);
    const result2 = await runRecovery(deliver2);
    expect(deliver2).toHaveBeenCalledTimes(1);
    expect(result2.recovered).toBe(1);
    expect(await loadPendingDeliveries(tmpDir())).toHaveLength(0);
  });

  // ─── Discord (baseline, no regression) ──────────────────────────────────

  it("[discord] defers entry with deferUntilMs when DNR active (no regression)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_WINDOW_MS); // inside 17:00-08:30 Toronto window

    const id = await enqueueDelivery(
      { channel: "discord", to: "channel:1479083833830801520", payloads: [{ text: "hi" }] },
      tmpDir(),
    );
    backdateEntry(id);

    const deliver = vi.fn().mockResolvedValue([]);
    const result = await runRecovery(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(result.deferredBackoff).toBe(1);

    const entries = await loadPendingDeliveries(tmpDir());
    expect((entries[0] as Record<string, unknown>).holdReason).toBe("discord-dnr-window");
  });
});
