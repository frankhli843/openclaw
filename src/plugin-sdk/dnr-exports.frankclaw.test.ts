/**
 * Tests that DNR policy exports are accessible through the plugin-sdk infra-runtime barrel.
 */

import { describe, expect, it } from "vitest";

describe("DNR policy exports in plugin-sdk", () => {
  it("exports enforceDiscordDnrWindow from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.enforceDiscordDnrWindow).toBe("function");
  });

  it("exports DiscordDnrSuppressedError from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(mod.DiscordDnrSuppressedError).toBeDefined();
    expect(typeof mod.DiscordDnrSuppressedError).toBe("function");
  });

  it("exports enforceWhatsAppDnrWindow from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.enforceWhatsAppDnrWindow).toBe("function");
  });

  it("exports WhatsAppDnrSuppressedError from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(mod.WhatsAppDnrSuppressedError).toBeDefined();
    expect(typeof mod.WhatsAppDnrSuppressedError).toBe("function");
  });

  it("exports isDiscordDnrTarget from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.isDiscordDnrTarget).toBe("function");
  });

  it("exports isWhatsAppDnrTarget from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.isWhatsAppDnrTarget).toBe("function");
  });

  it("exports isWithinDiscordDnrWindow from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.isWithinDiscordDnrWindow).toBe("function");
  });

  it("exports inspectWhatsAppDnrWindow from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.inspectWhatsAppDnrWindow).toBe("function");
  });

  it("exports __resetDiscordDnrPolicyCacheForTests from infra-runtime", async () => {
    const mod = await import("./infra-runtime.js");
    expect(typeof mod.__resetDiscordDnrPolicyCacheForTests).toBe("function");
  });
});
