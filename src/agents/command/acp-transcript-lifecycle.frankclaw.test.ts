import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markAcpTurnStarted, markAcpTurnFailed } from "./acp-transcript-lifecycle.frankclaw.js";

// Stub resolveSessionTranscriptFile to return a path we control.
vi.mock("../../config/sessions/transcript.js", () => ({
  resolveSessionTranscriptFile: vi.fn(async (params: { sessionId: string }) => ({
    sessionFile: path.join(os.tmpdir(), `acp-lifecycle-test-${params.sessionId}.jsonl`),
    sessionEntry: undefined,
  })),
}));

describe("ACP transcript lifecycle markers (frankclaw)", () => {
  let tmpDir: string;
  let testSessionFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "acp-lc-"));
  });

  afterEach(async () => {
    if (testSessionFile) {
      await fs.rm(testSessionFile, { force: true });
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("markAcpTurnStarted", () => {
    it("writes a session header making transcript non-empty", async () => {
      const sessionId = `test-${Date.now()}`;
      testSessionFile = path.join(os.tmpdir(), `acp-lifecycle-test-${sessionId}.jsonl`);
      // Ensure clean
      await fs.rm(testSessionFile, { force: true });

      const result = await markAcpTurnStarted({
        sessionId,
        sessionKey: `agent:main:acp:${sessionId}`,
        sessionEntry: undefined,
        sessionAgentId: "main",
        cwd: "/tmp",
      });

      expect(result).toBe(testSessionFile);
      const content = await fs.readFile(testSessionFile, "utf-8");
      expect(content.length).toBeGreaterThan(0);

      const parsed = JSON.parse(content.trim());
      expect(parsed.type).toBe("session");
      expect(parsed.id).toBe(sessionId);
      expect(parsed.cwd).toBe("/tmp");
    });

    it("returns undefined on failure without throwing", async () => {
      // Mock resolveSessionTranscriptFile to fail for this specific call
      const { resolveSessionTranscriptFile } = await import("../../config/sessions/transcript.js");
      (resolveSessionTranscriptFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("test failure"),
      );

      const result = await markAcpTurnStarted({
        sessionId: "fail-test",
        sessionKey: "agent:main:acp:fail-test",
        sessionEntry: undefined,
        sessionAgentId: "main",
        cwd: "/tmp",
      });

      expect(result).toBeUndefined();
    });
  });

  describe("markAcpTurnFailed", () => {
    it("appends failure record with assistant role", async () => {
      testSessionFile = path.join(tmpDir, "failed-test.jsonl");
      // Create file with a session header first
      await fs.writeFile(testSessionFile, '{"type":"session","id":"s1"}\n');

      await markAcpTurnFailed({
        sessionFile: testSessionFile,
        error: "ACP_TURN_FAILED: test error",
        runId: "run-123",
      });

      const content = await fs.readFile(testSessionFile, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      const failRecord = JSON.parse(lines[1]);
      expect(failRecord.type).toBe("message");
      expect(failRecord.message.role).toBe("assistant");
      expect(failRecord.message.content[0].text).toContain("ACP turn failed");
      expect(failRecord.acp_lifecycle).toBe("turn_failed");
      expect(failRecord.runId).toBe("run-123");
    });

    it("does nothing when sessionFile is undefined", async () => {
      // Should not throw
      await markAcpTurnFailed({
        sessionFile: undefined,
        error: "test",
        runId: "run-456",
      });
    });

    it("does not throw on write failure", async () => {
      // Non-existent directory that can't be created
      await markAcpTurnFailed({
        sessionFile: "/proc/0/nonexistent/test.jsonl",
        error: "test",
        runId: "run-789",
      });
    });
  });
});
