import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculateAuthProfileCooldownMs,
  ensureAuthProfileStore,
  markAuthProfileFailure,
} from "./auth-profiles.js";

type AuthProfileStore = ReturnType<typeof ensureAuthProfileStore>;

async function withAuthProfileStore(
  fn: (ctx: { agentDir: string; store: AuthProfileStore }) => Promise<void>,
): Promise<void> {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
  try {
    const authPath = path.join(agentDir, "auth-profiles.json");
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-default",
          },
          "anthropic:work": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-work",
          },
          "openrouter:default": {
            type: "api_key",
            provider: "openrouter",
            key: "sk-or-default",
          },
        },
      }),
    );

    const store = ensureAuthProfileStore(agentDir);
    await fn({ agentDir, store });
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
}

function expectCooldownInRange(remainingMs: number, minMs: number, maxMs: number): void {
  expect(remainingMs).toBeGreaterThan(minMs);
  expect(remainingMs).toBeLessThan(maxMs);
}

describe("markAuthProfileFailure", () => {
  it("disables billing failures for ~5 hours by default", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expectCooldownInRange(remainingMs, 4.5 * 60 * 60 * 1000, 5.5 * 60 * 60 * 1000);
    });
  });
  it("honors per-provider billing backoff overrides", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
        cfg: {
          auth: {
            cooldowns: {
              billingBackoffHoursByProvider: { Anthropic: 1 },
              billingMaxHours: 2,
            },
          },
        } as never,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expectCooldownInRange(remainingMs, 0.8 * 60 * 60 * 1000, 1.2 * 60 * 60 * 1000);
    });
  });
  it("escalates persisted cooldownUntil across mid-window retries", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
      });

      const firstCooldownUntil = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect(typeof firstCooldownUntil).toBe("number");

      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
      });

      const secondCooldownUntil = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect((secondCooldownUntil ?? 0) > (firstCooldownUntil ?? 0)).toBe(true);

      const reloaded = ensureAuthProfileStore(agentDir);
      expect(reloaded.usageStats?.["anthropic:default"]?.cooldownUntil).toBe(secondCooldownUntil);
    });
  });
  it("persists provider-level cooldown markers for quota-like failures", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
      });

      const providerStats = store.usageStats?.["__provider__:anthropic"];
      expect(typeof providerStats?.cooldownUntil).toBe("number");
      expect(providerStats?.disabledUntil).toBeUndefined();
    });
  });

  it("disables auth_permanent failures via disabledUntil (like billing)", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "auth_permanent",
        agentDir,
      });

      const stats = store.usageStats?.["anthropic:default"];
      const providerStats = store.usageStats?.["__provider__:anthropic"];
      expect(typeof stats?.disabledUntil).toBe("number");
      expect(stats?.disabledReason).toBe("auth_permanent");
      expect(typeof providerStats?.disabledUntil).toBe("number");
      expect(providerStats?.disabledReason).toBe("auth_permanent");
      // Should NOT set cooldownUntil (that's for transient errors)
      expect(stats?.cooldownUntil).toBeUndefined();
    });
  });
  it("resets backoff counters outside the failure window", async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-"));
    try {
      const authPath = path.join(agentDir, "auth-profiles.json");
      const now = Date.now();
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          version: 1,
          profiles: {
            "anthropic:default": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-default",
            },
          },
          usageStats: {
            "anthropic:default": {
              errorCount: 9,
              failureCounts: { billing: 3 },
              lastFailureAt: now - 48 * 60 * 60 * 1000,
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
        cfg: {
          auth: { cooldowns: { failureWindowHours: 24 } },
        } as never,
      });

      expect(store.usageStats?.["anthropic:default"]?.errorCount).toBe(1);
      expect(store.usageStats?.["anthropic:default"]?.failureCounts?.billing).toBe(1);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("does not persist cooldown windows for OpenRouter profiles", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "openrouter:default",
        reason: "rate_limit",
        agentDir,
      });

      await markAuthProfileFailure({
        store,
        profileId: "openrouter:default",
        reason: "billing",
        agentDir,
      });

      expect(store.usageStats?.["openrouter:default"]).toBeUndefined();

      const reloaded = ensureAuthProfileStore(agentDir);
      expect(reloaded.usageStats?.["openrouter:default"]).toBeUndefined();
    });
  });

  it("applies aggressive cooldown thresholds after repeated failures", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      for (let i = 0; i < 4; i += 1) {
        await markAuthProfileFailure({
          store,
          profileId: "anthropic:default",
          reason: "rate_limit",
          agentDir,
          cfg: {
            auth: { cooldowns: { failureWindowHours: 12 } },
          } as never,
        });
      }

      const cooldownAfter4 = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect(typeof cooldownAfter4).toBe("number");
      const remainingAfter4 = (cooldownAfter4 as number) - startedAt;
      expectCooldownInRange(remainingAfter4, 11.5 * 60 * 60 * 1000, 12.5 * 60 * 60 * 1000);

      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
        cfg: {
          auth: { cooldowns: { failureWindowHours: 12 } },
        } as never,
      });
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
        cfg: {
          auth: { cooldowns: { failureWindowHours: 12 } },
        } as never,
      });

      const cooldownAfter6 = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect(typeof cooldownAfter6).toBe("number");
      const remainingAfter6 = (cooldownAfter6 as number) - startedAt;
      expectCooldownInRange(remainingAfter6, 23.5 * 60 * 60 * 1000, 24.5 * 60 * 60 * 1000);
    });
  });
});

describe("calculateAuthProfileCooldownMs", () => {
  it("applies escalating transient cooldowns up to 24h", () => {
    expect(calculateAuthProfileCooldownMs(1)).toBe(1 * 60_000);
    expect(calculateAuthProfileCooldownMs(2)).toBe(5 * 60_000);
    expect(calculateAuthProfileCooldownMs(3)).toBe(25 * 60_000);
    expect(calculateAuthProfileCooldownMs(4)).toBe(60 * 60_000);
    expect(calculateAuthProfileCooldownMs(5)).toBe(4 * 60 * 60_000);
    expect(calculateAuthProfileCooldownMs(6)).toBe(8 * 60 * 60_000);
    expect(calculateAuthProfileCooldownMs(7)).toBe(24 * 60 * 60_000);
    expect(calculateAuthProfileCooldownMs(8)).toBe(24 * 60 * 60_000);
  });
});
