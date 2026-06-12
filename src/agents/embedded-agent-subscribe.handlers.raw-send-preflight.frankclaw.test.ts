// Handler-level coverage for the frankclaw raw_send delivery-evidence path.
//
// Background (2026-06-12 Yiting Day-6 duplicate incident): raw_send was added to
// CORE_MESSAGING_TOOLS so a successful send commits delivery evidence and the
// cron orchestration loop does not re-fire on NO_REPLY. These tests pin down the
// EXACT commit behavior that feeds `didSendViaMessagingTool`:
//   1. A successful (non-preflight) raw_send commits delivery evidence.
//   2. The raw_send scoped-prompt PREFLIGHT result ({status:"preflight"}) does
//      NOT commit evidence — it is not a tool error, but it did not deliver.
//      Counting it as a send would mask a non-delivery (agent reads the scoped
//      prompt, declines to send, replies NO_REPLY) and defeat the loop's safety
//      net on a health-critical channel.
import { describe, expect, it, vi } from "vitest";
import { hasCommittedMessagingToolDeliveryEvidence } from "./embedded-agent-runner/delivery-evidence.js";
import {
  handleToolExecutionEnd,
  handleToolExecutionStart,
} from "./embedded-agent-subscribe.handlers.tools.js";
import type { EmbeddedAgentSubscribeContext } from "./embedded-agent-subscribe.handlers.types.js";

function createMockContext(): EmbeddedAgentSubscribeContext {
  return {
    params: {
      runId: "test-run",
      onToolResult: vi.fn(),
      onAgentEvent: vi.fn(),
    },
    state: {
      toolMetaById: new Map(),
      toolMetas: [],
      toolSummaryById: new Set(),
      itemActiveIds: new Set(),
      itemStartedCount: 0,
      itemCompletedCount: 0,
      pendingMessagingTexts: new Map(),
      pendingMessagingTargets: new Map(),
      pendingMessagingMediaUrls: new Map(),
      pendingToolMediaUrls: [],
      pendingToolAudioAsVoice: false,
      pendingToolTrustedLocalMedia: false,
      messagingToolSentTexts: [],
      messagingToolSentTextsNormalized: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      replayState: { replayInvalid: false, hadPotentialSideEffects: false },
      deterministicApprovalPromptPending: false,
      deterministicApprovalPromptSent: false,
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    shouldEmitToolResult: vi.fn(() => false),
    shouldEmitToolOutput: vi.fn(() => false),
    emitToolSummary: vi.fn(),
    emitToolOutput: vi.fn(),
    trimMessagingToolSent: vi.fn(),
    emitBlockReply: vi.fn(),
    hookRunner: undefined,
    blockChunker: null,
    noteLastAssistant: vi.fn(),
    stripBlockTags: vi.fn((t: string) => t),
    emitBlockChunk: vi.fn(),
    flushBlockReplyBuffer: vi.fn(),
    emitReasoningStream: vi.fn(),
    consumeReplyDirectives: vi.fn(() => null),
    consumePartialReplyDirectives: vi.fn(() => null),
    resetAssistantMessageState: vi.fn(),
    resetForCompactionRetry: vi.fn(),
    finalizeAssistantTexts: vi.fn(),
    ensureCompactionPromise: vi.fn(),
    noteCompactionRetry: vi.fn(),
    resolveCompactionRetry: vi.fn(),
    maybeResolveCompactionWait: vi.fn(),
    recordAssistantUsage: vi.fn(),
    incrementCompactionCount: vi.fn(),
    getUsageTotals: vi.fn(() => undefined),
    getCompactionCount: vi.fn(() => 0),
  } as unknown as EmbeddedAgentSubscribeContext;
}

const RAW_SEND_ARGS = {
  channel: "whatsapp",
  target: "16478023321-1636054296@g.us",
  message: "Day 6 hand check: is the swelling improving?",
};

async function runRawSend(
  ctx: EmbeddedAgentSubscribeContext,
  toolCallId: string,
  result: unknown,
): Promise<void> {
  await handleToolExecutionStart(ctx, {
    type: "tool_execution_start",
    toolName: "raw_send",
    toolCallId,
    args: RAW_SEND_ARGS,
  } as never);
  await handleToolExecutionEnd(ctx, {
    type: "tool_execution_end",
    toolName: "raw_send",
    toolCallId,
    isError: false,
    result,
  } as never);
}

// jsonResult(payload) => { content:[{type:text,...}], details: payload }
const PREFLIGHT_RESULT = {
  content: [{ type: "text", text: '{"status":"preflight"}' }],
  details: { status: "preflight", scopedPrompts: "<scoped_prompts>...</scoped_prompts>" },
};
const DELIVERED_RESULT = {
  content: [{ type: "text", text: '{"ok":true,"delivered":true}' }],
  details: {
    ok: true,
    channel: "whatsapp",
    target: "16478023321-1636054296@g.us",
    delivered: true,
  },
};

describe("raw_send delivery evidence (frankclaw)", () => {
  it("commits delivery evidence on a successful real raw_send", async () => {
    const ctx = createMockContext();
    await runRawSend(ctx, "tc-real", DELIVERED_RESULT);
    expect(ctx.state.messagingToolSentTargets).toHaveLength(1);
    expect(hasCommittedMessagingToolDeliveryEvidence(ctx.state)).toBe(true);
  });

  it("does NOT commit delivery evidence on a raw_send preflight (non-delivering dry-run)", async () => {
    const ctx = createMockContext();
    await runRawSend(ctx, "tc-preflight", PREFLIGHT_RESULT);
    // Preflight is not an error, but it delivered nothing: no evidence committed.
    expect(ctx.state.messagingToolSentTargets).toHaveLength(0);
    expect(ctx.state.messagingToolSentTexts).toHaveLength(0);
    expect(hasCommittedMessagingToolDeliveryEvidence(ctx.state)).toBe(false);
    // Pending state for the call must still be cleaned up.
    expect(ctx.state.pendingMessagingTargets.size).toBe(0);
    expect(ctx.state.pendingMessagingTexts.size).toBe(0);
  });

  it("models the real cron turn: preflight then real send commits exactly once", async () => {
    const ctx = createMockContext();
    // Turn-1 sequence observed in session 707c5391: preflight then the real send.
    await runRawSend(ctx, "tc-preflight", PREFLIGHT_RESULT);
    expect(hasCommittedMessagingToolDeliveryEvidence(ctx.state)).toBe(false);
    await runRawSend(ctx, "tc-real", DELIVERED_RESULT);
    // Exactly one delivery evidence entry — the preflight did not double-count.
    expect(ctx.state.messagingToolSentTargets).toHaveLength(1);
    expect(hasCommittedMessagingToolDeliveryEvidence(ctx.state)).toBe(true);
  });
});
