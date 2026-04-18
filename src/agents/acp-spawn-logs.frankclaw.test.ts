import { describe, expect, it } from "vitest";
import { shouldRedirectAcpSpawnToLogs } from "./acp-spawn-logs.frankclaw.js";

describe("shouldRedirectAcpSpawnToLogs", () => {
  it("returns true for Discord ACP run-mode spawns with thread=true", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: "discord",
        spawnMode: "run",
        threadRequested: true,
      }),
    ).toBe(true);
  });

  it("returns false for Discord ACP session-mode spawns (thread is the interface)", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: "discord",
        spawnMode: "session",
        threadRequested: true,
      }),
    ).toBe(false);
  });

  it("returns false when thread is not requested", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: "discord",
        spawnMode: "run",
        threadRequested: false,
      }),
    ).toBe(false);
  });

  it("returns false for non-Discord channels", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: "telegram",
        spawnMode: "run",
        threadRequested: true,
      }),
    ).toBe(false);
  });

  it("returns false when channel is undefined", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: undefined,
        spawnMode: "run",
        threadRequested: true,
      }),
    ).toBe(false);
  });

  it("is case-insensitive for Discord channel name", () => {
    expect(
      shouldRedirectAcpSpawnToLogs({
        channel: "Discord",
        spawnMode: "run",
        threadRequested: true,
      }),
    ).toBe(true);
  });
});
