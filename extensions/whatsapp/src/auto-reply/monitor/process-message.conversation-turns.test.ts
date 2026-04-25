/**
 * Integration test: verifies that conversation turns recorded by
 * conversation-turns.frankclaw.ts are injected into the combinedBody
 * that processMessage passes to buildWhatsAppInboundContext.
 *
 * This uses the same mock scaffolding as process-message.test.ts but
 * does NOT mock conversation-turns.frankclaw.ts, so the real module runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePolicyMock, buildContextMock } = vi.hoisted(() => ({
  resolvePolicyMock: vi.fn(),
  buildContextMock: vi.fn(),
}));

vi.mock("../../inbound-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../inbound-policy.js")>();
  return {
    ...actual,
    resolveWhatsAppCommandAuthorized: async () => true,
    resolveWhatsAppInboundPolicy: resolvePolicyMock,
  };
});

vi.mock("./inbound-dispatch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inbound-dispatch.js")>();
  return {
    ...actual,
    buildWhatsAppInboundContext: buildContextMock,
    dispatchWhatsAppBufferedReply: async () => ({
      queuedFinal: false,
      counts: { tool: 0, block: 0, final: 0 },
    }),
    resolveWhatsAppDmRouteTarget: () => null,
    resolveWhatsAppResponsePrefix: () => undefined,
    updateWhatsAppMainLastRoute: () => {},
  };
});

vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: () => false,
    runMessageReceived: async () => undefined,
  }),
}));

vi.mock("../../identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../identity.js")>();
  return {
    ...actual,
    getPrimaryIdentityId: () => null,
    getSelfIdentity: () => ({ e164: "+15550001111" }),
    getSenderIdentity: () => ({ name: "Alice", e164: "+15550002222" }),
  };
});

vi.mock("../../reconnect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../reconnect.js")>();
  return { ...actual, newConnectionId: () => "test-conn-id" };
});

vi.mock("../../session.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../session.js")>();
  return { ...actual, formatError: (e: unknown) => String(e) };
});

vi.mock("../deliver-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deliver-reply.js")>();
  return { ...actual, deliverWebReply: async () => {} };
});

vi.mock("../loggers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../loggers.js")>();
  return {
    ...actual,
    whatsappInboundLog: { info: () => {}, debug: () => {} },
  };
});

vi.mock("./ack-reaction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ack-reaction.js")>();
  return { ...actual, maybeSendAckReaction: async () => {} };
});

vi.mock("./inbound-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inbound-context.js")>();
  return {
    ...actual,
    resolveVisibleWhatsAppGroupHistory: () => [],
    resolveVisibleWhatsAppReplyContext: () => null,
  };
});

vi.mock("./last-route.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./last-route.js")>();
  return {
    ...actual,
    trackBackgroundTask: () => {},
    updateLastRouteInBackground: () => {},
  };
});

vi.mock("./message-line.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./message-line.js")>();
  return { ...actual, buildInboundLine: () => "hi" };
});

vi.mock("./runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime-api.js")>();
  return {
    ...actual,
    buildHistoryContextFromEntries: () => "hi",
    createChannelReplyPipeline: () => ({ onModelSelected: () => {}, responsePrefix: undefined }),
    formatInboundEnvelope: () => "hi",
    logVerbose: () => {},
    normalizeE164: (v: string) => v,
    recordSessionMetaFromInbound: async () => {},
    resolveChannelContextVisibilityMode: () => "off",
    resolveInboundSessionEnvelopeContext: () => ({
      storePath: "/tmp",
      envelopeOptions: {},
      previousTimestamp: undefined,
    }),
    resolvePinnedMainDmOwnerFromAllowlist: () => null,
    shouldComputeCommandAuthorized: () => false,
    shouldLogVerbose: () => false,
  };
});

import {
  CONVERSATION_TURNS_MARKER,
  CONVERSATION_TURNS_END_MARKER,
  recordConversationTurn,
  __clearAllConversationTurns,
} from "./conversation-turns.frankclaw.js";
// NOTE: conversation-turns.frankclaw.ts is NOT mocked - the real module runs.
import { processMessage } from "./process-message.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(groups: Record<string, { systemPrompt?: string }> = {}): {
  accountId: string;
  authDir: string;
  groups: Record<string, { systemPrompt?: string }>;
} {
  return { accountId: "default", authDir: "/tmp/wa-test-auth", groups };
}

function makePolicy(account: ReturnType<typeof makeAccount>) {
  return {
    account,
    dmPolicy: "pairing",
    groupPolicy: "allowlist",
    configuredAllowFrom: [],
    dmAllowFrom: [],
    groupAllowFrom: [],
    isSelfChat: false,
    providerMissingFallbackApplied: false,
    shouldReadStorePairingApprovals: true,
    isSamePhone: () => false,
    isDmSenderAllowed: () => false,
    isGroupSenderAllowed: () => false,
    resolveConversationGroupPolicy: () => "allowlist",
    resolveConversationRequireMention: () => false,
  };
}

const GROUP_JID = "120363405743307729@g.us";
const GROUP_HISTORY_KEY = `whatsapp:default:group:${GROUP_JID}`;

const baseMsg = {
  id: "msg1",
  from: GROUP_JID,
  to: "+15550001111",
  conversationId: GROUP_JID,
  accountId: "default",
  chatId: GROUP_JID,
  chatType: "group" as const,
  body: "Nope just this one",
  sendComposing: async () => {},
  reply: async () => {},
  sendMedia: async () => {},
};

const baseRoute = {
  agentId: "main",
  channel: "whatsapp",
  accountId: "default",
  sessionKey: `agent:main:whatsapp:group:${GROUP_JID}`,
  mainSessionKey: `agent:main:whatsapp:group:${GROUP_JID}`,
  lastRoutePolicy: "main",
  matchedBy: "default",
};

function callProcessMessage(overrides: { body?: string } = {}) {
  const msg = { ...baseMsg };
  if (overrides.body !== undefined) {
    msg.body = overrides.body;
  }
  return processMessage({
    cfg: {} as never,
    msg: msg as never,
    route: baseRoute as never,
    groupHistoryKey: GROUP_HISTORY_KEY,
    groupHistories: new Map(),
    groupMemberNames: new Map(),
    connectionId: "conn-1",
    verbose: false,
    maxMediaBytes: 1024,
    replyResolver: (async () => undefined) as never,
    replyLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never,
    backgroundTasks: new Set(),
    rememberSentText: () => {},
    echoHas: () => false,
    echoForget: () => {},
    buildCombinedEchoKey: ({ sessionKey }) => sessionKey,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processMessage conversation turns integration", () => {
  beforeEach(() => {
    buildContextMock.mockReset();
    resolvePolicyMock.mockReset();
    __clearAllConversationTurns();

    resolvePolicyMock.mockReturnValue(makePolicy(makeAccount()));
    buildContextMock.mockImplementation((params: { combinedBody?: string }) => ({
      Body: params.combinedBody ?? "",
    }));
  });

  afterEach(() => {
    __clearAllConversationTurns();
  });

  it("includes prior conversation turns in combinedBody when turns exist", async () => {
    // Simulate a prior exchange: user asked about recipes, bot replied
    recordConversationTurn({
      chatKey: GROUP_HISTORY_KEY,
      userMessage: "Show me the recipe for lasagna",
      botReply: "Here are 3 Italian recipes: lasagna, carbonara, and risotto. Want details?",
      timestamp: Date.now() - 60_000,
      senderLabel: "Frank",
    });

    await callProcessMessage({ body: "Nope just this one" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    const passedCombinedBody = buildContextMock.mock.calls[0][0].combinedBody as string;

    // The combined body should contain the conversation turns markers
    expect(passedCombinedBody).toContain(CONVERSATION_TURNS_MARKER);
    expect(passedCombinedBody).toContain(CONVERSATION_TURNS_END_MARKER);

    // The prior user message and bot reply should be in the context
    expect(passedCombinedBody).toContain("Frank: Show me the recipe for lasagna");
    expect(passedCombinedBody).toContain("Assistant: Here are 3 Italian recipes");

    // The current message (via buildInboundLine mock → "hi") should also be present
    expect(passedCombinedBody).toContain("hi");

    // Turns context should come BEFORE the current message body
    const turnsIdx = passedCombinedBody.indexOf(CONVERSATION_TURNS_MARKER);
    const currentMsgIdx = passedCombinedBody.lastIndexOf("hi");
    expect(turnsIdx).toBeLessThan(currentMsgIdx);
  });

  it("does not include turns context when no prior turns exist", async () => {
    await callProcessMessage({ body: "Hello there" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    const passedCombinedBody = buildContextMock.mock.calls[0][0].combinedBody as string;

    expect(passedCombinedBody).not.toContain(CONVERSATION_TURNS_MARKER);
    expect(passedCombinedBody).not.toContain(CONVERSATION_TURNS_END_MARKER);
  });

  it("includes multiple turns in chronological order", async () => {
    recordConversationTurn({
      chatKey: GROUP_HISTORY_KEY,
      userMessage: "What time is the meeting?",
      botReply: "The meeting is at 3 PM.",
      timestamp: Date.now() - 120_000,
      senderLabel: "Frank",
    });
    recordConversationTurn({
      chatKey: GROUP_HISTORY_KEY,
      userMessage: "Can you send me a reminder?",
      botReply: "Sure, I'll remind you 15 minutes before.",
      timestamp: Date.now() - 60_000,
      senderLabel: "Frank",
    });

    await callProcessMessage({ body: "Thanks" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    const passedCombinedBody = buildContextMock.mock.calls[0][0].combinedBody as string;

    // Both turns should be present
    expect(passedCombinedBody).toContain("What time is the meeting?");
    expect(passedCombinedBody).toContain("The meeting is at 3 PM.");
    expect(passedCombinedBody).toContain("Can you send me a reminder?");
    expect(passedCombinedBody).toContain("I'll remind you 15 minutes before.");

    // First turn should appear before second turn
    const firstTurnIdx = passedCombinedBody.indexOf("What time is the meeting?");
    const secondTurnIdx = passedCombinedBody.indexOf("Can you send me a reminder?");
    expect(firstTurnIdx).toBeLessThan(secondTurnIdx);
  });

  it("does not include turns from a different chat", async () => {
    recordConversationTurn({
      chatKey: "whatsapp:default:group:other-group@g.us",
      userMessage: "Message for other group",
      botReply: "Reply for other group",
      timestamp: Date.now() - 60_000,
    });

    await callProcessMessage({ body: "Hello" });

    const passedCombinedBody = buildContextMock.mock.calls[0][0].combinedBody as string;
    expect(passedCombinedBody).not.toContain("Message for other group");
    expect(passedCombinedBody).not.toContain(CONVERSATION_TURNS_MARKER);
  });
});
