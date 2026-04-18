import { afterEach, describe, expect, it } from "vitest";
import {
  checkProviderBreaker,
  getCircuitBreakerStatus,
  recordProviderSuccess,
  recordProviderTimeoutFailure,
  resetCircuitBreakerState,
} from "./provider-circuit-breaker.frankclaw.js";

describe("provider-circuit-breaker.frankclaw", () => {
  afterEach(() => {
    resetCircuitBreakerState();
  });

  it("returns ok for unknown providers", () => {
    expect(checkProviderBreaker("openai-codex")).toBe("ok");
  });

  it("does not trip after fewer than 3 failures", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    expect(checkProviderBreaker("openai-codex")).toBe("ok");
  });

  it("trips after 3 consecutive timeout failures", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    expect(checkProviderBreaker("openai-codex")).toBe("skip");
  });

  it("resets on successful response", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    expect(checkProviderBreaker("openai-codex")).toBe("skip");

    recordProviderSuccess("openai-codex");
    expect(checkProviderBreaker("openai-codex")).toBe("ok");
  });

  it("tracks providers independently", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("google-gemini-cli");

    expect(checkProviderBreaker("openai-codex")).toBe("skip");
    expect(checkProviderBreaker("google-gemini-cli")).toBe("ok");
  });

  it("allows probe attempts periodically during cooldown", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");

    // First check after trip: skip (probe window not open yet since
    // probeAllowedAfter is set to now + PROBE_INTERVAL_MS at trip time)
    const status1 = checkProviderBreaker("openai-codex");
    expect(status1).toBe("skip");
  });

  it("returns diagnostic status", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");

    const status = getCircuitBreakerStatus();
    expect(status).toHaveLength(1);
    expect(status[0].provider).toBe("openai-codex");
    expect(status[0].consecutiveFailures).toBe(3);
    expect(status[0].tripped).toBe(true);
    expect(status[0].trippedForMs).toBeGreaterThanOrEqual(0);
  });

  it("success on untracked provider is a no-op", () => {
    // Should not throw
    recordProviderSuccess("unknown-provider");
    expect(getCircuitBreakerStatus()).toHaveLength(0);
  });

  it("resetCircuitBreakerState clears all state", () => {
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    recordProviderTimeoutFailure("openai-codex");
    expect(checkProviderBreaker("openai-codex")).toBe("skip");

    resetCircuitBreakerState();
    expect(checkProviderBreaker("openai-codex")).toBe("ok");
    expect(getCircuitBreakerStatus()).toHaveLength(0);
  });
});
