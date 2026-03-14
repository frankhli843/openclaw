import type { AgentMessage } from "@mariozechner/pi-agent-core";

type AssistantContentBlock = Extract<AgentMessage, { role: "assistant" }>["content"][number];
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

export function isAssistantMessageWithContent(message: AgentMessage): message is AssistantMessage {
  return (
    !!message &&
    typeof message === "object" &&
    message.role === "assistant" &&
    Array.isArray(message.content)
  );
}

/**
 * Strip all `type: "thinking"` content blocks from assistant messages.
 *
 * If an assistant message becomes empty after stripping, it is replaced with
 * a synthetic `{ type: "text", text: "" }` block to preserve turn structure
 * (some providers require strict user/assistant alternation).
 *
 * Returns the original array reference when nothing was changed (callers can
 * use reference equality to skip downstream work).
 */
export function dropThinkingBlocks(messages: AgentMessage[]): AgentMessage[] {
  let touched = false;
  const out: AgentMessage[] = [];
  for (const msg of messages) {
    if (!isAssistantMessageWithContent(msg)) {
      out.push(msg);
      continue;
    }
    const nextContent: AssistantContentBlock[] = [];
    let changed = false;
    for (const block of msg.content) {
      const blockType =
        block && typeof block === "object" ? (block as { type?: unknown }).type : undefined;
      if (blockType === "thinking" || blockType === "redacted_thinking") {
        touched = true;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }
    if (!changed) {
      out.push(msg);
      continue;
    }
    // Preserve the assistant turn even if all blocks were thinking-only.
    const content =
      nextContent.length > 0 ? nextContent : [{ type: "text", text: "" } as AssistantContentBlock];
    out.push({ ...msg, content });
  }
  return touched ? out : messages;
}

/**
 * Strip thinking/redacted_thinking blocks from all assistant messages
 * EXCEPT the last assistant message. Historical thinking blocks have
 * no value after compaction and are the primary source of Anthropic's
 * "thinking blocks cannot be modified" rejection.
 *
 * Returns the original array reference when nothing was changed.
 */
export function dropHistoricalThinkingBlocks(messages: AgentMessage[]): AgentMessage[] {
  // Find the index of the last assistant message
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isAssistantMessageWithContent(messages[i])) {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) {
    return messages;
  }

  let touched = false;
  const out: AgentMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (i === lastAssistantIdx || !isAssistantMessageWithContent(msg)) {
      out.push(msg);
      continue;
    }
    // Strip thinking/redacted_thinking from non-latest assistant messages
    const nextContent: AssistantContentBlock[] = [];
    let changed = false;
    for (const block of msg.content) {
      const blockType =
        block && typeof block === "object" ? (block as { type?: unknown }).type : undefined;
      if (blockType === "thinking" || blockType === "redacted_thinking") {
        touched = true;
        changed = true;
        continue;
      }
      nextContent.push(block);
    }
    if (!changed) {
      out.push(msg);
    } else {
      const content: AssistantContentBlock[] =
        nextContent.length > 0
          ? nextContent
          : [{ type: "text", text: "" } as AssistantContentBlock];
      out.push({ ...msg, content });
    }
  }
  return touched ? out : messages;
}
