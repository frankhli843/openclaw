import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithDirectAction } from "./direct-action-context.frankclaw.js";
import {
  __resetDiscordDnrPolicyCacheForTests,
  DiscordDnrSuppressedError,
  enforceDiscordDnrWindow,
  enforceWhatsAppDnrWindow,
  getDirectActionBypassLog,
  inspectDiscordDnrWindow,
  isDiscordDnrTarget,
  isWhatsAppDnrTarget,
  isWithinDiscordDnrWindow,
  inspectWhatsAppDnrWindow,
  resolveNextDiscordDnrReleaseMs,
  WhatsAppDnrSuppressedError,
} from "./discord-dnr.js";

describe("discord DNR policy", () => {
  let defaultTmp = "";
  beforeEach(() => {
    defaultTmp = fs.mkdtempSync(path.join(os.tmpdir(), "discord-dnr-default-"));
    // Write a policy file with the standard Toronto defaults so readPolicyStore
    // sees the expected recurring entry regardless of any real ~/.openclaw file.
    const stateDir = path.join(defaultTmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "discord-dnr-policies.json"),
      JSON.stringify({
        version: 1,
        recurring: [
          {
            id: "discord-all-default",
            threadId: "*",
            enabled: true,
            window: { timeZone: "America/Toronto", start: "17:00", end: "08:30" },
          },
        ],
        oneOff: [],
      }),
    );
    vi.stubEnv("OPENCLAW_HOME", defaultTmp);
    __resetDiscordDnrPolicyCacheForTests();
  });
  afterEach(() => {
    __resetDiscordDnrPolicyCacheForTests();
    vi.unstubAllEnvs();
    try {
      fs.rmSync(defaultTmp, { recursive: true, force: true });
    } catch {
      // best effort
    }
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

  it("handles cross-midnight window semantics (17:00-08:30 Toronto default)", () => {
    // Default window: 17:00-08:30 America/Toronto
    // 2026-03-05 20:30 America/Toronto => 2026-03-06 01:30Z => inside window
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    // 2026-03-06 08:00 America/Toronto => 2026-03-06 13:00Z => inside window (before 08:30)
    const morningTs = Date.parse("2026-03-06T13:00:00.000Z");
    // 2026-03-06 08:31 America/Toronto => 2026-03-06 13:31Z => outside window
    const afterWindowTs = Date.parse("2026-03-06T13:31:00.000Z");

    expect(isWithinDiscordDnrWindow(eveningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(morningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(afterWindowTs)).toBe(false);
  });

  it("resolves next release at first minute outside the window", () => {
    // 2026-03-05 23:10 Toronto => inside DNR.
    const insideTs = Date.parse("2026-03-06T04:10:00.000Z");
    const next = resolveNextDiscordDnrReleaseMs(insideTs);
    // Should resolve to 08:30 Toronto next morning => 2026-03-06 13:30Z.
    expect(next).toBe(Date.parse("2026-03-06T13:30:00.000Z"));
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

  it("enforceDiscordDnrWindow throws DiscordDnrSuppressedError during quiet hours", () => {
    // 2026-03-05 20:30 America/Toronto => inside default 17:00-08:30 window
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    try {
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, eveningTs);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DiscordDnrSuppressedError);
      expect((err as DiscordDnrSuppressedError).nextEligibleAtMs).toBeGreaterThan(eveningTs);
      expect((err as DiscordDnrSuppressedError).name).toBe("DiscordDnrSuppressedError");
    }
  });

  it("enforceDiscordDnrWindow does not throw outside quiet hours", () => {
    // 2026-03-06 10:00 America/Toronto => 2026-03-06 15:00Z => outside 17:00-08:30
    const morningTs = Date.parse("2026-03-06T15:00:00.000Z");
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, morningTs),
    ).not.toThrow();
  });

  it("enforceDiscordDnrWindow skips non-discord channels", () => {
    // Inside the quiet window but channel is telegram
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    expect(() =>
      enforceDiscordDnrWindow({ channel: "telegram" as "discord", to: "channel:123" }, eveningTs),
    ).not.toThrow();
  });

  it("inspectDiscordDnrWindow returns active state and window inside quiet hours", () => {
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    const result = inspectDiscordDnrWindow(eveningTs);
    expect(result.active).toBe(true);
    expect(result.nextEligibleAtMs).toBeGreaterThan(eveningTs);
    expect(result.window).toBeDefined();
    expect(result.window.timeZone).toBe("America/Toronto");
  });

  it("inspectDiscordDnrWindow returns inactive outside quiet hours", () => {
    const afternoonTs = Date.parse("2026-03-06T15:00:00.000Z");
    const result = inspectDiscordDnrWindow(afternoonTs);
    expect(result.active).toBe(false);
  });

  it("resolveNextDiscordDnrReleaseMs returns nowMs when already outside window", () => {
    const outsideTs = Date.parse("2026-03-06T15:00:00.000Z");
    expect(resolveNextDiscordDnrReleaseMs(outsideTs)).toBe(outsideTs);
  });

  it("supports threadId from context for targeted policy matching", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discord-dnr-"));
    vi.stubEnv("OPENCLAW_HOME", tmp);
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    const now = Date.now();
    fs.writeFileSync(
      path.join(stateDir, "discord-dnr-policies.json"),
      JSON.stringify({
        version: 1,
        recurring: [],
        oneOff: [
          {
            id: "targeted",
            threadId: "999",
            startAtMs: now - 10_000,
            endAtMs: now + 60_000,
          },
        ],
      }),
    );

    // Should throw for matching threadId
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:999", threadId: null }),
    ).toThrow(DiscordDnrSuppressedError);

    // Should NOT throw for different threadId (no wildcard, no matching policy)
    __resetDiscordDnrPolicyCacheForTests();
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:888", threadId: null }),
    ).not.toThrow();
  });

  it("disabled recurring policies are skipped", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discord-dnr-"));
    vi.stubEnv("OPENCLAW_HOME", tmp);
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    fs.writeFileSync(
      path.join(stateDir, "discord-dnr-policies.json"),
      JSON.stringify({
        version: 1,
        recurring: [
          {
            id: "disabled-policy",
            threadId: "*",
            enabled: false,
            window: { timeZone: "America/Toronto", start: "00:00", end: "23:59" },
          },
        ],
      }),
    );

    // Even though the window covers all day, the policy is disabled
    const anyTs = Date.parse("2026-03-06T15:00:00.000Z");
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:123" }, anyTs),
    ).not.toThrow();
  });

  it("quiet hours suppress unconditionally (no bypass for user-initiated messages)", () => {
    // Regression: quiet-hours DNR queueing is intentional for sleep hygiene.
    // There must be no bypass mechanism that allows user-initiated messages
    // to skip DNR enforcement during quiet hours.
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z"); // 20:30 ET, inside window

    // DNR must throw during quiet hours regardless of call context
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, eveningTs),
    ).toThrow(DiscordDnrSuppressedError);

    // Verify no dnr-bypass module exists (must not be re-introduced)
    expect(() => require("./dnr-bypass.frankclaw.js")).toThrow();
  });

  it("direct-action context bypasses Discord DNR during quiet hours", async () => {
    // Inside quiet window: 20:30 ET
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");

    // Without direct-action context: still throws
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, eveningTs),
    ).toThrow(DiscordDnrSuppressedError);

    // With direct-action context: does NOT throw
    const logBefore = getDirectActionBypassLog().length;
    await runWithDirectAction(() => {
      expect(() =>
        enforceDiscordDnrWindow(
          { channel: "discord", to: "channel:1479083833830801520" },
          eveningTs,
        ),
      ).not.toThrow();
    });

    // Bypass was logged
    const logAfter = getDirectActionBypassLog();
    expect(logAfter.length).toBeGreaterThan(logBefore);
    const lastEntry = logAfter[logAfter.length - 1];
    expect(lastEntry?.channel).toBe("discord");
    expect(lastEntry?.target).toBe("channel:1479083833830801520");
    expect(lastEntry?.bypassedAtMs).toBe(eveningTs);
  });

  it("direct-action context does not affect calls outside the context", async () => {
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");

    // Verify the context is scoped: a call AFTER runWithDirectAction completes
    // should still be suppressed.
    await runWithDirectAction(() => {
      // Inside: OK
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, eveningTs);
    });

    // Outside: still throws
    expect(() =>
      enforceDiscordDnrWindow({ channel: "discord", to: "channel:1479083833830801520" }, eveningTs),
    ).toThrow(DiscordDnrSuppressedError);
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

    // Discord without its own policy file falls back to DEFAULT_RECURRING,
    // so it is still a DNR target (the two policy files are independent but
    // Discord always has at least the built-in quiet-hours default).
    expect(isDiscordDnrTarget({ channel: "discord", to: "channel:123" })).toBe(true);
    // WhatsApp policy works independently via channel-dnr-policies.json
    expect(isWhatsAppDnrTarget("any@g.us")).toBe(true);
  });

  it("quiet hours suppress unconditionally for WhatsApp (no bypass)", () => {
    // Regression: quiet-hours DNR queueing is intentional for sleep hygiene.
    // WhatsApp quiet hours must enforce even during user-initiated message handling.
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
            window: { timeZone: "America/Toronto", start: "17:00", end: "08:30" },
          },
        ],
      },
    });

    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z"); // 20:30 ET, inside window
    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", eveningTs)).toThrow(
      WhatsAppDnrSuppressedError,
    );
  });

  it("direct-action context bypasses WhatsApp DNR during quiet hours", async () => {
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
            window: { timeZone: "America/Toronto", start: "17:00", end: "08:30" },
          },
        ],
      },
    });

    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z"); // 20:30 ET, inside window

    // Without direct-action context: still throws
    expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", eveningTs)).toThrow(
      WhatsAppDnrSuppressedError,
    );

    // With direct-action context: does NOT throw
    const logBefore = getDirectActionBypassLog().length;
    await runWithDirectAction(() => {
      expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", eveningTs)).not.toThrow();
    });

    // Bypass was logged
    const logAfter = getDirectActionBypassLog();
    expect(logAfter.length).toBeGreaterThan(logBefore);
    const lastEntry = logAfter[logAfter.length - 1];
    expect(lastEntry?.channel).toBe("whatsapp");
    expect(lastEntry?.target).toBe("120363421390336301@g.us");
  });
});
