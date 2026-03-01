/**
 * Test suite: Follow-up queue collect mode — batch loss scenarios
 *
 * When the agent is busy and messages queue up, the "collect" mode batches
 * them into a single "[Queued messages while agent was busy]" prompt.
 *
 * This tests scenarios where messages could be lost or ignored in the
 * collect-mode drain pipeline.
 */
import { afterEach, describe, expect, it } from "vitest";
// We test the drain logic by directly importing the queue internals.
import { buildCollectPrompt } from "../../../utils/queue-helpers.js";
import { enqueueFollowupRun } from "./enqueue.js";
import { FOLLOWUP_QUEUES } from "./state.js";
import type { FollowupRun, QueueSettings } from "./types.js";

function makeFollowupRun(overrides: {
  prompt: string;
  messageId?: string;
  originatingChannel?: string;
  originatingTo?: string;
  originatingThreadId?: string | number;
}): FollowupRun {
  return {
    prompt: overrides.prompt,
    messageId: overrides.messageId,
    enqueuedAt: Date.now(),
    originatingChannel: overrides.originatingChannel as FollowupRun["originatingChannel"],
    originatingTo: overrides.originatingTo,
    originatingThreadId: overrides.originatingThreadId,
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

const COLLECT_SETTINGS: QueueSettings = {
  mode: "collect",
  debounceMs: 0, // no debounce for testing
  cap: 20,
  dropPolicy: "summarize",
};

describe("follow-up queue collect mode: batch completeness", () => {
  const queueKey = "test-queue";

  afterEach(() => {
    FOLLOWUP_QUEUES.delete(queueKey);
  });

  it("all enqueued messages appear in the queue items", () => {
    const run1 = makeFollowupRun({ prompt: "task A", messageId: "m1" });
    const run2 = makeFollowupRun({ prompt: "task B", messageId: "m2" });
    const run3 = makeFollowupRun({ prompt: "task C", messageId: "m3" });

    enqueueFollowupRun(queueKey, run1, COLLECT_SETTINGS);
    enqueueFollowupRun(queueKey, run2, COLLECT_SETTINGS);
    enqueueFollowupRun(queueKey, run3, COLLECT_SETTINGS);

    const queue = FOLLOWUP_QUEUES.get(queueKey)!;
    expect(queue.items).toHaveLength(3);
    expect(queue.items[0].prompt).toBe("task A");
    expect(queue.items[1].prompt).toBe("task B");
    expect(queue.items[2].prompt).toBe("task C");
  });

  it("buildCollectPrompt includes all queued items in order", () => {
    const items = [
      makeFollowupRun({ prompt: "request 1" }),
      makeFollowupRun({ prompt: "request 2" }),
      makeFollowupRun({ prompt: "request 3" }),
    ];

    const prompt = buildCollectPrompt({
      title: "[Queued messages while agent was busy]",
      items,
      renderItem: (item, idx) => `---\nQueued #${idx + 1}\n${item.prompt}`.trim(),
    });

    expect(prompt).toContain("request 1");
    expect(prompt).toContain("request 2");
    expect(prompt).toContain("request 3");
    expect(prompt).toContain("Queued #1");
    expect(prompt).toContain("Queued #2");
    expect(prompt).toContain("Queued #3");
  });

  it("deduplication does not suppress messages with different messageIds", () => {
    const run1 = makeFollowupRun({ prompt: "task A", messageId: "m1" });
    const run2 = makeFollowupRun({ prompt: "task B", messageId: "m2" });

    const enqueued1 = enqueueFollowupRun(queueKey, run1, COLLECT_SETTINGS);
    const enqueued2 = enqueueFollowupRun(queueKey, run2, COLLECT_SETTINGS);

    expect(enqueued1).toBe(true);
    expect(enqueued2).toBe(true);

    const queue = FOLLOWUP_QUEUES.get(queueKey)!;
    expect(queue.items).toHaveLength(2);
  });

  it("deduplication correctly suppresses duplicate messageIds", () => {
    const run1 = makeFollowupRun({ prompt: "task A", messageId: "m1" });
    const run2 = makeFollowupRun({ prompt: "task A again", messageId: "m1" });

    const enqueued1 = enqueueFollowupRun(queueKey, run1, COLLECT_SETTINGS);
    const enqueued2 = enqueueFollowupRun(queueKey, run2, COLLECT_SETTINGS);

    expect(enqueued1).toBe(true);
    expect(enqueued2).toBe(false); // deduplicated

    const queue = FOLLOWUP_QUEUES.get(queueKey)!;
    expect(queue.items).toHaveLength(1);
  });

  describe("cap overflow behavior", () => {
    it("when cap is exceeded with summarize policy, dropped items generate summary lines", () => {
      const smallCapSettings: QueueSettings = {
        mode: "collect",
        debounceMs: 0,
        cap: 2,
        dropPolicy: "summarize",
      };

      const run1 = makeFollowupRun({ prompt: "task A", messageId: "m1" });
      const run2 = makeFollowupRun({ prompt: "task B", messageId: "m2" });
      const run3 = makeFollowupRun({ prompt: "task C", messageId: "m3" });

      enqueueFollowupRun(queueKey, run1, smallCapSettings);
      enqueueFollowupRun(queueKey, run2, smallCapSettings);
      enqueueFollowupRun(queueKey, run3, smallCapSettings);

      const queue = FOLLOWUP_QUEUES.get(queueKey)!;
      // Cap is 2, so oldest items get dropped and summarized
      expect(queue.items.length).toBeLessThanOrEqual(2);
      expect(queue.droppedCount).toBeGreaterThan(0);
      expect(queue.summaryLines.length).toBeGreaterThan(0);
    });

    it("when cap is exceeded with 'new' policy, newest messages are SILENTLY DROPPED", () => {
      /**
       * This is a potential cause of Frank's issue!
       * If dropPolicy is "new" and the queue is at cap, new messages
       * are silently rejected and never processed.
       */
      const newDropSettings: QueueSettings = {
        mode: "collect",
        debounceMs: 0,
        cap: 2,
        dropPolicy: "new",
      };

      const run1 = makeFollowupRun({ prompt: "task A", messageId: "m1" });
      const run2 = makeFollowupRun({ prompt: "task B", messageId: "m2" });
      const run3 = makeFollowupRun({ prompt: "task C (LOST!)", messageId: "m3" });

      const e1 = enqueueFollowupRun(queueKey, run1, newDropSettings);
      const e2 = enqueueFollowupRun(queueKey, run2, newDropSettings);
      const e3 = enqueueFollowupRun(queueKey, run3, newDropSettings);

      expect(e1).toBe(true);
      expect(e2).toBe(true);
      expect(e3).toBe(false); // DROPPED — task C is permanently lost

      const queue = FOLLOWUP_QUEUES.get(queueKey)!;
      expect(queue.items).toHaveLength(2);
      // task C never appears anywhere — no summary, no processing
    });
  });

  describe("cross-channel routing in collect mode", () => {
    it("cross-channel items force individual processing (no batching)", () => {
      /**
       * When queued messages come from different channels, collect mode
       * falls back to individual processing. Each message is processed
       * separately. This is correct behavior but means the agent doesn't
       * see them as a batch.
       */
      const run1 = makeFollowupRun({
        prompt: "from discord",
        messageId: "m1",
        originatingChannel: "discord",
        originatingTo: "channel:123",
      });
      const run2 = makeFollowupRun({
        prompt: "from telegram",
        messageId: "m2",
        originatingChannel: "telegram",
        originatingTo: "chat:456",
      });

      enqueueFollowupRun(queueKey, run1, COLLECT_SETTINGS);
      enqueueFollowupRun(queueKey, run2, COLLECT_SETTINGS);

      const queue = FOLLOWUP_QUEUES.get(queueKey)!;
      expect(queue.items).toHaveLength(2);

      // The drain.ts code detects cross-channel and processes individually.
      // Both messages will be processed, but not as a single coalesced prompt.
    });
  });
});
