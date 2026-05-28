// frankclaw: tests for the incomplete-turn structured diagnostic logger
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, logIncompleteTurnDiag } from "./incomplete-turn-diag.frankclaw.js";

describe("logIncompleteTurnDiag", () => {
  let appendFileSpy: ReturnType<typeof vi.spyOn>;
  let statSpy: ReturnType<typeof vi.spyOn>;
  let renameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    appendFileSpy = vi.spyOn(fs, "appendFile").mockResolvedValue(undefined);
    statSpy = vi.spyOn(fs, "stat").mockResolvedValue({ size: 0 } as import("node:fs").Stats);
    renameSpy = vi.spyOn(fs, "rename").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes INCOMPLETE_TURN entry with required fields", async () => {
    logIncompleteTurnDiag({
      sessionId: "sess-abc",
      runId: "run-xyz",
      stopReason: "toolUse",
      payloadCount: 0,
      hadPotentialSideEffects: true,
    });

    // fire-and-forget: wait one tick for the async write to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(appendFileSpy).toHaveBeenCalledOnce();
    const written = String(appendFileSpy.mock.calls[0]?.[1]);
    expect(written).toMatch("INCOMPLETE_TURN");
    expect(written).toMatch("sessionId=sess-abc");
    expect(written).toMatch("runId=run-xyz");
    expect(written).toMatch("stopReason=toolUse");
    expect(written).toMatch("payloads=0");
    expect(written).toMatch("hadSideEffects=true");
  });

  it("includes lastTool and lastToolError when provided", async () => {
    logIncompleteTurnDiag({
      sessionId: "sess-1",
      runId: "run-1",
      stopReason: undefined,
      payloadCount: 0,
      hadPotentialSideEffects: false,
      lastToolName: "bash",
      lastToolError: "command failed: exit 1",
    });

    await new Promise((r) => setTimeout(r, 10));

    const written = String(appendFileSpy.mock.calls[0]?.[1]);
    expect(written).toMatch("lastTool=bash");
    expect(written).toMatch("lastToolError=command failed: exit 1");
  });

  it("emits stopReason=undefined when stopReason is not set", async () => {
    logIncompleteTurnDiag({
      sessionId: "s",
      runId: "r",
      stopReason: undefined,
      payloadCount: 0,
      hadPotentialSideEffects: false,
    });

    await new Promise((r) => setTimeout(r, 10));

    const written = String(appendFileSpy.mock.calls[0]?.[1]);
    expect(written).toMatch("stopReason=undefined");
  });

  it("truncates lastToolError to 120 chars", async () => {
    const longError = "e".repeat(200);
    logIncompleteTurnDiag({
      sessionId: "s",
      runId: "r",
      stopReason: undefined,
      payloadCount: 0,
      hadPotentialSideEffects: false,
      lastToolError: longError,
    });

    await new Promise((r) => setTimeout(r, 10));

    const written = String(appendFileSpy.mock.calls[0]?.[1]);
    // full error (200 chars) should NOT appear; only first 120
    expect(written).not.toContain(longError);
    expect(written).toContain("e".repeat(120));
  });

  it("rotates log when size exceeds 2MB", async () => {
    statSpy.mockResolvedValue({ size: 2 * 1024 * 1024 } as import("node:fs").Stats);

    logIncompleteTurnDiag({
      sessionId: "s",
      runId: "r",
      stopReason: "toolUse",
      payloadCount: 0,
      hadPotentialSideEffects: false,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(renameSpy).toHaveBeenCalledOnce();
    expect(appendFileSpy).toHaveBeenCalledOnce();
  });

  it("does not throw when appendFile fails", async () => {
    appendFileSpy.mockRejectedValue(new Error("disk full"));

    await expect(
      new Promise<void>((resolve) => {
        logIncompleteTurnDiag({
          sessionId: "s",
          runId: "r",
          stopReason: undefined,
          payloadCount: 0,
          hadPotentialSideEffects: false,
        });
        setTimeout(resolve, 20);
      }),
    ).resolves.toBeUndefined();
  });
});

describe("DIAG_LOG path resolution", () => {
  it("uses OPENCLAW_FRANKCLAW_DIAG_LOG env var when set", async () => {
    // Env var override must win over any computed path.
    const override = "/tmp/custom-override-diag.log";
    const orig = process.env.OPENCLAW_FRANKCLAW_DIAG_LOG;
    try {
      process.env.OPENCLAW_FRANKCLAW_DIAG_LOG = override;
      vi.resetModules();
      const mod = await import("./incomplete-turn-diag.frankclaw.js");
      expect(mod.__testing?.DIAG_LOG).toBe(override);
    } finally {
      if (orig === undefined) {
        delete process.env.OPENCLAW_FRANKCLAW_DIAG_LOG;
      } else {
        process.env.OPENCLAW_FRANKCLAW_DIAG_LOG = orig;
      }
      vi.resetModules();
    }
  });

  it("resolves to tmpdir in VITEST mode (not filesystem root)", () => {
    // When VITEST is set (always true here), DIAG_LOG must use tmpdir(),
    // never a path starting with /state/ or / root from import.meta.url resolution.
    const diagLog = __testing.DIAG_LOG;
    expect(diagLog).toMatch(tmpdir());
    expect(diagLog).not.toBe("/state/frankclaw-diag.log");
    expect(diagLog).not.toMatch(/^\/state\//);
  });

  it("resolves to OPENCLAW_WORKSPACE/state/frankclaw-diag.log outside VITEST", async () => {
    const fakeWorkspace = "/tmp/fake-workspace-test";
    const origWorkspace = process.env.OPENCLAW_WORKSPACE;
    const origVitest = process.env.VITEST;
    const origVitestWorker = process.env.VITEST_WORKER_ID;
    const origOverride = process.env.OPENCLAW_FRANKCLAW_DIAG_LOG;
    try {
      delete process.env.VITEST;
      delete process.env.VITEST_WORKER_ID;
      delete process.env.OPENCLAW_FRANKCLAW_DIAG_LOG;
      process.env.OPENCLAW_WORKSPACE = fakeWorkspace;
      vi.resetModules();
      const mod = await import("./incomplete-turn-diag.frankclaw.js");
      expect(mod.__testing?.DIAG_LOG).toBe(`${fakeWorkspace}/state/frankclaw-diag.log`);
    } finally {
      if (origWorkspace === undefined) {
        delete process.env.OPENCLAW_WORKSPACE;
      } else {
        process.env.OPENCLAW_WORKSPACE = origWorkspace;
      }
      if (origVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = origVitest;
      }
      if (origVitestWorker === undefined) {
        delete process.env.VITEST_WORKER_ID;
      } else {
        process.env.VITEST_WORKER_ID = origVitestWorker;
      }
      if (origOverride === undefined) {
        delete process.env.OPENCLAW_FRANKCLAW_DIAG_LOG;
      } else {
        process.env.OPENCLAW_FRANKCLAW_DIAG_LOG = origOverride;
      }
      vi.resetModules();
    }
  });
});
