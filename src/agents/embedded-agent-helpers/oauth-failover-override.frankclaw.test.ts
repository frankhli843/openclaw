import { describe, expect, it } from "vitest";
import type { OAuthRefreshFailureReason } from "../auth-profiles/oauth-refresh-failure.js";
import { resolveOAuthRefreshFailoverReason } from "./oauth-failover-override.frankclaw.js";

describe("resolveOAuthRefreshFailoverReason", () => {
  it("classifies refresh_token_reused as auth (transient race condition)", () => {
    expect(resolveOAuthRefreshFailoverReason("refresh_token_reused")).toBe("auth");
  });

  it("classifies invalid_grant as auth_permanent (genuine credential failure)", () => {
    expect(resolveOAuthRefreshFailoverReason("invalid_grant")).toBe("auth_permanent");
  });

  it("classifies revoked as auth_permanent (token explicitly revoked)", () => {
    expect(resolveOAuthRefreshFailoverReason("revoked")).toBe("auth_permanent");
  });

  it("classifies sign_in_again as auth_permanent (session expired, re-auth required)", () => {
    expect(resolveOAuthRefreshFailoverReason("sign_in_again")).toBe("auth_permanent");
  });

  it("classifies invalid_refresh_token as auth_permanent (token malformed or deleted)", () => {
    expect(resolveOAuthRefreshFailoverReason("invalid_refresh_token")).toBe("auth_permanent");
  });

  it("only refresh_token_reused gets auth; all other reasons get auth_permanent", () => {
    const permanentReasons: OAuthRefreshFailureReason[] = [
      "invalid_grant",
      "sign_in_again",
      "invalid_refresh_token",
      "revoked",
    ];
    for (const reason of permanentReasons) {
      expect(resolveOAuthRefreshFailoverReason(reason), reason).toBe("auth_permanent");
    }
    expect(resolveOAuthRefreshFailoverReason("refresh_token_reused")).toBe("auth");
  });
});
