import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  acpDiagMock: vi.fn(),
}));

vi.mock("./acp-diag.frankclaw.js", () => ({
  acpDiag: hoisted.acpDiagMock,
}));

const { consumeAcpTurnStream } = await import("./manager.turn-stream.js");

type RuntimeEvent =
  | { type: "text_delta"; text: string; stream?: "output" | "thought" }
  | { type: "tool_call"; text: string; toolCallId?: string }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string; code?: string };

function makeRuntime(events: RuntimeEvent[]) {
  return {
    runTurn(_input: unknown): AsyncIterable<RuntimeEvent> {
      return (async function* gen() {
        for (const event of events) {
          yield event;
        }
      })();
    },
  } as unknown as Parameters<typeof consumeAcpTurnStream>[0]["runtime"];
}

const baseTurn = {
  handle: {
    sessionKey: "agent:claude:acp:trivial-end-turn-test",
    backend: "acpx",
    runtimeSessionName: "acpx:test",
  },
  text: "do work",
  mode: "prompt" as const,
  requestId: "req-1",
};

beforeEach(() => {
  hoisted.acpDiagMock.mockReset();
});

describe("consumeAcpTurnStream TURN_ANOMALY_TRIVIAL_END (frankclaw)", () => {
  it("emits TURN_ANOMALY_TRIVIAL_END when end_turn fires with zero tool calls", async () => {
    // Reproduces the 2026-04-30 knowledge-agent failure: SDK turn ends in
    // 12s with 7 events and stopReason=end_turn but did no real work.
    const runtime = makeRuntime([
      { type: "text_delta", text: "Model set to claude-opus-4-7[1m].", stream: "output" },
      { type: "done", stopReason: "end_turn" },
    ]);
    const outcome = await consumeAcpTurnStream({
      runtime,
      turn: baseTurn,
      eventGate: { open: true },
    });
    expect(outcome.sawTerminalEvent).toBe(true);
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c[0] ?? ""));
    const turnDone = lines.find((line) => line.startsWith("TURN_DONE "));
    expect(turnDone).toBeDefined();
    expect(turnDone).toContain("tools=0");
    expect(turnDone).toContain("stopReason=end_turn");
    const anomaly = lines.find((line) => line.startsWith("TURN_ANOMALY_TRIVIAL_END "));
    expect(anomaly).toBeDefined();
    expect(anomaly).toContain("session=agent:claude:acp:trivial-end-turn-test");
    expect(anomaly).toContain("tools=0");
    expect(anomaly).toContain("stopReason=end_turn");
  });

  it("does not emit TURN_ANOMALY_TRIVIAL_END when at least one tool call occurred", async () => {
    const runtime = makeRuntime([
      { type: "tool_call", text: "Read", toolCallId: "tc-1" },
      { type: "text_delta", text: "result", stream: "output" },
      { type: "done", stopReason: "end_turn" },
    ]);
    await consumeAcpTurnStream({
      runtime,
      turn: baseTurn,
      eventGate: { open: true },
    });
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c[0] ?? ""));
    const turnDone = lines.find((line) => line.startsWith("TURN_DONE "));
    expect(turnDone).toBeDefined();
    expect(turnDone).toContain("tools=1");
    const anomaly = lines.find((line) => line.startsWith("TURN_ANOMALY_TRIVIAL_END "));
    expect(anomaly).toBeUndefined();
  });

  it("does not emit TURN_ANOMALY_TRIVIAL_END when stopReason is not end_turn", async () => {
    const runtime = makeRuntime([
      { type: "text_delta", text: "partial", stream: "output" },
      { type: "done", stopReason: "max_tokens" },
    ]);
    await consumeAcpTurnStream({
      runtime,
      turn: baseTurn,
      eventGate: { open: true },
    });
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c[0] ?? ""));
    const anomaly = lines.find((line) => line.startsWith("TURN_ANOMALY_TRIVIAL_END "));
    expect(anomaly).toBeUndefined();
  });

  it("counts tool_call events into the TURN_DONE tools= field", async () => {
    const runtime = makeRuntime([
      { type: "tool_call", text: "Read", toolCallId: "tc-1" },
      { type: "tool_call", text: "Bash", toolCallId: "tc-2" },
      { type: "tool_call", text: "Edit", toolCallId: "tc-3" },
      { type: "done", stopReason: "end_turn" },
    ]);
    await consumeAcpTurnStream({
      runtime,
      turn: baseTurn,
      eventGate: { open: true },
    });
    const lines = hoisted.acpDiagMock.mock.calls.map((c) => String(c[0] ?? ""));
    const turnDone = lines.find((line) => line.startsWith("TURN_DONE "));
    expect(turnDone).toBeDefined();
    expect(turnDone).toContain("tools=3");
  });
});
