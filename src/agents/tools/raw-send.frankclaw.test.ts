import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMessageAction: vi.fn(),
  getToolResult: vi.fn(),
}));

vi.mock("../../infra/outbound/message-action-runner.js", () => ({
  runMessageAction: mocks.runMessageAction,
  getToolResult: mocks.getToolResult,
}));

import { createRawSendTool } from "./raw-send.frankclaw.js";

function extractJson(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as any).content;
    if (Array.isArray(content) && content[0]?.text) {
      return JSON.parse(content[0].text);
    }
  }
  if (typeof result === "string") {
    return JSON.parse(result);
  }
  return {};
}

describe("createRawSendTool", () => {
  beforeEach(() => {
    mocks.runMessageAction.mockReset();
    mocks.getToolResult.mockReset();
  });

  it("registers with name raw_send", () => {
    const tool = createRawSendTool({});
    expect(tool.name).toBe("raw_send");
  });

  it("has required parameters in schema", () => {
    const tool = createRawSendTool({});
    expect(tool.parameters.required).toEqual(["channel", "target", "message"]);
    expect(tool.parameters.properties).toHaveProperty("channel");
    expect(tool.parameters.properties).toHaveProperty("target");
    expect(tool.parameters.properties).toHaveProperty("message");
  });

  it("returns error when required params are missing", async () => {
    const tool = createRawSendTool({});
    const result = await tool.execute("call1", { channel: "", target: "t", message: "m" });
    const parsed = extractJson(result);
    expect(parsed.error).toMatch(/required/i);
  });

  it("calls runMessageAction with correct params on success", async () => {
    mocks.runMessageAction.mockResolvedValue({});
    mocks.getToolResult.mockReturnValue(null);

    const cfg = { some: "config" };
    const tool = createRawSendTool({ cfg: cfg as any, agentSessionKey: "sess1" });
    const result = await tool.execute("call1", {
      channel: "whatsapp",
      target: "group@g.us",
      message: "hello",
    });

    expect(mocks.runMessageAction).toHaveBeenCalledWith({
      cfg,
      action: "send",
      params: { channel: "whatsapp", to: "group@g.us", message: "hello" },
      sessionKey: "sess1",
    });

    const parsed = extractJson(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.delivered).toBe(true);
  });

  it("returns tool result from runMessageAction when available", async () => {
    const toolResult = { content: [{ type: "text", text: '{"custom":"result"}' }] };
    mocks.runMessageAction.mockResolvedValue({});
    mocks.getToolResult.mockReturnValue(toolResult);

    const tool = createRawSendTool({ cfg: {} as any });
    const result = await tool.execute("call1", {
      channel: "discord",
      target: "ch123",
      message: "hi",
    });

    expect(result).toBe(toolResult);
  });

  it("returns error on exception", async () => {
    mocks.runMessageAction.mockRejectedValue(new Error("No active WhatsApp Web listener"));

    const tool = createRawSendTool({ cfg: {} as any });
    const result = await tool.execute("call1", {
      channel: "whatsapp",
      target: "group@g.us",
      message: "test",
    });

    const parsed = extractJson(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("No active WhatsApp Web listener");
    expect(parsed.attempts).toBe(1);
  });
});
