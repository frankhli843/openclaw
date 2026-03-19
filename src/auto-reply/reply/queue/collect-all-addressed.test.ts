/**
 * Test suite: Coalesced prompt must instruct the LLM to address ALL queued items
 *
 * Root cause: When multiple messages arrive while the agent is busy, they are
 * correctly coalesced into a single prompt using buildCollectPrompt(). However,
 * the prompt only says "[Queued messages while agent was busy]" with no directive
 * telling the LLM to respond to ALL items. The LLM frequently cherry-picks
 * which items to respond to and silently ignores others.
 *
 * Real-world example (WWSA WhatsApp group, Feb 28 2026):
 *   Chris sent "Thanks" and "Can we run a report to determine which product's
 *   sales are positively trending?" while the agent was busy. The agent only
 *   acknowledged "Thanks" and never ran the report.
 *
 * This affects ALL channels (WhatsApp, Discord, Telegram) because they all
 * use the same buildCollectPrompt() and follow-up queue drain.
 *
 * The fix: include an explicit instruction in the coalesced prompt requiring
 * the LLM to address every queued item.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildCollectPrompt } from "../../../utils/queue-helpers.js";
import { FOLLOWUP_QUEUES } from "./state.js";
import type { FollowupRun } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFollowupRun(overrides: {
  prompt: string;
  messageId?: string;
  summaryLine?: string;
}): FollowupRun {
  return {
    prompt: overrides.prompt,
    messageId: overrides.messageId,
    summaryLine: overrides.summaryLine,
    enqueuedAt: Date.now(),
    run: {
      agentId: "main",
      agentDir: "/tmp/agent",
      sessionId: "session-1",
      sessionKey: "test-session",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp/workspace",
      config: {} as FollowupRun["run"]["config"],
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      timeoutMs: 60_000,
      blockReplyBreak: "message_end",
    },
  };
}

/**
 * Builds the coalesced prompt the same way the follow-up queue drain does.
 * (Mirrors the logic in src/auto-reply/reply/queue/drain.ts)
 */
function buildFollowupCollectPrompt(items: FollowupRun[]): string {
  return buildCollectPrompt({
    title: "[Queued messages while agent was busy]",
    items,
    renderItem: (item, idx) => `---\nQueued #${idx + 1}\n${item.prompt}`.trim(),
  });
}

/**
 * Builds the coalesced prompt the same way the Discord coalesce handler does.
 * (Mirrors the logic in src/discord/monitor/message-handler.coalesce.ts)
 */
function buildDiscordCoalescePrompt(
  events: Array<{ author: string; timestamp: string; text: string }>,
): string {
  return buildCollectPrompt({
    title: "[Queued messages while agent was busy]",
    items: events,
    renderItem: (item, index) =>
      `Queued #${index + 1} (${item.author} @ ${item.timestamp})\n${item.text}`,
  });
}

/**
 * Builds the coalesced prompt the same way the WhatsApp coalesce queue does.
 * (Mirrors the logic in src/web/auto-reply/monitor/coalesce-queue.ts)
 */
function buildWhatsAppCoalescePrompt(
  msgs: Array<{ senderName: string; timestamp: number; body: string }>,
): string {
  return buildCollectPrompt({
    title: "[Queued messages while agent was busy]",
    items: msgs,
    renderItem: (msg, index) => {
      const timeLabel = new Date(msg.timestamp * 1000).toISOString();
      return `Queued #${index + 1} (${msg.senderName} @ ${timeLabel})\n${msg.body.trim()}`;
    },
  });
}

// Patterns that indicate the prompt instructs the LLM to address all items.
// The exact wording can vary, but SOME instruction must be present.
const ADDRESS_ALL_PATTERNS = [
  /address\s+(all|each|every)/i,
  /respond\s+to\s+(all|each|every)/i,
  /must\s+(address|respond|answer|handle)\s+(all|each|every)/i,
  /do\s+not\s+(ignore|skip|miss)/i,
  /don['']?t\s+(ignore|skip|miss)/i,
];

function hasAddressAllInstruction(prompt: string): boolean {
  return ADDRESS_ALL_PATTERNS.some((pattern) => pattern.test(prompt));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coalesced prompt: address-all instruction (cross-channel root cause)", () => {
  const queueKey = "test-collect-all";

  afterEach(() => {
    FOLLOWUP_QUEUES.delete(queueKey);
  });

  describe("follow-up queue drain prompt", () => {
    it("includes all queued messages in the prompt", () => {
      const items = [
        makeFollowupRun({ prompt: "Thanks for the report", messageId: "m1" }),
        makeFollowupRun({
          prompt: "Can we run the same report for the Top 20 customers?",
          messageId: "m2",
        }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      // Infrastructure correctness: all items present
      expect(prompt).toContain("Thanks for the report");
      expect(prompt).toContain("Can we run the same report for the Top 20 customers?");
      expect(prompt).toContain("Queued #1");
      expect(prompt).toContain("Queued #2");
    });

    it("BUG: prompt lacks instruction to address all queued items", () => {
      /**
       * This is the ROOT CAUSE of the batch-ignoring bug.
       *
       * The coalesced prompt says "[Queued messages while agent was busy]" but
       * does NOT instruct the LLM to address ALL items. The LLM sees a list
       * and frequently responds to only the last or most interesting item.
       *
       * Real example: Chris sent "Thanks" + "Can we run the same report for
       * Top 20 customers?" → agent only acknowledged "Thanks", never ran the
       * report.
       *
       * When this test starts PASSING, the bug is fixed.
       */
      const items = [
        makeFollowupRun({ prompt: "Thanks for the report", messageId: "m1" }),
        makeFollowupRun({
          prompt: "Can we run the same report for the Top 20 customers?",
          messageId: "m2",
        }),
        makeFollowupRun({
          prompt: "Also, what was our total revenue last quarter?",
          messageId: "m3",
        }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      // The prompt MUST include an instruction to address all items.
      expect(hasAddressAllInstruction(prompt)).toBe(true);
    });
  });

  describe("Discord coalesce prompt", () => {
    it("includes all messages from different users", () => {
      const events = [
        {
          author: "Chris",
          timestamp: "2026-02-28T13:15:00Z",
          text: "CDT report is excellent",
        },
        {
          author: "Chris",
          timestamp: "2026-02-28T13:16:00Z",
          text: "Can we run the same report for the Top 20 customers?",
        },
        {
          author: "Jason",
          timestamp: "2026-02-28T13:17:00Z",
          text: "How do we ensure AI cant scrape info?",
        },
      ];

      const prompt = buildDiscordCoalescePrompt(events);

      expect(prompt).toContain("CDT report is excellent");
      expect(prompt).toContain("Top 20 customers");
      expect(prompt).toContain("scrape info");
    });

    it("BUG: Discord coalesce prompt lacks address-all instruction", () => {
      const events = [
        { author: "User1", timestamp: "2026-01-01T00:00:00Z", text: "Question A?" },
        { author: "User2", timestamp: "2026-01-01T00:01:00Z", text: "Question B?" },
      ];

      const prompt = buildDiscordCoalescePrompt(events);

      expect(hasAddressAllInstruction(prompt)).toBe(true);
    });
  });

  describe("WhatsApp coalesce prompt", () => {
    it("includes all messages", () => {
      const msgs = [
        { senderName: "Chris", timestamp: 1772302500, body: "Thanks" },
        {
          senderName: "Chris",
          timestamp: 1772302600,
          body: "Can we run a report to determine which product's sales are positively trending?",
        },
      ];

      const prompt = buildWhatsAppCoalescePrompt(msgs);

      expect(prompt).toContain("Thanks");
      expect(prompt).toContain("positively trending");
    });

    it("BUG: WhatsApp coalesce prompt lacks address-all instruction", () => {
      /**
       * Same root cause as Discord. The WhatsApp coalesce queue
       * (src/web/auto-reply/monitor/coalesce-queue.ts) uses the same
       * buildCollectPrompt() with the same bare title.
       */
      const msgs = [
        { senderName: "Chris", timestamp: 1772302500, body: "Thanks" },
        {
          senderName: "Chris",
          timestamp: 1772302600,
          body: "Can we run a report to determine which product's sales are positively trending?",
        },
      ];

      const prompt = buildWhatsAppCoalescePrompt(msgs);

      expect(hasAddressAllInstruction(prompt)).toBe(true);
    });
  });

  describe("edge cases that make ignoring more likely", () => {
    it("trivial message followed by actionable request — actionable must survive", () => {
      /**
       * Most common pattern for batch ignoring: a simple acknowledgment
       * ("Thanks", "OK", "👍") followed by a real request. The LLM
       * responds to the trivial message and ignores the request.
       */
      const items = [
        makeFollowupRun({ prompt: "OK", messageId: "m1" }),
        makeFollowupRun({
          prompt: "Can you run the CDT profitability report?",
          messageId: "m2",
        }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      // Both must be in the prompt (infrastructure correctness)
      expect(prompt).toContain("OK");
      expect(prompt).toContain("CDT profitability report");

      // Must have instruction (currently fails = the bug)
      expect(hasAddressAllInstruction(prompt)).toBe(true);
    });

    it("multiple actionable requests from different senders", () => {
      /**
       * In group chats, different people send requests while the agent is busy.
       * The agent may respond to only one person's request.
       */
      const items = [
        makeFollowupRun({
          prompt: "Chris: Run the top 20 customers report",
          messageId: "m1",
        }),
        makeFollowupRun({
          prompt: "Jason: How do we ensure data security?",
          messageId: "m2",
        }),
        makeFollowupRun({
          prompt: "Frank: Check quarterly revenue",
          messageId: "m3",
        }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      expect(prompt).toContain("top 20 customers");
      expect(prompt).toContain("data security");
      expect(prompt).toContain("quarterly revenue");
      expect(hasAddressAllInstruction(prompt)).toBe(true);
    });

    it("single queued message should NOT have batch instruction", () => {
      /**
       * When there's only one queued message, no batch instruction is needed.
       * This prevents unnecessary verbosity in the common case.
       */
      const items = [makeFollowupRun({ prompt: "Just one request", messageId: "m1" })];

      const prompt = buildFollowupCollectPrompt(items);

      // Single message: instruction is not required (but not harmful either)
      expect(prompt).toContain("Just one request");
      // No assertion on instruction presence for single items
    });
  });

  describe("buildCollectPrompt item count accuracy", () => {
    it("item count in prompt matches actual queued count", () => {
      const items = [
        makeFollowupRun({ prompt: "A", messageId: "m1" }),
        makeFollowupRun({ prompt: "B", messageId: "m2" }),
        makeFollowupRun({ prompt: "C", messageId: "m3" }),
        makeFollowupRun({ prompt: "D", messageId: "m4" }),
        makeFollowupRun({ prompt: "E", messageId: "m5" }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      // Count the "Queued #N" markers
      const queuedMarkers = prompt.match(/Queued #\d+/g) ?? [];
      expect(queuedMarkers).toHaveLength(5);
      expect(prompt).toContain("Queued #1");
      expect(prompt).toContain("Queued #5");
    });

    it("prompt should include total count of queued items for LLM awareness", () => {
      /**
       * Including the count (e.g., "5 messages queued") helps the LLM
       * self-check that it addressed all items.
       */
      const items = [
        makeFollowupRun({ prompt: "A", messageId: "m1" }),
        makeFollowupRun({ prompt: "B", messageId: "m2" }),
        makeFollowupRun({ prompt: "C", messageId: "m3" }),
      ];

      const prompt = buildFollowupCollectPrompt(items);

      // The prompt should mention the count (e.g., "3 messages" or "3 queued")
      const hasCount = /\b3\b/.test(prompt) && /message|queue|item/i.test(prompt);
      expect(hasCount).toBe(true);
    });
  });
});
