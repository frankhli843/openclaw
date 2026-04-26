import { describe, expect, it } from "vitest";
import type { CronJob } from "../types.js";
import {
  clearSelfHealOnSuccess,
  formatCronSelfHealAlert,
  isTransientCronInfraError,
  resolveCronSelfHealConfig,
  shouldBypassDurableQueueForCronJob,
} from "./self-heal.frankclaw.js";

describe("resolveCronSelfHealConfig", () => {
  it("uses defaults when no config", () => {
    const cfg = resolveCronSelfHealConfig(undefined);
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxAttemptsPerRun).toBe(2);
    expect(cfg.retryDelayMs).toBeGreaterThan(0);
    expect(cfg.matchers.length).toBeGreaterThan(0);
  });

  it("respects enabled=false", () => {
    const cfg = resolveCronSelfHealConfig({ selfHeal: { enabled: false } });
    expect(cfg.enabled).toBe(false);
  });

  it("uses custom matchers", () => {
    const cfg = resolveCronSelfHealConfig({ selfHeal: { match: ["custom error"] } });
    expect(cfg.matchers).toEqual(["custom error"]);
  });
});

describe("isTransientCronInfraError", () => {
  it("matches default matchers", () => {
    const cfg = resolveCronSelfHealConfig(undefined);
    expect(isTransientCronInfraError("rate limit exceeded", cfg)).toBe(true);
    expect(isTransientCronInfraError("429 too many requests", cfg)).toBe(true);
    expect(isTransientCronInfraError("permanent failure", cfg)).toBe(false);
  });

  it("returns false when disabled", () => {
    const cfg = resolveCronSelfHealConfig({ selfHeal: { enabled: false } });
    expect(isTransientCronInfraError("rate limit", cfg)).toBe(false);
  });

  it("matches network-level transient errors", () => {
    const cfg = resolveCronSelfHealConfig(undefined);
    expect(isTransientCronInfraError("network connection error", cfg)).toBe(true);
    expect(isTransientCronInfraError("TypeError: fetch failed", cfg)).toBe(true);
    expect(isTransientCronInfraError("ECONNRESET: connection reset by peer", cfg)).toBe(true);
    expect(isTransientCronInfraError("connect ECONNREFUSED 127.0.0.1:443", cfg)).toBe(true);
    expect(isTransientCronInfraError("socket hang up", cfg)).toBe(true);
    expect(isTransientCronInfraError("FailoverError: all providers exhausted", cfg)).toBe(true);
    expect(isTransientCronInfraError("ETIMEDOUT 10.0.0.1:443", cfg)).toBe(true);
  });

  it("returns false for empty error", () => {
    const cfg = resolveCronSelfHealConfig(undefined);
    expect(isTransientCronInfraError("", cfg)).toBe(false);
    expect(isTransientCronInfraError(undefined, cfg)).toBe(false);
  });
});

describe("formatCronSelfHealAlert", () => {
  it("formats alert message", () => {
    const msg = formatCronSelfHealAlert({
      job: { id: "j1", name: "test-job" } as CronJob,
      originRunAtMs: Date.parse("2026-01-01T00:00:00Z"),
      attempt: 2,
      maxAttempts: 3,
      error: "rate limit",
    });
    expect(msg).toContain("j1");
    expect(msg).toContain("test-job");
    expect(msg).toContain("2/3");
    expect(msg).toContain("rate limit");
  });
});

describe("shouldBypassDurableQueueForCronJob", () => {
  it("returns true for main systemEvent with now wakeMode", () => {
    expect(
      shouldBypassDurableQueueForCronJob({
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent" },
      } as CronJob),
    ).toBe(true);
  });

  it("returns false for isolated jobs", () => {
    expect(
      shouldBypassDurableQueueForCronJob({
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "systemEvent" },
      } as CronJob),
    ).toBe(false);
  });
});

describe("clearSelfHealOnSuccess", () => {
  it("clears selfHeal state", () => {
    const job = { state: { selfHeal: { originRunAtMs: 1, attempts: 1 } } } as CronJob;
    clearSelfHealOnSuccess(job);
    expect(job.state.selfHeal).toBeUndefined();
  });

  it("no-ops when no selfHeal state", () => {
    const job = { state: {} } as CronJob;
    clearSelfHealOnSuccess(job);
    expect(job.state.selfHeal).toBeUndefined();
  });
});
