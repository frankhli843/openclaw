import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { FailoverError } from "./failover-error.js";
import { runWithModelFallback } from "./model-fallback.js";
import { makeModelFallbackCfg } from "./test-helpers/model-fallback-config-fixture.js";

// Mock sleepWithAbort to resolve instantly in tests
vi.mock("../infra/backoff.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sleepWithAbort: vi.fn().mockResolvedValue(undefined),
  };
});

const makeCfg = makeModelFallbackCfg;

function makeSimpleCfg(): OpenClawConfig {
  return makeCfg({
    agents: {
      defaults: {
        model: {
          primary: "anthropic/claude-opus-4",
          fallbacks: ["anthropic/claude-sonnet-4"],
        },
      },
    },
  });
}

describe("runWithModelFallback rate-limit retry", () => {
  it("retries after cooldown when all models fail with rate_limit and abortSignal is provided", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      if (callCount <= 2) {
        throw new FailoverError("rate limited", {
          reason: "rate_limit",
          provider: _provider,
          model: _model,
          status: 429,
        });
      }
      return "success";
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const result = await runWithModelFallback({
      cfg: makeSimpleCfg(),
      provider: "anthropic",
      model: "claude-opus-4",
      abortSignal: controller.signal,
      sessionStartedAt: Date.now(),
      run,
    });

    clearTimeout(timer);
    expect(result.result).toBe("success");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("does NOT retry when abortSignal is not provided", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      throw new FailoverError("rate limited", {
        reason: "rate_limit",
        provider: _provider,
        model: _model,
        status: 429,
      });
    };

    await expect(
      runWithModelFallback({
        cfg: makeSimpleCfg(),
        provider: "anthropic",
        model: "claude-opus-4",
        run,
      }),
    ).rejects.toThrow();

    // 2 candidates (primary + fallback), each tried once
    expect(callCount).toBe(2);
  });

  it("stops retrying when abort signal fires during wait", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      throw new FailoverError("rate limited", {
        reason: "rate_limit",
        provider: _provider,
        model: _model,
        status: 429,
      });
    };

    const controller = new AbortController();
    // Mock sleepWithAbort to trigger abort
    const { sleepWithAbort } = await import("../infra/backoff.js");
    (sleepWithAbort as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("aborted");
    });

    await expect(
      runWithModelFallback({
        cfg: makeSimpleCfg(),
        provider: "anthropic",
        model: "claude-opus-4",
        abortSignal: controller.signal,
        sessionStartedAt: Date.now(),
        run,
      }),
    ).rejects.toThrow();

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("does NOT retry when failures are auth errors (not rate_limit)", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      throw new FailoverError("unauthorized", {
        reason: "auth",
        provider: _provider,
        model: _model,
        status: 401,
      });
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    await expect(
      runWithModelFallback({
        cfg: makeSimpleCfg(),
        provider: "anthropic",
        model: "claude-opus-4",
        abortSignal: controller.signal,
        sessionStartedAt: Date.now(),
        run,
      }),
    ).rejects.toThrow();

    clearTimeout(timer);
    expect(callCount).toBe(2);
  });

  it("does NOT retry when failures are billing errors", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      throw new FailoverError("billing error", {
        reason: "billing",
        provider: _provider,
        model: _model,
        status: 402,
      });
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    await expect(
      runWithModelFallback({
        cfg: makeSimpleCfg(),
        provider: "anthropic",
        model: "claude-opus-4",
        abortSignal: controller.signal,
        sessionStartedAt: Date.now(),
        run,
      }),
    ).rejects.toThrow();

    clearTimeout(timer);
    expect(callCount).toBe(2);
  });

  it("retries when failures are overloaded (treated as transient like rate_limit)", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      if (callCount <= 2) {
        throw new FailoverError("overloaded", {
          reason: "overloaded",
          provider: _provider,
          model: _model,
          status: 529,
        });
      }
      return "recovered";
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const result = await runWithModelFallback({
      cfg: makeSimpleCfg(),
      provider: "anthropic",
      model: "claude-opus-4",
      abortSignal: controller.signal,
      sessionStartedAt: Date.now(),
      run,
    });

    clearTimeout(timer);
    expect(result.result).toBe("recovered");
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("retries multiple rounds until success", async () => {
    let callCount = 0;
    const run = async (_provider: string, _model: string) => {
      callCount++;
      // Fail for 3 full rounds (6 calls), succeed on round 4
      if (callCount <= 6) {
        throw new FailoverError("rate limited", {
          reason: "rate_limit",
          provider: _provider,
          model: _model,
          status: 429,
        });
      }
      return "finally";
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const result = await runWithModelFallback({
      cfg: makeSimpleCfg(),
      provider: "anthropic",
      model: "claude-opus-4",
      abortSignal: controller.signal,
      sessionStartedAt: Date.now(),
      run,
    });

    clearTimeout(timer);
    expect(result.result).toBe("finally");
    expect(callCount).toBeGreaterThanOrEqual(7);
  });
});
