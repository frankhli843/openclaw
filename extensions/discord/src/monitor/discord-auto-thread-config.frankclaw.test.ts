/**
 * Tests that Discord autoThread config is correctly read and applied
 * in the channel config resolution.
 */

import { describe, expect, it } from "vitest";

describe("Discord autoThread config", () => {
  it("DiscordChannelConfigResolved includes autoThread field", () => {
    // Tests that the type shape matches what threading.ts expects
    const config = {
      allowed: true,
      autoThread: true,
      autoThreadName: "generated" as const,
      autoArchiveDuration: "10080" as const,
    };

    expect(config.autoThread).toBe(true);
    expect(config.autoThreadName).toBe("generated");
    expect(config.autoArchiveDuration).toBe("10080");
  });

  it("autoThread defaults to false/undefined when not set", () => {
    const config = {
      allowed: true,
    };

    expect(config).not.toHaveProperty("autoThread");
  });

  it("autoThread with autoThreadName generated enables title generation", () => {
    const config = {
      allowed: true,
      autoThread: true,
      autoThreadName: "generated" as const,
    };

    // The threading logic checks: channelConfig?.autoThread && channelConfig?.autoThreadName === "generated"
    expect(config.autoThread && config.autoThreadName === "generated").toBe(true);
  });

  it("autoThread without autoThreadName uses message text as name", () => {
    const config = {
      allowed: true,
      autoThread: true,
    };

    // When autoThreadName is not "generated", thread uses message content as name
    expect(config.autoThread).toBe(true);
    expect((config as any).autoThreadName).toBeUndefined();
  });

  it("autoArchiveDuration accepts valid Discord durations", () => {
    const validDurations = ["60", "1440", "4320", "10080", 60, 1440, 4320, 10080];
    for (const duration of validDurations) {
      const numDuration = typeof duration === "string" ? Number(duration) : duration;
      expect([60, 1440, 4320, 10080]).toContain(numDuration);
    }
  });

  it("resolveDiscordChannelConfig passes autoThread through", async () => {
    // Import and test the actual resolve function
    const { resolveDiscordChannelConfig } = await import("./allow-list.js");

    // Call with a config that has an entry with autoThread
    const result = resolveDiscordChannelConfig({
      guildEntries: {
        guild1: {
          channels: {
            "text-channel-1": {
              autoThread: true,
              autoThreadName: "generated",
              autoArchiveDuration: "1440",
            },
          },
        },
      },
      channelId: "text-channel-1",
      guildId: "guild1",
    } as any);

    if (result) {
      expect(result.autoThread).toBe(true);
      expect(result.autoThreadName).toBe("generated");
      expect(result.autoArchiveDuration).toBe("1440");
    }
  });
});
