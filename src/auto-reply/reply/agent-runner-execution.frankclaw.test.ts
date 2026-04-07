import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableAgentFailure,
  maybeRedirectErrorToLogsGroup,
  maybeRedirectCompactionResetToLogsGroup,
} from "./agent-runner-execution.frankclaw.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FRANKCLAW_LOGS_GROUP;
});

describe("isRetryableAgentFailure", () => {
  it("returns true for transient HTTP errors", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: true,
        errorMessage: "some error",
        fallbackAttempts: [],
        isRateLimitError: () => false,
      }),
    ).toBe(true);
  });

  it("returns true for rate limit errors", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: false,
        errorMessage: "rate_limit exceeded",
        fallbackAttempts: [],
        isRateLimitError: (msg) => msg.includes("rate_limit"),
      }),
    ).toBe(true);
  });

  it("returns true when fallback attempts include rate_limit reason", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: false,
        errorMessage: "error",
        fallbackAttempts: [{ reason: "rate_limit" }],
        isRateLimitError: () => false,
      }),
    ).toBe(true);
  });

  it("returns true when fallback attempts include timeout reason", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: false,
        errorMessage: "error",
        fallbackAttempts: [{ reason: "timeout" }],
        isRateLimitError: () => false,
      }),
    ).toBe(true);
  });

  it("returns true when fallback attempts include 500+ status", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: false,
        errorMessage: "error",
        fallbackAttempts: [{ status: 503 }],
        isRateLimitError: () => false,
      }),
    ).toBe(true);
  });

  it("returns false when no retryable conditions met", () => {
    expect(
      isRetryableAgentFailure({
        isTransientHttp: false,
        errorMessage: "bad request",
        fallbackAttempts: [{ status: 400 }],
        isRateLimitError: () => false,
      }),
    ).toBe(false);
  });
});

describe("maybeRedirectErrorToLogsGroup", () => {
  it("returns null when FRANKCLAW_LOGS_GROUP is not set", async () => {
    const result = await maybeRedirectErrorToLogsGroup({
      fallbackText: "error",
      isContextOverflow: false,
      retryableFailure: false,
    });

    expect(result).toBeNull();
  });
});

describe("maybeRedirectCompactionResetToLogsGroup", () => {
  it("returns null when FRANKCLAW_LOGS_GROUP is not set", () => {
    const result = maybeRedirectCompactionResetToLogsGroup({
      resetText: "reset",
      sessionKey: "test",
    });

    expect(result).toBeNull();
  });
});
