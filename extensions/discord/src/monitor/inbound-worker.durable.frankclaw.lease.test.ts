import { describe, expect, it } from "vitest";

const { __testing } = await import("./inbound-worker.durable.frankclaw.js");

describe("resolveDiscordDurableLeaseMs", () => {
  it("defaults to timeout plus buffer when no explicit lease provided", () => {
    const timeoutMs = 30 * 60_000;
    const lease = __testing.resolveDiscordDurableLeaseMs({
      requestedLeaseMs: undefined,
      timeoutMs,
    });
    expect(lease).toBe(timeoutMs + 30_000);
  });

  it("keeps an explicit lease that exceeds timeout plus buffer", () => {
    const timeoutMs = 30 * 60_000;
    const lease = __testing.resolveDiscordDurableLeaseMs({
      requestedLeaseMs: 99 * 60_000,
      timeoutMs,
    });
    expect(lease).toBe(99 * 60_000);
  });

  it("falls back to a conservative lease when timeout is disabled", () => {
    const lease = __testing.resolveDiscordDurableLeaseMs({
      requestedLeaseMs: 10 * 60_000,
      timeoutMs: undefined,
    });
    expect(lease).toBe(60 * 60_000);
  });
});
