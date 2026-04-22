import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiscordDnrPolicyCacheForTests,
  DiscordDnrSuppressedError,
  enforceDiscordDnrWindow,
  enforceWhatsAppDnrWindow,
} from "./discord-dnr.js";
import { runWithDnrBypass, isDnrBypassActive } from "./dnr-bypass.frankclaw.js";

describe("DNR bypass for user-initiated actions", () => {
  afterEach(() => {
    __resetDiscordDnrPolicyCacheForTests();
  });

  // Inside default quiet window: 2026-03-06T01:30Z = 2026-03-05 20:30 ET
  const quietHoursTs = Date.parse("2026-03-06T01:30:00.000Z");

  it("isDnrBypassActive returns false outside runWithDnrBypass", () => {
    expect(isDnrBypassActive()).toBe(false);
  });

  it("isDnrBypassActive returns true inside runWithDnrBypass", () => {
    runWithDnrBypass(() => {
      expect(isDnrBypassActive()).toBe(true);
    });
  });

  it("isDnrBypassActive returns false after runWithDnrBypass completes", () => {
    runWithDnrBypass(() => {});
    expect(isDnrBypassActive()).toBe(false);
  });

  it("enforceDiscordDnrWindow does NOT throw during quiet hours when bypass is active", () => {
    runWithDnrBypass(() => {
      expect(() =>
        enforceDiscordDnrWindow(
          { channel: "discord", to: "channel:1479083833830801520" },
          quietHoursTs,
        ),
      ).not.toThrow();
    });
  });

  it("enforceDiscordDnrWindow DOES throw during quiet hours when bypass is NOT active", () => {
    expect(() =>
      enforceDiscordDnrWindow(
        { channel: "discord", to: "channel:1479083833830801520" },
        quietHoursTs,
      ),
    ).toThrow(DiscordDnrSuppressedError);
  });

  it("enforceWhatsAppDnrWindow does NOT throw during quiet hours when bypass is active", () => {
    // Set up a WhatsApp policy by writing to the policy file
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnr-bypass-test-"));
    const stateDir = path.join(tmpDir, "state");
    fs.mkdirSync(stateDir, { recursive: true });
    const policyPath = path.join(stateDir, "channel-dnr-policies.json");
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        version: 1,
        whatsapp: {
          recurring: [
            {
              id: "test-wa",
              channel: "whatsapp",
              groupId: "120363421390336301@g.us",
              enabled: true,
              window: { timeZone: "America/Toronto", start: "17:00", end: "08:30" },
            },
          ],
        },
      }),
    );
    vi.stubEnv("OPENCLAW_HOME", tmpDir);
    __resetDiscordDnrPolicyCacheForTests();

    runWithDnrBypass(() => {
      expect(() => enforceWhatsAppDnrWindow("120363421390336301@g.us", quietHoursTs)).not.toThrow();
    });

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates bypass through async context", async () => {
    const result = await runWithDnrBypass(async () => {
      // Simulate an async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(isDnrBypassActive()).toBe(true);

      // DNR should not throw
      expect(() =>
        enforceDiscordDnrWindow(
          { channel: "discord", to: "channel:1479083833830801520" },
          quietHoursTs,
        ),
      ).not.toThrow();

      return "ok";
    });
    expect(result).toBe("ok");
    expect(isDnrBypassActive()).toBe(false);
  });

  it("does not leak bypass across concurrent async contexts", async () => {
    const bypassed = runWithDnrBypass(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isDnrBypassActive()).toBe(true);
    });

    // This runs concurrently but outside the bypass context
    const notBypassed = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(isDnrBypassActive()).toBe(false);
    })();

    await Promise.all([bypassed, notBypassed]);
  });
});
