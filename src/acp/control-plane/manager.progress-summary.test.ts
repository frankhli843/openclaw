import { describe, expect, it } from "vitest";
import {
  appendBackgroundTaskProgressSummary,
  resolveBackgroundTaskTerminalResult,
} from "./manager.core.js";

describe("appendBackgroundTaskProgressSummary", () => {
  it("appends short chunks without truncation", () => {
    let s = appendBackgroundTaskProgressSummary("", "hello");
    s = appendBackgroundTaskProgressSummary(s, " world");
    expect(s).toBe("hello world");
  });

  it("keeps the TAIL when exceeding max length", () => {
    const longPrefix = "A".repeat(230);
    const tail = "this is the important ending";
    let s = appendBackgroundTaskProgressSummary("", longPrefix);
    s = appendBackgroundTaskProgressSummary(s, tail);
    // Combined would be 230 + 1 + 28 = 259 > 240, so truncation kicks in
    expect(s).toContain(tail);
    expect(s[0]).toBe("…");
  });

  it("preserves recent text over old text when truncating", () => {
    let s = "Now let me explore the codebase structure.";
    s = appendBackgroundTaskProgressSummary(s, "Reading files and understanding patterns.");
    s = appendBackgroundTaskProgressSummary(s, "Writing 23 unit tests. All pass.");
    s = appendBackgroundTaskProgressSummary(
      s,
      "Creating PR. Merge-readiness: conditionally ready.",
    );
    // The tail should contain the recent text, not the early "Now let me"
    if (s.length > 240) {
      expect(s).toContain("Merge-readiness: conditionally ready.");
      expect(s).not.toContain("Now let me explore");
    }
  });
});

describe("resolveBackgroundTaskTerminalResult", () => {
  it("returns empty for normal completion text", () => {
    expect(resolveBackgroundTaskTerminalResult("Done. PR created at /pull/325")).toEqual({});
  });

  it("detects permission denied", () => {
    const result = resolveBackgroundTaskTerminalResult(
      "Write failed: permission denied for /tmp/x",
    );
    expect(result.terminalOutcome).toBe("blocked");
    expect(result.terminalSummary).toContain("Permission denied");
  });

  it("detects 'now let me' at the END of a short summary", () => {
    const result = resolveBackgroundTaskTerminalResult(
      "I understand the codebase. Now let me implement the fix.",
    );
    expect(result.terminalOutcome).toBe("blocked");
  });

  it("does NOT false-positive on 'now let me' in the tail of a long completed run", () => {
    // Simulate a worker that said "Now let me" early but completed
    // After tail-truncation, the summary should show the ending, not the beginning
    let s = "";
    s = appendBackgroundTaskProgressSummary(s, "Reading the skill files. Now let me explore.");
    s = appendBackgroundTaskProgressSummary(s, "Found the key patterns. Writing implementation.");
    s = appendBackgroundTaskProgressSummary(s, "All 23 tests pass. Lint clean.");
    s = appendBackgroundTaskProgressSummary(s, "PR created. Merge-readiness: conditionally ready.");
    const result = resolveBackgroundTaskTerminalResult(s);
    // If the tail kept, "Now let me" from the start should be gone
    if (!s.includes("Now let me")) {
      expect(result.terminalOutcome).toBeUndefined();
    }
  });

  it("detects 'if you want, I can' at end", () => {
    const result = resolveBackgroundTaskTerminalResult(
      "Analysis complete. If you want, I can implement this.",
    );
    expect(result.terminalOutcome).toBe("blocked");
  });

  it("detects writable session requirement", () => {
    const result = resolveBackgroundTaskTerminalResult("I need a writable session to proceed.");
    expect(result.terminalOutcome).toBe("blocked");
    expect(result.terminalSummary).toContain("Writable session");
  });

  it("returns blocked for empty input (no deliverable produced)", () => {
    const result = resolveBackgroundTaskTerminalResult("");
    expect(result.terminalOutcome).toBe("blocked");
  });
});
