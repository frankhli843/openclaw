/**
 * frankclaw: Tests for the enhanced readMirroredSessionHistoryMessages warning
 * that adds sessionId/sessionKey context fields for better log correlation.
 *
 * Root cause context: WhatsApp inbound messages would stall the durable worker
 * queue when the Codex startup phase (dynamic tools + workspace bootstrap) took
 * >5 min and the mirrored session history read failed silently. This test
 * verifies that the warning includes structured fields for correlation.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMirroredSessionHistoryMessages } from "./attempt-context.js";

describe("frankclaw: readMirroredSessionHistoryMessages warning context", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "frankclaw-attempt-context-test-"));
    // Spy on embeddedAgentLog.warn — import indirectly via the module
    const { embeddedAgentLog } = await import("openclaw/plugin-sdk/agent-harness-runtime");
    warnSpy = vi.spyOn(embeddedAgentLog, "warn");
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for missing session file (ENOENT — normal for new sessions)", async () => {
    const missingFile = path.join(tmpDir, "nonexistent.jsonl");
    const result = await readMirroredSessionHistoryMessages(missingFile);
    expect(result).toEqual([]);
    // No warning for missing file — that is normal
    const warnCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("failed to read mirrored session history"),
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("returns undefined and warns with sessionId/sessionKey when session file is corrupt", async () => {
    const corruptFile = path.join(tmpDir, "corrupt.jsonl");
    // Write a file that fails the session-entry validation (no session header)
    await fs.writeFile(corruptFile, '{"type":"message","role":"user","content":"hello"}\n');

    const result = await readMirroredSessionHistoryMessages(corruptFile, {
      sessionId: "sess-abc123",
      sessionKey: "agent:main:whatsapp:group:120363426101511138",
    });

    expect(result).toBeUndefined();

    const warnCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("failed to read mirrored session history"),
    );
    expect(warnCalls).toHaveLength(1);
    const warnMeta = warnCalls[0]?.[1] as Record<string, unknown>;
    expect(warnMeta?.sessionId).toBe("sess-abc123");
    expect(warnMeta?.sessionKey).toBe("agent:main:whatsapp:group:120363426101511138");
    expect(warnMeta?.sessionFile).toBe(corruptFile);
  });

  it("warns without sessionId/sessionKey when context is not provided", async () => {
    const corruptFile = path.join(tmpDir, "corrupt2.jsonl");
    await fs.writeFile(corruptFile, '{"type":"message","role":"user","content":"hello"}\n');

    const result = await readMirroredSessionHistoryMessages(corruptFile);

    expect(result).toBeUndefined();

    const warnCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("failed to read mirrored session history"),
    );
    expect(warnCalls).toHaveLength(1);
    const warnMeta = warnCalls[0]?.[1] as Record<string, unknown>;
    // No sessionId/sessionKey in meta when context not passed
    expect(warnMeta?.sessionId).toBeUndefined();
    expect(warnMeta?.sessionKey).toBeUndefined();
  });
});
