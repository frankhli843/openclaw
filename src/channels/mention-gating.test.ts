import { describe, expect, it } from "vitest";
import {
  resolveMentionGating,
  resolveMentionGatingWithBypass,
  resolveGateMode,
  type GateMode,
} from "./mention-gating.js";

describe("resolveMentionGating", () => {
  it("combines explicit, implicit, and bypass mentions", () => {
    const res = resolveMentionGating({
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: true,
      shouldBypassMention: false,
    });
    expect(res.effectiveWasMentioned).toBe(true);
    expect(res.shouldSkip).toBe(false);
  });

  it("skips when mention required and none detected", () => {
    const res = resolveMentionGating({
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      implicitMention: false,
      shouldBypassMention: false,
    });
    expect(res.effectiveWasMentioned).toBe(false);
    expect(res.shouldSkip).toBe(true);
  });

  it("does not skip when mention detection is unavailable", () => {
    const res = resolveMentionGating({
      requireMention: true,
      canDetectMention: false,
      wasMentioned: false,
    });
    expect(res.shouldSkip).toBe(false);
  });
});

describe("resolveMentionGatingWithBypass", () => {
  it("enables bypass when control commands are authorized", () => {
    const res = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      hasAnyMention: false,
      allowTextCommands: true,
      hasControlCommand: true,
      commandAuthorized: true,
    });
    expect(res.shouldBypassMention).toBe(true);
    expect(res.shouldSkip).toBe(false);
  });

  it("does not bypass when control commands are not authorized", () => {
    const res = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention: true,
      canDetectMention: true,
      wasMentioned: false,
      hasAnyMention: false,
      allowTextCommands: true,
      hasControlCommand: true,
      commandAuthorized: false,
    });
    expect(res.shouldBypassMention).toBe(false);
    expect(res.shouldSkip).toBe(true);
  });
});

describe("resolveGateMode", () => {
  const owner = "+16478023321";
  const other = "+14165551234";
  const allowlisted = "+19995551234";
  const keywords = ["doraemon", "dora"];

  function makeParams(overrides: Partial<Parameters<typeof resolveGateMode>[0]> = {}) {
    return {
      gateMode: undefined as unknown as GateMode | undefined,
      senderId: other,
      allowFrom: [owner],
      allowedSenders: [],
      wasMentioned: false,
      messageText: "hello world",
      mentionKeywords: keywords,
      ...overrides,
    };
  }

  describe("blocked tier", () => {
    it("returns skip for blocked mode", () => {
      const res = resolveGateMode(makeParams({ gateMode: "blocked" }));
      expect(res.action).toBe("skip");
      expect(res.effectiveWasMentioned).toBe(false);
    });

    it("returns skip when gateMode is undefined (default blocked)", () => {
      const res = resolveGateMode(makeParams({ gateMode: undefined }));
      expect(res.action).toBe("skip");
    });
  });

  describe("silent tier", () => {
    it("returns silent action regardless of sender or mention", () => {
      const res = resolveGateMode(makeParams({ gateMode: "silent" }));
      expect(res.action).toBe("silent");
      expect(res.effectiveWasMentioned).toBe(false);
    });
  });

  describe("open tier", () => {
    it("always processes messages", () => {
      const res = resolveGateMode(makeParams({ gateMode: "open" }));
      expect(res.action).toBe("process");
      expect(res.effectiveWasMentioned).toBe(true);
    });

    it("processes even without mention or keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "open",
          wasMentioned: false,
          messageText: "no keywords here",
        }),
      );
      expect(res.action).toBe("process");
    });
  });

  describe("frank-only tier", () => {
    it("processes when owner mentions bot", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          wasMentioned: true,
        }),
      );
      expect(res.action).toBe("process");
      expect(res.effectiveWasMentioned).toBe(true);
    });

    it("processes when owner uses keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "hey doraemon can you help?",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("skips when owner sends message without mention or keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "just chatting",
        }),
      );
      expect(res.action).toBe("skip");
    });

    it("skips when non-owner sends message even with keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: other,
          messageText: "hey doraemon help",
        }),
      );
      expect(res.action).toBe("skip");
    });

    it("skips when non-owner mentions bot", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: other,
          wasMentioned: true,
        }),
      );
      expect(res.action).toBe("skip");
    });
  });

  describe("allowlist tier", () => {
    it("processes when owner uses keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "allowlist",
          senderId: owner,
          messageText: "dora help me",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("processes when allowlisted user mentions bot", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "allowlist",
          senderId: allowlisted,
          allowedSenders: [allowlisted],
          wasMentioned: true,
        }),
      );
      expect(res.action).toBe("process");
    });

    it("processes when allowlisted user uses keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "allowlist",
          senderId: allowlisted,
          allowedSenders: [allowlisted],
          messageText: "doraemon please summarize",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("skips when allowlisted user sends no keyword or mention", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "allowlist",
          senderId: allowlisted,
          allowedSenders: [allowlisted],
          messageText: "just a normal message",
        }),
      );
      expect(res.action).toBe("skip");
    });

    it("skips when non-allowlisted user sends keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "allowlist",
          senderId: other,
          allowedSenders: [],
          messageText: "doraemon help",
        }),
      );
      expect(res.action).toBe("skip");
    });
  });

  describe("mention tier", () => {
    it("processes when anyone mentions bot", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "mention",
          senderId: other,
          wasMentioned: true,
        }),
      );
      expect(res.action).toBe("process");
      expect(res.effectiveWasMentioned).toBe(true);
    });

    it("processes when anyone uses keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "mention",
          senderId: other,
          messageText: "hey dora what time is it",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("skips when no mention or keyword", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "mention",
          senderId: other,
          messageText: "just chatting normally",
        }),
      );
      expect(res.action).toBe("skip");
    });

    it("processes for owner with keyword too", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "mention",
          senderId: owner,
          messageText: "doraemon check this",
        }),
      );
      expect(res.action).toBe("process");
    });
  });

  describe("keyword matching", () => {
    it("matches keyword case-insensitively", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "Hey DORAEMON what do you think?",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("matches keyword as whole word only", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "this is adorable", // contains 'dora' as substring but not whole word
        }),
      );
      // 'dora' is NOT a whole word in 'adorable'
      expect(res.action).toBe("skip");
    });

    it("matches short keyword as whole word", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "dora come here",
        }),
      );
      expect(res.action).toBe("process");
    });

    it("does not match when mentionKeywords is empty", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "doraemon help",
          mentionKeywords: [],
        }),
      );
      expect(res.action).toBe("skip");
    });

    it("handles regex special chars in keywords safely", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: "frank-only",
          senderId: owner,
          messageText: "hey bot.name please help",
          mentionKeywords: ["bot.name"],
        }),
      );
      expect(res.action).toBe("process");
    });
  });

  describe("legacy fallback (gateMode undefined)", () => {
    it("defaults to blocked when gateMode is not set", () => {
      const res = resolveGateMode(
        makeParams({
          gateMode: undefined,
          senderId: owner,
          wasMentioned: true,
        }),
      );
      expect(res.action).toBe("skip");
    });
  });
});
