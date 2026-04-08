import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDiscordInboundLifecycleTracker,
  isDiscordInboundLifecyclePreStartStage,
  isDiscordInboundLifecycleTerminal,
  recoverStaleDiscordInboundLifecycleStates,
} from "./inbound-lifecycle.frankclaw.js";

describe("discord inbound lifecycle tracker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discord-inbound-lifecycle-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks and clears terminal lifecycle states", async () => {
    const tracker = createDiscordInboundLifecycleTracker({
      accountId: "default",
      stateDir: tmpDir,
      event: {
        accountId: "default",
        orderingKey: "agent:main:discord:channel:123",
        channelId: "123",
        messageId: "m-1",
      },
    });

    await tracker.mark({
      stage: "claimed",
      note: "claimed",
      progress: {
        transcriptExists: false,
        transcriptSize: 0,
        transcriptMtimeMs: 0,
      },
    });
    const claimed = await tracker.load();
    expect(claimed?.stage).toBe("claimed");
    expect(isDiscordInboundLifecyclePreStartStage(claimed!.stage)).toBe(true);

    await tracker.mark({
      stage: "run_started",
      note: "transcript advanced",
      progress: {
        sessionId: "s-1",
        sessionFile: "/tmp/s-1.jsonl",
        transcriptExists: true,
        transcriptSize: 5,
        transcriptMtimeMs: 10,
      },
    });
    const terminal = await tracker.load();
    expect(terminal?.stage).toBe("run_started");
    expect(isDiscordInboundLifecycleTerminal(terminal!.stage)).toBe(true);

    await tracker.clear();
    await expect(tracker.load()).resolves.toBeNull();
  });

  it("reports stale pre-start lifecycle states on recovery", async () => {
    const tracker = createDiscordInboundLifecycleTracker({
      accountId: "default",
      stateDir: tmpDir,
      event: {
        accountId: "default",
        orderingKey: "agent:main:discord:channel:123",
        channelId: "123",
        messageId: "m-2",
      },
    });

    await tracker.mark({
      stage: "session_init",
      note: "materialized",
      progress: {
        sessionId: "session-2",
        sessionFile: "/tmp/missing-transcript.jsonl",
        transcriptExists: false,
        transcriptSize: 0,
        transcriptMtimeMs: 0,
      },
    });

    const warnings: string[] = [];
    const result = await recoverStaleDiscordInboundLifecycleStates({
      accountId: "default",
      stateDir: tmpDir,
      log: (message) => warnings.push(message),
    });

    expect(result.recoveredCount).toBe(1);
    expect(result.missingTranscriptCount).toBe(1);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("stale pre-start lifecycle state recovered"),
        expect.stringContaining("session metadata exists but transcript missing"),
      ]),
    );
  });

  it("ignores terminal lifecycle states during recovery", async () => {
    const tracker = createDiscordInboundLifecycleTracker({
      accountId: "default",
      stateDir: tmpDir,
      event: {
        accountId: "default",
        orderingKey: "agent:main:discord:channel:456",
        channelId: "456",
        messageId: "m-3",
      },
    });

    await tracker.mark({
      stage: "reply_delivered",
      note: "reply delivered",
      progress: {
        sessionId: "session-3",
        sessionFile: "/tmp/reply-delivered.jsonl",
        transcriptExists: true,
        transcriptSize: 10,
        transcriptMtimeMs: 20,
      },
    });

    const warnings: string[] = [];
    const result = await recoverStaleDiscordInboundLifecycleStates({
      accountId: "default",
      stateDir: tmpDir,
      log: (message) => warnings.push(message),
    });

    expect(result).toEqual({ recoveredCount: 0, missingTranscriptCount: 0 });
    expect(warnings).toHaveLength(0);
  });

  it("annotates errors without dropping the last non-terminal stage", async () => {
    const tracker = createDiscordInboundLifecycleTracker({
      accountId: "default",
      stateDir: tmpDir,
      event: {
        accountId: "default",
        orderingKey: "agent:main:discord:channel:789",
        channelId: "789",
        messageId: "m-4",
      },
    });

    await tracker.mark({
      stage: "handler_returned",
      note: "returned early",
      progress: {
        transcriptExists: false,
        transcriptSize: 0,
        transcriptMtimeMs: 0,
      },
    });
    await tracker.annotateError("missing terminal lifecycle state");

    const record = await tracker.load();
    expect(record?.stage).toBe("handler_returned");
    expect(record?.lastError).toBe("missing terminal lifecycle state");
  });
});
