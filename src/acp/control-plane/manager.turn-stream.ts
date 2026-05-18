import { AcpRuntimeError } from "../runtime/errors.js";
import type {
  AcpRuntime,
  AcpRuntimeEvent,
  AcpRuntimeTurnInput,
  AcpRuntimeTurnResult,
} from "../runtime/types.js";
import { acpDiag } from "./acp-diag.frankclaw.js"; // frankclaw: ACP diagnostic logging
import { normalizeAcpErrorCode } from "./manager.utils.js";
import { normalizeText } from "./runtime-options.js";

export type AcpTurnEventGate = {
  open: boolean;
};

export type AcpTurnStreamOutcome = {
  sawOutput: boolean;
  sawTerminalEvent: boolean;
};

async function consumeAcpTurnEvents(params: {
  events: AsyncIterable<AcpRuntimeEvent>;
  eventGate: AcpTurnEventGate;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
  onOutputEvent?: (
    event: Extract<AcpRuntimeEvent, { type: "text_delta" | "tool_call" }>,
  ) => Promise<void> | void;
  turn?: AcpRuntimeTurnInput; // frankclaw: optional diagnostic context
}): Promise<AcpTurnStreamOutcome> {
  let streamError: AcpRuntimeError | null = null;
  let sawOutput = false;
  let sawTerminalEvent = false;

  // frankclaw: diagnostic logging
  const turnStartMs = Date.now();
  acpDiag(
    `TURN_START session=${params.turn?.handle.sessionKey ?? "unknown"} req=${params.turn?.requestId ?? "unknown"} mode=${params.turn?.mode ?? "unknown"}`,
  );
  let eventCount = 0;
  // frankclaw: track tool_call count separately so we can spot "trivial
  // end_turn" workers — turns that complete cleanly at the protocol level
  // without invoking any tools, which is the failure mode we hit on
  // 2026-04-30 when oneshot CC ACP workers ended in 12s with 7 events and
  // produced no result file. Emitting the count on TURN_DONE lets detectors
  // scan acp-diag.log for `tools=0` cases.
  let toolCallCount = 0;

  for await (const event of params.events) {
    eventCount++; // frankclaw: count events
    if (!params.eventGate.open) {
      continue;
    }
    if (event.type === "done") {
      sawTerminalEvent = true;
      const elapsedMs = Date.now() - turnStartMs;
      const stopReason = (event as { stopReason?: string }).stopReason;
      // frankclaw: log turn completion (kept single-line for grep/detectors)
      acpDiag(
        `TURN_DONE session=${params.turn?.handle.sessionKey ?? "unknown"} events=${eventCount} elapsed=${elapsedMs}ms stopReason=${stopReason} tools=${toolCallCount}`,
      );
      // frankclaw: anomaly marker for the "SDK turn ended cleanly but did no
      // real work" failure mode. 0 tool calls + < 30s + end_turn for a
      // request that was supposed to do work is almost always a runtime
      // controls failure or directive-only short-circuit. Cron orchestrators
      // can grep for TURN_ANOMALY_TRIVIAL_END to know to surface a worker
      // failure instead of waiting on an artifact that will never arrive.
      // Threshold rationale: real work needs to read at least one file or
      // run at least one shell, both of which are tool calls. 30s is well
      // above directive-only ack latency (typically < 5s) and well below
      // the smallest legitimate turn that does meaningful work.
      if (stopReason === "end_turn" && toolCallCount === 0 && elapsedMs < 30_000) {
        acpDiag(
          `TURN_ANOMALY_TRIVIAL_END session=${params.turn?.handle.sessionKey ?? "unknown"} req=${params.turn?.requestId ?? "unknown"} mode=${params.turn?.mode ?? "unknown"} events=${eventCount} elapsed=${elapsedMs}ms tools=0 stopReason=end_turn`,
        );
      }
    } else if (event.type === "error") {
      streamError = new AcpRuntimeError(
        normalizeAcpErrorCode(event.code),
        normalizeText(event.message) || "ACP turn failed before completion.",
      );
      // frankclaw: log the error details
      acpDiag(
        `TURN_ERROR session=${params.turn?.handle.sessionKey ?? "unknown"} code=${event.code} message=${event.message} events=${eventCount} elapsed=${Date.now() - turnStartMs}ms`,
      );
    } else if (event.type === "text_delta" || event.type === "tool_call") {
      sawOutput = true;
      // frankclaw: track tool_call count for TURN_DONE/TURN_ANOMALY logs.
      if (event.type === "tool_call") {
        toolCallCount++;
      }
      await params.onOutputEvent?.(event);
    }
    await params.onEvent?.(event);
  }

  if (params.eventGate.open && streamError) {
    // frankclaw: log the throw
    acpDiag(
      `TURN_THROW session=${params.turn?.handle.sessionKey ?? "unknown"} error=${streamError.message} code=${streamError.code} elapsed=${Date.now() - turnStartMs}ms sawOutput=${sawOutput} events=${eventCount}`,
    );
    throw streamError;
  }

  return {
    sawOutput,
    sawTerminalEvent,
  };
}

function errorFromTurnResult(result: Extract<AcpRuntimeTurnResult, { status: "failed" }>) {
  return new AcpRuntimeError(
    normalizeAcpErrorCode(result.error.code),
    normalizeText(result.error.message) || "ACP turn failed before completion.",
  );
}

function waitForQueuedEvents(): Promise<"pending"> {
  return new Promise((resolve) => {
    setTimeout(() => resolve("pending"), 0);
  });
}

async function notifyTerminalResult(params: {
  result: AcpRuntimeTurnResult;
  eventGate: AcpTurnEventGate;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
}): Promise<void> {
  if (!params.eventGate.open) {
    return;
  }
  if (params.result.status === "completed") {
    await params.onEvent?.({
      type: "done",
      ...(params.result.stopReason ? { stopReason: params.result.stopReason } : {}),
    });
    return;
  }
  if (params.result.status === "cancelled") {
    await params.onEvent?.({
      type: "done",
      ...(params.result.stopReason ? { stopReason: params.result.stopReason } : {}),
    });
    return;
  }
  await params.onEvent?.({
    type: "error",
    code: normalizeAcpErrorCode(params.result.error.code),
    ...(params.result.error.detailCode ? { detailCode: params.result.error.detailCode } : {}),
    message: normalizeText(params.result.error.message) || "ACP turn failed before completion.",
    ...(params.result.error.retryable === undefined
      ? {}
      : { retryable: params.result.error.retryable }),
  });
}

export async function consumeAcpTurnStream(params: {
  runtime: AcpRuntime;
  turn: AcpRuntimeTurnInput;
  eventGate: AcpTurnEventGate;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
  onOutputEvent?: (
    event: Extract<AcpRuntimeEvent, { type: "text_delta" | "tool_call" }>,
  ) => Promise<void> | void;
}): Promise<AcpTurnStreamOutcome> {
  if (params.runtime.startTurn) {
    const turn = params.runtime.startTurn(params.turn);
    const eventsPromise = consumeAcpTurnEvents({
      events: turn.events,
      eventGate: params.eventGate,
      onEvent: params.onEvent,
      onOutputEvent: params.onOutputEvent,
      turn: params.turn, // frankclaw: pass for diagnostic logging
    }).then(
      (outcome) => ({ kind: "events" as const, outcome }),
      (error: unknown) => ({ kind: "event-error" as const, error }),
    );
    const resultPromise = turn.result.then(
      (result) => ({ kind: "result" as const, result }),
      (error: unknown) => ({ kind: "result-error" as const, error }),
    );

    let eventOutcome: AcpTurnStreamOutcome | null = null;
    let result: AcpRuntimeTurnResult | null = null;
    const firstOutcome = await Promise.race([eventsPromise, resultPromise]);
    if (firstOutcome.kind === "event-error") {
      await turn.closeStream({ reason: "turn-events-error" }).catch(() => {});
      throw firstOutcome.error;
    }
    if (firstOutcome.kind === "events") {
      eventOutcome = firstOutcome.outcome;
    } else if (firstOutcome.kind === "result-error") {
      await turn.closeStream({ reason: "turn-result-error" }).catch(() => {});
      throw firstOutcome.error;
    } else {
      result = firstOutcome.result;
    }

    if (!result) {
      const terminalOutcome = await resultPromise;
      if (terminalOutcome.kind === "result-error") {
        await turn.closeStream({ reason: "turn-result-error" }).catch(() => {});
        throw terminalOutcome.error;
      }
      result = terminalOutcome.result;
    }

    let closedTerminalStream = false;
    if (!eventOutcome) {
      let eventsOutcome = await Promise.race([eventsPromise, waitForQueuedEvents()]);
      if (eventsOutcome === "pending") {
        await turn.closeStream({ reason: `turn-result-${result.status}` }).catch(() => {});
        closedTerminalStream = true;
        eventsOutcome = await eventsPromise;
      }
      if (eventsOutcome.kind === "event-error") {
        throw eventsOutcome.error;
      }
      eventOutcome = eventsOutcome.outcome;
    }
    if (result.status !== "completed" && !closedTerminalStream) {
      await turn.closeStream({ reason: `turn-result-${result.status}` }).catch(() => {});
    }
    await notifyTerminalResult({
      result,
      eventGate: params.eventGate,
      onEvent: params.onEvent,
    });
    if (result.status === "failed") {
      throw errorFromTurnResult(result);
    }
    return {
      sawOutput: eventOutcome.sawOutput,
      sawTerminalEvent: true,
    };
  }

  return await consumeAcpTurnEvents({
    events: params.runtime.runTurn(params.turn),
    eventGate: params.eventGate,
    onEvent: params.onEvent,
    onOutputEvent: params.onOutputEvent,
    turn: params.turn, // frankclaw: pass for diagnostic logging
  });
}
