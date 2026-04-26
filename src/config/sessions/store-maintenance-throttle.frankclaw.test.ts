import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shouldRunMaintenance,
  resetMaintenanceThrottle,
} from "./store-maintenance-throttle.frankclaw.js";

describe("shouldRunMaintenance", () => {
  afterEach(() => {
    resetMaintenanceThrottle();
    vi.unstubAllEnvs();
  });

  it("returns true on first call (cold start)", () => {
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
  });

  it("returns false on immediate second call (within throttle window)", () => {
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(false);
  });

  it("returns true after throttle window elapses", () => {
    vi.useFakeTimers();
    try {
      expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
      vi.advanceTimersByTime(30_001);
      expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks different store paths independently", () => {
    expect(shouldRunMaintenance("/tmp/store-a.json")).toBe(true);
    expect(shouldRunMaintenance("/tmp/store-b.json")).toBe(true);
    // Both should now be throttled
    expect(shouldRunMaintenance("/tmp/store-a.json")).toBe(false);
    expect(shouldRunMaintenance("/tmp/store-b.json")).toBe(false);
  });

  it("respects OPENCLAW_SESSION_MAINTENANCE_THROTTLE_MS env var", () => {
    vi.stubEnv("OPENCLAW_SESSION_MAINTENANCE_THROTTLE_MS", "100");
    vi.useFakeTimers();
    try {
      expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
      vi.advanceTimersByTime(50);
      expect(shouldRunMaintenance("/tmp/store.json")).toBe(false);
      vi.advanceTimersByTime(60);
      expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables throttle when env var is 0", () => {
    vi.stubEnv("OPENCLAW_SESSION_MAINTENANCE_THROTTLE_MS", "0");
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
  });

  it("resetMaintenanceThrottle clears all state", () => {
    shouldRunMaintenance("/tmp/store.json");
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(false);
    resetMaintenanceThrottle();
    expect(shouldRunMaintenance("/tmp/store.json")).toBe(true);
  });
});
