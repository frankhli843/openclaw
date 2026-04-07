import { describe, expect, it, vi } from "vitest";
import { resolveEmbeddedAgentApiKey } from "../stream-resolution.js";

describe("PI embedded auth-aware stream wrapper", () => {
  it("injects resolved apiKey into stream wrapper when provided", async () => {
    const authStorage = {
      getApiKey: vi.fn(async () => "storage-key"),
    };

    const result = await resolveEmbeddedAgentApiKey({
      provider: "openai",
      resolvedApiKey: "my-run-api-key",
      authStorage,
    });

    expect(result).toBe("my-run-api-key");
    // authStorage should not be called when resolvedApiKey is provided
    expect(authStorage.getApiKey).not.toHaveBeenCalled();
  });

  it("falls back to authStorage when resolvedApiKey is undefined", async () => {
    const authStorage = {
      getApiKey: vi.fn(async () => "fallback-storage-key"),
    };

    const result = await resolveEmbeddedAgentApiKey({
      provider: "anthropic",
      resolvedApiKey: undefined,
      authStorage,
    });

    expect(result).toBe("fallback-storage-key");
    expect(authStorage.getApiKey).toHaveBeenCalledWith("anthropic");
  });

  it("falls back to authStorage when resolvedApiKey is whitespace-only", async () => {
    const authStorage = {
      getApiKey: vi.fn(async () => "ws-fallback-key"),
    };

    const result = await resolveEmbeddedAgentApiKey({
      provider: "openai",
      resolvedApiKey: "   ",
      authStorage,
    });

    expect(result).toBe("ws-fallback-key");
    expect(authStorage.getApiKey).toHaveBeenCalledWith("openai");
  });

  it("returns undefined when no resolvedApiKey and no authStorage", async () => {
    const result = await resolveEmbeddedAgentApiKey({
      provider: "openai",
      resolvedApiKey: undefined,
      authStorage: undefined,
    });

    expect(result).toBeUndefined();
  });

  it("trims the resolved apiKey before returning", async () => {
    const result = await resolveEmbeddedAgentApiKey({
      provider: "openai",
      resolvedApiKey: "  trimmed-key  ",
    });

    expect(result).toBe("trimmed-key");
  });
});
