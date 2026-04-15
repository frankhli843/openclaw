import { describe, expect, it } from "vitest";
import { resolveDiscordDevGuildsFromSlashCommandConfig } from "./commands.frankclaw.js";

describe("resolveDiscordDevGuildsFromSlashCommandConfig", () => {
  it("returns undefined when missing or invalid", () => {
    expect(resolveDiscordDevGuildsFromSlashCommandConfig(undefined)).toBeUndefined();
    expect(resolveDiscordDevGuildsFromSlashCommandConfig(null)).toBeUndefined();
    expect(resolveDiscordDevGuildsFromSlashCommandConfig("nope")).toBeUndefined();
    expect(resolveDiscordDevGuildsFromSlashCommandConfig({})).toBeUndefined();
    expect(resolveDiscordDevGuildsFromSlashCommandConfig({ devGuilds: "123" })).toBeUndefined();
  });

  it("dedups and normalizes string entries", () => {
    expect(resolveDiscordDevGuildsFromSlashCommandConfig({ devGuilds: ["1", "2", "1"] })).toEqual([
      "1",
      "2",
    ]);
  });
});
