import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";

const SessionsYieldToolSchema = Type.Object({
  message: Type.Optional(Type.String()),
});

export function createSessionsYieldTool(opts?: {
  sessionId?: string;
  onYield?: (message: string) => Promise<void> | void;
}): AnyAgentTool {
  return {
    label: "Yield",
    name: "sessions_yield",
    description: "End current turn. Use after spawning subagents; results arrive as next message.",
    parameters: SessionsYieldToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const message = readStringParam(params, "message") || "Turn yielded.";
      if (!opts?.sessionId) {
        return jsonResult({ status: "error", error: "No session context" });
      }
      if (!opts?.onYield) {
        // frankclaw: actionable error for cron context where onYield is not wired
        return jsonResult({
          status: "error",
          error:
            "sessions_yield is not supported in cron sessions. " +
            "Use sessions_spawn to start workers, then poll for their result files " +
            "(e.g. check if the expected output file exists). " +
            "The cron orchestrator will automatically feed descendant output back to you.",
        });
      }
      await opts.onYield(message);
      return jsonResult({ status: "yielded", message });
    },
  };
}
