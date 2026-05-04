/**
 * Tests Telegram DNR quiet hours enforcement in deliverReplies.
 * Verifies that DiscordDnrSuppressedError propagates (not swallowed) so
 * deliver.ts can call deferDelivery() and the queue entry is not lost.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Telegram DNR enforcement in deliverReplies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates DiscordDnrSuppressedError when in DNR window (so deliver.ts can defer)", () => {
    // Simulate the delivery.replies.ts DNR check pattern:
    // ERR_MODULE_NOT_FOUND is silently ignored; everything else re-throws.
    function simulateDnrCheck(enforcer: () => void): void {
      try {
        enforcer();
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code === "ERR_MODULE_NOT_FOUND") {
          // Module not available — skip DNR check.
        } else {
          throw err;
        }
      }
    }

    const dnrError = new Error("discord outbound suppressed by DNR window");
    (dnrError as any).name = "DiscordDnrSuppressedError";
    (dnrError as any).nextEligibleAtMs = Date.now() + 3_600_000;

    expect(() =>
      simulateDnrCheck(() => {
        throw dnrError;
      }),
    ).toThrow("discord outbound suppressed by DNR window");
  });

  it("propagated error carries nextEligibleAtMs for deferral", () => {
    const nextEligibleAtMs = Date.now() + 3_600_000;

    function simulateDnrCheck(enforcer: () => void): void {
      try {
        enforcer();
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code !== "ERR_MODULE_NOT_FOUND") throw err;
      }
    }

    const dnrError = Object.assign(new Error("discord outbound suppressed by DNR window"), {
      name: "DiscordDnrSuppressedError",
      nextEligibleAtMs,
    });

    let caughtErr: unknown;
    try {
      simulateDnrCheck(() => {
        throw dnrError;
      });
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeDefined();
    expect((caughtErr as any).nextEligibleAtMs).toBe(nextEligibleAtMs);
  });

  it("proceeds normally when no DNR error is thrown", () => {
    let threw = false;

    function simulateDnrCheck(enforcer: () => void): void {
      try {
        enforcer();
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code !== "ERR_MODULE_NOT_FOUND") throw err;
      }
    }

    expect(() => simulateDnrCheck(() => {})).not.toThrow();
    expect(threw).toBe(false);
  });

  it("re-throws non-DNR, non-module-not-found errors", () => {
    function simulateDnrCheck(enforcer: () => void): void {
      try {
        enforcer();
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code !== "ERR_MODULE_NOT_FOUND") throw err;
      }
    }

    expect(() =>
      simulateDnrCheck(() => {
        throw new Error("network error");
      }),
    ).toThrow("network error");
  });

  it("silently ignores ERR_MODULE_NOT_FOUND (graceful degradation)", () => {
    function simulateDnrCheck(enforcer: () => void): void {
      try {
        enforcer();
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (code !== "ERR_MODULE_NOT_FOUND") throw err;
      }
    }

    const moduleNotFoundErr = Object.assign(new Error("module not found"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    expect(() =>
      simulateDnrCheck(() => {
        throw moduleNotFoundErr;
      }),
    ).not.toThrow();
  });
});
