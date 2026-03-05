import { describe, expect, it } from "vitest";
import {
  isDiscordDnrTarget,
  isWithinDiscordDnrWindow,
  resolveNextDiscordDnrReleaseMs,
} from "./discord-dnr.js";

describe("discord DNR policy", () => {
  it("matches only the configured discord thread", () => {
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
    ).toBe(false);
    expect(
      isDiscordDnrTarget({
        channel: "telegram",
        to: "channel:1479083833830801520",
      }),
    ).toBe(false);
  });

  it("handles cross-midnight window semantics (19:00-09:00 Toronto)", () => {
    // 2026-03-05 20:30 America/Toronto => 2026-03-06 01:30Z
    const eveningTs = Date.parse("2026-03-06T01:30:00.000Z");
    // 2026-03-06 08:59 America/Toronto => 2026-03-06 13:59Z
    const morningTs = Date.parse("2026-03-06T13:59:00.000Z");
    // 2026-03-06 09:01 America/Toronto => 2026-03-06 14:01Z
    const afterWindowTs = Date.parse("2026-03-06T14:01:00.000Z");

    expect(isWithinDiscordDnrWindow(eveningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(morningTs)).toBe(true);
    expect(isWithinDiscordDnrWindow(afterWindowTs)).toBe(false);
  });

  it("resolves next release at first minute outside the window", () => {
    // 2026-03-05 23:10 Toronto => inside DNR.
    const insideTs = Date.parse("2026-03-06T04:10:00.000Z");
    const next = resolveNextDiscordDnrReleaseMs(insideTs);
    // Should resolve to 09:00 Toronto next morning => 2026-03-06 14:00Z.
    expect(next).toBe(Date.parse("2026-03-06T14:00:00.000Z"));
  });
});
