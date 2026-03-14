import { hasControlCommand } from "../../../../../src/auto-reply/command-detection.js";
import type { loadConfig } from "../../../../../src/config/config.js";
import { buildCollectPrompt } from "../../../../../src/utils/queue-helpers.js";
import type { WebInboundMsg } from "../types.js";

type ConversationState = {
  processing: boolean;
  queue: WebInboundMsg[];
};

export type WebCoalesceQueue = {
  enqueue(msg: WebInboundMsg): void;
};

export function createWebCoalesceQueue(params: {
  cfg: ReturnType<typeof loadConfig>;
  processOne: (msg: WebInboundMsg) => Promise<void>;
}): WebCoalesceQueue {
  const conversations = new Map<string, ConversationState>();

  function getKey(msg: WebInboundMsg): string {
    return `${msg.accountId}:${msg.conversationId ?? msg.from}`;
  }

  async function processBatch(msgs: WebInboundMsg[]): Promise<void> {
    if (msgs.length === 0) {
      return;
    }

    const commandMsgs: WebInboundMsg[] = [];
    const regularMsgs: WebInboundMsg[] = [];

    for (const msg of msgs) {
      if (hasControlCommand(msg.body, params.cfg)) {
        commandMsgs.push(msg);
      } else {
        regularMsgs.push(msg);
      }
    }

    // Fast-lane commands: process individually first.
    for (const msg of commandMsgs) {
      try {
        await params.processOne(msg);
      } catch {
        // Continue processing remaining messages.
      }
    }

    if (regularMsgs.length === 0) {
      return;
    }

    if (regularMsgs.length === 1) {
      try {
        await params.processOne(regularMsgs[0]);
      } catch {
        // Swallow; continue.
      }
      return;
    }

    // Coalesce multiple regular messages into one synthetic message.
    const lastMsg = regularMsgs.at(-1)!;
    const coalescedBody = buildCollectPrompt({
      title: "[Queued messages while agent was busy]",
      items: regularMsgs,
      renderItem: (msg, index) => {
        const senderLabel = msg.senderName ?? msg.senderE164 ?? msg.senderJid ?? msg.from;
        const timeLabel =
          typeof msg.timestamp === "number"
            ? new Date(msg.timestamp * 1000).toISOString()
            : "unknown-time";
        return `Queued #${index + 1} (${senderLabel} @ ${timeLabel})\n${(msg.body ?? "").trim()}`;
      },
    });

    const mergedMentionedJids = Array.from(
      new Set(regularMsgs.flatMap((m) => m.mentionedJids ?? [])),
    );

    const syntheticMsg: WebInboundMsg = {
      ...lastMsg,
      body: coalescedBody,
      mentionedJids: mergedMentionedJids.length > 0 ? mergedMentionedJids : undefined,
    };

    try {
      await params.processOne(syntheticMsg);
    } catch {
      // Swallow; continue.
    }
  }

  async function runProcessingLoop(key: string, firstMsg: WebInboundMsg): Promise<void> {
    try {
      try {
        await params.processOne(firstMsg);
      } catch {
        // Continue draining even if first message fails.
      }

      // Drain any messages that queued up while we were processing.
      while (true) {
        const state = conversations.get(key);
        if (!state || state.queue.length === 0) {
          break;
        }
        const batch = state.queue.splice(0);
        await processBatch(batch);
      }
    } finally {
      conversations.delete(key);
    }
  }

  return {
    enqueue(msg: WebInboundMsg): void {
      const key = getKey(msg);
      const existing = conversations.get(key);

      if (!existing) {
        // No active processing for this conversation — start immediately.
        conversations.set(key, { processing: true, queue: [] });
        void runProcessingLoop(key, msg);
      } else {
        // Conversation is busy; queue the message for the next drain.
        existing.queue.push(msg);
      }
    },
  };
}
