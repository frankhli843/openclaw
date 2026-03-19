import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractDatetime,
  validateReasonFile,
  ReasonFileError,
  getReasonFilePath,
  runSelfHeal,
  resolveNotifyTarget,
  type SelfHealDeps,
} from "./restart-selfheal.frankclaw.js";

// ---------------------------------------------------------------------------
// extractDatetime
// ---------------------------------------------------------------------------

describe("extractDatetime", () => {
  it("parses ISO 8601 with Z", () => {
    const dt = extractDatetime("datetime: 2026-03-04T15:50:00Z\nreason: test");
    expect(dt).toBeInstanceOf(Date);
    expect(dt!.toISOString()).toBe("2026-03-04T15:50:00.000Z");
  });

  it("parses ISO 8601 with timezone offset", () => {
    const dt = extractDatetime("datetime: 2026-03-04T10:50:00-05:00");
    expect(dt).toBeInstanceOf(Date);
    expect(dt!.toISOString()).toBe("2026-03-04T15:50:00.000Z");
  });

  it("parses ISO 8601 without timezone (treated as local)", () => {
    const dt = extractDatetime("datetime: 2026-03-04T10:50:00");
    expect(dt).toBeInstanceOf(Date);
    expect(dt!.getFullYear()).toBe(2026);
  });

  it("parses YYYY-MM-DD HH:MM:SS format", () => {
    const dt = extractDatetime("2026-03-04 10:50:00\nsome context");
    expect(dt).toBeInstanceOf(Date);
    expect(dt!.getFullYear()).toBe(2026);
    expect(dt!.getMonth()).toBe(2); // March = 2
    expect(dt!.getDate()).toBe(4);
  });

  it("parses YYYY-MM-DD HH:MM format (no seconds)", () => {
    const dt = extractDatetime("datetime: 2026-03-04 10:50\nreason: test");
    expect(dt).toBeInstanceOf(Date);
    expect(dt!.getFullYear()).toBe(2026);
  });

  it("returns null for no datetime", () => {
    expect(extractDatetime("reason: merged upstream\nchanges: rebuilt dist")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractDatetime("")).toBeNull();
  });

  it("finds datetime on any line", () => {
    const dt = extractDatetime(
      "# Restart Reason\n\nSome context.\n\ndatetime: 2026-03-04T12:00:00Z\n\nMore.",
    );
    expect(dt!.toISOString()).toBe("2026-03-04T12:00:00.000Z");
  });

  it("picks the first datetime if multiple exist", () => {
    const dt = extractDatetime("2026-01-01T00:00:00Z\n2026-12-31T23:59:59Z");
    expect(dt!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// validateReasonFile
// ---------------------------------------------------------------------------

describe("validateReasonFile", () => {
  const testDir = resolve(tmpdir(), `selfheal-test-${process.pid}`);
  const testFile = resolve(testDir, "restart-reason.md");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("throws 'missing' when file does not exist", () => {
    try {
      validateReasonFile(resolve(testDir, "nonexistent.md"));
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ReasonFileError);
      expect((e as ReasonFileError).code).toBe("missing");
    }
  });

  it("throws 'empty' when file is empty", () => {
    writeFileSync(testFile, "", "utf-8");
    try {
      validateReasonFile(testFile);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("empty");
    }
  });

  it("throws 'empty' when file is whitespace only", () => {
    writeFileSync(testFile, "   \n\n  \n", "utf-8");
    try {
      validateReasonFile(testFile);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("empty");
    }
  });

  it("throws 'no_datetime' when file has content but no datetime", () => {
    writeFileSync(testFile, "reason: merged upstream\nchanges: rebuilt dist\n", "utf-8");
    try {
      validateReasonFile(testFile);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("no_datetime");
    }
  });

  it("throws 'stale' when datetime is older than 30 minutes", () => {
    const oldTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeFileSync(testFile, `datetime: ${oldTime}\nreason: old\n`, "utf-8");
    try {
      validateReasonFile(testFile);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("stale");
    }
  });

  it("throws 'stale' at 31 minutes", () => {
    const stale = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    writeFileSync(testFile, `datetime: ${stale}\nreason: test\n`, "utf-8");
    try {
      validateReasonFile(testFile);
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("stale");
    }
  });

  it("accepts fresh datetime (just now)", () => {
    const content = `datetime: ${new Date().toISOString()}\nreason: test\n`;
    writeFileSync(testFile, content, "utf-8");
    expect(validateReasonFile(testFile)).toBe(content.trim());
  });

  it("accepts datetime 10 minutes ago", () => {
    const content = `datetime: ${new Date(Date.now() - 10 * 60 * 1000).toISOString()}\nreason: test\n`;
    writeFileSync(testFile, content, "utf-8");
    expect(validateReasonFile(testFile)).toBe(content.trim());
  });

  it("accepts datetime 29 minutes ago", () => {
    const content = `datetime: ${new Date(Date.now() - 29 * 60 * 1000).toISOString()}\nreason: test\n`;
    writeFileSync(testFile, content, "utf-8");
    expect(validateReasonFile(testFile)).toBe(content.trim());
  });

  it("uses 'now' parameter for deterministic freshness check", () => {
    writeFileSync(testFile, "datetime: 2026-03-04T15:00:00Z\nreason: test\n", "utf-8");

    // 10 min later → fresh
    expect(() =>
      validateReasonFile(testFile, new Date("2026-03-04T15:10:00Z").getTime()),
    ).not.toThrow();

    // 45 min later → stale
    try {
      validateReasonFile(testFile, new Date("2026-03-04T15:45:00Z").getTime());
      expect.fail("should throw");
    } catch (e) {
      expect((e as ReasonFileError).code).toBe("stale");
    }
  });
});

// ---------------------------------------------------------------------------
// getReasonFilePath
// ---------------------------------------------------------------------------

describe("getReasonFilePath", () => {
  it("returns path ending with state/restart-reason.md", () => {
    expect(getReasonFilePath()).toMatch(/state\/restart-reason\.md$/);
  });
});

// ---------------------------------------------------------------------------
// ReasonFileError
// ---------------------------------------------------------------------------

describe("ReasonFileError", () => {
  it("has name, code, message, and is an Error", () => {
    const err = new ReasonFileError("stale", "test msg");
    expect(err.name).toBe("ReasonFileError");
    expect(err.code).toBe("stale");
    expect(err.message).toBe("test msg");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// resolveNotifyTarget
// ---------------------------------------------------------------------------

describe("resolveNotifyTarget", () => {
  const origChannel = process.env.SELFHEAL_NOTIFY_CHANNEL;
  const origTarget = process.env.SELFHEAL_NOTIFY_TARGET;

  afterEach(() => {
    // Restore env
    if (origChannel !== undefined) {
      process.env.SELFHEAL_NOTIFY_CHANNEL = origChannel;
    } else {
      delete process.env.SELFHEAL_NOTIFY_CHANNEL;
    }
    if (origTarget !== undefined) {
      process.env.SELFHEAL_NOTIFY_TARGET = origTarget;
    } else {
      delete process.env.SELFHEAL_NOTIFY_TARGET;
    }
  });

  it("uses env vars when both are set", () => {
    process.env.SELFHEAL_NOTIFY_CHANNEL = "slack";
    process.env.SELFHEAL_NOTIFY_TARGET = "C12345";
    const result = resolveNotifyTarget();
    expect(result).toEqual({ channel: "slack", target: "C12345" });
  });

  it("ignores env when only one is set", () => {
    process.env.SELFHEAL_NOTIFY_CHANNEL = "slack";
    delete process.env.SELFHEAL_NOTIFY_TARGET;
    // Falls through to config — may return null or a config-based target
    const result = resolveNotifyTarget();
    // Should NOT use partial env
    if (result) {
      expect(result.channel).not.toBe("slack");
    }
  });
});

// ---------------------------------------------------------------------------
// runSelfHeal (with mocked deps)
// ---------------------------------------------------------------------------

describe("runSelfHeal", () => {
  function makeDeps(overrides: Partial<SelfHealDeps> = {}): SelfHealDeps & {
    notifications: string[];
    logs: string[];
  } {
    const notifications: string[] = [];
    const logs: string[] = [];
    return {
      notifications,
      logs,
      commandExists: overrides.commandExists ?? (() => false),
      runAgent: overrides.runAgent ?? (async () => ({ success: false, output: "mock failure" })),
      notify: overrides.notify ?? ((msg: string) => notifications.push(msg)),
      log: overrides.log ?? ((msg: string) => logs.push(msg)),
    };
  }

  it("returns false and notifies when neither CLI exists", async () => {
    const deps = makeDeps({ commandExists: () => false });
    const result = await runSelfHeal("test reason", deps);
    expect(result).toBe(false);
    expect(deps.notifications.some((n) => n.includes("Both repair agents unavailable"))).toBe(true);
    expect(deps.logs.some((l) => l.includes("Neither claude nor gemini"))).toBe(true);
  });

  it("returns true when Claude Code succeeds", async () => {
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "claude",
      runAgent: async (command) => {
        if (command === "claude") {
          return { success: true, output: "Fixed it!" };
        }
        return { success: false, output: "not called" };
      },
    });
    const result = await runSelfHeal("merged upstream", deps);
    expect(result).toBe(true);
    expect(deps.notifications.some((n) => n.includes("Claude Code is diagnosing"))).toBe(true);
    expect(deps.logs.some((l) => l.includes("Claude Code repair completed successfully"))).toBe(
      true,
    );
  });

  it("falls back to Gemini when Claude fails", async () => {
    const agentCalls: string[] = [];
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "claude" || cmd === "gemini",
      runAgent: async (command) => {
        agentCalls.push(command);
        if (command === "claude") {
          return { success: false, output: "claude error\ndetails" };
        }
        if (command === "gemini") {
          return { success: true, output: "Gemini fixed it" };
        }
        return { success: false, output: "" };
      },
    });
    const result = await runSelfHeal("config change", deps);
    expect(result).toBe(true);
    expect(agentCalls).toEqual(["claude", "gemini"]);
    expect(deps.notifications.some((n) => n.includes("couldn't fix it"))).toBe(true);
    expect(deps.logs.some((l) => l.includes("Gemini CLI repair completed successfully"))).toBe(
      true,
    );
  });

  it("returns false when both Claude and Gemini fail", async () => {
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "claude" || cmd === "gemini",
      runAgent: async () => ({ success: false, output: "error output" }),
    });
    const result = await runSelfHeal("broken build", deps);
    expect(result).toBe(false);
    expect(deps.notifications.some((n) => n.includes("Both repair agents failed"))).toBe(true);
  });

  it("skips Claude and tries Gemini when only Gemini exists", async () => {
    const agentCalls: string[] = [];
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "gemini",
      runAgent: async (command) => {
        agentCalls.push(command);
        return { success: true, output: "fixed" };
      },
    });
    const result = await runSelfHeal("test", deps);
    expect(result).toBe(true);
    expect(agentCalls).toEqual(["gemini"]);
    expect(deps.notifications.some((n) => n.includes("Claude Code not available"))).toBe(true);
  });

  it("passes correct args to Claude Code", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    let capturedPrompt = "";
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "claude",
      runAgent: async (cmd, args, prompt) => {
        capturedCmd = cmd;
        capturedArgs = args;
        capturedPrompt = prompt;
        return { success: true, output: "ok" };
      },
    });
    await runSelfHeal("test reason", deps);
    expect(capturedCmd).toBe("claude");
    expect(capturedArgs).toEqual(["--dangerously-skip-permissions", "-p"]);
    expect(capturedPrompt).toContain("test reason");
    expect(capturedPrompt).toContain("Gateway Self-Heal Task");
  });

  it("passes correct args to Gemini CLI", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];
    let capturedPrompt = "";
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "gemini",
      runAgent: async (cmd, args, prompt) => {
        capturedCmd = cmd;
        capturedArgs = args;
        capturedPrompt = prompt;
        return { success: true, output: "ok" };
      },
    });
    await runSelfHeal("test reason", deps);
    expect(capturedCmd).toBe("gemini");
    expect(capturedArgs).toEqual(["--yolo", "-p"]);
    expect(capturedPrompt).toContain("test reason");
  });

  it("sends initial notification with truncated context", async () => {
    const longReason = "x".repeat(500);
    const deps = makeDeps({ commandExists: () => false });
    await runSelfHeal(longReason, deps);
    const initialNotif = deps.notifications[0];
    expect(initialNotif).toContain("Self-heal in progress");
    // Context should be truncated to 300 chars
    expect(initialNotif.length).toBeLessThan(longReason.length);
  });

  it("includes error tail in fallback notification", async () => {
    const deps = makeDeps({
      commandExists: (cmd) => cmd === "claude" || cmd === "gemini",
      runAgent: async (command) => ({
        success: false,
        output: command === "claude" ? "line1\nline2\nclaude-error-detail" : "gemini-error-detail",
      }),
    });
    await runSelfHeal("test", deps);
    // Should include claude error in the "trying Gemini" notification
    expect(deps.notifications.some((n) => n.includes("claude-error-detail"))).toBe(true);
    // Should include gemini error in the final "both failed" notification
    expect(deps.notifications.some((n) => n.includes("gemini-error-detail"))).toBe(true);
  });
});
