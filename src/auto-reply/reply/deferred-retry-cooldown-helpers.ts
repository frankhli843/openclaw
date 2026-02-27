import { resolveAuthProfileOrder } from "../../agents/auth-profiles/order.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles/store.js";
import { getSoonestCooldownExpiry } from "../../agents/auth-profiles/usage.js";
import type { OpenClawConfig } from "../../config/types.js";

/**
 * Compute the soonest cooldown expiry across ALL configured model providers
 * (primary + fallbacks). Returns epoch ms or null if no cooldown is active.
 */
export function getSoonestCooldownExpiryAcrossAllProviders(
  cfg: OpenClawConfig | undefined,
  agentDir?: string,
): number | null {
  if (!cfg) {
    return null;
  }

  const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  if (!authStore) {
    return null;
  }

  // Collect all unique providers from primary + fallbacks
  const providers = new Set<string>();
  const modelCfg = cfg.agents?.defaults?.model as
    | string
    | { primary?: string; fallbacks?: string[] }
    | undefined;

  function addProviderFromModelId(modelId: string): void {
    const slash = modelId.indexOf("/");
    if (slash > 0) {
      providers.add(modelId.slice(0, slash));
    }
  }

  if (typeof modelCfg === "string") {
    addProviderFromModelId(modelCfg);
  } else if (modelCfg && typeof modelCfg === "object") {
    if (typeof modelCfg.primary === "string") {
      addProviderFromModelId(modelCfg.primary);
    }
    if (Array.isArray(modelCfg.fallbacks)) {
      for (const fb of modelCfg.fallbacks) {
        if (typeof fb === "string") {
          addProviderFromModelId(fb);
        }
      }
    }
  }

  if (providers.size === 0) {
    return null;
  }

  let soonest: number | null = null;
  for (const provider of providers) {
    const profileIds = resolveAuthProfileOrder({ cfg, store: authStore, provider });
    if (profileIds.length === 0) {
      continue;
    }
    const expiry = getSoonestCooldownExpiry(authStore, profileIds);
    if (expiry != null && Number.isFinite(expiry) && expiry > Date.now()) {
      if (soonest === null || expiry < soonest) {
        soonest = expiry;
      }
    }
  }

  return soonest;
}
