import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDiscordDnrPolicyCacheForTests,
  enforceDiscordDnrWindow,
  isDiscordDnrTarget,
  isWithinDiscordDnrWindow,
  resolveNextDiscordDnrReleaseMs,
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
