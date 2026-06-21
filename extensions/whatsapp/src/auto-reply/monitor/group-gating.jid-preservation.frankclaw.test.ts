/**
 * Regression tests for WhatsApp group JID preservation through applyGroupGating.
 *
 * Bug: upstream PR #93787 (nightly merge Jun 17 2026) removed conversationId from
 * ApplyGroupGatingParams and extracted it from admission.conversation.id. The frankclaw
 * gateMode block was not updated and kept using params.conversationId (undefined at
 * runtime). This caused resolveChannelGroupGateMode to receive groupId=undefined,
 * missing all per-group config and always hitting the wildcard "blocked" default.
 * Symptom: gate-notify alerts showed Chat: "Canada Family" (undefined) and
 * gate-control showed "set undefined to <mode>".
 *
 * Fix: replace params.conversationId → conversationId (local variable) at 4 sites.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveChannelGroupGateModeMock = vi.fn();
const resolveWebGroupGateModeCheckMock = vi.fn();

vi.mock("../../../../../src/config/group-policy.js", () => ({
  resolveChannelGroupGateMode: (args: unknown) => resolveChannelGroupGateModeMock(args),
}));

// inbound-policy uses resolveChannelGroupPolicy from the plugin SDK for allowlist checks.
// Return allowlistEnabled:false so groupPolicy:"open" semantics pass through in tests.
vi.mock("openclaw/plugin-sdk/channel-policy", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveChannelGroupPolicy: vi.fn(() => ({ allowlistEnabled: false, allowed: true })),
    resolveChannelGroupRequireMention: vi.fn(() => false),
  };
});

vi.mock("./group-gating.frankclaw.js", () => ({
  resolveWebGroupGateModeCheck: (args: unknown) => resolveWebGroupGateModeCheckMock(args),
}));

vi.mock("./group-activation.js", () => ({
  resolveGroupActivationFor: vi.fn(async () => "mention"),
}));

vi.mock("./group-members.js", () => ({
  noteGroupMember: vi.fn(),
}));

import { createTestWebInboundMessage } from "../../inbound/test-message.test-helper.js";
import type { AdmittedWebInboundMessage } from "../../inbound/types.js";
import type { MentionConfig } from "../mentions.js";
import { applyGroupGating, type GroupHistoryEntry } from "./group-gating.js";

const CANADA_FAMILY_JID = "120363396955454814@g.us";
const LID_SENDER = "12345678901234567@lid";

function makeGroupMsgWithAdmission(
  groupJid: string,
  senderJid: string = "14165551234@s.whatsapp.net",
): AdmittedWebInboundMessage {
  return createTestWebInboundMessage({
    event: {
      id: "msg-test-123",
      timestamp: 1750000000,
    },
    payload: {
      body: "hello from group",
    },
    platform: {
      chatJid: groupJid,
      recipientJid: "15550000001@s.whatsapp.net",
      sender: {
        jid: senderJid,
        name: "Test Member",
      },
      senderJid,
    },
    admission: {
      accountId: "default",
      conversation: {
        kind: "group",
        id: groupJid,
      },
      sender: {
        id: senderJid,
      },
      senderAccess: {
        reasonCode: "group_policy_allowed",
      },
    },
  });
}

function makeGatingParams(
  msg: AdmittedWebInboundMessage,
  cfg: ApplyGroupGatingParams["cfg"] = BASE_CFG,
): ApplyGroupGatingParams {
  return {
    cfg,
    msg,
    groupHistoryKey: `whatsapp:group:${msg.admission?.conversation.id ?? "unknown"}`,
    agentId: "main",
    sessionKey: `agent:main:whatsapp:group:${msg.admission?.conversation.id ?? "unknown"}`,
    baseMentionConfig: { mentionRegexes: [/\bdoraemon\b/i] } satisfies MentionConfig,
    groupHistories: new Map<string, GroupHistoryEntry[]>(),
    groupHistoryLimit: 20,
    groupMemberNames: new Map<string, Map<string, string>>(),
    logVerbose: vi.fn(),
    replyLogger: { debug: vi.fn(), warn: vi.fn() },
    channel: "whatsapp",
    accountId: "default",
  };
}

type ApplyGroupGatingParams = Parameters<typeof applyGroupGating>[0];

const BASE_CFG: ApplyGroupGatingParams["cfg"] = {
  channels: {
    whatsapp: {
      groupPolicy: "open",
      groups: {
        "*": { gateMode: "blocked" },
        [CANADA_FAMILY_JID]: { gateMode: "mention" },
      },
    },
  },
  messages: {
    groupChat: {
      mentionPatterns: ["\\bdoraemon\\b"],
    },
  },
} as never;

describe("applyGroupGating: group JID preservation (LID regression)", () => {
  beforeEach(() => {
    resolveChannelGroupGateModeMock.mockReset();
    resolveWebGroupGateModeCheckMock.mockReset();

    // Default: return gateMode=undefined so we can verify the groupId received
    resolveChannelGroupGateModeMock.mockImplementation(() => ({
      gateMode: undefined,
      allowedSenders: [],
    }));
    resolveWebGroupGateModeCheckMock.mockReturnValue({
      approved: false,
      effectiveMention: false,
      shouldDrop: true,
    });
  });

  it("passes the real group JID from admission.conversation.id to resolveChannelGroupGateMode", async () => {
    const msg = makeGroupMsgWithAdmission(CANADA_FAMILY_JID);
    await applyGroupGating(makeGatingParams(msg));

    expect(resolveChannelGroupGateModeMock).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: CANADA_FAMILY_JID }),
    );
  });

  it("passes the real group JID to resolveWebGroupGateModeCheck when gateMode is resolved", async () => {
    resolveChannelGroupGateModeMock.mockImplementation(({ groupId }: { groupId: string }) => {
      if (groupId === CANADA_FAMILY_JID) {
        return { gateMode: "mention", allowedSenders: [] };
      }
      return { gateMode: "blocked", allowedSenders: [] };
    });

    const msg = makeGroupMsgWithAdmission(CANADA_FAMILY_JID);
    await applyGroupGating(makeGatingParams(msg));

    expect(resolveWebGroupGateModeCheckMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CANADA_FAMILY_JID }),
    );
  });

  it("does NOT pass undefined as groupId even when sender uses LID metadata", async () => {
    const msg = makeGroupMsgWithAdmission(CANADA_FAMILY_JID, LID_SENDER);
    await applyGroupGating(makeGatingParams(msg));

    const callArgs = resolveChannelGroupGateModeMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.groupId).toBe(CANADA_FAMILY_JID);
    expect(callArgs.groupId).not.toBeUndefined();
  });

  it("resolves the configured mention gateMode for Canada Family (not wildcard blocked)", async () => {
    resolveChannelGroupGateModeMock.mockImplementation(({ groupId }: { groupId: string }) => {
      if (groupId === CANADA_FAMILY_JID) {
        return { gateMode: "mention", allowedSenders: [] };
      }
      // wildcard fallback
      return { gateMode: "blocked", allowedSenders: [] };
    });
    resolveWebGroupGateModeCheckMock.mockReturnValue({
      approved: true,
      effectiveMention: true,
      shouldDrop: false,
    });

    const msg = makeGroupMsgWithAdmission(CANADA_FAMILY_JID, LID_SENDER);
    const result = await applyGroupGating(makeGatingParams(msg));

    // With the bug, groupId=undefined → wildcard blocked → shouldDrop:true
    // After fix, groupId=CANADA_FAMILY_JID → mention gate → approved:true
    expect(result).toMatchObject({ shouldProcess: true });
  });

  it("does NOT call resolveWebGroupGateModeCheck with conversationId=undefined", async () => {
    resolveChannelGroupGateModeMock.mockReturnValue({
      gateMode: "open",
      allowedSenders: [],
    });
    resolveWebGroupGateModeCheckMock.mockReturnValue({
      approved: true,
      effectiveMention: true,
      shouldDrop: false,
    });

    const msg = makeGroupMsgWithAdmission(CANADA_FAMILY_JID);
    await applyGroupGating(makeGatingParams(msg));

    for (const [callArg] of resolveWebGroupGateModeCheckMock.mock.calls) {
      expect((callArg as { conversationId?: unknown }).conversationId).not.toBeUndefined();
    }
  });
});
