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
type TaskRegistryRuntime = typeof import("./run-task-registry.runtime.js");

let followupRuntimePromise: Promise<SubagentFollowupRuntime> | undefined;
let registryRuntimePromise: Promise<SubagentRegistryRuntime> | undefined;
let taskRegistryRuntimePromise: Promise<TaskRegistryRuntime> | undefined;

async function loadFollowupRuntime(): Promise<SubagentFollowupRuntime> {
  followupRuntimePromise ??= import("./subagent-followup.runtime.js");
  return await followupRuntimePromise;
}

async function loadRegistryRuntime(): Promise<SubagentRegistryRuntime> {
  registryRuntimePromise ??= import("./run-subagent-registry.runtime.js");
  return await registryRuntimePromise;
}

async function loadTaskRegistryRuntime(): Promise<TaskRegistryRuntime> {
  taskRegistryRuntimePromise ??= import("./run-task-registry.runtime.js");
  return await taskRegistryRuntimePromise;
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
  /** Returns the current run result. The runResult shape is opaque to this module. */
  getRunResult: () => { runResult?: unknown };
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
  /** Returns true if the run result looks like an interim orchestration ack. */
  checkInterim: (runResult: unknown) => boolean,
): Promise<number> {
  const registry = await loadRegistryRuntime();
  const followup = await loadFollowupRuntime();
  let followupCount = 0;
  // frankclaw: track consecutive blocked attempts for auto-fallback.
  // After the first blocked retry asks the model to respawn, subsequent
  // blocks switch to a direct-execution fallback prompt that tells the
  // model to do the work itself without spawning more ACP workers.
  let consecutiveBlockedCount = 0;

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

      // frankclaw: check if any completed descendant was blocked at a progress
      // checkpoint (terminalOutcome === "blocked").  If so, the worker did NOT
      // actually complete its task — it stopped after acknowledging the prompt
      // without running tools.  The parent model must know so it can respawn.
      const blockedDescendantLabels = await resolveBlockedDescendantLabels({
        registry,
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
      let continuationPrompt: string;
      if (blockedDescendantLabels.length > 0) {
        consecutiveBlockedCount++;
        const labels = blockedDescendantLabels.join(", ");
        log.info?.(
          `orchestration: ${blockedDescendantLabels.length} descendant(s) blocked at progress checkpoint: ${labels} (consecutive=${consecutiveBlockedCount})`,
        );

        if (consecutiveBlockedCount >= 2) {
          // frankclaw: auto-fallback — spawned workers keep checkpoint-stopping.
          // Tell the model to execute the task directly using its own tools
          // instead of spawning yet another ACP worker.
          log.info?.(
            `orchestration: auto-fallback to direct execution after ${consecutiveBlockedCount} consecutive blocked attempts`,
          );
          continuationPrompt = [
            `CRITICAL: Your spawned background workers have failed ${consecutiveBlockedCount} consecutive times (${labels}).`,
            "Each worker stopped at a progress checkpoint without executing any tools.",
            "",
            "DO NOT spawn another background worker. The ACP worker pattern is not working for this task.",
            "You MUST execute the task DIRECTLY in this session using your own tools (exec, file read/write, etc.).",
            "Run the required commands yourself. Do not delegate. Do not narrate what you would do.",
            "Execute the actual commands and return the real results.",
          ].join("\n");
        } else {
          // First blocked attempt — tell the model to retry with a new worker.
          continuationPrompt = [
            `WARNING: Your spawned background worker (${labels}) stopped at a progress checkpoint and did NOT complete the task.`,
            "The worker acknowledged the prompt but did not execute any tools or produce a real result.",
            "",
            descendantReply
              ? `Worker output (incomplete): ${descendantReply.length > 4000 ? descendantReply.slice(0, 4000) + "\n[... truncated]" : descendantReply}`
              : "The worker produced no readable output.",
            "",
            "You MUST spawn a new worker to retry this task.",
            "Do not accept the incomplete output as a valid result.",
          ].join("\n");
        }
      } else if (descendantReply) {
        // Reset consecutive blocked count on success
        consecutiveBlockedCount = 0;
        continuationPrompt = [
          "Your spawned background worker completed. Here is its output:",
          "",
          descendantReply.length > 8000
            ? descendantReply.slice(0, 8000) + "\n\n[... truncated]"
            : descendantReply,
          "",
          "Continue with the next step of your original task.",
          "If there are more batches or phases to run, spawn the next worker now.",
          "If all work is done, provide the final summary.",
        ].join("\n");
      } else {
        consecutiveBlockedCount = 0;
        continuationPrompt = [
          "Your spawned background worker completed but produced no readable output.",
          "Check the result file if one was expected, then continue with the next step.",
          "If there are more batches to run, spawn the next worker.",
          "If all work is done, provide the final summary.",
        ].join(" ");
      }

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

/**
 * frankclaw: check the task registry for descendant runs that completed with
 * terminalOutcome === "blocked" (progress checkpoint).  Returns labels/runIds
 * of blocked descendants so the continuation prompt can warn the parent.
 */
async function resolveBlockedDescendantLabels(params: {
  registry: SubagentRegistryRuntime;
  sessionKey: string;
  runStartedAt: number;
}): Promise<string[]> {
  const descendants = params.registry
    .listDescendantRunsForRequester(params.sessionKey)
    .filter((entry) => {
      const ended = entry.endedAt;
      return typeof ended === "number" && ended >= params.runStartedAt;
    });
  if (descendants.length === 0) {
    return [];
  }

  let taskRegistry: TaskRegistryRuntime;
  try {
    taskRegistry = await loadTaskRegistryRuntime();
  } catch {
    // Task registry unavailable — cannot detect blocked outcomes; proceed
    // without the check rather than breaking the orchestration loop.
    return [];
  }

  const blocked: string[] = [];
  for (const entry of descendants) {
    const task = taskRegistry.findTaskByRunId(entry.runId);
    if (task?.terminalOutcome === "blocked") {
      blocked.push(entry.label || entry.runId);
    }
  }
  return blocked;
}
