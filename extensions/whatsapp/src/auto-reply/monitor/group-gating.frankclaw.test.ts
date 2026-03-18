import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("../../../../../src/config/group-policy.js", () => ({
  resolveChannelGroupGateMode: vi.fn(({ groupId }: { groupId: string }) => {
    // Simulate channel-policy lookup
    const policies: Record<string, any> = {
      "known-blocked@g.us": { gateMode: "blocked", allowedSenders: [] },
      "known-open@g.us": { gateMode: "open", allowedSenders: [] },
      "known-mention@g.us": { gateMode: "mention", allowedSenders: [] },
    };
    // Unknown groups return gateMode undefined (defaults to blocked in resolveGateMode)
    return policies[groupId] ?? { gateMode: undefined, allowedSenders: [] };
  }),
}));

const notifyBlockedCalls: any[] = [];
vi.mock("../../../../../src/channels/gate-notify.js", () => ({
  notifyBlocked: vi.fn((params: any) => {
    notifyBlockedCalls.push(params);
  }),
}));

vi.mock("../../../../../src/channels/mention-gating.js", async () => {
  const actual = await vi.importActual<any>("../../../../../src/channels/gate-mode.frankclaw.js");
  return { resolveGateMode: actual.resolveGateMode };
});

vi.mock("./roaming-seen.js", () => ({
  maybeMarkWhatsAppRoamingSeen: vi.fn(),
}));

vi.mock("./group-members.js", () => ({
  formatGroupMembers: vi.fn(() => "member1, member2"),
}));

import { resolveWebGroupGateModeCheck } from "./group-gating.frankclaw.js";

function makeParams(conversationId: string, overrides: Partial<any> = {}): any {
  return {
    cfg: {
      agents: { defaults: { mentionKeywords: ["doraemon", "doreamon"] } },
      channels: { whatsapp: { allowFrom: ["+16478023321"] } },
    },
    channel: "whatsapp",
    conversationId,
    msg: {
      body: overrides.body ?? "Hi",
      senderE164: overrides.senderE164 ?? "+14165551234",
      senderJid: overrides.senderJid ?? "14165551234@s.whatsapp.net",
      senderName: overrides.senderName ?? "Test User",
      groupSubject: overrides.groupSubject ?? "Test Group",
      groupParticipants: [],
      wasMentioned: overrides.wasMentioned ?? false,
    },
    groupHistoryKey: conversationId,
    groupMemberNames: new Map(),
    logVerbose: vi.fn(),
    verbose: false,
    accountId: "default",
    recordHistory: vi.fn(),
  };
}

describe("resolveWebGroupGateModeCheck (frankclaw)", () => {
  beforeEach(() => {
    notifyBlockedCalls.length = 0;
  });

  describe("unknown groups (not in channel-policy)", () => {
    it("drops messages from unknown groups", () => {
      const result = resolveWebGroupGateModeCheck(makeParams("unknown-group@g.us"));
      expect(result.shouldDrop).toBe(true);
      expect(result.approved).toBe(false);
    });

    it("fires notifyBlocked for unknown groups", () => {
      resolveWebGroupGateModeCheck(makeParams("unknown-group@g.us"));
      expect(notifyBlockedCalls.length).toBe(1);
      expect(notifyBlockedCalls[0].chatId).toBe("unknown-group@g.us");
      expect(notifyBlockedCalls[0].chatName).toBe("Test Group");
      expect(notifyBlockedCalls[0].platform).toBe("whatsapp");
    });

    it("includes sender info in notification for unknown groups", () => {
      resolveWebGroupGateModeCheck(
        makeParams("new-group@g.us", {
          senderName: "Alice",
          senderE164: "+14161234567",
          groupSubject: "New Family Chat",
          body: "Hello everyone!",
        }),
      );
      expect(notifyBlockedCalls.length).toBe(1);
      expect(notifyBlockedCalls[0].chatName).toBe("New Family Chat");
      expect(notifyBlockedCalls[0].preview).toBe("Hello everyone!");
    });
  });

  describe("explicitly blocked groups", () => {
    it("drops messages from blocked groups", () => {
      const result = resolveWebGroupGateModeCheck(makeParams("known-blocked@g.us"));
      expect(result.shouldDrop).toBe(true);
      expect(result.approved).toBe(false);
    });

    it("fires notifyBlocked for explicitly blocked groups", () => {
      resolveWebGroupGateModeCheck(makeParams("known-blocked@g.us"));
      expect(notifyBlockedCalls.length).toBe(1);
      expect(notifyBlockedCalls[0].chatId).toBe("known-blocked@g.us");
    });
  });

  describe("open groups", () => {
    it("approves messages from open groups", () => {
      const result = resolveWebGroupGateModeCheck(makeParams("known-open@g.us"));
      expect(result.approved).toBe(true);
      expect(result.shouldDrop).toBe(false);
      expect(result.effectiveMention).toBe(true);
    });

    it("does NOT fire notifyBlocked for open groups", () => {
      resolveWebGroupGateModeCheck(makeParams("known-open@g.us"));
      expect(notifyBlockedCalls.length).toBe(0);
    });
  });

  describe("mention-gated groups", () => {
    it("drops messages without mention", () => {
      const result = resolveWebGroupGateModeCheck(makeParams("known-mention@g.us"));
      expect(result.shouldDrop).toBe(true);
      expect(result.approved).toBe(false);
    });

    it("approves messages with mention", () => {
      const result = resolveWebGroupGateModeCheck(
        makeParams("known-mention@g.us", { wasMentioned: true }),
      );
      expect(result.approved).toBe(true);
      expect(result.effectiveMention).toBe(true);
    });

    it("approves messages with keyword mention", () => {
      const result = resolveWebGroupGateModeCheck(
        makeParams("known-mention@g.us", { body: "hey doraemon what's up" }),
      );
      expect(result.approved).toBe(true);
    });

    it("does NOT fire notifyBlocked for mention-gated groups (not unknown)", () => {
      resolveWebGroupGateModeCheck(makeParams("known-mention@g.us"));
      expect(notifyBlockedCalls.length).toBe(0);
    });
  });
});
