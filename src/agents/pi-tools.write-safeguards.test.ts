import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { wrapToolParamNormalization } from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

function makeWriteTool(): AnyAgentTool {
  return {
    name: "write",
    description: "write",
    label: "write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    execute: async (_id, args, _signal, _onUpdate) => {
      const record = args as Record<string, unknown>;
      const filePath = String(record.path);
      const content = typeof record.content === "string" ? record.content : "";
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  } satisfies AnyAgentTool;
}

describe("write safeguards", () => {
  let dir = "";

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("chunk-writes large payloads atomically", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-write-"));
    const target = path.join(dir, "big.txt");
    const wrapped = wrapToolParamNormalization(makeWriteTool());
    const content = "a".repeat(200_000);

    await wrapped.execute("call-1", { path: target, content });
    const saved = await fs.readFile(target, "utf8");
    expect(saved.length).toBe(content.length);
    expect(saved).toBe(content);
  });

  it("rejects runaway escaped payloads", async () => {
    const wrapped = wrapToolParamNormalization(makeWriteTool());
    const malformed = "\\n".repeat(120_000);
    await expect(
      wrapped.execute("call-2", { path: "/tmp/ignored.txt", content: malformed }),
    ).rejects.toThrow(/malformed escaped\/repetitive payload/i);
  });
});
