import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiscordDnrPolicyCacheForTests,
  enforceDiscordDnrWindow,
  enforceWhatsAppDnrWindow,
  isDiscordDnrTarget,
  isWhatsAppDnrTarget,
  isWithinDiscordDnrWindow,
  inspectWhatsAppDnrWindow,
  resolveNextDiscordDnrReleaseMs,
  WhatsAppDnrSuppressedError,
} from "./discord-dnr.js";

describe("discord DNR policy", () => {
  afterEach(() => {
    __resetDiscordDnrPolicyCacheForTests();
    vi.unstubAllEnvs();
  });
  it("matches all discord channels (global recurring policy)", () => {
    expect(
      isDiscordDnrTarget({
        channel: "discord",
        to: "channel:1479083833830801520",
      }),
    ).toBe(true);
    expect(
      isDiscordDnrTarget({
        channel: "discord",
        to: "channel:123",
      }),
    ).toBe(true);
    expect(
      isDiscordDnrTarget({
        channel: "telegram",
        to: "channel:1479083833830801520",
      }),
    ).toBe(false);
  });

  it("handles cross-midnight window semantics (18:00-08:00 Toronto)", () => {
    // 2026-03-05 20:30 America/Toronto => 2026-03-06 01:30Z
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    // 2026-03-06 07:59 America/Toronto => 2026-03-06 12:59Z
    const morningTs = Date.parse("2026-03-06T12:59:00.000Z");
    // 2026-03-06 08:01 America/Toronto => 2026-03-06 13:01Z
    const afterWindowTs = Date.parse("2026-03-06T13:01:00.000Z");

    expect(isWithinDiscordDnrWindow(eveningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(morningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(afterWindowTs)).toBe(false);
  });

  it("resolves next release at first minute outside the window", () => {
    // 2026-03-05 23:10 Toronto => inside DNR.
    const insideTs = Date.parse("2026-03-06T04:10:00.000Z");
    const next = resolveNextDiscordDnrReleaseMs(insideTs);
    // Should resolve to 08:00 Toronto next morning => 2026-03-06 13:00Z.
    expect(next).toBe(Date.parse("2026-03-06T13:00:00.000Z"));
  });

  it("auto-prunes expired one-off policies from state file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discord-dnr-"));
    vi.stubEnv("OPENCLAW_HOME", tmp);
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const policyPath = path.join(stateDir, "discord-dnr-policies.json");

    const now = Date.now();
    fs.writeFileSync(
      policyPath,
      JSON.stringify(
        {
          version: 1,
          oneOff: [
            {
              id: "expired",
              threadId: "1479083833830801520",
              startAtMs: now - 20_000,
              endAtMs: now - 10_000,
            },
            {
              id: "active",
              threadId: "1479083833830801520",
              startAtMs: now - 10_000,
              endAtMs: now + 60_000,
            },
          ],
        },
        null,
        2,
      ),
    );

    expect(() =>
      enforceDiscordDnrWindow({
        channel: "discord",
        to: "channel:1479083833830801520",
      }),
    ).toThrow();

    const saved = JSON.parse(fs.readFileSync(policyPath, "utf-8"));
    expect(saved.oneOff).toHaveLength(1);
    expect(saved.oneOff[0]?.id).toBe("active");
  });
});

describe("whatsapp DNR policy", () => {
  afterEach(() => {
    __resetDiscordDnrPolicyCacheForTests();
    vi.unstubAllEnvs();
  });

  function setupWhatsAppPolicy(tmpDir: string, policy: object) {
    vi.stubEnv("OPENCLAW_HOME", tmpDir);
    const stateDir = path.join(tmpDir, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const policyPath = path.join(stateDir, "channel-dnr-policies.json");
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
    return policyPath;
  }

  it("returns false for groups with no policy", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    vi.stubEnv("OPENCLAW_HOME", tmp);
    expect(isWhatsAppDnrTarget("120363421390336301@g.us")).toBe(false);
  });

  it("detects a group with a recurring policy", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "test",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
          },
        ],
      },
    });
    expect(isWhatsAppDnrTarget("120363421390336301@g.us")).toBe(true);
    expect(isWhatsAppDnrTarget("some-other-group@g.us")).toBe(false);
  });

  it("enforces recurring window and throws WhatsAppDnrSuppressedError", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "casual-mon",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
          },
        ],
      },
    });

    // 2026-03-05 20:30 America/Toronto => inside DNR
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", eveningTs)).toThrow(
      WhatsAppDnrSuppressedError,
    );

    // 2026-03-06 10:00 America/Toronto => outside DNR
    const morningTs = Date.parse("2026-03-06T15:00:00.000Z");
    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", morningTs)).not.toThrow();
  });

  it("does not enforce for non-matching groups", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "casual-mon",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
          },
        ],
      },
    });

    // Inside window but different group
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    expect(() => enforceWhatsAppDnrWindow("some-other-group@g.us", eveningTs)).not.toThrow();
  });

  it("supports wildcard groupId for all WhatsApp groups", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "all-wa",
            channel: "whatsapp",
            groupId: "*",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "22:00", end: "06:00" },
          },
        ],
      },
    });

    // 2026-03-06 23:00 Toronto = 2026-03-07 04:00Z => inside window
    const lateNight = Date.parse("2026-03-07T04:00:00.000Z");
    expect(() => enforceWhatsAppDnrWindow("any-group@g.us", lateNight)).toThrow(
      WhatsAppDnrSuppressedError,
    );
  });

  it("one-off policies take precedence and get pruned when expired", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    const now = Date.now();
    const policyPath = setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        oneOff: [
          {
            id: "expired",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            startAtMs: now - 20_000,
            endAtMs: now - 10_000,
          },
          {
            id: "active",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            startAtMs: now - 5_000,
            endAtMs: now + 60_000,
          },
        ],
      },
    });

    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us")).toThrow(
      WhatsAppDnrSuppressedError,
    );

    // Expired one-off should be pruned
    const saved = JSON.parse(fs.readFileSync(policyPath, "utf-8"));
    expect(saved.whatsapp.oneOff).toHaveLength(1);
    expect(saved.whatsapp.oneOff[0]?.id).toBe("active");
  });

  it("inspectWhatsAppDnrWindow returns active state and next eligible time", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "test",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
          },
        ],
      },
    });

    // Inside window
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    const result = inspectWhatsAppDnrWindow("120363421390336301@g.us", eveningTs);
    expect(result.active).toBe(true);
    expect(result.nextEligibleAtMs).toBeGreaterThan(eveningTs);

    // Outside window
    const afternoonTs = Date.parse("2026-03-06T19:00:00.000Z");
    const result2 = inspectWhatsAppDnrWindow("120363421390336301@g.us", afternoonTs);
    expect(result2.active).toBe(false);
  });

  it("disabled policies are skipped", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    setupWhatsAppPolicy(tmp, {
      version: 1,
      whatsapp: {
        recurring: [
          {
            id: "disabled",
            channel: "whatsapp",
            groupId: "120363421390336301@g.us",
            enabled: false,
            window: { timeZone: "America/Toronto", start: "18:00", end: "08:00" },
          },
        ],
      },
    });

    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", eveningTs)).not.toThrow();
  });

  it("does not interfere with Discord DNR (separate policy files)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dnr-"));
    vi.stubEnv("OPENCLAW_HOME", tmp);

    // Only WhatsApp policy, no Discord file
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "channel-dnr-policies.json"),
      JSON.stringify({
        version: 1,
        whatsapp: {
          recurring: [
            {
              id: "wa-test",
              channel: "whatsapp",
              groupId: "*",
              enabled: true,
              window: { timeZone: "America/Toronto", start: "00:00", end: "23:59" },
            },
          ],
        },
      }),
    );

    // Discord still uses its own default policy (from DEFAULT_RECURRING)
    expect(isDiscordDnrTarget({ channel: "discord", to: "channel:123" })).toBe(true);
    // WhatsApp policy also works independently
    expect(isWhatsAppDnrTarget("any@g.us")).toBe(true);
  });
});
