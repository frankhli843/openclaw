import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSubagentInstructions, prependSubagentInstructions } from "./subagent-instructions.js";

describe("subagent instructions", () => {
  it("prepends instruction block when content exists", () => {
    const result = prependSubagentInstructions("[Subagent Task]: Test", "Use WebAISearch first.");
    expect(result).toContain("[Subagent Global Instructions]");
    expect(result).toContain("Use WebAISearch first.");
    expect(result).toContain("[Subagent Task]: Test");
  });

  it("returns original message when instructions are empty", () => {
    expect(prependSubagentInstructions("abc", "   ")).toBe("abc");
    expect(prependSubagentInstructions("abc", undefined)).toBe("abc");
  });

  it("loads SUBAGENTS.md from workspace directory", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-subagents-"));
    await fs.writeFile(path.join(dir, "SUBAGENTS.md"), "  Research: use WebAISearch first.  ");
    await expect(loadSubagentInstructions(dir)).resolves.toBe("Research: use WebAISearch first.");
  });
});
