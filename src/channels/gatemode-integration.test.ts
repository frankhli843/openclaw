/**
 * Integration tests for gateMode wiring correctness.
 *
 * These verify that:
 * 1. When gateMode returns "process", the legacy requireMention gate is skipped (no double-gate).
 * 2. When gateMode is NOT configured, legacy requireMention still works (no regression).
 * 3. Each tier (blocked, silent, frank-only, allowlist, open) produces the right action.
 * 4. allowFrom is correctly resolved per-channel.
 * 5. mentionKeywords trigger correctly in frank-only and allowlist modes.
 */

import { describe, expect, it } from "vitest";
import {
  resolveGateMode,
  resolveMentionGating,
  resolveMentionGatingWithBypass,
  type GateModeParams,
} from "./mention-gating.js";

const OWNER = "owner123";
const OTHER = "other456";
const ALLOWED = "allowed789";
const KEYWORDS = ["doraemon", "dora"];

function gateParams(overrides: Partial<GateModeParams> = {}): GateModeParams {
  return {
    gateMode: undefined,
    senderId: OTHER,
    allowFrom: [OWNER],
    allowedSenders: [],
    wasMentioned: false,
    messageText: "hello",
    mentionKeywords: KEYWORDS,
    ...overrides,
  };
}

describe("gateMode integration: double-gate prevention", () => {
  /**
   * Simulates the pattern used in Discord/Telegram handlers:
   * 1. Run resolveGateMode (if gateMode is configured)
   * 2. If action === "process", set gateModeApproved = true
   * 3. If gateModeApproved, skip resolveMentionGatingWithBypass
   * 4. If NOT gateModeApproved, run legacy gate
   *
   * This is the FIXED pattern — the bug was that step 3 was missing.
   */
  function simulateHandlerPipeline(params: {
    gateMode: GateModeParams["gateMode"];
    senderId: string;
    allowFrom: string[];
    allowedSenders: string[];
    wasMentioned: boolean;
    messageText: string;
    mentionKeywords: string[];
    // Legacy gate params
    requireMention: boolean;
    canDetectMention: boolean;
    implicitMention: boolean;
  }): { processed: boolean; effectiveWasMentioned: boolean } {
    let gateModeApproved = false;
    let gateModeEffectiveMention = false;

    // Step 1: gateMode check (only if configured)
    if (params.gateMode) {
      const gateResult = resolveGateMode({
        gateMode: params.gateMode,
        senderId: params.senderId,
        allowFrom: params.allowFrom,
        allowedSenders: params.allowedSenders,
        wasMentioned: params.wasMentioned,
        messageText: params.messageText,
        mentionKeywords: params.mentionKeywords,
      });

      if (gateResult.action === "skip") {
        return { processed: false, effectiveWasMentioned: false };
      }
      if (gateResult.action === "silent") {
        return { processed: false, effectiveWasMentioned: false };
      }
      // action === "process"
      gateModeApproved = true;
      gateModeEffectiveMention = gateResult.effectiveWasMentioned;
    }

    // Step 2: legacy mention gate (SKIPPED when gateModeApproved)
    if (gateModeApproved) {
      return { processed: true, effectiveWasMentioned: gateModeEffectiveMention };
    }

    const mentionGate = resolveMentionGating({
      requireMention: params.requireMention,
      canDetectMention: params.canDetectMention,
      wasMentioned: params.wasMentioned,
      implicitMention: params.implicitMention,
    });

    if (params.requireMention && params.canDetectMention && mentionGate.shouldSkip) {
      return { processed: false, effectiveWasMentioned: false };
    }

    return { processed: true, effectiveWasMentioned: mentionGate.effectiveWasMentioned };
  }

  it("open gateMode processes even when legacy requireMention=true and wasMentioned=false", () => {
    // This was the double-gate bug: gateMode said "process" but legacy gate dropped it
    const result = simulateHandlerPipeline({
      gateMode: "open",
      senderId: OTHER,
      allowFrom: [OWNER],
      allowedSenders: [],
      wasMentioned: false,
      messageText: "hello world",
      mentionKeywords: KEYWORDS,
      requireMention: true,
      canDetectMention: true,
      implicitMention: false,
    });
    expect(result.processed).toBe(true);
    expect(result.effectiveWasMentioned).toBe(true);
  });

  it("frank-only gateMode processes when owner uses keyword, even with requireMention=true", () => {
    const result = simulateHandlerPipeline({
      gateMode: "frank-only",
      senderId: OWNER,
      allowFrom: [OWNER],
      allowedSenders: [],
      wasMentioned: false,
      messageText: "doraemon help me",
      mentionKeywords: KEYWORDS,
      requireMention: true,
      canDetectMention: true,
      implicitMention: false,
    });
    expect(result.processed).toBe(true);
    expect(result.effectiveWasMentioned).toBe(true);
  });

  it("allowlist gateMode processes when allowed sender uses keyword, even with requireMention=true", () => {
    const result = simulateHandlerPipeline({
      gateMode: "allowlist",
      senderId: ALLOWED,
      allowFrom: [OWNER],
      allowedSenders: [ALLOWED],
      wasMentioned: false,
      messageText: "hey dora",
      mentionKeywords: KEYWORDS,
      requireMention: true,
      canDetectMention: true,
      implicitMention: false,
    });
    expect(result.processed).toBe(true);
  });

  it("blocked gateMode skips regardless of legacy settings", () => {
    const result = simulateHandlerPipeline({
      gateMode: "blocked",
      senderId: OWNER,
      allowFrom: [OWNER],
      allowedSenders: [],
      wasMentioned: true,
      messageText: "doraemon",
      mentionKeywords: KEYWORDS,
      requireMention: false,
      canDetectMention: true,
      implicitMention: false,
    });
    expect(result.processed).toBe(false);
  });

  it("silent gateMode skips regardless of legacy settings", () => {
    const result = simulateHandlerPipeline({
      gateMode: "silent",
      senderId: OWNER,
      allowFrom: [OWNER],
      allowedSenders: [],
      wasMentioned: true,
      messageText: "doraemon",
      mentionKeywords: KEYWORDS,
      requireMention: false,
      canDetectMention: true,
      implicitMention: false,
    });
    expect(result.processed).toBe(false);
  });
});

describe("gateMode integration: legacy fallback when gateMode is undefined", () => {
  it("falls through to legacy requireMention=true (drops non-mentioned messages)", () => {
    // When gateMode is undefined, the handler should NOT enter the gateMode path at all.
    // The legacy gate should handle it.
    const mentionGate = resolveMentionGating({
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: false,
    });
    expect(mentionGate.shouldSkip).toBe(true);
  });

  it("falls through to legacy requireMention=false (processes all messages)", () => {
    const mentionGate = resolveMentionGating({
      requireMention: false,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: false,
    });
    expect(mentionGate.shouldSkip).toBe(false);
  });

  it("falls through to legacy with implicit mention (reply to bot)", () => {
    const mentionGate = resolveMentionGating({
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: true,
    });
    expect(mentionGate.shouldSkip).toBe(false);
    expect(mentionGate.effectiveWasMentioned).toBe(true);
  });
});

describe("gateMode: allowFrom resolution edge cases", () => {
  it("frank-only with empty allowFrom skips ALL senders", () => {
    const res = resolveGateMode(
      gateParams({
        gateMode: "frank-only",
        senderId: OWNER,
        allowFrom: [],
        wasMentioned: true,
      }),
    );
    expect(res.action).toBe("skip");
  });

  it("allowlist with empty allowedSenders but owner in allowFrom still works for owner", () => {
    const res = resolveGateMode(
      gateParams({
        gateMode: "allowlist",
        senderId: OWNER,
        allowFrom: [OWNER],
        allowedSenders: [],
        wasMentioned: true,
      }),
    );
    expect(res.action).toBe("process");
  });

  it("allowlist with empty allowFrom AND empty allowedSenders skips everyone", () => {
    const res = resolveGateMode(
      gateParams({
        gateMode: "allowlist",
        senderId: OTHER,
        allowFrom: [],
        allowedSenders: [],
        wasMentioned: true,
      }),
    );
    expect(res.action).toBe("skip");
  });
});

describe("gateMode: Telegram vanilla constraint", () => {
  /**
   * Telegram is a "vanilla lifeline" channel per AGENTS.md.
   * The gateMode wiring in Telegram must be minimal and not break
   * the existing requireMention behavior when gateMode is not configured.
   *
   * These tests verify the Telegram-specific pattern:
   * - When gateMode is configured for a Telegram group, it takes priority
   * - When gateMode is NOT configured, legacy requireMention runs unchanged
   * - The gateMode check doesn't interfere with Telegram's existing features
   */

  it("Telegram legacy path: requireMention=true + wasMentioned=true → processes", () => {
    // Simulate: no gateMode configured, Telegram group with requireMention=true
    const mentionGate = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention: true,
      canDetectMention: true,
      wasMentioned: true,
      implicitMention: false,
      hasAnyMention: true,
      allowTextCommands: true,
      hasControlCommand: false,
      commandAuthorized: false,
    });
    expect(mentionGate.shouldSkip).toBe(false);
    expect(mentionGate.effectiveWasMentioned).toBe(true);
  });

  it("Telegram legacy path: requireMention=true + wasMentioned=false → skips", () => {
    const mentionGate = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: false,
      hasAnyMention: false,
      allowTextCommands: true,
      hasControlCommand: false,
      commandAuthorized: false,
    });
    expect(mentionGate.shouldSkip).toBe(true);
  });

  it("Telegram with gateMode=open skips legacy gate entirely", () => {
    // Simulate the fixed Telegram handler: gateMode returns "process",
    // so we use the gateMode result directly
    const gateResult = resolveGateMode(
      gateParams({
        gateMode: "open",
        senderId: OTHER,
      }),
    );
    expect(gateResult.action).toBe("process");
    expect(gateResult.effectiveWasMentioned).toBe(true);

    // In the handler, when gateMode approves, legacy gate is not run.
    // effectiveWasMentioned comes from gateMode, not from legacy.
  });

  it("Telegram with gateMode=blocked skips before legacy gate", () => {
    const gateResult = resolveGateMode(
      gateParams({
        gateMode: "blocked",
        senderId: OTHER,
        wasMentioned: true,
      }),
    );
    expect(gateResult.action).toBe("skip");
    // Message never reaches legacy gate
  });
});
