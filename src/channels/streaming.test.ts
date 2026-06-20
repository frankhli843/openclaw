import { describe, expect, it } from "vitest";
import {
  buildChannelProgressDraftLine,
  mergeChannelProgressDraftLine,
  normalizeChannelProgressDraftLineIdentity,
} from "./streaming.js";

describe("buildChannelProgressDraftLine", () => {
  it("omits generic completed status from successful command output with title", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "pwd",
        name: "exec",
        exitCode: 0,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ pwd",
      detail: "pwd",
      status: "completed",
    });
  });

  it("uses the tool label when successful command output has no title", () => {
    const line = buildChannelProgressDraftLine({
      event: "command-output",
      phase: "end",
      name: "exec",
      exitCode: 0,
    });

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ Exec",
      status: "completed",
    });
    expect(line?.detail).toBeUndefined();
  });

  it("keeps command status and title in raw command progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "exec-1",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "raw" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      id: "exec-1",
      text: "🛠️ exit 2; command false",
      detail: "command false",
      status: "exit 2",
    });
  });

  it("keeps only command status in status-only progress lines", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "command-output",
        phase: "end",
        title: "command false",
        name: "exec",
        exitCode: 2,
      },
      { commandText: "status" },
    );

    expect(line).toMatchObject({
      kind: "command-output",
      text: "🛠️ exit 2",
      detail: "exit 2",
      status: "exit 2",
    });
    expect(line?.text).not.toContain("command false");
  });

  it("extracts command details from provider-cased Bash tool starts", () => {
    const line = buildChannelProgressDraftLine(
      {
        event: "tool",
        toolCallId: "call-bash-1",
        name: "Bash",
        phase: "start",
        args: { command: "git status --short", workdir: "/home/frank/.openclaw/workspace" },
      },
      { commandText: "raw", detailMode: "explain" },
    );

    expect(line).toMatchObject({
      kind: "tool",
      id: "tool:call-bash-1",
      text: "🛠️ check git status (agent)",
      detail: "check git status (agent)",
      toolName: "bash",
    });
  });

  it("updates the same command progress line when output arrives for provider-cased Bash", () => {
    const startLine = buildChannelProgressDraftLine(
      {
        event: "tool",
        toolCallId: "call-bash-1",
        name: "Bash",
        phase: "start",
        args: { command: "git status --short", workdir: "/home/frank/.openclaw/workspace" },
      },
      { commandText: "raw", detailMode: "explain" },
    );
    const endLine = buildChannelProgressDraftLine(
      {
        event: "command-output",
        toolCallId: "call-bash-1",
        phase: "end",
        name: "Bash",
        exitCode: 0,
      },
      { commandText: "raw" },
    );
    if (!startLine || !endLine) {
      throw new Error("expected progress lines");
    }

    const merged = mergeChannelProgressDraftLine([startLine], endLine, { maxLines: 5 });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: "command-output",
      id: "call-bash-1",
      detail: "check git status (agent)",
      status: "completed",
      toolName: "bash",
    });
    expect(normalizeChannelProgressDraftLineIdentity(merged[0])).toBe(
      "🛠️ check git status (agent) completed",
    );
  });
});
