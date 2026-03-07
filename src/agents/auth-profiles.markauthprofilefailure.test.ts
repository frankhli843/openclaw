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
  it("applies quota lockout for billing: 1st=12h, 2nd=24h", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      const firstDisabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof firstDisabledUntil).toBe("number");
      const firstRemainingMs = (firstDisabledUntil as number) - startedAt;
      expectCooldownInRange(firstRemainingMs, 11.5 * 60 * 60 * 1000, 12.5 * 60 * 60 * 1000);

      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      const secondDisabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof secondDisabledUntil).toBe("number");
      const secondRemainingMs = (secondDisabledUntil as number) - startedAt;
      expectCooldownInRange(secondRemainingMs, 23.5 * 60 * 60 * 1000, 24.5 * 60 * 60 * 1000);
    });
  });

  it("treats first rate_limit as a short cooldown, then escalates on repeats", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
      });

      // First hit => short cooldown (minutes), not long lockout.
      const firstCooldownUntil = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect(typeof firstCooldownUntil).toBe("number");
      const firstRemainingMs = (firstCooldownUntil as number) - startedAt;
      expectCooldownInRange(firstRemainingMs, 60 * 1000, 3 * 60 * 1000);
      expect(store.usageStats?.["anthropic:default"]?.disabledUntil).toBeUndefined();

      // Second hit within the soft window => long lockout.
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        agentDir,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expectCooldownInRange(remainingMs, 11.5 * 60 * 60 * 1000, 12.5 * 60 * 60 * 1000);
      expect(store.usageStats?.["anthropic:default"]?.disabledReason).toBe("rate_limit");
    });
  });

  it("uses soft Anthropic retry-after hints for short per-profile cooldown", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        rateLimit: { severity: "soft", retryAfterMs: 30_000 },
        agentDir,
      });

      const cooldownUntil = store.usageStats?.["anthropic:default"]?.cooldownUntil;
      expect(typeof cooldownUntil).toBe("number");
      const remainingMs = (cooldownUntil as number) - startedAt;
      expectCooldownInRange(remainingMs, 20_000, 60_000);
      expect(store.usageStats?.["anthropic:default"]?.disabledUntil).toBeUndefined();
    });
  });

  it("uses hard Anthropic available-at hints for strict per-profile disable windows", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      const availableAtMs = Date.now() + 13 * 60 * 60 * 1000;
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "rate_limit",
        rateLimit: { severity: "hard", availableAtMs },
        agentDir,
      });

      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      expect((disabledUntil as number) - availableAtMs).toBeGreaterThan(-5_000);
      expect(store.usageStats?.["anthropic:default"]?.disabledReason).toBe("rate_limit");
    });
  });

  it("records overloaded failures in the cooldown bucket", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "overloaded",
        agentDir,
      });

      const stats = store.usageStats?.["anthropic:default"];
      expect(typeof stats?.cooldownUntil).toBe("number");
      expect(stats?.disabledUntil).toBeUndefined();
      expect(stats?.disabledReason).toBeUndefined();
      expect(stats?.failureCounts?.overloaded).toBe(1);
    });
  });

  it("keeps lockout profile-scoped (does not write provider-wide lock entries)", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      expect(store.usageStats?.["__provider__:anthropic"]).toBeUndefined();
      expect(store.usageStats?.["anthropic:default"]?.disabledUntil).toBeTypeOf("number");
      expect(store.usageStats?.["anthropic:work"]?.disabledUntil).toBeUndefined();
    });
  });

  it("resets quota lockout counter after 36h rolling window", async () => {
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
              billingFailureCount: 7,
              billingLastFailureAt: now - 37 * 60 * 60 * 1000,
            },
          },
        }),
      );

      const store = ensureAuthProfileStore(agentDir);
      const startedAt = Date.now();
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "billing",
        agentDir,
      });

      expect(store.usageStats?.["anthropic:default"]?.billingFailureCount).toBe(1);
      const disabledUntil = store.usageStats?.["anthropic:default"]?.disabledUntil;
      expect(typeof disabledUntil).toBe("number");
      const remainingMs = (disabledUntil as number) - startedAt;
      expectCooldownInRange(remainingMs, 11.5 * 60 * 60 * 1000, 12.5 * 60 * 60 * 1000);
    } finally {
      fs.rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("disables auth_permanent failures via disabledUntil", async () => {
    await withAuthProfileStore(async ({ agentDir, store }) => {
      await markAuthProfileFailure({
        store,
        profileId: "anthropic:default",
        reason: "auth_permanent",
        agentDir,
      });

      const stats = store.usageStats?.["anthropic:default"];
      expect(typeof stats?.disabledUntil).toBe("number");
      expect(stats?.disabledReason).toBe("auth_permanent");
      expect(stats?.cooldownUntil).toBeUndefined();
    });
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
