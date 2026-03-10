import crypto from "node:crypto";
import { callGateway } from "../gateway/call.js";
import { createDurableJobQueue } from "../jobs/durable-job-queue.js";
import type {
  SpawnSubagentContext,
  SpawnSubagentParams,
  SpawnSubagentResult,
} from "./subagent-spawn.js";

const SUBAGENT_DURABLE_QUEUE = createDurableJobQueue();

type SpawnPayload = {
  params: SpawnSubagentParams;
  ctx: SpawnSubagentContext;
};

function isQueueExcludedSubagentTask(params: { task: string; label?: string }): boolean {
  const text = `${params.task} ${params.label ?? ""}`.toLowerCase();
  return text.includes("verifier") || text.includes("healer") || text.includes("checkup");
}

async function sendSubagentDeadLetterAlert(params: {
  reason: string;
  task: string;
  label?: string;
  error?: string;
}) {
  const labelPart = params.label?.trim() ? ` label=${params.label.trim()}` : "";
  const errorPart = params.error ? ` error=${params.error}` : "";
  const message = `⚠️ Subagent durable queue dead-letter: reason=${params.reason}${labelPart} task=${params.task.slice(0, 140)}${errorPart}`;
  try {
    await callGateway({
      method: "send",
      params: {
        channel: "discord",
        to: "1474420675933638847",
        message,
        idempotencyKey: `subagent-dlq:${crypto.randomUUID()}`,
      },
      timeoutMs: 10_000,
    });
  } catch {
    // best effort only
  }
}

export async function runSpawnSubagentWithDurableQueue(params: {
  params: SpawnSubagentParams;
  ctx: SpawnSubagentContext;
  runCore: (params: SpawnSubagentParams, ctx: SpawnSubagentContext) => Promise<SpawnSubagentResult>;
}): Promise<SpawnSubagentResult> {
  const excluded = isQueueExcludedSubagentTask({
    task: params.params.task,
    label: params.params.label,
  });
  if (excluded) {
    return await params.runCore(params.params, params.ctx);
  }

  try {
    return await SUBAGENT_DURABLE_QUEUE.run<SpawnPayload, SpawnSubagentResult>({
      queue: "subagent-spawn-jobs",
      kind: "subagent-spawn",
      payload: { params: params.params, ctx: params.ctx },
      run: async (payload) => await params.runCore(payload.params, payload.ctx),
      verify: async ({ result }) => {
        if (result.status === "forbidden") {
          return { ok: true, detail: result.error };
        }
        if (result.status !== "accepted") {
          return { ok: false, detail: result.error ?? "subagent spawn was not accepted" };
        }
        if (!result.runId?.trim()) {
          return { ok: false, detail: "subagent spawn missing run id" };
        }
        return { ok: true };
      },
      heal: async ({ payload }) => {
        const retried = await params.runCore(payload.params, payload.ctx);
        if (retried.status !== "accepted") {
          return {
            ok: false,
            detail: retried.error ?? "healer retry did not produce an accepted subagent",
          };
        }
        return { ok: true, result: retried };
      },
      onDeadLetter: async ({ reason, error }) => {
        await sendSubagentDeadLetterAlert({
          reason,
          task: params.params.task,
          label: params.params.label,
          error,
        });
      },
    });
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
