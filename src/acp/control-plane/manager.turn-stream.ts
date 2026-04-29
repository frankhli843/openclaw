import { AcpRuntimeError } from "../runtime/errors.js";
import type { AcpRuntime, AcpRuntimeEvent, AcpRuntimeTurnInput } from "../runtime/types.js";
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

export async function consumeAcpTurnStream(params: {
  runtime: AcpRuntime;
  turn: AcpRuntimeTurnInput;
  eventGate: AcpTurnEventGate;
  onEvent?: (event: AcpRuntimeEvent) => Promise<void> | void;
  onOutputEvent?: (
    event: Extract<AcpRuntimeEvent, { type: "text_delta" | "tool_call" }>,
  ) => Promise<void> | void;
}): Promise<AcpTurnStreamOutcome> {
  let streamError: AcpRuntimeError | null = null;
  let sawOutput = false;
  let sawTerminalEvent = false;

  // frankclaw: diagnostic logging
  const turnStartMs = Date.now();
  acpDiag(
    `TURN_START session=${params.turn.handle.sessionKey} req=${params.turn.requestId} mode=${params.turn.mode}`,
  );
  let eventCount = 0;

  for await (const event of params.runtime.runTurn(params.turn)) {
    eventCount++; // frankclaw: count events
    if (!params.eventGate.open) {
      continue;
    }
    if (event.type === "done") {
      sawTerminalEvent = true;
      // frankclaw: log turn completion
      acpDiag(
        `TURN_DONE session=${params.turn.handle.sessionKey} events=${eventCount} elapsed=${Date.now() - turnStartMs}ms stopReason=${(event as { stopReason?: string }).stopReason}`,
      );
    } else if (event.type === "error") {
      streamError = new AcpRuntimeError(
        normalizeAcpErrorCode(event.code),
        normalizeText(event.message) || "ACP turn failed before completion.",
      );
      // frankclaw: log the error details
      acpDiag(
        `TURN_ERROR session=${params.turn.handle.sessionKey} code=${event.code} message=${event.message} events=${eventCount} elapsed=${Date.now() - turnStartMs}ms`,
      );
    } else if (event.type === "text_delta" || event.type === "tool_call") {
      sawOutput = true;
      await params.onOutputEvent?.(event);
    }
    await params.onEvent?.(event);
  }

  if (params.eventGate.open && streamError) {
    // frankclaw: log the throw
    acpDiag(
      `TURN_THROW session=${params.turn.handle.sessionKey} error=${streamError.message} code=${streamError.code} elapsed=${Date.now() - turnStartMs}ms sawOutput=${sawOutput} events=${eventCount}`,
    );
    throw streamError;
  }

  return {
    sawOutput,
    sawTerminalEvent,
  };
}
