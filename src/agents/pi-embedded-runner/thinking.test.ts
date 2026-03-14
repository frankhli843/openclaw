import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { castAgentMessage } from "../test-helpers/agent-message-fixtures.js";
import {
  dropHistoricalThinkingBlocks,
  dropThinkingBlocks,
  isAssistantMessageWithContent,
} from "./thinking.js";

describe("isAssistantMessageWithContent", () => {
  it("accepts assistant messages with array content and rejects others", () => {
    const assistant = castAgentMessage({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    const user = castAgentMessage({ role: "user", content: "hi" });
    const malformed = castAgentMessage({ role: "assistant", content: "not-array" });

    expect(isAssistantMessageWithContent(assistant)).toBe(true);
    expect(isAssistantMessageWithContent(user)).toBe(false);
    expect(isAssistantMessageWithContent(malformed)).toBe(false);
  });
});

describe("dropThinkingBlocks", () => {
  it("returns the original reference when no thinking blocks are present", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({ role: "user", content: "hello" }),
      castAgentMessage({ role: "assistant", content: [{ type: "text", text: "world" }] }),
    ];

    const result = dropThinkingBlocks(messages);
    expect(result).toBe(messages);
  });

  it("drops thinking blocks while preserving non-thinking assistant content", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "final" },
        ],
      }),
    ];

    const result = dropThinkingBlocks(messages);
    const assistant = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(result).not.toBe(messages);
    expect(assistant.content).toEqual([{ type: "text", text: "final" }]);
  });

  it("keeps assistant turn structure when all content blocks were thinking", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [{ type: "thinking", thinking: "internal-only" }],
      }),
    ];

    const result = dropThinkingBlocks(messages);
    const assistant = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(assistant.content).toEqual([{ type: "text", text: "" }]);
  });

  it("drops redacted_thinking blocks", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "redacted_thinking", data: "abc123" },
          { type: "text", text: "visible" },
        ],
      }),
    ];

    const result = dropThinkingBlocks(messages);
    expect(result).not.toBe(messages);
    const assistant = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(assistant.content).toEqual([{ type: "text", text: "visible" }]);
  });
});

describe("dropHistoricalThinkingBlocks", () => {
  it("returns the original reference when no assistant messages exist", () => {
    const messages: AgentMessage[] = [castAgentMessage({ role: "user", content: "hello" })];
    const result = dropHistoricalThinkingBlocks(messages);
    expect(result).toBe(messages);
  });

  it("preserves thinking blocks in the last (only) assistant message", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({ role: "user", content: "hello" }),
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "reasoning" },
          { type: "text", text: "answer" },
        ],
      }),
    ];

    const result = dropHistoricalThinkingBlocks(messages);
    expect(result).toBe(messages); // no change — only one assistant msg
  });

  it("strips thinking from non-last assistant messages but preserves last", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "old reasoning" },
          { type: "text", text: "old answer" },
        ],
      }),
      castAgentMessage({ role: "user", content: "follow up" }),
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "new reasoning" },
          { type: "text", text: "new answer" },
        ],
      }),
    ];

    const result = dropHistoricalThinkingBlocks(messages);
    expect(result).not.toBe(messages);

    // First assistant: thinking stripped
    const first = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(first.content).toEqual([{ type: "text", text: "old answer" }]);

    // Last assistant: thinking preserved
    const last = result[2] as Extract<AgentMessage, { role: "assistant" }>;
    expect(last.content).toHaveLength(2);
    expect(last.content[0]).toEqual({ type: "thinking", thinking: "new reasoning" });
  });

  it("handles redacted_thinking blocks in historical messages", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "redacted_thinking", data: "secret" },
          { type: "text", text: "first" },
        ],
      }),
      castAgentMessage({ role: "user", content: "next" }),
      castAgentMessage({
        role: "assistant",
        content: [{ type: "text", text: "second" }],
      }),
    ];

    const result = dropHistoricalThinkingBlocks(messages);
    expect(result).not.toBe(messages);
    const first = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(first.content).toEqual([{ type: "text", text: "first" }]);
  });

  it("returns same reference when no historical thinking blocks exist", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [{ type: "text", text: "clean" }],
      }),
      castAgentMessage({ role: "user", content: "ok" }),
      castAgentMessage({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "latest" },
          { type: "text", text: "response" },
        ],
      }),
    ];

    const result = dropHistoricalThinkingBlocks(messages);
    expect(result).toBe(messages);
  });

  it("replaces empty assistant content with synthetic text block after stripping", () => {
    const messages: AgentMessage[] = [
      castAgentMessage({
        role: "assistant",
        content: [{ type: "thinking", thinking: "only thinking" }],
      }),
      castAgentMessage({ role: "user", content: "next" }),
      castAgentMessage({
        role: "assistant",
        content: [{ type: "text", text: "final" }],
      }),
    ];

    const result = dropHistoricalThinkingBlocks(messages);
    const first = result[0] as Extract<AgentMessage, { role: "assistant" }>;
    expect(first.content).toEqual([{ type: "text", text: "" }]);
  });
});
