import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMessageAction: vi.fn(),
  getToolResult: vi.fn(),
}));

vi.mock("../../infra/outbound/message-action-runner.js", () => ({
  runMessageAction: mocks.runMessageAction,
  getToolResult: mocks.getToolResult,
}));

import { __resetPreflightSeenForTest } from "../../auto-reply/outbound-scoped-prompt.frankclaw.js";
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
  let tmpWorkspace: string;
  let prevWorkspace: string | undefined;

  beforeEach(() => {
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "raw-send-test-"));
    prevWorkspace = process.env["OPENCLAW_WORKSPACE"];
    process.env["OPENCLAW_WORKSPACE"] = tmpWorkspace;

    __resetPreflightSeenForTest();

    mocks.runMessageAction.mockReset();
    mocks.getToolResult.mockReset();
  });

  afterEach(() => {
    if (prevWorkspace === undefined) {
      delete process.env["OPENCLAW_WORKSPACE"];
    } else {
      process.env["OPENCLAW_WORKSPACE"] = prevWorkspace;
    }
    try {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("registers with name raw_send", () => {
    const tool = createRawSendTool({});
    expect(tool.name).toBe("raw_send");
  });

  it("has required parameters in schema", () => {
    const tool = createRawSendTool({});
    const params = tool.parameters as unknown as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(params.required).toEqual(["channel", "target", "message"]);
    expect(params.properties).toHaveProperty("channel");
    expect(params.properties).toHaveProperty("target");
    expect(params.properties).toHaveProperty("message");
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

  it("blocks first cross-session send when destination has scoped prompts, then proceeds", async () => {
    // Write a scoped prompt that matches the destination.
    const p = path.join(tmpWorkspace, "state", "channel-prompt-injections.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          schema: "channel-prompt-injections/v1",
          entries: [
            {
              id: "wa-group",
              match: { sessionKey: "agent:main:whatsapp:group:group@g.us" },
              prompt: "WhatsApp group rule.",
            },
          ],
        },
        null,
        2,
      ),
    );

    mocks.runMessageAction.mockResolvedValue({});
    mocks.getToolResult.mockReturnValue(null);

    const tool = createRawSendTool({ cfg: {} as any, agentSessionKey: "sess1" });

    // First call: should return preflight (no send).
    const first = await tool.execute("call1", {
      channel: "whatsapp",
      target: "group@g.us",
      message: "hello",
    });
    expect(mocks.runMessageAction).toHaveBeenCalledTimes(0);
    const firstParsed = extractJson(first);
    expect(firstParsed.status).toBe("preflight");
    expect(String(firstParsed.scopedPrompts)).toContain("WhatsApp group rule");

    // Second call: should proceed and send.
    const second = await tool.execute("call2", {
      channel: "whatsapp",
      target: "group@g.us",
      message: "hello",
    });
    expect(mocks.runMessageAction).toHaveBeenCalledTimes(1);
    const secondParsed = extractJson(second);
    expect(secondParsed.ok).toBe(true);
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
