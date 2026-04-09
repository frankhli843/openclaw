import { describe, expect, it } from "vitest";
import { __testing } from "./subagent-announce.js";

const { buildAnnounceReplyInstruction } = __testing;

describe("buildAnnounceReplyInstruction failure mode", () => {
  // Regression guard for 2026-04-09: subagent task failures (outcome.status
  // = "error" | "timeout" | "unknown") must force the parent LLM to emit a
  // user-visible reply. Prior behavior allowed NO_REPLY when the LLM thought
  // the content was already delivered, which combined with the scope-bug in
  // the direct-fallback path (commit 49781f2d00) to silently drop every
  // failure notification reaching the user.

  it("forbids NO_REPLY for error outcomes addressed to a human user", () => {
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: false,
      announceType: "subagent task",
      expectsCompletionMessage: true,
      outcomeStatus: "error",
    });
    expect(instruction).toMatch(/FAILED/);
    expect(instruction).toMatch(/Do NOT reply with NO_REPLY/);
    expect(instruction).toMatch(/propose a next step/);
  });

  it("forbids NO_REPLY for timeout outcomes addressed to a human user", () => {
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: false,
      announceType: "subagent task",
      expectsCompletionMessage: true,
      outcomeStatus: "timeout",
    });
    expect(instruction).toMatch(/FAILED/);
    expect(instruction).toMatch(/Do NOT reply with NO_REPLY/);
  });

  it("forbids NO_REPLY for unknown outcomes addressed to a human user", () => {
    // 'unknown' happens when the worker process died before reporting any
    // outcome (e.g. gateway closed 1012 service restart). Users still need
    // to hear about this so they know the run was aborted.
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: false,
      announceType: "subagent task",
      expectsCompletionMessage: true,
      outcomeStatus: "unknown",
    });
    expect(instruction).toMatch(/FAILED/);
    expect(instruction).toMatch(/Do NOT reply with NO_REPLY/);
  });

  it("forbids NO_REPLY when the requester is itself a subagent (parent-of-parent orchestration)", () => {
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: true,
      announceType: "subagent task",
      outcomeStatus: "error",
    });
    expect(instruction).toMatch(/FAILED/);
    expect(instruction).toMatch(/Do NOT reply with NO_REPLY/);
  });

  it("still allows NO_REPLY for successful outcomes that may already be delivered", () => {
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: false,
      announceType: "subagent task",
      outcomeStatus: "ok",
    });
    // The non-failure branch permits NO_REPLY as an optimization — do NOT
    // regress the failure branch, but keep the success escape hatch.
    expect(instruction).toMatch(/NO_REPLY/);
  });

  it("still allows NO_REPLY for successful outcomes when requester is a subagent", () => {
    const instruction = buildAnnounceReplyInstruction({
      requesterIsSubagent: true,
      announceType: "subagent task",
      outcomeStatus: "ok",
    });
    expect(instruction).toMatch(/NO_REPLY/);
  });
});
