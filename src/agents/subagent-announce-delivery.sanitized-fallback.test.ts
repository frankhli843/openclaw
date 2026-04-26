import { describe, expect, it } from "vitest";
import type { AgentInternalEvent } from "./internal-events.js";
import { extractThreadCompletionFallbackText } from "./subagent-announce-delivery.js";

describe("extractThreadCompletionFallbackText", () => {
  it("returns the result text from a task_completion event", () => {
    const events: AgentInternalEvent[] = [
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:acp:child-1",
        announceType: "subagent task",
        taskLabel: "whatsapp-image-fix",
        status: "ok",
        statusLabel: "completed successfully",
        result: "Found 3 bugs",
        replyInstruction: "Convert the result...",
      },
    ];
    const text = extractThreadCompletionFallbackText(events);
    expect(text).toBe("Found 3 bugs");
    expect(text).not.toContain("INTERNAL_CONTEXT");
    expect(text).not.toContain("child-1");
  });

  it("falls back to taskLabel: statusLabel when result is empty", () => {
    const events: AgentInternalEvent[] = [
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:acp:child-1",
        announceType: "subagent task",
        taskLabel: "whatsapp-image-fix",
        status: "ok",
        statusLabel: "completed successfully",
        result: "",
        replyInstruction: "",
      },
    ];
    const text = extractThreadCompletionFallbackText(events);
    expect(text).toBe("whatsapp-image-fix: completed successfully");
  });

  it("falls back to statusLabel alone when taskLabel is empty", () => {
    const events: AgentInternalEvent[] = [
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:acp:child-1",
        announceType: "subagent task",
        taskLabel: "",
        status: "ok",
        statusLabel: "completed",
        result: "",
        replyInstruction: "",
      },
    ];
    const text = extractThreadCompletionFallbackText(events);
    expect(text).toBe("completed");
  });

  it("falls back to taskLabel alone when statusLabel is empty", () => {
    const events: AgentInternalEvent[] = [
      {
        type: "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:acp:child-1",
        announceType: "subagent task",
        taskLabel: "my-task",
        status: "ok",
        statusLabel: "",
        result: "",
        replyInstruction: "",
      },
    ];
    const text = extractThreadCompletionFallbackText(events);
    expect(text).toBe("my-task");
  });

  it("returns empty string when no events are provided", () => {
    expect(extractThreadCompletionFallbackText(undefined)).toBe("");
    expect(extractThreadCompletionFallbackText([])).toBe("");
  });

  it("skips non-task_completion events", () => {
    const events: AgentInternalEvent[] = [
      {
        type: "status_update" as "task_completion",
        source: "subagent",
        childSessionKey: "agent:main:acp:child-1",
        announceType: "status",
        taskLabel: "task",
        status: "ok",
        statusLabel: "still going",
        result: "partial",
        replyInstruction: "",
      },
    ];
    const text = extractThreadCompletionFallbackText(events);
    expect(text).toBe("");
  });
});
