import type { OAuthRefreshFailureReason } from "../auth-profiles/oauth-refresh-failure.js";

// frankclaw: Classify OAuth refresh failure reasons for failover routing.
//
// refresh_token_reused is a transient race condition: another process refreshed
// the token first and OpenAI rotated it. The old token is now stale, but a fresh
// one is already in the store. This is NOT a permanent auth failure — classifying
// it as auth_permanent causes 10-60 min exponential backoff, which compounds into
// essentially permanent blackout after repeated occurrences (observed: 7144 errors,
// Jun 1-2 2026, backoff escalated to 60 min per attempt).
//
// All other reasons (invalid_grant, sign_in_again, invalid_refresh_token, revoked)
// indicate the user's credentials are genuinely invalid and require manual re-auth,
// so auth_permanent (10-60 min backoff) is correct for those.
export function resolveOAuthRefreshFailoverReason(
  reason: OAuthRefreshFailureReason,
): "auth" | "auth_permanent" {
  if (reason === "refresh_token_reused") {
    // Race condition: token was rotated by another process. auth = 30s/1min/5min
    // cooldown, allowing recovery once the fresh token propagates.
    return "auth";
  }
  // Genuine credential failures: invalid/revoked token requires manual re-auth.
  return "auth_permanent";
}
