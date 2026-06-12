/**
 * embedded-agent-messaging.frankclaw.test.ts
 *
 * Regression tests for the frankclaw raw_send messaging-tool extension.
 * Verifies that raw_send is classified as a messaging tool so the cron
 * orchestration loop does not re-fire after a successful raw_send delivery.
 *
 * Regression: Jun 12 2026 — Yiting hand-injury check-in posted twice because
 * raw_send was not in CORE_MESSAGING_TOOLS, leaving !didSendViaMessagingTool=true
 * after delivery and triggering the "Complete the original task" follow-up prompt.
 */
import { describe, expect, it } from "vitest";
import {
  isMessagingTool,
  isMessagingToolSendAction,
} from "./embedded-agent-messaging.frankclaw.js";

describe("isMessagingTool (frankclaw extension)", () => {
  it("returns true for raw_send", () => {
    expect(isMessagingTool("raw_send")).toBe(true);
  });

  it("still returns true for sessions_send (upstream passthrough)", () => {
    expect(isMessagingTool("sessions_send")).toBe(true);
  });

  it("still returns true for message (upstream passthrough)", () => {
    expect(isMessagingTool("message")).toBe(true);
  });

  it("returns false for non-messaging tools", () => {
    expect(isMessagingTool("exec")).toBe(false);
    expect(isMessagingTool("cron")).toBe(false);
    expect(isMessagingTool("memory_search")).toBe(false);
  });
});

describe("isMessagingToolSendAction (frankclaw extension)", () => {
  it("returns true for raw_send regardless of args", () => {
    // raw_send has no action discriminator; every call is an outbound send.
    expect(
      isMessagingToolSendAction("raw_send", {
        channel: "whatsapp",
        target: "120363405743307729@g.us",
        message: "Hello",
      }),
    ).toBe(true);
  });

  it("returns true for raw_send even with empty args", () => {
    expect(isMessagingToolSendAction("raw_send", {})).toBe(true);
  });

  it("still returns true for sessions_send (upstream passthrough)", () => {
    expect(isMessagingToolSendAction("sessions_send", { to: "agent-x", message: "hi" })).toBe(true);
  });

  it("still returns true for message send action (upstream passthrough)", () => {
    expect(
      isMessagingToolSendAction("message", {
        action: "send",
        channel: "telegram",
        to: "123",
        content: "hi",
      }),
    ).toBe(true);
  });

  it("still returns false for message non-send action (upstream passthrough)", () => {
    expect(
      isMessagingToolSendAction("message", {
        action: "list",
        channel: "telegram",
      }),
    ).toBe(false);
  });
});
