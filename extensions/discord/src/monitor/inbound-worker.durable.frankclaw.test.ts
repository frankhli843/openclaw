import { describe, expect, it } from "vitest";
import { __testing } from "./inbound-worker.durable.frankclaw.js";

describe("durable discord worker session progress detection", () => {
  it("does not treat unchanged session evidence as progress", () => {
    expect(
      __testing.didDurableSessionProgressAdvance(
        {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          updatedAt: 100,
          status: "done",
          transcriptExists: true,
          transcriptSize: 512,
          transcriptMtimeMs: 1000,
        },
        {
          sessionId: "session-1",
          sessionFile: "/tmp/session-1.jsonl",
          updatedAt: 200,
          status: "done",
          transcriptExists: true,
          transcriptSize: 512,
          transcriptMtimeMs: 1000,
        },
      ),
    ).toBe(false);
  });

  it("treats transcript creation as progress", () => {
    expect(
      __testing.didDurableSessionProgressAdvance(
        {
          sessionId: undefined,
          sessionFile: undefined,
          updatedAt: undefined,
          status: undefined,
          transcriptExists: false,
          transcriptSize: 0,
          transcriptMtimeMs: 0,
        },
        {
          sessionId: "session-2",
          sessionFile: "/tmp/session-2.jsonl",
          updatedAt: 200,
          status: "running",
          transcriptExists: true,
          transcriptSize: 256,
          transcriptMtimeMs: 2000,
        },
      ),
    ).toBe(true);
  });

  it("treats transcript growth on an existing file as progress", () => {
    expect(
      __testing.didDurableSessionProgressAdvance(
        {
          sessionId: "session-3",
          sessionFile: "/tmp/session-3.jsonl",
          updatedAt: 100,
          status: "done",
          transcriptExists: true,
          transcriptSize: 1024,
          transcriptMtimeMs: 1000,
        },
        {
          sessionId: "session-3",
          sessionFile: "/tmp/session-3.jsonl",
          updatedAt: 200,
          status: "running",
          transcriptExists: true,
          transcriptSize: 1408,
          transcriptMtimeMs: 2000,
        },
      ),
    ).toBe(true);
  });

  it("detects session metadata materialization even when transcript is still missing", () => {
    expect(
      __testing.didDurableSessionMetadataMaterialize(
        {
          transcriptExists: false,
          transcriptSize: 0,
          transcriptMtimeMs: 0,
        },
        {
          sessionId: "session-4",
          sessionFile: "/tmp/session-4.jsonl",
          updatedAt: 200,
          status: "running",
          transcriptExists: false,
          transcriptSize: 0,
          transcriptMtimeMs: 0,
        },
      ),
    ).toBe(true);
  });

  it("does not treat existing session metadata alone as fresh materialization", () => {
    expect(
      __testing.didDurableSessionMetadataMaterialize(
        {
          sessionId: "session-5",
          sessionFile: "/tmp/session-5.jsonl",
          updatedAt: 100,
          status: "done",
          transcriptExists: true,
          transcriptSize: 20,
          transcriptMtimeMs: 50,
        },
        {
          sessionId: "session-5",
          sessionFile: "/tmp/session-5.jsonl",
          updatedAt: 200,
          status: "done",
          transcriptExists: true,
          transcriptSize: 20,
          transcriptMtimeMs: 50,
        },
      ),
    ).toBe(false);
  });
});
