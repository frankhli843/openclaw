// frankclaw: Multi-turn cron orchestration for sessions_spawn + sessions_yield.
//
// Problem (2026-04-23 incident):
// The knowledge-agent cron orchestrator spawns CC ACP workers in batches,
// calling sessions_yield after each spawn. But executeCronRun treated this
// as a single-turn job: after the model yielded, if descendants were active
// it skipped the continuation prompt and returned. delivery-dispatch waited
// for descendants but only delivered their output, never giving the parent
// model another turn to spawn batches 2-4.
//
// Fix: after the initial model turn, if the model produced an interim
// message and spawned descendants, wait for descendants to drain, feed
// their output back as a continuation prompt, and let the model spawn
// the next batch. Loop until the model is done or the turn budget exhausts.

import * as fs from "node:fs";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cron/subagent-orchestration");

/** Maximum follow-up turns the orchestrator gets after the initial run. */
export const MAX_ORCHESTRATION_FOLLOWUPS = 8;

/** Interval at which we touch the JSONL file during descendant wait (ms). */
const JSONL_KEEPALIVE_INTERVAL_MS = 60_000; // 1 minute

type SubagentFollowupRuntime = typeof import("./subagent-followup.runtime.js");
type SubagentRegistryRuntime = typeof import("./run-subagent-registry.runtime.js");

let followupRuntimePromise: Promise<SubagentFollowupRuntime> | undefined;
let registryRuntimePromise: Promise<SubagentRegistryRuntime> | undefined;

async function loadFollowupRuntime(): Promise<SubagentFollowupRuntime> {
  followupRuntimePromise ??= import("./subagent-followup.runtime.js");
  return await followupRuntimePromise;
}

async function loadRegistryRuntime(): Promise<SubagentRegistryRuntime> {
  registryRuntimePromise ??= import("./run-subagent-registry.runtime.js");
  return await registryRuntimePromise;
}

/**
 * Start a periodic JSONL file touch so the watchdog's stale-jsonl
 * detector does not reap the parent session while we wait for children.
 * Returns a cleanup function to stop the interval.
 */
function startJsonlKeepalive(sessionFilePath: string | undefined): () => void {
  if (!sessionFilePath) {
    return () => {};
  }
  const interval = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(sessionFilePath, now, now);
    } catch {
      // File may not exist yet or be locked; ignore.
    }
  }, JSONL_KEEPALIVE_INTERVAL_MS);
  return () => clearInterval(interval);
}

export interface OrchestrationContext {
  agentSessionKey: string;
  runStartedAt: number;
  timeoutMs: number;
  sessionFilePath: string | undefined;
  isAborted: () => boolean;
  runPrompt: (prompt: string) => Promise<void>;
  getRunResult: () => {
    runResult?: {
      meta?: { error?: unknown; finalAssistantVisibleText?: string };
      didSendViaMessagingTool?: boolean;
      payloads?: Array<{ text?: string; isError?: boolean }>;
    };
  };
}

/**
 * Run the multi-turn orchestration loop.
 *
 * After the initial model turn, if the model produced an interim message
 * AND spawned descendant workers, this function:
 * 1. Waits for all active descendants to drain
 * 2. Collects their output
 * 3. Feeds it back to the model as a continuation prompt
 * 4. Repeats until the model stops spawning children or the turn budget exhausts
 *
 * @returns The number of follow-up turns executed (0 if no orchestration was needed)
 */
export async function runOrchestrationLoop(
  ctx: OrchestrationContext,
  checkInterim: (
    runResult: NonNullable<ReturnType<OrchestrationContext["getRunResult"]>["runResult"]>,
  ) => boolean,
): Promise<number> {
  const registry = await loadRegistryRuntime();
  const followup = await loadFollowupRuntime();
  let followupCount = 0;

  const stopKeepalive = startJsonlKeepalive(ctx.sessionFilePath);
  try {
    while (followupCount < MAX_ORCHESTRATION_FOLLOWUPS && !ctx.isAborted()) {
      const { runResult } = ctx.getRunResult();
      if (!runResult) {
        break;
      }

      // Check if current output looks like an interim orchestration message
      const isInterim = checkInterim(runResult);

      // Check for active or fresh descendants
      const freshDescendants = registry
        .listDescendantRunsForRequester(ctx.agentSessionKey)
        .filter((entry) => {
          const started = typeof entry.startedAt === "number" ? entry.startedAt : entry.createdAt;
          return typeof started === "number" && started >= ctx.runStartedAt;
        });
      const activeCount = registry.countActiveDescendantRuns(ctx.agentSessionKey);

      if (freshDescendants.length === 0 && activeCount === 0) {
        // No descendants: if interim, do a simple retry without descendant context
        if (isInterim && followupCount === 0) {
          const prompt = [
            "Your previous response was only an acknowledgement and did not complete this cron task.",
            "Complete the original task now.",
            "Do not send a status update like 'on it'.",
            "Use tools when needed, including sessions_spawn for parallel subtasks, wait for spawned subagents to finish, then return only the final summary.",
          ].join(" ");
          await ctx.runPrompt(prompt);
          followupCount++;
          continue;
        }
        break;
      }

      if (!isInterim && followupCount > 0) {
        // Model produced substantive output (not interim) after at least one
        // orchestration turn. It may have delivered its own final summary.
        // Don't force another turn.
        break;
      }

      // Wait for active descendants to drain
      if (activeCount > 0) {
        log.info?.(
          `orchestration turn ${followupCount + 1}: waiting for ${activeCount} active descendants (session=${ctx.agentSessionKey.slice(0, 50)})`,
        );
        await followup.waitForDescendantSubagentSummary({
          sessionKey: ctx.agentSessionKey,
          timeoutMs: ctx.timeoutMs,
          observedActiveDescendants: true,
        });
      }

      // Collect descendant output
      const descendantReply = await followup.readDescendantSubagentFallbackReply({
        sessionKey: ctx.agentSessionKey,
        runStartedAt: ctx.runStartedAt,
      });

      // Check if there are still active descendants (children may have spawned more)
      const stillActive = registry.countActiveDescendantRuns(ctx.agentSessionKey);
      if (stillActive > 0) {
        log.info?.(
          `orchestration: ${stillActive} descendants still active after wait, continuing loop`,
        );
      }

      // Feed descendant output back to the model
      const continuationPrompt = descendantReply
        ? [
            "Your spawned background worker completed. Here is its output:",
            "",
            descendantReply.length > 8000
              ? descendantReply.slice(0, 8000) + "\n\n[... truncated]"
              : descendantReply,
            "",
            "Continue with the next step of your original task.",
            "If there are more batches or phases to run, spawn the next worker now.",
            "If all work is done, provide the final summary.",
          ].join("\n")
        : [
            "Your spawned background worker completed but produced no readable output.",
            "Check the result file if one was expected, then continue with the next step.",
            "If there are more batches to run, spawn the next worker.",
            "If all work is done, provide the final summary.",
          ].join(" ");

      log.info?.(
        `orchestration turn ${followupCount + 1}: feeding descendant output (${descendantReply?.length ?? 0} chars) back to model`,
      );
      await ctx.runPrompt(continuationPrompt);
      followupCount++;
    }
  } finally {
    stopKeepalive();
  }

  if (followupCount > 0) {
    log.info?.(
      `orchestration complete: ${followupCount} follow-up turn(s) for session=${ctx.agentSessionKey.slice(0, 50)}`,
    );
  }

  return followupCount;
}
